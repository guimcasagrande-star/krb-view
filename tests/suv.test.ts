import { describe, expect, it } from 'vitest';
import * as calculateSuvModule from '@cornerstonejs/calculate-suv';
import {
  bodySurfaceAreaM2,
  computeSuv,
  leanBodyMassJames,
  leanBodyMassJanmahasatian,
  storedToSuv,
} from '../src/pet/suv';
import type { InstanceMeta, PetMeta } from '../src/io/types';

// Biblioteca de referência do projeto Cornerstone, usada só para conferir.
const reference = ((calculateSuvModule as { default?: unknown }).default ?? calculateSuvModule) as {
  calculateSUVScalingFactors: (instances: unknown[]) => { suvbw: number; suvbsa?: number; suvlbmJanma?: number }[];
};

const F18_HALF_LIFE = 6586.2;

interface PetOptions {
  count?: number;
  pet?: Partial<PetMeta>;
  meta?: Partial<InstanceMeta>;
}

/** Série de PET padrão: FDG, 370 MBq às 13:30, aquisição às 14:30, 70 kg. */
function petSeries(options: PetOptions = {}): InstanceMeta[] {
  const count = options.count ?? 3;
  return Array.from({ length: count }, (_, k) => ({
    fileId: `pet/${k}`,
    modality: 'PT',
    seriesDate: '20260115',
    seriesTime: '143000',
    acquisitionDate: '20260115',
    acquisitionTime: '143000',
    patientWeightKg: 70,
    patientSizeM: 1.75,
    patientSex: 'M',
    imageType: [],
    windowCenter: [],
    windowWidth: [],
    ...options.meta,
    pet: {
      units: 'BQML',
      correctedImage: ['DECY', 'ATTN', 'SCAT'],
      decayCorrection: 'START',
      radionuclideTotalDoseBq: 370e6,
      radionuclideHalfLifeS: F18_HALF_LIFE,
      radiopharmaceuticalStartTime: '133000',
      radiopharmaceutical: 'FDG',
      ...options.pet,
    },
  }));
}

function toReference(instances: InstanceMeta[]): unknown[] {
  return instances.map((i) => ({
    CorrectedImage: i.pet!.correctedImage,
    Units: i.pet!.units,
    RadionuclideHalfLife: i.pet!.radionuclideHalfLifeS,
    RadionuclideTotalDose: i.pet!.radionuclideTotalDoseBq,
    DecayCorrection: i.pet!.decayCorrection,
    PatientWeight: i.patientWeightKg,
    PatientSize: i.patientSizeM,
    PatientSex: i.patientSex,
    SeriesDate: i.seriesDate,
    SeriesTime: i.seriesTime,
    AcquisitionDate: i.acquisitionDate,
    AcquisitionTime: i.acquisitionTime,
    RadiopharmaceuticalStartTime: i.pet!.radiopharmaceuticalStartTime,
    RadiopharmaceuticalStartDateTime: i.pet!.radiopharmaceuticalStartDateTime,
    GEPrivatePostInjectionDateTime: i.pet!.gePrivateScanDateTime,
    PhilipsPETPrivateGroup:
      i.pet!.philipsSuvScaleFactor !== undefined ||
      i.pet!.philipsActivityConcentrationScaleFactor !== undefined
        ? {
            SUVScaleFactor: i.pet!.philipsSuvScaleFactor,
            ActivityConcentrationScaleFactor: i.pet!.philipsActivityConcentrationScaleFactor,
          }
        : undefined,
  }));
}

function ok(instances: InstanceMeta[]) {
  const result = computeSuv(instances);
  if (!result.ok) throw new Error(`esperava sucesso: ${result.errors.map((e) => e.code).join(', ')}`);
  return result;
}

function errorCodes(instances: InstanceMeta[]): string[] {
  const result = computeSuv(instances);
  if (result.ok) throw new Error('esperava falha');
  return result.errors.map((e) => e.code);
}

describe('fórmulas de composição corporal', () => {
  it('Janmahasatian', () => {
    expect(leanBodyMassJanmahasatian(70, 1.75, 'M')).toBeCloseTo(55.857107722577474, 10);
    expect(leanBodyMassJanmahasatian(70, 1.75, 'F')).toBeCloseTo(45.19701492537313, 10);
    expect(leanBodyMassJanmahasatian(70, 1.75, 'O')).toBeUndefined();
  });
  it('James', () => {
    expect(leanBodyMassJames(70, 1.75, 'M')).toBeCloseTo(56.52, 10);
    expect(leanBodyMassJames(70, 1.75, 'F')).toBeCloseTo(51.22, 10);
    // Obesidade extrema: a fórmula fica negativa e não é usada.
    expect(leanBodyMassJames(250, 1.5, 'F')).toBeUndefined();
  });
  it('Du Bois', () => {
    expect(bodySurfaceAreaM2(70, 1.75)).toBeCloseTo(1.8481430181213463, 10);
  });
});

