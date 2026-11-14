/**
 * Transporte TCP para o cliente de PACS, usando o módulo `net` do Node.
 * Só para a linha de comando e os testes. Nunca importar no código do navegador.
 */

import net from 'node:net';
import tls from 'node:tls';
import type { Connect, PacsServer, Transport } from '../src/pacs/client.ts';
import { normalizeFingerprint, TLS_SEM_CERTIFICADO, tlsCertificadoMudou } from '../src/pacs/config.ts';

/**
 * Abre a conexão segura sem validar a cadeia de certificados: PACS de hospital costuma usar
 * certificado próprio, que nenhuma autoridade pública assina. A garantia vem da impressão digital
 * confirmada pelo usuário, conferida em `connectNode` antes de qualquer dado ser enviado.
 */
function abrirTls(host: string, port: number): tls.TLSSocket {
  return tls.connect({ host, port, rejectUnauthorized: false, minVersion: 'TLSv1.2' });
}

export interface CertificadoServidor {
  /** Impressão digital SHA-256 (64 dígitos hexadecimais maiúsculos). */
  sha256: string;
  /** Para quem foi emitido e validade, só para mostrar. */
  titular: string;
  validoAte: string;
}

/** Conecta por TLS só para ler o certificado que o servidor apresenta; não envia nada. */
export function fetchCertificateNode(host: string, port: number, timeoutMs = 10_000): Promise<CertificadoServidor> {
  return new Promise((resolve, reject) => {
    const socket = abrirTls(host, port);
    const timer = setTimeout(() => socket.destroy(new Error(`sem resposta em ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate();
      const sha256 = normalizeFingerprint(cert.fingerprint256 ?? '');
      socket.destroy();
      if (!sha256) reject(new Error('o servidor não apresentou certificado'));
      else resolve({ sha256, titular: String(cert.subject?.CN ?? ''), validoAte: cert.valid_to ?? '' });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`falha na conexão segura (TLS): ${error.message}`));
    });
  });
}

/**
 * `servers`: os servidores cadastrados. Os que têm `tls` são acessados por conexão segura e só
 * se o certificado apresentado for o confirmado (`certificateSha256`).
 */
export function connectNode(connectTimeoutMs = 10_000, servers: PacsServer[] = []): Connect {
  return (host, port) =>
    new Promise<Transport>((resolve, reject) => {
      const server = servers.find((s) => s.host.toLowerCase() === host.toLowerCase() && s.port === port);
      const seguro = server?.tls === true;
      if (seguro && !server.certificateSha256) {
        reject(new Error(TLS_SEM_CERTIFICADO));
        return;
      }
      const socket = seguro ? abrirTls(host, port) : net.createConnection({ host, port });
      socket.setNoDelay(true);
      const dataCallbacks: ((chunk: Uint8Array) => void)[] = [];
      const closeCallbacks: ((error?: Error) => void)[] = [];
      let lastError: Error | undefined;
      let connected = false;

      const timer = setTimeout(() => {
        socket.destroy(new Error(`sem resposta em ${Math.round(connectTimeoutMs / 1000)} s`));
      }, connectTimeoutMs);

      socket.once(seguro ? 'secureConnect' : 'connect', () => {
        if (seguro) {
          const recebido = normalizeFingerprint((socket as tls.TLSSocket).getPeerCertificate().fingerprint256 ?? '');
          const esperado = server.certificateSha256!;
          if (recebido !== esperado) {
            lastError = new Error(tlsCertificadoMudou(esperado, recebido ?? '(nenhum)'));
            socket.destroy();
            return;
          }
        }
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
        lastError ??= seguro && !connected ? new Error(`falha na conexão segura (TLS): ${error.message}`) : error;
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!connected) reject(lastError ?? new Error('conexão recusada'));
        else for (const callback of closeCallbacks) callback(lastError);
      });
    });
}
