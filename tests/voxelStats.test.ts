import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import type { Vec3 } from '../src/io/types';
import {
  PEAK_SPHERE_RADIUS_MM,
  indexToIjk,
  isocontour,
  lesionMetrics,
  maskStats,
  maskVolumeMl,
  peakInMask,
  regionGrow,
  sphereMask,
  thresholdMask,
  voxelIndex,
  type ScalarVolume,
} from '../src/volume/voxelStats';

function makeGrid(dims: [number, number, number], spacing: Vec3): VolumeGrid {
  return {
    dims,
    origin: [0, 0, 0],
    stepI: [spacing[0], 0, 0],
    stepJ: [0, spacing[1], 0],
    stepK: [0, 0, spacing[2]],
    spacing,
  };
}

/** Volume preenchido por uma função da posição em mm. */
function makeVolume(
  dims: [number, number, number],
  spacing: Vec3,
  value: (x: number, y: number, z: number) => number,
): ScalarVolume {
  const grid = makeGrid(dims, spacing);
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        data[voxelIndex(grid, i, j, k)] = value(i * spacing[0], j * spacing[1], k * spacing[2]);
      }
    }
  }
  return { data, grid };
}

const count = (mask: Uint8Array) => mask.reduce((n, v) => n + v, 0);

describe('índices', () => {
  it('vai e volta', () => {
    const grid = makeGrid([7, 5, 3], [1, 1, 1]);
    const idx = voxelIndex(grid, 4, 3, 2);
    expect(idx).toBe(4 + 3 * 7 + 2 * 35);
    expect(indexToIjk(grid, idx)).toEqual([4, 3, 2]);
  });
});

describe('sphereMask', () => {
  it('tem o volume de uma esfera', () => {
    const grid = makeGrid([80, 80, 80], [1, 1, 1]);
    const mask = sphereMask(grid, [40, 40, 40], 20);
    const expected = ((4 / 3) * Math.PI * 20 ** 3) / 1000;
    expect(maskVolumeMl(mask, grid)).toBeCloseTo(expected, 0);
    expect(Math.abs(maskVolumeMl(mask, grid) - expected) / expected).toBeLessThan(0.01);
  });
  it('é esférica em mm mesmo com voxel anisotrópico', () => {
    const grid = makeGrid([100, 100, 40], [1, 1, 5]);
    const mask = sphereMask(grid, [50, 50, 20], 20);
    const expected = ((4 / 3) * Math.PI * 20 ** 3) / 1000;
    expect(Math.abs(maskVolumeMl(mask, grid) - expected) / expected).toBeLessThan(0.03);
    // 20 mm de raio = 20 voxels em x e 4 voxels em z.
    expect(mask[voxelIndex(grid, 70, 50, 20)]).toBe(1);
    expect(mask[voxelIndex(grid, 71, 50, 20)]).toBe(0);
    expect(mask[voxelIndex(grid, 50, 50, 24)]).toBe(1);
    expect(mask[voxelIndex(grid, 50, 50, 25)]).toBe(0);
  });
  it('aceita centro fracionário e corta na borda do volume', () => {
    const grid = makeGrid([10, 10, 10], [1, 1, 1]);
    const mask = sphereMask(grid, [0.5, 0.5, 0.5], 1);
    // Centro entre 8 voxels, todos a sqrt(0,75) ≈ 0,87 mm.
    expect(count(mask)).toBe(8);
    expect(count(sphereMask(grid, [0, 0, 0], 3))).toBeLessThan(count(sphereMask(grid, [5, 5, 5], 3)));
    expect(count(sphereMask(grid, [50, 50, 50], 3))).toBe(0);
  });
});

describe('maskStats', () => {
  it('calcula as estatísticas básicas', () => {
    const grid = makeGrid([4, 1, 1], [2, 2, 5]);
    const volume: ScalarVolume = { data: Float32Array.from([1, 2, 3, 10]), grid };
    const stats = maskStats(volume, Uint8Array.from([1, 1, 1, 0]))!;
    expect(stats.count).toBe(3);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(3);
    expect(stats.mean).toBeCloseTo(2, 12);
    expect(stats.std).toBeCloseTo(Math.sqrt(2 / 3), 6);
    expect(stats.volumeMl).toBeCloseTo((3 * 20) / 1000, 12);
    expect(stats.maxIjk).toEqual([2, 0, 0]);
  });
  it('devolve undefined para máscara vazia', () => {
    const grid = makeGrid([2, 1, 1], [1, 1, 1]);
    expect(maskStats({ data: Float32Array.from([1, 2]), grid }, new Uint8Array(2))).toBeUndefined();
  });
  it('aplica fator único e fator por corte', () => {
    const grid = makeGrid([2, 1, 2], [1, 1, 1]);
    const volume: ScalarVolume = { data: Float32Array.from([1000, 2000, 1000, 2000]), grid };
    const all = Uint8Array.from([1, 1, 1, 1]);
    expect(maskStats(volume, all, { scale: 0.001 })!.max).toBeCloseTo(2, 6);
    const perSlice = maskStats(volume, all, { sliceScale: [0.001, 0.002] })!;
    expect(perSlice.max).toBeCloseTo(4, 6);
    expect(perSlice.maxIjk).toEqual([1, 0, 1]);
    expect(perSlice.mean).toBeCloseTo((1 + 2 + 2 + 4) / 4, 6);
  });
});

