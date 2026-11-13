/**
 * Camada de transporte do DICOM (PS3.8): montagem e leitura das PDUs.
 *
 * Só manipula bytes; não abre conexão. Quem envia e recebe é o `Transport`
 * injetado em `client.ts`.
 */

import { PacsError } from './errors.ts';
import { UID } from './uids.ts';

export const PDU = {
  associateRq: 0x01,
  associateAc: 0x02,
  associateRj: 0x03,
  pData: 0x04,
  releaseRq: 0x05,
  releaseRp: 0x06,
  abort: 0x07,
} as const;

export interface PresentationContextRequest {
  /** Número ímpar de 1 a 255. */
  id: number;
  abstractSyntax: string;
  transferSyntaxes: readonly string[];
}

export interface RoleSelection {
  sopClassUid: string;
  scu: boolean;
  scp: boolean;
}

export interface AssociateRequest {
  calledAeTitle: string;
  callingAeTitle: string;
  contexts: PresentationContextRequest[];
  roles?: RoleSelection[];
  maxPduLength: number;
  implementationClassUid: string;
  implementationVersionName: string;
}

export interface AcceptedContext {
  id: number;
  /** 0 = aceito; 1 a 4 = recusado. */
  result: number;
  transferSyntax?: string;
}

export interface AssociateAccept {
  contexts: AcceptedContext[];
  /** 0 = sem limite. */
  maxPduLength: number;
  roles: RoleSelection[];
  implementationClassUid?: string;
  implementationVersionName?: string;
}

export interface Pdv {
  contextId: number;
  isCommand: boolean;
  isLast: boolean;
  data: Uint8Array;
}

export interface RawPdu {
  type: number;
  body: Uint8Array;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

function text(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s.replace(/[\0 ]+$/, '');
}

function u16be(n: number): Uint8Array {
  return Uint8Array.of((n >> 8) & 0xff, n & 0xff);
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function readU16be(b: Uint8Array, o: number): number {
  return (b[o]! << 8) | b[o + 1]!;
}

function readU32be(b: Uint8Array, o: number): number {
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}

function pdu(type: number, body: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(type, 0), u32be(body.length), body]);
}

function item(type: number, body: Uint8Array): Uint8Array {
  return concat([Uint8Array.of(type, 0), u16be(body.length), body]);
}

/** AE title: 1 a 16 caracteres ASCII imprimíveis, sem barra invertida. */
export function isValidAeTitle(value: string): boolean {
  return /^[\x20-\x5b\x5d-\x7e]{1,16}$/.test(value) && value.trim().length > 0;
}

function aeTitle(value: string): Uint8Array {
  if (!isValidAeTitle(value)) {
    throw new PacsError('AE_TITLE_INVALIDO', `AE title inválido: "${value}" (até 16 caracteres, sem acentos).`);
  }
  return ascii(value.trim().padEnd(16, ' '));
}

// ---------------------------------------------------------------------------
// A-ASSOCIATE
// ---------------------------------------------------------------------------

export function encodeAssociateRq(request: AssociateRequest): Uint8Array {
  if (request.contexts.length === 0 || request.contexts.length > 128) {
    throw new PacsError(
      'CONTEXTOS_DEMAIS',
      `A associação precisa de 1 a 128 contextos de apresentação (pedidos: ${request.contexts.length}).`,
    );
  }
  const contexts = request.contexts.map((c) => {
    if (c.id < 1 || c.id > 255 || c.id % 2 === 0) {
      throw new PacsError('CONTEXTO_INVALIDO', `Identificador de contexto inválido: ${c.id}.`);
    }
    return item(
      0x20,
      concat([
        Uint8Array.of(c.id, 0, 0, 0),
        item(0x30, ascii(c.abstractSyntax)),
        ...c.transferSyntaxes.map((t) => item(0x40, ascii(t))),
      ]),
    );
  });
  const roles = (request.roles ?? []).map((r) =>
    item(
      0x54,
      concat([u16be(r.sopClassUid.length), ascii(r.sopClassUid), Uint8Array.of(r.scu ? 1 : 0, r.scp ? 1 : 0)]),
    ),
  );
  const userInformation = item(
    0x50,
    concat([
      item(0x51, u32be(request.maxPduLength)),
      item(0x52, ascii(request.implementationClassUid)),
      ...roles,
      item(0x55, ascii(request.implementationVersionName)),
    ]),
  );
  return pdu(
    PDU.associateRq,
    concat([
      u16be(1),
      new Uint8Array(2),
      aeTitle(request.calledAeTitle),
      aeTitle(request.callingAeTitle),
      new Uint8Array(32),
      item(0x10, ascii(UID.applicationContext)),
      ...contexts,
      userInformation,
    ]),
  );
}

