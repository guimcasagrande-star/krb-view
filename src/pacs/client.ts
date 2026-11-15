/**
 * Cliente de PACS: verificação (C-ECHO), pesquisa (C-FIND) e download (C-GET).
 *
 * Não abre conexão por conta própria: recebe uma função `connect` que devolve
 * um `Transport`. No Node o transporte é um socket TCP
 * (`scripts/pacs-transporte-node.ts`); no app empacotado será a ponte TCP do
 * Tauri. Assim o protocolo inteiro é testável sem rede.
 *
 * Só fala com o servidor que o usuário cadastrou. Não faz nenhuma outra conexão.
 */

import {
  COMMAND,
  MessageAssembler,
  STATUS,
  describeStatus,
  encodeCommand,
  fragmentMessage,
  type Command,
  type Message,
} from './dimse.ts';
import { PacsError } from './errors.ts';
import { buildPart10 } from './part10.ts';
import {
  PDU,
  PduBuffer,
  decodeAssociateAc,
  decodePData,
  describeAssociateRj,
  encodeAbort,
  encodeAssociateRq,
  encodeReleaseRp,
  encodeReleaseRq,
  type AssociateAccept,
  type PresentationContextRequest,
  type RawPdu,
  type RoleSelection,
} from './pdu.ts';
import {
  buildRetrieveIdentifier,
  buildSeriesQuery,
  buildStudyQuery,
  parseSeriesResult,
  parseStudyResult,
  sortStudies,
  type SeriesResult,
  type StudyFilters,
  type StudyResult,
} from './query.ts';
import {
  IMAGE_STORAGE_CLASSES,
  IMAGE_TRANSFER_SYNTAX_GROUPS,
  IMPLEMENTATION_CLASS_UID,
  IMPLEMENTATION_VERSION_NAME,
  OTHER_STORAGE_CLASSES,
  TS,
  UID,
  UNCOMPRESSED_TRANSFER_SYNTAXES,
  isValidUid,
} from './uids.ts';

// ---------------------------------------------------------------------------
// Transporte e configuração
// ---------------------------------------------------------------------------

export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  onData(callback: (chunk: Uint8Array) => void): void;
  /** Chamado uma vez quando a conexão termina, com o erro se houve. */
  onClose(callback: (error?: Error) => void): void;
  /** Opcional: segura e solta a leitura quando o consumo fica para trás. */
  pause?(): void;
  resume?(): void;
}

export type Connect = (host: string, port: number) => Promise<Transport>;

export interface PacsServer {
  /** Nome para exibição. */
  name: string;
  host: string;
  port: number;
  /** AE title do servidor. */
  aeTitle: string;
  /** Conexão segura (DICOM TLS). Sem isto a conexão é aberta, como no DICOM comum. */
  tls?: boolean;
  /**
   * Impressão digital SHA-256 do certificado do servidor (64 dígitos hexadecimais, maiúsculos),
   * confirmada pelo usuário. Com TLS, o transporte só conversa com o servidor que apresentar
   * exatamente este certificado.
   */
  certificateSha256?: string;
}

export interface ClientOptions {
  connect: Connect;
  /** AE title desta estação, como cadastrado no PACS. */
  callingAeTitle: string;
  /** Tempo máximo sem resposta, em ms. Padrão 30 000. */
  timeoutMs?: number;
  /** Maior PDU que aceitamos receber. Padrão 65 536. */
  maxPduLength?: number;
}

// ---------------------------------------------------------------------------
// Associação
// ---------------------------------------------------------------------------

const PAUSE_ABOVE_BYTES = 32 * 1024 * 1024;
const RESUME_BELOW_BYTES = 4 * 1024 * 1024;

