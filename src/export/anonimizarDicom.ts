/**
 * Anonimização e reescrita binária de arquivos DICOM Part 10 (puro, sem navegador).
 *
 * Opera sempre sobre um buffer em memória (nunca altera arquivos originais).
 * Preserva PixelData intacto (inclusive sintaxes comprimidas JPEG/JPEG-LS/J2K/RLE),
 * além de peso, altura, sexo e horários técnicos (mantendo HU e SUV válidos).
 */

import { concat } from '../pacs/pdu';
import { IMPLEMENTATION_CLASS_UID, IMPLEMENTATION_VERSION_NAME, TS } from '../pacs/uids';

export interface OpcoesAnonimizacao {
  /** Rótulo colocado em PatientName e base para PatientID (padrão: "ANONIMO"). */
  rotuloPaciente?: string;
  /** Mapa compartilhado entre arquivos do mesmo exame para manter UIDs consistentes. */
  mapaUids?: Map<string, string>;
  /** Função opcional para gerar UIDs determinísticos nos testes. */
  gerarUid?: () => string;
}

export interface ResultadoAnonimizacao {
  bytes: Uint8Array;
  patientName: string;
  patientId: string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  sopClassUid?: string;
  transferSyntaxUid: string;
}

/** VRs com cabeçalho longo (12 bytes) em Explicit VR segundo DICOM PS3.5. */
const VRS_LONGOS = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'SV',
  'UC',
  'UN',
  'UR',
  'UT',
  'UV',
]);

/** Todos os VRs DICOM conhecidos (usado para detectar arquivos sem cabeçalho Part 10). */
const VRS_VALIDOS = new Set([
  'AE', 'AS', 'AT', 'CS', 'DA', 'DS', 'DT', 'FD', 'FL', 'IS', 'LO', 'LT',
  'OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'PN', 'SH', 'SL', 'SQ', 'SS', 'ST',
  'SV', 'TM', 'UC', 'UI', 'UL', 'UN', 'UR', 'US', 'UT', 'UV',
]);

/** Tags Type 2 que devem ser esvaziadas (mantidas com comprimento 0). */
const TAGS_ESVAZIAR = new Set([
  '00080050', // AccessionNumber
  '00080090', // ReferringPhysicianName
  '00100030', // PatientBirthDate
  '00200010', // StudyID
]);

/**
 * Tags Type 3 identificadoras removidas na anonimização.
 * Mantém explicitamente: PatientSex (0010,0040), PatientAge (0010,1010),
 * PatientSize (0010,1020), PatientWeight (0010,1030) e todas as datas/horários técnicos.
 */
const TAGS_REMOVER = new Set([
  '00080080', // InstitutionName
  '00080081', // InstitutionAddress
  '00080092', // ReferringPhysicianAddress
  '00080094', // ReferringPhysicianTelephoneNumbers
  '00081010', // StationName
  '00081040', // InstitutionalDepartmentName
  '00081048', // PhysiciansOfRecord
  '00081050', // PerformingPhysicianName
  '00081060', // NameOfPhysiciansReadingStudy
  '00081070', // OperatorsName
  '00100021', // IssuerOfPatientID
  '00100032', // PatientBirthTime
  '00101000', // OtherPatientIDs
  '00101001', // OtherPatientNames
  '00101002', // OtherPatientIDsSequence
  '00101005', // PatientBirthName
  '00101040', // PatientAddress
  '00101060', // PatientMotherBirthName
  '00102154', // PatientTelephoneNumbers
  '00102160', // EthnicGroup
  '00102180', // Occupation
  '001021B0', // AdditionalPatientHistory
  '00104000', // PatientComments
  '00321032', // RequestingPhysician
  '00321033', // RequestingService
  '00321060', // RequestedProcedureDescription
  '00380300', // CurrentPatientLocation
  '00380400', // PatientInstitutionResidence
  '00400275', // RequestAttributesSequence
  '00401001', // RequestedProcedureID
  '00402016', // PlacerOrderNumberImagingServiceRequest
  '00402017', // FillerOrderNumberImagingServiceRequest
]);

/** Tags de UID que são remapeadas de forma consistente dentro da mesma sessão. */
const TAGS_UID_REMAPEAR = new Set([
  '00080018', // SOPInstanceUID
  '00081155', // ReferencedSOPInstanceUID
  '0020000D', // StudyInstanceUID
  '0020000E', // SeriesInstanceUID
  '00200052', // FrameOfReferenceUID
]);

