/**
 * Integração da segunda janela no aplicativo Tauri (Etapas 1 a 4):
 * - Janela principal: cria/foca a janela "secundaria" via comando Rust, sincroniza o catálogo leve
 *   do exame aberto (metas sem nome de paciente + fatia central de cada pilha para miniatura) e
 *   responde a pedidos sob demanda (`pedir-serie`) ou envios diretos (`abrir-serie`) enviando
 *   apenas os objetos `File` ou caminhos relativos PACS da série solicitada.
 * - Janela secundária: mostra todas as séries do exame na barra lateral, solicita os arquivos da
 *   série apenas quando o usuário clica nela (ou quando enviada pela 1ª janela), sem duplicar o
 *   exame inteiro em memória.
 * - Sincronia bidirecional configurável entre as janelas: rolagem por posição em mm, janela/nível
 *   por modalidade, localizador 3D (┼ Localizar) e linha de referência entre planos distintos.
 */

import {
  CANAL_SEGUNDA_JANELA,
  ehModoSecundario,
  encontrarPilhaEnviada,
  filtrarItensNovosParaIndice,
  pilhaTemTodosArquivos,
  prepararEnvioPilha,
  prepararMiniaturasDoCatalogo,
  sanitizarMetasParaCatalogo,
  SINCRONIA_JANELAS_PADRAO,
  type ArquivoSerieTransferido,
  type MensagemAbrirSerie,
  type MensagemCatalogoExames,
  type MensagemPedirSerie,
  type MensagemSegundaJanela,
  type OpcoesSincroniaJanelas,
} from '../compare/segundaJanelaLogica';
import { buildIndex, type StackNode } from '../io/organize';
import { pacsDisponivel } from '../pacs/transporteTauri.ts';
import { lerExame, listarExames, pastaDeExames } from '../state/examesBaixados';
import {
  type PresetVisualizacao,
  recarregarPreferenciasDoDisco,
  telas,
} from '../state/preferencias';
import { estado } from '../state/store';
import { indexarCandidatos, type ResultadoAbertura } from '../ui/abrirPasta';
import {
  abrirPilha2d,
  aplicarJanelaDaOutraJanela,
  aplicarLimparLocalizadorDaOutraJanela,
  aplicarLocalizadorDaOutraJanela,
  aplicarRolagemDaOutraJanela,
  definirLayout,
  definirMostrarLinhaOutraJanela,
  definirOuvinteSegundaJanela,
  limparViewports,
} from './viewport2d';

export const EVENTO_SINCRONIA_JANELAS = 'sincroniaJanelasMudou';

let opcoesSincronia: OpcoesSincroniaJanelas = { ...SINCRONIA_JANELAS_PADRAO };

export function obterOpcoesSincroniaJanelas(): Readonly<OpcoesSincroniaJanelas> {
  return opcoesSincronia;
}

export function alternarOpcaoSincroniaJanelas(chave: keyof OpcoesSincroniaJanelas): boolean {
  opcoesSincronia = {
    ...opcoesSincronia,
    [chave]: !opcoesSincronia[chave],
  };
  definirMostrarLinhaOutraJanela(opcoesSincronia.linhas);
  document.dispatchEvent(new CustomEvent(EVENTO_SINCRONIA_JANELAS));
  const canal = canalAtivo();
  try {
    canal?.postMessage({
      tipo: 'config-sincronia',
      opcoes: { ...opcoesSincronia },
    } satisfies MensagemSegundaJanela);
  } catch {
    /* ignora falha de envio */
  }
  return opcoesSincronia[chave];
}

interface TauriJanelaGlobal {
  core?: { invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T> };
  webviewWindow?: { getCurrentWebviewWindow?: () => { label?: string } };
  window?: { getCurrentWindow?: () => { label?: string } };
}

function tauriJanela(): TauriJanelaGlobal | undefined {
  return (globalThis as unknown as { __TAURI__?: TauriJanelaGlobal }).__TAURI__;
}

interface TauriInternalsGlobal {
  metadata?: {
    currentWindow?: { label?: string };
    currentWebview?: { label?: string };
  };
}

