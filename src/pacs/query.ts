/**
 * Consultas de C-FIND (modelo Study Root): montagem do pedido a partir dos
 * filtros da tela e leitura das respostas.
 */

import { PacsError } from './errors.ts';
import {
  decodeText,
  encodeExplicit,
  encodeImplicit,
  latin1,
  parseImplicit,
  uidBytes,
  type ImplicitElement,
} from './implicit.ts';
import { isValidUid } from './uids.ts';

export interface StudyFilters {
  /** Nome ou parte do nome, em qualquer caixa. Aceita os curingas * e ?. */
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  /** AAAAMMDD */
  dateFrom?: string;
  /** AAAAMMDD */
  dateTo?: string;
  /** CT, MR, PT... */
  modality?: string;
}

export interface StudyResult {
  studyInstanceUid: string;
  patientName?: string;
  patientId?: string;
  patientBirthDate?: string;
  patientSex?: string;
  studyDate?: string;
  studyTime?: string;
  description?: string;
  accessionNumber?: string;
  modalities: string[];
  seriesCount?: number;
  instanceCount?: number;
}

export interface SeriesResult {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  seriesNumber?: number;
  modality?: string;
  description?: string;
  instanceCount?: number;
}

const TAG = {
  specificCharacterSet: '00080005',
  studyDate: '00080020',
  studyTime: '00080030',
  accessionNumber: '00080050',
  queryRetrieveLevel: '00080052',
  modality: '00080060',
  modalitiesInStudy: '00080061',
  institutionName: '00080080',
  referringPhysicianName: '00080090',
  studyDescription: '00081030',
  seriesDescription: '0008103e',
  patientName: '00100010',
  patientId: '00100020',
  patientBirthDate: '00100030',
  patientSex: '00100040',
  patientAge: '00101010',
  studyInstanceUid: '0020000d',
  seriesInstanceUid: '0020000e',
  studyId: '00200010',
  seriesNumber: '00200011',
  numberOfStudyRelatedSeries: '00201206',
  numberOfStudyRelatedInstances: '00201208',
  numberOfSeriesRelatedInstances: '00201209',
} as const;

const TAG_VR: Record<string, string> = {
  [TAG.specificCharacterSet]: 'CS',
  [TAG.studyDate]: 'DA',
  [TAG.studyTime]: 'TM',
  [TAG.accessionNumber]: 'SH',
  [TAG.queryRetrieveLevel]: 'CS',
  [TAG.modality]: 'CS',
  [TAG.modalitiesInStudy]: 'CS',
  [TAG.institutionName]: 'LO',
  [TAG.referringPhysicianName]: 'PN',
  [TAG.studyDescription]: 'LO',
  [TAG.seriesDescription]: 'LO',
  [TAG.patientName]: 'PN',
  [TAG.patientId]: 'LO',
  [TAG.patientBirthDate]: 'DA',
  [TAG.patientSex]: 'CS',
  [TAG.patientAge]: 'AS',
  [TAG.studyInstanceUid]: 'UI',
  [TAG.seriesInstanceUid]: 'UI',
  [TAG.studyId]: 'SH',
  [TAG.seriesNumber]: 'IS',
  [TAG.numberOfStudyRelatedSeries]: 'IS',
  [TAG.numberOfStudyRelatedInstances]: 'IS',
  [TAG.numberOfSeriesRelatedInstances]: 'IS',
};

const DATE = /^\d{8}$/;

function assertNoBackslash(label: string, value: string): string {
  // A barra invertida separa valores em DICOM; num filtro digitado só pode ser engano.
  if (/[\\\0-\x1f]/.test(value)) {
    throw new PacsError('FILTRO_INVALIDO', `${label} contém caracteres não permitidos.`);
  }
  return value;
}

/**
 * Transforma o que o usuário digitou em padrão de busca de nome.
 * "joão silva" -> "*JOÃO*SILVA*". Se já houver * ? ou ^, o texto é usado como está.
 */
export function patientNamePattern(input: string): string {
  const text = assertNoBackslash('O nome', input.trim());
  if (text === '') return '';
  if (/[*?^]/.test(text)) return text.toUpperCase();
  return `*${text.toUpperCase().split(/\s+/).join('*')}*`;
}

