/**
 * Tipos compartilhados por todo o projeto.
 *
 * Tudo aqui é dado puro (sem dependência de biblioteca), para que os módulos
 * de lógica possam ser testados sem navegador e sem Cornerstone.
 */

export type Vec3 = [number, number, number];

/** Seis cossenos diretores: linha (x,y,z) e coluna (x,y,z). */
export type Orientation = [number, number, number, number, number, number];

/** Dados de PET lidos do cabeçalho. Campos ausentes ficam `undefined`, nunca com valor padrão. */
export interface PetMeta {
  /** (0054,1001) BQML, CNTS, GML... */
  units?: string;
  /** (0028,0051) ex.: ['DECY', 'ATTN', 'SCAT'] */
  correctedImage: string[];
  /** (0054,1102) START, ADMIN ou NONE */
  decayCorrection?: string;
  /** (0018,1074) dentro de (0054,0016), em Bq */
  radionuclideTotalDoseBq?: number;
  /** (0018,1075) dentro de (0054,0016), em segundos */
  radionuclideHalfLifeS?: number;
  /** (0018,1072) dentro de (0054,0016), formato TM */
  radiopharmaceuticalStartTime?: string;
  /** (0018,1078) dentro de (0054,0016), formato DT */
  radiopharmaceuticalStartDateTime?: string;
  /** (0018,0031) dentro de (0054,0016) */
  radiopharmaceutical?: string;
  /** (0054,1300) em ms */
  frameReferenceTimeMs?: number;
  /** (0018,1242) em ms */
  actualFrameDurationMs?: number;
  /** GE: (0009,100D) data/hora do início do scan, formato DT */
  gePrivateScanDateTime?: string;
  /** Philips: (7053,1000) */
  philipsSuvScaleFactor?: number;
  /** Philips: (7053,1009) */
  philipsActivityConcentrationScaleFactor?: number;
}

/** Cabeçalho de um arquivo DICOM, já convertido para tipos simples. */
export interface InstanceMeta {
  /** Identificador dado por quem leu o arquivo (caminho relativo, por exemplo). */
  fileId: string;

  sopInstanceUid?: string;
  sopClassUid?: string;
  transferSyntaxUid?: string;

  patientId?: string;
  patientName?: string;
  patientBirthDate?: string;
  patientSex?: string;
  /** (0010,1030) em kg */
  patientWeightKg?: number;
  /** (0010,1020) em metros */
  patientSizeM?: number;

  studyInstanceUid?: string;
  studyDate?: string;
  studyTime?: string;
  studyDescription?: string;
  accessionNumber?: string;

  seriesInstanceUid?: string;
  seriesNumber?: number;
  seriesDescription?: string;
  seriesDate?: string;
  seriesTime?: string;
  modality?: string;
  manufacturer?: string;
  manufacturerModelName?: string;
  bodyPartExamined?: string;
  /** (0008,0201) ex.: '-0300' */
  timezoneOffsetFromUtc?: string;

  instanceNumber?: number;
  acquisitionNumber?: number;
  acquisitionDate?: string;
  acquisitionTime?: string;
  contentDate?: string;
  contentTime?: string;
  imageType: string[];

  rows?: number;
  columns?: number;
  numberOfFrames?: number;
  /** [espaçamento entre linhas, espaçamento entre colunas] em mm */
  pixelSpacing?: [number, number];
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  sliceLocation?: number;
  imagePositionPatient?: Vec3;
  imageOrientationPatient?: Orientation;
  frameOfReferenceUid?: string;
  /** (0018,1120) em graus */
  gantryTilt?: number;

  samplesPerPixel?: number;
  photometricInterpretation?: string;
  bitsAllocated?: number;
  bitsStored?: number;
  pixelRepresentation?: number;
  rescaleSlope?: number;
  rescaleIntercept?: number;
  windowCenter: number[];
  windowWidth: number[];

  /** Usados para separar séries com várias fases/ecos/valores de b. */
  temporalPositionIdentifier?: number;
  echoTime?: number;
  diffusionBValue?: number;
  triggerTime?: number;

  pet?: PetMeta;
}

/** Problema encontrado ao analisar um conjunto de imagens. */
export interface Issue {
  /** Código estável, para a interface decidir o que fazer. */
  code: string;
  /** Mensagem em português, pronta para mostrar ao usuário. */
  message: string;
}