function labelTauri(): string | undefined {
  try {
    const internals = (globalThis as unknown as { __TAURI_INTERNALS__?: TauriInternalsGlobal })
      .__TAURI_INTERNALS__;
    const doInternals =
      internals?.metadata?.currentWindow?.label ?? internals?.metadata?.currentWebview?.label;
    if (doInternals) return doInternals;
    const t = tauriJanela();
    return (
      t?.webviewWindow?.getCurrentWebviewWindow?.()?.label ??
      t?.window?.getCurrentWindow?.()?.label
    );
  } catch {
    return undefined;
  }
}

/** Verdadeiro no app empacotado (Tauri), onde a segunda janela existe. */
export function segundaJanelaDisponivel(): boolean {
  return pacsDisponivel();
}

/** Verdadeiro quando esta janela está rodando em modo secundária (sem abrir pasta nem PACS). */
export function ehJanelaSecundaria(): boolean {
  const search = typeof globalThis.location?.search === 'string' ? globalThis.location.search : '';
  return ehModoSecundario(search, labelTauri());
}

export interface InfoMonitor {
  id: string;
  nome: string;
  largura: number;
  altura: number;
  x: number;
  y: number;
  escala: number;
  primario: boolean;
}

/** Lista os monitores conectados (apenas no app Tauri). */
export async function listarMonitoresDisponiveis(): Promise<InfoMonitor[]> {
  const core = tauriJanela()?.core;
  if (!core) return [];
  try {
    return await core.invoke<InfoMonitor[]>('monitores_listar');
  } catch {
    return [];
  }
}

/** Aplica o monitor preferido e o modo de tela (maximizada/tela cheia/normal) à janela atual. */
export async function aplicarExibicaoJanelaAtual(): Promise<void> {
  const core = tauriJanela()?.core;
  if (!core) return;
  const sec = ehJanelaSecundaria();
  const prefs = telas();
  try {
    await core.invoke('janela_configurar_exibicao', {
      janela: sec ? 'secundaria' : 'main',
      monitorId: sec ? prefs.monitorSecundaria : prefs.monitorPrincipal,
      modoTela: sec ? prefs.modoTelaSecundaria : prefs.modoTelaPrincipal,
    });
  } catch {
    /* ignora se indisponível */
  }
}

/** Alterna o modo de tela cheia (sem bordas / F11) na janela atual. */
export async function alternarTelaCheiaJanelaAtual(): Promise<boolean> {
  const core = tauriJanela()?.core;
  if (!core) return false;
  try {
    return await core.invoke<boolean>('janela_alternar_tela_cheia', {
      janela: ehJanelaSecundaria() ? 'secundaria' : 'main',
    });
  } catch {
    return false;
  }
}

/** Abre ou traz para frente a segunda janela via comando Rust `janela_secundaria_abrir`. */
export async function abrirSegundaJanela(): Promise<boolean> {
  const core = tauriJanela()?.core;
  if (!core) throw new Error('A segunda janela só funciona no aplicativo instalado (Tauri).');
  const prefs = telas();
  const criadaAgora = await core.invoke<boolean>('janela_secundaria_abrir', {
    monitorId: prefs.monitorSecundaria,
    modoTela: prefs.modoTelaSecundaria,
  });
  const canal = garantirCanalPrincipal();
  if (canal && estado.resultado) {
    void aguardarJanelaPronta(canal, 3500).then((pronta) => {
      if (!pronta) return;
      sincronizarCatalogoComSegundaJanela();
      if (criadaAgora && estado.pilhaAtiva) {
        void enviarPilhaSilencioso(estado.pilhaAtiva, true);
      }
    });
  }
  return criadaAgora;
}

/**
 * Aplica uma visualização predefinida (1 ou 2 monitores):
 * ajusta a grade da 1ª janela e, se a predefinição usar a 2ª janela, abre-a no segundo monitor
 * e ajusta a grade dela também.
 */
