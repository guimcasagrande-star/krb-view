/**
 * Extração de superfícies poligonais 3D a partir de um labelmap (fase 10.1):
 * - Algoritmo 3D Surface Nets (dual grid) em TypeScript puro, respeitando `spacing`,
 *   `origin` e `direction` da `VolumeGrid` (espaço físico do paciente em mm / LPS).
 * - Suavização Taubin (sem encolhimento excessivo) + cálculo de normais suaves por vértice.
 * - Cache por segmento baseado em sujeira + assinatura de voxels (só recalcula quando os
 *   voxels daquele segmento forem editados).
 */

import { cross, dot, type VolumeGrid, voxelToWorld } from '../io/geometry';

export interface MalhaSuperficie3d {
  /** Coordenadas físicas (mm, LPS) dos vértices: [x0, y0, z0, ...]. */
  positions: Float32Array;
  /** Índices dos triângulos: [a0, b0, c0, ...]. */
  triangles: Uint32Array;
  /** Vetores normais unitários por vértice: [nx0, ny0, nz0, ...]. */
  normals: Float32Array;
  vertexCount: number;
  triangleCount: number;
  /** Limites físicos [minX, maxX, minY, maxY, minZ, maxZ], ou null quando vazia. */
  bounds: [number, number, number, number, number, number] | null;
}

export interface OpcoesSuperficie3d {
  /** Pares de suavização Taubin (+lambda / -mu). Padrão 3; 0 desativa. */
  suavizacao?: number;
  /** Fator lambda de suavização (0 < lambda < 0.7). Padrão 0.45. */
  lambda?: number;
  /** Bounding box pré-computado `[minI, maxI, minJ, maxJ, minK, maxK]` para evitar nova varredura completa. */
  boundsIjk?: readonly [number, number, number, number, number, number];
}

const PADRAO_SUAVIZACAO = 3;
const PADRAO_LAMBDA = 0.45;

/** 12 arestas de um cubo unitário, indexando os 8 vértices `c = dx + 2*dy + 4*dz`. */
const ARESTAS_CUBO: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const MALHA_VAZIA: MalhaSuperficie3d = {
  positions: new Float32Array(0),
  triangles: new Uint32Array(0),
  normals: new Float32Array(0),
  vertexCount: 0,
  triangleCount: 0,
  bounds: null,
};

/** Calcula normais suaves ponderadas pela área dos triângulos para cada vértice. */
export function calcularNormaisVertices(positions: Float32Array, triangles: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const ia = triangles[t]! * 3;
    const ib = triangles[t + 1]! * 3;
    const ic = triangles[t + 2]! * 3;
    const ax = positions[ia]!;
    const ay = positions[ia + 1]!;
    const az = positions[ia + 2]!;
    const abx = positions[ib]! - ax;
    const aby = positions[ib + 1]! - ay;
    const abz = positions[ib + 2]! - az;
    const acx = positions[ic]! - ax;
    const acy = positions[ic + 1]! - ay;
    const acz = positions[ic + 2]! - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia]! += nx;
    normals[ia + 1]! += ny;
    normals[ia + 2]! += nz;
    normals[ib]! += nx;
    normals[ib + 1]! += ny;
    normals[ib + 2]! += nz;
    normals[ic]! += nx;
    normals[ic + 1]! += ny;
    normals[ic + 2]! += nz;
  }
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v]!;
    const y = normals[v + 1]!;
    const z = normals[v + 2]!;
    const mag = Math.hypot(x, y, z);
    if (mag > 1e-12) {
      normals[v] = x / mag;
      normals[v + 1] = y / mag;
      normals[v + 2] = z / mag;
    } else {
      normals[v] = 0;
      normals[v + 1] = 0;
      normals[v + 2] = 1;
    }
  }
  return normals;
}

