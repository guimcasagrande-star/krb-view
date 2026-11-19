import { describe, expect, it } from 'vitest';
import {
  calcularVolumeElipsoideMl,
  detectarVolumesElipsoideAuto,
  distanciaEntreSegmentos3D,
  formatarVolumeElipsoide,
  type SegmentoMedida3D,
} from '../src/tools/volumeElipsoideMath';

describe('calcularVolumeElipsoideMl e formatação', () => {
  it('calcula esfera de 30 mm (raio 15 mm) como ~14,137 mL', () => {
    const v = calcularVolumeElipsoideMl(30, 30, 30);
    expect(v).toBeCloseTo((4 / 3) * Math.PI * 1.5 ** 3, 6);
    expect(formatarVolumeElipsoide(v, 1)).toBe('Vol. 14,1 mL');
  });

  it('calcula elipsoide típico de próstata (42 × 35 × 38 mm)', () => {
    const v = calcularVolumeElipsoideMl(42, 35, 38);
    expect(v).toBeCloseTo((Math.PI / 6000) * 42 * 35 * 38, 6);
    expect(formatarVolumeElipsoide(v, 1)).toBe('Vol. 29,2 mL');
  });

  it('devolve 0 para entradas inválidas ou não positivas', () => {
    expect(calcularVolumeElipsoideMl(0, 30, 30)).toBe(0);
    expect(calcularVolumeElipsoideMl(-10, 30, 30)).toBe(0);
    expect(calcularVolumeElipsoideMl(Number.NaN, 30, 30)).toBe(0);
  });
});

describe('distanciaEntreSegmentos3D', () => {
  it('devolve 0 quando dois segmentos se cruzam em 3D', () => {
    expect(distanciaEntreSegmentos3D([-10, 0, 0], [10, 0, 0], [0, -10, 0], [0, 10, 0])).toBeCloseTo(0, 8);
  });

  it('devolve a distância exata entre segmentos reversos em planos paralelos', () => {
    expect(distanciaEntreSegmentos3D([-10, 0, 0], [10, 0, 0], [0, -10, 5], [0, 10, 5])).toBeCloseTo(5, 8);
  });
});