interface Waiter {
  resolve: (pdu: RawPdu) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class Association {
  /** Contextos aceitos: id -> sintaxes. */
  readonly accepted = new Map<number, { abstractSyntax: string; transferSyntax: string }>();
  accept: AssociateAccept = { contexts: [], maxPduLength: 0, roles: [] };

  private readonly transport: Transport;
  private readonly timeoutMs: number;
  private readonly buffer = new PduBuffer();
  private readonly pdus: RawPdu[] = [];
  private readonly assembler = new MessageAssembler();
  private readonly messages: Message[] = [];
  private queuedBytes = 0;
  private paused = false;
  private waiter: Waiter | undefined;
  private failure: Error | undefined;
  private finished = false;
  private nextMessageId = 1;

  private constructor(transport: Transport, timeoutMs: number) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    transport.onData((chunk) => {
      if (this.finished) return;
      try {
        this.buffer.push(chunk);
        for (let pdu = this.buffer.next(); pdu; pdu = this.buffer.next()) {
          this.pdus.push(pdu);
          this.queuedBytes += pdu.body.length;
        }
      } catch (error) {
        this.fail(error as Error);
        return;
      }
      if (!this.paused && this.queuedBytes > PAUSE_ABOVE_BYTES && transport.pause) {
        this.paused = true;
        transport.pause();
      }
      this.wake();
    });
    transport.onClose((error) => {
      if (!this.failure) {
        this.failure = error
          ? new PacsError('CONEXAO', `A conexão com o servidor caiu: ${error.message}`)
          : new PacsError('CONEXAO_FECHADA', 'O servidor fechou a conexão.');
      }
      this.wake();
    });
  }

  static async open(
    server: PacsServer,
    options: ClientOptions,
    contexts: PresentationContextRequest[],
    roles: RoleSelection[] = [],
  ): Promise<Association> {
    let transport: Transport;
    try {
      transport = await options.connect(server.host, server.port);
    } catch (error) {
      throw new PacsError(
        'SEM_CONEXAO',
        `Não foi possível conectar a ${server.name} (${server.host}:${server.port}): ${(error as Error).message}`,
      );
    }
    const association = new Association(transport, options.timeoutMs ?? 30_000);
    try {
      transport.send(
        encodeAssociateRq({
          calledAeTitle: server.aeTitle,
          callingAeTitle: options.callingAeTitle,
          contexts,
          roles,
          maxPduLength: options.maxPduLength ?? 262_144,
          implementationClassUid: IMPLEMENTATION_CLASS_UID,
          implementationVersionName: IMPLEMENTATION_VERSION_NAME,
        }),
      );
      const reply = await association.nextPdu();
      if (reply.type === PDU.associateRj) throw describeAssociateRj(reply.body);
      if (reply.type === PDU.abort) {
        throw new PacsError('ASSOCIACAO_RECUSADA', 'O servidor interrompeu a conexão ao receber o pedido.');
      }
      if (reply.type !== PDU.associateAc) {
        throw new PacsError('PDU_INVALIDA', 'O servidor respondeu de forma inesperada ao pedido de conexão.');
      }
      association.accept = decodeAssociateAc(reply.body);
      for (const context of association.accept.contexts) {
        const requested = contexts.find((c) => c.id === context.id);
        if (requested && context.result === 0 && context.transferSyntax) {
          association.accepted.set(context.id, {
            abstractSyntax: requested.abstractSyntax,
            transferSyntax: context.transferSyntax,
          });
        }
      }
      return association;
    } catch (error) {
      association.abort();
      throw error;
    }
  }

  /** Contexto aceito para uma classe SOP, ou erro em português se o servidor não oferece o serviço. */
  contextFor(abstractSyntax: string, service: string): number {
    for (const [id, context] of this.accepted) {
      if (context.abstractSyntax === abstractSyntax) return id;
    }
    throw new PacsError('SERVICO_NAO_ACEITO', `O servidor não aceita ${service} para esta estação.`);
  }

  newMessageId(): number {
    const id = this.nextMessageId;
    this.nextMessageId = this.nextMessageId >= 0xffff ? 1 : this.nextMessageId + 1;
    return id;
  }

