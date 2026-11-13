/**
 * Transporte falso para testar o cliente de PACS sem rede: reproduz uma troca
 * gravada com um servidor real. Confere byte a byte o que o cliente envia e
 * devolve as respostas do servidor no momento em que elas chegaram na gravação.
 */

import type { Connect, Transport } from '../../src/pacs/client.ts';

export interface RecordedEvent {
  /** 'c' = cliente, 's' = servidor */
  d: 'c' | 's';
  /** bytes em base64 */
  b: string;
}

export interface Replay {
  connect: Connect;
  /** Problemas encontrados (cliente enviou algo diferente da gravação). */
  errors: string[];
  /** Verdadeiro quando o cliente enviou tudo o que estava gravado. */
  finished(): boolean;
  /** Quantas vezes o cliente abriu conexão. */
  connections: number;
}

function decode(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * @param chunkSize tamanho dos pedaços em que as respostas do servidor são
 *   entregues (1 = um byte por vez, para testar a remontagem).
 */
export function replay(events: RecordedEvent[], chunkSize = Number.MAX_SAFE_INTEGER): Replay {
  const clientParts: Uint8Array[] = [];
  const serverEvents: { releaseAt: number; bytes: Uint8Array; sent: boolean }[] = [];
  let clientTotal = 0;
  for (const event of events) {
    const bytes = decode(event.b);
    if (event.d === 'c') {
      clientParts.push(bytes);
      clientTotal += bytes.length;
    } else {
      serverEvents.push({ releaseAt: clientTotal, bytes, sent: false });
    }
  }
  const expected = new Uint8Array(clientTotal);
  let offset = 0;
  for (const part of clientParts) {
    expected.set(part, offset);
    offset += part.length;
  }

  const result: Replay = {
    errors: [],
    connections: 0,
    finished: () => written === clientTotal,
    connect: async () => {
      result.connections++;
      return transport;
    },
  };

  let written = 0;
  let closed = false;
  let pumping = false;
  const pending: Uint8Array[] = [];
  const dataCallbacks: ((chunk: Uint8Array) => void)[] = [];
  const closeCallbacks: ((error?: Error) => void)[] = [];

  const pump = () => {
    if (pumping) return;
    pumping = true;
    const step = () => {
      const chunk = pending.shift();
      if (!chunk || closed) {
        pumping = false;
        return;
      }
      for (const callback of dataCallbacks) callback(chunk);
      queueMicrotask(step);
    };
    queueMicrotask(step);
  };

  const transport: Transport = {
    send(data) {
      if (closed) throw new Error('envio depois de fechar');
      for (let i = 0; i < data.length; i++) {
        if (written + i >= clientTotal || expected[written + i] !== data[i]) {
          result.errors.push(`o cliente enviou algo diferente da gravação no byte ${written + i}`);
          closed = true;
          queueMicrotask(() => closeCallbacks.forEach((cb) => cb(new Error('divergência da gravação'))));
          return;
        }
      }
      written += data.length;
      for (const event of serverEvents) {
        if (event.sent || event.releaseAt > written) continue;
        event.sent = true;
        for (let o = 0; o < event.bytes.length; o += chunkSize) {
          pending.push(event.bytes.subarray(o, Math.min(event.bytes.length, o + chunkSize)));
        }
      }
      pump();
    },
    close() {
      closed = true;
    },
    onData(callback) {
      dataCallbacks.push(callback);
    },
    onClose(callback) {
      closeCallbacks.push(callback);
    },
  };
  return result;
}