/** Faixa de datas DICOM: "AAAAMMDD-AAAAMMDD", "AAAAMMDD-", "-AAAAMMDD" ou um dia só. */
export function dateRange(from: string | undefined, to: string | undefined): string {
  for (const d of [from, to]) {
    if (d !== undefined && d !== '' && !DATE.test(d)) {
      throw new PacsError('FILTRO_INVALIDO', `Data inválida: "${d}". Use AAAAMMDD.`);
    }
  }
  const a = from ?? '';
  const b = to ?? '';
  if (a === '' && b === '') return '';
  if (a !== '' && b !== '' && a > b) {
    throw new PacsError('FILTRO_INVALIDO', 'A data inicial é posterior à data final.');
  }
  return a === b ? a : `${a}-${b}`;
}

function encodeQuery(values: Record<string, string>, forceCharset = false, explicitVr = false): Uint8Array {
  const needsCharset = forceCharset || Object.values(values).some((v) => /[^\x00-\x7f]/.test(v));
  const elements: ImplicitElement[] = Object.entries(values).map(([tag, value]) => ({
    tag,
    vr: TAG_VR[tag] ?? 'LO',
    value: tag === TAG.studyInstanceUid || tag === TAG.seriesInstanceUid ? uidBytes(value) : latin1(value),
  }));
  if (needsCharset && values[TAG.specificCharacterSet] === undefined) {
    elements.push({ tag: TAG.specificCharacterSet, vr: 'CS', value: latin1('ISO_IR 100') });
  }
  return explicitVr ? encodeExplicit(elements) : encodeImplicit(elements);
}

function normalizeStudyFilters(filters: StudyFilters): {
  name: string;
  id: string;
  accession: string;
  modality: string;
  date: string;
} {
  const name = filters.patientName ? patientNamePattern(filters.patientName) : '';
  const id = assertNoBackslash('O ID do paciente', (filters.patientId ?? '').trim());
  const accession = assertNoBackslash('O número de acesso', (filters.accessionNumber ?? '').trim());
  const modality = assertNoBackslash('A modalidade', (filters.modality ?? '').trim().toUpperCase());
  const date = dateRange(filters.dateFrom, filters.dateTo);
  if (name === '' && id === '' && accession === '' && date === '') {
    throw new PacsError(
      'FILTRO_VAZIO',
      'Informe pelo menos nome, ID do paciente, número de acesso ou data para pesquisar.',
    );
  }
  return { name, id, accession, modality, date };
}

/**
 * Identificador de C-FIND no nível de estudo.
 *
 * Exige pelo menos um filtro: uma consulta vazia pediria o PACS inteiro.
 */
export function buildStudyQuery(filters: StudyFilters): Uint8Array {
  const { name, id, accession, modality, date } = normalizeStudyFilters(filters);
  return encodeQuery({
    [TAG.queryRetrieveLevel]: 'STUDY',
    [TAG.patientName]: name,
    [TAG.patientId]: id,
    [TAG.patientBirthDate]: '',
    [TAG.patientSex]: '',
    [TAG.studyDate]: date,
    [TAG.studyTime]: '',
    [TAG.accessionNumber]: accession,
    [TAG.modalitiesInStudy]: modality,
    [TAG.studyDescription]: '',
    [TAG.studyInstanceUid]: '',
    [TAG.numberOfStudyRelatedSeries]: '',
    [TAG.numberOfStudyRelatedInstances]: '',
  });
}

export interface FallbackQuery {
  dataset: Uint8Array;
  explicitVr: boolean;
}

/**
 * Variantes de compatibilidade do C-FIND de estudo para PACS que retornam erro 0xC001/0xA900
 * (ex.: Vivace / .NET PACS com `KeyNotFoundException` por esperar Explicit VR Little Endian,
 * por exigir `Modality (0008,0060)` / `StudyID (0020,0010)` ou por rejeitar chaves opcionais).
 */
