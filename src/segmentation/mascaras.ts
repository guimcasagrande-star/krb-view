/**
 * Contas puras da segmentação (sem navegador nem Cornerstone), testadas em `tests/mascaras.test.ts`:
 *
 * - `crescerNaEsfera`: crescimento de região contido numa esfera em torno do clique. O
 *   `regionGrow` de `voxelStats` cresce sem limite e, em TC, vaza de um órgão para todos os
 *   vizinhos de densidade parecida; aqui o usuário controla até onde vai (o raio).
 * - `faixaPelaSemente`: faixa de valores tirada da vizinhança do clique, em vez de um ± fixo.
 * - `buracosFechados`: pixels cercados pelo segmento num corte (o miolo de um contorno).
 */

import type { ScalarVolume } from '../volume/voxelStats';

type Vec3 = [number, number, number];

export interface FaixaValores {
  min: number;
  max: number;
}

export type TipoDeValor = 'tc' | 'pet' | 'outro';

/**
 * Faixa de crescimento a partir dos 27 voxels em volta do clique.
 * - TC: média ± 2,5 desvios, com meia-largura entre 15 e 40 HU.
 * - PET: de metade do valor do clique para cima.
 * - Outros (RM): média ± 2,5 desvios, com meia-largura de pelo menos 15% da média.
 */
export function faixaPelaSemente(volume: ScalarVolume, semente: Vec3, tipo: TipoDeValor): FaixaValores {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const [si, sj, sk] = semente;
  const centro = data[si + sj * nx + sk * nx * ny]!;
  if (tipo === 'pet') return { min: centro * 0.5, max: Infinity };
  let soma = 0;
  let soma2 = 0;
  let n = 0;
  for (let k = Math.max(0, sk - 1); k <= Math.min(nz - 1, sk + 1); k++) {
    for (let j = Math.max(0, sj - 1); j <= Math.min(ny - 1, sj + 1); j++) {
      for (let i = Math.max(0, si - 1); i <= Math.min(nx - 1, si + 1); i++) {
        const v = data[i + j * nx + k * nx * ny]!;
        soma += v;
        soma2 += v * v;
        n++;
      }
    }
  }
  const media = soma / n;
  const dp = Math.sqrt(Math.max(0, soma2 / n - media * media));
  const meia =
    tipo === 'tc' ? Math.min(40, Math.max(15, 2.5 * dp)) : Math.max(2.5 * dp, 0.15 * Math.abs(media));
  // O valor do clique sempre fica dentro da faixa.
  return { min: Math.min(media - meia, centro), max: Math.max(media + meia, centro) };
}

export interface RegiaoCrescida {
  /** Índices lineares (i + j·nx + k·nx·ny) dos voxels da região, na grade do volume. */
  indices: Int32Array;
}

/**
 * Cresce a partir da semente pelos vizinhos de face com valor na faixa, sem sair da esfera de
 * `raioMm` em torno dela. Semente fora da faixa ou do volume devolve região vazia.
 */
export function crescerNaEsfera(
  volume: ScalarVolume,
  semente: Vec3,
  opcoes: FaixaValores & { raioMm: number },
): RegiaoCrescida {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const [sx, sy, sz] = grid.spacing;
  const [si, sj, sk] = semente;
  const vazio: RegiaoCrescida = { indices: new Int32Array(0) };
  if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) return vazio;
  const { min, max, raioMm } = opcoes;
  const fatia = nx * ny;
  const dentro = (idx: number): boolean => {
    const v = data[idx]!;
    return v >= min && v <= max;
  };
  if (!(raioMm > 0) || !dentro(si + sj * nx + sk * fatia)) return vazio;

  // Caixa que contém a esfera, cortada nos limites do volume.
  const ri = Math.ceil(raioMm / sx);
  const rj = Math.ceil(raioMm / sy);
  const rk = Math.ceil(raioMm / sz);
  const i0 = Math.max(0, si - ri);
  const j0 = Math.max(0, sj - rj);
  const k0 = Math.max(0, sk - rk);
  const ni = Math.min(nx - 1, si + ri) - i0 + 1;
  const nj = Math.min(ny - 1, sj + rj) - j0 + 1;
  const nk = Math.min(nz - 1, sk + rk) - k0 + 1;
  const visitado = new Uint8Array(ni * nj * nk);
  const raio2 = raioMm * raioMm;

  const fila: number[] = [];
  const achados: number[] = [];
  const entrar = (i: number, j: number, k: number): void => {
    if (i < i0 || j < j0 || k < k0 || i >= i0 + ni || j >= j0 + nj || k >= k0 + nk) return;
    const local = i - i0 + (j - j0) * ni + (k - k0) * ni * nj;
    if (visitado[local] === 1) return;
    visitado[local] = 1;
    const dx = (i - si) * sx;
    const dy = (j - sj) * sy;
    const dz = (k - sk) * sz;
    if (dx * dx + dy * dy + dz * dz > raio2) return;
    const idx = i + j * nx + k * fatia;
    if (!dentro(idx)) return;
    achados.push(idx);
    fila.push(i, j, k);
  };

  entrar(si, sj, sk);
  for (let p = 0; p < fila.length; p += 3) {
    const i = fila[p]!;
    const j = fila[p + 1]!;
    const k = fila[p + 2]!;
    entrar(i - 1, j, k);
    entrar(i + 1, j, k);
    entrar(i, j - 1, k);
    entrar(i, j + 1, k);
    entrar(i, j, k - 1);
    entrar(i, j, k + 1);
  }
  return { indices: Int32Array.from(achados) };
}

/**
 * Buracos de um corte: pixels fora do segmento (`dentro` = 0) que não alcançam a borda do corte
 * andando só por pixels fora do segmento (vizinhos de face). Devolve 1 nesses pixels.
 */
export function buracosFechados(dentro: Uint8Array, nu: number, nv: number): Uint8Array {
  const total = nu * nv;
  // 0 = não visitado, 1 = ligado à borda.
  const fora = new Uint8Array(total);
  const fila: number[] = [];
  const visitar = (p: number): void => {
    if (dentro[p] !== 0 || fora[p] === 1) return;
    fora[p] = 1;
    fila.push(p);
  };
  for (let u = 0; u < nu; u++) {
    visitar(u);
    visitar(u + (nv - 1) * nu);
  }
  for (let v = 0; v < nv; v++) {
    visitar(v * nu);
    visitar(nu - 1 + v * nu);
  }
  for (let q = 0; q < fila.length; q++) {
    const p = fila[q]!;
    const u = p % nu;
    if (u > 0) visitar(p - 1);
    if (u < nu - 1) visitar(p + 1);
    if (p >= nu) visitar(p - nu);
    if (p < total - nu) visitar(p + nu);
  }
  const buracos = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (dentro[p] === 0 && fora[p] === 0) buracos[p] = 1;
  }
  return buracos;
}
