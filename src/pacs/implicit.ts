/**
 * Leitura e escrita mínimas de datasets em Implicit VR Little Endian, que é a
 * codificação dos comandos DIMSE e das consultas/respostas de C-FIND.
 */

import { PacsError } from './errors.ts';
import { concat } from './pdu.ts';

const invalid = () => new PacsError('DADOS_INVALIDOS', 'Resposta do servidor malformada.');

function tagOf(view: DataView, o: number): string {
  const group = view.getUint16(o, true).toString(16).padStart(4, '0');
  const element = view.getUint16(o + 2, true).toString(16).padStart(4, '0');
  return group + element;
}

function skipItem(view: DataView, start: number): number {
  let o = start;
  for (;;) {
    if (o + 8 > view.byteLength) throw invalid();
    const tag = tagOf(view, o);
    const length = view.getUint32(o + 4, true);
    o += 8;
    if (tag === 'fffee00d') return o;
    o = length === 0xffffffff ? skipSequence(view, o) : o + length;
  }
}

function skipSequence(view: DataView, start: number): number {
  let o = start;
  for (;;) {
    if (o + 8 > view.byteLength) throw invalid();
    const tag = tagOf(view, o);
    const length = view.getUint32(o + 4, true);
    o += 8;
    if (tag === 'fffee0dd') return o;
    if (tag !== 'fffee000') throw invalid();
    o = length === 0xffffffff ? skipItem(view, o) : o + length;
  }
}

/**
 * Lê os elementos do nível principal: tag ('ggggeeee' em minúsculas) -> bytes
 * do valor. Sequências de tamanho indefinido são puladas.
 */
export function parseImplicit(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let o = 0;
  while (o < bytes.length) {
    if (o + 8 > bytes.length) throw invalid();
    const tag = tagOf(view, o);
    const length = view.getUint32(o + 4, true);
    o += 8;
    if (length === 0xffffffff) {
      o = skipSequence(view, o);
      continue;
    }
    if (o + length > bytes.length) throw invalid();
    out.set(tag, bytes.subarray(o, o + length));
    o += length;
  }
  return out;
}

export interface ImplicitElement {
  /** 'ggggeeee' */
  tag: string;
  value: Uint8Array;
}

/** Monta um dataset em Implicit VR Little Endian. Os elementos são ordenados pela tag. */
export function encodeImplicit(elements: ImplicitElement[]): Uint8Array {
  const sorted = [...elements].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const parts: Uint8Array[] = [];
  for (const e of sorted) {
    if (e.value.length % 2 !== 0) throw new Error(`valor de tamanho ímpar na tag ${e.tag}`);
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint16(0, parseInt(e.tag.slice(0, 4), 16), true);
    view.setUint16(2, parseInt(e.tag.slice(4, 8), 16), true);
    view.setUint32(4, e.value.length, true);
    parts.push(header, e.value);
  }
  return concat(parts);
}

/** Texto -> bytes em Latin-1, com preenchimento até tamanho par. */
export function latin1(value: string, padByte = 0x20): Uint8Array {
  const out = new Uint8Array(value.length + (value.length % 2));
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out[i] = code <= 0xff ? code : 0x3f; // '?' para o que não existe em Latin-1
  }
  if (value.length % 2 === 1) out[value.length] = padByte;
  return out;
}

/** UID -> bytes, preenchido com zero até tamanho par. */
export function uidBytes(value: string): Uint8Array {
  return latin1(value, 0);
}

export function u16le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
}

export function readU16le(bytes: Uint8Array | undefined): number | undefined {
  return bytes && bytes.length >= 2 ? bytes[0]! | (bytes[1]! << 8) : undefined;
}

/** Bytes -> texto, sem espaços e zeros do fim. `utf8` conforme o SpecificCharacterSet. */
export function decodeText(bytes: Uint8Array | undefined, utf8 = false): string | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  let value: string;
  if (utf8) {
    value = new TextDecoder('utf-8').decode(bytes);
  } else {
    value = '';
    for (const b of bytes) value += String.fromCharCode(b);
  }
  value = value.replace(/[\0 ]+$/, '').replace(/^ +/, '');
  return value === '' ? undefined : value;
}