interface Item {
  type: number;
  body: Uint8Array;
}

function readItems(bytes: Uint8Array, start: number): Item[] {
  const items: Item[] = [];
  let o = start;
  while (o + 4 <= bytes.length) {
    const length = readU16be(bytes, o + 2);
    if (o + 4 + length > bytes.length) {
      throw new PacsError('PDU_INVALIDA', 'Resposta do servidor malformada (item maior que a mensagem).');
    }
    items.push({ type: bytes[o]!, body: bytes.subarray(o + 4, o + 4 + length) });
    o += 4 + length;
  }
  return items;
}

function readUserInformation(body: Uint8Array) {
  const out: {
    maxPduLength: number;
    roles: RoleSelection[];
    implementationClassUid?: string;
    implementationVersionName?: string;
  } = { maxPduLength: 0, roles: [] };
  for (const sub of readItems(body, 0)) {
    if (sub.type === 0x51 && sub.body.length >= 4) out.maxPduLength = readU32be(sub.body, 0);
    else if (sub.type === 0x52) out.implementationClassUid = text(sub.body);
    else if (sub.type === 0x55) out.implementationVersionName = text(sub.body);
    else if (sub.type === 0x54 && sub.body.length >= 4) {
      const uidLength = readU16be(sub.body, 0);
      if (2 + uidLength + 2 > sub.body.length) continue;
      out.roles.push({
        sopClassUid: text(sub.body.subarray(2, 2 + uidLength)),
        scu: sub.body[2 + uidLength] === 1,
        scp: sub.body[3 + uidLength] === 1,
      });
    }
  }
  return out;
}

export function decodeAssociateAc(body: Uint8Array): AssociateAccept {
  if (body.length < 68) throw new PacsError('PDU_INVALIDA', 'Resposta de associação incompleta.');
  const accept: AssociateAccept = { contexts: [], maxPduLength: 0, roles: [] };
  for (const it of readItems(body, 68)) {
    if (it.type === 0x21 && it.body.length >= 4) {
      const context: AcceptedContext = { id: it.body[0]!, result: it.body[2]! };
      const syntax = readItems(it.body, 4).find((s) => s.type === 0x40);
      if (syntax && context.result === 0) context.transferSyntax = text(syntax.body);
      accept.contexts.push(context);
    } else if (it.type === 0x50) {
      Object.assign(accept, readUserInformation(it.body));
    }
  }
  return accept;
}

/** Leitura de um A-ASSOCIATE-RQ. Usada nos testes para conferir o que foi montado. */
export function decodeAssociateRq(body: Uint8Array): AssociateRequest {
  if (body.length < 68) throw new PacsError('PDU_INVALIDA', 'Pedido de associação incompleto.');
  const request: AssociateRequest = {
    calledAeTitle: text(body.subarray(4, 20)),
    callingAeTitle: text(body.subarray(20, 36)),
    contexts: [],
    roles: [],
    maxPduLength: 0,
    implementationClassUid: '',
    implementationVersionName: '',
  };
  for (const it of readItems(body, 68)) {
    if (it.type === 0x20 && it.body.length >= 4) {
      const subs = readItems(it.body, 4);
      request.contexts.push({
        id: it.body[0]!,
        abstractSyntax: text(subs.find((s) => s.type === 0x30)?.body ?? new Uint8Array(0)),
        transferSyntaxes: subs.filter((s) => s.type === 0x40).map((s) => text(s.body)),
      });
    } else if (it.type === 0x50) {
      const info = readUserInformation(it.body);
      request.maxPduLength = info.maxPduLength;
      request.roles = info.roles;
      request.implementationClassUid = info.implementationClassUid ?? '';
      request.implementationVersionName = info.implementationVersionName ?? '';
    }
  }
  return request;
}

