/**
 * ROI volumétrica esférica (VOI) e medidas de lesão no PET (isocontorno, MTV e TLG):
 * funções puras sobre `ScalarVolume` (sem Cornerstone), usando `voxelStats`.
 */

import { voxelToWorld, worldToVoxel, type VolumeGrid } from '../io/geometry';
import type { Vec3 } from '../io/types';
import {
  isocontour,
  lesionMetrics,
  type Mask,
  maskStats,
  peakInMask,
  type ScalarVolume,
  sphereMask,
} from './voxelStats';

export type ModoLesao = 'esfera' | '41%' | 'suv25';

export interface ResultadoVoi {
  ok: true;
  raioMm: number;
  /** Volume da região medida em mL (esfera ou MTV do isocontorno). */
  volumeMl: number;
  voxels: number;
  media: number;
  desvio: number;
  min: number;
  max: number;
  /** Maior média numa esfera de 1 mL dentro da região (SUVpico, no PET). */
  pico?: number;
  /** Modo usado no cálculo (esfera inteira, 41% do máx. ou SUV ≥ 2,5). */
  modo?: ModoLesao;
  /** MTV (Metabolic Tumor Volume) em mL quando segmentada por isocontorno. */
  mtvMl?: number;
  /** TLG (Total Lesion Glycolysis = SUVmédio × MTV) quando segmentada por isocontorno. */
  tlg?: number;
  /** Segmentos de contorno [p0, p1] em coordenadas do paciente (mm), indexados pelo corte k. */
  contornoPorCorte?: Map<number, Array<[Vec3, Vec3]>>;
  /** Grade do volume usada para extrair o contorno. */
  grid?: VolumeGrid;
}

export type RespostaVoi = ResultadoVoi | { ok: false; motivo: string };

/**
 * Extrai as arestas de borda da máscara em cada corte `k`, devolvendo segmentos [pA, pB]
 * em coordenadas do paciente (mm) para desenho sobre a imagem.
 */
export function extrairContornoPorCorte(mask: Mask, grid: VolumeGrid): Map<number, Array<[Vec3, Vec3]>> {
  const [nx, ny, nz] = grid.dims;
  const slice = nx * ny;
  const porCorte = new Map<number, Array<[Vec3, Vec3]>>();

  for (let k = 0; k < nz; k++) {
    const base = k * slice;
    const segs: Array<[Vec3, Vec3]> = [];
    for (let j = 0; j < ny; j++) {
      const row = base + j * nx;
      for (let i = 0; i < nx; i++) {
        if (mask[row + i] === 0) continue;
        if (i === 0 || mask[row + i - 1] === 0) {
          segs.push([voxelToWorld(grid, [i - 0.5, j - 0.5, k]), voxelToWorld(grid, [i - 0.5, j + 0.5, k])]);
        }
        if (i === nx - 1 || mask[row + i + 1] === 0) {
          segs.push([voxelToWorld(grid, [i + 0.5, j - 0.5, k]), voxelToWorld(grid, [i + 0.5, j + 0.5, k])]);
        }
        if (j === 0 || mask[row - nx + i] === 0) {
          segs.push([voxelToWorld(grid, [i - 0.5, j - 0.5, k]), voxelToWorld(grid, [i + 0.5, j - 0.5, k])]);
        }
        if (j === ny - 1 || mask[row + nx + i] === 0) {
          segs.push([voxelToWorld(grid, [i - 0.5, j + 0.5, k]), voxelToWorld(grid, [i + 0.5, j + 0.5, k])]);
        }
      }
    }
    if (segs.length > 0) porCorte.set(k, segs);
  }
  return porCorte;
}

/**
 * Estatísticas da esfera de raio `raioMm` centrada em `centroMundo` (mm, coordenadas do paciente).
 * Os valores são usados como estão no volume: o carregador já entrega HU e SUV (`scale = 1`).
 */
export function calcularVoiEsfera(
  volume: ScalarVolume,
  centroMundo: Vec3,
  raioMm: number,
  comPico: boolean,
  modo: ModoLesao = 'esfera',
): RespostaVoi {
  if (!(raioMm > 0)) return { ok: false, motivo: 'Raio inválido.' };
  const ijk = worldToVoxel(volume.grid, centroMundo);
  if (!ijk) return { ok: false, motivo: 'Geometria do volume inválida.' };
  const [nx, ny, nz] = volume.grid.dims;
  if (ijk[0] < -0.5 || ijk[1] < -0.5 || ijk[2] < -0.5 || ijk[0] > nx - 0.5 || ijk[1] > ny - 0.5 || ijk[2] > nz - 0.5) {
    return { ok: false, motivo: 'O centro está fora do volume.' };
  }
  const mascaraEsfera = sphereMask(volume.grid, ijk, raioMm);
  const sEsfera = maskStats(volume, mascaraEsfera);
  if (!sEsfera) return { ok: false, motivo: 'Nenhum voxel dentro da esfera (raio menor que o voxel).' };

  if (modo === 'esfera') {
    const r: ResultadoVoi = {
      ok: true,
      modo,
      raioMm,
      volumeMl: sEsfera.volumeMl,
      voxels: sEsfera.count,
      media: sEsfera.mean,
      desvio: sEsfera.std,
      min: sEsfera.min,
      max: sEsfera.max,
    };
    if (comPico) {
      const p = peakInMask(volume, mascaraEsfera);
      if (p) r.pico = p.value;
    }
    return r;
  }

  const iso = isocontour(
    volume,
    mascaraEsfera,
    modo === '41%' ? { fractionOfMax: 0.41, scale: 1 } : { absolute: 2.5, scale: 1 },
  );
  const metricas = iso ? lesionMetrics(volume, iso, { scale: 1 }) : undefined;
  const sIso = iso ? maskStats(volume, iso, { scale: 1 }) : undefined;

  if (!iso || !metricas || !sIso) {
    // Mantém os valores da esfera (ex.: SUVmáx < 2,5) com MTV = 0 para o usuário poder trocar de critério.
    const picoEsfera = comPico ? peakInMask(volume, mascaraEsfera)?.value : undefined;
    return {
      ok: true,
      modo,
      raioMm,
      volumeMl: 0,
      voxels: 0,
      media: sEsfera.mean,
      desvio: sEsfera.std,
      min: sEsfera.min,
      max: sEsfera.max,
      ...(picoEsfera !== undefined ? { pico: picoEsfera } : {}),
      mtvMl: 0,
      tlg: 0,
      contornoPorCorte: new Map(),
      grid: volume.grid,
    };
  }

  return {
    ok: true,
    modo,
    raioMm,
    volumeMl: metricas.volumeMl,
    voxels: metricas.voxels,
    media: metricas.mean,
    desvio: sIso.std,
    min: sIso.min,
    max: metricas.max,
    ...(comPico && metricas.peak !== undefined ? { pico: metricas.peak } : {}),
    mtvMl: metricas.volumeMl,
    tlg: metricas.totalActivity,
    contornoPorCorte: extrairContornoPorCorte(iso, volume.grid),
    grid: volume.grid,
  };
}