  send(contextId: number, command: Command, dataset?: Uint8Array): void {
    if (this.failure) throw this.failure;
    for (const pdu of fragmentMessage(contextId, encodeCommand(command), dataset, this.accept.maxPduLength)) {
      this.transport.send(pdu);
    }
  }

  /** Próxima mensagem DIMSE completa. */
  async nextMessage(): Promise<Message> {
    for (;;) {
      const ready = this.messages.shift();
      if (ready) return ready;
      const pdu = await this.nextPdu();
      if (pdu.type === PDU.pData) {
        for (const pdv of decodePData(pdu.body)) {
          const message = this.assembler.push(pdv);
          if (message) this.messages.push(message);
        }
      } else if (pdu.type === PDU.releaseRq) {
        this.transport.send(encodeReleaseRp());
        this.end();
        throw new PacsError('CONEXAO_FECHADA', 'O servidor encerrou a conexão antes de terminar.');
      } else if (pdu.type === PDU.abort) {
        this.end();
        throw new PacsError('ABORTADO', 'O servidor interrompeu a conexão.');
      } else {
        this.abort();
        throw new PacsError('PDU_INVALIDA', 'O servidor enviou uma mensagem fora de ordem.');
      }
    }
  }

  /** Encerramento normal. Nunca lança: se algo falhar, só fecha a conexão. */
  async release(): Promise<void> {
    if (this.finished) return;
    try {
      this.transport.send(encodeReleaseRq());
      for (;;) {
        const pdu = await this.nextPdu();
        if (pdu.type === PDU.releaseRp || pdu.type === PDU.abort) break;
        if (pdu.type === PDU.releaseRq) this.transport.send(encodeReleaseRp());
      }
    } catch {
      // a conexão já caiu; não há o que encerrar
    }
    this.end();
  }

  abort(): void {
    if (this.finished) return;
    try {
      this.transport.send(encodeAbort());
    } catch {
      // conexão já fechada
    }
    this.end();
  }

  private end(): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.failure) this.failure = new PacsError('CONEXAO_FECHADA', 'A conexão foi encerrada.');
    try {
      this.transport.close();
    } catch {
      // nada a fazer
    }
    this.wake();
  }

  private fail(error: Error): void {
    this.failure = error;
    this.abort();
  }

  private take(): RawPdu | undefined {
    const pdu = this.pdus.shift();
    if (!pdu) return undefined;
    this.queuedBytes -= pdu.body.length;
    if (this.paused && this.queuedBytes < RESUME_BELOW_BYTES) {
      this.paused = false;
      this.transport.resume?.();
    }
    return pdu;
  }

  private nextPdu(): Promise<RawPdu> {
    const pdu = this.take();
    if (pdu) return Promise.resolve(pdu);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<RawPdu>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        this.failure = new PacsError(
          'TEMPO_ESGOTADO',
          `O servidor não respondeu em ${Math.round(this.timeoutMs / 1000)} segundos.`,
        );
        this.abort();
        reject(this.failure);
      }, this.timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  private wake(): void {
    const waiter = this.waiter;
    if (!waiter) return;
    const pdu = this.take();
    if (!pdu && !this.failure) return;
    clearTimeout(waiter.timer);
    this.waiter = undefined;
    if (pdu) waiter.resolve(pdu);
    else waiter.reject(this.failure!);
  }
}

function isPending(status: number | undefined): boolean {
  return status === STATUS.pending || status === STATUS.pendingWarning;
}

