/**
 * Teste de ponta a ponta com o phantom sintético: dos bytes dos arquivos até
 * SUVmax, volume da lesão, par de fusão e sincronização da comparação.
 */
import * as dicomParserModule from 'dicom-parser';
import { beforeAll, describe, expect, it } from 'vitest';
import { PHANTOM, buildPhantom } from '../scripts/gerar-phantom.ts';
import { createLink, isIssue, syncedSlice } from '../src/compare/sync';
import { gridFromStack, worldToVoxel } from '../src/io/geometry';
import { buildIndex, type DicomIndex, type StackNode, type StudyNode } from '../src/io/organize';
import { parseHeader } from '../src/io/readHeader';
import type { InstanceMeta } from '../src/io/types';
import { findFusionCandidates } from '../src/pet/fusionPairing';
import { computeSuv } from '../src/pet/suv';
import { calcularVoiEsfera } from '../src/volume/voi';
import {
  isocontour,
  lesionMetrics,
  maskStats,
  maskVolumeMl,
  regionGrow,
  sphereMask,
  type ScalarVolume,
} from '../src/volume/voxelStats';

const dicomParser = ((dicomParserModule as { default?: unknown }).default ??
  dicomParserModule) as typeof dicomParserModule;

let files: Map<string, Uint8Array>;
let index: DicomIndex;
let current: StudyNode;
let previous: StudyNode;

function stackOf(study: StudyNode, modality: string): StackNode {
  return study.series.find((s) => s.modality === modality)!.stacks[0]!;
}

/** Lê os pixels de uma pilha e aplica slope/intercept (o que o Cornerstone faz ao decodificar). */
function loadVolume(stack: StackNode): ScalarVolume {
  const grid = gridFromStack(stack.instances)!;
  const [nx, ny, nz] = grid.dims;
  const data = new Float32Array(nx * ny * nz);
  stack.instances.forEach((instance: InstanceMeta, k: number) => {
    const bytes = files.get(instance.fileId)!;
    const ds = dicomParser.parseDicom(bytes);
    const pixel = ds.elements['x7fe00010']!;
    const stored = new Uint16Array(bytes.buffer, bytes.byteOffset + pixel.dataOffset, pixel.length / 2);
    for (let n = 0; n < nx * ny; n++) {
      data[k * nx * ny + n] = stored[n]! * instance.rescaleSlope! + instance.rescaleIntercept!;
    }
  });
  return { data, grid };
}

beforeAll(() => {
  files = buildPhantom();
  const metas: InstanceMeta[] = [];
  for (const [path, bytes] of files) {
    const outcome = parseHeader(bytes, path);
    if (!outcome.ok) throw new Error(`${path}: ${outcome.reason}`);
    expect(outcome.complete).toBe(true);
    metas.push(outcome.meta);
  }
  index = buildIndex(metas);
  [current, previous] = index.patients[0]!.studies as [StudyNode, StudyNode];
});

describe('phantom: indexação', () => {
  it('um paciente, dois estudos, o mais recente primeiro', () => {
    expect(index.skipped).toEqual([]);
    expect(index.patients).toHaveLength(1);
    expect(index.patients[0]!.name).toBe('SUV PHANTOM');
    expect(index.patients[0]!.studies.map((s) => s.date)).toEqual(['20260115', '20250710']);
    expect(current.modalities).toEqual(['CT', 'PT']);
    expect(current.series.map((s) => [s.modality, s.instanceCount])).toEqual([
      ['CT', 86],
      ['PT', 64],
    ]);
  });
  it('todas as séries viram volume', () => {
    for (const study of [current, previous]) {
      for (const series of study.series) {
        expect(series.stacks).toHaveLength(1);
        expect(series.stacks[0]!.geometry.issues).toEqual([]);
        expect(series.stacks[0]!.geometry.volumeOk).toBe(true);
      }
    }
    expect(stackOf(current, 'CT').geometry.sliceSpacing).toBeCloseTo(3, 9);
    expect(stackOf(current, 'PT').geometry.sliceSpacing).toBeCloseTo(4, 9);
    expect(stackOf(previous, 'CT').geometry.sliceSpacing).toBeCloseTo(5, 9);
  });
});