export function buildStudyQueryFallbacks(filters: StudyFilters): FallbackQuery[] {
  const { name, id, accession, modality, date } = normalizeStudyFilters(filters);

  // A: Completo estilo RadiAnt + Modality (0008,0060) + StudyID + InstitutionName + PatientAge
  const fullWithModality: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'STUDY',
    [TAG.patientName]: name,
    [TAG.patientId]: id,
    [TAG.patientBirthDate]: '',
    [TAG.patientSex]: '',
    [TAG.patientAge]: '',
    [TAG.studyDate]: date,
    [TAG.studyTime]: '',
    [TAG.accessionNumber]: accession,
    [TAG.modality]: modality,
    [TAG.modalitiesInStudy]: modality,
    [TAG.institutionName]: '',
    [TAG.referringPhysicianName]: '',
    [TAG.studyDescription]: '',
    [TAG.studyInstanceUid]: '',
    [TAG.studyId]: '',
    [TAG.numberOfStudyRelatedSeries]: '',
    [TAG.numberOfStudyRelatedInstances]: '',
  };

  // B: Padrão RadiAnt (sem 0008,0060, com StudyID e ModalitiesInStudy)
  const radiantStandard: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'STUDY',
    [TAG.patientName]: name,
    [TAG.patientId]: id,
    [TAG.patientBirthDate]: '',
    [TAG.patientSex]: '',
    [TAG.studyDate]: date,
    [TAG.studyTime]: '',
    [TAG.accessionNumber]: accession,
    [TAG.modalitiesInStudy]: modality,
    [TAG.referringPhysicianName]: '',
    [TAG.studyDescription]: '',
    [TAG.studyInstanceUid]: '',
    [TAG.studyId]: '',
    [TAG.numberOfStudyRelatedSeries]: '',
    [TAG.numberOfStudyRelatedInstances]: '',
  };

  // C: Mínimo PS3.4 (sem contadores 0020,1206/1208 e sem ModalitiesInStudy)
  const minimalPs34: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'STUDY',
    [TAG.patientName]: name,
    [TAG.patientId]: id,
    [TAG.studyDate]: date,
    [TAG.studyTime]: '',
    [TAG.accessionNumber]: accession,
    [TAG.studyDescription]: '',
    [TAG.studyInstanceUid]: '',
    [TAG.studyId]: '',
  };

  // D: Estritamente chaves obrigatórias PS3.4 Tabela C.6-5
  const strictRequired: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'STUDY',
    [TAG.patientName]: name,
    [TAG.patientId]: id,
    [TAG.studyDate]: date,
    [TAG.studyTime]: '',
    [TAG.accessionNumber]: accession,
    [TAG.studyInstanceUid]: '',
    [TAG.studyId]: '',
  };

  return [
    // Tenta primeiro em Explicit VR Little Endian (como o RadiAnt negocia com PACS .NET/Vivace)
    { dataset: encodeQuery(radiantStandard, true, true), explicitVr: true },
    { dataset: encodeQuery(fullWithModality, true, true), explicitVr: true },
    { dataset: encodeQuery(minimalPs34, true, true), explicitVr: true },
    { dataset: encodeQuery(strictRequired, false, true), explicitVr: true },
    // E também em Implicit VR Little Endian
    { dataset: encodeQuery(fullWithModality, true, false), explicitVr: false },
    { dataset: encodeQuery(radiantStandard, true, false), explicitVr: false },
    { dataset: encodeQuery(minimalPs34, true, false), explicitVr: false },
    { dataset: encodeQuery(strictRequired, false, false), explicitVr: false },
  ];
}

/** Identificador de C-FIND no nível de série, para um estudo. */
export function buildSeriesQuery(studyInstanceUid: string): Uint8Array {
  if (!isValidUid(studyInstanceUid)) {
    throw new PacsError('UID_INVALIDO', 'Identificador de estudo inválido.');
  }
  return encodeQuery({
    [TAG.queryRetrieveLevel]: 'SERIES',
    [TAG.studyInstanceUid]: studyInstanceUid,
    [TAG.seriesInstanceUid]: '',
    [TAG.seriesNumber]: '',
    [TAG.modality]: '',
    [TAG.seriesDescription]: '',
    [TAG.numberOfSeriesRelatedInstances]: '',
  });
}

/** Variantes de compatibilidade do C-FIND de série (Explicit VR e mínima sem `NumberOfSeriesRelatedInstances`). */
export function buildSeriesQueryFallbacks(studyInstanceUid: string): FallbackQuery[] {
  if (!isValidUid(studyInstanceUid)) {
    throw new PacsError('UID_INVALIDO', 'Identificador de estudo inválido.');
  }
  const padrao: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'SERIES',
    [TAG.studyInstanceUid]: studyInstanceUid,
    [TAG.seriesInstanceUid]: '',
    [TAG.seriesNumber]: '',
    [TAG.modality]: '',
    [TAG.seriesDescription]: '',
    [TAG.numberOfSeriesRelatedInstances]: '',
  };
  const minima: Record<string, string> = {
    [TAG.queryRetrieveLevel]: 'SERIES',
    [TAG.studyInstanceUid]: studyInstanceUid,
    [TAG.seriesInstanceUid]: '',
    [TAG.seriesNumber]: '',
    [TAG.modality]: '',
    [TAG.seriesDescription]: '',
  };
  return [
    { dataset: encodeQuery(padrao, true, true), explicitVr: true },
    { dataset: encodeQuery(minima, true, true), explicitVr: true },
    { dataset: encodeQuery(minima, false, false), explicitVr: false },
  ];
}

