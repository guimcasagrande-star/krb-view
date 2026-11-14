/**
 * Contas puras da segmentação (sem navegador nem Cornerstone), testadas em `tests/mascaras.test.ts`:
 *
 * - `crescerNaEsfera`: crescimento de região contido numa esfera em torno do clique. O
 *   `regionGrow` de `voxelStats` cresce sem limite e, em TC, vaza de um órgão para todos os
 *   vizinhos de densidade parecida; aqui o usuário controla até onde vai (o raio).
 * - `faixaPelaSemente`: faixa de valores tirada da vizinhança do clique, em vez de um ± fixo.
 * - `buracosFechados`: pixels cercados pelo segmento num corte (o miolo de um contorno).
 * - `interpolarCortes`: formas intermediárias entre dois cortes pintados, para o segmento virar
 *   um volume só (interpolação pela distância à borda, como nos programas de contorno).
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

const LONGE = 1e12;

/** Transformada de distância ao quadrado em 1D (Felzenszwalb e Huttenlocher). */
function distancia1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = 0;
    for (;;) {
      const p = v[k]!;
      s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
      if (s > z[k]! || k === 0) break;
      k--;
    }
    if (s <= z[k]!) {
      // A parábola de q cobre todas as anteriores.
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      k = 0;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/** Distância ao quadrado de cada pixel ao pixel mais próximo com `alvo` = `valor`. */
function distanciaQuadrada(alvo: Uint8Array, valor: number, nu: number, nv: number): Float64Array {
  const d = new Float64Array(nu * nv);
  for (let p = 0; p < d.length; p++) d[p] = alvo[p] === valor ? 0 : LONGE;
  const maior = Math.max(nu, nv);
  const f = new Float64Array(maior);
  const r = new Float64Array(maior);
  const v = new Int32Array(maior);
  const z = new Float64Array(maior + 1);
  for (let u = 0; u < nu; u++) {
    for (let w = 0; w < nv; w++) f[w] = d[u + w * nu]!;
    distancia1d(f, nv, r, v, z);
    for (let w = 0; w < nv; w++) d[u + w * nu] = r[w]!;
  }
  for (let w = 0; w < nv; w++) {
    for (let u = 0; u < nu; u++) f[u] = d[u + w * nu]!;
    distancia1d(f, nu, r, v, z);
    for (let u = 0; u < nu; u++) d[u + w * nu] = r[u]!;
  }
  return d;
}

/** Distância à borda da forma, em pixels: negativa dentro, positiva fora. */
export function distanciaAssinada(forma: Uint8Array, nu: number, nv: number): Float32Array {
  const ateDentro = distanciaQuadrada(forma, 1, nu, nv);
  const ateFora = distanciaQuadrada(forma, 0, nu, nv);
  const sd = new Float32Array(nu * nv);
  for (let p = 0; p < sd.length; p++) {
    sd[p] = forma[p] === 1 ? 0.5 - Math.sqrt(ateFora[p]!) : Math.sqrt(ateDentro[p]!) - 0.5;
  }
  return sd;
}

/**
 * `n` formas intermediárias entre os cortes `a` e `b` (1 = dentro), da mais próxima de `a` à mais
 * próxima de `b`. Cada uma é onde a distância à borda, interpolada entre os dois cortes, é
 * negativa: discos de raios diferentes viram um cone, formas iguais continuam iguais.
 *
 * As duas formas são alinhadas pelo centro antes da conta, e o centro da forma intermediária
 * anda em linha reta de um corte ao outro. Sem isso, uma estrutura que muda de lugar entre os
 * cortes (um vaso oblíquo) sumiria no meio do caminho.
 */
export function interpolarCortes(a: Uint8Array, b: Uint8Array, nu: number, nv: number, n: number): Uint8Array[] {
  const sa = distanciaAssinada(a, nu, nv);
  const sb = distanciaAssinada(b, nu, nv);
  const ca = centroDaForma(a, nu, nv);
  const cb = centroDaForma(b, nu, nv);
  // Lê a distância num ponto qualquer; fora do corte vale a da borda mais próxima.
  const ler = (sd: Float32Array, u: number, v: number): number => {
    const uu = Math.min(nu - 1, Math.max(0, Math.round(u)));
    const vv = Math.min(nv - 1, Math.max(0, Math.round(v)));
    return sd[uu + vv * nu]!;
  };
  const saida: Uint8Array[] = [];
  for (let m = 1; m <= n; m++) {
    const t = m / (n + 1);
    const cu = (1 - t) * ca[0] + t * cb[0];
    const cv = (1 - t) * ca[1] + t * cb[1];
    const forma = new Uint8Array(nu * nv);
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) {
        const da = ler(sa, u - cu + ca[0], v - cv + ca[1]);
        const db = ler(sb, u - cu + cb[0], v - cv + cb[1]);
        if ((1 - t) * da + t * db < 0) forma[u + v * nu] = 1;
      }
    }
    saida.push(forma);
  }
  return saida;
}

/** Centro (média das posições) dos pixels da forma; o meio do corte se ela estiver vazia. */
function centroDaForma(forma: Uint8Array, nu: number, nv: number): [number, number] {
  let su = 0;
  let sv = 0;
  let n = 0;
  for (let p = 0; p < forma.length; p++) {
    if (forma[p] !== 1) continue;
    su += p % nu;
    sv += Math.floor(p / nu);
    n++;
  }
  return n > 0 ? [su / n, sv / n] : [nu / 2, nv / 2];
}
