import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHeader } from '../src/io/readHeader';
import {
  echo,
  findSeries,
  findStudies,
  retrieve,
  retrieveContexts,
  retrieveStudyParallel,
  type ParallelRetrieveProgress,
  type ReceivedInstance,
  type Transport,
} from '../src/pacs/client.ts';
import {
  findServer,
  formatFingerprint,
  instancePath,
  normalizeFingerprint,
  parseConfig,
  tlsCertificadoMudou,
} from '../src/pacs/config.ts';
import {
  COMMAND,
  MessageAssembler,
  STATUS,
  decodeCommand,
  describeStatus,
  encodeCommand,
  fragmentMessage,
} from '../src/pacs/dimse.ts';
import { PacsError } from '../src/pacs/errors.ts';
import { encodeImplicit, latin1, parseImplicit } from '../src/pacs/implicit.ts';
import { buildPart10 } from '../src/pacs/part10.ts';
import {
  PDU,
  PduBuffer,
  concat,
  decodeAssociateAc,
  decodeAssociateRq,
  decodePData,
  encodeAssociateRq,
  encodePData,
  encodeReleaseRp,
  isValidAeTitle,
  type AssociateRequest,
} from '../src/pacs/pdu.ts';
import {
  buildRetrieveIdentifier,
  buildSeriesQuery,
  buildStudyQuery,
  dateRange,
  parseSeriesResult,
  parseStudyResult,
  patientNamePattern,
  sortStudies,
} from '../src/pacs/query.ts';
import { IMAGE_STORAGE_CLASSES, OTHER_STORAGE_CLASSES, TS, UID, isValidUid } from '../src/pacs/uids.ts';
import { replay, type RecordedEvent } from './helpers/replayTransport.ts';

const recorded = JSON.parse(
  readFileSync(new URL('./fixtures/pacs-sessoes.json', import.meta.url), 'utf8'),
) as { sessoes: Record<string, RecordedEvent[]> };
const session = (name: string) => recorded.sessoes[name]!;

const SERVER = { name: 'teste', host: '127.0.0.1', port: 11113, aeTitle: 'TESTEPACS' };
const ME = 'ESTACAOTESTE';
const PET = '1.2.840.10008.5.1.4.1.1.128';
const text = (bytes: Uint8Array | undefined) => (bytes ? String.fromCharCode(...bytes).replace(/[\0 ]+$/, '') : undefined);

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof PacsError ? error.code : `outro: ${String(error)}`;
  }
  return 'sem erro';
}

// ---------------------------------------------------------------------------
describe('PDU', () => {
  const request: AssociateRequest = {
    calledAeTitle: 'PACS',
    callingAeTitle: 'EU',
    contexts: [
      { id: 1, abstractSyntax: UID.verification, transferSyntaxes: [TS.implicitVrLittleEndian] },
      { id: 3, abstractSyntax: PET, transferSyntaxes: [TS.explicitVrLittleEndian, TS.implicitVrLittleEndian] },
    ],
    roles: [{ sopClassUid: PET, scu: false, scp: true }],
    maxPduLength: 65536,
    implementationClassUid: '1.2.3.4',
    implementationVersionName: 'TESTE',
  };

  it('monta o pedido de associação no formato do padrão', () => {
    const bytes = encodeAssociateRq(request);
    expect(bytes[0]).toBe(PDU.associateRq);
    expect(new DataView(bytes.buffer).getUint32(2)).toBe(bytes.length - 6);
    expect([bytes[6], bytes[7]]).toEqual([0, 1]); // versão do protocolo
    expect(String.fromCharCode(...bytes.subarray(10, 26))).toBe('PACS            ');
    expect(String.fromCharCode(...bytes.subarray(26, 42))).toBe('EU              ');
    expect(bytes.subarray(42, 74).every((b) => b === 0)).toBe(true);
    // primeiro item: contexto de aplicação
    expect(bytes[74]).toBe(0x10);
    expect(String.fromCharCode(...bytes.subarray(78, 78 + 21))).toBe('1.2.840.10008.3.1.1.1');
  });

  it('o pedido montado é lido de volta sem perda', () => {
    expect(decodeAssociateRq(encodeAssociateRq(request).subarray(6))).toEqual(request);
  });

  it('recusa AE title inválido, contextos demais e identificador par', () => {
    expect(() => encodeAssociateRq({ ...request, callingAeTitle: 'ESTAÇÃO' })).toThrow(PacsError);
    expect(() => encodeAssociateRq({ ...request, calledAeTitle: 'NOME_COM_MAIS_DE_16_LETRAS' })).toThrow(PacsError);
    expect(() => encodeAssociateRq({ ...request, calledAeTitle: '   ' })).toThrow(PacsError);
    expect(() => encodeAssociateRq({ ...request, contexts: [{ ...request.contexts[0]!, id: 2 }] })).toThrow(PacsError);
    const many = Array.from({ length: 129 }, () => ({ ...request.contexts[0]!, id: 1 }));
    expect(() => encodeAssociateRq({ ...request, contexts: many })).toThrow(/128/);
    expect(isValidAeTitle('DSVR6')).toBe(true);
    expect(isValidAeTitle('A\\B')).toBe(false);
  });

  it('lê a aceitação de um servidor real', () => {
    const reply = Buffer.from(session('download')[1]!.b, 'base64');
    expect(reply[0]).toBe(PDU.associateAc);
    const accept = decodeAssociateAc(new Uint8Array(reply.subarray(6, 6 + reply.readUInt32BE(2))));
    expect(accept.maxPduLength).toBe(16382);
    expect(accept.contexts.find((c) => c.id === 1)).toEqual({ id: 1, result: 0, transferSyntax: TS.implicitVrLittleEndian });
    // PET sem compressão aceito; RLE aceito; JPEG-LS recusado pelo servidor de teste.
    expect(accept.contexts.find((c) => c.id === 3)?.transferSyntax).toBe(TS.explicitVrLittleEndian);
    expect(accept.contexts.find((c) => c.id === 15)?.transferSyntax).toBe(TS.rleLossless);
    expect(accept.contexts.find((c) => c.id === 11)?.result).not.toBe(0);
    expect(accept.roles).toEqual([{ sopClassUid: PET, scu: false, scp: true }]);
  });

  it('P-DATA vai e volta, com vários PDVs', () => {
    const pdvs = [
      { contextId: 1, isCommand: true, isLast: true, data: Uint8Array.of(1, 2, 3, 4) },
      { contextId: 1, isCommand: false, isLast: false, data: Uint8Array.of(9, 8) },
      { contextId: 1, isCommand: false, isLast: true, data: new Uint8Array(0) },
    ];
    const bytes = encodePData(pdvs);
    expect(bytes[0]).toBe(PDU.pData);
    expect(decodePData(bytes.subarray(6))).toEqual(pdvs);
    expect(() => decodePData(Uint8Array.of(0, 0, 0, 9, 1, 3, 0))).toThrow(PacsError);
  });

  it('PduBuffer remonta PDUs entregues em qualquer pedaço', () => {
    const a = encodePData([{ contextId: 1, isCommand: true, isLast: true, data: new Uint8Array(300).fill(7) }]);
    const b = encodePData([{ contextId: 3, isCommand: false, isLast: true, data: new Uint8Array(100000).fill(5) }]);
    const stream = concat([a, b, a]);
    for (const size of [1, 7, 4096, stream.length]) {
      const buffer = new PduBuffer();
      const lengths: number[] = [];
      for (let o = 0; o < stream.length; o += size) {
        buffer.push(stream.subarray(o, o + size));
        for (let p = buffer.next(); p; p = buffer.next()) lengths.push(p.body.length);
      }
      expect(lengths).toEqual([a.length - 6, b.length - 6, a.length - 6]);
    }
  });

  it('PduBuffer recusa o que não é DICOM', () => {
    const buffer = new PduBuffer();
    buffer.push(new TextEncoder().encode('HTTP/1.1 400 Bad Request'));
    expect(() => buffer.next()).toThrow(/não são DICOM/);
  });
});