describe('phantom: SUV', () => {
  it('fator calculado a partir do cabeçalho', () => {
    const result = computeSuv(stackOf(current, 'PT').instances);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uniform).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.factors[0]!.bw).toBeCloseTo(PHANTOM.suvFactor, 15);
    expect(result.params.uptakeSeconds).toBe(3600);
    expect(result.params.radiopharmaceutical).toBe('FDG');
  });

  it('lesões medidas nos pixels batem com o gabarito', () => {
    const pet = stackOf(current, 'PT');
    const suv = computeSuv(pet.instances);
    if (!suv.ok) throw new Error('SUV');
    const scale = suv.factors[0]!.bw;
    const volume = loadVolume(pet);

    for (const lesion of [PHANTOM.lesionA, PHANTOM.lesionB]) {
      // ROI esférica desenhada "pelo usuário" em volta da lesão.
      const center = worldToVoxel(volume.grid, lesion.center)!;
      const region = sphereMask(volume.grid, center, lesion.radius + 12);
      const stats = maskStats(volume, region, { scale })!;
      expect(stats.max).toBeCloseTo(lesion.suv, 2);
      expect(stats.min).toBeCloseTo(PHANTOM.background, 2);

      const mask = isocontour(volume, region, { fractionOfMax: 0.41, scale })!;
      const metrics = lesionMetrics(volume, mask, { scale })!;
      const analytic = ((4 / 3) * Math.PI * lesion.radius ** 3) / 1000;
      expect(Math.abs(metrics.volumeMl - analytic) / analytic).toBeLessThan(0.05);
      expect(metrics.mean).toBeCloseTo(lesion.suv, 2);
      expect(metrics.totalActivity).toBeCloseTo(lesion.suv * metrics.volumeMl, 1);
    }

    // SUVpico: lesão A (15 mm) contém a esfera de 1 mL inteira; a B (8 mm) também, por pouco.
    const a = sphereMask(volume.grid, worldToVoxel(volume.grid, PHANTOM.lesionA.center)!, 20);
    expect(lesionMetrics(volume, a, { scale })!.peak).toBeCloseTo(10, 2);
  });

  it('a TC tem os valores de HU esperados', () => {
    const ct = loadVolume(stackOf(current, 'CT'));
    const center = worldToVoxel(ct.grid, PHANTOM.lesionA.center)!;
    const inside = maskStats(ct, sphereMask(ct.grid, center, 8))!;
    expect(inside.min).toBe(80);
    expect(inside.max).toBe(80);
    const spine = maskStats(ct, sphereMask(ct.grid, worldToVoxel(ct.grid, [0, 70, 100])!, 6))!;
    expect(spine.mean).toBe(700);
  });

  it('volumetria na TC por crescimento de região (60 a 100 HU)', () => {
    const ct = loadVolume(stackOf(current, 'CT'));
    for (const lesion of [PHANTOM.lesionA, PHANTOM.lesionB]) {
      const seed = worldToVoxel(ct.grid, lesion.center)!;
      const mask = regionGrow(ct, seed, { min: 60, max: 100 });
      const analytic = ((4 / 3) * Math.PI * lesion.radius ** 3) / 1000;
      expect(Math.abs(maskVolumeMl(mask, ct.grid) - analytic) / analytic).toBeLessThan(0.05);
    }
    // No exame anterior a lesão A tem 10 mm de raio (4,19 mL) e está 37 mm acima.
    const old = loadVolume(stackOf(previous, 'CT'));
    const [x, y, z] = PHANTOM.lesionA.center;
    const mask = regionGrow(old, worldToVoxel(old.grid, [x, y, z + 37])!, { min: 60, max: 100 });
    const analytic = ((4 / 3) * Math.PI * 10 ** 3) / 1000;
    expect(Math.abs(maskVolumeMl(mask, old.grid) - analytic) / analytic).toBeLessThan(0.1);
  });
});