const PIXEL_DATA_TAG = '7FE00010';
const ITEM_TAG = 'FFFEE000';
const ITEM_DELIM_TAG = 'FFFEE00D';
const SEQ_DELIM_TAG = 'FFFEE0DD';
const UNDEFINED_LENGTH = 0xffffffff;

/** Gera um UID DICOM válido baseado em UUID aleatório de 128 bits (`2.25.<decimal>`). */
export function gerarUidDicom(): string {
  const random = new Uint8Array(16);
  globalThis.crypto.getRandomValues(random);
  let valor = 0n;
  for (const b of random) valor = (valor << 8n) | BigInt(b);
  return `2.25.${valor.toString(10)}`;
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0');
}

function lerTag(view: DataView, offset: number, le: boolean): { group: number; element: number; tag: string } {
  const group = view.getUint16(offset, le);
  const element = view.getUint16(offset + 2, le);
  return { group, element, tag: `${hex4(group)}${hex4(element)}` };
}

function textoParaBytes(texto: string, bytePad: number): Uint8Array {
  const limpo = texto.replace(/[^\x20-\x7e]/g, '').slice(0, 64);
  const par = limpo.length + (limpo.length % 2);
  const out = new Uint8Array(par);
  for (let i = 0; i < limpo.length; i++) out[i] = limpo.charCodeAt(i) & 0x7f;
  if (limpo.length % 2 === 1) out[limpo.length] = bytePad;
  return out;
}

function bytesParaTexto(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s.trim();
}

function codificarElemento(
  group: number,
  element: number,
  vr: string | undefined,
  valor: Uint8Array,
  explicitVr: boolean,
  le: boolean,
): Uint8Array {
  if (explicitVr && vr) {
    const longo = VRS_LONGOS.has(vr);
    const cab = new Uint8Array(longo ? 12 : 8);
    const v = new DataView(cab.buffer);
    v.setUint16(0, group, le);
    v.setUint16(2, element, le);
    cab[4] = vr.charCodeAt(0);
    cab[5] = vr.charCodeAt(1);
    if (longo) v.setUint32(8, valor.length, le);
    else v.setUint16(6, valor.length, le);
    return concat([cab, valor]);
  }
  const cab = new Uint8Array(8);
  const v = new DataView(cab.buffer);
  v.setUint16(0, group, le);
  v.setUint16(2, element, le);
  v.setUint32(4, valor.length, le);
  return concat([cab, valor]);
}

function codificarItemDelimitacao(element: number, le: boolean): Uint8Array {
  const out = new Uint8Array(8);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0xfffe, le);
  v.setUint16(2, element, le);
  v.setUint32(4, 0, le);
  return out;
}

function ehPart10(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 132 &&
    bytes[128] === 0x44 &&
    bytes[129] === 0x49 &&
    bytes[130] === 0x43 &&
    bytes[131] === 0x4d
  );
}

function detectarExplicitSemPart10(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const vr = String.fromCharCode(bytes[4]!, bytes[5]!);
  return VRS_VALIDOS.has(vr);
}

interface ContextoReescrita {
  rotulo: string;
  patientId: string;
  mapaUids: Map<string, string>;
  gerarUid: () => string;
  studyInstanceUid?: string;
  seriesInstanceUid?: string;
  sopInstanceUid?: string;
  sopClassUid?: string;
}

function mapearUid(original: string, ctx: ContextoReescrita): string {
  const limpo = original.trim();
  if (!limpo) return limpo;
  let novo = ctx.mapaUids.get(limpo);
  if (!novo) {
    novo = ctx.gerarUid();
    ctx.mapaUids.set(limpo, novo);
  }
  return novo;
}

function cabecalhoElemento(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  explicitVr: boolean,
  le: boolean,
): { group: number; element: number; tag: string; vr?: string; headerLen: number; valueLen: number } {
  const { group, element, tag } = lerTag(view, offset, le);
  if (tag === ITEM_TAG || tag === ITEM_DELIM_TAG || tag === SEQ_DELIM_TAG) {
    const valueLen = view.getUint32(offset + 4, le);
    return { group, element, tag, headerLen: 8, valueLen };
  }
  if (explicitVr) {
    const vr = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!);
    if (VRS_LONGOS.has(vr)) {
      const valueLen = view.getUint32(offset + 8, le);
      return { group, element, tag, vr, headerLen: 12, valueLen };
    }
    const valueLen = view.getUint16(offset + 6, le);
    return { group, element, tag, vr, headerLen: 8, valueLen };
  }
  const valueLen = view.getUint32(offset + 4, le);
  return { group, element, tag, headerLen: 8, valueLen };
}

