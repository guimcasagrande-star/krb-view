/**
 * Mensagens DIMSE (PS3.7): comandos, fragmentação em PDVs e remontagem.
 */

import { PacsError } from './errors.ts';
import {
  decodeText,
  encodeImplicit,
  latin1,
  parseImplicit,
  readU16le,
  u16le,
  uidBytes,
  type ImplicitElement,
} from './implicit.ts';
import { concat, encodePData, type Pdv } from './pdu.ts';

export const COMMAND = {
  cStoreRq: 0x0001,
  cStoreRsp: 0x8001,
  cGetRq: 0x0010,
  cGetRsp: 0x8010,
  cFindRq: 0x0020,
  cFindRsp: 0x8020,
  cEchoRq: 0x0030,
  cEchoRsp: 0x8030,
  cCancelRq: 0x0fff,
} as const;

export const STATUS = {
  success: 0x0000,
  cancel: 0xfe00,
  pending: 0xff00,
  pendingWarning: 0xff01,
  subOperationsWithFailures: 0xb000,
} as const;

export interface Command {
  commandField: number;
  affectedSopClassUid?: string;
  messageId?: number;
  messageIdBeingRespondedTo?: number;
  priority?: number;
  hasDataset: boolean;
  status?: number;
  affectedSopInstanceUid?: string;
  errorComment?: string;
  remaining?: number;
  completed?: number;
  failed?: number;
  warning?: number;
}

const NO_DATASET = 0x0101;
const WITH_DATASET = 0x0001;

export function encodeCommand(command: Command): Uint8Array {
  const elements: ImplicitElement[] = [];
  const us = (tag: string, value: number | undefined) => {
    if (value !== undefined) elements.push({ tag, value: u16le(value) });
  };
  if (command.affectedSopClassUid !== undefined) {
    elements.push({ tag: '00000002', value: uidBytes(command.affectedSopClassUid) });
  }
  us('00000100', command.commandField);
  us('00000110', command.messageId);
  us('00000120', command.messageIdBeingRespondedTo);
  us('00000700', command.priority);
  us('00000800', command.hasDataset ? WITH_DATASET : NO_DATASET);
  us('00000900', command.status);
  if (command.errorComment !== undefined) {
    elements.push({ tag: '00000902', value: latin1(command.errorComment.slice(0, 64)) });
  }
  if (command.affectedSopInstanceUid !== undefined) {
    elements.push({ tag: '00001000', value: uidBytes(command.affectedSopInstanceUid) });
  }
  us('00001020', command.remaining);
  us('00001021', command.completed);
  us('00001022', command.failed);
  us('00001023', command.warning);

  const body = encodeImplicit(elements);
  const groupLength = new Uint8Array(4);
  new DataView(groupLength.buffer).setUint32(0, body.length, true);
  return concat([encodeImplicit([{ tag: '00000000', value: groupLength }]), body]);
}

export function decodeCommand(bytes: Uint8Array): Command {
  const el = parseImplicit(bytes);
  const commandField = readU16le(el.get('00000100'));
  if (commandField === undefined) {
    throw new PacsError('DADOS_INVALIDOS', 'O servidor enviou um comando sem identificação.');
  }
  const command: Command = {
    commandField,
    hasDataset: (readU16le(el.get('00000800')) ?? NO_DATASET) !== NO_DATASET,
  };
  const set = <K extends keyof Command>(key: K, value: Command[K] | undefined) => {
    if (value !== undefined) command[key] = value;
  };
  set('affectedSopClassUid', decodeText(el.get('00000002')));
  set('messageId', readU16le(el.get('00000110')));
  set('messageIdBeingRespondedTo', readU16le(el.get('00000120')));
  set('priority', readU16le(el.get('00000700')));
  set('status', readU16le(el.get('00000900')));
  set('errorComment', decodeText(el.get('00000902')));
  set('affectedSopInstanceUid', decodeText(el.get('00001000')));
  set('remaining', readU16le(el.get('00001020')));
  set('completed', readU16le(el.get('00001021')));
  set('failed', readU16le(el.get('00001022')));
  set('warning', readU16le(el.get('00001023')));
  return command;
}