export async function aplicarPresetVisualizacao(preset: PresetVisualizacao): Promise<void> {
  if (ehJanelaSecundaria()) {
    await definirLayout(preset.gradeSecundaria);
    try {
      canalSecundario?.postMessage({
        tipo: 'definir-layout',
        alvo: 'principal',
        layout: preset.gradePrincipal,
      } satisfies MensagemSegundaJanela);
    } catch {
      /* ignora */
    }
    return;
  }

  await definirLayout(preset.gradePrincipal);
  if (!preset.usarSegundaJanela || !segundaJanelaDisponivel()) return;
  const canal = garantirCanalPrincipal();
  try {
    await abrirSegundaJanela();
  } catch {
    return;
  }
  if (!canal) return;
  const pronta = await aguardarJanelaPronta(canal, 4000);
  if (!pronta) return;
  try {
    canal.postMessage({
      tipo: 'definir-layout',
      alvo: 'secundaria',
      layout: preset.gradeSecundaria,
    } satisfies MensagemSegundaJanela);
  } catch {
    /* ignora */
  }
}

/** Avisa a outra janela que as preferências salvas em localStorage foram alteradas. */
export function notificarPreferenciasParaOutraJanela(): void {
  try {
    canalAtivo()?.postMessage({ tipo: 'preferencias-atualizadas' } satisfies MensagemSegundaJanela);
  } catch {
    /* ignora */
  }
}

let canalPrincipal: BroadcastChannel | undefined;
let canalSecundario: BroadcastChannel | undefined;
const ouvintesPronta = new Set<() => void>();

function canalAtivo(): BroadcastChannel | undefined {
  return canalPrincipal ?? canalSecundario;
}

function registrarEmissoresViewport(canal: BroadcastChannel): void {
  definirOuvinteSegundaJanela({
    aoRolar: (msg) => {
      if (!opcoesSincronia.rolagem && !opcoesSincronia.linhas) return;
      try {
        canal.postMessage(msg satisfies MensagemSegundaJanela);
      } catch {
        /* ignora erro de serialização */
      }
    },
    aoMudarJanela: (msg) => {
      if (!opcoesSincronia.janela) return;
      try {
        canal.postMessage(msg satisfies MensagemSegundaJanela);
      } catch {
        /* ignora */
      }
    },
    aoLocalizar: (msg) => {
      if (!opcoesSincronia.localizador) return;
      try {
        canal.postMessage(msg satisfies MensagemSegundaJanela);
      } catch {
        /* ignora */
      }
    },
    aoLimparLocalizador: () => {
      if (!opcoesSincronia.localizador) return;
      try {
        canal.postMessage({ tipo: 'limpar-localizador' } satisfies MensagemSegundaJanela);
      } catch {
        /* ignora */
      }
    },
  });
}

function tratarMensagemSincronia(msg: MensagemSegundaJanela): boolean {
  if (msg.tipo === 'sinc-rolagem') {
    if (opcoesSincronia.rolagem || opcoesSincronia.linhas) {
      aplicarRolagemDaOutraJanela(msg, opcoesSincronia);
    }
    return true;
  }
  if (msg.tipo === 'sinc-janela') {
    if (opcoesSincronia.janela) {
      aplicarJanelaDaOutraJanela(msg);
    }
    return true;
  }
  if (msg.tipo === 'sinc-localizador') {
    if (opcoesSincronia.localizador) {
      aplicarLocalizadorDaOutraJanela(msg);
    }
    return true;
  }
  if (msg.tipo === 'limpar-localizador') {
    if (opcoesSincronia.localizador) {
      aplicarLimparLocalizadorDaOutraJanela();
    }
    return true;
  }
  if (msg.tipo === 'config-sincronia') {
    opcoesSincronia = { ...msg.opcoes };
    definirMostrarLinhaOutraJanela(opcoesSincronia.linhas);
    document.dispatchEvent(new CustomEvent(EVENTO_SINCRONIA_JANELAS));
    return true;
  }
  if (msg.tipo === 'definir-layout') {
    const souSecundaria = ehJanelaSecundaria();
    if ((msg.alvo === 'secundaria' && souSecundaria) || (msg.alvo === 'principal' && !souSecundaria)) {
      void definirLayout(msg.layout);
    }
    return true;
  }
  if (msg.tipo === 'preferencias-atualizadas') {
    recarregarPreferenciasDoDisco();
    return true;
  }
  return false;
}

async function listarPacsDoEstudo(studyUid: string | undefined): Promise<ReadonlySet<string> | undefined> {
  if (!studyUid) return undefined;
  try {
    const base = await pastaDeExames();
    const lista = await listarExames(base, studyUid);
    return lista.length > 0 ? new Set(lista) : undefined;
  } catch {
    return undefined;
  }
}

