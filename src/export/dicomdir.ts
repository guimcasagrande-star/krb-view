/**
 * Gerador puro de arquivo `DICOMDIR` (DICOM PS3.10 / PS3.11 — Media Storage Directory Storage).
 *
 * Monta a árvore PATIENT → STUDY → SERIES → IMAGE em Explicit VR Little Endian com offsets
 * absolutos exatos em bytes, compatível com RadiAnt, Weasis, OsiriX/Horos e KRB View.
 */

import { concat } from '../pacs/pdu';
import { IMPLEMENTATION_CLASS_UID, IMPLEMENTATION_VERSION_NAME, TS } from '../pacs/uids';
import { gerarUidDicom } from './anonimizarDicom';

const MEDIA_STORAGE_DIRECTORY_SOP_CLASS = '1.2.840.10008.1.3.10';
const UTF8 = new TextEncoder();

export interface EntradaImagemDicomdir {
  /** Componentes do caminho relativo (ex.: ['DICOM', 'ST000001', 'SE000001', 'IM000001']). */
  caminhoRelativo: string[];
  sopClassUid: string;
  sopInstanceUid: string;
  transferSyntaxUid: string;
  instanceNumber?: number;
}

export interface EntradaSerieDicomdir {
  seriesInstanceUid: string;
  modality: string;
  seriesNumber?: number;
  description?: string;
  imagens: EntradaImagemDicomdir[];
}

export interface EntradaEstudoDicomdir {
  studyInstanceUid: string;
  studyDate?: string;
  studyTime?: string;
  accessionNumber?: string;
  description?: string;
  studyId?: string;
  series: EntradaSerieDicomdir[];
}

export interface EntradaPacienteDicomdir {
  patientName: string;
  patientId: string;
  birthDate?: string;
  sex?: string;
  estudos: EntradaEstudoDicomdir[];
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n & 0xffff, true);
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function bytesTextoUtf8(valor: string, bytePad = 0x20, maxBytes = 64): Uint8Array {
  const enc = UTF8.encode(valor);
  const cortado = enc.length > maxBytes ? enc.subarray(0, maxBytes) : enc;
  if (cortado.length % 2 === 0) return cortado;
  const out = new Uint8Array(cortado.length + 1);
  out.set(cortado, 0);
  out[cortado.length] = bytePad;
  return out;
}

function bytesAscii(valor: string, bytePad = 0x20): Uint8Array {
  const limpo = valor.replace(/[^\x20-\x7e]/g, '');
  const par = limpo.length + (limpo.length % 2);
  const out = new Uint8Array(par);
  for (let i = 0; i < limpo.length; i++) out[i] = limpo.charCodeAt(i) & 0x7f;
  if (limpo.length % 2 === 1) out[limpo.length] = bytePad;
  return out;
}

function elExplicit(group: number, element: number, vr: string, valor: Uint8Array): Uint8Array {
  const longo = vr === 'OB' || vr === 'SQ' || vr === 'UN';
  const cab = new Uint8Array(longo ? 12 : 8);
  const v = new DataView(cab.buffer);
  v.setUint16(0, group, true);
  v.setUint16(2, element, true);
  cab[4] = vr.charCodeAt(0);
  cab[5] = vr.charCodeAt(1);
  if (longo) v.setUint32(8, valor.length, true);
  else v.setUint16(6, valor.length, true);
  return concat([cab, valor]);
}

interface RegistroNo {
  /** Bytes completos do item (começando em FFFE,E000). */
  itemBytes: Uint8Array;
  /** Índice do próximo irmão no mesmo nível, ou -1. */
  proximoIrmao: number;
  /** Índice do primeiro filho no nível abaixo, ou -1. */
  primeiroFilho: number;
  /** Offset absoluto em bytes desde o início do arquivo DICOMDIR (preenchido na passagem 2). */
  offset: number;
}