describe('cálculo padrão (BQML)', () => {
  it('bate com a conta feita à mão', () => {
    const result = ok(petSeries());
    // 70 000 g ÷ (370 MBq × 2^(-3600/6586.2))
    expect(result.factors[0]!.bw).toBeCloseTo(0.00027633668171764324, 15);
    expect(result.uniform).toBe(true);
    expect(result.factors).toHaveLength(3);
    expect(result.warnings).toEqual([]);
    expect(result.params).toMatchObject({
      method: 'BQML',
      units: 'BQML',
      weightKg: 70,
      injectedDoseBq: 370e6,
      halfLifeS: F18_HALF_LIFE,
      uptakeSeconds: 3600,
      scanTimeSource: 'serie',
      decayCorrection: 'START',
      radiopharmaceutical: 'FDG',
    });
    expect(result.params.decayedDoseBq).toBeCloseTo(253314180.24164078, 4);
    expect(result.params.injectionMs).toBe(Date.UTC(2026, 0, 15, 13, 30));
    expect(result.params.scanStartMs).toBe(Date.UTC(2026, 0, 15, 14, 30));
  });

  it('um pixel de 5000 Bq/mL vira o SUV esperado', () => {
    const { factors } = ok(petSeries());
    expect(5000 * factors[0]!.bw).toBeCloseTo(1.3816834, 6);
    expect(storedToSuv(2500, 2, 0, factors[0]!.bw)).toBeCloseTo(1.3816834, 6);
  });

  it('calcula SUL e SUV por superfície', () => {
    const { factors } = ok(petSeries());
    const f = factors[0]!;
    expect(f.lbm! / f.bw).toBeCloseTo(55.857107722577474 / 70, 12);
    expect(f.lbmJames! / f.bw).toBeCloseTo(56.52 / 70, 12);
    // BSA em cm² ÷ peso em g
    expect(f.bsa! / f.bw).toBeCloseTo((1.8481430181213463 * 1e4) / 70000, 12);
  });

  it('outro radionuclídeo (Ga-68, 150 MBq, 80 kg, 60 min)', () => {
    const result = ok(
      petSeries({
        meta: { patientWeightKg: 80 },
        pet: { radionuclideTotalDoseBq: 150e6, radionuclideHalfLifeS: 4062.6 },
      }),
    );
    expect(result.factors[0]!.bw).toBeCloseTo(0.0009857142845058275, 14);
  });

  it('prefere a data/hora completa da injeção', () => {
    const result = ok(
      petSeries({
        pet: {
          radiopharmaceuticalStartDateTime: '20260115140000.00',
          radiopharmaceuticalStartTime: '133000',
        },
      }),
    );
    expect(result.params.uptakeSeconds).toBe(1800);
  });

  it('aceita horários com fração de segundo', () => {
    const result = ok(
      petSeries({ meta: { seriesTime: '143000.500', acquisitionTime: '143000.500' }, pet: { radiopharmaceuticalStartTime: '133000.250' } }),
    );
    expect(result.params.uptakeSeconds).toBeCloseTo(3600.25, 9);
  });
});

describe('meia-noite', () => {
  it('injeção antes da meia-noite, série no dia seguinte', () => {
    const result = ok(
      petSeries({
        meta: { seriesDate: '20260116', seriesTime: '003000', acquisitionDate: '20260116', acquisitionTime: '003000' },
        pet: { radiopharmaceuticalStartTime: '233000' },
      }),
    );
    expect(result.params.uptakeSeconds).toBe(3600);
    expect(result.params.injectionAssumedPreviousDay).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['INJECAO_NO_DIA_ANTERIOR']);
    expect(result.factors[0]!.bw).toBeCloseTo(0.00027633668171764324, 15);
  });

  it('com data/hora completa não precisa supor nada', () => {
    const result = ok(
      petSeries({
        meta: { seriesDate: '20260116', seriesTime: '003000', acquisitionDate: '20260116', acquisitionTime: '003000' },
        pet: { radiopharmaceuticalStartDateTime: '20260115233000' },
      }),
    );
    expect(result.params.uptakeSeconds).toBe(3600);
    expect(result.warnings).toEqual([]);
  });

  it('data/hora completa posterior à aquisição é erro, não suposição', () => {
    expect(
      errorCodes(petSeries({ pet: { radiopharmaceuticalStartDateTime: '20260115150000' } })),
    ).toEqual(['INJECAO_APOS_AQUISICAO']);
  });

  it('imagem tardia de dias depois (data/hora completa)', () => {
    const result = ok(
      petSeries({
        pet: {
          radiopharmaceuticalStartDateTime: '20260112143000',
          radionuclideHalfLifeS: 282240, // Zr-89, 78,4 h
        },
      }),
    );
    expect(result.params.uptakeSeconds).toBe(3 * 86400);
    expect(result.factors[0]!.bw).toBeCloseTo(70000 / (370e6 * 2 ** (-259200 / 282240)), 15);
  });
});

