/**
 * Leitura do cabeçalho de um arquivo DICOM com dicom-parser.
 *
 * Só o cabeçalho é lido (a leitura para antes do PixelData), para que indexar
 * uma pasta com milhares de arquivos seja rápido.
 */

import * as dicomParserModule from 'dicom-parser';
import type { DataSet } from 'dicom-parser';
import type { InstanceMeta, Orientation, PetMeta, Vec3 } from './types';

export type ParseOutcome =
  | {
      ok: true;
      meta: InstanceMeta;
      /** Falso se os bytes acabaram antes do PixelData: tags podem estar faltando. */
      complete: boolean;
    }
  | { ok: false; reason: string };

// O dicom-parser é distribuído como UMD: dependendo de quem carrega (Vite no
// navegador ou Node nos testes), as funções vêm no módulo ou em `default`.
const dicomParser: typeof dicomParserModule =
  (dicomParserModule as unknown as { default?: typeof dicomParserModule }).default ??
  dicomParserModule;

const PIXEL_DATA = 'x7fe00010';
const MEDIA_STORAGE_DIRECTORY = '1.2.840.10008.1.3.10';
const IMPLICIT_VR_LITTLE_ENDIAN = '1.2.840.10008.1.2';

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** SpecificCharacterSet (0008,0005) -> nome aceito pelo TextDecoder. */
function decoderLabel(charset: string | undefined): string {
  const first = (charset ?? '').split('\\')[0]!.trim().toUpperCase().replace(/_/g, ' ');
  switch (first) {
    case 'ISO IR 192':
      return 'utf-8';
    case 'ISO IR 101':
      return 'iso-8859-2';
    case 'ISO IR 109':
      return 'iso-8859-3';
    case 'ISO IR 110':
      return 'iso-8859-4';
    case 'ISO IR 144':
      return 'iso-8859-5';
    case 'ISO IR 127':
      return 'iso-8859-6';
    case 'ISO IR 126':
      return 'iso-8859-7';
    case 'ISO IR 138':
      return 'iso-8859-8';
    case 'ISO IR 148':
      return 'iso-8859-9';
    case 'GB18030':
      return 'gb18030';
    case 'GBK':
      return 'gbk';
    default:
      // ISO_IR 100 (Latin-1), ISO_IR 6 (ASCII) e ausente.
      return 'latin1';
  }
}

class Reader {
  private readonly ds: DataSet;
  private readonly decoder: TextDecoder;

  constructor(ds: DataSet, decoder: TextDecoder) {
    this.ds = ds;
    this.decoder = decoder;
  }

  has(tag: string): boolean {
    const el = this.ds.elements[tag];
    return el !== undefined && el.length > 0;
  }

  /** Texto decodificado conforme o conjunto de caracteres do arquivo. */
  text(tag: string): string | undefined {
    const el = this.ds.elements[tag];
    if (!el || el.length <= 0) return undefined;
    const bytes = this.ds.byteArray.subarray(el.dataOffset, el.dataOffset + el.length);
    const value = this.decoder.decode(bytes).replace(/[\0 ]+$/, '').replace(/^ +/, '');
    return value === '' ? undefined : value;
  }

  /** Valores de um campo de texto com múltiplos valores (separados por '\'). */
  strings(tag: string): string[] {
    const value = this.text(tag);
    if (value === undefined) return [];
    return value.split('\\').map((v) => v.trim());
  }

  /** Números de um campo DS/IS (texto). */
  numbers(tag: string): number[] {
    const out: number[] = [];
    for (const s of this.strings(tag)) {
      const n = Number(s);
      if (s === '' || !Number.isFinite(n)) return [];
      out.push(n);
    }
    return out;
  }

  number(tag: string): number | undefined {
    return this.numbers(tag)[0];
  }

  uint16(tag: string): number | undefined {
    const el = this.ds.elements[tag];
    if (!el || el.length < 2) return undefined;
    return this.ds.uint16(tag);
  }

  double(tag: string): number | undefined {
    const el = this.ds.elements[tag];
    if (!el || el.length < 8) return undefined;
    const v = this.ds.double(tag);
    return v !== undefined && Number.isFinite(v) ? v : undefined;
  }

  /** Primeiro item de uma sequência. */
  firstItem(tag: string): Reader | undefined {
    const item = this.ds.elements[tag]?.items?.[0]?.dataSet;
    return item ? new Reader(item, this.decoder) : undefined;
  }