/** Suavização Taubin (+lambda seguido de -mu) em coordenadas físicas, preservando o volume. */
function suavizarTaubin(
  positions: Float32Array,
  triangles: Uint32Array,
  pares: number,
  lambda: number,
): void {
  const nVerts = Math.floor(positions.length / 3);
  if (nVerts === 0 || pares <= 0 || lambda <= 0) return;

  const head = new Int32Array(nVerts).fill(-1);
  const maxEdges = triangles.length * 2;
  const to = new Int32Array(maxEdges);
  const next = new Int32Array(maxEdges);
  const deg = new Uint16Array(nVerts);
  let edgeCount = 0;

  const adicionar = (u: number, v: number): void => {
    let cur = head[u]!;
    while (cur >= 0) {
      if (to[cur] === v) return;
      cur = next[cur]!;
    }
    to[edgeCount] = v;
    next[edgeCount] = head[u]!;
    head[u] = edgeCount++;
    deg[u] = deg[u]! + 1;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]!;
    const b = triangles[t + 1]!;
    const c = triangles[t + 2]!;
    adicionar(a, b);
    adicionar(b, a);
    adicionar(b, c);
    adicionar(c, b);
    adicionar(c, a);
    adicionar(a, c);
  }

  const scratch = new Float32Array(positions.length);
  const mu = -(lambda + 0.02);

  const passo = (fator: number): void => {
    scratch.set(positions);
    for (let v = 0; v < nVerts; v++) {
      const k = deg[v]!;
      if (k === 0) continue;
      const base = v * 3;
      const vx = positions[base]!;
      const vy = positions[base + 1]!;
      const vz = positions[base + 2]!;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let e = head[v]!; e >= 0; e = next[e]!) {
        const vb = to[e]! * 3;
        sx += positions[vb]! - vx;
        sy += positions[vb + 1]! - vy;
        sz += positions[vb + 2]! - vz;
      }
      const inv = fator / k;
      scratch[base] = vx + sx * inv;
      scratch[base + 1] = vy + sy * inv;
      scratch[base + 2] = vz + sz * inv;
    }
    positions.set(scratch);
  };

  for (let p = 0; p < pares; p++) {
    passo(lambda);
    passo(mu);
  }
}

function calcularBounds(positions: Float32Array): [number, number, number, number, number, number] | null {
  if (positions.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, maxX, minY, maxY, minZ, maxZ];
}

/**
 * Gera a superfície poligonal 3D para o segmento `segmentIndex` do labelmap `rotulos`
 * usando Surface Nets 3D + suavização Taubin no espaço físico definido por `grid`.
 */