describe('detectarVolumesElipsoideAuto', () => {
  const FOR = '1.2.840.113619.2.55.1';

  it('pareia Medidas Ortogonais (axial) + Distância (sagital) na mesma lesão e devolve volume para ambas as anotações', () => {
    const segs: SegmentoMedida3D[] = [
      // Medidas ortogonais no axial (z = 100): 40 mm em X e 30 mm em Y
      { annotationUID: 'ort-1', frameOfReferenceUid: FOR, a: [-20, 0, 100], b: [20, 0, 100], parId: 'ort-1' },
      { annotationUID: 'ort-1', frameOfReferenceUid: FOR, a: [0, -15, 100], b: [0, 15, 100], parId: 'ort-1' },
      // Distância no sagital (x = 2, ligeiramente fora do centro): 35 mm em Z
      { annotationUID: 'len-1', frameOfReferenceUid: FOR, a: [2, 0, 82.5], b: [2, 0, 117.5] },
    ];

    const mapa = detectarVolumesElipsoideAuto(segs);
    expect(mapa.size).toBe(2);
    const esperado = calcularVolumeElipsoideMl(40, 30, 35);
    expect(mapa.get('ort-1')?.volumeMl).toBeCloseTo(esperado, 6);
    expect(mapa.get('len-1')?.volumeMl).toBeCloseTo(esperado, 6);
    expect(mapa.get('ort-1')?.diametrosMm).toEqual([40, 35, 30]);
  });

  it('pareia 3 Distâncias independentes no mesmo local em 3D (2 no axial + 1 no coronal)', () => {
    const segs: SegmentoMedida3D[] = [
      { annotationUID: 'a1', frameOfReferenceUid: FOR, a: [0, 0, 0], b: [30, 0, 0] },
      { annotationUID: 'a2', frameOfReferenceUid: FOR, a: [15, -15, 0], b: [15, 15, 0] },
      { annotationUID: 'a3', frameOfReferenceUid: FOR, a: [15, 0, -15], b: [15, 0, 15] },
    ];
    const mapa = detectarVolumesElipsoideAuto(segs);
    expect(mapa.size).toBe(3);
    const esperado = calcularVolumeElipsoideMl(30, 30, 30);
    expect(mapa.get('a1')?.volumeMl).toBeCloseTo(esperado, 6);
    expect(mapa.get('a2')?.volumeMl).toBeCloseTo(esperado, 6);
    expect(mapa.get('a3')?.volumeMl).toBeCloseTo(esperado, 6);
  });

  it('rejeita 3 medidas coplanares no mesmo corte axial', () => {
    const segs: SegmentoMedida3D[] = [
      { annotationUID: 'c1', frameOfReferenceUid: FOR, a: [-15, 0, 50], b: [15, 0, 50] },
      { annotationUID: 'c2', frameOfReferenceUid: FOR, a: [0, -15, 50], b: [0, 15, 50] },
      { annotationUID: 'c3', frameOfReferenceUid: FOR, a: [-10, -10, 50], b: [10, 10, 50] },
    ];
    expect(detectarVolumesElipsoideAuto(segs).size).toBe(0);
  });

  it('rejeita medidas em locais distantes ou com FrameOfReferenceUID diferente', () => {
    const distantes: SegmentoMedida3D[] = [
      { annotationUID: 'd1', frameOfReferenceUid: FOR, a: [0, 0, 0], b: [20, 0, 0] },
      { annotationUID: 'd2', frameOfReferenceUid: FOR, a: [10, -10, 0], b: [10, 10, 0] },
      // 3ª medida 80 mm longe da lesão
      { annotationUID: 'd3', frameOfReferenceUid: FOR, a: [10, 0, 80], b: [10, 0, 100] },
    ];
    expect(detectarVolumesElipsoideAuto(distantes).size).toBe(0);

    const forDiferente: SegmentoMedida3D[] = [
      { annotationUID: 'f1', frameOfReferenceUid: 'FOR-A', a: [-10, 0, 0], b: [10, 0, 0] },
      { annotationUID: 'f2', frameOfReferenceUid: 'FOR-A', a: [0, -10, 0], b: [0, 10, 0] },
      { annotationUID: 'f3', frameOfReferenceUid: 'FOR-B', a: [0, 0, -10], b: [0, 0, 10] },
    ];
    expect(detectarVolumesElipsoideAuto(forDiferente).size).toBe(0);
  });

  it('separa corretamente dois elipsoides distintos no mesmo exame', () => {
    const segs: SegmentoMedida3D[] = [
      // Lesão 1 centrada em (0, 0, 0): 20 × 20 × 20 mm
      { annotationUID: 'l1-ort', frameOfReferenceUid: FOR, a: [-10, 0, 0], b: [10, 0, 0], parId: 'l1-ort' },
      { annotationUID: 'l1-ort', frameOfReferenceUid: FOR, a: [0, -10, 0], b: [0, 10, 0], parId: 'l1-ort' },
      { annotationUID: 'l1-z', frameOfReferenceUid: FOR, a: [0, 0, -10], b: [0, 0, 10] },
      // Lesão 2 centrada em (100, 0, 0): 40 × 30 × 50 mm
      { annotationUID: 'l2-ort', frameOfReferenceUid: FOR, a: [80, 0, 0], b: [120, 0, 0], parId: 'l2-ort' },
      { annotationUID: 'l2-ort', frameOfReferenceUid: FOR, a: [100, -15, 0], b: [100, 15, 0], parId: 'l2-ort' },
      { annotationUID: 'l2-z', frameOfReferenceUid: FOR, a: [100, 0, -25], b: [100, 0, 25] },
    ];
    const mapa = detectarVolumesElipsoideAuto(segs);
    expect(mapa.size).toBe(4);
    expect(mapa.get('l1-ort')?.volumeMl).toBeCloseTo(calcularVolumeElipsoideMl(20, 20, 20), 6);
    expect(mapa.get('l1-z')?.volumeMl).toBeCloseTo(calcularVolumeElipsoideMl(20, 20, 20), 6);
    expect(mapa.get('l2-ort')?.volumeMl).toBeCloseTo(calcularVolumeElipsoideMl(40, 30, 50), 6);
    expect(mapa.get('l2-z')?.volumeMl).toBeCloseTo(calcularVolumeElipsoideMl(40, 30, 50), 6);
  });
});