function criarRegistro(tipo: 'PATIENT' | 'STUDY' | 'SERIES' | 'IMAGE', extras: Uint8Array[]): Uint8Array {
  // Os 4 primeiros elementos têm tamanho fixo para permitir patch exato dos offsets:
  // item header: 8 bytes (0..8)
  // (0004,1400) UL: 8 + 4 bytes -> valor em offset + 16
  // (0004,1410) US: 8 + 2 bytes -> 20..30
  // (0004,1420) UL: 8 + 4 bytes -> valor em offset + 38
  // (0004,1430) CS: tipo
  const corpo = concat([
    elExplicit(0x0004, 0x1400, 'UL', u32le(0)),
    elExplicit(0x0004, 0x1410, 'US', u16le(0xffff)),
    elExplicit(0x0004, 0x1420, 'UL', u32le(0)),
    elExplicit(0x0004, 0x1430, 'CS', bytesAscii(tipo, 0x20)),
    ...extras,
  ]);
  const cabItem = new Uint8Array(8);
  const v = new DataView(cabItem.buffer);
  v.setUint16(0, 0xfffe, true);
  v.setUint16(2, 0xe000, true);
  v.setUint32(4, corpo.length, true);
  return concat([cabItem, corpo]);
}

/**
 * Gera os bytes de um arquivo `DICOMDIR` completo e válido para os pacientes/estudos/séries/imagens informados.
 */
