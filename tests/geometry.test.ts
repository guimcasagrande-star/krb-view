import { describe, expect, it } from 'vitest';
import {
  analyzeStack,
  classifyPlane,
  estimateVolumeBytes,
  gridFromStack,
  gridFromVolumeProps,
  sliceNormal,
  sortSlices,
  splitIntoStacks,
  voxelToWorld,
  voxelVolumeMl,
  worldToVoxel,
} from '../src/io/geometry';
import type { Orientation } from '../src/io/types';
import { AXIAL, CORONAL, SAGITTAL, makeSeries, shuffle } from './helpers/fixtures';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('orientação', () => {
  it('calcula a normal', () => {
    const close = (v: number[], expected: number[]) =>
      v.forEach((c, n) => expect(c).toBeCloseTo(expected[n]!, 12));
    close(sliceNormal(AXIAL), [0, 0, 1]);
    close(sliceNormal(CORONAL), [0, 1, 0]);
    close(sliceNormal(SAGITTAL), [-1, 0, 0]);
  });
  it('classifica os planos', () => {
    expect(classifyPlane(AXIAL).plane).toBe('axial');
    expect(classifyPlane(CORONAL).plane).toBe('coronal');
    expect(classifyPlane(SAGITTAL).plane).toBe('sagital');
    expect(classifyPlane(AXIAL).oblique).toBe(false);
  });
  it('marca cortes oblíquos', () => {
    const a = (20 * Math.PI) / 180;
    const tilted: Orientation = [1, 0, 0, 0, Math.cos(a), -Math.sin(a)];
    const info = classifyPlane(tilted);
    expect(info.plane).toBe('axial');
    expect(info.oblique).toBe(true);
    expect(info.angleFromOrthogonalDeg).toBeCloseTo(20, 6);
  });
});