  /**
   * Localiza o bloco reservado por um criador de tags privadas.
   * Ex.: criador 'GEMS_PETD_01' em (0009,0010) -> bloco '10' -> tags (0009,10xx).
   */
  privateBlock(group: string, creator: string): string | undefined {
    for (let slot = 0x10; slot <= 0xff; slot++) {
      const hex = slot.toString(16).padStart(2, '0');
      const value = this.text(`x${group}00${hex}`);
      if (value !== undefined && value.trim().toUpperCase() === creator.toUpperCase()) return hex;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

function vec3(values: number[]): Vec3 | undefined {
  return values.length === 3 ? [values[0]!, values[1]!, values[2]!] : undefined;
}

function orientation(values: number[]): Orientation | undefined {
  return values.length === 6
    ? [values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!]
    : undefined;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function extractPet(r: Reader): PetMeta {
  const pet: PetMeta = { correctedImage: r.strings('x00280051') };
  set(pet, 'units', r.text('x00541001'));
  set(pet, 'decayCorrection', r.text('x00541102'));
  set(pet, 'frameReferenceTimeMs', r.number('x00541300'));
  set(pet, 'actualFrameDurationMs', r.number('x00181242'));

  const radio = r.firstItem('x00540016');
  if (radio) {
    set(pet, 'radionuclideTotalDoseBq', radio.number('x00181074'));
    set(pet, 'radionuclideHalfLifeS', radio.number('x00181075'));
    set(pet, 'radiopharmaceuticalStartTime', radio.text('x00181072'));
    set(pet, 'radiopharmaceuticalStartDateTime', radio.text('x00181078'));
    set(pet, 'radiopharmaceutical', radio.text('x00180031'));
  }

  const ge = r.privateBlock('0009', 'GEMS_PETD_01');
  if (ge) set(pet, 'gePrivateScanDateTime', r.text(`x0009${ge}0d`));

  const philips = r.privateBlock('7053', 'Philips PET Private Group');
  if (philips) {
    set(pet, 'philipsSuvScaleFactor', r.number(`x7053${philips}00`));
    set(pet, 'philipsActivityConcentrationScaleFactor', r.number(`x7053${philips}09`));
  }
  return pet;
}

function extract(ds: DataSet, fileId: string): InstanceMeta {
  const latin1 = new Reader(ds, new TextDecoder('latin1'));
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(decoderLabel(latin1.text('x00080005')));
  } catch {
    decoder = new TextDecoder('latin1');
  }
  const r = new Reader(ds, decoder);

  const meta: InstanceMeta = {
    fileId,
    imageType: r.strings('x00080008'),
    windowCenter: r.numbers('x00281050'),
    windowWidth: r.numbers('x00281051'),
  };

  set(meta, 'sopInstanceUid', r.text('x00080018'));
  set(meta, 'sopClassUid', r.text('x00080016'));
  set(meta, 'transferSyntaxUid', r.text('x00020010'));

  set(meta, 'patientId', r.text('x00100020'));
  set(meta, 'patientName', r.text('x00100010'));
  set(meta, 'patientBirthDate', r.text('x00100030'));
  set(meta, 'patientSex', r.text('x00100040'));
  set(meta, 'patientWeightKg', r.number('x00101030'));
  set(meta, 'patientSizeM', r.number('x00101020'));

  set(meta, 'studyInstanceUid', r.text('x0020000d'));
  set(meta, 'studyDate', r.text('x00080020'));
  set(meta, 'studyTime', r.text('x00080030'));
  set(meta, 'studyDescription', r.text('x00081030'));
  set(meta, 'accessionNumber', r.text('x00080050'));

  set(meta, 'seriesInstanceUid', r.text('x0020000e'));
  set(meta, 'seriesNumber', r.number('x00200011'));
  set(meta, 'seriesDescription', r.text('x0008103e'));
  set(meta, 'seriesDate', r.text('x00080021'));
  set(meta, 'seriesTime', r.text('x00080031'));
  set(meta, 'modality', r.text('x00080060'));
  set(meta, 'manufacturer', r.text('x00080070'));
  set(meta, 'manufacturerModelName', r.text('x00081090'));
  set(meta, 'bodyPartExamined', r.text('x00180015'));
  set(meta, 'timezoneOffsetFromUtc', r.text('x00080201'));

  set(meta, 'instanceNumber', r.number('x00200013'));
  set(meta, 'acquisitionNumber', r.number('x00200012'));
  set(meta, 'acquisitionDate', r.text('x00080022'));
  set(meta, 'acquisitionTime', r.text('x00080032'));
  set(meta, 'contentDate', r.text('x00080023'));
  set(meta, 'contentTime', r.text('x00080033'));

  set(meta, 'rows', r.uint16('x00280010'));
  set(meta, 'columns', r.uint16('x00280011'));
  set(meta, 'numberOfFrames', r.number('x00280008'));
  const spacing = r.numbers('x00280030');
  if (spacing.length === 2 && spacing[0]! > 0 && spacing[1]! > 0) {
    meta.pixelSpacing = [spacing[0]!, spacing[1]!];
  }
  set(meta, 'sliceThickness', r.number('x00180050'));
  set(meta, 'spacingBetweenSlices', r.number('x00180088'));
  set(meta, 'sliceLocation', r.number('x00201041'));
  set(meta, 'imagePositionPatient', vec3(r.numbers('x00200032')));
  set(meta, 'imageOrientationPatient', orientation(r.numbers('x00200037')));
  set(meta, 'frameOfReferenceUid', r.text('x00200052'));
  set(meta, 'gantryTilt', r.number('x00181120'));

  set(meta, 'samplesPerPixel', r.uint16('x00280002'));
  set(meta, 'photometricInterpretation', r.text('x00280004'));
  set(meta, 'bitsAllocated', r.uint16('x00280100'));
  set(meta, 'bitsStored', r.uint16('x00280101'));
  set(meta, 'pixelRepresentation', r.uint16('x00280103'));
  set(meta, 'rescaleSlope', r.number('x00281053'));
  set(meta, 'rescaleIntercept', r.number('x00281052'));

  set(meta, 'temporalPositionIdentifier', r.number('x00200100'));
  set(meta, 'echoTime', r.number('x00180081'));
  set(meta, 'diffusionBValue', r.double('x00189087'));
  set(meta, 'triggerTime', r.number('x00181060'));

  if (meta.modality === 'PT') meta.pet = extractPet(r);
  return meta;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function hasDicmPrefix(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 132 &&
    bytes[128] === 0x44 && // D
    bytes[129] === 0x49 && // I
    bytes[130] === 0x43 && // C
    bytes[131] === 0x4d // M
  );
}

function tryParse(
  bytes: Uint8Array,
  options: { untilTag: string; TransferSyntaxUID?: string },
): { ds?: DataSet; threw: boolean } {
  try {
    return { ds: dicomParser.parseDicom(bytes, options), threw: false };
  } catch (error) {
    // O dicom-parser lança { exception, dataSet } com o que conseguiu ler.
    const partial = (error as { dataSet?: DataSet } | undefined)?.dataSet;
    return partial ? { ds: partial, threw: true } : { threw: true };
  }
}

/**
 * Lê o cabeçalho a partir dos bytes do arquivo (ou do começo dele).
 *
 * `complete: false` significa que os bytes acabaram antes do PixelData. Nesse
 * caso, quem chamou deve tentar de novo com o arquivo inteiro.
 */
export function parseHeader(bytes: Uint8Array, fileId: string): ParseOutcome {
  let parsed: { ds?: DataSet; threw: boolean };
  if (hasDicmPrefix(bytes)) {
    parsed = tryParse(bytes, { untilTag: PIXEL_DATA });
  } else {
    // Arquivo sem o cabeçalho Part 10 (comum em exportações antigas): tenta como
    // dataset "cru" em Implicit VR Little Endian.
    parsed = tryParse(bytes, { untilTag: PIXEL_DATA, TransferSyntaxUID: IMPLICIT_VR_LITTLE_ENDIAN });
  }

  const ds = parsed.ds;
  if (!ds) return { ok: false, reason: 'Não é um arquivo DICOM.' };

  let meta: InstanceMeta;
  try {
    meta = extract(ds, fileId);
  } catch {
    return { ok: false, reason: 'Cabeçalho DICOM ilegível.' };
  }

  if (!hasDicmPrefix(bytes) && !meta.sopClassUid && !meta.studyInstanceUid) {
    return { ok: false, reason: 'Não é um arquivo DICOM.' };
  }
  if (meta.sopClassUid === MEDIA_STORAGE_DIRECTORY) {
    return { ok: false, reason: 'DICOMDIR (índice de mídia), não é uma imagem.' };
  }
  if (!meta.studyInstanceUid && !meta.seriesInstanceUid && !meta.sopInstanceUid) {
    return { ok: false, reason: 'Arquivo DICOM sem identificação de estudo e série.' };
  }

  const complete = !parsed.threw && ds.elements[PIXEL_DATA] !== undefined;
  return { ok: true, meta, complete };
}

/**
 * Lê o cabeçalho de um `File`/`Blob` lendo primeiro só o começo do arquivo.
 * Se o cabeçalho não couber nesse trecho, lê o arquivo inteiro.
 */
export async function readHeaderFromBlob(
  blob: Blob,
  fileId: string,
  initialBytes = 256 * 1024,
): Promise<ParseOutcome> {
  if (blob.size < 132) return { ok: false, reason: 'Arquivo pequeno demais para ser DICOM.' };

  const partial = blob.size > initialBytes;
  const head = new Uint8Array(await blob.slice(0, initialBytes).arrayBuffer());
  const first = parseHeader(head, fileId);
  if (!partial) return first;
  if (first.ok && first.complete) return first;
  // Com o arquivo inteiro em mãos, um cabeçalho sem PixelData (laudo
  // estruturado, por exemplo) é legítimo; `complete` segue o que o parser achou.
  if (!first.ok && !hasDicmPrefix(head)) return first;

  const all = new Uint8Array(await blob.arrayBuffer());
  return parseHeader(all, fileId);
}
