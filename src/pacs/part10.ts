/**
 * Grava um dataset recebido por C-STORE como arquivo DICOM Part 10
 * (preâmbulo + "DICM" + grupo 0002 + dataset como chegou).
 */

import { concat } from './pdu.ts';
import { IMPLEMENTATION_CLASS_UID, IMPLEMENTATION_VERSION_NAME } from './uids.ts';

export interface Part10Input {
  sopClassUid: string;
  sopInstanceUid: string;
  /** Sintaxe de transferência em que o dataset foi recebido. */
  transferSyntaxUid: string;
  /** AE title do servidor de onde a imagem veio. */
  sourceAeTitle?: string;
  dataset: Uint8Array;
}

function text(value: string, padByte: number): Uint8Array {
  const out = new Uint8Array(value.length + (value.length % 2));
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0x7f;
  if (value.length % 2 === 1) out[value.length] = padByte;
  return out;
}

/** Elemento em Explicit VR Little Endian (o grupo 0002 é sempre nessa codificação). */
function element(tag: string, vr: string, value: Uint8Array): Uint8Array {
  const long = vr === 'OB';
  const header = new Uint8Array(long ? 12 : 8);
  const view = new DataView(header.buffer);
  view.setUint16(0, parseInt(tag.slice(0, 4), 16), true);
  view.setUint16(2, parseInt(tag.slice(4, 8), 16), true);
  header[4] = vr.charCodeAt(0);
  header[5] = vr.charCodeAt(1);
  if (long) view.setUint32(8, value.length, true);
  else view.setUint16(6, value.length, true);
  return concat([header, value]);
}

export function buildPart10(input: Part10Input): Uint8Array {
  const meta: Uint8Array[] = [
    element('00020001', 'OB', Uint8Array.of(0, 1)),
    element('00020002', 'UI', text(input.sopClassUid, 0)),
    element('00020003', 'UI', text(input.sopInstanceUid, 0)),
    element('00020010', 'UI', text(input.transferSyntaxUid, 0)),
    element('00020012', 'UI', text(IMPLEMENTATION_CLASS_UID, 0)),
    element('00020013', 'SH', text(IMPLEMENTATION_VERSION_NAME, 0x20)),
  ];
  if (input.sourceAeTitle) meta.push(element('00020016', 'AE', text(input.sourceAeTitle.trim(), 0x20)));
  const body = concat(meta);
  const groupLength = new Uint8Array(4);
  new DataView(groupLength.buffer).setUint32(0, body.length, true);

  const prefix = new Uint8Array(132);
  prefix.set([0x44, 0x49, 0x43, 0x4d], 128); // "DICM"
  return concat([prefix, element('00020000', 'UL', groupLength), body, input.dataset]);
}