export function gerarDicomdir(
  pacientes: EntradaPacienteDicomdir[],
  opcoes: { fileSetId?: string; sopInstanceUid?: string } = {},
): Uint8Array {
  const fileSetId = (opcoes.fileSetId ?? 'KRBVIEW').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16) || 'KRBVIEW';
  const sopInstanceUid = opcoes.sopInstanceUid ?? gerarUidDicom();

  // 1. File Meta Information (grupo 0002)
  const metaCorpo = concat([
    elExplicit(0x0002, 0x0001, 'OB', Uint8Array.of(0x00, 0x01)),
    elExplicit(0x0002, 0x0002, 'UI', bytesAscii(MEDIA_STORAGE_DIRECTORY_SOP_CLASS, 0x00)),
    elExplicit(0x0002, 0x0003, 'UI', bytesAscii(sopInstanceUid, 0x00)),
    elExplicit(0x0002, 0x0010, 'UI', bytesAscii(TS.explicitVrLittleEndian, 0x00)),
    elExplicit(0x0002, 0x0012, 'UI', bytesAscii(IMPLEMENTATION_CLASS_UID, 0x00)),
    elExplicit(0x0002, 0x0013, 'SH', bytesAscii(IMPLEMENTATION_VERSION_NAME, 0x20)),
  ]);
  const preambulo = new Uint8Array(132);
  preambulo.set([0x44, 0x49, 0x43, 0x4d], 128);
  const metaCompleto = concat([
    preambulo,
    elExplicit(0x0002, 0x0000, 'UL', u32le(metaCorpo.length)),
    metaCorpo,
  ]);

  // 2. Cabeçalho raiz do grupo 0004 (antes da sequência 0004,1220)
  const elFileSet = elExplicit(0x0004, 0x1130, 'CS', bytesAscii(fileSetId, 0x20));
  const elFirstRoot = elExplicit(0x0004, 0x1200, 'UL', u32le(0));
  const elLastRoot = elExplicit(0x0004, 0x1202, 'UL', u32le(0));
  const elConsistency = elExplicit(0x0004, 0x1212, 'US', u16le(0x0000));
  const cabSeq = new Uint8Array(12);
  const vSeq = new DataView(cabSeq.buffer);
  vSeq.setUint16(0, 0x0004, true);
  vSeq.setUint16(2, 0x1220, true);
  cabSeq[4] = 0x53; // 'S'
  cabSeq[5] = 0x51; // 'Q'
  vSeq.setUint32(8, 0xffffffff, true); // comprimento indefinido (padrão DICOMDIR)

  const posFirstRootVal = metaCompleto.length + elFileSet.length + 8;
  const posLastRootVal = posFirstRootVal + 12;
  const cabecalhoAteSeq = concat([metaCompleto, elFileSet, elFirstRoot, elLastRoot, elConsistency, cabSeq]);

  // 3. Monta lista linear de registros mantendo vínculos de irmão e primeiro filho
  const registros: RegistroNo[] = [];
  const indicesPacientes: number[] = [];

  for (const pac of pacientes) {
    const extrasPac: Uint8Array[] = [
      elExplicit(0x0008, 0x0005, 'CS', bytesAscii('ISO_IR 192', 0x20)),
      elExplicit(0x0010, 0x0010, 'PN', bytesTextoUtf8(pac.patientName || 'ANONIMO', 0x20, 64)),
      elExplicit(0x0010, 0x0020, 'LO', bytesTextoUtf8(pac.patientId || 'ANONIMO', 0x20, 64)),
    ];
    if (pac.birthDate) extrasPac.push(elExplicit(0x0010, 0x0030, 'DA', bytesAscii(pac.birthDate, 0x20)));
    if (pac.sex) extrasPac.push(elExplicit(0x0010, 0x0040, 'CS', bytesAscii(pac.sex, 0x20)));

    const idxPac = registros.length;
    registros.push({ itemBytes: criarRegistro('PATIENT', extrasPac), proximoIrmao: -1, primeiroFilho: -1, offset: 0 });
    if (indicesPacientes.length > 0) {
      registros[indicesPacientes[indicesPacientes.length - 1]!]!.proximoIrmao = idxPac;
    }
    indicesPacientes.push(idxPac);

    const indicesEstudos: number[] = [];
    for (const est of pac.estudos) {
      const extrasEst: Uint8Array[] = [
        elExplicit(0x0008, 0x0005, 'CS', bytesAscii('ISO_IR 192', 0x20)),
        elExplicit(0x0008, 0x0020, 'DA', bytesAscii(est.studyDate ?? '', 0x20)),
        elExplicit(0x0008, 0x0030, 'TM', bytesAscii(est.studyTime ?? '', 0x20)),
        elExplicit(0x0008, 0x0050, 'SH', bytesAscii(est.accessionNumber ?? '', 0x20)),
        elExplicit(0x0008, 0x1030, 'LO', bytesTextoUtf8(est.description ?? '', 0x20, 64)),
        elExplicit(0x0020, 0x000d, 'UI', bytesAscii(est.studyInstanceUid, 0x00)),
        elExplicit(0x0020, 0x0010, 'SH', bytesAscii(est.studyId ?? '', 0x20)),
      ];
      const idxEst = registros.length;
      registros.push({ itemBytes: criarRegistro('STUDY', extrasEst), proximoIrmao: -1, primeiroFilho: -1, offset: 0 });
      if (indicesEstudos.length === 0) registros[idxPac]!.primeiroFilho = idxEst;
      else registros[indicesEstudos[indicesEstudos.length - 1]!]!.proximoIrmao = idxEst;
      indicesEstudos.push(idxEst);

      const indicesSeries: number[] = [];
      for (const ser of est.series) {
        const extrasSer: Uint8Array[] = [
          elExplicit(0x0008, 0x0005, 'CS', bytesAscii('ISO_IR 192', 0x20)),
          elExplicit(0x0008, 0x0060, 'CS', bytesAscii(ser.modality || 'OT', 0x20)),
          elExplicit(0x0008, 0x103e, 'LO', bytesTextoUtf8(ser.description ?? '', 0x20, 64)),
          elExplicit(0x0020, 0x000e, 'UI', bytesAscii(ser.seriesInstanceUid, 0x00)),
          elExplicit(0x0020, 0x0011, 'IS', bytesAscii(ser.seriesNumber !== undefined ? String(ser.seriesNumber) : '', 0x20)),
        ];
        const idxSer = registros.length;
        registros.push({ itemBytes: criarRegistro('SERIES', extrasSer), proximoIrmao: -1, primeiroFilho: -1, offset: 0 });
        if (indicesSeries.length === 0) registros[idxEst]!.primeiroFilho = idxSer;
        else registros[indicesSeries[indicesSeries.length - 1]!]!.proximoIrmao = idxSer;
        indicesSeries.push(idxSer);

        const indicesImgs: number[] = [];
        for (const img of ser.imagens) {
          const refFileId = img.caminhoRelativo.join('\\');
          const extrasImg: Uint8Array[] = [
            elExplicit(0x0004, 0x1500, 'CS', bytesAscii(refFileId, 0x20)),
            elExplicit(0x0004, 0x1510, 'UI', bytesAscii(img.sopClassUid, 0x00)),
            elExplicit(0x0004, 0x1511, 'UI', bytesAscii(img.sopInstanceUid, 0x00)),
            elExplicit(0x0004, 0x1512, 'UI', bytesAscii(img.transferSyntaxUid, 0x00)),
            elExplicit(0x0020, 0x0013, 'IS', bytesAscii(img.instanceNumber !== undefined ? String(img.instanceNumber) : '', 0x20)),
          ];
          const idxImg = registros.length;
          registros.push({ itemBytes: criarRegistro('IMAGE', extrasImg), proximoIrmao: -1, primeiroFilho: -1, offset: 0 });
          if (indicesImgs.length === 0) registros[idxSer]!.primeiroFilho = idxImg;
          else registros[indicesImgs[indicesImgs.length - 1]!]!.proximoIrmao = idxImg;
          indicesImgs.push(idxImg);
        }
      }
    }
  }

  // 4. Passagem 1: calcula offset absoluto de cada item
  let cursor = cabecalhoAteSeq.length;
  for (const reg of registros) {
    reg.offset = cursor;
    cursor += reg.itemBytes.length;
  }

  // 5. Delimitador de fim da sequência (FFFE,E0DD)
  const fimSeq = new Uint8Array(8);
  const vFim = new DataView(fimSeq.buffer);
  vFim.setUint16(0, 0xfffe, true);
  vFim.setUint16(2, 0xe0dd, true);
  vFim.setUint32(4, 0, true);

  // 6. Concatena tudo e aplica patch dos offsets exatos na passagem 2
  const saida = concat([cabecalhoAteSeq, ...registros.map((r) => r.itemBytes), fimSeq]);
  const viewSaida = new DataView(saida.buffer, saida.byteOffset, saida.byteLength);

  if (indicesPacientes.length > 0) {
    viewSaida.setUint32(posFirstRootVal, registros[indicesPacientes[0]!]!.offset, true);
    viewSaida.setUint32(posLastRootVal, registros[indicesPacientes[indicesPacientes.length - 1]!]!.offset, true);
  }
  for (const reg of registros) {
    const nextOff = reg.proximoIrmao >= 0 ? registros[reg.proximoIrmao]!.offset : 0;
    const lowerOff = reg.primeiroFilho >= 0 ? registros[reg.primeiroFilho]!.offset : 0;
    viewSaida.setUint32(reg.offset + 16, nextOff, true);
    viewSaida.setUint32(reg.offset + 38, lowerOff, true);
  }

  return saida;
}

/**
 * Monta o caminho DICOMDIR padrão (8 caracteres maiúsculos/dígitos por segmento) para uma imagem:
 * `['DICOM', 'ST000001', 'SE000001', 'IM000001']`.
 */
export function caminhoDicomdir(idxEstudo: number, idxSerie: number, idxImagem: number): string[] {
  const p = (prefixo: string, n: number) => `${prefixo}${String(n + 1).padStart(6, '0')}`;
  return ['DICOM', p('ST', idxEstudo), p('SE', idxSerie), p('IM', idxImagem)];
}