/** Executa `work` numa associação e garante o encerramento, com sucesso ou erro. */
async function withAssociation<T>(
  server: PacsServer,
  options: ClientOptions,
  contexts: PresentationContextRequest[],
  roles: RoleSelection[],
  work: (association: Association) => Promise<T>,
): Promise<T> {
  const association = await Association.open(server, options, contexts, roles);
  try {
    const result = await work(association);
    await association.release();
    return result;
  } catch (error) {
    association.abort();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// C-ECHO
// ---------------------------------------------------------------------------

/** Testa a comunicação com o servidor. Resolve se ele respondeu; rejeita com o motivo. */
export async function echo(server: PacsServer, options: ClientOptions): Promise<void> {
  const contexts = [{ id: 1, abstractSyntax: UID.verification, transferSyntaxes: [TS.implicitVrLittleEndian] }];
  await withAssociation(server, options, contexts, [], async (association) => {
    const contextId = association.contextFor(UID.verification, 'o teste de comunicação');
    const messageId = association.newMessageId();
    association.send(contextId, {
      affectedSopClassUid: UID.verification,
      commandField: COMMAND.cEchoRq,
      messageId,
      hasDataset: false,
    });
    const reply = await association.nextMessage();
    if (reply.command.commandField !== COMMAND.cEchoRsp || reply.command.status !== STATUS.success) {
      throw new PacsError(
        'ECO_FALHOU',
        `O teste de comunicação falhou: ${describeStatus(reply.command.status ?? -1, reply.command.errorComment)}.`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// C-FIND
// ---------------------------------------------------------------------------

export interface FindOptions {
  /** Máximo de resultados. Ao atingir, a consulta é cancelada. Padrão 200. */
  limit?: number;
}

export interface FindResult<T> {
  results: T[];
  /** Verdadeiro se havia mais resultados que o limite. */
  truncated: boolean;
}

async function find<T>(
  server: PacsServer,
  options: ClientOptions,
  identifier: Uint8Array,
  parse: (dataset: Uint8Array) => T | undefined,
  limit: number,
): Promise<FindResult<T>> {
  const contexts = [{ id: 1, abstractSyntax: UID.studyRootFind, transferSyntaxes: [TS.implicitVrLittleEndian] }];
  return withAssociation(server, options, contexts, [], async (association) => {
    const contextId = association.contextFor(UID.studyRootFind, 'pesquisa de exames');
    const messageId = association.newMessageId();
    association.send(
      contextId,
      {
        affectedSopClassUid: UID.studyRootFind,
        commandField: COMMAND.cFindRq,
        messageId,
        priority: 0,
        hasDataset: true,
      },
      identifier,
    );

    const results: T[] = [];
    let truncated = false;
    for (;;) {
      const { command, dataset } = await association.nextMessage();
      if (command.commandField !== COMMAND.cFindRsp) {
        throw new PacsError('DADOS_INVALIDOS', 'O servidor respondeu à pesquisa com um comando inesperado.');
      }
      if (isPending(command.status)) {
        if (truncated || !dataset) continue;
        if (results.length >= limit) {
          truncated = true;
          association.send(contextId, {
            commandField: COMMAND.cCancelRq,
            messageIdBeingRespondedTo: messageId,
            hasDataset: false,
          });
          continue;
        }
        const parsed = parse(dataset);
        if (parsed !== undefined) results.push(parsed);
        continue;
      }
      if (command.status === STATUS.success || (command.status === STATUS.cancel && truncated)) {
        return { results, truncated };
      }
      throw new PacsError(
        'PESQUISA_FALHOU',
        `A pesquisa falhou: ${describeStatus(command.status ?? -1, command.errorComment)}.`,
      );
    }
  });
}

/** Pesquisa estudos. O resultado vem do mais recente ao mais antigo. */
export async function findStudies(
  server: PacsServer,
  filters: StudyFilters,
  options: ClientOptions & FindOptions,
): Promise<FindResult<StudyResult>> {
  const found = await find(server, options, buildStudyQuery(filters), parseStudyResult, options.limit ?? 200);
  // ModalitiesInStudy é chave opcional: há PACS que ignoram o filtro. Refiltra aqui
  // quando o servidor devolveu a lista de modalidades.
  const modality = (filters.modality ?? '').trim().toUpperCase();
  const results =
    modality === ''
      ? found.results
      : found.results.filter((s) => s.modalities.length === 0 || s.modalities.includes(modality));
  return { results: sortStudies(results), truncated: found.truncated };
}

/** Lista as séries de um estudo, pela ordem do número da série. */
export async function findSeries(
  server: PacsServer,
  studyInstanceUid: string,
  options: ClientOptions & FindOptions,
): Promise<FindResult<SeriesResult>> {
  const found = await find(
    server,
    options,
    buildSeriesQuery(studyInstanceUid),
    parseSeriesResult,
    options.limit ?? 1000,
  );
  found.results.sort(
    (a, b) =>
      (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) - (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
      (a.seriesInstanceUid < b.seriesInstanceUid ? -1 : 1),
  );
  return found;
}

// ---------------------------------------------------------------------------
// C-GET
// ---------------------------------------------------------------------------

export interface ReceivedInstance {
  sopClassUid: string;
  sopInstanceUid: string;
  transferSyntaxUid: string;
  /** Arquivo DICOM completo (Part 10), pronto para gravar ou abrir. */
  file: Uint8Array;
}

export interface RetrieveProgress {
  /** Imagens já recebidas nesta conexão. */
  received: number;
  /** Quantas faltam, quando o servidor informa. */
  remaining?: number;
  /** Bytes DICOM acumulados recebidos nesta conexão. */
  bytesReceived: number;
}

export interface RetrieveRequest {
  studyInstanceUid: string;
  /** Sem isto, baixa o estudo inteiro. */
  seriesInstanceUid?: string;
}

export interface RetrieveOptions {
  /**
   * Chamado para cada imagem recebida. Pode ser assíncrono: a próxima imagem
   * só é confirmada ao servidor depois que esta chamada termina.
   */
  onInstance: (instance: ReceivedInstance) => void | Promise<void>;
  onProgress?: (progress: RetrieveProgress) => void;
  /** Para cancelar o download. */
  signal?: AbortSignal;
  /** Classes SOP a aceitar. Padrão: as de imagem e as demais de `uids.ts`. */
  imageClasses?: readonly string[];
  otherClasses?: readonly string[];
  /** Grupos de sintaxe de transferência por classe de imagem. Padrão: `IMAGE_TRANSFER_SYNTAX_GROUPS`. */
  transferSyntaxGroups?: readonly (readonly string[])[];
}

export interface RetrieveSummary {
  received: number;
  /** Imagens que o servidor não conseguiu enviar. */
  failed: number;
  warning: number;
  cancelled: boolean;
}

/** Monta os contextos de apresentação do C-GET: o do próprio C-GET e os de armazenamento. */
export function retrieveContexts(
  imageClasses: readonly string[] = IMAGE_STORAGE_CLASSES,
  otherClasses: readonly string[] = OTHER_STORAGE_CLASSES,
  transferSyntaxGroups: readonly (readonly string[])[] = IMAGE_TRANSFER_SYNTAX_GROUPS,
): { contexts: PresentationContextRequest[]; roles: RoleSelection[] } {
  const contexts: PresentationContextRequest[] = [
    { id: 1, abstractSyntax: UID.studyRootGet, transferSyntaxes: [TS.implicitVrLittleEndian] },
  ];
  let id = 3;
  const add = (abstractSyntax: string, transferSyntaxes: readonly string[]) => {
    contexts.push({ id, abstractSyntax, transferSyntaxes });
    id += 2;
  };
  for (const sopClass of imageClasses) {
    for (const group of transferSyntaxGroups) add(sopClass, group);
  }
  for (const sopClass of otherClasses) add(sopClass, UNCOMPRESSED_TRANSFER_SYNTAXES);
  if (contexts.length > 128) {
    throw new PacsError(
      'CONTEXTOS_DEMAIS',
      `Classes demais para uma só conexão (${contexts.length} contextos; o máximo é 128).`,
    );
  }
  // No C-GET o servidor nos envia as imagens: precisamos do papel de SCP nessas classes.
  const roles = [...new Set([...imageClasses, ...otherClasses])].map((sopClassUid) => ({
    sopClassUid,
    scu: false,
    scp: true,
  }));
  return { contexts, roles };
}

/** Baixa um estudo ou uma série por C-GET. */
export async function retrieve(
  server: PacsServer,
  request: RetrieveRequest,
  options: ClientOptions & RetrieveOptions,
): Promise<RetrieveSummary> {
  const identifier = buildRetrieveIdentifier(request.studyInstanceUid, request.seriesInstanceUid);
  const { contexts, roles } = retrieveContexts(
    options.imageClasses,
    options.otherClasses,
    options.transferSyntaxGroups,
  );

  return withAssociation(server, options, contexts, roles, async (association) => {
    const getContext = association.contextFor(UID.studyRootGet, 'download por C-GET');
    const messageId = association.newMessageId();
    association.send(
      getContext,
      {
        affectedSopClassUid: UID.studyRootGet,
        commandField: COMMAND.cGetRq,
        messageId,
        priority: 0,
        hasDataset: true,
      },
      identifier,
    );

    let cancelSent = false;
    const cancel = () => {
      if (cancelSent) return;
      cancelSent = true;
      try {
        association.send(getContext, {
          commandField: COMMAND.cCancelRq,
          messageIdBeingRespondedTo: messageId,
          hasDataset: false,
        });
      } catch {
        // conexão já caiu; o laço abaixo relata o erro
      }
    };
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });

    let received = 0;
    let bytesReceived = 0;
    let remaining: number | undefined;
    const pendingWrites = new Set<Promise<void>>();
    let writeError: Error | undefined;
    const MAX_PENDING_WRITES = 16; // Limita gravações simultâneas em disco por conexão
    try {
      for (;;) {
        const { contextId, command, dataset } = await association.nextMessage();

        if (command.commandField === COMMAND.cStoreRq) {
          const context = association.accepted.get(contextId);
          const sopClassUid = command.affectedSopClassUid;
          const sopInstanceUid = command.affectedSopInstanceUid;
          if (!context || !dataset || !isValidUid(sopClassUid) || !isValidUid(sopInstanceUid)) {
            throw new PacsError('DADOS_INVALIDOS', 'O servidor enviou uma imagem sem identificação válida.');
          }
          const reply: Command = {
            affectedSopClassUid: sopClassUid,
            commandField: COMMAND.cStoreRsp,
            messageIdBeingRespondedTo: command.messageId ?? 0,
            hasDataset: false,
            status: STATUS.success,
            affectedSopInstanceUid: sopInstanceUid,
          };
          const part10File = buildPart10({
            sopClassUid,
            sopInstanceUid,
            transferSyntaxUid: context.transferSyntax,
            sourceAeTitle: server.aeTitle,
            dataset,
          });
          let rawWrite: Promise<void>;
          try {
            rawWrite = Promise.resolve(
              options.onInstance({
                sopClassUid,
                sopInstanceUid,
                transferSyntaxUid: context.transferSyntax,
                file: part10File,
              }),
            );
          } catch (error) {
            // Não conseguimos guardar a imagem: avisa o servidor e interrompe.
            association.send(contextId, { ...reply, status: 0xa700 });
            throw error;
          }
          const trackedWrite = rawWrite
            .catch((error) => {
              writeError ??= error instanceof Error ? error : new Error(String(error));
            })
            .finally(() => {
              pendingWrites.delete(trackedWrite);
            });
          pendingWrites.add(trackedWrite);

          if (writeError) {
            association.send(contextId, { ...reply, status: 0xa700 });
            throw writeError;
          }

          // 1. Confirma o recebimento IMEDIATAMENTE ao PACS para ele já enviar a próxima fatia pela rede
          association.send(contextId, reply);
          received++;
          bytesReceived += part10File.byteLength;
          if (remaining !== undefined && remaining > 0) remaining--;
          options.onProgress?.(
            remaining === undefined
              ? { received, bytesReceived }
              : { received, remaining, bytesReceived },
          );

          // 2. Janela deslizante: libera o loop assim que uma gravação terminar ao atingir o limite
          if (pendingWrites.size >= MAX_PENDING_WRITES) {
            await Promise.race(pendingWrites);
            if (writeError) throw writeError;
          }
          continue;
        }

        if (command.commandField !== COMMAND.cGetRsp) {
          throw new PacsError('DADOS_INVALIDOS', 'O servidor respondeu ao download com um comando inesperado.');
        }
        if (isPending(command.status)) {
          if (command.remaining !== undefined) {
            remaining = command.remaining;
            options.onProgress?.({ received, remaining, bytesReceived });
          }
          continue;
        }

        const summary: RetrieveSummary = {
          received,
          failed: command.failed ?? 0,
          warning: command.warning ?? 0,
          cancelled: command.status === STATUS.cancel,
        };
        if (
          command.status === STATUS.success ||
          command.status === STATUS.subOperationsWithFailures ||
          command.status === STATUS.cancel
        ) {
          if (pendingWrites.size > 0) {
            await Promise.all(pendingWrites);
          }
          if (writeError) throw writeError;
          return summary;
        }
        throw new PacsError(
          'DOWNLOAD_FALHOU',
          `O download falhou: ${describeStatus(command.status ?? -1, command.errorComment)}.`,
        );
      }
    } finally {
      if (pendingWrites.size > 0) {
        await Promise.allSettled(pendingWrites);
      }
      options.signal?.removeEventListener('abort', cancel);
    }
  });
}

// ---------------------------------------------------------------------------
// C-GET Paralelo por Série (Alta Performance)
// ---------------------------------------------------------------------------

export interface ParallelRetrieveProgress {
  /** Total de imagens recebidas somando todas as séries. */
  received: number;
  /** Total estimado de imagens no estudo (se informado pelo PACS ou C-FIND). */
  total?: number;
  /** Bytes DICOM acumulados recebidos somando todas as séries. */
  bytesReceived: number;
  /** Séries completamente baixadas até agora. */
  completedSeries: number;
  /** Total de séries no estudo. */
  totalSeries: number;
}

export interface ParallelRetrieveOptions extends Omit<RetrieveOptions, 'onProgress'> {
  /**
   * Número máximo de conexões (associações C-GET) simultâneas no PACS.
   * Padrão: 4 (seguro para a maioria dos PACS hospitalares como DCM4CHEE, Orthanc, Carestream).
   */
  concurrency?: number;
  /**
   * Lista de séries já obtida via `findSeries` (evita fazer um novo C-FIND se a UI já tiver).
   */
  seriesList?: SeriesResult[];
  /**
   * Progresso global agregado de todas as conexões simultâneas.
   */
  onProgress?: (progress: ParallelRetrieveProgress) => void;
  /**
   * Chamado assim que uma série inteira termina de baixar (útil para já liberar a série na UI).
   */
  onSeriesComplete?: (seriesInstanceUid: string, summary: RetrieveSummary) => void;
}

/**
 * Baixa um estudo inteiro abrindo múltiplas conexões C-GET em paralelo (uma por série).
 */
export async function retrieveStudyParallel(
  server: PacsServer,
  studyInstanceUid: string,
  options: ClientOptions & ParallelRetrieveOptions,
): Promise<RetrieveSummary> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));

  // 1. Descobre as séries do estudo caso ainda não tenham sido passadas
  const series =
    options.seriesList ??
    (await findSeries(server, studyInstanceUid, options)).results;

  // Se o PACS não retornou séries no C-FIND, faz fallback para o download único do estudo
  if (series.length === 0) {
    return retrieve(server, { studyInstanceUid }, {
      ...options,
      onProgress: options.onProgress
        ? (p) =>
            options.onProgress!({
              received: p.received,
              total: p.remaining !== undefined ? p.received + p.remaining : undefined,
              bytesReceived: p.bytesReceived,
              completedSeries: 0,
              totalSeries: 1,
            })
        : undefined,
    });
  }

  const queue = [...series];
  const totalSeries = queue.length;

  // Calcula o total conhecido pelo C-FIND (se disponível em SeriesResult)
  const knownTotalFromFind = series.reduce(
    (acc, s) =>
      acc +
      (s.instanceCount ??
        (s as { numberOfSeriesRelatedInstances?: number }).numberOfSeriesRelatedInstances ??
        0),
    0,
  );

  let totalReceived = 0;
  let totalBytesReceived = 0;
  let totalFailed = 0;
  let totalWarning = 0;
  let anyCancelled = false;
  let completedSeries = 0;

  // Rastreia quantas imagens faltam em cada série ativa
  const remainingBySeries = new Map<string, number>();

  const emitProgress = () => {
    if (!options.onProgress) return;
    let remainingSum = 0;
    let hasRemainingInfo = false;
    for (const rem of remainingBySeries.values()) {
      remainingSum += rem;
      hasRemainingInfo = true;
    }
    const total =
      knownTotalFromFind > 0
        ? Math.max(knownTotalFromFind, totalReceived)
        : hasRemainingInfo
          ? totalReceived + remainingSum
          : undefined;

    options.onProgress({
      received: totalReceived,
      total,
      bytesReceived: totalBytesReceived,
      completedSeries,
      totalSeries,
    });
  };

  // 2. Cria os workers que consomem a fila de séries em paralelo
  const workerCount = Math.min(concurrency, queue.length);
  let activeWorkers = workerCount;
  const workers = Array.from({ length: workerCount }, async () => {
    let retriedAlone = false;
    try {
      while (queue.length > 0) {
        if (options.signal?.aborted) {
          anyCancelled = true;
          break;
        }
        const currentSeries = queue.shift();
        if (!currentSeries) break;

        const seriesUid = currentSeries.seriesInstanceUid;
        let lastSeriesReceived = 0;
        let lastSeriesBytes = 0;

        try {
          const summary = await retrieve(
            server,
            {
              studyInstanceUid,
              seriesInstanceUid: seriesUid,
            },
            {
              ...options,
              onProgress: (p) => {
                const delta = p.received - lastSeriesReceived;
                lastSeriesReceived = p.received;
                totalReceived += delta;
                const deltaBytes = p.bytesReceived - lastSeriesBytes;
                lastSeriesBytes = p.bytesReceived;
                totalBytesReceived += deltaBytes;
                if (p.remaining !== undefined) {
                  remainingBySeries.set(seriesUid, p.remaining);
                }
                emitProgress();
              },
            },
          );

          remainingBySeries.delete(seriesUid);
          completedSeries++;
          totalFailed += summary.failed;
          totalWarning += summary.warning;
          if (summary.cancelled) anyCancelled = true;

          emitProgress();
          options.onSeriesComplete?.(seriesUid, summary);
        } catch (err) {
          const isAssociationLimit =
            err instanceof PacsError &&
            (err.code === 'ASSOCIACAO_RECUSADA' || err.code === 'SEM_CONEXAO');
          if (!isAssociationLimit) throw err;

          if (lastSeriesReceived > 0) totalReceived -= lastSeriesReceived;
          if (lastSeriesBytes > 0) totalBytesReceived -= lastSeriesBytes;
          remainingBySeries.delete(seriesUid);

          if (activeWorkers > 1) {
            // PACS limitou associações simultâneas: devolve a série para a fila e encerra este worker excedente.
            queue.unshift(currentSeries);
            return;
          }
          if (completedSeries > 0 && !retriedAlone) {
            // Outro worker já terminou depois que esta conexão foi recusada; tenta novamente sozinho uma vez.
            retriedAlone = true;
            queue.unshift(currentSeries);
            continue;
          }
          throw err;
        }
      }
    } finally {
      activeWorkers--;
    }
  });

  await Promise.all(workers);

  return {
    received: totalReceived,
    failed: totalFailed,
    warning: totalWarning,
    cancelled: anyCancelled,
  };
}