/** Motivo da recusa da associação, em português. */
export function describeAssociateRj(body: Uint8Array): PacsError {
  const source = body[2] ?? 0;
  const reason = body[3] ?? 0;
  if (source === 1 && reason === 3) {
    return new PacsError(
      'AE_NAO_AUTORIZADO',
      'O servidor não reconhece o AE title desta estação. Ele precisa estar cadastrado no PACS.',
    );
  }
  if (source === 1 && reason === 7) {
    return new PacsError('AE_DO_SERVIDOR_ERRADO', 'O servidor não reconhece o AE title informado para ele.');
  }
  if (source === 3 && (reason === 1 || reason === 2)) {
    return new PacsError('SERVIDOR_OCUPADO', 'O servidor está ocupado ou no limite de conexões. Tente de novo.');
  }
  return new PacsError(
    'ASSOCIACAO_RECUSADA',
    `O servidor recusou a conexão (origem ${source}, motivo ${reason}).`,
  );
}

// ---------------------------------------------------------------------------
// P-DATA, A-RELEASE, A-ABORT
// ---------------------------------------------------------------------------

export function encodePData(pdvs: Pdv[]): Uint8Array {
  return pdu(
    PDU.pData,
    concat(
      pdvs.map((p) =>
        concat([
          u32be(p.data.length + 2),
          Uint8Array.of(p.contextId, (p.isCommand ? 1 : 0) | (p.isLast ? 2 : 0)),
          p.data,
        ]),
      ),
    ),
  );
}

export function decodePData(body: Uint8Array): Pdv[] {
  const pdvs: Pdv[] = [];
  let o = 0;
  while (o + 6 <= body.length) {
    const length = readU32be(body, o);
    if (length < 2 || o + 4 + length > body.length) {
      throw new PacsError('PDU_INVALIDA', 'Dados recebidos do servidor estão malformados.');
    }
    const header = body[o + 5]!;
    pdvs.push({
      contextId: body[o + 4]!,
      isCommand: (header & 1) === 1,
      isLast: (header & 2) === 2,
      data: body.subarray(o + 6, o + 4 + length),
    });
    o += 4 + length;
  }
  if (o !== body.length) {
    throw new PacsError('PDU_INVALIDA', 'Dados recebidos do servidor estão malformados.');
  }
  return pdvs;
}

export function encodeReleaseRq(): Uint8Array {
  return pdu(PDU.releaseRq, new Uint8Array(4));
}

export function encodeReleaseRp(): Uint8Array {
  return pdu(PDU.releaseRp, new Uint8Array(4));
}

export function encodeAbort(): Uint8Array {
  // origem 0 = usuário do serviço; motivo 0 = não especificado
  return pdu(PDU.abort, new Uint8Array(4));
}

// ---------------------------------------------------------------------------
// Leitura do fluxo de bytes
// ---------------------------------------------------------------------------

/** Maior PDU aceita na entrada (proteção de memória). */
const MAX_INCOMING_PDU = 64 * 1024 * 1024;

/** Junta os pedaços que chegam da rede e devolve PDUs completas. */
export class PduBuffer {
  private buffer = new Uint8Array(65536);
  private length = 0;

  push(chunk: Uint8Array): void {
    if (this.length + chunk.length > this.buffer.length) {
      let size = this.buffer.length;
      while (size < this.length + chunk.length) size *= 2;
      const grown = new Uint8Array(size);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(chunk, this.length);
    this.length += chunk.length;
  }

  next(): RawPdu | undefined {
    if (this.length < 6) return undefined;
    const type = this.buffer[0]!;
    const bodyLength = readU32be(this.buffer, 2);
    if (type < 1 || type > 7 || bodyLength > MAX_INCOMING_PDU) {
      throw new PacsError('PDU_INVALIDA', 'O servidor respondeu com dados que não são DICOM.');
    }
    if (this.length < 6 + bodyLength) return undefined;
    const body = this.buffer.slice(6, 6 + bodyLength);
    this.buffer.copyWithin(0, 6 + bodyLength, this.length);
    this.length -= 6 + bodyLength;
    return { type, body };
  }
}