/**
 * Reescreve uma sequência DICOM (`SQ`) — tanto comprimento definido quanto indefinido (`0xFFFFFFFF`).
 * Retorna os bytes reescritos do conteúdo da sequência e o novo offset logo após a sequência.
 */
function reescreverSequencia(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  explicitVr: boolean,
  le: boolean,
  indefinida: boolean,
  ctx: ContextoReescrita,
): { corpo: Uint8Array; proximo: number } {
  const partes: Uint8Array[] = [];
  let pos = start;

  while (pos + 8 <= end) {
    const item = lerTag(view, pos, le);
    if (item.tag === SEQ_DELIM_TAG) {
      pos += 8;
      if (indefinida) partes.push(codificarItemDelimitacao(0xe0dd, le));
      break;
    }
    if (item.tag !== ITEM_TAG) break;

    const itemLen = view.getUint32(pos + 4, le);
    const itemIndef = itemLen === UNDEFINED_LENGTH;
    const itemInicio = pos + 8;
    const itemLimite = itemIndef ? end : Math.min(end, itemInicio + itemLen);

    const res = reescreverDataset(bytes, view, itemInicio, itemLimite, explicitVr, le, ctx, true);
    if (itemIndef) {
      const cab = new Uint8Array(8);
      const cv = new DataView(cab.buffer);
      cv.setUint16(0, 0xfffe, le);
      cv.setUint16(2, 0xe000, le);
      cv.setUint32(4, UNDEFINED_LENGTH, le);
      partes.push(cab, res.bytes, codificarItemDelimitacao(0xe00d, le));
      pos = res.proximo;
    } else {
      const cab = new Uint8Array(8);
      const cv = new DataView(cab.buffer);
      cv.setUint16(0, 0xfffe, le);
      cv.setUint16(2, 0xe000, le);
      cv.setUint32(4, res.bytes.length, le);
      partes.push(cab, res.bytes);
      pos = itemLimite;
    }
  }

  return { corpo: concat(partes), proximo: pos };
}