/** Identificador de C-GET para um estudo inteiro ou uma série. */
export function buildRetrieveIdentifier(studyInstanceUid: string, seriesInstanceUid?: string): Uint8Array {
  if (!isValidUid(studyInstanceUid) || (seriesInstanceUid !== undefined && !isValidUid(seriesInstanceUid))) {
    throw new PacsError('UID_INVALIDO', 'Identificador de estudo ou de série inválido.');
  }
  const values: Record<string, string> = {
    [TAG.queryRetrieveLevel]: seriesInstanceUid ? 'SERIES' : 'STUDY',
    [TAG.studyInstanceUid]: studyInstanceUid,
  };
  if (seriesInstanceUid) values[TAG.seriesInstanceUid] = seriesInstanceUid;
  return encodeQuery(values);
}

class Fields {
  private readonly elements: Map<string, Uint8Array>;
  private readonly utf8: boolean;

  constructor(dataset: Uint8Array) {
    this.elements = parseImplicit(dataset);
    const charset = decodeText(this.elements.get(TAG.specificCharacterSet)) ?? '';
    this.utf8 = charset.toUpperCase().replace(/_/g, ' ').includes('ISO IR 192');
  }

  text(tag: string): string | undefined {
    return decodeText(this.elements.get(tag), this.utf8);
  }

  integer(tag: string): number | undefined {
    const value = this.text(tag);
    if (value === undefined || !/^[+-]?\d+$/.test(value.trim())) return undefined;
    return Number(value);
  }
}

function assign<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

/** Lê uma resposta de C-FIND de estudo. `undefined` se vier sem UID de estudo válido. */
export function parseStudyResult(dataset: Uint8Array): StudyResult | undefined {
  const f = new Fields(dataset);
  const studyInstanceUid = f.text(TAG.studyInstanceUid);
  if (!isValidUid(studyInstanceUid)) return undefined;
  const result: StudyResult = {
    studyInstanceUid,
    modalities: (f.text(TAG.modalitiesInStudy) ?? '')
      .split('\\')
      .map((m) => m.trim())
      .filter((m) => m !== ''),
  };
  assign(result, 'patientName', f.text(TAG.patientName));
  assign(result, 'patientId', f.text(TAG.patientId));
  assign(result, 'patientBirthDate', f.text(TAG.patientBirthDate));
  assign(result, 'patientSex', f.text(TAG.patientSex));
  assign(result, 'studyDate', f.text(TAG.studyDate));
  assign(result, 'studyTime', f.text(TAG.studyTime));
  assign(result, 'description', f.text(TAG.studyDescription));
  assign(result, 'accessionNumber', f.text(TAG.accessionNumber));
  assign(result, 'seriesCount', f.integer(TAG.numberOfStudyRelatedSeries));
  assign(result, 'instanceCount', f.integer(TAG.numberOfStudyRelatedInstances));
  return result;
}

/** Lê uma resposta de C-FIND de série. */
export function parseSeriesResult(dataset: Uint8Array): SeriesResult | undefined {
  const f = new Fields(dataset);
  const studyInstanceUid = f.text(TAG.studyInstanceUid);
  const seriesInstanceUid = f.text(TAG.seriesInstanceUid);
  if (!isValidUid(studyInstanceUid) || !isValidUid(seriesInstanceUid)) return undefined;
  const result: SeriesResult = { studyInstanceUid, seriesInstanceUid };
  assign(result, 'seriesNumber', f.integer(TAG.seriesNumber));
  assign(result, 'modality', f.text(TAG.modality));
  assign(result, 'description', f.text(TAG.seriesDescription));
  assign(result, 'instanceCount', f.integer(TAG.numberOfSeriesRelatedInstances));
  return result;
}

/** Ordena do estudo mais recente para o mais antigo. */
export function sortStudies(studies: StudyResult[]): StudyResult[] {
  const key = (s: StudyResult) => `${s.studyDate ?? ''}${(s.studyTime ?? '').padEnd(6, '0')}`;
  return [...studies].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}
