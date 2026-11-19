/**
 * Lista de servidores PACS cadastrados pelo usuário (arquivo `pacs.json`).
 * O arquivo fica fora do repositório (.gitignore): contém endereços de hospitais.
 */

import type { PacsServer } from './client.ts';
import { PacsError } from './errors.ts';
import { isValidAeTitle } from './pdu.ts';

export interface PacsConfig {
  /** AE title desta estação, como cadastrado nos servidores. */
  myAeTitle: string;
  servers: PacsServer[];
}

function fail(message: string): never {
  throw new PacsError('CONFIGURACAO_INVALIDA', `pacs.json: ${message}`);
}

/**
 * Valida o conteúdo de `pacs.json`:
 *
 *   {
 *     "meuAeTitle": "MINHAESTACAO",
 *     "servidores": [
 *       { "nome": "Hospital A", "host": "pacs.exemplo.org", "porta": 104, "aeTitle": "PACSA" },
 *       { "nome": "Hospital B", "host": "10.0.0.5", "porta": 2762, "aeTitle": "PACSB",
 *         "tls": true, "certificado": "AB:CD:..." }
 *     ]
 *   }
 */
export function parseConfig(json: unknown): PacsConfig {
  if (typeof json !== 'object' || json === null) fail('conteúdo inválido.');
  const root = json as Record<string, unknown>;
  const myAeTitle = root['meuAeTitle'];
  if (typeof myAeTitle !== 'string' || !isValidAeTitle(myAeTitle)) {
    fail('"meuAeTitle" deve ter de 1 a 16 caracteres, sem acentos.');
  }
  const list = root['servidores'];
  if (!Array.isArray(list) || list.length === 0) fail('"servidores" deve ter pelo menos um servidor.');

  const servers: PacsServer[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) fail('servidor inválido.');
    const s = entry as Record<string, unknown>;
    const name = s['nome'];
    const host = s['host'];
    const port = s['porta'];
    const aeTitle = s['aeTitle'];
    if (typeof name !== 'string' || name.trim() === '') fail('todo servidor precisa de "nome".');
    if (typeof host !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(host)) fail(`servidor "${name}": "host" inválido.`);
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`servidor "${name}": "porta" deve ser um número de 1 a 65535.`);
    }
    if (typeof aeTitle !== 'string' || !isValidAeTitle(aeTitle)) {
      fail(`servidor "${name}": "aeTitle" deve ter de 1 a 16 caracteres, sem acentos.`);
    }
    if (servers.some((x) => x.name.toLowerCase() === name.trim().toLowerCase())) {
      fail(`há dois servidores com o nome "${name}".`);
    }
    const tls = s['tls'];
    if (tls !== undefined && typeof tls !== 'boolean') fail(`servidor "${name}": "tls" deve ser true ou false.`);
    const cert = s['certificado'];
    let certificateSha256: string | undefined;
    if (cert !== undefined && cert !== '') {
      certificateSha256 = typeof cert === 'string' ? normalizeFingerprint(cert) : undefined;
      if (!certificateSha256) {
        fail(`servidor "${name}": "certificado" deve ser a impressão digital SHA-256 (64 dígitos hexadecimais).`);
      }
      if (tls !== true) fail(`servidor "${name}": "certificado" só vale com "tls": true.`);
    }
    const modo = s['modo'];
    if (modo !== undefined && modo !== 'cget' && modo !== 'cmove') {
      fail(`servidor "${name}": "modo" deve ser "cget" ou "cmove".`);
    }
    const conexoesMaximas = s['conexoesMaximas'];
    if (
      conexoesMaximas !== undefined &&
      (typeof conexoesMaximas !== 'number' || !Number.isInteger(conexoesMaximas) || conexoesMaximas < 1 || conexoesMaximas > 8)
    ) {
      fail(`servidor "${name}": "conexoesMaximas" deve ser um número de 1 a 8.`);
    }
    const maxPdu = s['maxPdu'];
    if (maxPdu !== undefined && (typeof maxPdu !== 'number' || !Number.isInteger(maxPdu) || maxPdu < 4096)) {
      fail(`servidor "${name}": "maxPdu" deve ser um inteiro >= 4096.`);
    }
    servers.push({
      name: name.trim(),
      host,
      port,
      aeTitle: aeTitle.trim(),
      ...(tls === true ? { tls: true } : {}),
      ...(certificateSha256 ? { certificateSha256 } : {}),
      ...(modo === 'cmove' ? { retrieveMode: 'cmove' as const } : {}),
      ...(typeof conexoesMaximas === 'number' ? { maxConnections: conexoesMaximas } : {}),
      ...(typeof maxPdu === 'number' ? { maxPduLength: maxPdu } : {}),
    });
  }
  return { myAeTitle: myAeTitle.trim(), servers };
}

/**
 * Impressão digital SHA-256 em formato único: 64 dígitos hexadecimais maiúsculos, sem separador.
 * Aceita com ou sem ":" e espaços, em maiúsculas ou minúsculas. Texto inválido devolve undefined.
 */
export function normalizeFingerprint(text: string): string | undefined {
  const hex = text.replace(/[\s:]/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex : undefined;
}

/** Impressão digital para mostrar e conferir: pares separados por ":". */
export function formatFingerprint(hex: string): string {
  return (hex.match(/.{1,2}/g) ?? []).join(':');
}

/** Mensagens (prontas para a tela) das recusas da conexão segura, iguais no Node e no app. */
export const TLS_SEM_CERTIFICADO =
  'conexão segura (TLS): o certificado deste servidor ainda não foi confirmado. Confirme-o antes de conectar.';

export function tlsCertificadoMudou(esperado: string, recebido: string): string {
  return (
    'conexão segura (TLS): o servidor apresentou um certificado diferente do confirmado ' +
    `(esperado ${formatFingerprint(esperado).slice(0, 23)}…, recebido ${formatFingerprint(recebido).slice(0, 23)}…). ` +
    'Não conectei. Confirme com o TI do hospital antes de aceitar o novo certificado.'
  );
}

/** Acha um servidor pelo nome, sem diferenciar maiúsculas. */
export function findServer(config: PacsConfig, name: string): PacsServer {
  const wanted = name.trim().toLowerCase();
  const server = config.servers.find((s) => s.name.toLowerCase() === wanted);
  if (!server) {
    throw new PacsError(
      'SERVIDOR_DESCONHECIDO',
      `Servidor "${name}" não está em pacs.json. Cadastrados: ${config.servers.map((s) => s.name).join(', ')}.`,
    );
  }
  return server;
}

/**
 * Caminho relativo onde gravar uma imagem baixada:
 * `<estudo>/<série>/<imagem>.dcm`. Os UIDs vêm do servidor, então são
 * validados antes de virar nome de pasta.
 */
export function instancePath(studyUid: string, seriesUid: string, sopInstanceUid: string): string {
  for (const uid of [studyUid, seriesUid, sopInstanceUid]) {
    if (!/^[0-9]+(\.[0-9]+)*$/.test(uid) || uid.length > 64) {
      throw new PacsError('UID_INVALIDO', 'O servidor enviou um identificador inválido; a imagem não foi gravada.');
    }
  }
  return `${studyUid}/${seriesUid}/${sopInstanceUid}.dcm`;
}