function reescreverDataset(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  explicitVr: boolean,
  le: boolean,
  ctx: ContextoReescrita,
  emItem: boolean,
): { bytes: Uint8Array; proximo: number } {
  const partes: Uint8Array[] = [];
  let pos = start;

  while (pos + 8 <= end) {
    const el = cabecalhoElemento(bytes, view, pos, explicitVr, le);

    if (emItem && el.tag === ITEM_DELIM_TAG) {
      return { bytes: concat(partes), proximo: pos + 8 };
    }

    // Ao chegar em PixelData (ou qualquer tag >= 7FE0,0010 no nível raiz), copia o resto verbatim.
    if (!emItem && el.group >= 0x7fe0 && el.tag >= PIXEL_DATA_TAG) {
      partes.push(bytes.subarray(pos, end));
      return { bytes: concat(partes), proximo: end };
    }

    const valorInicio = pos + el.headerLen;
    const indefinido = el.valueLen === UNDEFINED_LENGTH;

    // Detecta sequência: VR === 'SQ' ou elemento com comprimento indefinido (antes de PixelData)
    const ehSequencia = el.vr === 'SQ' || (!explicitVr && indefinido);

    if (ehSequencia) {
      const limiteSeq = indefinido ? end : Math.min(end, valorInicio + el.valueLen);
      const resSeq = reescreverSequencia(bytes, view, valorInicio, limiteSeq, explicitVr, le, indefinido, ctx);
      pos = indefinido ? resSeq.proximo : limiteSeq;

      if (TAGS_REMOVER.has(el.tag)) continue;

      if (indefinido) {
        const cab = new Uint8Array(explicitVr ? 12 : 8);
        const cv = new DataView(cab.buffer);
        cv.setUint16(0, el.group, le);
        cv.setUint16(2, el.element, le);
        if (explicitVr) {
          cab[4] = 0x53; // 'S'
          cab[5] = 0x51; // 'Q'
          cv.setUint32(8, UNDEFINED_LENGTH, le);
        } else {
          cv.setUint32(4, UNDEFINED_LENGTH, le);
        }
        partes.push(cab, resSeq.corpo);
      } else {
        partes.push(codificarElemento(el.group, el.element, el.vr, resSeq.corpo, explicitVr, le));
      }
      continue;
    }

    const valorFim = Math.min(end, valorInicio + el.valueLen);
    const valorOriginal = bytes.subarray(valorInicio, valorFim);
    pos = valorFim;

    // Remove Group Length obsoleto dentro do dataset (evita divergência após editar tags)
    if (el.element === 0x0000) continue;

    // Captura SOP Class UID no nível raiz
    if (!emItem && el.tag === '00080016') {
      ctx.sopClassUid = bytesParaTexto(valorOriginal);
    }

    if (TAGS_REMOVER.has(el.tag)) continue;

    if (TAGS_ESVAZIAR.has(el.tag)) {
      partes.push(codificarElemento(el.group, el.element, el.vr, new Uint8Array(0), explicitVr, le));
      continue;
    }

    if (!emItem && el.tag === '00100010') {
      partes.push(
        codificarElemento(el.group, el.element, el.vr, textoParaBytes(ctx.rotulo, 0x20), explicitVr, le),
      );
      continue;
    }

    if (!emItem && el.tag === '00100020') {
      partes.push(
        codificarElemento(el.group, el.element, el.vr, textoParaBytes(ctx.patientId, 0x20), explicitVr, le),
      );
      continue;
    }

    if (TAGS_UID_REMAPEAR.has(el.tag)) {
      const uidOriginal = bytesParaTexto(valorOriginal);
      const novoUid = mapearUid(uidOriginal, ctx);
      if (!emItem) {
        if (el.tag === '0020000D') ctx.studyInstanceUid = novoUid;
        else if (el.tag === '0020000E') ctx.seriesInstanceUid = novoUid;
        else if (el.tag === '00080018') ctx.sopInstanceUid = novoUid;
      }
      partes.push(
        codificarElemento(el.group, el.element, el.vr, textoParaBytes(novoUid, 0x00), explicitVr, le),
      );
      continue;
    }

    // Demais tags permanecem intactas (peso, altura, sexo, horários, geometria, PET, privadas)
    partes.push(bytes.subarray(valorInicio - el.headerLen, valorFim));
  }

  return { bytes: concat(partes), proximo: pos };
}

function montarCabecalhoPart10(
  sopClassUid: string,
  sopInstanceUid: string,
  transferSyntaxUid: string,
): Uint8Array {
  const el = (group: number, element: number, vr: string, valor: Uint8Array) =>
    codificarElemento(group, element, vr, valor, true, true);

  const meta = concat([
    el(0x0002, 0x0001, 'OB', Uint8Array.of(0x00, 0x01)),
    el(0x0002, 0x0002, 'UI', textoParaBytes(sopClassUid, 0x00)),
    el(0x0002, 0x0003, 'UI', textoParaBytes(sopInstanceUid, 0x00)),
    el(0x0002, 0x0010, 'UI', textoParaBytes(transferSyntaxUid, 0x00)),
    el(0x0002, 0x0012, 'UI', textoParaBytes(IMPLEMENTATION_CLASS_UID, 0x00)),
    el(0x0002, 0x0013, 'SH', textoParaBytes(IMPLEMENTATION_VERSION_NAME, 0x20)),
  ]);

  const lenBytes = new Uint8Array(4);
  new DataView(lenBytes.buffer).setUint32(0, meta.length, true);
  const preambulo = new Uint8Array(132);
  preambulo.set([0x44, 0x49, 0x43, 0x4d], 128);
  return concat([preambulo, el(0x0002, 0x0000, 'UL', lenBytes), meta]);
}

/**
 * Garante que um arquivo DICOM (mesmo sem cabeçalho Part 10) tenha cabeçalho Part 10 válido,
 * sem anonimizar nada — usado na exportação de DICOMDIR sem anonimização.
 */