// ---------------------------------------------------------------------------
describe('DIMSE', () => {
  it('C-ECHO-RQ tem os 68 bytes canônicos', () => {
    const bytes = encodeCommand({
      affectedSopClassUid: UID.verification,
      commandField: COMMAND.cEchoRq,
      messageId: 1,
      hasDataset: false,
    });
    const expected = [
      0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0x00, // tamanho do grupo = 56
      0x00, 0x00, 0x02, 0x00, 0x12, 0x00, 0x00, 0x00,
      ...[...'1.2.840.10008.1.1'].map((c) => c.charCodeAt(0)), 0x00,
      0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00, 0x00, 0x30, 0x00,
      0x00, 0x00, 0x10, 0x01, 0x02, 0x00, 0x00, 0x00, 0x01, 0x00,
      0x00, 0x00, 0x00, 0x08, 0x02, 0x00, 0x00, 0x00, 0x01, 0x01,
    ];
    expect([...bytes]).toEqual(expected);
  });

  it('comando vai e volta', () => {
    const command = {
      affectedSopClassUid: UID.studyRootGet,
      commandField: COMMAND.cGetRsp,
      messageIdBeingRespondedTo: 7,
      hasDataset: false,
      status: STATUS.pending,
      remaining: 12,
      completed: 3,
      failed: 1,
      warning: 0,
    };
    expect(decodeCommand(encodeCommand(command))).toEqual(command);
    const store = {
      affectedSopClassUid: PET,
      commandField: COMMAND.cStoreRq,
      messageId: 65535,
      priority: 0,
      hasDataset: true,
      affectedSopInstanceUid: '1.2.3.4.5',
    };
    expect(decodeCommand(encodeCommand(store))).toEqual(store);
    expect(() => decodeCommand(new Uint8Array(0))).toThrow(PacsError);
  });

  it('fragmenta respeitando o tamanho máximo da PDU e remonta', () => {
    const command = encodeCommand({ commandField: COMMAND.cFindRq, messageId: 1, hasDataset: true, affectedSopClassUid: UID.studyRootFind });
    const dataset = Uint8Array.from({ length: 5000 }, (_, k) => k % 251);
    for (const max of [0, 128, 1024, 16382]) {
      const pdus = fragmentMessage(5, command, dataset, max);
      if (max > 0) for (const p of pdus) expect(p.length - 6).toBeLessThanOrEqual(max);
      const assembler = new MessageAssembler();
      let message;
      for (const p of pdus) for (const pdv of decodePData(p.subarray(6))) message = assembler.push(pdv) ?? message;
      expect(message!.contextId).toBe(5);
      expect(message!.command.commandField).toBe(COMMAND.cFindRq);
      expect([...message!.dataset!]).toEqual([...dataset]);
    }
    expect(fragmentMessage(1, command, undefined, 0)).toHaveLength(1);
  });

  it('recusa dados sem comando e comando sobreposto', () => {
    const a = new MessageAssembler();
    expect(() => a.push({ contextId: 1, isCommand: false, isLast: true, data: new Uint8Array(2) })).toThrow(PacsError);
    const b = new MessageAssembler();
    const withData = encodeCommand({ commandField: COMMAND.cStoreRq, hasDataset: true });
    b.push({ contextId: 1, isCommand: true, isLast: true, data: withData });
    expect(() => b.push({ contextId: 1, isCommand: true, isLast: true, data: withData })).toThrow(PacsError);
  });

  it('descreve os status em português', () => {
    expect(describeStatus(0xa702)).toContain('não conseguiu enviar');
    expect(describeStatus(0xc001, 'detalhe')).toBe('o servidor não conseguiu processar o pedido (0xC001: detalhe)');
    expect(describeStatus(0x0124)).toContain('autorização');
  });
});

