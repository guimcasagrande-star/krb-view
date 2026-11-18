import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import {
  csvVolumetria,
  volumetriaDosSegmentos,
  volumetriaDosSegmentosPorFatias,
  volumetriaPassadaUnica,
} from '../src/segmentation/volumetria';

/** Grade 10×10×10 com voxels de 2 mm (8 mm³ = 0,008 mL cada). */
const grid: VolumeGrid = {
  dims: [10, 10, 10],
  origin: [0, 0, 0],
  stepI: [2, 0, 0],
  stepJ: [0, 2, 0],
  stepK: [0, 0, 2],
  spacing: [2, 2, 2],
};
const n = 1000;

describe('volumetria por segmento', () => {
  // Valores: 40 em todo lugar; segmento 1 = cubo 5×5×5 com 80; segmento 2 = 10 voxels com 100 e 200.
  const valores = new Float32Array(n).fill(40);
  const rotulos = new Uint8Array(n);
  for (let k = 0; k < 5; k++)
    for (let j = 0; j < 5; j++)
      for (let i = 0; i < 5; i++) {
        const idx = i + j * 10 + k * 100;
        rotulos[idx] = 1;
        valores[idx] = 80;
      }
  for (let t = 0; t < 10; t++) {
    const idx = 900 + t;
    rotulos[idx] = 2;
    valores[idx] = t < 5 ? 100 : 200;
  }
  const volume = { data: valores, grid };
  const segmentos = [
    { indice: 1, nome: 'Lesão' },
    { indice: 2, nome: 'Outro' },
    { indice: 3, nome: 'Vazio' },
  ];

  it('volume e estatísticas de cada segmento', () => {
    const [a, b, c] = volumetriaDosSegmentos(rotulos, volume, segmentos, false);
    expect(a!.voxels).toBe(125);
    expect(a!.volumeMl).toBeCloseTo(1, 6); // 125 × 8 mm³
    expect(a!.media).toBe(80);
    expect(a!.dp).toBe(0);
    expect(b!.voxels).toBe(10);
    expect(b!.media).toBe(150);
    expect(b!.dp).toBe(50);
    expect(b!.min).toBe(100);
    expect(b!.max).toBe(200);
    expect(c).toEqual({ indice: 3, nome: 'Vazio', voxels: 0, volumeMl: 0 });
    expect(a!.tlg).toBeUndefined();
  });

  it('no PET calcula TLG = média × volume e o pico', () => {
    const [a] = volumetriaDosSegmentos(rotulos, volume, segmentos, true);
    expect(a!.tlg).toBeCloseTo(80, 6); // 80 × 1 mL
    expect(a!.pico).toBeDefined();
  });

  it('recusa máscara e volume de tamanhos diferentes', () => {
    expect(() => volumetriaDosSegmentos(new Uint8Array(5), volume, segmentos, false)).toThrow();
  });

  it('CSV com ";", vírgula decimal e sem quebrar com ";" no nome', () => {
    const linhas = volumetriaDosSegmentos(rotulos, volume, [{ indice: 1, nome: 'Lesão; A' }], false);
    const csv = csvVolumetria(linhas, 'HU', false, 'CT · TÓRAX');
    const [cab, l1] = csv.split('\r\n');
    expect(cab).toBe('Série;Segmento;Voxels;Volume_mL;Media_HU;DP_HU;Min_HU;Max_HU');
    expect(l1).toBe('CT · TÓRAX;Lesão A;125;1,00;80,0;0,0;80,0;80,0');
  });

  it('volumetriaPassadaUnica calcula muitos segmentos, fatorSpv, sem escalares e estabilidade numérica', () => {
    const u = volumetriaPassadaUnica(rotulos, valores, segmentos, [2, 2, 2], 0.5);
    expect(u[0]).toEqual({
      indice: 1,
      nome: 'Lesão',
      voxelCount: 125,
      volumeMl: 1,
      min: 40,
      max: 40,
      media: 40,
      dp: 0,
    });
    expect(u[1]!.media).toBeCloseTo(75, 6);
    expect(u[1]!.dp).toBeCloseTo(25, 6);
    expect(u[2]).toEqual({
      indice: 3,
      nome: 'Vazio',
      voxelCount: 0,
      volumeMl: 0,
      min: 0,
      max: 0,
      media: 0,
      dp: 0,
    });

    // Sem valores escalares: só contagem e volume
    const semEscalar = volumetriaPassadaUnica(rotulos, undefined, segmentos, grid);
    expect(semEscalar[0]!.voxelCount).toBe(125);
    expect(semEscalar[0]!.volumeMl).toBeCloseTo(1, 6);
    expect(semEscalar[0]!.media).toBe(0);

    // Muitos segmentos (> 100) + offset alto para checar estabilidade do DP
    const muitosRot = new Uint8Array(300);
    const muitosVal = new Float64Array(300);
    const listaMuitos: Array<{ indice: number; nome: string }> = [];
    for (let s = 1; s <= 120; s++) {
      listaMuitos.push({ indice: s, nome: `Órgão ${s}` });
      muitosRot[s] = s;
      muitosVal[s] = 1_000_000 + s;
    }
    muitosRot[250] = 5;
    muitosVal[250] = 1_000_015;
    const resMuitos = volumetriaPassadaUnica(muitosRot, muitosVal, listaMuitos, [1, 1, 1]);
    expect(resMuitos[4]!.voxelCount).toBe(2);
    expect(resMuitos[4]!.media).toBeCloseTo(1_000_010, 6);
    expect(resMuitos[4]!.dp).toBeCloseTo(5, 6);
    expect(resMuitos[119]!.min).toBe(1_000_120);
  });

  it('volumetriaDosSegmentosPorFatias bate exatamente com volumetriaDosSegmentos', () => {
    const fatias: Uint8Array[] = [];
    for (let k = 0; k < 10; k++) {
      fatias.push(rotulos.subarray(k * 100, (k + 1) * 100));
    }
    const porVolume = volumetriaDosSegmentos(rotulos, volume, segmentos, true);
    const porFatias = volumetriaDosSegmentosPorFatias(fatias, volume, segmentos, true);
    expect(porFatias).toEqual(porVolume);
  });
});