describe('peakInMask (SUVpico)', () => {
  it('o raio corresponde a 1 mL', () => {
    expect((4 / 3) * Math.PI * PEAK_SPHERE_RADIUS_MM ** 3).toBeCloseTo(1000, 6);
    expect(PEAK_SPHERE_RADIUS_MM).toBeCloseTo(6.2035, 4);
  });
  it('em lesão grande e homogênea, pico = valor da lesão', () => {
    const volume = makeVolume([50, 50, 50], [2, 2, 2], (x, y, z) =>
      Math.hypot(x - 50, y - 50, z - 50) <= 20 ? 8 : 1,
    );
    const region = sphereMask(volume.grid, [25, 25, 25], 30);
    const peak = peakInMask(volume, region)!;
    expect(peak.value).toBeCloseTo(8, 6);
    expect(peak.coarse).toBe(false);
  });
  it('em foco puntiforme, pico é bem menor que o máximo', () => {
    const volume = makeVolume([30, 30, 30], [2, 2, 2], () => 0);
    (volume.data as Float32Array)[voxelIndex(volume.grid, 15, 15, 15)] = 100;
    const region = sphereMask(volume.grid, [15, 15, 15], 10);

    // Contagem independente dos voxels dentro de 6,2 mm.
    let voxels = 0;
    for (let dk = -4; dk <= 4; dk++)
      for (let dj = -4; dj <= 4; dj++)
        for (let di = -4; di <= 4; di++)
          if (Math.hypot(di * 2, dj * 2, dk * 2) <= PEAK_SPHERE_RADIUS_MM) voxels++;

    const peak = peakInMask(volume, region)!;
    expect(peak.voxelsInSphere).toBe(voxels);
    expect(peak.value).toBeCloseTo(100 / voxels, 6);
    expect(maskStats(volume, region)!.max).toBe(100);
  });
  it('acha a esfera de maior média, que pode não estar no voxel máximo', () => {
    // Um voxel isolado muito quente e, longe dele, uma lesão extensa menos quente.
    const volume = makeVolume([60, 30, 30], [2, 2, 2], (x, y, z) =>
      Math.hypot(x - 90, y - 30, z - 30) <= 12 ? 6 : 0,
    );
    (volume.data as Float32Array)[voxelIndex(volume.grid, 8, 15, 15)] = 20;
    const everything = new Uint8Array(volume.data.length).fill(1);
    const peak = peakInMask(volume, everything)!;
    expect(maskStats(volume, everything)!.max).toBe(20);
    expect(peak.value).toBeCloseTo(6, 6);
    expect(peak.centerIjk[0]).toBeGreaterThan(35);
  });
  it('avisa quando o voxel é grande demais', () => {
    const volume = makeVolume([10, 10, 10], [8, 8, 8], () => 3);
    const peak = peakInMask(volume, sphereMask(volume.grid, [5, 5, 5], 10))!;
    expect(peak.coarse).toBe(true);
    expect(peak.value).toBeCloseTo(3, 6);
  });
  it('máscara vazia', () => {
    const volume = makeVolume([4, 4, 4], [2, 2, 2], () => 1);
    expect(peakInMask(volume, new Uint8Array(64))).toBeUndefined();
  });
});