describe('referência da correção de decaimento', () => {
  it('ADMIN: a dose não é decaída', () => {
    const result = ok(petSeries({ pet: { decayCorrection: 'ADMIN' } }));
    expect(result.factors[0]!.bw).toBeCloseTo(70000 / 370e6, 15);
    expect(result.params.decayedDoseBq).toBe(370e6);
    expect(result.params.uptakeSeconds).toBe(3600);
  });
  it('NONE e ausente são recusados', () => {
    expect(errorCodes(petSeries({ pet: { decayCorrection: 'NONE' } }))).toEqual([
      'REFERENCIA_DE_DECAIMENTO_NAO_SUPORTADA',
    ]);
    const missing = petSeries();
    missing.forEach((i) => delete i.pet!.decayCorrection);
    expect(errorCodes(missing)).toEqual(['SEM_REFERENCIA_DE_DECAIMENTO']);
  });
});

describe('série reprocessada (hora da série posterior à aquisição)', () => {
  const reprocessed = { seriesTime: '160000', acquisitionTime: '143000' };

  it('GE: usa a tag privada', () => {
    const result = ok(
      petSeries({ meta: reprocessed, pet: { gePrivateScanDateTime: '20260115142900.00' } }),
    );
    expect(result.params.scanTimeSource).toBe('ge-privado');
    expect(result.params.uptakeSeconds).toBe(3540);
    expect(result.warnings.map((w) => w.code)).toEqual(['HORA_DA_SERIE_ALTERADA']);
  });

  it('Siemens: recalcula a partir do quadro', () => {
    // Três posições de mesa de 180 s, começando às 14:30:00.
    const tavg = 89.85792324928173; // instante médio de contagem num quadro de 180 s
    const series = petSeries({ meta: reprocessed });
    series.forEach((i, k) => {
      i.acquisitionTime = ['143000', '143300', '143600'][k]!;
      i.pet!.actualFrameDurationMs = 180000;
      i.pet!.frameReferenceTimeMs = (k * 180 + tavg) * 1000;
    });
    const result = ok(series);
    expect(result.params.scanTimeSource).toBe('quadro');
    expect(result.params.uptakeSeconds).toBeCloseTo(3600, 6);
    for (const f of result.factors) expect(f.bw).toBeCloseTo(0.00027633668171764324, 12);
  });

  it('sem nenhuma das duas, usa a aquisição mais antiga', () => {
    const series = petSeries({ meta: reprocessed });
    series[1]!.acquisitionTime = '143300';
    series[2]!.acquisitionTime = '143600';
    const result = ok(series);
    expect(result.params.scanTimeSource).toBe('aquisicao');
    expect(result.params.uptakeSeconds).toBe(3600);
    expect(result.uniform).toBe(true);
  });

  it('descarta o recálculo por quadro quando o resultado é incoerente', () => {
    const series = petSeries({ meta: reprocessed });
    series.forEach((i) => {
      i.pet!.actualFrameDurationMs = 180000;
      i.pet!.frameReferenceTimeMs = 1; // levaria o início para depois da aquisição
    });
    expect(ok(series).params.scanTimeSource).toBe('aquisicao');
  });

  it('série normal com várias posições de mesa usa a hora da série', () => {
    const series = petSeries();
    series[1]!.acquisitionTime = '143300';
    series[2]!.acquisitionTime = '143600';
    const result = ok(series);
    expect(result.params.scanTimeSource).toBe('serie');
    expect(result.warnings).toEqual([]);
  });
});