export function gerarSuperficieSegmento(
  rotulos: ArrayLike<number>,
  grid: VolumeGrid,
  segmentIndex: number,
  opcoes: OpcoesSuperficie3d = {},
): MalhaSuperficie3d {
  const [nx, ny, nz] = grid.dims;
  const porCorte = nx * ny;
  if (nx <= 0 || ny <= 0 || nz <= 0 || rotulos.length < porCorte * nz) return MALHA_VAZIA;

  let minI: number;
  let maxI: number;
  let minJ: number;
  let maxJ: number;
  let minK: number;
  let maxK: number;

  if (opcoes.boundsIjk) {
    [minI, maxI, minJ, maxJ, minK, maxK] = opcoes.boundsIjk;
  } else {
    minI = nx;
    maxI = -1;
    minJ = ny;
    maxJ = -1;
    minK = nz;
    maxK = -1;

    for (let k = 0; k < nz; k++) {
      const baseK = k * porCorte;
      for (let j = 0; j < ny; j++) {
        const baseJ = baseK + j * nx;
        for (let i = 0; i < nx; i++) {
          if (rotulos[baseJ + i] !== segmentIndex) continue;
          if (i < minI) minI = i;
          if (i > maxI) maxI = i;
          if (j < minJ) minJ = j;
          if (j > maxJ) maxJ = j;
          if (k < minK) minK = k;
          if (k > maxK) maxK = k;
        }
      }
    }
  }

  if (maxI < minI || maxI < 0 || maxJ < minJ || maxK < minK) return MALHA_VAZIA;

  const subX = maxI - minI + 2;
  const subY = maxJ - minJ + 2;
  const subZ = maxK - minK + 2;
  const cellVertIds = new Int32Array(subX * subY * subZ).fill(-1);

  const dentro = (i: number, j: number, k: number): boolean =>
    i >= minI &&
    i <= maxI &&
    j >= minJ &&
    j <= maxJ &&
    k >= minK &&
    k <= maxK &&
    rotulos[i + j * nx + k * porCorte] === segmentIndex;

  const verts: number[] = [];

  for (let lz = 0; lz < subZ; lz++) {
    const cz = minK - 1 + lz;
    for (let ly = 0; ly < subY; ly++) {
      const cy = minJ - 1 + ly;
      for (let lx = 0; lx < subX; lx++) {
        const cx = minI - 1 + lx;
        let mask = 0;
        for (let b = 0; b < 8; b++) {
          if (dentro(cx + (b & 1), cy + ((b >> 1) & 1), cz + ((b >> 2) & 1))) {
            mask |= 1 << b;
          }
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let cruza = 0;
        for (let e = 0; e < 12; e++) {
          const [c0, c1] = ARESTAS_CUBO[e]!;
          if (((mask >> c0) & 1) === ((mask >> c1) & 1)) continue;
          sx += ((c0 & 1) + (c1 & 1)) * 0.5;
          sy += (((c0 >> 1) & 1) + ((c1 >> 1) & 1)) * 0.5;
          sz += (((c0 >> 2) & 1) + ((c1 >> 2) & 1)) * 0.5;
          cruza++;
        }

        const p = voxelToWorld(grid, [cx + sx / cruza, cy + sy / cruza, cz + sz / cruza]);
        const vid = verts.length / 3;
        verts.push(p[0], p[1], p[2]);
        cellVertIds[lx + ly * subX + lz * subX * subY] = vid;
      }
    }
  }

  if (verts.length === 0) return MALHA_VAZIA;

  const inverterSentido = dot(grid.stepI, cross(grid.stepJ, grid.stepK)) < 0;
  const tris: number[] = [];
  const cellAt = (lx: number, ly: number, lz: number): number => cellVertIds[lx + ly * subX + lz * subX * subY]!;

  const emitirQuad = (v0: number, v1: number, v2: number, v3: number, flip: boolean): void => {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip === inverterSentido) {
      tris.push(v0, v1, v2, v0, v2, v3);
    } else {
      tris.push(v0, v2, v1, v0, v3, v2);
    }
  };

  // Arestas paralelas ao eixo X
  for (let vz = minK; vz <= maxK; vz++) {
    const lz1 = vz - (minK - 1);
    const lz0 = lz1 - 1;
    for (let vy = minJ; vy <= maxJ; vy++) {
      const ly1 = vy - (minJ - 1);
      const ly0 = ly1 - 1;
      for (let vx = minI - 1; vx <= maxI; vx++) {
        const a = dentro(vx, vy, vz);
        const b = dentro(vx + 1, vy, vz);
        if (a === b) continue;
        const lx = vx - (minI - 1);
        emitirQuad(
          cellAt(lx, ly0, lz0),
          cellAt(lx, ly1, lz0),
          cellAt(lx, ly1, lz1),
          cellAt(lx, ly0, lz1),
          !a,
        );
      }
    }
  }

  // Arestas paralelas ao eixo Y
  for (let vz = minK; vz <= maxK; vz++) {
    const lz1 = vz - (minK - 1);
    const lz0 = lz1 - 1;
    for (let vx = minI; vx <= maxI; vx++) {
      const lx1 = vx - (minI - 1);
      const lx0 = lx1 - 1;
      for (let vy = minJ - 1; vy <= maxJ; vy++) {
        const a = dentro(vx, vy, vz);
        const b = dentro(vx, vy + 1, vz);
        if (a === b) continue;
        const ly = vy - (minJ - 1);
        emitirQuad(
          cellAt(lx0, ly, lz0),
          cellAt(lx0, ly, lz1),
          cellAt(lx1, ly, lz1),
          cellAt(lx1, ly, lz0),
          !a,
        );
      }
    }
  }

  // Arestas paralelas ao eixo Z
  for (let vy = minJ; vy <= maxJ; vy++) {
    const ly1 = vy - (minJ - 1);
    const ly0 = ly1 - 1;
    for (let vx = minI; vx <= maxI; vx++) {
      const lx1 = vx - (minI - 1);
      const lx0 = lx1 - 1;
      for (let vz = minK - 1; vz <= maxK; vz++) {
        const a = dentro(vx, vy, vz);
        const b = dentro(vx, vy, vz + 1);
        if (a === b) continue;
        const lz = vz - (minK - 1);
        emitirQuad(
          cellAt(lx0, ly0, lz),
          cellAt(lx1, ly0, lz),
          cellAt(lx1, ly1, lz),
          cellAt(lx0, ly1, lz),
          !a,
        );
      }
    }
  }

  const positions = Float32Array.from(verts);
  const triangles = Uint32Array.from(tris);
  const pares = opcoes.suavizacao ?? PADRAO_SUAVIZACAO;
  const lambda = opcoes.lambda ?? PADRAO_LAMBDA;
  if (pares > 0 && triangles.length > 0) suavizarTaubin(positions, triangles, pares, lambda);
  const normals = calcularNormaisVertices(positions, triangles);

  return {
    positions,
    triangles,
    normals,
    vertexCount: Math.floor(positions.length / 3),
    triangleCount: Math.floor(triangles.length / 3),
    bounds: calcularBounds(positions),
  };
}

