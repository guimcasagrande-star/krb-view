/** UIDs do padrão DICOM usados na comunicação com o PACS. */

export const UID = {
  applicationContext: '1.2.840.10008.3.1.1.1',
  verification: '1.2.840.10008.1.1',
  studyRootFind: '1.2.840.10008.5.1.4.1.2.2.1',
  studyRootGet: '1.2.840.10008.5.1.4.1.2.2.3',
} as const;

export const TS = {
  implicitVrLittleEndian: '1.2.840.10008.1.2',
  explicitVrLittleEndian: '1.2.840.10008.1.2.1',
  jpegBaseline: '1.2.840.10008.1.2.4.50',
  jpegLosslessSv1: '1.2.840.10008.1.2.4.70',
  jpegLsLossless: '1.2.840.10008.1.2.4.80',
  jpeg2000Lossless: '1.2.840.10008.1.2.4.90',
  jpeg2000: '1.2.840.10008.1.2.4.91',
  rleLossless: '1.2.840.10008.1.2.5',
} as const;

/** Identificação deste programa nas associações e nos arquivos gravados. */
export const IMPLEMENTATION_CLASS_UID = '2.25.221983067482915530764119850327714096381';
export const IMPLEMENTATION_VERSION_NAME = 'VISDICOM_010';

/** Classes de imagem: aceitas sem compressão e nas compressões que o visualizador abre. */
export const IMAGE_STORAGE_CLASSES: readonly string[] = [
  '1.2.840.10008.5.1.4.1.1.2', // CT
  '1.2.840.10008.5.1.4.1.1.2.1', // CT Enhanced
  '1.2.840.10008.5.1.4.1.1.4', // RM
  '1.2.840.10008.5.1.4.1.1.4.1', // RM Enhanced
  '1.2.840.10008.5.1.4.1.1.128', // PET
  '1.2.840.10008.5.1.4.1.1.130', // PET Enhanced
  '1.2.840.10008.5.1.4.1.1.20', // Medicina nuclear
  '1.2.840.10008.5.1.4.1.1.6.1', // Ultrassom
  '1.2.840.10008.5.1.4.1.1.3.1', // Ultrassom multiframe
  '1.2.840.10008.5.1.4.1.1.7', // Captura secundária
  '1.2.840.10008.5.1.4.1.1.1', // CR
  '1.2.840.10008.5.1.4.1.1.1.1', // DX
  '1.2.840.10008.5.1.4.1.1.1.2', // Mamografia
  '1.2.840.10008.5.1.4.1.1.13.1.3', // Tomossíntese
  '1.2.840.10008.5.1.4.1.1.12.1', // Angiografia
  '1.2.840.10008.5.1.4.1.1.12.2', // Fluoroscopia
];

/** Classes sem imagem comprimida: aceitas só sem compressão. */
export const OTHER_STORAGE_CLASSES: readonly string[] = [
  '1.2.840.10008.5.1.4.1.1.66.4', // Segmentação
  '1.2.840.10008.5.1.4.1.1.481.3', // RT Structure Set
  '1.2.840.10008.5.1.4.1.1.481.2', // RT Dose
  '1.2.840.10008.5.1.4.1.1.88.11', // SR básico
  '1.2.840.10008.5.1.4.1.1.88.22', // SR Enhanced
  '1.2.840.10008.5.1.4.1.1.88.33', // SR Comprehensive
  '1.2.840.10008.5.1.4.1.1.88.67', // SR de dose de radiação
  '1.2.840.10008.5.1.4.1.1.88.59', // Key Object Selection
  '1.2.840.10008.5.1.4.1.1.104.1', // PDF encapsulado
  '1.2.840.10008.5.1.4.1.1.11.1', // Presentation State
];

/** Cada grupo vira um contexto de apresentação separado, para o PACS poder enviar sem recomprimir. */
export const IMAGE_TRANSFER_SYNTAX_GROUPS: readonly (readonly string[])[] = [
  [TS.explicitVrLittleEndian, TS.implicitVrLittleEndian],
  [TS.jpegLosslessSv1],
  [TS.jpeg2000Lossless],
  [TS.jpeg2000],
  [TS.jpegLsLossless],
  [TS.jpegBaseline],
  [TS.rleLossless],
];

const UID_PATTERN = /^[0-9]+(\.[0-9]+)*$/;

/** UID DICOM válido: só dígitos e pontos, até 64 caracteres. */
export function isValidUid(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && value.length <= 64 && UID_PATTERN.test(value);
}