describe('Philips e GML', () => {
  it('CNTS com fator de SUV privado', () => {
    const series = petSeries({ pet: { units: 'CNTS' } });
    series.forEach((i, k) => (i.pet!.philipsSuvScaleFactor = [0.0005, 0.0006, 0.0007][k]!));
    const result = ok(series);
    expect(result.params.method).toBe('PHILIPS_FATOR_SUV');
    expect(result.factors.map((f) => f.bw)).toEqual([0.0005, 0.0006, 0.0007]);
    expect(result.uniform).toBe(false);
  });
  it('CNTS com fator de SUV dispensa dose e horários', () => {
    const series = petSeries({ pet: { units: 'CNTS', philipsSuvScaleFactor: 0.0004 } });
    series.forEach((i) => {
      delete i.pet!.radionuclideTotalDoseBq;
      delete i.pet!.radiopharmaceuticalStartTime;
    });
    expect(ok(series).factors[0]!.bw).toBe(0.0004);
  });
  it('CNTS com fator de concentração de atividade', () => {
    const result = ok(
      petSeries({ pet: { units: 'CNTS', philipsActivityConcentrationScaleFactor: 2.5 } }),
    );
    expect(result.params.method).toBe('PHILIPS_FATOR_ATIVIDADE');
    expect(result.factors[0]!.bw).toBeCloseTo(2.5 * 0.00027633668171764324, 15);
  });
  it('CNTS sem fatores privados é recusado', () => {
    expect(errorCodes(petSeries({ pet: { units: 'CNTS' } }))).toEqual(['CNTS_SEM_FATOR']);
    expect(
      errorCodes(petSeries({ pet: { units: 'CNTS', philipsSuvScaleFactor: 0 } })),
    ).toEqual(['CNTS_SEM_FATOR']);
  });
  it('GML: valores já estão em SUV', () => {
    const series = petSeries({ pet: { units: 'GML' } });
    series.forEach((i) => {
      delete i.pet!.radionuclideTotalDoseBq;
      delete i.patientWeightKg;
    });
    const result = ok(series);
    expect(result.params.method).toBe('GML');
    expect(result.factors[0]).toEqual({ bw: 1 });
  });
});

describe('dados faltando ou inválidos: recusa, sem valor padrão', () => {
  it('peso', () => {
    const series = petSeries();
    series.forEach((i) => delete i.patientWeightKg);
    expect(errorCodes(series)).toEqual(['SEM_PESO']);
    expect(errorCodes(petSeries({ meta: { patientWeightKg: 0 } }))).toEqual(['SEM_PESO']);
    expect(errorCodes(petSeries({ meta: { patientWeightKg: 7000 } }))).toEqual(['PESO_INVALIDO']);
  });
  it('dose', () => {
    const series = petSeries();
    series.forEach((i) => delete i.pet!.radionuclideTotalDoseBq);
    expect(errorCodes(series)).toEqual(['SEM_DOSE']);
    // 370 "Bq": o equipamento gravou em MBq.
    expect(errorCodes(petSeries({ pet: { radionuclideTotalDoseBq: 370 } }))).toEqual(['DOSE_INVALIDA']);
  });
  it('meia-vida', () => {
    const series = petSeries();
    series.forEach((i) => delete i.pet!.radionuclideHalfLifeS);
    expect(errorCodes(series)).toEqual(['SEM_MEIA_VIDA']);
  });
  it('horário da injeção', () => {
    const series = petSeries();
    series.forEach((i) => delete i.pet!.radiopharmaceuticalStartTime);
    expect(errorCodes(series)).toEqual(['SEM_HORA_DA_INJECAO']);
    expect(errorCodes(petSeries({ pet: { radiopharmaceuticalStartTime: 'xx' } }))).toEqual([
      'SEM_HORA_DA_INJECAO',
    ]);
  });
  it('hora da série', () => {
    const series = petSeries();
    series.forEach((i) => delete i.seriesTime);
    expect(errorCodes(series)).toEqual(['SEM_HORA_DA_SERIE']);
  });
  it('lista todos os problemas de uma vez', () => {
    const series = petSeries();
    series.forEach((i) => {
      delete i.patientWeightKg;
      delete i.pet!.radionuclideTotalDoseBq;
      delete i.pet!.radionuclideHalfLifeS;
    });
    expect(errorCodes(series)).toEqual(['SEM_PESO', 'SEM_DOSE', 'SEM_MEIA_VIDA']);
  });
  it('unidade', () => {
    const series = petSeries();
    series.forEach((i) => delete i.pet!.units);
    expect(errorCodes(series)).toEqual(['SEM_UNIDADE']);
    expect(errorCodes(petSeries({ pet: { units: 'PROPCNTS' } }))).toEqual(['UNIDADE_NAO_SUPORTADA']);
  });
  it('série sem correção de atenuação ou de decaimento', () => {
    expect(errorCodes(petSeries({ pet: { correctedImage: ['DECY', 'SCAT'] } }))).toEqual([
      'SEM_CORRECAO_ATENUACAO',
    ]);
    expect(errorCodes(petSeries({ pet: { correctedImage: ['ATTN'] } }))).toEqual([
      'SEM_CORRECAO_DECAIMENTO',
    ]);
  });
  it('série vazia, não-PET e inconsistente', () => {
    expect(errorCodes([])).toEqual(['SERIE_VAZIA']);
    const ct = petSeries();
    delete ct[1]!.pet;
    expect(errorCodes(ct)).toEqual(['NAO_E_PET']);
    const mixed = petSeries();
    mixed[2]!.patientWeightKg = 71;
    expect(errorCodes(mixed)).toEqual(['SERIE_INCONSISTENTE']);
  });
  it('altura ou sexo ausentes só tiram SUL e BSA', () => {
    const noHeight = petSeries();
    noHeight.forEach((i) => delete i.patientSizeM);
    expect(ok(noHeight).factors[0]).toEqual({ bw: expect.any(Number) });

    const noSex = petSeries();
    noSex.forEach((i) => delete i.patientSex);
    const f = ok(noSex).factors[0]!;
    expect(f.lbm).toBeUndefined();
    expect(f.bsa).toBeGreaterThan(0);

    // Altura em centímetros no cabeçalho: não é usada, e avisa.
    const cm = ok(petSeries({ meta: { patientSizeM: 175 } }));
    expect(cm.factors[0]!.lbm).toBeUndefined();
    expect(cm.warnings.map((w) => w.code)).toEqual(['ALTURA_INVALIDA']);
  });
  it('avisa quando o intervalo é longo demais para o radionuclídeo', () => {
    const result = ok(petSeries({ pet: { radiopharmaceuticalStartDateTime: '20260114143000' } }));
    expect(result.warnings.map((w) => w.code)).toEqual(['CAPTACAO_MUITO_LONGA']);
  });
});