describe('phantom: fusão e comparação', () => {
  it('PET e TC do exame atual formam par automático', () => {
    const candidates = findFusionCandidates(current);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sameFrame).toBe(true);
    expect(candidates[0]!.attenuationCorrected).toBe(true);
    expect(candidates[0]!.overlap).toBeCloseTo(1, 6);
    expect(findFusionCandidates(previous)).toEqual([]);
  });

  it('o mesmo ponto anatômico cai no mesmo lugar nos dois volumes', () => {
    const pet = gridFromStack(stackOf(current, 'PT').instances)!;
    const ct = gridFromStack(stackOf(current, 'CT').instances)!;
    const inPet = worldToVoxel(pet, PHANTOM.lesionA.center)!;
    const inCt = worldToVoxel(ct, PHANTOM.lesionA.center)!;
    expect(inPet).toEqual([(-60 + 190) / 4, 190 / 4, 128 / 4]);
    expect(inCt[0]).toBeCloseTo((-60 + 190.5) / 3, 9);
    expect(inCt[2]).toBeCloseTo(128 / 3, 9);
  });

  it('TC atual e anterior rolam juntas na lesão', () => {
    const now = stackOf(current, 'CT').geometry;
    const before = stackOf(previous, 'CT').geometry;
    const link = createLink(now, before);
    if (isIssue(link)) throw new Error(link.code);
    // Referenciais diferentes: o alinhamento pelo topo recupera os 37 mm de deslocamento da mesa.
    expect(link.offsetMm).toBeCloseTo(37, 9);
    const synced = syncedSlice(link, PHANTOM.lesionA.center[2], before)!;
    // A lesão está em z = 165 mm no exame anterior; os cortes de 5 mm ficam em 162 e 167.
    expect(synced.position).toBeCloseTo(PHANTOM.lesionA.center[2] + 37, 9);
    expect(before.positions[synced.index]).toBe(167);
    expect(synced.distanceMm).toBeCloseTo(2, 9);
    expect(synced.outOfRange).toBe(false);
  });
});

describe('phantom: medida de lesão sem aplicar SUV duas vezes (5.4)', () => {
  it('voxels já entregues em SUV pelo carregador dão SUVmax, SUVpico, MTV e TLG corretos', () => {
    const pet = stackOf(current, 'PT');
    const suv = computeSuv(pet.instances);
    if (!suv.ok) throw new Error('SUV');
    const fator = suv.factors[0]!.bw;

    // Simula o volume entregue pelo Cornerstone (voxels já multiplicados pelo fator de SUV).
    const bruto = loadVolume(pet);
    const dadosSuv = new Float32Array(bruto.data.length);
    for (let i = 0; i < bruto.data.length; i++) dadosSuv[i] = bruto.data[i]! * fator;
    const volumeSuv: ScalarVolume = { data: dadosSuv, grid: bruto.grid };

    // Lesão A (10,00 SUV, raio 15 mm -> ~14,1 mL): critérios "41% do máx." e "SUV >= 2,5".
    const a41 = calcularVoiEsfera(volumeSuv, PHANTOM.lesionA.center, PHANTOM.lesionA.radius + 12, true, '41%');
    expect(a41.ok).toBe(true);
    if (!a41.ok) return;
    expect(a41.max).toBeCloseTo(10, 2);
    expect(a41.pico).toBeCloseTo(10, 2);
    expect(a41.media).toBeCloseTo(10, 2);
    expect(a41.mtvMl).toBeGreaterThan(13.4);
    expect(a41.mtvMl).toBeLessThan(14.9);
    expect(a41.tlg).toBeCloseTo(10 * a41.mtvMl!, 1);
    expect(a41.contornoPorCorte?.size).toBeGreaterThan(0);

    const a25 = calcularVoiEsfera(volumeSuv, PHANTOM.lesionA.center, PHANTOM.lesionA.radius + 12, true, 'suv25');
    expect(a25.ok).toBe(true);
    if (!a25.ok) return;
    expect(a25.max).toBeCloseTo(10, 2);
    expect(a25.mtvMl).toBeCloseTo(a41.mtvMl!, 1);

    // Lesão B (5,00 SUV): prova também que não houve multiplicação dupla pelo fator.
    const b41 = calcularVoiEsfera(volumeSuv, PHANTOM.lesionB.center, PHANTOM.lesionB.radius + 12, true, '41%');
    expect(b41.ok).toBe(true);
    if (!b41.ok) return;
    expect(b41.max).toBeCloseTo(5, 2);
    expect(b41.pico).toBeCloseTo(5, 2);
  });
});
