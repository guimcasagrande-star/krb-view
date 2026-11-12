/**
 * Cálculo de SUV a partir do cabeçalho DICOM de uma série de PET.
 *
 * Segue o pseudocódigo do QIBA ("Standardized Uptake Value Calculation").
 *
 *   SUVbw = concentração (Bq/mL) × peso (g) ÷ dose no instante de referência (Bq)
 *
 * Regra do projeto: se faltar ou estiver inconsistente qualquer dado necessário,
 * a função devolve `ok: false` com o motivo. Nunca assume valor padrão.
 *
 * O fator devolvido multiplica o valor do pixel JÁ com RescaleSlope/Intercept
 * aplicados (o Cornerstone aplica o rescale ao decodificar).
 */

import {
  combineDateTime,
  parseDT,
  parseTimezoneOffset,
  secondsBetween,
  type DicomInstant,
} from '../io/dicomTime';
import type { InstanceMeta, Issue } from '../io/types';

export interface SuvFactors {
  /** SUV por peso corporal. */
  bw: number;
  /** SUL: massa magra pela fórmula de Janmahasatian (recomendada pela EANM). */
  lbm?: number;
  /** SUL pela fórmula de James, usada por softwares mais antigos. */
  lbmJames?: number;
  /** SUV por superfície corporal (Du Bois), em cm²/mL. */
  bsa?: number;
}

export type SuvMethod =
  /** Units = BQML: cálculo padrão. */
  | 'BQML'
  /** Philips, Units = CNTS, com fator de SUV privado (7053,1000). */
  | 'PHILIPS_FATOR_SUV'
  /** Philips, Units = CNTS, com fator de concentração de atividade (7053,1009). */
  | 'PHILIPS_FATOR_ATIVIDADE'
  /** Units = GML: os valores já estão em SUV. */
  | 'GML';

export type ScanTimeSource =
  /** SeriesDate/SeriesTime (caso normal). */
  | 'serie'
  /** Tag privada da GE (0009,100D). */
  | 'ge-privado'
  /** Recalculado a partir de FrameReferenceTime e ActualFrameDuration. */
  | 'quadro'
  /** Menor AcquisitionDate/Time da série. */
  | 'aquisicao';

/** Tudo que entrou no cálculo, para o painel de conferência. */
export interface SuvParams {
  method: SuvMethod;
  units: string;
  radiopharmaceutical?: string;
  weightKg?: number;
  heightM?: number;
  sex?: string;
  injectedDoseBq?: number;
  halfLifeS?: number;
  decayCorrection?: string;
  /** Instante da injeção (ms, hora de parede do equipamento). */
  injectionMs?: number;
  /** Instante de referência do início da aquisição (ms). */
  scanStartMs?: number;
  scanTimeSource?: ScanTimeSource;
  /** Tempo de captação: da injeção ao início da aquisição, em segundos. */
  uptakeSeconds?: number;
  /** Dose restante no instante de referência da correção de decaimento. */
  decayedDoseBq?: number;
  /** Verdadeiro se a injeção foi considerada no dia anterior ao da série. */
  injectionAssumedPreviousDay?: boolean;
}

export type SuvResult =
  | {
      ok: true;
      /** Um fator por imagem, na mesma ordem de `instances`. */
      factors: SuvFactors[];
      /** Verdadeiro se todas as imagens têm o mesmo fator. */
      uniform: boolean;
      params: SuvParams;
      warnings: Issue[];
    }
  | { ok: false; errors: Issue[]; warnings: Issue[]; params: SuvParams };

// ---------------------------------------------------------------------------
// Massa magra e superfície corporal
// ---------------------------------------------------------------------------

/** Massa magra (kg) por Janmahasatian. `undefined` se o sexo não for M/F. */
export function leanBodyMassJanmahasatian(
  weightKg: number,
  heightM: number,
  sex: string,
): number | undefined {
  const bmi = weightKg / (heightM * heightM);
  if (sex === 'M') return (9270 * weightKg) / (6680 + 216 * bmi);
  if (sex === 'F') return (9270 * weightKg) / (8780 + 244 * bmi);
  return undefined;
}