describe('fuso horário', () => {
  it('só desconta quando injeção e série informam fuso', () => {
    const both = ok(
      petSeries({
        meta: { timezoneOffsetFromUtc: '-0300' },
        pet: { radiopharmaceuticalStartDateTime: '20260115163000+0000' }, // 13:30 em -0300
      }),
    );
    expect(both.params.uptakeSeconds).toBe(3600);

    const onlyInjection = ok(
      petSeries({ pet: { radiopharmaceuticalStartDateTime: '20260115133000-0300' } }),
    );
    expect(onlyInjection.params.uptakeSeconds).toBe(3600);
  });
});

describe('conferência com @cornerstonejs/calculate-suv', () => {
  const cases: [string, InstanceMeta[]][] = [
    ['padrão', petSeries()],
    ['data/hora completa', petSeries({ pet: { radiopharmaceuticalStartDateTime: '20260115131245.50' } })],
    ['Ga-68', petSeries({ meta: { patientWeightKg: 93.4, patientSizeM: 1.62, patientSex: 'F' }, pet: { radionuclideTotalDoseBq: 148.3e6, radionuclideHalfLifeS: 4062.6, radiopharmaceuticalStartTime: '132210' } })],
    ['GE reprocessado', petSeries({ meta: { seriesTime: '170000' }, pet: { gePrivateScanDateTime: '20260115142841.00' } })],
    ['reprocessado sem tag privada', petSeries({ meta: { seriesTime: '170000' } })],
    ['Philips fator de SUV', petSeries({ pet: { units: 'CNTS', philipsSuvScaleFactor: 0.000412 } })],
    ['Philips fator de atividade', petSeries({ pet: { units: 'CNTS', philipsActivityConcentrationScaleFactor: 1.83 } })],
  ];

  for (const [name, series] of cases) {
    it(name, () => {
      const mine = ok(series);
      const theirs = reference.calculateSUVScalingFactors(toReference(series));
      expect(theirs).toHaveLength(mine.factors.length);
      mine.factors.forEach((f, k) => {
        const rel = Math.abs(f.bw - theirs[k]!.suvbw) / theirs[k]!.suvbw;
        expect(rel).toBeLessThan(1e-12);
      });
      // SUL (Janmahasatian) e BSA só são comparáveis quando há dose decaída na conta.
      if (mine.params.method === 'BQML') {
        const f = mine.factors[0]!;
        expect(Math.abs(f.lbm! - theirs[0]!.suvlbmJanma!) / f.lbm!).toBeLessThan(1e-12);
        expect(Math.abs(f.bsa! - theirs[0]!.suvbsa!) / f.bsa!).toBeLessThan(1e-12);
      }
    });
  }
});
