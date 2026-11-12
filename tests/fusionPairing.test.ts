import { describe, expect, it } from 'vitest';
import { buildIndex } from '../src/io/organize';
import { findFusionCandidates } from '../src/pet/fusionPairing';
import type { InstanceMeta } from '../src/io/types';
import { CORONAL, makeSeries } from './helpers/fixtures';

function withFrame(series: InstanceMeta[], frame: string, pet?: InstanceMeta['pet']): InstanceMeta[] {
  series.forEach((i) => {
    i.frameOfReferenceUid = frame;
    if (pet) i.pet = pet;
  });
  return series;
}

const AC = { correctedImage: ['DECY', 'ATTN'] };
const NAC = { correctedImage: ['DECY'] };

function study(...series: InstanceMeta[][]) {
  return buildIndex(series.flat()).patients[0]!.studies[0]!;
}

describe('findFusionCandidates', () => {
  // PET de corpo inteiro: z de 0 a 996 mm.
  const pet = () => withFrame(makeSeries({ count: 250, spacing: 4, seriesUid: 'PT.AC', modality: 'PT', rows: 192, columns: 192 }), 'F1', AC);

  it('escolhe a TC do mesmo referencial com maior cobertura', () => {
    const lowDose = withFrame(makeSeries({ count: 333, spacing: 3, seriesUid: 'CT.AC' }), 'F1'); // 0 a 996
    const chest = withFrame(makeSeries({ count: 300, spacing: 1, seriesUid: 'CT.TORAX', origin: [-200, -200, 600] }), 'F1'); // 600 a 899
    const candidates = findFusionCandidates(study(pet(), lowDose, chest));
    expect(candidates.map((c) => c.anatomicSeries.seriesInstanceUid)).toEqual(['CT.AC', 'CT.TORAX']);
    expect(candidates[0]!.sameFrame).toBe(true);
    expect(candidates[0]!.overlap).toBeCloseTo(1, 6);
    expect(candidates[1]!.overlap).toBeCloseTo(299 / 996, 6);
  });

  it('entre coberturas iguais, prefere cortes mais finos', () => {
    const thick = withFrame(makeSeries({ count: 200, spacing: 5, seriesUid: 'CT.5MM' }), 'F1'); // 0 a 995
    const thin = withFrame(makeSeries({ count: 997, spacing: 1, seriesUid: 'CT.1MM' }), 'F1'); // 0 a 996
    const candidates = findFusionCandidates(study(pet(), thick, thin));
    expect(candidates[0]!.anatomicSeries.seriesInstanceUid).toBe('CT.1MM');
  });

  it('PET corrigido vem antes do não corrigido', () => {
    const nac = withFrame(makeSeries({ count: 250, spacing: 4, seriesUid: 'PT.NAC', modality: 'PT' }), 'F1', NAC);
    const ct = withFrame(makeSeries({ count: 333, spacing: 3, seriesUid: 'CT.AC' }), 'F1');
    const candidates = findFusionCandidates(study(nac, pet(), ct));
    expect(candidates.map((c) => [c.petSeries.seriesInstanceUid, c.attenuationCorrected])).toEqual([
      ['PT.AC', true],
      ['PT.NAC', false],
    ]);
  });

  it('referencial diferente vira par manual, depois dos automáticos', () => {
    const same = withFrame(makeSeries({ count: 100, spacing: 5, seriesUid: 'CT.MESMO' }), 'F1');
    const other = withFrame(makeSeries({ count: 333, spacing: 3, seriesUid: 'CT.OUTRO' }), 'F2');
    const candidates = findFusionCandidates(study(pet(), other, same));
    expect(candidates.map((c) => [c.anatomicSeries.seriesInstanceUid, c.sameFrame])).toEqual([
      ['CT.MESMO', true],
      ['CT.OUTRO', false],
    ]);
    expect(candidates[1]!.overlap).toBe(0);
  });

  it('ignora séries que não viram volume, sem sobreposição ou em outro plano', () => {
    const scout = withFrame(makeSeries({ count: 2, seriesUid: 'CT.SCOUT', orientation: CORONAL }), 'F1');
    const far = withFrame(makeSeries({ count: 50, spacing: 2, seriesUid: 'CT.LONGE', origin: [-200, -200, 5000] }), 'F1');
    const coronal = withFrame(makeSeries({ count: 50, spacing: 2, seriesUid: 'CT.COR', orientation: CORONAL }), 'F1');
    expect(findFusionCandidates(study(pet(), scout, far, coronal))).toEqual([]);
  });

  it('aceita RM como série anatômica e estudo sem PET', () => {
    const mr = withFrame(makeSeries({ count: 100, spacing: 5, seriesUid: 'MR.T2', modality: 'MR' }), 'F1');
    expect(findFusionCandidates(study(pet(), mr))[0]!.anatomicSeries.modality).toBe('MR');
    expect(findFusionCandidates(study(mr))).toEqual([]);
  });
});
