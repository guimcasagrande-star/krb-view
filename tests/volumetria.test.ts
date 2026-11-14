import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import { csvVolumetria, volumetriaDosSegmentos } from '../src/segmentation/volumetria';

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
});