/** Converte `[a, b, c, ...]` para o formato `vtkCellArray` `[3, a, b, c, ...]`. */
export function paraPolysVtk(triangles: Uint32Array): Uint32Array {
  const nTris = Math.floor(triangles.length / 3);
  const polys = new Uint32Array(nTris * 4);
  for (let t = 0; t < nTris; t++) {
    const dst = t * 4;
    const src = t * 3;
    polys[dst] = 3;
    polys[dst + 1] = triangles[src]!;
    polys[dst + 2] = triangles[src + 1]!;
    polys[dst + 3] = triangles[src + 2]!;
  }
  return polys;
}

function formatarAssinatura(count: number, hash: number, grid: VolumeGrid, opcoes: OpcoesSuperficie3d): string {
  const pares = opcoes.suavizacao ?? PADRAO_SUAVIZACAO;
  const lambda = opcoes.lambda ?? PADRAO_LAMBDA;
  return [
    count,
    hash >>> 0,
    grid.dims.join(','),
    grid.origin.map((x) => x.toFixed(4)).join(','),
    grid.stepI.map((x) => x.toFixed(4)).join(','),
    grid.stepJ.map((x) => x.toFixed(4)).join(','),
    grid.stepK.map((x) => x.toFixed(4)).join(','),
    pares,
    lambda,
  ].join('|');
}

/** Assinatura determinística do conjunto de voxels do segmento + grade física. */
export function assinaturaDoSegmento(
  rotulos: ArrayLike<number>,
  grid: VolumeGrid,
  segmentIndex: number,
  opcoes: OpcoesSuperficie3d = {},
): string {
  const total = grid.dims[0] * grid.dims[1] * grid.dims[2];
  const n = Math.min(rotulos.length, total);
  let count = 0;
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < n; i++) {
    if (rotulos[i] !== segmentIndex) continue;
    count++;
    hash ^= i >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return formatarAssinatura(count, hash, grid, opcoes);
}

export interface ResumoSegmentoLote {
  assinatura: string;
  count: number;
  boundsIjk: [number, number, number, number, number, number];
}

