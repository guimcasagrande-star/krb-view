/**
 * Medidas em voxels: máscaras, estatísticas, SUVpico, crescimento de região e
 * volumetria. Serve ao PET (SUVmax/médio/pico, MTV, TLG) e é a base da
 * volumetria de órgãos e lesões nas fases de segmentação.
 *
 * Convenção: os dados do volume ficam num vetor único, com o voxel (i, j, k)
 * (coluna, linha, corte) no índice `i + j*nx + k*nx*ny`. É a mesma ordem dos
 * volumes do Cornerstone3D.
 */

import { add, length, scale, voxelToWorld, voxelVolumeMl, type VolumeGrid } from '../io/geometry';
import type { Vec3 } from '../io/types';

export interface ScalarVolume {
  data: ArrayLike<number>;
  grid: VolumeGrid;
}

export interface ValueScale {
  /** Fator único para todos os voxels (ex.: fator de SUV uniforme). */
  scale?: number;
  /** Um fator por corte (ex.: fator de SUV que varia por imagem). Tem prioridade sobre `scale`. */
  sliceScale?: ArrayLike<number>;
}

/** Máscara binária do mesmo tamanho do volume: 1 = dentro, 0 = fora. */
export type Mask = Uint8Array;

export function voxelCount(grid: VolumeGrid): number {
  return grid.dims[0] * grid.dims[1] * grid.dims[2];
}

export function voxelIndex(grid: VolumeGrid, i: number, j: number, k: number): number {
  return i + j * grid.dims[0] + k * grid.dims[0] * grid.dims[1];
}

export function indexToIjk(grid: VolumeGrid, index: number): Vec3 {
  const nx = grid.dims[0];
  const slice = nx * grid.dims[1];
  const k = Math.floor(index / slice);
  const rest = index - k * slice;
  const j = Math.floor(rest / nx);
  return [rest - j * nx, j, k];
}

function scaleForSlice(options: ValueScale, k: number): number {
  if (options.sliceScale) return options.sliceScale[k]!;
  return options.scale ?? 1;
}

// ---------------------------------------------------------------------------
// Máscaras
// ---------------------------------------------------------------------------

/** Deslocamentos (em voxels) cujo centro cai dentro de uma esfera de raio `radiusMm`. */
function sphereOffsets(grid: VolumeGrid, radiusMm: number): Int32Array {
  const reach: Vec3 = [
    Math.ceil(radiusMm / grid.spacing[0]) + 1,
    Math.ceil(radiusMm / grid.spacing[1]) + 1,
    Math.ceil(radiusMm / grid.spacing[2]) + 1,
  ];
  const out: number[] = [];
  for (let dk = -reach[2]; dk <= reach[2]; dk++) {
    for (let dj = -reach[1]; dj <= reach[1]; dj++) {
      for (let di = -reach[0]; di <= reach[0]; di++) {
        const d = add(add(scale(grid.stepI, di), scale(grid.stepJ, dj)), scale(grid.stepK, dk));
        if (length(d) <= radiusMm) out.push(di, dj, dk);
      }
    }
  }
  return Int32Array.from(out);
}

/**
 * Máscara de uma esfera. `centerIjk` é o centro em índices de voxel e pode ser
 * fracionário. O raio é em mm, então a esfera é esférica mesmo com voxel
 * anisotrópico.
 */
export function sphereMask(grid: VolumeGrid, centerIjk: Vec3, radiusMm: number): Mask {
  const mask = new Uint8Array(voxelCount(grid));
  const [nx, ny, nz] = grid.dims;
  const center = voxelToWorld(grid, centerIjk);
  const reach: Vec3 = [
    Math.ceil(radiusMm / grid.spacing[0]) + 1,
    Math.ceil(radiusMm / grid.spacing[1]) + 1,
    Math.ceil(radiusMm / grid.spacing[2]) + 1,
  ];
  const i0 = Math.max(0, Math.floor(centerIjk[0] - reach[0]));
  const i1 = Math.min(nx - 1, Math.ceil(centerIjk[0] + reach[0]));
  const j0 = Math.max(0, Math.floor(centerIjk[1] - reach[1]));
  const j1 = Math.min(ny - 1, Math.ceil(centerIjk[1] + reach[1]));
  const k0 = Math.max(0, Math.floor(centerIjk[2] - reach[2]));
  const k1 = Math.min(nz - 1, Math.ceil(centerIjk[2] + reach[2]));
  const r2 = radiusMm * radiusMm;
  for (let k = k0; k <= k1; k++) {
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = voxelToWorld(grid, [i, j, k]);
        const dx = w[0] - center[0];
        const dy = w[1] - center[1];
        const dz = w[2] - center[2];
        if (dx * dx + dy * dy + dz * dz <= r2) mask[i + j * nx + k * nx * ny] = 1;
      }
    }
  }
  return mask;
}