export function garantirPart10(
  bytes: Uint8Array,
  fallbackMeta: { sopClassUid?: string; sopInstanceUid?: string; transferSyntaxUid?: string },
): { bytes: Uint8Array; transferSyntaxUid: string } {
  if (ehPart10(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 132;
    let ts: string = TS.explicitVrLittleEndian;
    while (pos + 8 <= bytes.length) {
      const el = cabecalhoElemento(bytes, view, pos, true, true);
      if (el.group !== 0x0002) break;
      const inicio = pos + el.headerLen;
      const fim = Math.min(bytes.length, inicio + el.valueLen);
      if (el.tag === '00020010') ts = bytesParaTexto(bytes.subarray(inicio, fim)) || ts;
      pos = fim;
    }
    return { bytes, transferSyntaxUid: ts };
  }
  const explicit = detectarExplicitSemPart10(bytes);
  const ts =
    fallbackMeta.transferSyntaxUid ??
    (explicit ? TS.explicitVrLittleEndian : TS.implicitVrLittleEndian);
  const sopClass = fallbackMeta.sopClassUid ?? '1.2.840.10008.5.1.4.1.1.7';
  const sopInstance = fallbackMeta.sopInstanceUid ?? gerarUidDicom();
  return {
    bytes: concat([montarCabecalhoPart10(sopClass, sopInstance, ts), bytes]),
    transferSyntaxUid: ts,
  };
}

/**
 * Anonimiza um arquivo DICOM em memória e devolve um arquivo Part 10 válido.
 * Preserva PixelData, geometria, peso, altura, sexo e horários técnicos.
 */
export function anonimizarDicom(
  bytes: Uint8Array,
  opcoes: OpcoesAnonimizacao = {},
): ResultadoAnonimizacao {
  const rotuloBruto = (opcoes.rotuloPaciente ?? 'ANONIMO').trim() || 'ANONIMO';
  const rotulo = rotuloBruto.replace(/[^\x20-\x7e]/g, '').slice(0, 64) || 'ANONIMO';
  const patientId = rotulo.replace(/\s+/g, '_').slice(0, 32) || 'ANONIMO';

  const ctx: ContextoReescrita = {
    rotulo,
    patientId,
    mapaUids: opcoes.mapaUids ?? new Map<string, string>(),
    gerarUid: opcoes.gerarUid ?? gerarUidDicom,
  };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let datasetInicio = 0;
  let transferSyntaxUid: string = TS.implicitVrLittleEndian;
  let metaSopClass: string | undefined;
  let metaSopInstance: string | undefined;

  if (ehPart10(bytes)) {
    let pos = 132;
    transferSyntaxUid = TS.explicitVrLittleEndian;
    while (pos + 8 <= bytes.length) {
      const el = cabecalhoElemento(bytes, view, pos, true, true);
      if (el.group !== 0x0002) break;
      const inicio = pos + el.headerLen;
      const fim = Math.min(bytes.length, inicio + el.valueLen);
      const val = bytes.subarray(inicio, fim);
      if (el.tag === '00020002') metaSopClass = bytesParaTexto(val);
      else if (el.tag === '00020003') metaSopInstance = bytesParaTexto(val);
      else if (el.tag === '00020010') transferSyntaxUid = bytesParaTexto(val) || transferSyntaxUid;
      pos = fim;
    }
    datasetInicio = pos;
  } else if (detectarExplicitSemPart10(bytes)) {
    transferSyntaxUid = TS.explicitVrLittleEndian;
  }

  const explicitVr = transferSyntaxUid !== TS.implicitVrLittleEndian;
  const littleEndian = transferSyntaxUid !== '1.2.840.10008.1.2.2';

  const datasetReescrito = reescreverDataset(
    bytes,
    view,
    datasetInicio,
    bytes.length,
    explicitVr,
    littleEndian,
    ctx,
    false,
  ).bytes;

  const sopClassUid = ctx.sopClassUid ?? metaSopClass ?? '1.2.840.10008.5.1.4.1.1.7';
  const sopInstanceUid =
    ctx.sopInstanceUid ?? (metaSopInstance ? mapearUid(metaSopInstance, ctx) : ctx.gerarUid());

  const cabecalho = montarCabecalhoPart10(sopClassUid, sopInstanceUid, transferSyntaxUid);

  return {
    bytes: concat([cabecalho, datasetReescrito]),
    patientName: rotulo,
    patientId,
    studyInstanceUid: ctx.studyInstanceUid,
    seriesInstanceUid: ctx.seriesInstanceUid,
    sopInstanceUid,
    sopClassUid,
    transferSyntaxUid,
  };
}
