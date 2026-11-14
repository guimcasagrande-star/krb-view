import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import { buracosFechados, crescerNaEsfera, faixaPelaSemente } from '../src/segmentation/mascaras';

/** Grade 60×60×60 com voxels de 1 mm. */
const N = 60;
const grid: VolumeGrid = {
  dims: [N, N, N],
  origin: [0, 0, 0],
  stepI: [1, 0, 0],
  stepJ: [0, 1, 0],
  stepK: [0, 0, 1],
  spacing: [1, 1, 1],
};
const idx = (i: number, j: number, k: number): number => i + j * N + k * N * N;

/**
 * "Corpo" a 40 HU em tudo, uma lesão esférica a 80 HU (raio 10, centro 20,30,30) e um "órgão"
 * grande a 55 HU encostado no corpo (i ≥ 40): com ± 50 HU fixos tudo isso seria uma coisa só.
 */
function phantom(): Float32Array {
  const d = new Float32Array(N * N * N).fill(40);
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if ((i - 20) ** 2 + (j - 30) ** 2 + (k - 30) ** 2 <= 100) d[idx(i, j, k)] = 80;
        else if (i >= 40) d[idx(i, j, k)] = 55;
      }
    }
  }
  return d;
}

describe('crescer região contido', () => {
  const data = phantom();
  const volume = { data, grid };

  it('a faixa vem da vizinhança do clique e separa a lesão do corpo', () => {
    const f = faixaPelaSemente(volume, [20, 30, 30], 'tc');
    expect(f.min).toBeCloseTo(65, 6);
    expect(f.max).toBeCloseTo(95, 6);
    const corpo = faixaPelaSemente(volume, [5, 5, 5], 'tc');
    expect(corpo.max).toBeLessThan(80);
  });

  it('no PET a faixa começa em metade do valor do clique', () => {
    expect(faixaPelaSemente(volume, [20, 30, 30], 'pet')).toEqual({ min: 40, max: Infinity });
  });

  it('com raio maior que a lesão pega a lesão inteira e nada mais', () => {
    const f = faixaPelaSemente(volume, [20, 30, 30], 'tc');
    const r = crescerNaEsfera(volume, [20, 30, 30], { ...f, raioMm: 25 });
    let esperados = 0;
    for (let n = 0; n < data.length; n++) if (data[n] === 80) esperados++;
    expect(r.indices.length).toBe(esperados);
    for (const n of r.indices) expect(data[n]).toBe(80);
  });

  it('cresce aos poucos: raio maior, região maior, sempre dentro do raio', () => {
    // No corpo (40 HU), com faixa larga o bastante para incluir o órgão vizinho (55 HU).
    const faixa = { min: 30, max: 60 };
    const pequeno = crescerNaEsfera(volume, [5, 30, 30], { ...faixa, raioMm: 4 });
    const grande = crescerNaEsfera(volume, [5, 30, 30], { ...faixa, raioMm: 8 });
    expect(pequeno.indices.length).toBeGreaterThan(0);
    expect(grande.indices.length).toBeGreaterThan(pequeno.indices.length);
    for (const n of grande.indices) {
      const i = n % N;
      const j = Math.floor(n / N) % N;
      const k = Math.floor(n / (N * N));
      expect((i - 5) ** 2 + (j - 30) ** 2 + (k - 30) ** 2).toBeLessThanOrEqual(64);
    }
    // Volume de uma esfera de raio 8 mm cortada pela borda do volume: no máximo 4/3·π·8³.
    expect(grande.indices.length).toBeLessThanOrEqual(Math.ceil((4 / 3) * Math.PI * 8 ** 3 * 1.05));
  });

  it('respeita voxels anisotrópicos (raio em mm, não em voxels)', () => {
    const g: VolumeGrid = { ...grid, spacing: [1, 1, 3], stepK: [0, 0, 3] };
    const tudo = new Float32Array(N * N * N).fill(40);
    const r = crescerNaEsfera({ data: tudo, grid: g }, [30, 30, 30], { min: 0, max: 100, raioMm: 6 });
    let maxK = 0;
    let maxI = 0;
    for (const n of r.indices) {
      maxI = Math.max(maxI, Math.abs((n % N) - 30));
      maxK = Math.max(maxK, Math.abs(Math.floor(n / (N * N)) - 30));
    }
    expect(maxI).toBe(6);
    expect(maxK).toBe(2);
  });

  it('semente fora da faixa ou do volume devolve região vazia', () => {
    expect(crescerNaEsfera(volume, [20, 30, 30], { min: 0, max: 50, raioMm: 10 }).indices.length).toBe(0);
    expect(crescerNaEsfera(volume, [-1, 0, 0], { min: 0, max: 100, raioMm: 10 }).indices.length).toBe(0);
  });
});

describe('buracos fechados no corte', () => {
  it('acha o miolo de um contorno fechado e ignora o contorno aberto', () => {
    const nu = 12;
    const nv = 10;
    const m = new Uint8Array(nu * nv);
    const p = (u: number, v: number): number => u + v * nu;
    // Anel fechado 5×5 em (1..5, 1..5): miolo 3×3.
    for (let t = 1; t <= 5; t++) {
      m[p(t, 1)] = 1;
      m[p(t, 5)] = 1;
      m[p(1, t)] = 1;
      m[p(5, t)] = 1;
    }
    // Anel com uma falha em (7..10, 1..4): não é buraco.
    for (let t = 7; t <= 10; t++) {
      m[p(t, 1)] = 1;
      m[p(t, 4)] = 1;
    }
    m[p(7, 2)] = 1;
    m[p(7, 3)] = 1;
    m[p(10, 2)] = 1; // falta (10, 3): aberto
    const b = buracosFechados(m, nu, nv);
    let total = 0;
    for (const x of b) total += x;
    expect(total).toBe(9);
    expect(b[p(3, 3)]).toBe(1);
    expect(b[p(8, 2)]).toBe(0);
    expect(b[p(0, 0)]).toBe(0);
  });

  it('corte todo vazio ou todo pintado não tem buraco', () => {
    expect(buracosFechados(new Uint8Array(16), 4, 4).some((x) => x === 1)).toBe(false);
    expect(buracosFechados(new Uint8Array(16).fill(1), 4, 4).some((x) => x === 1)).toBe(false);
  });
});
