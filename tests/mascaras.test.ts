import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import {
  buracosFechados,
  crescerNaEsfera,
  distanciaAssinada,
  faixaPelaSemente,
  interpolarCortes,
} from '../src/segmentation/mascaras';

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

describe('interpolação entre cortes', () => {
  const nu = 41;
  const nv = 41;
  const disco = (cu: number, cv: number, raio: number): Uint8Array => {
    const m = new Uint8Array(nu * nv);
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) if ((u - cu) ** 2 + (v - cv) ** 2 <= raio * raio) m[u + v * nu] = 1;
    }
    return m;
  };
  const area = (m: Uint8Array): number => m.reduce((s, x) => s + x, 0);

  it('a distância assinada é negativa dentro, positiva fora e vale o raio no centro', () => {
    const sd = distanciaAssinada(disco(20, 20, 8), nu, nv);
    expect(sd[20 + 20 * nu]).toBeLessThan(-7);
    expect(sd[20 + 20 * nu]).toBeGreaterThan(-9.5);
    expect(sd[0]).toBeGreaterThan(15);
    // Confere com a força bruta num ponto de fora.
    let menor = Infinity;
    const m = disco(20, 20, 8);
    for (let v = 0; v < nv; v++) {
      for (let u = 0; u < nu; u++) if (m[u + v * nu]) menor = Math.min(menor, Math.hypot(u - 35, v - 5));
    }
    expect(sd[35 + 5 * nu]).toBeCloseTo(menor - 0.5, 4);
  });

  it('entre um disco pequeno e um grande os cortes crescem aos poucos', () => {
    const a = disco(20, 20, 4);
    const b = disco(20, 20, 12);
    const meio = interpolarCortes(a, b, nu, nv, 3);
    expect(meio).toHaveLength(3);
    const areas = [area(a), ...meio.map(area), area(b)];
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThan(areas[i - 1]!);
    // O corte do meio tem raio perto de 8 (área perto de π·8²).
    expect(Math.abs(areas[2]! - Math.PI * 64)).toBeLessThan(25);
    // E contém o disco pequeno.
    for (let p = 0; p < a.length; p++) if (a[p]) expect(meio[1]![p]).toBe(1);
  });

  it('formas iguais continuam iguais', () => {
    const a = disco(15, 22, 6);
    const [meio] = interpolarCortes(a, a, nu, nv, 1);
    expect(Array.from(meio!)).toEqual(Array.from(a));
  });

  it('disco deslocado: o corte do meio fica entre as duas posições', () => {
    const [meio] = interpolarCortes(disco(12, 20, 6), disco(28, 20, 6), nu, nv, 1);
    expect(meio![20 + 20 * nu]).toBe(1);
    expect(meio![6 + 20 * nu]).toBe(0);
    expect(meio![34 + 20 * nu]).toBe(0);
  });
});
