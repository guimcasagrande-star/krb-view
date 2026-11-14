/**
 * Linha de comando para pesquisar e baixar exames de um PACS por C-FIND e C-GET.
 *
 *   npm run pacs -- servidores
 *   npm run pacs -- eco <servidor>
 *   npm run pacs -- certificado <servidor>   (conexão segura: mostra o certificado para confirmar)
 *   npm run pacs -- buscar <servidor> [--nome "joao silva"] [--id 123] [--acesso A1]
 *                                     [--de 20261101] [--ate 20261113] [--modalidade PT]
 *   npm run pacs -- series <servidor> <UID do estudo>
 *   npm run pacs -- baixar <servidor> <UID do estudo> [--serie <UID>] [--pasta test-data/pacs]
 *
 * Os servidores ficam em pacs.json (veja pacs.exemplo.json). Os exames
 * baixados vão para uma pasta local; depois é só abri-la no visualizador.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as dicomParserModule from 'dicom-parser';
import { echo, findSeries, findStudies, retrieve, type ClientOptions } from '../src/pacs/client.ts';
import { findServer, formatFingerprint, instancePath, parseConfig, type PacsConfig } from '../src/pacs/config.ts';
import { PacsError } from '../src/pacs/errors.ts';
import { connectNode, fetchCertificateNode } from './pacs-transporte-node.ts';

const dicomParser = ((dicomParserModule as { default?: unknown }).default ??
  dicomParserModule) as typeof dicomParserModule;

function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new PacsError('USO', `Falta o valor de ${arg}.`);
      flags.set(arg.slice(2), value);
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function loadConfig(path: string): Promise<PacsConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new PacsError(
      'SEM_CONFIGURACAO',
      `Não achei ${path}. Copie pacs.exemplo.json para pacs.json e preencha com os seus servidores.`,
    );
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (error) {
    if (error instanceof PacsError) throw error;
    throw new PacsError('CONFIGURACAO_INVALIDA', `${path} não é um JSON válido.`);
  }
}

function formatDate(value: string | undefined): string {
  return value && /^\d{8}$/.test(value) ? `${value.slice(6)}/${value.slice(4, 6)}/${value.slice(0, 4)}` : '';
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new PacsError('USO', `Falta ${what}. Veja o uso no começo de scripts/pacs.ts.`);
  return value;
}

/** UID da série de um arquivo recém-recebido. */
function seriesUidOf(file: Uint8Array): string {
  try {
    const ds = dicomParser.parseDicom(file, { untilTag: 'x7fe00010' });
    return ds.string('x0020000e') ?? 'sem-serie';
  } catch (error) {
    const partial = (error as { dataSet?: { string(tag: string): string | undefined } }).dataSet;
    return partial?.string('x0020000e') ?? 'sem-serie';
  }
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  const config = await loadConfig(flags.get('config') ?? 'pacs.json');
  const options: ClientOptions = { connect: connectNode(10_000, config.servers), callingAeTitle: config.myAeTitle };

  if (command === 'servidores') {
    console.log(`AE title desta estação: ${config.myAeTitle}`);
    for (const s of config.servers) {
      const seguranca = !s.tls ? 'conexão aberta' : s.certificateSha256 ? 'TLS, certificado confirmado' : 'TLS, certificado a confirmar';
      console.log(`  ${s.name}: ${s.host}:${s.port} (AE ${s.aeTitle}; ${seguranca})`);
    }
    return;
  }

  const server = findServer(config, need(positional[1], 'o nome do servidor'));

  if (command === 'certificado') {
    const cert = await fetchCertificateNode(server.host, server.port).catch((error: Error) => {
      throw new PacsError('SEM_CONEXAO', `Não foi possível ler o certificado de ${server.name}: ${error.message}`);
    });
    console.log(`Certificado apresentado por ${server.name} (${server.host}:${server.port}):`);
    if (cert.titular) console.log(`  emitido para: ${cert.titular}`);
    if (cert.validoAte) console.log(`  válido até:   ${cert.validoAte}`);
    console.log(`  SHA-256:      ${formatFingerprint(cert.sha256)}`);
    if (server.certificateSha256 === cert.sha256) {
      console.log('É o certificado já confirmado em pacs.json.');
    } else {
      console.log('Confira esta impressão digital com o TI do hospital. Se for a mesma, ponha no servidor, em pacs.json:');
      console.log(`  "tls": true, "certificado": "${formatFingerprint(cert.sha256)}"`);
    }
    return;
  }

  if (command === 'eco') {
    const start = Date.now();
    await echo(server, options);
    console.log(`${server.name} respondeu em ${Date.now() - start} ms.`);
    return;
  }

  if (command === 'buscar') {
    const filters = {
      patientName: flags.get('nome'),
      patientId: flags.get('id'),
      accessionNumber: flags.get('acesso'),
      dateFrom: flags.get('de'),
      dateTo: flags.get('ate'),
      modality: flags.get('modalidade'),
    };
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
    const { results, truncated } = await findStudies(server, clean, options);
    if (results.length === 0) console.log('Nenhum estudo encontrado.');
    for (const s of results) {
      console.log(
        [
          formatDate(s.studyDate),
          s.modalities.join('/'),
          (s.patientName ?? '').replace(/\^+/g, ' ').trim(),
          `ID ${s.patientId ?? '?'}`,
          s.description ?? '',
          s.instanceCount !== undefined ? `${s.instanceCount} imagens` : '',
        ]
          .filter((part) => part !== '')
          .join(' | '),
      );
      console.log(`    ${s.studyInstanceUid}`);
    }
    if (truncated) console.log('Há mais resultados; refine a pesquisa.');
    return;
  }

  if (command === 'series') {
    const { results } = await findSeries(server, need(positional[2], 'o UID do estudo'), options);
    if (results.length === 0) console.log('Nenhuma série encontrada.');
    for (const s of results) {
      console.log(
        `${String(s.seriesNumber ?? '?').padStart(4)} | ${s.modality ?? '?'} | ${s.description ?? ''} | ` +
          `${s.instanceCount ?? '?'} imagens`,
      );
      console.log(`    ${s.seriesInstanceUid}`);
    }
    return;
  }

  if (command === 'baixar') {
    const studyInstanceUid = need(positional[2], 'o UID do estudo');
    const out = flags.get('pasta') ?? join('test-data', 'pacs');
    const controller = new AbortController();
    process.once('SIGINT', () => {
      console.log('\nCancelando...');
      controller.abort();
    });
    const request = flags.has('serie')
      ? { studyInstanceUid, seriesInstanceUid: flags.get('serie')! }
      : { studyInstanceUid };
    const summary = await retrieve(server, request, {
      ...options,
      signal: controller.signal,
      onInstance: async (instance) => {
        const relative = instancePath(studyInstanceUid, seriesUidOf(instance.file), instance.sopInstanceUid);
        const full = join(out, relative);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, instance.file);
      },
      onProgress: ({ received, remaining }) => {
        const total = remaining !== undefined ? ` de ${received + remaining}` : '';
        process.stdout.write(`\r${received}${total} imagens`);
      },
    });
    process.stdout.write('\n');
    console.log(`${summary.received} imagens gravadas em ${join(out, studyInstanceUid)}.`);
    if (summary.failed > 0) console.log(`Atenção: o servidor não conseguiu enviar ${summary.failed} imagens.`);
    if (summary.cancelled) console.log('Download cancelado antes do fim.');
    if (summary.received === 0 && !summary.cancelled) {
      console.log('Nada foi recebido. Confira o UID e se o servidor aceita C-GET para esta estação.');
    }
    return;
  }

  throw new PacsError('USO', 'Comandos: servidores, eco, buscar, series, baixar. Veja o começo de scripts/pacs.ts.');
}

main().catch((error: unknown) => {
  console.error(error instanceof PacsError ? error.message : error);
  process.exitCode = 1;
});
