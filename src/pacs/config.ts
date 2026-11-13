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
 *       { "nome": "Hospital A", "host": "pacs.exemplo.org", "porta": 104, "aeTitle": "PACSA" }
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
    servers.push({ name: name.trim(), host, port, aeTitle: aeTitle.trim() });
  }
  return { myAeTitle: myAeTitle.trim(), servers };
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