async function enviarPilhaSilencioso(
  pilha: StackNode,
  abrirNoQuadro: boolean,
  noSlotAtivo = false,
): Promise<void> {
  const arquivos = estado.resultado?.arquivos;
  const canal = garantirCanalPrincipal();
  if (!arquivos || !canal) return;
  try {
    const arquivosPacs = await listarPacsDoEstudo(pilha.instances[0]?.studyInstanceUid);
    const msg = prepararEnvioPilha(pilha, arquivos, arquivosPacs, abrirNoQuadro);
    if (noSlotAtivo) msg.noSlotAtivo = true;
    canal.postMessage(msg);
  } catch {
    /* ignora falha em envio automático */
  }
}

async function responderPedidoDeSerie(pedido: MensagemPedirSerie): Promise<void> {
  if (!estado.resultado) return;
  const pilha = encontrarPilhaEnviada(estado.resultado.index, pedido);
  if (!pilha) return;
  await enviarPilhaSilencioso(pilha, true, true);
}

function garantirCanalPrincipal(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (canalPrincipal) return canalPrincipal;
  canalPrincipal = new BroadcastChannel(CANAL_SEGUNDA_JANELA);
  registrarEmissoresViewport(canalPrincipal);
  canalPrincipal.onmessage = (ev: MessageEvent<MensagemSegundaJanela>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (tratarMensagemSincronia(msg)) return;
    if (msg.tipo === 'janela-pronta') {
      for (const resolver of [...ouvintesPronta]) resolver();
      sincronizarCatalogoComSegundaJanela();
      return;
    }
    if (msg.tipo === 'pedir-serie') {
      void responderPedidoDeSerie(msg);
    }
  };
  return canalPrincipal;
}

/** Inicializa o canal de escuta da janela principal (chamado uma vez no `main.ts`). */
export function iniciarCanalJanelaPrincipal(): void {
  if (!segundaJanelaDisponivel() || ehJanelaSecundaria()) return;
  garantirCanalPrincipal();
  void aplicarExibicaoJanelaAtual();
  if (telas().abrirSecundariaAoIniciar) {
    void listarMonitoresDisponiveis().then((monitores) => {
      if (monitores.length >= 2) {
        void abrirSegundaJanela();
      }
    });
  }
}

/**
 * Envia para a segunda janela (se aberta) o catálogo leve do exame atual
 * (metadados sanitizados sem nome de paciente + fatia central de cada pilha para miniatura),
 * ou limpa a segunda janela quando o exame foi fechado.
 */
export function sincronizarCatalogoComSegundaJanela(): void {
  if (!segundaJanelaDisponivel() || ehJanelaSecundaria()) return;
  const canal = garantirCanalPrincipal();
  if (!canal) return;
  try {
    canal.postMessage({
      tipo: 'config-sincronia',
      opcoes: { ...opcoesSincronia },
    } satisfies MensagemSegundaJanela);
    if (!estado.resultado || estado.resultado.metas.length === 0) {
      canal.postMessage({ tipo: 'limpar-exames' } satisfies MensagemSegundaJanela);
      return;
    }
    const msg: MensagemCatalogoExames = {
      tipo: 'catalogo-exames',
      metas: sanitizarMetasParaCatalogo(estado.resultado.metas),
      miniaturas: prepararMiniaturasDoCatalogo(estado.resultado.index, estado.resultado.arquivos),
    };
    canal.postMessage(msg);
  } catch {
    /* ignora erro caso alguma miniatura não possa ser clonada */
  }
}

function aguardarJanelaPronta(canal: BroadcastChannel, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let concluido = false;
    const encerrar = (pronta: boolean): void => {
      if (concluido) return;
      concluido = true;
      ouvintesPronta.delete(aoFicarPronta);
      clearInterval(intervalo);
      clearTimeout(temporizador);
      resolve(pronta);
    };
    const aoFicarPronta = (): void => encerrar(true);
    ouvintesPronta.add(aoFicarPronta);
    const pingar = (): void => {
      try {
        canal.postMessage({ tipo: 'ping-janela' } satisfies MensagemSegundaJanela);
      } catch {
        /* ignora tentativa intermediária */
      }
    };
    const intervalo = setInterval(pingar, 150);
    const temporizador = setTimeout(() => encerrar(false), timeoutMs);
    pingar();
  });
}