describe('sortSlices', () => {
  it('ordena pela posição mesmo com arquivos embaralhados', () => {
    const series = makeSeries({ count: 40 });
    const { sorted, method } = sortSlices(shuffle(series));
    expect(method).toBe('geometria');
    expect(sorted.map((i) => i.instanceNumber)).toEqual(series.map((i) => i.instanceNumber));
  });
  it('ignora InstanceNumber errado e usa a posição', () => {
    const series = makeSeries({ count: 10 });
    // Numeração bagunçada, mas a posição é a verdade.
    const numbers = [3, 1, 2, 5, 4, 7, 6, 9, 8, 10];
    series.forEach((i, k) => (i.instanceNumber = numbers[k]!));
    const { sorted } = sortSlices(shuffle(series));
    const z = sorted.map((i) => i.imagePositionPatient![2]);
    expect(z).toEqual([...z].sort((a, b) => a - b));
  });
  it('segue o sentido do equipamento quando a numeração é invertida', () => {
    const series = makeSeries({ count: 10, numbering: 'desc' });
    const { sorted } = sortSlices(shuffle(series));
    expect(sorted.map((i) => i.instanceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(sorted[0]!.imagePositionPatient![2]).toBeGreaterThan(sorted[9]!.imagePositionPatient![2]);
  });
  it('sem numeração, axial começa pelo corte mais superior', () => {
    const series = makeSeries({ count: 5, numbering: 'none' });
    const { sorted } = sortSlices(shuffle(series));
    expect(sorted.map((i) => i.imagePositionPatient![2])).toEqual([10, 7.5, 5, 2.5, 0]);
  });
  it('cai para InstanceNumber quando falta geometria', () => {
    const series = makeSeries({ count: 6 });
    series.forEach((i) => delete i.imagePositionPatient);
    const { sorted, method } = sortSlices(shuffle(series));
    expect(method).toBe('numero');
    expect(sorted.map((i) => i.instanceNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('cai para o nome do arquivo em ordem natural', () => {
    const series = makeSeries({ count: 12, numbering: 'none' });
    series.forEach((i, k) => {
      delete i.imagePositionPatient;
      i.fileId = `IM${k + 1}`; // IM1, IM2, ... IM12 (sem zeros à esquerda)
    });
    const { sorted, method } = sortSlices(shuffle(series));
    expect(method).toBe('arquivo');
    expect(sorted.map((i) => i.fileId)).toEqual(series.map((i) => i.fileId));
  });
  it('ordena série coronal e sagital', () => {
    for (const orientation of [CORONAL, SAGITTAL]) {
      const series = makeSeries({ count: 15, orientation, spacing: 3 });
      const { sorted } = sortSlices(shuffle(series));
      expect(sorted.map((i) => i.instanceNumber)).toEqual(series.map((i) => i.instanceNumber));
    }
  });
});

describe('analyzeStack', () => {
  it('aprova série regular', () => {
    const g = analyzeStack(makeSeries({ count: 100, spacing: 1.25 }));
    expect(g.volumeOk).toBe(true);
    expect(g.issues).toEqual([]);
    expect(g.sliceSpacing).toBeCloseTo(1.25, 9);
    expect(g.extentMm).toBeCloseTo(99 * 1.25, 9);
    expect(g.direction).toBe(1);
    expect(g.tiltDeg).toBeCloseTo(0, 6);
    expect(g.plane?.plane).toBe('axial');
  });
  it('aceita ordem decrescente', () => {
    const g = analyzeStack(sortSlices(makeSeries({ count: 20, numbering: 'desc' })).sorted);
    expect(g.volumeOk).toBe(true);
    expect(g.direction).toBe(-1);
    expect(g.sliceSpacing).toBeCloseTo(2.5, 9);
  });
  it('tolera arredondamento de posição no cabeçalho', () => {
    const series = makeSeries({ count: 50, spacing: 0.625 });
    series.forEach((i) => {
      i.imagePositionPatient![2] = Math.round(i.imagePositionPatient![2] * 100) / 100;
    });
    const g = analyzeStack(series);
    expect(g.volumeOk).toBe(true);
    expect(g.sliceSpacing).toBeCloseTo(0.625, 2);
  });
  it('detecta cortes faltando', () => {
    const series = makeSeries({ count: 30 });
    series.splice(10, 2);
    const g = analyzeStack(series);
    expect(g.volumeOk).toBe(false);
    expect(codes(g.issues)).toEqual(['CORTES_FALTANDO']);
    expect(g.issues[0]!.message).toContain('2 corte');
  });
  it('detecta espaçamento irregular', () => {
    const series = makeSeries({ count: 30, spacing: 5 });
    // Metade da série reconstruída com outro espaçamento.
    for (let k = 15; k < 30; k++) series[k]!.imagePositionPatient![2] = 70 + (k - 14) * 3.3;
    const g = analyzeStack(series);
    expect(g.volumeOk).toBe(false);
    expect(codes(g.issues)).toContain('ESPACAMENTO_IRREGULAR');
  });
  it('detecta posições repetidas', () => {
    const series = [...makeSeries({ count: 10 }), ...makeSeries({ count: 10, seriesUid: '9.9' })];
    const g = analyzeStack(sortSlices(series).sorted);
    expect(g.volumeOk).toBe(false);
    expect(codes(g.issues)).toContain('POSICAO_DUPLICADA');
  });
  it('detecta gantry inclinado', () => {
    const a = (15 * Math.PI) / 180;
    const tilted: Orientation = [1, 0, 0, 0, Math.cos(a), -Math.sin(a)];
    // Plano inclinado, mas a mesa anda só em z.
    const series = makeSeries({ count: 40, orientation: tilted, step: [0, 0, 3] });
    const g = analyzeStack(series);
    expect(g.volumeOk).toBe(false);
    expect(codes(g.issues)).toContain('GANTRY_INCLINADO');
    expect(g.tiltDeg).toBeCloseTo(15, 3);
  });
  it('aceita série oblíqua empilhada na própria normal (RM)', () => {
    const a = (15 * Math.PI) / 180;
    const tilted: Orientation = [1, 0, 0, 0, Math.cos(a), -Math.sin(a)];
    const g = analyzeStack(makeSeries({ count: 40, orientation: tilted, spacing: 3 }));
    expect(g.volumeOk).toBe(true);
    expect(g.sliceSpacing).toBeCloseTo(3, 9);
  });
  it('detecta matriz e pixel variáveis', () => {
    const series = makeSeries({ count: 10 });
    series[4]!.rows = 256;
    expect(codes(analyzeStack(series).issues)).toContain('TAMANHO_VARIAVEL');
    const other = makeSeries({ count: 10 });
    other[4]!.pixelSpacing = [1, 1];
    expect(codes(analyzeStack(other).issues)).toContain('TAMANHO_VARIAVEL');
  });
  it('detecta orientação variável', () => {
    const series = makeSeries({ count: 10 });
    series[5]!.imageOrientationPatient = [...CORONAL] as Orientation;
    const g = analyzeStack(series);
    expect(g.volumeOk).toBe(false);
    expect(codes(g.issues)).toContain('ORIENTACAO_VARIAVEL');
  });
  it('recusa volume com poucos cortes, sem geometria, sem pixel spacing ou multiframe', () => {
    expect(codes(analyzeStack(makeSeries({ count: 2 })).issues)).toContain('POUCOS_CORTES');
    expect(analyzeStack(makeSeries({ count: 2 })).volumeOk).toBe(false);

    const noGeometry = makeSeries({ count: 10 });
    delete noGeometry[3]!.imagePositionPatient;
    expect(codes(analyzeStack(noGeometry).issues)).toEqual(['SEM_GEOMETRIA']);

    const noSpacing = makeSeries({ count: 10 });
    noSpacing.forEach((i) => delete i.pixelSpacing);
    const g = analyzeStack(noSpacing);
    expect(codes(g.issues)).toContain('SEM_PIXEL_SPACING');
    expect(g.volumeOk).toBe(false);

    const multi = makeSeries({ count: 1, extra: { numberOfFrames: 120 } });
    expect(codes(analyzeStack(multi).issues)).toEqual(['MULTIFRAME']);

    expect(codes(analyzeStack([]).issues)).toEqual(['VAZIA']);
  });
  it('acusa pilha fora de ordem', () => {
    const series = makeSeries({ count: 10 });
    [series[3], series[4]] = [series[4]!, series[3]!];
    expect(codes(analyzeStack(series).issues)).toContain('FORA_DE_ORDEM');
  });
});

describe('splitIntoStacks', () => {
  it('mantém série simples como uma pilha ordenada', () => {
    const stacks = splitIntoStacks(shuffle(makeSeries({ count: 30 })));
    expect(stacks).toHaveLength(1);
    expect(stacks[0]!.label).toBeUndefined();
    expect(stacks[0]!.instances.map((i) => i.instanceNumber)).toEqual(
      Array.from({ length: 30 }, (_, k) => k + 1),
    );
  });
  it('separa localizador com três planos', () => {
    const scout = [
      ...makeSeries({ count: 3, orientation: AXIAL }),
      ...makeSeries({ count: 5, orientation: CORONAL }),
      ...makeSeries({ count: 4, orientation: SAGITTAL }),
    ];
    const stacks = splitIntoStacks(shuffle(scout));
    expect(stacks.map((s) => s.instances.length)).toEqual([5, 4, 3]);
  });
  it('separa difusão pelo valor de b', () => {
    const dwi = [0, 50, 800].flatMap((b) =>
      makeSeries({ count: 20, spacing: 5, extra: { diffusionBValue: b } }),
    );
    dwi.forEach((i, k) => (i.instanceNumber = k + 1));
    const stacks = splitIntoStacks(shuffle(dwi));
    expect(stacks.map((s) => s.label)).toEqual(['b=0', 'b=50', 'b=800']);
    for (const s of stacks) {
      expect(s.instances).toHaveLength(20);
      expect(analyzeStack(s.instances).volumeOk).toBe(true);
    }
  });
  it('separa dinâmico pela fase', () => {
    const dyn = [1, 2, 3, 4].flatMap((t) =>
      makeSeries({ count: 12, extra: { temporalPositionIdentifier: t } }),
    );
    const stacks = splitIntoStacks(shuffle(dyn));
    expect(stacks.map((s) => s.label)).toEqual(['fase 1', 'fase 2', 'fase 3', 'fase 4']);
  });
  it('combina duas chaves (eco e fase)', () => {
    const series = [1, 2].flatMap((t) =>
      [2.3, 4.6].flatMap((te) =>
        makeSeries({ count: 8, extra: { temporalPositionIdentifier: t, echoTime: te } }),
      ),
    );
    const stacks = splitIntoStacks(shuffle(series));
    expect(stacks).toHaveLength(4);
    expect(stacks.map((s) => s.label).sort()).toEqual([
      'fase 1, TE 2.3',
      'fase 1, TE 4.6',
      'fase 2, TE 2.3',
      'fase 2, TE 4.6',
    ]);
    for (const s of stacks) expect(analyzeStack(s.instances).volumeOk).toBe(true);
  });
  it('não picota a série por tag que muda a cada corte', () => {
    const series = makeSeries({ count: 25 });
    series.forEach((i, k) => {
      i.acquisitionNumber = k + 1;
      i.triggerTime = k * 10;
    });
    expect(splitIntoStacks(series)).toHaveLength(1);
    // Duas fases, com AcquisitionNumber diferente em todo corte: separa pela ordem.
    const two = [...makeSeries({ count: 10 }), ...makeSeries({ count: 10 })];
    two.forEach((i, k) => {
      i.acquisitionNumber = k + 1;
      i.instanceNumber = k + 1;
    });
    const stacks = splitIntoStacks(shuffle(two));
    expect(stacks.map((s) => s.label)).toEqual(['parte 1', 'parte 2']);
    expect(stacks[0]!.instances.map((i) => i.instanceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stacks[1]!.instances.map((i) => i.instanceNumber)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
  it('deixa junto quando as repetições não são uniformes', () => {
    const series = [...makeSeries({ count: 10 }), ...makeSeries({ count: 3 })];
    const stacks = splitIntoStacks(series);
    expect(stacks).toHaveLength(1);
    expect(codes(analyzeStack(stacks[0]!.instances).issues)).toContain('POSICAO_DUPLICADA');
  });
  it('separa imagens sem geometria em pilha própria', () => {
    const series = makeSeries({ count: 10 });
    const loose = makeSeries({ count: 2, seriesUid: '5.5' });
    loose.forEach((i) => delete i.imagePositionPatient);
    const stacks = splitIntoStacks([...series, ...loose]);
    expect(stacks.map((s) => s.instances.length)).toEqual([10, 2]);
  });
});

describe('grade do volume', () => {
  it('converte voxel em posição e volta', () => {
    const series = makeSeries({
      count: 60,
      spacing: 3,
      rows: 256,
      columns: 512,
      pixelSpacing: [1.5, 0.75],
      origin: [-190, -180, -400],
    });
    const grid = gridFromStack(series)!;
    expect(grid.dims).toEqual([512, 256, 60]);
    expect(grid.spacing[0]).toBeCloseTo(0.75, 9); // entre colunas
    expect(grid.spacing[1]).toBeCloseTo(1.5, 9); // entre linhas
    expect(grid.spacing[2]).toBeCloseTo(3, 9);
    // Voxel (coluna 10, linha 20, corte 5).
    expect(voxelToWorld(grid, [10, 20, 5])).toEqual([-190 + 7.5, -180 + 30, -400 + 15]);
    const back = worldToVoxel(grid, [-182.5, -150, -385])!;
    expect(back[0]).toBeCloseTo(10, 9);
    expect(back[1]).toBeCloseTo(20, 9);
    expect(back[2]).toBeCloseTo(5, 9);
    expect(voxelVolumeMl(grid)).toBeCloseTo((0.75 * 1.5 * 3) / 1000, 12);
  });
  it('funciona em qualquer orientação e sentido', () => {
    for (const orientation of [CORONAL, SAGITTAL]) {
      const series = sortSlices(makeSeries({ count: 20, orientation, numbering: 'desc' })).sorted;
      const grid = gridFromStack(series)!;
      for (const ijk of [[0, 0, 0], [3, 7, 11], [100.5, 20.25, 4.75]] as const) {
        const w = voxelToWorld(grid, [...ijk]);
        const back = worldToVoxel(grid, w)!;
        back.forEach((v, n) => expect(v).toBeCloseTo(ijk[n]!, 8));
      }
      // O corte k da grade é o corte k da pilha.
      expect(voxelToWorld(grid, [0, 0, 7])[0]).toBeCloseTo(series[7]!.imagePositionPatient![0], 9);
      expect(voxelToWorld(grid, [0, 0, 7])[1]).toBeCloseTo(series[7]!.imagePositionPatient![1], 9);
    }
  });
  it('grade a partir das propriedades de um volume do Cornerstone', () => {
    // Pilha exibida de cima para baixo (numeração invertida): o Cornerstone guarda
    // o volume em ordem crescente ao longo da normal, com origem no corte mais baixo.
    const display = sortSlices(makeSeries({ count: 20, spacing: 3, numbering: 'desc', pixelSpacing: [1.5, 0.75], origin: [-190, -180, -400] })).sorted;
    expect(display[0]!.imagePositionPatient![2]).toBe(-343);
    const fromStack = gridFromStack(display)!;
    const fromVolume = gridFromVolumeProps({
      dimensions: [512, 512, 20],
      spacing: [0.75, 1.5, 3], // [entre colunas, entre linhas, entre cortes]
      origin: [-190, -180, -400],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    expect(fromVolume.dims).toEqual([512, 512, 20]);
    // O mesmo ponto do paciente tem k diferente nas duas grades: 19 - k.
    const world = voxelToWorld(fromVolume, [10, 20, 5]);
    expect(world).toEqual([-190 + 7.5, -180 + 30, -400 + 15]);
    const inStack = worldToVoxel(fromStack, world)!;
    expect(inStack[0]).toBeCloseTo(10, 9);
    expect(inStack[1]).toBeCloseTo(20, 9);
    expect(inStack[2]).toBeCloseTo(14, 9);
    expect(voxelVolumeMl(fromVolume)).toBeCloseTo(voxelVolumeMl(fromStack), 12);
  });
  it('estima memória', () => {
    expect(estimateVolumeBytes(512, 512, 400, 2)).toBe(512 * 512 * 400 * 2);
  });
});