/**
 * Massa magra (kg) por James. Em obesos a fórmula pode cair e até ficar
 * negativa; nesse caso devolve `undefined`.
 *
 * Atenção: para homens existe na literatura de PET uma variante com 120 no
 * lugar de 128 (Sugawara). Aqui é a fórmula original (128).
 */
export function leanBodyMassJames(
  weightKg: number,
  heightM: number,
  sex: string,
): number | undefined {
  const ratio = (weightKg / (heightM * 100)) ** 2;
  let lbm: number;
  if (sex === 'M') lbm = 1.1 * weightKg - 128 * ratio;
  else if (sex === 'F') lbm = 1.07 * weightKg - 148 * ratio;
  else return undefined;
  return lbm > 0 ? lbm : undefined;
}

/** Superfície corporal em m² (Du Bois). */
export function bodySurfaceAreaM2(weightKg: number, heightM: number): number {
  return 0.007184 * weightKg ** 0.425 * (heightM * 100) ** 0.725;
}

// ---------------------------------------------------------------------------
// Apoio
// ---------------------------------------------------------------------------

const issue = (code: string, message: string): Issue => ({ code, message });

function allEqual<T>(values: T[]): boolean {
  return values.every((v) => v === values[0]);
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

interface ScanTimes {
  /** Um instante por imagem. */
  perInstance: DicomInstant[];
  source: ScanTimeSource;
}

/**
 * Instante de referência do início da aquisição, conforme o QIBA:
 *
 * 1. Se SeriesDate/Time não é posterior à primeira aquisição, vale a série.
 * 2. Senão a série foi reprocessada e a hora da série não serve. Usa a tag
 *    privada da GE, se existir.
 * 3. Senão recalcula a partir do quadro (Siemens): início da aquisição menos
 *    FrameReferenceTime mais o instante médio de contagem dentro do quadro.
 * 4. Senão usa a aquisição mais antiga da série.
 */
function scanTimes(instances: InstanceMeta[], halfLifeS: number | undefined): ScanTimes | Issue {
  const first = instances[0]!;
  const series = combineDateTime(first.seriesDate, first.seriesTime);
  if (!series) {
    return issue('SEM_HORA_DA_SERIE', 'A série não tem SeriesDate/SeriesTime válidos.');
  }

  const acquisitions = instances.map((i) => combineDateTime(i.acquisitionDate, i.acquisitionTime));
  const valid = acquisitions.filter((a): a is DicomInstant => a !== undefined);
  if (valid.length === 0) {
    // Sem hora de aquisição não há como desconfiar da hora da série.
    return { perInstance: instances.map(() => series), source: 'serie' };
  }
  const earliest = valid.reduce((a, b) => (b.ms < a.ms ? b : a));
  if (series.ms <= earliest.ms) {
    return { perInstance: instances.map(() => series), source: 'serie' };
  }

  const ge = parseDT(first.pet?.gePrivateScanDateTime);
  if (ge) return { perInstance: instances.map(() => ge), source: 'ge-privado' };

  if (positive(halfLifeS) && valid.length === instances.length) {
    const lambda = Math.LN2 / halfLifeS;
    const perInstance: DicomInstant[] = [];
    for (let k = 0; k < instances.length; k++) {
      const frameReference = instances[k]!.pet?.frameReferenceTimeMs;
      const frameDuration = instances[k]!.pet?.actualFrameDurationMs;
      if (!positive(frameReference) || !positive(frameDuration)) break;
      const durationS = frameDuration / 1000;
      const decayDuringFrame = lambda * durationS;
      const averageCountRateTimeS =
        (1 / lambda) * Math.log(decayDuringFrame / (1 - Math.exp(-decayDuringFrame)));
      perInstance.push({
        ms: acquisitions[k]!.ms - frameReference + averageCountRateTimeS * 1000,
      });
    }
    // Só aceita se o resultado for coerente: não posterior à primeira aquisição
    // (com 1 s de folga para arredondamento).
    if (
      perInstance.length === instances.length &&
      perInstance.every((t) => t.ms <= earliest.ms + 1000)
    ) {
      return { perInstance, source: 'quadro' };
    }
  }

  return { perInstance: instances.map(() => earliest), source: 'aquisicao' };
}

// ---------------------------------------------------------------------------
// Cálculo
// ---------------------------------------------------------------------------

/**
 * Calcula os fatores de SUV de uma série de PET.
 *
 * `instances` são todas as imagens da série (ou da pilha). O resultado tem um
 * fator por imagem, na mesma ordem.
 */
export function computeSuv(instances: InstanceMeta[]): SuvResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const params: SuvParams = { method: 'BQML', units: '' };
  const fail = (): SuvResult => ({ ok: false, errors, warnings, params });

  const first = instances[0];
  if (!first) {
    errors.push(issue('SERIE_VAZIA', 'A série não tem imagens.'));
    return fail();
  }
  if (instances.some((i) => !i.pet)) {
    errors.push(issue('NAO_E_PET', 'A série não é de PET (ou o cabeçalho de PET não foi lido).'));
    return fail();
  }
  const pet = first.pet!;

  const consistent =
    allEqual(instances.map((i) => i.pet!.units)) &&
    allEqual(instances.map((i) => i.pet!.decayCorrection)) &&
    allEqual(instances.map((i) => [...i.pet!.correctedImage].sort().join('\\'))) &&
    allEqual(instances.map((i) => i.pet!.radionuclideTotalDoseBq)) &&
    allEqual(instances.map((i) => i.pet!.radionuclideHalfLifeS)) &&
    allEqual(instances.map((i) => i.pet!.radiopharmaceuticalStartTime)) &&
    allEqual(instances.map((i) => i.pet!.radiopharmaceuticalStartDateTime)) &&
    allEqual(instances.map((i) => i.patientWeightKg)) &&
    allEqual(instances.map((i) => i.seriesDate)) &&
    allEqual(instances.map((i) => i.seriesTime));
  if (!consistent) {
    errors.push(
      issue(
        'SERIE_INCONSISTENTE',
        'As imagens têm dados de dose, peso ou horário diferentes entre si; não parecem ser de uma única série.',
      ),
    );
    return fail();
  }

  const units = (pet.units ?? '').toUpperCase();
  params.units = units;
  if (pet.radiopharmaceutical) params.radiopharmaceutical = pet.radiopharmaceutical;
  if (first.patientWeightKg !== undefined) params.weightKg = first.patientWeightKg;
  if (first.patientSizeM !== undefined) params.heightM = first.patientSizeM;
  if (first.patientSex !== undefined) params.sex = first.patientSex;
  if (pet.radionuclideTotalDoseBq !== undefined) params.injectedDoseBq = pet.radionuclideTotalDoseBq;
  if (pet.radionuclideHalfLifeS !== undefined) params.halfLifeS = pet.radionuclideHalfLifeS;
  if (pet.decayCorrection !== undefined) params.decayCorrection = pet.decayCorrection;

  if (units === '') {
    errors.push(issue('SEM_UNIDADE', 'A série não informa a unidade dos valores (Units).'));
    return fail();
  }
  if (units !== 'BQML' && units !== 'CNTS' && units !== 'GML') {
    errors.push(
      issue('UNIDADE_NAO_SUPORTADA', `Unidade "${units}" não permite calcular SUV.`),
    );
    return fail();
  }

  // Peso, altura e sexo: validados uma vez, usados por todos os métodos.
  const weightKg = first.patientWeightKg;
  const weightOk = positive(weightKg) && weightKg >= 1 && weightKg <= 500;
  const heightM = first.patientSizeM;
  let heightOk = positive(heightM) && heightM >= 0.3 && heightM <= 2.6;
  if (positive(heightM) && !heightOk) {
    warnings.push(
      issue(
        'ALTURA_INVALIDA',
        `Altura do paciente fora da faixa esperada (${heightM} m); SUL e SUV por superfície não foram calculados.`,
      ),
    );
    heightOk = false;
  }

  /** Completa SUL e BSA a partir do SUVbw: SUL = SUVbw × massa magra ÷ peso. */
  const complete = (bw: number): SuvFactors => {
    const factors: SuvFactors = { bw };
    if (!weightOk || !heightOk) return factors;
    const sex = (first.patientSex ?? '').toUpperCase();
    const janma = leanBodyMassJanmahasatian(weightKg!, heightM!, sex);
    if (janma !== undefined) factors.lbm = (bw * janma) / weightKg!;
    const james = leanBodyMassJames(weightKg!, heightM!, sex);
    if (james !== undefined) factors.lbmJames = (bw * james) / weightKg!;
    factors.bsa = (bw * bodySurfaceAreaM2(weightKg!, heightM!) * 10_000) / (weightKg! * 1000);
    return factors;
  };

  const done = (bw: number[]): SuvResult => {
    const factors = bw.map(complete);
    return { ok: true, factors, uniform: allEqual(bw), params, warnings };
  };

  // --- Valores já em SUV -----------------------------------------------------
  if (units === 'GML') {
    params.method = 'GML';
    return done(instances.map(() => 1));
  }

  // --- Correções obrigatórias ------------------------------------------------
  const corrected = pet.correctedImage.map((c) => c.toUpperCase());
  if (!corrected.includes('ATTN')) {
    errors.push(
      issue('SEM_CORRECAO_ATENUACAO', 'Série sem correção de atenuação: SUV não se aplica.'),
    );
  }
  if (!corrected.includes('DECY')) {
    errors.push(
      issue('SEM_CORRECAO_DECAIMENTO', 'Série sem correção de decaimento: SUV não foi calculado.'),
    );
  }
  if (errors.length > 0) return fail();

  // --- Philips com fator de SUV pronto ---------------------------------------
  let activityScale: number[] | undefined;
  if (units === 'CNTS') {
    const suvScale = instances.map((i) => i.pet!.philipsSuvScaleFactor);
    if (suvScale.every(positive)) {
      params.method = 'PHILIPS_FATOR_SUV';
      return done(suvScale as number[]);
    }
    const activity = instances.map((i) => i.pet!.philipsActivityConcentrationScaleFactor);
    if (!activity.every(positive)) {
      errors.push(
        issue(
          'CNTS_SEM_FATOR',
          'Série em contagens (CNTS) sem os fatores privados da Philips; não dá para converter em SUV.',
        ),
      );
      return fail();
    }
    params.method = 'PHILIPS_FATOR_ATIVIDADE';
    activityScale = activity as number[];
  }

  // --- Dados do cálculo padrão -----------------------------------------------
  if (first.patientWeightKg === undefined || first.patientWeightKg === 0) {
    errors.push(issue('SEM_PESO', 'Falta o peso do paciente (PatientWeight).'));
  } else if (!weightOk) {
    errors.push(
      issue('PESO_INVALIDO', `Peso do paciente fora da faixa esperada (${first.patientWeightKg} kg).`),
    );
  }

  const dose = pet.radionuclideTotalDoseBq;
  if (!positive(dose)) {
    errors.push(issue('SEM_DOSE', 'Falta a dose injetada (RadionuclideTotalDose).'));
  } else if (dose < 1e5) {
    errors.push(
      issue(
        'DOSE_INVALIDA',
        `Dose injetada de ${dose} Bq é baixa demais; o valor parece estar em MBq ou mCi em vez de Bq.`,
      ),
    );
  }

  const halfLifeS = pet.radionuclideHalfLifeS;
  if (!positive(halfLifeS)) {
    errors.push(issue('SEM_MEIA_VIDA', 'Falta a meia-vida do radionuclídeo (RadionuclideHalfLife).'));
  }

  const decayCorrection = (pet.decayCorrection ?? '').toUpperCase();
  if (decayCorrection === '') {
    errors.push(
      issue('SEM_REFERENCIA_DE_DECAIMENTO', 'A série não informa a referência da correção de decaimento (DecayCorrection).'),
    );
  } else if (decayCorrection !== 'START' && decayCorrection !== 'ADMIN') {
    errors.push(
      issue(
        'REFERENCIA_DE_DECAIMENTO_NAO_SUPORTADA',
        `Correção de decaimento "${decayCorrection}" não permite calcular SUV.`,
      ),
    );
  }

  // --- Horários --------------------------------------------------------------
  let injection = parseDT(pet.radiopharmaceuticalStartDateTime);
  const injectionHasDate = injection !== undefined;
  if (!injection) {
    injection = combineDateTime(first.seriesDate, pet.radiopharmaceuticalStartTime);
  }
  if (!injection) {
    errors.push(issue('SEM_HORA_DA_INJECAO', 'Falta o horário da injeção do radiofármaco.'));
  }

  const scan = scanTimes(instances, halfLifeS);
  if ('code' in scan) errors.push(scan);

  if (errors.length > 0 || !injection || 'code' in scan) return fail();

  // Fuso: só entra na conta quando a injeção traz fuso explícito (sufixo no DT)
  // E a série informa o seu (0008,0201). Fora disso, tudo é hora de parede.
  const seriesOffset = parseTimezoneOffset(first.timezoneOffsetFromUtc);
  const withOffset = (t: DicomInstant): DicomInstant =>
    t.offsetMinutes === undefined && seriesOffset !== undefined
      ? { ms: t.ms, offsetMinutes: seriesOffset }
      : t;

  const scanStart = scan.perInstance.reduce((a, b) => (b.ms < a.ms ? b : a));
  let uptake = secondsBetween(injection, withOffset(scanStart));
  if (uptake < 0 && !injectionHasDate) {
    // Só há o horário da injeção, e ele é "depois" da aquisição: a injeção foi
    // antes da meia-noite e a série tem a data do dia seguinte.
    injection = { ms: injection.ms - 86_400_000 };
    uptake = secondsBetween(injection, withOffset(scanStart));
    params.injectionAssumedPreviousDay = true;
    warnings.push(
      issue(
        'INJECAO_NO_DIA_ANTERIOR',
        'O horário da injeção é posterior ao da aquisição; foi considerado que a injeção ocorreu no dia anterior.',
      ),
    );
  }
  if (uptake < 0) {
    errors.push(
      issue('INJECAO_APOS_AQUISICAO', 'O horário da injeção é posterior ao início da aquisição.'),
    );
    return fail();
  }

  params.injectionMs = injection.ms;
  params.scanStartMs = scanStart.ms;
  params.scanTimeSource = scan.source;
  params.uptakeSeconds = uptake;

  if (scan.source !== 'serie') {
    warnings.push(
      issue(
        'HORA_DA_SERIE_ALTERADA',
        'A hora da série é posterior à aquisição (série reprocessada); o início da aquisição foi obtido de outra tag.',
      ),
    );
  }
  if (uptake > 10 * halfLifeS!) {
    warnings.push(
      issue(
        'CAPTACAO_MUITO_LONGA',
        'O intervalo entre injeção e aquisição passa de 10 meias-vidas; confira os horários do cabeçalho.',
      ),
    );
  }

  // --- Fatores ---------------------------------------------------------------
  const weightG = weightKg! * 1000;
  const bw = scan.perInstance.map((t, k) => {
    const elapsed = decayCorrection === 'ADMIN' ? 0 : secondsBetween(injection!, withOffset(t));
    const decayedDose = dose! * 2 ** (-elapsed / halfLifeS!);
    const factor = weightG / decayedDose;
    return activityScale ? factor * activityScale[k]! : factor;
  });

  const referenceElapsed = decayCorrection === 'ADMIN' ? 0 : uptake;
  params.decayedDoseBq = dose! * 2 ** (-referenceElapsed / halfLifeS!);

  return done(bw);
}

/** Valor armazenado no arquivo -> SUV. */
export function storedToSuv(
  stored: number,
  rescaleSlope: number,
  rescaleIntercept: number,
  factor: number,
): number {
  return (stored * rescaleSlope + rescaleIntercept) * factor;
}