/**
 * Envia apenas os arquivos/caminhos desta pilha para a segunda janela e a abre lá.
 * Se a segunda janela ainda não estiver aberta, abre e aguarda ficar pronta antes de enviar.
 */
export async function enviarPilhaParaOutraJanela(pilha: StackNode): Promise<void> {
  if (!segundaJanelaDisponivel() || ehJanelaSecundaria()) return;
  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) {
    window.alert('Nenhum exame carregado na memória para enviar.');
    return;
  }
  const canal = garantirCanalPrincipal();
  if (!canal) {
    window.alert('Comunicação entre janelas (BroadcastChannel) indisponível neste ambiente.');
    return;
  }

  let msg: MensagemAbrirSerie;
  try {
    const arquivosPacs = await listarPacsDoEstudo(pilha.instances[0]?.studyInstanceUid);
    msg = prepararEnvioPilha(pilha, arquivos, arquivosPacs, true);
  } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e));
    return;
  }

  try {
    await abrirSegundaJanela();
  } catch (e) {
    window.alert(e instanceof Error ? e.message : String(e));
    return;
  }

  const pronta = await aguardarJanelaPronta(canal, 4000);
  if (!pronta) {
    window.alert('A segunda janela demorou para responder. Tente enviar a série novamente.');
    return;
  }

  try {
    sincronizarCatalogoComSegundaJanela();
    canal.postMessage(msg);
  } catch (e) {
    window.alert(`Não foi possível enviar a série para a segunda janela: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export interface OpcoesModoSecundario {
  aoAtualizarIndice: (resultado: ResultadoAbertura) => void;
  aoAbrirPilha: (pilha: StackNode, noSlotAtivo?: boolean) => Promise<void>;
  aoProgredir?: (feitos: number, total: number) => void;
  aoErro?: (mensagem: string) => void;
}

/**
 * Na janela secundária, abre uma pilha imediatamente se todos os seus cortes já estiverem em
 * memória; caso contrário, solicita os arquivos dessa série à janela principal (`pedir-serie`).
 */
export async function abrirOuPedirPilhaNaSegundaJanela(pilha: StackNode): Promise<void> {
  const arquivos = estado.resultado?.arquivos;
  if (arquivos && pilhaTemTodosArquivos(pilha, arquivos)) {
    await abrirPilha2d(pilha);
    return;
  }
  if (!canalSecundario) return;
  const primeira = pilha.instances[0];
  const pedido: MensagemPedirSerie = {
    tipo: 'pedir-serie',
    pilhaId: pilha.id,
    seriesInstanceUid: primeira?.seriesInstanceUid ?? '',
    studyInstanceUid: primeira?.studyInstanceUid ?? '',
    ...(primeira?.sopInstanceUid ? { sopInicial: primeira.sopInstanceUid } : {}),
  };
  canalSecundario.postMessage(pedido satisfies MensagemSegundaJanela);
}

async function materializarArquivoTransferido(
  item: ArquivoSerieTransferido,
  basePacs: string | undefined,
): Promise<File> {
  if (item.pacsRelativo) {
    const bytes = await lerExame(basePacs!, item.pacsRelativo);
    const nome = item.caminho.split('/').pop() ?? `${item.sopInstanceUid || 'corte'}.dcm`;
    return new File([bytes as BlobPart], nome);
  }
  if (item.arquivo) return item.arquivo;
  throw new Error(`Arquivo ausente para a imagem ${item.sopInstanceUid || item.caminho}.`);
}

/**
 * Inicializa a janela secundária: responde aos pings da principal, recebe o catálogo leve do exame
 * e os pacotes `abrir-serie` sob demanda, e sincroniza rolagem, janela/nível, localizador e linhas.
 */
export function iniciarModoSecundario(opcoes: OpcoesModoSecundario): void {
  if (typeof BroadcastChannel === 'undefined') {
    opcoes.aoErro?.('Comunicação entre janelas indisponível.');
    return;
  }

  const canal = new BroadcastChannel(CANAL_SEGUNDA_JANELA);
  canalSecundario = canal;
  registrarEmissoresViewport(canal);
  let fila = Promise.resolve();

  const processarCatalogo = async (msg: MensagemCatalogoExames): Promise<void> => {
    const arquivos = estado.resultado?.arquivos ?? new Map<string, File>();
    for (const min of msg.miniaturas) {
      if (min.arquivo && !arquivos.has(min.caminho)) {
        arquivos.set(min.caminho, min.arquivo);
      }
    }
    const index = buildIndex(msg.metas);
    const resultado: ResultadoAbertura = {
      index,
      metas: msg.metas,
      arquivos,
      total: msg.metas.length,
      lidos: msg.metas.length,
      ignorados: [],
    };
    estado.resultado = resultado;
    opcoes.aoAtualizarIndice(resultado);
  };

  const processarEnvio = async (msg: MensagemAbrirSerie): Promise<void> => {
    try {
      const usaPacs = msg.itens.some((i) => i.pacsRelativo !== undefined);
      const basePacs = usaPacs ? await pastaDeExames() : undefined;

      // Se já temos os metadados via catálogo, basta guardar os objetos File recebidos no mapa
      // de arquivos (sem re-indexar cabeçalhos DICOM que já vieram no catálogo!).
      if (estado.resultado && estado.resultado.metas.length > 0) {
        const arquivos = estado.resultado.arquivos;
        const porSop = new Map<string, string>();
        for (const m of estado.resultado.metas) {
          if (m.sopInstanceUid) porSop.set(m.sopInstanceUid, m.fileId);
        }
        const faltantes = msg.itens.filter((item) => {
          const chaveMeta = item.sopInstanceUid ? porSop.get(item.sopInstanceUid) : undefined;
          const chave = chaveMeta ?? item.caminho;
          return !arquivos.has(chave);
        });
        for (let i = 0; i < faltantes.length; i++) {
          const item = faltantes[i]!;
          const arq = await materializarArquivoTransferido(item, basePacs);
          arquivos.set(item.caminho, arq);
          const chaveMeta = item.sopInstanceUid ? porSop.get(item.sopInstanceUid) : undefined;
          if (chaveMeta) arquivos.set(chaveMeta, arq);
          opcoes.aoProgredir?.(i + 1, faltantes.length);
        }
      }

      // Caso alguma instância ainda não esteja em `metas` (ex.: série enviada antes do catálogo):
      const novos = filtrarItensNovosParaIndice(msg.itens, estado.resultado?.metas ?? []);
      if (novos.length > 0) {
        const candidatos = novos.map((item) => ({
          path: item.caminho,
          obter: () => materializarArquivoTransferido(item, basePacs),
        }));
        const resultado = await indexarCandidatos(candidatos, opcoes.aoProgredir, estado.resultado);
        estado.resultado = resultado;
        opcoes.aoAtualizarIndice(resultado);
      }

      if (!msg.abrirNoQuadro) return;
      const pilha = encontrarPilhaEnviada(estado.resultado?.index, msg);
      if (!pilha) {
        opcoes.aoErro?.('A série enviada não pôde ser aberta na segunda janela.');
        return;
      }
      await opcoes.aoAbrirPilha(pilha, msg.noSlotAtivo);
    } catch (e) {
      opcoes.aoErro?.(`Erro ao abrir série na segunda janela: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  canal.onmessage = (ev: MessageEvent<MensagemSegundaJanela>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (tratarMensagemSincronia(msg)) return;
    if (msg.tipo === 'ping-janela') {
      canal.postMessage({ tipo: 'janela-pronta' } satisfies MensagemSegundaJanela);
      return;
    }
    if (msg.tipo === 'limpar-exames') {
      fila = fila.then(async () => {
        estado.resultado = null;
        estado.pilhaAtiva = null;
        await limparViewports();
        opcoes.aoAtualizarIndice({
          index: { patients: [], skipped: [] },
          metas: [],
          arquivos: new Map(),
          total: 0,
          lidos: 0,
          ignorados: [],
        });
      });
      return;
    }
    if (msg.tipo === 'catalogo-exames') {
      fila = fila.then(() => processarCatalogo(msg));
      return;
    }
    if (msg.tipo === 'abrir-serie') {
      fila = fila.then(() => processarEnvio(msg));
    }
  };

  canal.postMessage({ tipo: 'janela-pronta' } satisfies MensagemSegundaJanela);
}