describe('thresholdMask e regionGrow', () => {
  // Duas lesões separadas: A em x=20 mm e B em x=70 mm.
  const two = makeVolume([50, 20, 20], [2, 2, 2], (x, y, z) => {
    if (Math.hypot(x - 20, y - 20, z - 20) <= 8) return 10;
    if (Math.hypot(x - 70, y - 20, z - 20) <= 8) return 10;
    return 1;
  });

  it('limiar pega as duas lesões; crescimento só a da semente', () => {
    const both = thresholdMask(two, { min: 5 });
    const a = regionGrow(two, [10, 10, 10], { min: 5 });
    const b = regionGrow(two, [35, 10, 10], { min: 5 });
    expect(count(a)).toBeGreaterThan(0);
    expect(count(a)).toBe(count(b));
    expect(count(both)).toBe(count(a) + count(b));
    expect(a[voxelIndex(two.grid, 35, 10, 10)]).toBe(0);
  });
  it('semente fora da faixa ou fora do volume devolve máscara vazia', () => {
    expect(count(regionGrow(two, [0, 0, 0], { min: 5 }))).toBe(0);
    expect(count(regionGrow(two, [-3, 0, 0], { min: 0 }))).toBe(0);
    expect(count(regionGrow(two, [999, 0, 0], { min: 0 }))).toBe(0);
  });
  it('respeita faixa com máximo e máscara limite', () => {
    const background = regionGrow(two, [0, 0, 0], { min: 0, max: 2 });
    expect(count(background)).toBe(two.data.length - count(thresholdMask(two, { min: 5 })));
    const limit = sphereMask(two.grid, [10, 10, 10], 4);
    const limited = regionGrow(two, [10, 10, 10], { min: 5, within: limit });
    expect(count(limited)).toBe(count(limit));
  });
  it('conectividade 6 não atravessa diagonal; 26 atravessa', () => {
    const grid = makeGrid([3, 3, 1], [1, 1, 1]);
    // Dois voxels ligados só pelo canto.
    const data = Float32Array.from([9, 0, 0, 0, 9, 0, 0, 0, 0]);
    expect(count(regionGrow({ data, grid }, [0, 0, 0], { min: 5 }))).toBe(1);
    expect(count(regionGrow({ data, grid }, [0, 0, 0], { min: 5, connectivity: 26 }))).toBe(2);
  });
  it('aplica o fator de escala antes de comparar', () => {
    const grown = regionGrow(two, [10, 10, 10], { min: 2.5, scale: 0.5 });
    expect(count(grown)).toBe(count(regionGrow(two, [10, 10, 10], { min: 5 })));
    expect(count(thresholdMask(two, { min: 6, scale: 0.5 }))).toBe(0);
  });
});

describe('isocontour e lesionMetrics', () => {
  // Lesão com gradiente: 10 no centro, caindo linearmente até 0 em 20 mm.
  const lesion = makeVolume([60, 60, 60], [1, 1, 1], (x, y, z) =>
    Math.max(0, 10 * (1 - Math.hypot(x - 30, y - 30, z - 30) / 20)),
  );
  const region = sphereMask(lesion.grid, [30, 30, 30], 25);

  it('41% do máximo dá o raio esperado', () => {
    // valor >= 4,1  <=>  distância <= 11,8 mm
    const mask = isocontour(lesion, region, { fractionOfMax: 0.41 })!;
    const expected = ((4 / 3) * Math.PI * 11.8 ** 3) / 1000;
    expect(Math.abs(maskVolumeMl(mask, lesion.grid) - expected) / expected).toBeLessThan(0.02);
  });
  it('limiar absoluto', () => {
    // valor >= 2,5  <=>  distância <= 15 mm
    const mask = isocontour(lesion, region, { absolute: 2.5 })!;
    const expected = ((4 / 3) * Math.PI * 15 ** 3) / 1000;
    expect(Math.abs(maskVolumeMl(mask, lesion.grid) - expected) / expected).toBeLessThan(0.02);
  });
  it('fica dentro da região inicial, a menos que se libere', () => {
    const small = sphereMask(lesion.grid, [30, 30, 30], 5);
    const limited = isocontour(lesion, small, { absolute: 2.5 })!;
    const free = isocontour(lesion, small, { absolute: 2.5, limitToRegion: false })!;
    expect(count(limited)).toBe(count(small));
    expect(count(free)).toBeGreaterThan(count(limited) * 10);
  });
  it('sem limiar ou com região vazia devolve undefined', () => {
    expect(isocontour(lesion, region, {})).toBeUndefined();
    expect(isocontour(lesion, new Uint8Array(lesion.data.length), { absolute: 1 })).toBeUndefined();
  });
  it('métricas da lesão', () => {
    const mask = isocontour(lesion, region, { fractionOfMax: 0.41 })!;
    const m = lesionMetrics(lesion, mask)!;
    expect(m.max).toBeCloseTo(10, 6);
    expect(m.mean).toBeGreaterThan(4.1);
    expect(m.mean).toBeLessThan(10);
    expect(m.peak!).toBeLessThan(m.max);
    expect(m.peak!).toBeGreaterThan(m.mean);
    expect(m.totalActivity).toBeCloseTo(m.mean * m.volumeMl, 9);
    // Média analítica de um cone radial dentro de r = 11,8: 10 × (1 − 3r/(4R)) = 5,575
    expect(m.mean).toBeCloseTo(5.575, 1);
    expect(lesionMetrics(lesion, new Uint8Array(lesion.data.length))).toBeUndefined();
  });
});