export function inspecionarSegmentosLote(
  rotulos: ArrayLike<number>,
  grid: VolumeGrid,
  segmentIndices: readonly number[],
  opcoes: OpcoesSuperficie3d,
): Map<number, ResumoSegmentoLote> {
  const [nx, ny, nz] = grid.dims;
  const porCorte = nx * ny;
  const total = porCorte * nz;
  const unicos: number[] = [];
  const mapaSlot = new Map<number, number>();
  let maxIdx = 0;
  for (const idx of segmentIndices) {
    if (idx <= 0 || mapaSlot.has(idx)) continue;
    mapaSlot.set(idx, unicos.length);
    unicos.push(idx);
    if (idx > maxIdx) maxIdx = idx;
  }

  const m = unicos.length;
  const counts = new Int32Array(m);
  const hashes = new Uint32Array(m).fill(2166136261);
  const minIs = new Int32Array(m).fill(nx);
  const maxIs = new Int32Array(m).fill(-1);
  const minJs = new Int32Array(m).fill(ny);
  const maxJs = new Int32Array(m).fill(-1);
  const minKs = new Int32Array(m).fill(nz);
  const maxKs = new Int32Array(m).fill(-1);

  const usaTabela = maxIdx <= 4095;
  let tabela: Int32Array | null = null;
  if (usaTabela) {
    tabela = new Int32Array(maxIdx + 1).fill(-1);
    for (let s = 0; s < m; s++) tabela[unicos[s]!] = s;
  }

  if (m > 0 && rotulos.length >= total) {
    for (let k = 0; k < nz; k++) {
      const baseK = k * porCorte;
      for (let j = 0; j < ny; j++) {
        const baseJ = baseK + j * nx;
        for (let i = 0; i < nx; i++) {
          const idx = baseJ + i;
          const v = rotulos[idx]!;
          if (v === 0) continue;
          const slot = tabela
            ? v > 0 && v < tabela.length
              ? tabela[v]!
              : -1
            : (mapaSlot.get(v) ?? -1);
          if (slot < 0) continue;

          counts[slot] = counts[slot]! + 1;
          let h = hashes[slot]! ^ (idx >>> 0);
          hashes[slot] = Math.imul(h, 16777619) >>> 0;
          if (i < minIs[slot]!) minIs[slot] = i;
          if (i > maxIs[slot]!) maxIs[slot] = i;
          if (j < minJs[slot]!) minJs[slot] = j;
          if (j > maxJs[slot]!) maxJs[slot] = j;
          if (k < minKs[slot]!) minKs[slot] = k;
          if (k > maxKs[slot]!) maxKs[slot] = k;
        }
      }
    }
  } else if (m > 0) {
    const n = Math.min(rotulos.length, total);
    for (let idx = 0; idx < n; idx++) {
      const v = rotulos[idx]!;
      if (v === 0) continue;
      const slot = mapaSlot.get(v) ?? -1;
      if (slot < 0) continue;
      counts[slot] = counts[slot]! + 1;
      hashes[slot] = Math.imul(hashes[slot]! ^ (idx >>> 0), 16777619) >>> 0;
    }
  }

  const saida = new Map<number, ResumoSegmentoLote>();
  for (let s = 0; s < m; s++) {
    const segIdx = unicos[s]!;
    saida.set(segIdx, {
      assinatura: formatarAssinatura(counts[s]!, hashes[s]!, grid, opcoes),
      count: counts[s]!,
      boundsIjk: [minIs[s]!, maxIs[s]!, minJs[s]!, maxJs[s]!, minKs[s]!, maxKs[s]!],
    });
  }
  return saida;
}

interface EntradaCache {
  assinatura: string;
  malha: MalhaSuperficie3d;
  sujo: boolean;
}

/**
 * Cache de malhas 3D por `(pilhaId, segmentIndex)`.
 * Permite pular reconstruções quando o segmento não teve seus voxels editados.
 */
export class CacheSuperficie3d {
  private entradas = new Map<string, EntradaCache>();

