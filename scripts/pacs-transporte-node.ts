/**
 * Transporte TCP para o cliente de PACS, usando o módulo `net` do Node.
 * Só para a linha de comando e os testes. Nunca importar no código do navegador.
 */

import net from 'node:net';
import type { Connect, Transport } from '../src/pacs/client.ts';

export function connectNode(connectTimeoutMs = 10_000): Connect {
  return (host, port) =>
    new Promise<Transport>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.setNoDelay(true);
      const dataCallbacks: ((chunk: Uint8Array) => void)[] = [];
      const closeCallbacks: ((error?: Error) => void)[] = [];
      let lastError: Error | undefined;
      let connected = false;

      const timer = setTimeout(() => {
        socket.destroy(new Error(`sem resposta em ${Math.round(connectTimeoutMs / 1000)} s`));
      }, connectTimeoutMs);

      socket.once('connect', () => {
        connected = true;
        clearTimeout(timer);
        resolve({
          send: (data) => {
            socket.write(data);
          },
          close: () => socket.destroy(),
          onData: (callback) => dataCallbacks.push(callback),
          onClose: (callback) => closeCallbacks.push(callback),
          pause: () => socket.pause(),
          resume: () => socket.resume(),
        });
      });
      socket.on('data', (chunk) => {
        if (typeof chunk === 'string') return;
        const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length);
        for (const callback of dataCallbacks) callback(bytes);
      });
      socket.on('error', (error) => {
        lastError = error;
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!connected) reject(lastError ?? new Error('conexão recusada'));
        else for (const callback of closeCallbacks) callback(lastError);
      });
    });
}