// ---------------------------------------------------------------------------
describe('Implicit VR', () => {
  it('pula sequências de tamanho indefinido, inclusive aninhadas', () => {
    const el = (tag: string, value: Uint8Array) => encodeImplicit([{ tag, value }]);
    const raw = (group: number, element: number, length: number) => {
      const b = new Uint8Array(8);
      const v = new DataView(b.buffer);
      v.setUint16(0, group, true);
      v.setUint16(2, element, true);
      v.setUint32(4, length, true);
      return b;
    };
    const inner = concat([raw(0x0008, 0x1140, 0xffffffff), raw(0xfffe, 0xe000, 8), el('00080018', new Uint8Array(0)), raw(0xfffe, 0xe0dd, 0)]);
    const bytes = concat([
      el('00080020', latin1('20260115')),
      raw(0x0008, 0x1110, 0xffffffff),
      raw(0xfffe, 0xe000, 0xffffffff),
      el('00080050', latin1('DENTRO')),
      inner,
      raw(0xfffe, 0xe00d, 0),
      raw(0xfffe, 0xe0dd, 0),
      el('00100020', latin1('FORA')),
    ]);
    const parsed = parseImplicit(bytes);
    expect([...parsed.keys()]).toEqual(['00080020', '00100020']);
    expect(text(parsed.get('00100020'))).toBe('FORA');
  });

  it('recusa dados truncados em vez de travar', () => {
    const good = encodeImplicit([{ tag: '00100020', value: latin1('ABCD') }]);
    expect(() => parseImplicit(good.subarray(0, good.length - 1))).toThrow(PacsError);
    expect(() => parseImplicit(good.subarray(0, 5))).toThrow(PacsError);
    const open = Uint8Array.of(0x08, 0, 0x10, 0x11, 0xff, 0xff, 0xff, 0xff);
    expect(() => parseImplicit(open)).toThrow(PacsError);
  });
});