  private chave(pilhaId: string, segmentIndex: number): string {
    return `${pilhaId}::${segmentIndex}`;
  }

  /** Retorna a malha em cache em O(1) se não estiver suja (sem ler voxels do volume). */
  obterSeLimpo(pilhaId: string, segmentIndex: number): { malha: MalhaSuperficie3d; doCache: true } | undefined {
    const atual = this.entradas.get(this.chave(pilhaId, segmentIndex));
    if (atual && !atual.sujo) {
      return { malha: atual.malha, doCache: true };
    }
    return undefined;
  }

  marcarSujo(pilhaId: string, segmentIndex?: number): void {
    if (segmentIndex !== undefined) {
      const e = this.entradas.get(this.chave(pilhaId, segmentIndex));
      if (e) e.sujo = true;
      return;
    }
    const prefixo = `${pilhaId}::`;
    for (const [k, e] of this.entradas) {
      if (k.startsWith(prefixo)) e.sujo = true;
    }
  }

  removerSegmento(pilhaId: string, segmentIndex: number): void {
    this.entradas.delete(this.chave(pilhaId, segmentIndex));
  }

  removerPilha(pilhaId: string): void {
    const prefixo = `${pilhaId}::`;
    for (const k of this.entradas.keys()) {
      if (k.startsWith(prefixo)) this.entradas.delete(k);
    }
  }

  limpar(): void {
    this.entradas.clear();
  }

  obter(
    pilhaId: string,
    rotulos: ArrayLike<number>,
    grid: VolumeGrid,
    segmentIndex: number,
    opcoes: OpcoesSuperficie3d = {},
  ): { malha: MalhaSuperficie3d; doCache: boolean } {
    const limpo = this.obterSeLimpo(pilhaId, segmentIndex);
    if (limpo) return limpo;
    return this.obterLote(pilhaId, rotulos, grid, [segmentIndex], opcoes).get(segmentIndex) ?? {
      malha: MALHA_VAZIA,
      doCache: false,
    };
  }

  /**
   * Obtém (ou reconstrói em lote único) as malhas de vários segmentos sujos, calculando
   * todas as assinaturas e bounding boxes em uma única passada sobre `rotulos`.
   */
  obterLote(
    pilhaId: string,
    rotulos: ArrayLike<number>,
    grid: VolumeGrid,
    segmentIndices: readonly number[],
    opcoes: OpcoesSuperficie3d = {},
  ): Map<number, { malha: MalhaSuperficie3d; doCache: boolean }> {
    const resultado = new Map<number, { malha: MalhaSuperficie3d; doCache: boolean }>();
    const pendentes: number[] = [];

    for (const idx of segmentIndices) {
      const limpo = this.obterSeLimpo(pilhaId, idx);
      if (limpo) {
        resultado.set(idx, limpo);
      } else {
        pendentes.push(idx);
      }
    }

    if (pendentes.length === 0) return resultado;

    const resumos = inspecionarSegmentosLote(rotulos, grid, pendentes, opcoes);
    for (const segIdx of pendentes) {
      const resumo = resumos.get(segIdx);
      if (!resumo) {
        resultado.set(segIdx, { malha: MALHA_VAZIA, doCache: false });
        continue;
      }
      const k = this.chave(pilhaId, segIdx);
      const atual = this.entradas.get(k);
      if (atual && atual.assinatura === resumo.assinatura) {
        atual.sujo = false;
        resultado.set(segIdx, { malha: atual.malha, doCache: true });
        continue;
      }
      const malha =
        resumo.count === 0
          ? MALHA_VAZIA
          : gerarSuperficieSegmento(rotulos, grid, segIdx, { ...opcoes, boundsIjk: resumo.boundsIjk });
      this.entradas.set(k, { assinatura: resumo.assinatura, malha, sujo: false });
      resultado.set(segIdx, { malha, doCache: false });
    }

    return resultado;
  }
}