export interface ThresholdOptions extends ValueScale {
  /** Valor mínimo (inclusive), já na escala final (SUV, HU...). */
  min?: number;
  /** Valor máximo (inclusive). */
  max?: number;
  /** Se informado, só voxels desta máscara podem entrar. */
  within?: Mask;
}

/** Todos os voxels dentro da faixa de valores. */
export function thresholdMask(volume: ScalarVolume, options: ThresholdOptions): Mask {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  const mask = new Uint8Array(voxelCount(grid));
  const slice = nx * ny;
  for (let k = 0; k < nz; k++) {
    const s = scaleForSlice(options, k);
    const base = k * slice;
    for (let n = 0; n < slice; n++) {
      const idx = base + n;
      if (options.within && options.within[idx] === 0) continue;
      const v = data[idx]! * s;
      if (v >= min && v <= max) mask[idx] = 1;
    }
  }
  return mask;
}

export interface RegionGrowOptions extends ThresholdOptions {
  /** 6 = vizinhos de face; 26 = inclui arestas e cantos. Padrão 6. */
  connectivity?: 6 | 26;
}

/**
 * Crescimento de região: parte da semente e inclui os voxels vizinhos
 * conectados cujo valor está na faixa. Devolve máscara vazia se a própria
 * semente estiver fora da faixa.
 */