// ---------------------------------------------------------------------------
describe('consultas', () => {
  it('transforma o nome digitado em padrão de busca', () => {
    expect(patientNamePattern('  joão   silva ')).toBe('*JOÃO*SILVA*');
    expect(patientNamePattern('SILVA^JOAO*')).toBe('SILVA^JOAO*');
    expect(patientNamePattern('ma?ia')).toBe('MA?IA');
    expect(patientNamePattern('')).toBe('');
    expect(() => patientNamePattern('a\\b')).toThrow(PacsError);
  });

  it('monta faixas de datas', () => {
    expect(dateRange('20261101', '20261113')).toBe('20261101-20261113');
    expect(dateRange('20261101', undefined)).toBe('20261101-');
    expect(dateRange(undefined, '20261113')).toBe('-20261113');
    expect(dateRange('20261113', '20261113')).toBe('20261113');
    expect(dateRange(undefined, undefined)).toBe('');
    expect(() => dateRange('13/11/2026', undefined)).toThrow(/AAAAMMDD/);
    expect(() => dateRange('20261113', '20261101')).toThrow(PacsError);
  });

  it('consulta de estudo traz filtros e chaves de retorno', () => {
    const q = parseImplicit(buildStudyQuery({ patientName: 'silva', dateFrom: '20261101', modality: 'pt' }));
    expect(text(q.get('00080052'))).toBe('STUDY');
    expect(text(q.get('00100010'))).toBe('*SILVA*');
    expect(text(q.get('00080020'))).toBe('20261101-');
    expect(text(q.get('00080061'))).toBe('PT');
    for (const tag of ['00100020', '0020000d', '00081030', '00201208', '00080030']) {
      expect(q.get(tag)?.length).toBe(0);
    }
    expect(q.has('00080005')).toBe(false);
    // tags em ordem crescente, como o padrão exige
    const tags = [...q.keys()];
    expect(tags).toEqual([...tags].sort());
  });

  it('declara o conjunto de caracteres quando há acento', () => {
    const q = parseImplicit(buildStudyQuery({ patientName: 'conceição' }));
    expect(text(q.get('00080005'))).toBe('ISO_IR 100');
    expect([...q.get('00100010')!]).toContain(0xc7); // Ç em Latin-1
  });

  it('exige pelo menos um filtro de verdade', () => {
    expect(() => buildStudyQuery({})).toThrow(/pelo menos/);
    expect(() => buildStudyQuery({ modality: 'CT' })).toThrow(/pelo menos/);
    expect(() => buildStudyQuery({ patientName: '   ' })).toThrow(/pelo menos/);
    expect(() => buildStudyQuery({ patientId: '12\\34' })).toThrow(PacsError);
    expect(buildStudyQuery({ accessionNumber: 'A1' }).length).toBeGreaterThan(0);
  });

  it('consultas de série e de download validam os UIDs', () => {
    const s = parseImplicit(buildSeriesQuery('1.2.3'));
    expect(text(s.get('00080052'))).toBe('SERIES');
    expect(text(s.get('0020000d'))).toBe('1.2.3');
    expect(s.get('0020000d')!.length).toBe(6); // preenchido com zero até tamanho par
    expect(() => buildSeriesQuery('1.2.*')).toThrow(PacsError);

    const study = parseImplicit(buildRetrieveIdentifier('1.2.3'));
    expect(text(study.get('00080052'))).toBe('STUDY');
    expect(study.has('0020000e')).toBe(false);
    const series = parseImplicit(buildRetrieveIdentifier('1.2.3', '1.2.3.4'));
    expect(text(series.get('00080052'))).toBe('SERIES');
    expect(text(series.get('0020000e'))).toBe('1.2.3.4');
    expect(() => buildRetrieveIdentifier('1.2.3', '../x')).toThrow(PacsError);
    expect(() => buildRetrieveIdentifier('')).toThrow(PacsError);
    expect(isValidUid('1.2.840.10008.1.1')).toBe(true);
    expect(isValidUid('1..2')).toBe(false);
    expect(isValidUid('1'.repeat(65))).toBe(false);
  });

  it('lê respostas, inclusive em UTF-8, e descarta as sem UID válido', () => {
    const utf8 = new TextEncoder().encode('CONCEIÇÃO^JOÃO ');
    const reply = encodeImplicit([
      { tag: '00080005', value: latin1('ISO_IR 192') },
      { tag: '00080061', value: latin1('CT\\PT ') },
      { tag: '00100010', value: utf8 },
      { tag: '0020000d', value: latin1('1.2.3', 0) },
      { tag: '00201208', value: latin1('350 ') },
      { tag: '00201206', value: latin1('abc ') },
    ]);
    expect(parseStudyResult(reply)).toEqual({
      studyInstanceUid: '1.2.3',
      modalities: ['CT', 'PT'],
      patientName: 'CONCEIÇÃO^JOÃO',
      instanceCount: 350,
    });
    expect(parseStudyResult(encodeImplicit([{ tag: '0020000d', value: latin1('../etc ') }]))).toBeUndefined();
    expect(parseStudyResult(new Uint8Array(0))).toBeUndefined();
    expect(parseSeriesResult(encodeImplicit([{ tag: '0020000d', value: latin1('1.2.3', 0) }]))).toBeUndefined();
  });

  it('ordena estudos do mais recente ao mais antigo', () => {
    const s = (studyDate: string, studyTime?: string) => ({ studyInstanceUid: '1', modalities: [], studyDate, ...(studyTime ? { studyTime } : {}) });
    const sorted = sortStudies([s('20250101'), s('20260115', '0830'), s('20260115', '143000.5'), s('20240101')]);
    expect(sorted.map((x) => `${x.studyDate} ${x.studyTime ?? ''}`.trim())).toEqual([
      '20260115 143000.5',
      '20260115 0830',
      '20250101',
      '20240101',
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('arquivo Part 10 e configuração', () => {
  it('o arquivo gravado é lido pelo leitor do visualizador', () => {
    const dataset = encodeImplicit([
      { tag: '00080060', value: latin1('PT') },
      { tag: '00100010', value: latin1('PHANTOM^SUV') },
      { tag: '0020000d', value: latin1('1.2.3', 0) },
      { tag: '0020000e', value: latin1('1.2.3.4', 0) },
    ]);
    const file = buildPart10({
      sopClassUid: PET,
      sopInstanceUid: '1.2.3.4.5',
      transferSyntaxUid: TS.implicitVrLittleEndian,
      sourceAeTitle: 'PACS',
      dataset,
    });
    expect(String.fromCharCode(...file.subarray(128, 132))).toBe('DICM');
    const outcome = parseHeader(file, 'baixado');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.meta.transferSyntaxUid).toBe(TS.implicitVrLittleEndian);
    expect(outcome.meta.modality).toBe('PT');
    expect(outcome.meta.patientName).toBe('PHANTOM^SUV');
    expect(outcome.meta.seriesInstanceUid).toBe('1.2.3.4');
    expect([...file.subarray(file.length - dataset.length)]).toEqual([...dataset]);
  });

  it('valida o pacs.json', () => {
    const good = {
      meuAeTitle: 'ESTACAO',
      servidores: [{ nome: 'Hospital A', host: 'pacs.exemplo.org', porta: 104, aeTitle: 'PACSA' }],
    };
    const config = parseConfig(good);
    expect(config).toEqual({
      myAeTitle: 'ESTACAO',
      servers: [{ name: 'Hospital A', host: 'pacs.exemplo.org', port: 104, aeTitle: 'PACSA' }],
    });
    expect(findServer(config, 'hospital a').port).toBe(104);
    expect(() => findServer(config, 'outro')).toThrow(/Cadastrados: Hospital A/);

    const server = good.servidores[0]!;
    const bad: unknown[] = [
      null,
      { ...good, meuAeTitle: 'ESTAÇÃO' },
      { ...good, servidores: [] },
      { ...good, servidores: [{ ...server, porta: '104' }] },
      { ...good, servidores: [{ ...server, porta: 70000 }] },
      { ...good, servidores: [{ ...server, host: 'a b' }] },
      { ...good, servidores: [{ ...server, aeTitle: '' }] },
      { ...good, servidores: [server, { ...server, nome: 'HOSPITAL A' }] },
    ];
    for (const b of bad) expect(() => parseConfig(b)).toThrow(PacsError);
  });

  it('lê a conexão segura (TLS) e a impressão digital do certificado', () => {
    const hex = 'AB'.repeat(32);
    const base = { nome: 'Seguro', host: '10.0.0.5', porta: 2762, aeTitle: 'PACSB' };
    const config = parseConfig({
      meuAeTitle: 'ESTACAO',
      servidores: [
        { ...base, tls: true, certificado: 'ab:'.repeat(31) + 'ab' },
        { ...base, nome: 'Seguro sem certificado', tls: true },
        { ...base, nome: 'Aberto', tls: false },
      ],
    });
    expect(config.servers[0]).toEqual({ name: 'Seguro', host: '10.0.0.5', port: 2762, aeTitle: 'PACSB', tls: true, certificateSha256: hex });
    expect(config.servers[1]).toEqual({ name: 'Seguro sem certificado', host: '10.0.0.5', port: 2762, aeTitle: 'PACSB', tls: true });
    expect(config.servers[2]).toEqual({ name: 'Aberto', host: '10.0.0.5', port: 2762, aeTitle: 'PACSB' });

    const ruins = [
      { ...base, tls: 'sim' },
      { ...base, tls: true, certificado: 'ABCD' },
      { ...base, tls: true, certificado: 42 },
      { ...base, certificado: hex }, // certificado sem TLS
    ];
    for (const r of ruins) expect(() => parseConfig({ meuAeTitle: 'ESTACAO', servidores: [r] })).toThrow(PacsError);
  });

  it('normaliza e formata a impressão digital', () => {
    const hex = '0123456789ABCDEF'.repeat(4);
    expect(normalizeFingerprint(hex.toLowerCase())).toBe(hex);
    expect(normalizeFingerprint(formatFingerprint(hex))).toBe(hex);
    expect(normalizeFingerprint(' 01:23 ' + hex.slice(4))).toBe(hex);
    expect(normalizeFingerprint(hex.slice(2))).toBeUndefined();
    expect(normalizeFingerprint(hex.slice(0, 63) + 'G')).toBeUndefined();
    expect(formatFingerprint('ABCDEF')).toBe('AB:CD:EF');
    expect(tlsCertificadoMudou(hex, 'FF'.repeat(32))).toMatch(/esperado 01:23:45.*recebido FF:FF:FF/);
  });

  it('só aceita UIDs como nome de pasta e de arquivo', () => {
    expect(instancePath('1.2', '1.2.3', '1.2.3.4')).toBe('1.2/1.2.3/1.2.3.4.dcm');
    expect(() => instancePath('1.2', '../../fora', '1.2.3.4')).toThrow(PacsError);
    expect(() => instancePath('1.2', 'sem-serie', '1.2.3.4')).toThrow(PacsError);
    expect(() => instancePath('1.2', '1.2.3', 'C:\\x')).toThrow(PacsError);
  });

  it('contextos padrão do download cabem numa associação', () => {
    const { contexts, roles } = retrieveContexts();
    expect(contexts.length).toBeLessThanOrEqual(128);
    expect(contexts[0]!.abstractSyntax).toBe(UID.studyRootGet);
    expect(new Set(contexts.map((c) => c.id)).size).toBe(contexts.length);
    expect(contexts.every((c) => c.id % 2 === 1 && c.id <= 255)).toBe(true);
    expect(roles).toHaveLength(IMAGE_STORAGE_CLASSES.length + OTHER_STORAGE_CLASSES.length);
    expect(roles.every((r) => r.scp && !r.scu)).toBe(true);
    // o pedido completo é montável
    expect(() => encodeAssociateRq({ calledAeTitle: 'A', callingAeTitle: 'B', contexts, roles, maxPduLength: 65536, implementationClassUid: '1.2', implementationVersionName: 'X' })).not.toThrow();
    const tooMany = Array.from({ length: 20 }, (_, k) => `1.2.3.${k}`);
    expect(() => retrieveContexts(tooMany, [])).toThrow(/128/);
  });
});

// ---------------------------------------------------------------------------
describe('cliente contra trocas gravadas com um servidor real', () => {
  // Ordem original dos grupos usada quando as sessões de replay foram gravadas.
  const RECORDED_TS_GROUPS: readonly (readonly string[])[] = [
    [TS.explicitVrLittleEndian, TS.implicitVrLittleEndian],
    [TS.jpegLosslessSv1],
    [TS.jpeg2000Lossless],
    [TS.jpeg2000],
    [TS.jpegLsLossless],
    [TS.jpegBaseline],
    [TS.rleLossless],
  ];
  // Cada sessão é repetida com as respostas inteiras e picadas byte a byte.
  for (const chunk of [Number.MAX_SAFE_INTEGER, 1, 13]) {
    const label = chunk === Number.MAX_SAFE_INTEGER ? 'respostas inteiras' : `pedaços de ${chunk} byte(s)`;

    it(`C-ECHO (${label})`, async () => {
      const r = replay(session('eco'), chunk);
      await echo(SERVER, { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536 });
      expect(r.errors).toEqual([]);
      expect(r.finished()).toBe(true);
    });

    it(`pesquisa de estudos (${label})`, async () => {
      const r = replay(session('estudos'), chunk);
      const found = await findStudies(SERVER, { patientName: 'paciente 07' }, { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536 });
      expect(r.errors).toEqual([]);
      expect(r.finished()).toBe(true);
      expect(found).toEqual({
        truncated: false,
        results: [
          {
            studyInstanceUid: '1.2.826.0.1.3680043.8.498.99.8',
            modalities: ['PT'],
            patientName: 'LOTE^PACIENTE 07',
            patientId: 'LOTE07',
            patientBirthDate: '19700101',
            patientSex: 'M',
            studyDate: '20250908',
            studyTime: '142000',
            description: 'PHANTOM PET/CT',
            accessionNumber: 'PHANTOM',
            seriesCount: 1,
            instanceCount: 1,
          },
        ],
      });
    });

    it(`download por C-GET (${label})`, async () => {
      const r = replay(session('download'), chunk);
      const files: ReceivedInstance[] = [];
      const progress: number[] = [];
      const summary = await retrieve(
        SERVER,
        { studyInstanceUid: '1.2.826.0.1.3680043.8.498.99.8' },
        {
          connect: r.connect,
          callingAeTitle: ME,
          maxPduLength: 65536,
          transferSyntaxGroups: RECORDED_TS_GROUPS,
          imageClasses: [PET],
          otherClasses: [],
          onInstance: (i) => void files.push(i),
          onProgress: (p) => progress.push(p.received),
        },
      );
      expect(r.errors).toEqual([]);
      expect(r.finished()).toBe(true);
      expect(summary).toEqual({ received: 1, failed: 0, warning: 0, cancelled: false });
      expect(progress.at(-1)).toBe(1);
      expect(files).toHaveLength(1);
      const file = files[0]!;
      expect(file.sopClassUid).toBe(PET);
      expect(file.sopInstanceUid).toBe('1.2.826.0.1.3680043.8.498.99.8.1.1');
      expect(file.transferSyntaxUid).toBe(TS.explicitVrLittleEndian);
      // O arquivo recebido abre no leitor do visualizador, com os dados de PET intactos.
      const outcome = parseHeader(file.file, 'x');
      expect(outcome.ok && outcome.complete).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.meta.patientId).toBe('LOTE07');
      expect(outcome.meta.rows).toBe(4);
      expect(outcome.meta.pet?.radionuclideTotalDoseBq).toBe(370000000);
      expect(outcome.meta.pet?.units).toBe('BQML');
    });
  }

  it('nome com acento: pedido e resposta', async () => {
    const r = replay(session('acento'));
    const found = await findStudies(SERVER, { patientName: 'conceição' }, { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536 });
    expect(r.errors).toEqual([]);
    expect(found.results.map((s) => [s.patientName, s.description])).toEqual([['CONCEIÇÃO^JOÃO', 'ABDOME SUPERIOR']]);
  });

  it('limite de resultados: cancela e marca como truncado', async () => {
    const r = replay(session('limite'), 64);
    const found = await findStudies(SERVER, { patientName: 'lote' }, { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536, limit: 3 });
    expect(r.errors).toEqual([]);
    expect(found.truncated).toBe(true);
    expect(found.results).toHaveLength(3);
    expect(found.results.map((s) => s.studyDate)).toEqual(['20250921', '20250915', '20250910']);
  });

  it('séries de um estudo', async () => {
    const r = replay(session('series'));
    const found = await findSeries(SERVER, '1.2.826.0.1.3680043.8.498.99.8', { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536 });
    expect(r.errors).toEqual([]);
    expect(found.results).toEqual([
      {
        studyInstanceUid: '1.2.826.0.1.3680043.8.498.99.8',
        seriesInstanceUid: '1.2.826.0.1.3680043.8.498.99.8.1',
        seriesNumber: 3,
        modality: 'PT',
        description: 'PET PHANTOM AC',
        instanceCount: 1,
      },
    ]);
  });

  it('estudo inexistente: termina sem imagens e sem erro', async () => {
    const r = replay(session('inexistente'));
    const summary = await retrieve(SERVER, { studyInstanceUid: '1.2.3.4.5' }, { connect: r.connect, callingAeTitle: ME, maxPduLength: 65536, transferSyntaxGroups: RECORDED_TS_GROUPS, imageClasses: [PET], otherClasses: [], onInstance: () => {} });
    expect(r.errors).toEqual([]);
    expect(summary.received).toBe(0);
  });

  it('recusas do servidor viram mensagens claras', async () => {
    const intruder = replay(session('recusado'));
    expect(await codeOf(echo(SERVER, { connect: intruder.connect, callingAeTitle: 'INTRUSO', maxPduLength: 65536 }))).toBe('AE_NAO_AUTORIZADO');
    const wrong = replay(session('servidor-errado'));
    expect(await codeOf(echo({ ...SERVER, aeTitle: 'OUTRONOME' }, { connect: wrong.connect, callingAeTitle: ME, maxPduLength: 65536 }))).toBe('AE_DO_SERVIDOR_ERRADO');
  });

  it('não abre conexão quando o pedido é inválido', async () => {
    const r = replay(session('estudos'));
    expect(await codeOf(findStudies(SERVER, {}, { connect: r.connect, callingAeTitle: ME }))).toBe('FILTRO_VAZIO');
    expect(await codeOf(findSeries(SERVER, 'abc', { connect: r.connect, callingAeTitle: ME }))).toBe('UID_INVALIDO');
    expect(await codeOf(retrieve(SERVER, { studyInstanceUid: '1.2', seriesInstanceUid: '..' }, { connect: r.connect, callingAeTitle: ME, onInstance: () => {} }))).toBe('UID_INVALIDO');
    expect(r.connections).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('cliente diante de falhas', () => {
  const acceptPdu = () => new Uint8Array(Buffer.from(session('download')[1]!.b, 'base64'));

  /** Servidor falso: aceita a associação e responde ao primeiro pedido com `reply`. */
  function scripted(reply: (send: (bytes: Uint8Array) => void, close: (error?: Error) => void) => void) {
    let writes = 0;
    let onData: (chunk: Uint8Array) => void = () => {};
    let onClose: (error?: Error) => void = () => {};
    const sent: Uint8Array[] = [];
    const transport: Transport = {
      send(data) {
        sent.push(data.slice());
        writes++;
        if (writes === 1) queueMicrotask(() => onData(acceptPdu()));
        if (writes === 2) queueMicrotask(() => reply((b) => onData(b), (e) => onClose(e)));
      },
      close() {},
      onData: (cb) => (onData = cb),
      onClose: (cb) => (onClose = cb),
    };
    return { connect: async () => transport, sent };
  }

  const get = (connect: () => Promise<Transport>, onInstance: (i: ReceivedInstance) => void = () => {}) =>
    retrieve(SERVER, { studyInstanceUid: '1.2.826.0.1.3680043.8.498.99.8' }, {
      connect, callingAeTitle: ME, imageClasses: [PET], otherClasses: [], onInstance, timeoutMs: 300,
    });

  const storeRq = (sopInstanceUid: string, contextId = 3) =>
    concat(fragmentMessage(contextId, encodeCommand({
      affectedSopClassUid: PET, commandField: COMMAND.cStoreRq, messageId: 9, priority: 0, hasDataset: true, affectedSopInstanceUid: sopInstanceUid,
    }), encodeImplicit([{ tag: '00100020', value: latin1('X ') }]), 0));

  it('conexão recusada', async () => {
    const connect = async () => {
      throw new Error('ECONNREFUSED');
    };
    const error = await echo(SERVER, { connect, callingAeTitle: ME }).catch((e: PacsError) => e);
    expect(error).toBeInstanceOf(PacsError);
    expect((error as PacsError).code).toBe('SEM_CONEXAO');
    expect((error as PacsError).message).toContain('127.0.0.1:11113');
  });

  it('servidor fecha a conexão no meio', async () => {
    const s = scripted((_, close) => close());
    expect(await codeOf(get(s.connect))).toBe('CONEXAO_FECHADA');
  });

  it('servidor para de responder', async () => {
    const s = scripted(() => {});
    expect(await codeOf(get(s.connect))).toBe('TEMPO_ESGOTADO');
  });

  it('imagem com identificador malicioso é recusada', async () => {
    const received: ReceivedInstance[] = [];
    const s = scripted((send) => send(storeRq('../../../fora')));
    expect(await codeOf(get(s.connect, (i) => received.push(i)))).toBe('DADOS_INVALIDOS');
    expect(received).toEqual([]);
  });

  it('imagem em contexto que não foi aceito é recusada', async () => {
    const s = scripted((send) => send(storeRq('1.2.3', 11)));
    expect(await codeOf(get(s.connect))).toBe('DADOS_INVALIDOS');
  });

  it('falha ao guardar a imagem: avisa o servidor e interrompe', async () => {
    const s = scripted((send) => send(storeRq('1.2.3')));
    const error = await get(s.connect, () => {
      throw new Error('disco cheio');
    }).catch((e: Error) => e);
    expect((error as Error).message).toBe('disco cheio');
    // Depois do pedido, o cliente responde ao C-STORE com status de falha e aborta.
    const commands = s.sent
      .filter((p) => p[0] === PDU.pData)
      .flatMap((p) => decodePData(p.subarray(6)))
      .filter((v) => v.isCommand)
      .map((v) => decodeCommand(v.data));
    const reply = commands.at(-1)!;
    expect(reply.commandField).toBe(COMMAND.cStoreRsp);
    expect(reply.status).toBe(0xa700);
    expect(reply.messageIdBeingRespondedTo).toBe(9);
    expect(s.sent.at(-1)![0]).toBe(PDU.abort);
  });

  it('status de falha do servidor vira mensagem em português', async () => {
    const s = scripted((send) =>
      send(concat(fragmentMessage(1, encodeCommand({ affectedSopClassUid: UID.studyRootGet, commandField: COMMAND.cGetRsp, messageIdBeingRespondedTo: 1, hasDataset: false, status: 0xa702, failed: 5 }), undefined, 0))),
    );
    const error = await get(s.connect).catch((e: PacsError) => e);
    expect((error as PacsError).code).toBe('DOWNLOAD_FALHOU');
    expect((error as PacsError).message).toBe('O download falhou: o servidor não conseguiu enviar as imagens (0xA702).');
  });

  it('falhas parciais aparecem no resumo', async () => {
    const s = scripted((send) =>
      send(concat([
        storeRq('1.2.3'),
        ...fragmentMessage(1, encodeCommand({ affectedSopClassUid: UID.studyRootGet, commandField: COMMAND.cGetRsp, messageIdBeingRespondedTo: 1, hasDataset: false, status: 0xb000, completed: 1, failed: 2, warning: 0, remaining: 0 }), undefined, 0),
      ])),
    );
    // o servidor falso não responde ao pedido de encerramento; o cliente não pode ficar preso nisso
    expect(await get(s.connect)).toEqual({ received: 1, failed: 2, warning: 0, cancelled: false });
  });

  it('cancelar envia C-CANCEL ao servidor', async () => {
    const controller = new AbortController();
    controller.abort();
    const s = scripted((send) =>
      send(concat(fragmentMessage(1, encodeCommand({ affectedSopClassUid: UID.studyRootGet, commandField: COMMAND.cGetRsp, messageIdBeingRespondedTo: 1, hasDataset: false, status: STATUS.cancel }), undefined, 0))),
    );
    const summary = await retrieve(SERVER, { studyInstanceUid: '1.2.3' }, { connect: s.connect, callingAeTitle: ME, imageClasses: [PET], otherClasses: [], onInstance: () => {}, signal: controller.signal, timeoutMs: 300 });
    expect(summary.cancelled).toBe(true);
    const commands = s.sent.slice(1).flatMap((p) => (p[0] === PDU.pData ? decodePData(p.subarray(6)) : [])).filter((v) => v.isCommand).map((v) => decodeCommand(v.data).commandField);
    expect(commands).toEqual([COMMAND.cGetRq, COMMAND.cCancelRq]);
  });
});

// ---------------------------------------------------------------------------
describe('retrieveStudyParallel', () => {
  const acceptPdu = () => new Uint8Array(Buffer.from(session('download')[1]!.b, 'base64'));
  const storeRqFor = (sopUid: string, msgId: number) =>
    concat([
      ...fragmentMessage(
        3,
        encodeCommand({
          affectedSopClassUid: PET,
          commandField: COMMAND.cStoreRq,
          messageId: msgId,
          hasDataset: true,
          affectedSopInstanceUid: sopUid,
        }),
        new Uint8Array([1, 2, 3, 4]),
        0,
      ),
    ]);
  const cGetPending = (remaining: number) =>
    concat(
      fragmentMessage(
        1,
        encodeCommand({
          affectedSopClassUid: UID.studyRootGet,
          commandField: COMMAND.cGetRsp,
          messageIdBeingRespondedTo: 1,
          hasDataset: false,
          status: STATUS.pending,
          remaining,
        }),
        undefined,
        0,
      ),
    );
  const cGetDone = (completed: number) =>
    concat(
      fragmentMessage(
        1,
        encodeCommand({
          affectedSopClassUid: UID.studyRootGet,
          commandField: COMMAND.cGetRsp,
          messageIdBeingRespondedTo: 1,
          hasDataset: false,
          status: STATUS.success,
          completed,
          failed: 0,
          warning: 0,
          remaining: 0,
        }),
        undefined,
        0,
      ),
    );

  it('baixa múltiplas séries respeitando a concorrência e agrega progresso global', async () => {
    let activeConnections = 0;
    let maxActiveConnections = 0;
    let seq = 0;

    const connect = async (): Promise<Transport> => {
      activeConnections++;
      maxActiveConnections = Math.max(maxActiveConnections, activeConnections);
      const connId = ++seq;
      let writes = 0;
      let closed = false;
      let onData: (chunk: Uint8Array) => void = () => {};
      let onClose: (error?: Error) => void = () => {};

      return {
        send(data) {
          writes++;
          if (writes === 1) {
            queueMicrotask(() => onData(acceptPdu()));
          } else if (writes === 2) {
            setTimeout(() => {
              if (closed) return;
              onData(
                concat([
                  cGetPending(2),
                  storeRqFor(`1.2.3.${connId}.1`, 10 + connId),
                  storeRqFor(`1.2.3.${connId}.2`, 20 + connId),
                  cGetDone(2),
                ]),
              );
            }, 15);
          } else if (data[0] === PDU.releaseRq) {
            queueMicrotask(() => onData(encodeReleaseRp()));
          }
        },
        close() {
          if (closed) return;
          closed = true;
          activeConnections--;
          queueMicrotask(() => onClose());
        },
        onData(cb) {
          onData = cb;
        },
        onClose(cb) {
          onClose = cb;
        },
      };
    };

    const seriesList = [
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.1', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.2', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.3', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.4', instanceCount: 2 },
    ];

    const receivedInstances: string[] = [];
    const progressEvents: ParallelRetrieveProgress[] = [];
    const completedSeries: string[] = [];

    const summary = await retrieveStudyParallel(SERVER, '1.2.3', {
      connect,
      callingAeTitle: ME,
      concurrency: 2,
      seriesList,
      imageClasses: [PET],
      otherClasses: [],
      timeoutMs: 1000,
      onInstance: (inst) => {
        receivedInstances.push(inst.sopInstanceUid);
      },
      onProgress: (p) => {
        progressEvents.push({ ...p });
      },
      onSeriesComplete: (uid) => {
        completedSeries.push(uid);
      },
    });

    expect(maxActiveConnections).toBe(2);
    expect(summary).toEqual({ received: 8, failed: 0, warning: 0, cancelled: false });
    expect(receivedInstances).toHaveLength(8);
    expect(completedSeries).toHaveLength(4);
    expect(progressEvents.length).toBeGreaterThanOrEqual(4);
    expect(progressEvents.at(-1)).toEqual({
      received: 8,
      total: 8,
      completedSeries: 4,
      totalSeries: 4,
      bytesReceived: expect.any(Number),
    });
    expect(progressEvents.at(-1)!.bytesReceived).toBeGreaterThan(0);
  });

  it('faz fallback para retrieve do estudo inteiro quando seriesList está vazia', async () => {
    const connect = async (): Promise<Transport> => {
      let writes = 0;
      let onData: (chunk: Uint8Array) => void = () => {};
      let onClose: (error?: Error) => void = () => {};
      return {
        send(data) {
          writes++;
          if (writes === 1) queueMicrotask(() => onData(acceptPdu()));
          else if (writes === 2) {
            queueMicrotask(() =>
              onData(concat([cGetPending(1), storeRqFor('1.2.3.99.1', 5), cGetDone(1)])),
            );
          } else if (data[0] === PDU.releaseRq) {
            queueMicrotask(() => onData(encodeReleaseRp()));
          }
        },
        close() {
          queueMicrotask(() => onClose());
        },
        onData(cb) {
          onData = cb;
        },
        onClose(cb) {
          onClose = cb;
        },
      };
    };

    const progressEvents: ParallelRetrieveProgress[] = [];
    const summary = await retrieveStudyParallel(SERVER, '1.2.3', {
      connect,
      callingAeTitle: ME,
      seriesList: [],
      imageClasses: [PET],
      otherClasses: [],
      timeoutMs: 500,
      onInstance: () => {},
      onProgress: (p) => progressEvents.push({ ...p }),
    });

    expect(summary).toEqual({ received: 1, failed: 0, warning: 0, cancelled: false });
    expect(progressEvents.at(-1)).toEqual({
      received: 1,
      total: 1,
      completedSeries: 0,
      totalSeries: 1,
      bytesReceived: expect.any(Number),
    });
    expect(progressEvents.at(-1)!.bytesReceived).toBeGreaterThan(0);
  });

  it('faz flush de onInstance assíncrono antes de resolver e propaga rejeição assíncrona', async () => {
    const connect = async (): Promise<Transport> => {
      let writes = 0;
      let onData: (chunk: Uint8Array) => void = () => {};
      let onClose: (error?: Error) => void = () => {};
      return {
        send(data) {
          writes++;
          if (writes === 1) queueMicrotask(() => onData(acceptPdu()));
          else if (writes === 2) {
            queueMicrotask(() =>
              onData(
                concat([
                  cGetPending(2),
                  storeRqFor('1.2.3.10.1', 1),
                  storeRqFor('1.2.3.10.2', 2),
                  cGetDone(2),
                ]),
              ),
            );
          } else if (data[0] === PDU.releaseRq) {
            queueMicrotask(() => onData(encodeReleaseRp()));
          }
        },
        close() {
          queueMicrotask(() => onClose());
        },
        onData(cb) {
          onData = cb;
        },
        onClose(cb) {
          onClose = cb;
        },
      };
    };

    let flushedCount = 0;
    const summary = await retrieve(
      SERVER,
      { studyInstanceUid: '1.2.3' },
      {
        connect,
        callingAeTitle: ME,
        imageClasses: [PET],
        otherClasses: [],
        timeoutMs: 500,
        onInstance: async () => {
          await new Promise((r) => setTimeout(r, 20));
          flushedCount++;
        },
      },
    );
    expect(summary.received).toBe(2);
    expect(flushedCount).toBe(2);

    await expect(
      retrieve(
        SERVER,
        { studyInstanceUid: '1.2.3' },
        {
          connect,
          callingAeTitle: ME,
          imageClasses: [PET],
          otherClasses: [],
          timeoutMs: 500,
          onInstance: async () => {
            await new Promise((r) => setTimeout(r, 10));
            throw new PacsError('DADOS_INVALIDOS', 'disco cheio');
          },
        },
      ),
    ).rejects.toThrow('disco cheio');
  });

  it('reduz workers graciosamente quando PACS recusa associações simultâneas excedentes', async () => {
    let activeConnections = 0;
    let maxActiveConnections = 0;
    let refusedCount = 0;
    let seq = 0;

    const connect = async (): Promise<Transport> => {
      if (activeConnections >= 2) {
        refusedCount++;
        throw new PacsError('ASSOCIACAO_RECUSADA', 'limite de conexões simultâneas');
      }
      activeConnections++;
      maxActiveConnections = Math.max(maxActiveConnections, activeConnections);
      const connId = ++seq;
      let writes = 0;
      let closed = false;
      let onData: (chunk: Uint8Array) => void = () => {};
      let onClose: (error?: Error) => void = () => {};

      return {
        send(data) {
          writes++;
          if (writes === 1) queueMicrotask(() => onData(acceptPdu()));
          else if (writes === 2) {
            setTimeout(() => {
              if (closed) return;
              onData(
                concat([
                  cGetPending(2),
                  storeRqFor(`1.2.3.${connId}.1`, 10 + connId),
                  storeRqFor(`1.2.3.${connId}.2`, 20 + connId),
                  cGetDone(2),
                ]),
              );
            }, 15);
          } else if (data[0] === PDU.releaseRq) {
            queueMicrotask(() => onData(encodeReleaseRp()));
          }
        },
        close() {
          if (closed) return;
          closed = true;
          activeConnections--;
          queueMicrotask(() => onClose());
        },
        onData(cb) {
          onData = cb;
        },
        onClose(cb) {
          onClose = cb;
        },
      };
    };

    const seriesList = [
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.1', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.2', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.3', instanceCount: 2 },
      { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.4', instanceCount: 2 },
    ];
    const receivedInstances: string[] = [];

    const summary = await retrieveStudyParallel(SERVER, '1.2.3', {
      connect,
      callingAeTitle: ME,
      concurrency: 4,
      seriesList,
      imageClasses: [PET],
      otherClasses: [],
      timeoutMs: 1000,
      onInstance: (inst) => {
        receivedInstances.push(inst.sopInstanceUid);
      },
    });

    expect(refusedCount).toBe(2);
    expect(maxActiveConnections).toBe(2);
    expect(summary).toEqual({ received: 8, failed: 0, warning: 0, cancelled: false });
    expect(receivedInstances).toHaveLength(8);
  });

  it('propaga erro se todas as associações falharem em retrieveStudyParallel', async () => {
    const connect = async (): Promise<Transport> => {
      throw new PacsError('SEM_CONEXAO', 'PACS inacessível');
    };

    await expect(
      retrieveStudyParallel(SERVER, '1.2.3', {
        connect,
        callingAeTitle: ME,
        concurrency: 3,
        seriesList: [
          { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.1', instanceCount: 1 },
          { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.2', instanceCount: 1 },
          { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.3', instanceCount: 1 },
        ],
        imageClasses: [PET],
        otherClasses: [],
        timeoutMs: 500,
        onInstance: () => {},
      }),
    ).rejects.toMatchObject({ code: 'SEM_CONEXAO' });
  });
});