/** Teto do que enviamos por PDU, mesmo que o servidor aceite mais. */
const MAX_OUTGOING_PDU = 65536;

/**
 * Divide uma mensagem (comando e, se houver, dataset) em PDUs P-DATA-TF que
 * cabem no tamanho máximo aceito pelo servidor (`peerMaxPdu`; 0 = sem limite).
 */
export function fragmentMessage(
  contextId: number,
  command: Uint8Array,
  dataset: Uint8Array | undefined,
  peerMaxPdu: number,
): Uint8Array[] {
  const maxPdu = peerMaxPdu > 0 ? Math.min(peerMaxPdu, MAX_OUTGOING_PDU) : MAX_OUTGOING_PDU;
  // Cada PDV gasta 6 bytes de cabeçalho dentro da PDU.
  const chunk = Math.max(64, maxPdu - 6);
  const out: Uint8Array[] = [];
  const split = (data: Uint8Array, isCommand: boolean) => {
    let o = 0;
    do {
      const end = Math.min(data.length, o + chunk);
      const pdv: Pdv = { contextId, isCommand, isLast: end === data.length, data: data.subarray(o, end) };
      out.push(encodePData([pdv]));
      o = end;
    } while (o < data.length);
  };
  split(command, true);
  if (dataset) split(dataset, false);
  return out;
}

export interface Message {
  contextId: number;
  command: Command;
  dataset?: Uint8Array;
}

/** Remonta mensagens a partir dos PDVs recebidos, em qualquer fragmentação. */
export class MessageAssembler {
  private commandParts: Uint8Array[] = [];
  private dataParts: Uint8Array[] = [];
  private command: Command | undefined;
  private contextId = 0;

  push(pdv: Pdv): Message | undefined {
    if (pdv.isCommand) {
      if (this.command) {
        throw new PacsError('DADOS_INVALIDOS', 'O servidor enviou um comando antes de terminar o anterior.');
      }
      this.commandParts.push(pdv.data);
      this.contextId = pdv.contextId;
      if (!pdv.isLast) return undefined;
      const command = decodeCommand(concat(this.commandParts));
      this.commandParts = [];
      if (!command.hasDataset) return { contextId: pdv.contextId, command };
      this.command = command;
      return undefined;
    }

    if (!this.command || pdv.contextId !== this.contextId) {
      throw new PacsError('DADOS_INVALIDOS', 'O servidor enviou dados sem um comando correspondente.');
    }
    this.dataParts.push(pdv.data);
    if (!pdv.isLast) return undefined;
    const message: Message = {
      contextId: this.contextId,
      command: this.command,
      dataset: concat(this.dataParts),
    };
    this.command = undefined;
    this.dataParts = [];
    return message;
  }
}

/** Explicação em português de um status de falha. */
export function describeStatus(status: number, comment?: string): string {
  let reason: string;
  if (status === 0xa700 || status === 0xa701) reason = 'o servidor está sem recursos para atender o pedido';
  else if (status === 0xa702) reason = 'o servidor não conseguiu enviar as imagens';
  else if (status === 0xa801) reason = 'o servidor não conhece o destino das imagens';
  else if (status === 0xa900) reason = 'o servidor não aceitou o formato da consulta';
  else if (status === 0x0122) reason = 'o servidor não oferece esse serviço';
  else if (status === 0x0124) reason = 'esta estação não tem autorização para o pedido';
  else if (status === STATUS.cancel) reason = 'o pedido foi cancelado';
  else if (status >= 0xc000 && status <= 0xcfff) reason = 'o servidor não conseguiu processar o pedido';
  else reason = 'o servidor devolveu um erro';
  const code = `0x${status.toString(16).toUpperCase().padStart(4, '0')}`;
  return comment ? `${reason} (${code}: ${comment})` : `${reason} (${code})`;
}