export function regionGrow(volume: ScalarVolume, seedIjk: Vec3, options: RegionGrowOptions): Mask {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const slice = nx * ny;
  const total = voxelCount(grid);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  const mask = new Uint8Array(total);

  const si = Math.round(seedIjk[0]);
  const sj = Math.round(seedIjk[1]);
  const sk = Math.round(seedIjk[2]);
  if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) return mask;

  const accept = (idx: number, k: number): boolean => {
    if (options.within && options.within[idx] === 0) return false;
    const v = data[idx]! * scaleForSlice(options, k);
    return v >= min && v <= max;
  };

  const seed = si + sj * nx + sk * slice;
  if (!accept(seed, sk)) return mask;

  const neighbors: [number, number, number][] = [];
  for (let dk = -1; dk <= 1; dk++) {
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const steps = Math.abs(di) + Math.abs(dj) + Math.abs(dk);
        if (steps === 0) continue;
        if ((options.connectivity ?? 6) === 6 && steps !== 1) continue;
        neighbors.push([di, dj, dk]);
      }
    }
  }

  // Fila em vetor tipado: cada voxel entra no máximo uma vez.
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  mask[seed] = 1;
  while (head < tail) {
    const idx = queue[head++]!;
    const k = Math.floor(idx / slice);
    const rest = idx - k * slice;
    const j = Math.floor(rest / nx);
    const i = rest - j * nx;
    for (const [di, dj, dk] of neighbors) {
      const ni = i + di;
      const nj = j + dj;
      const nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      const nIdx = ni + nj * nx + nk * slice;
      if (mask[nIdx] === 1 || !accept(nIdx, nk)) continue;
      mask[nIdx] = 1;
      queue[tail++] = nIdx;
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Estatísticas
// ---------------------------------------------------------------------------

export interface MaskStats {
  /** Número de voxels na máscara. */
  count: number;
  /** Volume da máscara em mL. */
  volumeMl: number;
  min: number;
  max: number;
  mean: number;
  /** Desvio-padrão populacional. */
  std: number;
  /** Voxel de valor máximo (i, j, k). */
  maxIjk: Vec3;
}

export function maskVolumeMl(mask: Mask, grid: VolumeGrid): number {
  let count = 0;
  for (let n = 0; n < mask.length; n++) count += mask[n]!;
  return count * voxelVolumeMl(grid);
}

/** Estatísticas dos voxels da máscara. `undefined` se a máscara estiver vazia. */
export function maskStats(
  volume: ScalarVolume,
  mask: Mask,
  options: ValueScale = {},
): MaskStats | undefined {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const slice = nx * ny;
  let count = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  let maxIndex = -1;
  for (let k = 0; k < nz; k++) {
    const s = scaleForSlice(options, k);
    const base = k * slice;
    for (let n = 0; n < slice; n++) {
      const idx = base + n;
      if (mask[idx] === 0) continue;
      const v = data[idx]! * s;
      count++;
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) {
        max = v;
        maxIndex = idx;
      }
    }
  }
  if (count === 0) return undefined;
  const mean = sum / count;
  const variance = Math.max(0, sumSq / count - mean * mean);
  return {
    count,
    volumeMl: count * voxelVolumeMl(grid),
    min,
    max,
    mean,
    std: Math.sqrt(variance),
    maxIjk: indexToIjk(grid, maxIndex),
  };
}

/** Raio (mm) da esfera de 1 mL usada no SUVpico. */
export const PEAK_SPHERE_RADIUS_MM = Math.cbrt((3 * 1000) / (4 * Math.PI));

export interface PeakResult {
  /** Maior média encontrada numa esfera de 1 mL. */
  value: number;
  /** Centro da esfera que deu o maior valor. */
  centerIjk: Vec3;
  /** Voxels que couberam na esfera. */
  voxelsInSphere: number;
  /**
   * Verdadeiro se a esfera tem menos de 8 voxels (voxel grande em relação a
   * 1 mL): o valor é uma aproximação grosseira.
   */
  coarse: boolean;
}

/**
 * SUVpico: maior média numa esfera de 1 mL (PERCIST) centrada em algum voxel
 * da máscara. A esfera pode sair da máscara, mas não do volume.
 *
 * Aproximações: o centro da esfera fica sempre no centro de um voxel, e um
 * voxel entra inteiro ou não entra (sem peso parcial). Com voxels de 4 mm isso
 * pode diferir em alguns por cento de softwares que interpolam.
 */
export function peakInMask(
  volume: ScalarVolume,
  mask: Mask,
  options: ValueScale & { radiusMm?: number } = {},
): PeakResult | undefined {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const slice = nx * ny;
  const offsets = sphereOffsets(grid, options.radiusMm ?? PEAK_SPHERE_RADIUS_MM);
  const offsetCount = offsets.length / 3;

  let best = -Infinity;
  let bestIndex = -1;
  let bestVoxels = 0;
  for (let idx = 0; idx < mask.length; idx++) {
    if (mask[idx] === 0) continue;
    const k = Math.floor(idx / slice);
    const rest = idx - k * slice;
    const j = Math.floor(rest / nx);
    const i = rest - j * nx;
    let sum = 0;
    let n = 0;
    for (let o = 0; o < offsetCount; o++) {
      const ni = i + offsets[o * 3]!;
      const nj = j + offsets[o * 3 + 1]!;
      const nk = k + offsets[o * 3 + 2]!;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      sum += data[ni + nj * nx + nk * slice]! * scaleForSlice(options, nk);
      n++;
    }
    if (n === 0) continue;
    const mean = sum / n;
    if (mean > best) {
      best = mean;
      bestIndex = idx;
      bestVoxels = n;
    }
  }
  if (bestIndex < 0) return undefined;
  return {
    value: best,
    centerIjk: indexToIjk(grid, bestIndex),
    voxelsInSphere: bestVoxels,
    coarse: bestVoxels < 8,
  };
}

// ---------------------------------------------------------------------------
// Lesão: isocontorno, MTV e TLG
// ---------------------------------------------------------------------------

export interface IsocontourOptions extends ValueScale {
  /** Fração do máximo (ex.: 0,41). Use isto OU `absolute`. */
  fractionOfMax?: number;
  /** Limiar absoluto (ex.: SUV 2,5). */
  absolute?: number;
  /** Se verdadeiro (padrão), o contorno não sai da região inicial. */
  limitToRegion?: boolean;
  connectivity?: 6 | 26;
}

/**
 * Segmenta uma lesão a partir de uma região inicial (a esfera que o usuário
 * desenhou): acha o voxel de maior valor e cresce a partir dele incluindo os
 * voxels conectados acima do limiar.
 */
export function isocontour(
  volume: ScalarVolume,
  region: Mask,
  options: IsocontourOptions,
): Mask | undefined {
  const stats = maskStats(volume, region, options);
  if (!stats) return undefined;
  let threshold: number;
  if (options.absolute !== undefined) threshold = options.absolute;
  else if (options.fractionOfMax !== undefined) threshold = options.fractionOfMax * stats.max;
  else return undefined;

  const grow: RegionGrowOptions = { min: threshold };
  if (options.scale !== undefined) grow.scale = options.scale;
  if (options.sliceScale !== undefined) grow.sliceScale = options.sliceScale;
  if (options.connectivity !== undefined) grow.connectivity = options.connectivity;
  if (options.limitToRegion ?? true) grow.within = region;
  return regionGrow(volume, stats.maxIjk, grow);
}

export interface LesionMetrics {
  max: number;
  mean: number;
  peak?: number;
  /** Volume da máscara em mL (MTV, no PET). */
  volumeMl: number;
  /** Média × volume (TLG, no PET). */
  totalActivity: number;
  voxels: number;
}

/** SUVmax, SUVmédio, SUVpico, MTV e TLG de uma máscara. */
export function lesionMetrics(
  volume: ScalarVolume,
  mask: Mask,
  options: ValueScale = {},
): LesionMetrics | undefined {
  const stats = maskStats(volume, mask, options);
  if (!stats) return undefined;
  const metrics: LesionMetrics = {
    max: stats.max,
    mean: stats.mean,
    volumeMl: stats.volumeMl,
    totalActivity: stats.mean * stats.volumeMl,
    voxels: stats.count,
  };
  const peak = peakInMask(volume, mask, options);
  if (peak) metrics.peak = peak.value;
  return metrics;
}
