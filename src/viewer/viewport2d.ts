/**
 * Grade de viewports (layouts 1x1, 1x2 e 2x2) e modo MPR.
 * Cada célula da grade pode mostrar os cortes originais (2D STACK) ou ser
 * reconstruída individualmente em Axial, Coronal ou Sagital (ORTHOGRAPHIC) sem sair
 * do layout atual (ex.: 4 sequências em 2x2 com uma delas em Coronal).
 * O modo MPR dedica 3 células (Axial, Coronal e Sagital) ao mesmo volume com Crosshairs.
 */

import {
  cache,
  Enums,
  eventTarget,
  imageLoader,
  setVolumesForViewports,
  type Types,
  utilities as utilitariosCore,
} from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode, StudyNode } from '../io/organize';
import { gridFromVolumeProps } from '../io/geometry';
import { ajustarZoomAoConteudo, exibicaoPadraoPet } from './exibicaoInicial';
import { SynchronizerManager, synchronizers } from '@cornerstonejs/tools';
import { nearestIndex } from '../compare/sync';
import { type FusionCandidate, findFusionCandidates } from '../pet/fusionPairing';
import {
  type CorrecoesPet,
  definirCorrecoesDaPilha,
  esquecerSuvDaPilha,
  registrarSuvDaPilha,
  unidadeDaPilha,
} from '../pet/provedorSuv';
import { definirResolvedorSonda } from '../tools/sonda';
import { definirResolvedorVoi, iniciarVoiEsfera, type RespostaResolvedor } from '../tools/voiEsfera';
import { worldToVoxel } from '../io/geometry';
import {
  adicionarViewportAoGrupo,
  botaoAtribuido,
  ferramentaPrimariaAtual,
  FERRAMENTAS_PRIMARIAS,
  definirModoMprFerramentas,
  removerViewportDoGrupo,
} from '../tools/grupo';
import { abrirDialogoCurvaPerfusao } from '../tools/curvaPerfusao';
import { desenharMiraNoCanvas, FERRAMENTA_LOCALIZADOR_3D } from '../tools/localizador3d';
import {
  aplicarCameraMipRotatorio,
  type ControladorMipRotatorio,
  criarControladorMipRotatorio,
} from '../tools/mipRotatorio';
import {
  calcularCorteSincronizado,
  calcularRotulosParaSlots,
  criarVinculoComparacao,
  destruirSincronizadoresComparacao,
  escolherParInicialComparacao,
  type EstadoComparacao,
  obterPosicaoCorteAtual,
  recalcularVinculoPorPosicoesAtuais,
  sincronizarParCornerstone,
  transformarPontoEntrePilhas,
  mesmaModalidade,
  mesmoEstudo,
} from '../compare/modoComparar';
import { invertLink, type ScrollLink } from '../compare/sync';
import { estado } from '../state/store';
import { adquirirVolume, descartarVolume, liberarVolume } from '../volume/montarVolume';
import { avaliarVolume } from '../volume/validarVolume';
import { cineTocando, definirFps, fpsAtual, pararCine, pararTodosCines, tocarCine } from './cine';
import { idElemento, ID_MOTOR, idViewport, iniciarCornerstone, MAX_VIEWPORTS } from './iniciar';
import { criarOverlay, type Overlay, type PlanoMprOverlay } from './overlay';

const CARGAS_SIMULTANEAS = 4;

/**
 * Layout da grade: `${linhas}x${colunas}` (ex.: '2x2', '1x3', '3x4'), até 5x5.
 * '1x2' = 1 linha e 2 colunas (lado a lado).
 */
export type Layout = string;
export type PlanoSlot = 'original' | 'axial' | 'coronal' | 'sagital' | 'mip-rotatorio';
export type ModoSlab = 'normal' | 'mip' | 'minip' | 'media';

export const GRADE_MAXIMA = 5;

/** Disparado em `document` quando o usuário pede o painel "Dados PET" (detail = StackNode). */
export const EVENTO_DADOS_PET = 'abrirDadosPet';
/** Disparado depois que o SUV de uma pilha foi recalculado com dados corrigidos. */
export const EVENTO_SUV_ATUALIZADO = 'suvAtualizado';

export interface GeometriaLayout {
  rotulo: string;
  colunas: number;
  linhas: number;
}

/** Interpreta '2x3' (linhas x colunas); valores fora de 1..5 ou inválidos caem em 1x1. */
export function geometriaLayout(layout: Layout): GeometriaLayout {
  const m = /^(\d+)x(\d+)$/.exec(layout);
  const linhas = m ? Number(m[1]) : 1;
  const colunas = m ? Number(m[2]) : 1;
  if (linhas < 1 || colunas < 1 || linhas > GRADE_MAXIMA || colunas > GRADE_MAXIMA) {
    return { rotulo: '1x1', colunas: 1, linhas: 1 };
  }
  return { rotulo: `${linhas}x${colunas}`, colunas, linhas };
}

export function idLayout(linhas: number, colunas: number): Layout {
  return `${linhas}x${colunas}`;
}

/** Grades fixas do menu e do ciclo da tecla L. */
export const ORDEM_LAYOUTS: Layout[] = ['1x1', '1x2', '2x2'];

export const PLANOS_SLOTS: Record<PlanoSlot, PlanoMprOverlay> = {
  original: { rotulo: 'Original', eixo: Enums.OrientationAxis.ACQUISITION },
  axial: { rotulo: 'Axial', eixo: Enums.OrientationAxis.AXIAL },
  coronal: { rotulo: 'Coronal', eixo: Enums.OrientationAxis.CORONAL },
  sagital: { rotulo: 'Sagital', eixo: Enums.OrientationAxis.SAGITTAL },
  'mip-rotatorio': { rotulo: 'MIP rotatório', eixo: Enums.OrientationAxis.CORONAL },
};

export const MODOS_SLAB: Record<ModoSlab, { rotulo: string; blendMode: Enums.BlendModes }> = {
  normal: { rotulo: 'Normal', blendMode: Enums.BlendModes.COMPOSITE },
  mip: { rotulo: 'MIP', blendMode: Enums.BlendModes.MAXIMUM_INTENSITY_BLEND },
  minip: { rotulo: 'MinIP', blendMode: Enums.BlendModes.MINIMUM_INTENSITY_BLEND },
  media: { rotulo: 'Média', blendMode: Enums.BlendModes.AVERAGE_INTENSITY_BLEND },
};

const PLANOS_MPR: PlanoMprOverlay[] = [
  PLANOS_SLOTS.axial,
  PLANOS_SLOTS.coronal,
  PLANOS_SLOTS.sagital,
];

/** Disparado em `document` quando muda o viewport ativo, o layout, o MPR ou o cine. */
export const EVENTO_ESTADO_VIEWPORTS = 'estadoViewports';

/** Disparado em `document` quando a janela/nível (voiRange) de um viewport muda. */
export const EVENTO_JANELA_MUDOU = 'janelaMudou';

export interface EstadoViewports {
  layout: Layout;
  /** Id da pilha mostrada no viewport ativo (null se vazio). */
  pilhaId: string | null;
  cineTocando: boolean;
  fps: number;
  mprAtivo: boolean;
  mprDisponivel: boolean;
  /** Plano individual do viewport ativo ('original', 'axial', 'coronal', 'sagital' ou 'mip-rotatorio'). */
  planoAtivo: PlanoSlot;
  /** Modo de projeção do slab ('normal', 'mip', 'minip' ou 'media'). */
  modoSlabAtivo: ModoSlab;
  slabMm: number;
  /** Verdadeiro quando algum viewport visível exibe o MIP rotatório. */
  mipRotatorioVisivel: boolean;
  /** Estado do modo Comparar (Fase 4). */
  comparacao: EstadoComparacao;
  /** Um viewport está maximizado (tela cheia da grade). */
  maximizado: boolean;
  /** Sincronia automática (rolagem, zoom, pan e janela) entre séries do mesmo estudo. */
  sincroniaEstudo: boolean;
}

export interface ElementosViewport2d {
  /** Contêiner da área de viewports; a grade é criada dentro dele. */
  contentor: HTMLElement;
}

interface Slot {
  indice: number;
  idViewport: string;
  celula: HTMLDivElement;
  elemento: HTMLDivElement;
  mensagem: HTMLDivElement;
  avisoVolume: HTMLDivElement;
  controlesMip: HTMLDivElement;
  controlesFusao: HTMLDivElement;
  etiquetaComparacao: HTMLDivElement;
  avisoCobertura: HTMLDivElement;
  botaoDadosPet: HTMLButtonElement;
  canvasMira: HTMLCanvasElement;
  pontoMiraMundo: Types.Point3 | null;
  controladorMip?: ControladorMipRotatorio;
  overlay: Overlay;
  viewport?: Types.IStackViewport | Types.IVolumeViewport;
  tipoViewport: Enums.ViewportType;
  planoSlot: PlanoSlot;
  modoSlab: ModoSlab;
  slabMm: number;
  planoMpr?: PlanoMprOverlay;
  habilitado: boolean;
  montandoVolume: boolean;
  pilha: StackNode | null;
  /** Id da pilha para a qual este slot adquiriu um volume (null se só 2D ou vazio). */
  volumePilhaId: string | null;
  /** imageIds da pilha, na ordem de exibição (compartilhados via registro). */
  ids: string[];
  /** Corte em que o slot estava quando foi escondido por um layout menor. */
  corteSalvo?: number;
  /** Cada abertura nova invalida cargas e esperas da anterior. */
  geracao: number;
  /** Fusão: PET sobreposto à TC deste slot (vale nos planos axial, coronal e sagital). */
  pilhaFusao: StackNode | null;
  idsFusao: string[];
  /** Id da pilha de PET para a qual o slot tem uma referência de volume. */
  volumeFusaoId: string | null;
  fusao: { opacidade: number; colormap: string; teto: number; minimo: number };
  /** Já ajustou o zoom da fusão ao conteúdo da TC (uma vez, quando o volume termina de carregar). */
  zoomFusaoAjustado?: boolean;
  /** Reaplica opacidade, colormap e teto ao PET da fusão (depois de o volume terminar de carregar). */
  reaplicarFusao?: () => void;
  /** Ids dos volumes da fusão (TC e PET) para reaplicar propriedades e o registro manual. */
  volumesFusao?: { ct: string; pet: string };
  /** MPR: o PET deste plano é de outro slot (que guarda as referências); não libera nada. */
  fusaoCompartilhada?: boolean;
  atualizarLeituraRegistro?: () => void;
  /** Legenda da escala de cores do PET na fusão. */
  legendaFusao?: HTMLDivElement;
  atualizarLegendaFusao?: () => void;
  /** Registro manual: translação (mm) do PET sobre a TC; `ativo` = arrastar no viewport move o PET. */
  registro: { ativo: boolean; deslocamento: [number, number, number] };
}

const slots: Slot[] = [];
let grade: HTMLDivElement;
let layoutAtual: Layout = '1x1';

// Sincronia automática entre séries do mesmo estudo (fora do modo Comparar).
let sincroniaEstudoLigada = true;
let assinaturaSincroniaEstudo = '';
let sincronizandoEstudo = false;
const indicesImpostosPorEstudo = new Map<number, number>();

// Viewport maximizado por duplo clique (null = grade normal).
let maximizado: number | null = null;
let gradeAntesDeMaximizar: { colunas: string; linhas: string; ocultas: boolean[] } | null = null;
let ativo = 0;
let mprAtivo = false;
let modoSlabMpr: ModoSlab = 'normal';
let slabMprMm = 1;
let geracaoMpr = 0;
let sincronizandoVoi = false;

// Estado do modo Comparar (Fase 4)
let compararAtivo = false;
let rolagemCompararLigada = true;
let linkRolagemComparar: ScrollLink | null = null;
let erroVinculoComparar: string | null = null;
let janelaCompararLigada = false;
let zoomPanCompararLigado = false;
let sincronizandoRolagemComparar = false;

/** Pilhas, planos e slabs salvos antes de entrar no MPR, para restaurar ao sair. */
/** O MPR atual foi aberto a partir de uma fusão: ao sair, volta cada célula à série que tinha. */
let mprComFusao = false;

let estadoAntesDoMpr: Array<{
  pilha: StackNode | null;
  planoSlot: PlanoSlot;
  modoSlab: ModoSlab;
  slabMm: number;
  corte?: number;
  pilhaFusao?: StackNode | null;
  fusao?: Slot['fusao'];
}> = [];

// ---------- registro de imageIds por pilha ----------

const registro = new Map<string, { ids: string[]; refs: number }>();

/** imageIds da pilha; registra os arquivos na primeira vez e conta mais um uso. */
function adquirirIds(stack: StackNode, arquivos: Map<string, File>): string[] {
  const existente = registro.get(stack.id);
  if (existente) {
    existente.refs++;
    return existente.ids;
  }
  const adicionados: string[] = [];
  try {
    for (const inst of stack.instances) {
      const arquivo = arquivos.get(inst.fileId);
      if (!arquivo) throw new Error(`Arquivo não encontrado: ${inst.fileId}`);
      adicionados.push(wadouri.fileManager.add(arquivo));
    }
  } catch (e) {
    removerArquivos(adicionados);
    throw e;
  }
  registro.set(stack.id, { ids: adicionados, refs: 1 });
  // PET: os fatores de SUV têm de existir antes de qualquer imagem ser carregada.
  registrarSuvDaPilha(stack, adicionados);
  return adicionados;
}

function removerArquivos(ids: string[]): void {
  for (const id of ids) {
    try {
      cache.removeImageLoadObject(id);
    } catch {
      /* não estava no cache */
    }
    const indice = Number(id.slice(id.indexOf(':') + 1));
    if (Number.isInteger(indice)) wadouri.fileManager.remove(indice);
  }
}

/** Solta um uso da pilha; no último, libera os arquivos. */
function liberarIds(stackId: string | undefined): void {
  if (!stackId) return;
  const r = registro.get(stackId);
  if (!r) return;
  r.refs--;
  if (r.refs > 0) return;
  registro.delete(stackId);
  cacheVoxels.delete(stackId);
  esquecerSuvDaPilha(stackId);
  removerArquivos(r.ids);
}

// ---------- mensagens e utilidades ----------

function textoDoErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (o.error !== undefined) return textoDoErro(o.error);
  }
  return 'erro desconhecido';
}

function mostrarMensagem(slot: Slot, titulo: string, detalhe?: string, erro = false): void {
  slot.mensagem.hidden = false;
  slot.mensagem.replaceChildren();
  const t = document.createElement('div');
  t.textContent = titulo;
  if (erro) t.className = 'erro';
  slot.mensagem.append(t);
  if (detalhe) {
    const d = document.createElement('span');
    d.textContent = detalhe;
    slot.mensagem.append(d);
  }
}

function esconderMensagem(slot: Slot): void {
  slot.mensagem.hidden = true;
}

function mostrarAvisoVolume(slot: Slot, mensagens: string[]): void {
  slot.avisoVolume.textContent = `Modo apenas 2D: ${mensagens.join(' · ')}`;
  slot.avisoVolume.hidden = false;
}

function esconderAvisoVolume(slot: Slot): void {
  slot.avisoVolume.hidden = true;
  slot.avisoVolume.textContent = '';
}

function nomeDaSerie(stack: StackNode): string {
  const primeira = stack.instances[0];
  return [primeira?.modality, primeira?.seriesDescription].filter(Boolean).join(' · ') || stack.id;
}

/** Ordem de carregamento: do corte do meio para fora (vizinhos primeiro). */
function ordemDoMeio(n: number, meio: number): number[] {
  const ordem = [meio];
  for (let d = 1; ordem.length < n; d++) {
    if (meio - d >= 0) ordem.push(meio - d);
    if (meio + d < n) ordem.push(meio + d);
  }
  return ordem;
}

async function carregarRestante(slot: Slot, ids: string[], ordem: number[], minhaGeracao: number): Promise<void> {
  let proximo = 1; // o corte inicial já foi carregado
  let primeiroErro: string | undefined;
  async function trabalhador(): Promise<void> {
    while (minhaGeracao === slot.geracao) {
      const k = proximo++;
      if (k >= ordem.length) return;
      try {
        await imageLoader.loadAndCacheImage(ids[ordem[k]!]!);
      } catch (e) {
        primeiroErro ??= textoDoErro(e);
      }
    }
  }
  await Promise.all(Array.from({ length: CARGAS_SIMULTANEAS }, trabalhador));
  if (minhaGeracao === slot.geracao && primeiroErro) {
    console.warn(`Alguns cortes não carregaram: ${primeiroErro}`);
  }
}

// ---------- estado e viewport ativo ----------

function estadoAtual(): EstadoViewports {
  const slot = slots[ativo];
  const pilha = slot?.pilha ?? null;
  const mprDisponivel = pilha !== null && avaliarVolume(pilha).ok;
  const mipRotatorioVisivel = slots.some(
    (s) => !s.celula.hidden && s.planoSlot === 'mip-rotatorio',
  );
  return {
    layout: layoutAtual,
    pilhaId: pilha?.id ?? null,
    cineTocando: cineTocando(ativo),
    fps: fpsAtual(),
    mprAtivo,
    mprDisponivel,
    planoAtivo: slot?.planoSlot ?? 'original',
    modoSlabAtivo: mprAtivo ? modoSlabMpr : (slot?.modoSlab ?? 'normal'),
    slabMm: mprAtivo ? slabMprMm : (slot?.slabMm ?? 1),
    mipRotatorioVisivel,
    maximizado: maximizado !== null,
    sincroniaEstudo: sincroniaEstudoLigada,
    comparacao: {
      ativo: compararAtivo,
      rolagemLigada: rolagemCompararLigada && linkRolagemComparar !== null,
      deslocamentoMm: linkRolagemComparar?.offsetMm ?? null,
      erroVinculo: erroVinculoComparar,
      janelaLigada: janelaCompararLigada,
      zoomPanLigado: zoomPanCompararLigado,
    },
  };
}

// ---------- sincronia automática entre séries do mesmo estudo ----------

const ID_SYNC_ESTUDO_ZOOM = 'sync-estudo-zoom-pan';
const ID_SYNC_ESTUDO_VOI = 'sync-estudo-voi';

/** O slot mostra a fusão PET/TC: tem PET associado e está num plano de volume (axial, coronal, sagital). */
function emFusao(s: Slot): boolean {
  return !!s.pilhaFusao && (s.planoSlot === 'axial' || s.planoSlot === 'coronal' || s.planoSlot === 'sagital');
}

/** Esconde controles e legenda da fusão (o PET continua associado ao slot para voltar depois). */
function ocultarFusaoVisual(s: Slot): void {
  s.controlesFusao.hidden = true;
  s.controlesFusao.replaceChildren();
  s.legendaFusao?.remove();
  s.legendaFusao = undefined;
  s.atualizarLegendaFusao = undefined;
  s.reaplicarFusao = undefined;
  s.celula.classList.remove('modo-registro');
  s.registro.ativo = false;
}

/** Viewports 2D (pilha) visíveis agrupados por estudo + referencial; só grupos com 2 ou mais. */
function gruposSincroniaEstudo(): Slot[][] {
  if (compararAtivo || mprAtivo || maximizado !== null) return [];
  const grupos = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.celula.hidden || !s.pilha || !s.habilitado || !s.viewport) continue;
    // Entram os cortes originais (pilha) e a fusão PET/TC (volume axial).
    // Entram cortes originais (pilha) e planos de volume (axial, coronal, sagital; com ou sem fusão).
    if (s.planoSlot === 'original' ? !('setImageIdIndex' in s.viewport) : s.planoSlot === 'mip-rotatorio') continue;
    const inst = s.pilha.instances[0];
    if (!inst?.studyInstanceUid || !inst.frameOfReferenceUid) continue;
    const chave = `${inst.studyInstanceUid}|${inst.frameOfReferenceUid}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(s);
    grupos.set(chave, lista);
  }
  return [...grupos.values()].filter((g) => g.length >= 2);
}

let zoomDoGrupoPendente = false;

/**
 * Aproxima o zoom ao corpo usando a TC (ou a 1ª série do grupo); o sincronizador leva às demais.
 * Precisa de uma imagem já carregada: fica pendente e é tentado de novo a cada atualização.
 */
function tentarZoomDoGrupo(): void {
  if (!zoomDoGrupoPendente) return;
  const grupo = gruposSincroniaEstudo()[0];
  if (!grupo) return;
  const base =
    grupo.find((s) => s.pilha?.instances[0]?.modality === 'CT' && s.viewport && 'setImageIdIndex' in s.viewport) ??
    grupo.find((s) => s.viewport && 'setImageIdIndex' in s.viewport);
  if (!base?.viewport || base.ids.length === 0) return;
  const id = base.ids[Math.floor(base.ids.length / 2)]!;
  if (!cache.getImage(id)) return;
  zoomDoGrupoPendente = false;
  ajustarZoomAoConteudo(base.viewport, id, base.pilha?.instances[0]?.modality);
}

/** Refaz os sincronizadores de zoom/pan e janela só quando a composição dos grupos muda. */
function atualizarSincroniaEstudo(): void {
  const grupos = sincroniaEstudoLigada ? gruposSincroniaEstudo() : [];
  const assinatura = grupos
    .map((g) => g.map((s) => `${s.idViewport}:${s.pilha?.id}`).join(','))
    .join('|');
  if (assinatura === assinaturaSincroniaEstudo) {
    tentarZoomDoGrupo();
    return;
  }
  assinaturaSincroniaEstudo = assinatura;
  zoomDoGrupoPendente = grupos.length > 0;

  SynchronizerManager.destroySynchronizer(ID_SYNC_ESTUDO_ZOOM);
  SynchronizerManager.destroySynchronizer(ID_SYNC_ESTUDO_VOI);
  if (grupos.length === 0) return;

  // Os campos de visão (FOV) das séries diferem (PET x TC): o zoom/pan automático de cada uma
  // não combina entre si. Ao formar o grupo todos voltam ao enquadramento padrão e só então
  // os sincronizadores são ligados.
  for (const s of grupos[0]!) {
    try {
      s.viewport?.resetCamera();
      s.viewport?.render();
    } catch {
      /* viewport ainda sem imagem */
    }
  }

  const zoom = synchronizers.createZoomPanSynchronizer(ID_SYNC_ESTUDO_ZOOM);
  const voi = synchronizers.createVOISynchronizer(ID_SYNC_ESTUDO_VOI, { syncInvertState: true, syncColormap: true });
  // Com um só estudo aberto (caso comum) há um grupo; com vários, só o primeiro é ligado.
  const grupo = grupos[0]!;
  for (const s of grupo) {
    // O sincronizador do Cornerstone só atualiza viewports de pilha; os de volume são copiados à mão.
    if (s.viewport && 'setImageIdIndex' in s.viewport) zoom.add({ renderingEngineId: ID_MOTOR, viewportId: s.idViewport });
  }
  // Janela só entre séries da mesma modalidade (PET em SUV e TC em HU não compartilham janela).
  const modalidade = grupo[0]!.pilha?.instances[0]?.modality;
  const mesmas = grupo.filter((s) => s.planoSlot === 'original' && s.pilha?.instances[0]?.modality === modalidade);
  if (mesmas.length >= 2) {
    for (const s of mesmas) voi.add({ renderingEngineId: ID_MOTOR, viewportId: s.idViewport });
  }
  tentarZoomDoGrupo();
}

/** Normal do plano do slot: a da aquisição (pilha) ou a da câmera (plano de volume). */
function normalDoSlot(s: Slot): [number, number, number] | undefined {
  if (!s.viewport) return undefined;
  if ('setImageIdIndex' in s.viewport) return s.pilha?.geometry.normal as [number, number, number] | undefined;
  const n = s.viewport.getCamera().viewPlaneNormal;
  return n ? [n[0], n[1], n[2]] : undefined;
}

/** Posição (mm) do corte atual do slot ao longo da sua normal (pilha ou plano de volume). */
function posicaoDoSlot(s: Slot): number | undefined {
  if (!s.pilha || !s.viewport) return undefined;
  if ('setImageIdIndex' in s.viewport) return obterPosicaoCorteAtual(s.pilha, s.viewport);
  const n = normalDoSlot(s);
  const fp = s.viewport.getCamera().focalPoint;
  return n && fp ? fp[0] * n[0] + fp[1] * n[1] + fp[2] * n[2] : undefined;
}

/** Leva o slot ao corte mais próximo de `mm`; devolve a posição realmente usada (ou undefined se já estava). */
function irParaPosicaoMm(d: Slot, mm: number): number | undefined {
  if (!d.pilha || !d.viewport) return undefined;
  if ('setImageIdIndex' in d.viewport) {
    const posicoes = d.pilha.geometry.positions;
    if (posicoes.length === 0) return undefined;
    const idx = nearestIndex(posicoes, mm);
    if (d.viewport.getCurrentImageIdIndex() === idx) return undefined;
    void d.viewport.setImageIdIndex(idx);
    return posicoes[idx]!;
  }
  const n = normalDoSlot(d);
  const fp = d.viewport.getCamera().focalPoint;
  if (!n || !fp) return undefined;
  const atual = fp[0] * n[0] + fp[1] * n[1] + fp[2] * n[2];
  if (Math.abs(atual - mm) < 0.01) return undefined;
  const delta = mm - atual;
  d.viewport.jumpToWorld([fp[0] + n[0] * delta, fp[1] + n[1] * delta, fp[2] + n[2] * delta]);
  return mm;
}

/** Slots do grupo no mesmo plano (normais paralelas) que `so`, com o sinal da relação entre elas. */
function destinosNoMesmoPlano(grupo: Slot[], so: Slot): Array<{ d: Slot; sinal: 1 | -1 }> {
  const nO = normalDoSlot(so);
  if (!nO) return [];
  const saida: Array<{ d: Slot; sinal: 1 | -1 }> = [];
  for (const d of grupo) {
    if (d === so) continue;
    const nD = normalDoSlot(d);
    if (!nD) continue;
    const cos = nO[0] * nD[0] + nO[1] * nD[1] + nO[2] * nD[2];
    if (Math.abs(cos) >= 0.9) saida.push({ d, sinal: cos >= 0 ? 1 : -1 });
  }
  return saida;
}

/**
 * Rolagem por posição (mm) entre os cortes do grupo que estão no mesmo plano: cortes originais,
 * planos de volume (axial, coronal, sagital) e fusão. Rolar um leva os outros ao mesmo ponto.
 */
function aoRolarSlotEstudo(origem: number): void {
  if (!sincroniaEstudoLigada || sincronizandoEstudo || compararAtivo || mprAtivo) return;
  const so = slots[origem];
  if (!so?.pilha || !so.viewport) return;
  const posicao = posicaoDoSlot(so);
  if (posicao === undefined) return;
  // Este evento foi causado pela própria sincronia: não propaga de volta.
  const imposta = indicesImpostosPorEstudo.get(origem);
  if (imposta !== undefined && Math.abs(imposta - posicao) < 0.5) {
    indicesImpostosPorEstudo.delete(origem);
    return;
  }
  const grupo = gruposSincroniaEstudo().find((g) => g.includes(so));
  if (!grupo) return;

  sincronizandoEstudo = true;
  try {
    for (const { d, sinal } of destinosNoMesmoPlano(grupo, so)) {
      if (!d.pilha) continue;
      const alvo = posicao * sinal;
      if ('setImageIdIndex' in d.viewport!) {
        // Série de pilha: só se o ponto está na cobertura dela.
        const posicoes = d.pilha.geometry.positions;
        const passo = d.pilha.instances[0]?.sliceThickness ?? 5;
        if (posicoes.length === 0 || Math.abs(posicoes[nearestIndex(posicoes, alvo)]! - alvo) > Math.max(passo, 1)) continue;
      }
      const usada = irParaPosicaoMm(d, alvo);
      if (usada !== undefined) indicesImpostosPorEstudo.set(d.indice, usada);
    }
  } finally {
    sincronizandoEstudo = false;
  }
}

let sincronizandoCameraEstudo = false;

/**
 * O sincronizador de zoom/pan do Cornerstone não atualiza viewports de volume (fusão e planos
 * reconstruídos), então o zoom e o pan entre os cortes do mesmo plano são copiados aqui.
 */
function aoMudarCameraEstudo(origem: number): void {
  if (!sincroniaEstudoLigada || sincronizandoCameraEstudo || compararAtivo || mprAtivo) return;
  const so = slots[origem];
  if (!so?.viewport || !so.pilha) return;
  const grupo = gruposSincroniaEstudo().find((g) => g.includes(so));
  if (!grupo) return;
  const origemVolume = !('setImageIdIndex' in so.viewport);
  // Pilha↔pilha já é feito pelo Cornerstone; aqui só os pares em que algum lado é volume.
  const destinos = destinosNoMesmoPlano(grupo, so).filter(({ d }) => origemVolume || !('setImageIdIndex' in d.viewport!));
  if (destinos.length === 0) return;
  const v = so.viewport as Types.IStackViewport | Types.IVolumeViewport;
  const pan = v.getPan?.();
  const zoom = v.getZoom?.();
  sincronizandoCameraEstudo = true;
  try {
    for (const { d } of destinos) {
      const t = d.viewport as Types.IStackViewport | Types.IVolumeViewport | undefined;
      if (!t) continue;
      if (zoom !== undefined && Math.abs((t.getZoom?.() ?? zoom) - zoom) > 1e-6) t.setZoom?.(zoom);
      const pt = t.getPan?.();
      if (pan && (!pt || Math.abs(pt[0] - pan[0]) > 0.01 || Math.abs(pt[1] - pan[1]) > 0.01)) t.setPan?.(pan);
      t.render();
    }
  } finally {
    sincronizandoCameraEstudo = false;
  }
}

/** Liga ou desliga a sincronia automática entre séries do mesmo estudo. */
export function alternarSincroniaEstudo(): void {
  sincroniaEstudoLigada = !sincroniaEstudoLigada;
  assinaturaSincroniaEstudo = '#forcar'; // força refazer
  atualizarSincroniaEstudo();
  sincronizar();
}

/** Atualiza o estado global, a borda do slot ativo, os rótulos ATUAL/ANTERIOR e avisa a interface. */
function sincronizar(): void {
  const s = slots[ativo];
  estado.pilhaAtiva = s?.pilha ?? null;
  estado.idViewportAtivo = s?.idViewport ?? null;
  const varios = mprAtivo || geometriaLayout(layoutAtual).colunas * geometriaLayout(layoutAtual).linhas > 1;
  for (const x of slots) x.celula.classList.toggle('ativa', varios && maximizado === null && x.indice === ativo);
  atualizarEtiquetasComparacao();
  atualizarSincroniaEstudo();
  for (const x of slots) {
    x.botaoDadosPet.hidden = x.celula.hidden || !x.pilha?.instances.some((i) => i.modality === 'PT');
  }
  document.dispatchEvent(new CustomEvent<EstadoViewports>(EVENTO_ESTADO_VIEWPORTS, { detail: estadoAtual() }));
}

export function ativarViewport(indice: number): void {
  const limite = mprAtivo ? 3 : geometriaLayout(layoutAtual).colunas * geometriaLayout(layoutAtual).linhas;
  if (!slots[indice] || indice >= limite || indice === ativo) return;
  ativo = indice;
  sincronizar();
}

export function layoutId(): Layout {
  return layoutAtual;
}

export function emModoMpr(): boolean {
  return mprAtivo;
}

async function garantirViewport2d(slot: Slot): Promise<Types.IStackViewport> {
  const motor = await iniciarCornerstone();
  if (slot.habilitado && slot.tipoViewport !== Enums.ViewportType.STACK) {
    await desabilitar(slot, false);
  }
  if (!slot.habilitado || !slot.viewport) {
    slot.planoMpr = undefined;
    slot.tipoViewport = Enums.ViewportType.STACK;
    motor.enableElement({
      viewportId: slot.idViewport,
      type: Enums.ViewportType.STACK,
      element: slot.elemento,
    });
    adicionarViewportAoGrupo(slot.idViewport);
    slot.viewport = motor.getViewport<Types.IStackViewport>(slot.idViewport);
    slot.habilitado = true;
  }
  return slot.viewport as Types.IStackViewport;
}

async function garantirViewportMpr(
  slot: Slot,
  plano: PlanoMprOverlay,
): Promise<Types.IVolumeViewport> {
  const motor = await iniciarCornerstone();
  if (slot.habilitado) {
    await desabilitar(slot, false);
  }
  slot.planoMpr = plano;
  slot.tipoViewport = Enums.ViewportType.ORTHOGRAPHIC;
  motor.enableElement({
    viewportId: slot.idViewport,
    type: Enums.ViewportType.ORTHOGRAPHIC,
    element: slot.elemento,
    defaultOptions: {
      orientation: plano.eixo,
    },
  });
  adicionarViewportAoGrupo(slot.idViewport);
  slot.viewport = motor.getViewport<Types.IVolumeViewport>(slot.idViewport);
  slot.habilitado = true;
  return slot.viewport as Types.IVolumeViewport;
}

/** Desliga o viewport de um slot. A pilha continua nele para voltar depois. */
async function desabilitar(slot: Slot, cancelarGeracao = true): Promise<void> {
  if (slot.controladorMip) {
    slot.controladorMip.destruir();
    slot.controladorMip = undefined;
  }
  if (!slot.habilitado) return;
  pararCine(slot.indice);
  if (cancelarGeracao) slot.geracao++;
  slot.montandoVolume = false;
  if (slot.tipoViewport === Enums.ViewportType.STACK && slot.viewport && 'getCurrentImageIdIndex' in slot.viewport) {
    try {
      slot.corteSalvo = slot.viewport.getCurrentImageIdIndex();
    } catch {
      slot.corteSalvo = undefined;
    }
  }
  const motor = await iniciarCornerstone();
  removerViewportDoGrupo(slot.idViewport);
  motor.disableElement(slot.idViewport);
  slot.viewport = undefined;
  slot.planoMpr = undefined;
  slot.habilitado = false;
}

function voiPadraoDaPilha(stack: StackNode): { lower: number; upper: number } | undefined {
  const primeira = stack.instances[0];
  const centro = primeira?.windowCenter[0];
  const largura = primeira?.windowWidth[0];
  if (centro !== undefined && largura !== undefined && largura > 0) {
    return { lower: centro - largura / 2, upper: centro + largura / 2 };
  }
  return undefined;
}

function precisaVolumeViewport(slot: Slot): boolean {
  return slot.planoSlot !== 'original' || slot.modoSlab !== 'normal' || slot.slabMm > 1;
}

function aplicarSlabAoViewport(vp: Types.IVolumeViewport, modo: ModoSlab, mm: number): void {
  if (modo === 'normal' && mm <= 1) {
    vp.resetSlabThickness();
    vp.setBlendMode(Enums.BlendModes.COMPOSITE);
  } else {
    vp.setSlabThickness(mm);
    const blendMode =
      modo === 'normal'
        ? Enums.BlendModes.AVERAGE_INTENSITY_BLEND
        : MODOS_SLAB[modo].blendMode;
    vp.setBlendMode(blendMode);
  }
  corrigirOpacidadePeloSlab(vp);
}

/**
 * Faz a opacidade dos volumes sobrepostos (o PET da fusão) valer o que foi pedido.
 *
 * O vtk.js trata a opacidade como "por unidade de distância": o que aparece na tela é
 * 1 - (1 - opacidade)^(percurso do raio / unidade). Num corte fino o raio percorre ~0,125 mm e a
 * unidade padrão é 1 mm, então 50% pedidos viravam ~9% na tela (fusão desbotada). Igualando a
 * unidade ao percurso do raio no slab, o expoente vira 1 e 50% são 50%.
 *
 * Percurso medido no navegador (Cornerstone 5.17.1): 2 × slab + 0,025 mm
 * (0,125 mm no slab mínimo de 0,05; 2,0 em 1 mm; 10 em 5 mm).
 */
function corrigirOpacidadePeloSlab(vp: Types.IVolumeViewport): void {
  const percurso = 2 * vp.getSlabThickness() + 0.025;
  for (const entrada of vp.getActors().slice(1)) {
    const prop = (entrada.actor as { getProperty?: () => unknown }).getProperty?.() as
      | { setScalarOpacityUnitDistance?: (componente: number, mm: number) => void }
      | undefined;
    prop?.setScalarOpacityUnitDistance?.(0, percurso);
  }
}

/**
 * Encontra o corte de uma pilha 2D mais próximo ao ponto 3D `ponto` (em coordenadas de mundo LPS)
 * e leva todos os viewports visíveis (2D ou MPR) até esse ponto.
 */
function indiceCorteMaisProximoDoPonto(stack: StackNode, ponto: Types.Point3): number {
  let melhorIndice = 0;
  let menorDistancia = Infinity;
  for (let i = 0; i < stack.instances.length; i++) {
    const inst = stack.instances[i]!;
    const pos = inst.imagePositionPatient;
    const iop = inst.imageOrientationPatient;
    let dist: number;
    if (pos && iop && iop.length >= 6) {
      // Produto vetorial dos cossenos diretores (linha x coluna) = normal ao corte
      const nx = iop[1] * iop[5] - iop[2] * iop[4];
      const ny = iop[2] * iop[3] - iop[0] * iop[5];
      const nz = iop[0] * iop[4] - iop[1] * iop[3];
      dist = Math.abs((ponto[0] - pos[0]) * nx + (ponto[1] - pos[1]) * ny + (ponto[2] - pos[2]) * nz);
    } else if (pos) {
      dist = Math.abs(ponto[2] - pos[2]);
    } else if (inst.sliceLocation !== undefined) {
      dist = Math.abs(ponto[2] - inst.sliceLocation);
    } else {
      continue;
    }
    if (dist < menorDistancia) {
      menorDistancia = dist;
      melhorIndice = i;
    }
  }
  return melhorIndice;
}

function atualizarMiraSlot(slot: Slot): void {
  if (!slot.pontoMiraMundo || !slot.viewport || !slot.habilitado || slot.celula.hidden || slot.planoSlot === 'mip-rotatorio') {
    desenharMiraNoCanvas(slot.canvasMira, null);
    return;
  }
  try {
    const pontoCanvas = slot.viewport.worldToCanvas(slot.pontoMiraMundo);
    if (!pontoCanvas || !Number.isFinite(pontoCanvas[0]) || !Number.isFinite(pontoCanvas[1])) {
      desenharMiraNoCanvas(slot.canvasMira, null);
      return;
    }
    desenharMiraNoCanvas(slot.canvasMira, [pontoCanvas[0], pontoCanvas[1]]);
  } catch {
    desenharMiraNoCanvas(slot.canvasMira, null);
  }
}

export function limparMirasLocalizador(): void {
  for (const s of slots) {
    s.pontoMiraMundo = null;
    desenharMiraNoCanvas(s.canvasMira, null);
  }
}

function aplicarLocalizador3d(origemIndice: number, pontoMundoOrigem: Types.Point3): void {
  const slotOrigem = slots[origemIndice];
  if (slotOrigem) {
    slotOrigem.pontoMiraMundo = [pontoMundoOrigem[0], pontoMundoOrigem[1], pontoMundoOrigem[2]];
    atualizarMiraSlot(slotOrigem);
  }

  const sincronizandoAnterior = sincronizandoRolagemComparar;
  sincronizandoRolagemComparar = true;
  try {
    for (const s of slots) {
      if (s.indice === origemIndice || s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha) {
        continue;
      }
      if (s.planoSlot === 'mip-rotatorio') {
        s.pontoMiraMundo = null;
        desenharMiraNoCanvas(s.canvasMira, null);
        continue;
      }

      const linkPreferencial =
        linkRolagemComparar && origemIndice === 0 && s.indice === 1
          ? linkRolagemComparar
          : linkRolagemComparar && origemIndice === 1 && s.indice === 0
            ? invertLink(linkRolagemComparar)
            : null;

      const pontoAlvo = slotOrigem?.pilha
        ? transformarPontoEntrePilhas(
            pontoMundoOrigem,
            slotOrigem.pilha,
            s.pilha,
            linkPreferencial,
          )
        : ([pontoMundoOrigem[0], pontoMundoOrigem[1], pontoMundoOrigem[2]] as Types.Point3);
      s.pontoMiraMundo = pontoAlvo;

      if (s.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && 'jumpToWorld' in s.viewport) {
        s.viewport.jumpToWorld(pontoAlvo);
        s.viewport.render();
        s.overlay.atualizar();
        atualizarMiraSlot(s);
      } else if (s.tipoViewport === Enums.ViewportType.STACK && 'setImageIdIndex' in s.viewport) {
        const idx = indiceCorteMaisProximoDoPonto(s.pilha, pontoAlvo);
        const atualIdx = s.viewport.getCurrentImageIdIndex();
        if (atualIdx !== idx) {
          void s.viewport.setImageIdIndex(idx).then(() => {
            s.viewport?.render();
            s.overlay.atualizar();
            atualizarMiraSlot(s);
          });
        } else {
          atualizarMiraSlot(s);
        }
      }
    }
  } finally {
    sincronizandoRolagemComparar = sincronizandoAnterior;
  }
}

function saltarParaPontoMundo(origemIndice: number, ponto: Types.Point3): void {
  aplicarLocalizador3d(origemIndice, ponto);
}

/**
 * Hot iron: preto, vermelho escuro, vermelho, laranja, amarelo e branco (como em outros
 * visualizadores). Registrado no Cornerstone com este nome.
 */
const NOME_HOT_IRON = 'Hot iron';
utilitariosCore.colormap.registerColormap({
  ColorSpace: 'RGB',
  Name: NOME_HOT_IRON,
  RGBPoints: [
    0, 0, 0, 0,
    0.18, 0.4, 0, 0,
    0.38, 0.9, 0.05, 0,
    0.58, 1, 0.45, 0,
    0.78, 1, 0.92, 0.1,
    1, 1, 1, 0.95,
  ],
} as never);

/** Nomes dos colormaps usados na fusão (Hot iron é o nosso; os demais, do vtk.js). */
const COLORMAPS_FUSAO: Array<[string, string]> = [
  [NOME_HOT_IRON, 'Hot iron (ferro quente)'],
  ['jet', 'Arco-íris (jet)'],
  ['Inverted-Grayscale', 'Cinza invertido'],
  ['Grayscale', 'Cinza'],
];

/** CSS de gradiente (de baixo para cima) do colormap, para a legenda. */
function gradienteDoColormap(nome: string): string {
  const cm = utilitariosCore.colormap.resolveColormap(nome) as { RGBPoints?: number[] } | undefined;
  const pts = cm?.RGBPoints;
  if (!pts || pts.length < 8) return 'linear-gradient(to top, #000, #fff)';
  const paradas: string[] = [];
  for (let i = 0; i + 3 < pts.length; i += 4) {
    const c = [pts[i + 1]!, pts[i + 2]!, pts[i + 3]!].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
    paradas.push(`rgb(${c[0]}, ${c[1]}, ${c[2]}) ${(pts[i]! * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to top, ${paradas.join(', ')})`;
}

function unidadeLegenda(stack: StackNode | null): string {
  const un = stack ? unidadeDaPilha(stack.id) : 'SUVbw';
  return un === 'SUVbw' || un === 'SUL' ? `${un} (g/ml)` : un === 'SUVbsa' ? `${un} (cm²/ml)` : un;
}


/** Aplica opacidade, colormap e teto de SUV ao PET da fusão (independentes da janela da TC). */
function aplicarFusao(slot: Slot, volumeCtId: string, volumePetId: string): void {
  const vp = slot.viewport as Types.IVolumeViewport | undefined;
  if (!vp) return;
  const { opacidade, colormap, teto, minimo } = slot.fusao;
  const piso = Math.min(minimo, teto * 0.9);
  vp.setProperties(
    {
      voiRange: { lower: 0, upper: teto },
      colormap: {
        name: colormap,
        // Fundo (SUV baixo) transparente; a captação aparece com a opacidade escolhida.
        opacity: [
          // Sem SUV mínimo (0): opacidade constante em toda a faixa, como nos visualizadores de PET/CT
          // (fundo escuro-avermelhado em todo o corpo). Com mínimo: transparente abaixo dele e a
          // opacidade sobe até o valor escolhido em ~25% da faixa.
          ...(piso <= 0
            ? [
                { value: 0, opacity: opacidade },
                { value: Math.max(teto, 0.01), opacity: opacidade },
              ]
            : [
                { value: 0, opacity: 0 },
                { value: piso, opacity: 0 },
                { value: piso + (teto - piso) * 0.25, opacity: opacidade },
                { value: Math.max(teto, piso + 0.01), opacity: opacidade },
              ]),
        ],
      },
    },
    volumePetId,
  );
  void volumeCtId;
  corrigirOpacidadePeloSlab(vp);
  slot.atualizarLegendaFusao?.();
  aplicarRegistroPet(slot, volumePetId);
  vp.render();
  // O colormap/opacidade do segundo volume só aparece depois de um render do motor inteiro.
  void iniciarCornerstone().then((m) => m.render());
}

/** Translada o PET sobre a TC (registro manual) deslocando o ator do volume. */
function aplicarRegistroPet(slot: Slot, volumePetId: string): void {
  const vp = slot.viewport as Types.IVolumeViewport | undefined;
  const ator = vp?.getActors().find((a) => a.referencedId === volumePetId)?.actor as
    | { setPosition?: (x: number, y: number, z: number) => void }
    | undefined;
  const d = slot.registro.deslocamento;
  ator?.setPosition?.(d[0], d[1], d[2]);
}

function estudoDaPilha(stack: StackNode): StudyNode | undefined {
  for (const p of estado.resultado?.index.patients ?? []) {
    for (const e of p.studies) {
      if (e.series.some((sr) => sr.stacks.some((st) => st.id === stack.id))) return e;
    }
  }
  return undefined;
}

/** Põe a fusão (TC/RM como base e PET por cima) no slot, trocando as séries se já havia outras. */
async function configurarFusaoNoSlot(
  slot: Slot,
  anatomic: StackNode,
  pet: StackNode,
  sameFrame: boolean,
): Promise<void> {
  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) return;
  const anteriorAtivo = ativo;
  ativo = slot.indice;
  await abrirPilha2d(anatomic); // também solta a fusão anterior do slot
  slot.pilhaFusao = pet;
  slot.idsFusao = adquirirIds(pet, arquivos);
  slot.avisoVolume.hidden = true;
  await definirPlanoSlotAtivo('axial');
  if (!sameFrame) {
    slot.avisoVolume.textContent = '⚠ Fusão manual: séries de referenciais diferentes';
    slot.avisoVolume.hidden = false;
  }
  ativo = anteriorAtivo;
  sincronizar();
}

function criarLegendaFusao(slot: Slot): void {
  // Legenda da escala (como nos visualizadores de PET): opacidade, barra de cores, máx, 0 e unidade.
  slot.legendaFusao?.remove();
  const legenda = document.createElement('div');
  legenda.className = 'legenda-fusao';
  const legOp = document.createElement('div');
  legOp.className = 'leg-op';
  const legCorpo = document.createElement('div');
  legCorpo.className = 'leg-corpo';
  const legBarra = document.createElement('div');
  legBarra.className = 'leg-barra';
  const legRot = document.createElement('div');
  legRot.className = 'leg-rotulos';
  const legMax = document.createElement('span');
  const legMin = document.createElement('span');
  legRot.append(legMax, legMin);
  legCorpo.append(legBarra, legRot);
  const legUn = document.createElement('div');
  legUn.className = 'leg-un';
  legenda.append(legOp, legCorpo, legUn);
  slot.celula.append(legenda);
  slot.legendaFusao = legenda;
  slot.atualizarLegendaFusao = () => {
    const f = slot.fusao;
    const num = (n: number): string => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    legOp.textContent = `${Math.round(f.opacidade * 100)}%`;
    legBarra.style.background = gradienteDoColormap(f.colormap);
    legMax.textContent = num(f.teto);
    legMin.textContent = num(0);
    legUn.textContent = unidadeLegenda(slot.pilhaFusao);
  };
  slot.atualizarLegendaFusao();
}

/**
 * Controles e legenda da fusão. No MPR (`mpr: true`) há uma só barra, no 1º plano, que reaplica o
 * ajuste aos três planos (`alvos`); o registro manual e a troca de séries ficam só na fusão axial.
 */
function montarControlesFusao(
  slot: Slot,
  volumeCtId: string,
  volumePetId: string,
  opcoes: { alvos?: Slot[]; mpr?: boolean } = {},
): void {
  slot.volumesFusao = { ct: volumeCtId, pet: volumePetId };
  criarLegendaFusao(slot);

  const c = slot.controlesFusao;
  c.replaceChildren();
  c.hidden = false;
  const alvos = opcoes.alvos ?? [slot];
  const reaplicar = (): void => {
    for (const a of alvos) aplicarFusao(a, volumeCtId, volumePetId);
  };
  slot.reaplicarFusao = reaplicar;

  const opac = document.createElement('input');
  opac.type = 'range';
  opac.min = '0';
  opac.max = '100';
  opac.value = String(Math.round(slot.fusao.opacidade * 100));
  opac.title = 'Opacidade do PET';
  opac.addEventListener('input', () => {
    slot.fusao.opacidade = Number(opac.value) / 100;
    reaplicar();
  });

  const cor = document.createElement('select');
  cor.title = 'Colormap do PET';
  for (const [v, t] of COLORMAPS_FUSAO) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    cor.append(o);
  }
  cor.value = slot.fusao.colormap;
  cor.addEventListener('change', () => {
    slot.fusao.colormap = cor.value;
    reaplicar();
  });

  const teto = document.createElement('input');
  teto.type = 'number';
  teto.min = '0.5';
  teto.step = '0.5';
  teto.value = String(slot.fusao.teto);
  teto.title = 'Teto de SUV do PET (a janela do PET vai de 0 até aqui)';
  teto.addEventListener('change', () => {
    const v = Number(teto.value.replace(',', '.'));
    if (v > 0) {
      slot.fusao.teto = v;
      reaplicar();
    }
  });

  const minimo = document.createElement('input');
  minimo.type = 'number';
  minimo.min = '0';
  minimo.step = '0.5';
  minimo.value = String(slot.fusao.minimo);
  minimo.title = 'SUV mínimo: abaixo disso o PET fica transparente';
  minimo.addEventListener('change', () => {
    const v = Number(minimo.value.replace(',', '.'));
    if (v >= 0) {
      slot.fusao.minimo = v;
      reaplicar();
    }
  });

  const rot = (t: string, el: HTMLElement): HTMLElement => {
    const l = document.createElement('label');
    l.textContent = t;
    l.append(el);
    return l;
  };
  // Registro manual: arrastar o PET sobre a TC (translação), com o deslocamento em mm.
  const mover = document.createElement('button');
  mover.type = 'button';
  mover.textContent = 'Mover PET';
  mover.title = 'Arraste no viewport para deslocar o PET sobre a TC (corrige movimento do paciente)';
  const leitura = document.createElement('span');
  const restaurar = document.createElement('button');
  restaurar.type = 'button';
  restaurar.textContent = 'Restaurar';
  const atualizarLeitura = (): void => {
    const d = slot.registro.deslocamento;
    const nulo = d[0] === 0 && d[1] === 0 && d[2] === 0;
    leitura.textContent = nulo ? 'Δ 0 mm' : `Δ ${d.map((v) => v.toFixed(1).replace('.', ',')).join(' · ')} mm`;
    restaurar.disabled = nulo;
    mover.setAttribute('aria-pressed', String(slot.registro.ativo));
    slot.celula.classList.toggle('modo-registro', slot.registro.ativo);
  };
  const passoZ = (delta: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = delta > 0 ? 'z+' : 'z−';
    b.title = `Desloca o PET ${Math.abs(delta)} mm na direção cabeça-pés`;
    b.addEventListener('click', () => {
      slot.registro.deslocamento[2] += delta;
      aplicarRegistroPet(slot, volumePetId);
      atualizarLeitura();
      void iniciarCornerstone().then((m) => m.render());
    });
    return b;
  };
  mover.addEventListener('click', () => {
    slot.registro.ativo = !slot.registro.ativo;
    atualizarLeitura();
  });
  restaurar.addEventListener('click', () => {
    slot.registro.deslocamento = [0, 0, 0];
    aplicarRegistroPet(slot, volumePetId);
    atualizarLeitura();
    void iniciarCornerstone().then((m) => m.render());
  });
  atualizarLeitura();
  slot.atualizarLeituraRegistro = atualizarLeitura;
  // Escolha das séries da fusão (as candidatas do estudo): PET e TC/RM.
  const estudo = slot.pilha ? estudoDaPilha(slot.pilha) : undefined;
  const pares = estudo ? findFusionCandidates(estudo) : [];
  const unicos = (pegar: (c: FusionCandidate) => StackNode): StackNode[] => {
    const m = new Map<string, StackNode>();
    for (const c of pares) m.set(pegar(c).id, pegar(c));
    return [...m.values()];
  };
  const seletorSerie = (rotulo: string, opcoes: StackNode[], atual: string | undefined, aoEscolher: (st: StackNode) => void): HTMLElement => {
    const sel = document.createElement('select');
    sel.title = rotulo;
    for (const st of opcoes) {
      const o = document.createElement('option');
      o.value = st.id;
      const n = st.instances.length;
      o.textContent = `${nomeDaSerie(st)} (${n})`;
      sel.append(o);
    }
    if (atual) sel.value = atual;
    sel.disabled = opcoes.length < 2;
    sel.addEventListener('change', () => {
      const st = opcoes.find((x) => x.id === sel.value);
      if (st) aoEscolher(st);
    });
    return rot(`${rotulo} `, sel);
  };
  const trocarSeries = (pet: StackNode, anat: StackNode): void => {
    const par = pares.find((c) => c.pet.id === pet.id && c.anatomic.id === anat.id);
    void configurarFusaoNoSlot(slot, anat, pet, par ? par.sameFrame : false);
  };
  const seriesFusao = document.createElement('div');
  seriesFusao.className = 'series-fusao';
  seriesFusao.append(
    seletorSerie('PET', unicos((c) => c.pet), slot.pilhaFusao?.id, (st) => slot.pilha && trocarSeries(st, slot.pilha)),
    seletorSerie('TC/RM', unicos((c) => c.anatomic), slot.pilha?.id, (st) => slot.pilhaFusao && trocarSeries(slot.pilhaFusao, st)),
  );

  const painel = document.createElement('div');
  painel.className = 'painel-fusao';
  painel.hidden = true;
  if (opcoes.mpr) painel.append(rot('PET ', opac), rot('', cor), rot('SUV mín ', minimo), rot('máx ', teto));
  else painel.append(seriesFusao, rot('PET ', opac), rot('', cor), rot('SUV mín ', minimo), rot('máx ', teto), mover, passoZ(-2), passoZ(2), leitura, restaurar);
  const abrir = document.createElement('button');
  abrir.type = 'button';
  abrir.className = 'btn-fusao';
  abrir.textContent = '⚙ Fusão';
  abrir.title = 'Opacidade, colormap, SUV mín/máx e ajuste do registro do PET';
  abrir.addEventListener('click', () => {
    painel.hidden = !painel.hidden;
  });
  c.append(abrir, painel);
}

function salvarEstadoVisualSlot(slot: Slot): {
  corte?: number;
  voiPreservado?: { voiRange?: { lower: number; upper: number }; invert?: boolean };
} {
  const propsAtuais = slot.viewport?.getProperties();
  const voiPreservado = propsAtuais
    ? { voiRange: propsAtuais.voiRange, invert: propsAtuais.invert }
    : undefined;
  if (slot.tipoViewport === Enums.ViewportType.STACK && slot.viewport && 'getCurrentImageIdIndex' in slot.viewport) {
    try {
      slot.corteSalvo = slot.viewport.getCurrentImageIdIndex();
    } catch {
      /* mantém corteSalvo anterior */
    }
  }
  return { corte: slot.corteSalvo, voiPreservado };
}

/**
 * Mostra no slot a pilha que ele já tem:
 * - Se `precisaVolumeViewport(slot)` for falso, abre em `STACK` 2D.
 * - Se o slot tiver plano reconstruído (`axial`, `coronal`, `sagital`, `mip-rotatorio`) ou usar
 *   projeção de slab (`mip`, `minip`, `media`, ou `slabMm > 1` mesmo no plano `original`),
 *   monta um `ORTHOGRAPHIC` (`VolumeViewport`) apenas neste slot, mantendo os demais intactos.
 */
async function exibirSlot(
  slot: Slot,
  corteInicial?: number,
  voiPreservado?: { voiRange?: { lower: number; upper: number }; invert?: boolean },
): Promise<void> {
  const stack = slot.pilha;
  if (!stack) return;
  if (!emFusao(slot)) ocultarFusaoVisual(slot);
  const minhaGeracao = ++slot.geracao;
  const nome = nomeDaSerie(stack);
  const ids = slot.ids;

  // Garante a aquisição/validação do volume para a pilha deste slot.
  let promessaVolume: Promise<Types.IImageVolume | Types.IStreamingImageVolume> | undefined;
  let volumeId: string | undefined;
  if (slot.volumePilhaId !== stack.id) {
    const res = adquirirVolume(stack, ids);
    if (res.ok) {
      slot.volumePilhaId = stack.id;
      volumeId = res.volumeId;
      promessaVolume = res.promessa;
      esconderAvisoVolume(slot);
      res.promessa.catch((err) => {
        if (minhaGeracao !== slot.geracao) return;
        mostrarAvisoVolume(slot, [
          `Não foi possível montar o volume (${textoDoErro(err)}); mantendo apenas 2D.`,
        ]);
      });
    } else {
      slot.volumePilhaId = null;
      slot.planoSlot = 'original';
      slot.modoSlab = 'normal';
      slot.slabMm = 1;
      mostrarAvisoVolume(slot, res.mensagens);
    }
  } else {
    const res = adquirirVolume(stack, ids);
    if (res.ok) {
      // Desfaz o incremento extra de refs pois o slot já era dono de uma referência.
      liberarVolume(stack.id);
      volumeId = res.volumeId;
      promessaVolume = res.promessa;
    }
  }

  // Modo de volume individual no slot (sem ir para a janela de 3 planos do MPR):
  if (precisaVolumeViewport(slot) && volumeId && promessaVolume) {
    const infoPlano = PLANOS_SLOTS[slot.planoSlot];
    slot.montandoVolume = true;
    mostrarMensagem(slot, `Reconstruindo ${infoPlano.rotulo} de ${nome}…`);
    sincronizar();
    try {
      const motor = await iniciarCornerstone();
      const vp = await garantirViewportMpr(slot, infoPlano);
      slot.montandoVolume = true;
      if (minhaGeracao !== slot.geracao) return;

      await promessaVolume;
      if (minhaGeracao !== slot.geracao) return;

      const entradas: Array<{ volumeId: string }> = [{ volumeId }];
      let volumePetId: string | undefined;
      if (emFusao(slot) && slot.pilhaFusao) {
        // O PET entra como segundo volume do mesmo viewport; a GPU reamostra pela geometria de cada um.
        const resPet = adquirirVolume(slot.pilhaFusao, slot.idsFusao);
        if (!resPet.ok) throw new Error(`PET: ${resPet.mensagens.join(' · ')}`);
        if (slot.volumeFusaoId === slot.pilhaFusao.id) liberarVolume(slot.pilhaFusao.id);
        else slot.volumeFusaoId = slot.pilhaFusao.id;
        await resPet.promessa;
        if (minhaGeracao !== slot.geracao) return;
        volumePetId = resPet.volumeId;
        entradas.push({ volumeId: volumePetId });
      }

      await setVolumesForViewports(motor, entradas, [slot.idViewport], true);
      if (minhaGeracao !== slot.geracao) return;
      if (volumePetId) {
        montarControlesFusao(slot, volumeId, volumePetId);
        aplicarFusao(slot, volumeId, volumePetId);
      }

      if (slot.planoSlot === 'original' && corteInicial !== undefined) {
        const pos = stack.instances[corteInicial]?.imagePositionPatient;
        if (pos) {
          vp.jumpToWorld([pos[0], pos[1], pos[2]]);
        }
      }

      const pet = voiPreservado || emFusao(slot) ? null : exibicaoPadraoPet(stack);
      const voi = voiPreservado?.voiRange ?? pet?.voiRange ?? voiPadraoDaPilha(stack);
      if (voi) vp.setProperties({ voiRange: voi, invert: voiPreservado?.invert ?? pet?.invert });
      else if (pet) vp.setProperties({ invert: true });

      if (slot.planoSlot === 'mip-rotatorio') {
        aplicarCameraMipRotatorio(vp, 0);
        slot.controladorMip = criarControladorMipRotatorio({
          elemento: slot.elemento,
          controles: slot.controlesMip,
          obterViewport: () =>
            slot.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC
              ? (slot.viewport as Types.IVolumeViewport | undefined)
              : undefined,
          aoClicarPontoMaisIntenso: (ponto) => saltarParaPontoMundo(slot.indice, ponto),
          iniciarGirando: true,
        });
      } else {
        aplicarSlabAoViewport(vp, slot.modoSlab, slot.slabMm);
        vp.render();
      }

      slot.montandoVolume = false;
      esconderMensagem(slot);
      slot.overlay.atualizar();
      sincronizar();

      const meio = Math.floor(ids.length / 2);
      void carregarRestante(slot, ids, ordemDoMeio(ids.length, meio), minhaGeracao);
      return;
    } catch (e) {
      slot.montandoVolume = false;
      if (minhaGeracao !== slot.geracao) return;
      slot.planoSlot = 'original';
      slot.modoSlab = 'normal';
      slot.slabMm = 1;
      mostrarAvisoVolume(slot, [
        `Não foi possível reconstruir ${infoPlano.rotulo} (${textoDoErro(e)}); voltando ao corte original.`,
      ]);
    } finally {
      if (minhaGeracao === slot.geracao) {
        slot.montandoVolume = false;
      }
    }
  }

  mostrarMensagem(slot, `Carregando ${nome}…`);
  sincronizar();
  try {
    const viewport = await garantirViewport2d(slot);
    if (minhaGeracao !== slot.geracao) return;

    const inicial = Math.min(Math.max(corteInicial ?? Math.floor(ids.length / 2), 0), ids.length - 1);
    await imageLoader.loadAndCacheImage(ids[inicial]!);
    if (minhaGeracao !== slot.geracao) return;
    await viewport.setStack(ids, inicial);
    if (voiPreservado?.voiRange) {
      viewport.setProperties({ voiRange: voiPreservado.voiRange, invert: voiPreservado.invert });
    } else {
      // Série nova: PET entra invertido e com janela em SUV; o zoom se ajusta ao conteúdo.
      const pet = exibicaoPadraoPet(stack);
      if (pet) viewport.setProperties({ invert: true, ...(pet.voiRange ? { voiRange: pet.voiRange } : {}) });
      ajustarZoomAoConteudo(viewport, ids[inicial]!, stack.instances[0]?.modality);
    }
    viewport.render();
    slot.overlay.atualizar();
    esconderMensagem(slot);
    sincronizar();

    void carregarRestante(slot, ids, ordemDoMeio(ids.length, inicial), minhaGeracao);
  } catch (e) {
    if (minhaGeracao !== slot.geracao) return;
    mostrarMensagem(slot, `Não foi possível abrir a série ${nome}`, textoDoErro(e), true);
  }
}

/**
 * Muda apenas o plano do viewport ativo ('original', 'axial', 'coronal', 'sagital' ou 'mip-rotatorio')
 * mantendo os demais viewports da grade (ex.: 2x2) intactos.
 */
export async function definirPlanoSlotAtivo(plano: PlanoSlot): Promise<void> {
  if (mprAtivo) return;
  const slot = slots[ativo];
  if (!slot?.pilha || slot.planoSlot === plano) return;

  if (plano !== 'original') {
    const av = avaliarVolume(slot.pilha);
    if (!av.ok) {
      mostrarAvisoVolume(slot, av.mensagens);
      sincronizar();
      return;
    }
  }

  pararCine(slot.indice);
  const { corte, voiPreservado } = salvarEstadoVisualSlot(slot);
  slot.planoSlot = plano;
  await exibirSlot(slot, corte, voiPreservado);
}

/**
 * Botão MIP 3D: abre ou fecha rapidamente uma janela de MIP rotatório ao lado do corte 2D:
 * - Se estiver em 1x1 com uma série volumétrica, muda para 1x2 mantendo o corte 2D à esquerda
 *   e abrindo o MIP rotatório à direita (clicar nas lesões do MIP leva o corte 2D ao ponto).
 * - Se já houver um MIP rotatório no layout 1x2 ao lado da mesma série, fecha-o e volta para 1x1.
 * - Nos demais layouts (ou no MPR), alterna o slot ativo entre 'mip-rotatorio' e 'original'.
 */
export async function alternarMipRotatorio(): Promise<void> {
  if (mprAtivo) {
    await sairDoMpr('1x2');
  }

  const slot0 = slots[0];
  const slot1 = slots[1];
  const slotAtivo = slots[ativo] ?? slot0;
  const stack = slotAtivo?.pilha ?? slot0?.pilha ?? null;
  const arquivos = estado.resultado?.arquivos;
  if (!stack || !arquivos) return;

  const av = avaliarVolume(stack);
  if (!av.ok) {
    if (slotAtivo) mostrarAvisoVolume(slotAtivo, av.mensagens);
    sincronizar();
    return;
  }

  // Se estamos em 1x2 e o slot 1 já é o MIP rotatório da mesma série, fecha e volta para 1x1:
  if (
    layoutAtual === '1x2' &&
    slot1?.planoSlot === 'mip-rotatorio' &&
    slot0?.pilha?.id === stack.id &&
    slot1?.pilha?.id === stack.id
  ) {
    slot1.planoSlot = 'original';
    ativo = 0;
    await definirLayout('1x1');
    return;
  }

  // Se estamos em 1x1, abre 1x2 com [Corte 2D | MIP rotatório]:
  if (layoutAtual === '1x1' && slot0 && slot1) {
    if (slot0.planoSlot === 'mip-rotatorio') {
      await definirPlanoSlotAtivo('original');
      return;
    }
    const anterior1 = slot1.pilha?.id;
    const volAnterior1 = slot1.volumePilhaId;
    slot1.ids = adquirirIds(stack, arquivos);
    slot1.pilha = stack;
    slot1.planoSlot = 'mip-rotatorio';
    slot1.modoSlab = 'normal';
    slot1.slabMm = 1;
    slot1.volumePilhaId = null;
    if (volAnterior1) liberarVolume(volAnterior1);
    liberarIds(anterior1);
    await definirLayout('1x2');
    return;
  }

  // Em 1x2 ou 2x2: alterna o slot ativo entre MIP rotatório e Original
  if (slotAtivo) {
    const novoPlano: PlanoSlot =
      slotAtivo.planoSlot === 'mip-rotatorio' ? 'original' : 'mip-rotatorio';
    await definirPlanoSlotAtivo(novoPlano);
  }
}

/**
 * Muda o modo de projeção do slab ('normal', 'mip', 'minip' ou 'media') no viewport ativo
 * (ou nos 3 planos quando no modo MPR), funcionando inclusive no plano 'original' sem
 * precisar ir para a janela do MPR.
 */
export async function definirModoSlabAtivo(modo: ModoSlab): Promise<void> {
  if (mprAtivo) {
    modoSlabMpr = modo;
    if (modo !== 'normal' && slabMprMm <= 1) slabMprMm = 10;
    else if (modo === 'normal') slabMprMm = 1;
    for (let i = 0; i < 3; i++) {
      const s = slots[i];
      const vp = s?.viewport;
      if (vp && s?.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && 'setSlabThickness' in vp) {
        s.modoSlab = modoSlabMpr;
        s.slabMm = slabMprMm;
        aplicarSlabAoViewport(vp, modoSlabMpr, slabMprMm);
        vp.render();
        s.overlay.atualizar();
      }
    }
    sincronizar();
    return;
  }

  const slot = slots[ativo];
  if (!slot?.pilha || slot.modoSlab === modo) return;

  if (modo !== 'normal') {
    const av = avaliarVolume(slot.pilha);
    if (!av.ok) {
      mostrarAvisoVolume(slot, av.mensagens);
      sincronizar();
      return;
    }
  }

  slot.modoSlab = modo;
  if (modo !== 'normal' && slot.slabMm <= 1) {
    slot.slabMm = 10;
  } else if (modo === 'normal') {
    slot.slabMm = 1;
  }

  if (slot.montandoVolume) {
    sincronizar();
    return;
  }

  if (slot.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && slot.viewport && 'setSlabThickness' in slot.viewport) {
    aplicarSlabAoViewport(slot.viewport, slot.modoSlab, slot.slabMm);
    slot.viewport.render();
    slot.overlay.atualizar();
    sincronizar();
    return;
  }

  pararCine(slot.indice);
  const { corte, voiPreservado } = salvarEstadoVisualSlot(slot);
  await exibirSlot(slot, corte, voiPreservado);
}

/** Solta o PET da fusão deste slot (volume e arquivos). */
function soltarFusao(slot: Slot): void {
  if (slot.fusaoCompartilhada) {
    slot.volumeFusaoId = null;
    slot.pilhaFusao = null;
    slot.idsFusao = [];
    slot.fusaoCompartilhada = false;
  }
  if (slot.volumeFusaoId) {
    liberarVolume(slot.volumeFusaoId);
    slot.volumeFusaoId = null;
  }
  if (slot.pilhaFusao) liberarIds(slot.pilhaFusao.id);
  slot.pilhaFusao = null;
  slot.idsFusao = [];
  slot.reaplicarFusao = undefined;
  slot.legendaFusao?.remove();
  slot.legendaFusao = undefined;
  slot.atualizarLegendaFusao = undefined;
  slot.zoomFusaoAjustado = false;
  slot.volumesFusao = undefined;
  slot.registro = { ativo: false, deslocamento: [0, 0, 0] };
  slot.controlesFusao.hidden = true;
  slot.controlesFusao.replaceChildren();
}

function liberarRecursosSlot(slot: Slot): void {
  soltarFusao(slot);
  if (slot.volumePilhaId) {
    liberarVolume(slot.volumePilhaId);
    slot.volumePilhaId = null;
  }
  esconderAvisoVolume(slot);
  liberarIds(slot.pilha?.id);
  slot.pilha = null;
  slot.planoSlot = 'original';
  slot.modoSlab = 'normal';
  slot.slabMm = 1;
  slot.montandoVolume = false;
  slot.ids = [];
  slot.pontoMiraMundo = null;
  desenharMiraNoCanvas(slot.canvasMira, null);
}

// ---------- MPR (Axial, Coronal, Sagital) e Slab ----------

/**
 * Ajusta a espessura de slab (mm) nos três planos do MPR ou apenas no slot ativo
 * da grade (1x1, 1x2, 2x2). Se o slot ativo ainda estava em STACK 2D no plano Original,
 * converte-o automaticamente para VolumeViewport em tempo real.
 */
export function definirSlabMpr(mm: number): void {
  if (!Number.isFinite(mm)) return;
  const mmNovo = Math.max(0.5, Math.min(50, Math.round(mm * 2) / 2));
  if (mprAtivo) {
    slabMprMm = mmNovo;
    for (let i = 0; i < 3; i++) {
      const slot = slots[i];
      const vp = slot?.viewport;
      if (vp && slot?.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && 'setSlabThickness' in vp) {
        slot.slabMm = slabMprMm;
        aplicarSlabAoViewport(vp, modoSlabMpr, slabMprMm);
        vp.render();
        slot.overlay.atualizar();
      }
    }
    sincronizar();
    return;
  }

  const slot = slots[ativo];
  if (!slot?.pilha) return;
  if (mmNovo > 1 && !avaliarVolume(slot.pilha).ok) return;

  slot.slabMm = mmNovo;
  if (slot.montandoVolume) {
    sincronizar();
    return;
  }

  const vp = slot.viewport;
  if (vp && slot.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && 'setSlabThickness' in vp) {
    aplicarSlabAoViewport(vp, slot.modoSlab, slot.slabMm);
    vp.render();
    slot.overlay.atualizar();
    sincronizar();
    return;
  }

  if (slot.slabMm > 1 && slot.tipoViewport === Enums.ViewportType.STACK && slot.habilitado) {
    pararCine(slot.indice);
    const { corte, voiPreservado } = salvarEstadoVisualSlot(slot);
    void exibirSlot(slot, corte, voiPreservado);
    return;
  }
  sincronizar();
}

async function montarLayoutMpr(
  stack: StackNode,
  fusaoMpr?: { pet: StackNode; config: Slot['fusao'] },
): Promise<void> {
  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) return;

  const resAvaliacao = avaliarVolume(stack);
  if (!resAvaliacao.ok) {
    const slotAtivo = slots[ativo] ?? slots[0];
    if (slotAtivo) mostrarAvisoVolume(slotAtivo, resAvaliacao.mensagens);
    return;
  }

  const minhaGeracaoMpr = ++geracaoMpr;
  pararTodosCines();

  let ids: string[];
  try {
    ids = adquirirIds(stack, arquivos);
  } catch (e) {
    const slotAtivo = slots[ativo] ?? slots[0];
    if (slotAtivo) {
      mostrarMensagem(slotAtivo, `Não foi possível abrir a série ${nomeDaSerie(stack)}`, textoDoErro(e), true);
    }
    return;
  }

  const resVol = adquirirVolume(stack, ids);
  if (!resVol.ok) {
    liberarIds(stack.id);
    const slotAtivo = slots[ativo] ?? slots[0];
    if (slotAtivo) mostrarAvisoVolume(slotAtivo, resVol.mensagens);
    return;
  }

  // Fusão no MPR: o PET entra como 2º volume dos três planos (um só volume, uma só referência).
  let idsPet: string[] | undefined;
  let resPet: ReturnType<typeof adquirirVolume> | undefined;
  if (fusaoMpr) {
    try {
      idsPet = adquirirIds(fusaoMpr.pet, arquivos);
      resPet = adquirirVolume(fusaoMpr.pet, idsPet);
      if (!resPet.ok) {
        liberarIds(fusaoMpr.pet.id);
        idsPet = undefined;
        resPet = undefined;
        const slotAtivo = slots[ativo] ?? slots[0];
        if (slotAtivo) mostrarAvisoVolume(slotAtivo, ['PET sem volume: o MPR abre só com a TC.']);
      }
    } catch {
      idsPet = undefined;
      resPet = undefined;
    }
  }

  if (!mprAtivo) {
    estadoAntesDoMpr = slots.map((s) => ({
      pilha: s.pilha,
      planoSlot: s.planoSlot,
      modoSlab: s.modoSlab,
      slabMm: s.slabMm,
      pilhaFusao: s.pilhaFusao,
      fusao: { ...s.fusao },
      corte:
        s.tipoViewport === Enums.ViewportType.STACK && s.viewport && 'getCurrentImageIdIndex' in s.viewport
          ? s.viewport.getCurrentImageIdIndex()
          : s.corteSalvo,
    }));
  }

  mprAtivo = true;
  if (ativo >= 3) ativo = 0;

  for (let i = 0; i < MAX_VIEWPORTS; i++) {
    const s = slots[i]!;
    s.geracao++;
    await desabilitar(s);
    liberarRecursosSlot(s);
    s.celula.hidden = i >= 3;
  }

  const planosNomes: PlanoSlot[] = ['axial', 'coronal', 'sagital'];
  slots[0]!.pilha = stack;
  slots[0]!.ids = ids;
  slots[0]!.volumePilhaId = stack.id;
  slots[0]!.planoSlot = planosNomes[0]!;
  slots[0]!.modoSlab = modoSlabMpr;
  slots[0]!.slabMm = slabMprMm;
  for (let i = 1; i < 3; i++) {
    slots[i]!.pilha = stack;
    slots[i]!.ids = ids;
    slots[i]!.volumePilhaId = null;
    slots[i]!.planoSlot = planosNomes[i]!;
    slots[i]!.modoSlab = modoSlabMpr;
    slots[i]!.slabMm = slabMprMm;
  }

  if (fusaoMpr && idsPet && resPet?.ok) {
    for (let i = 0; i < 3; i++) {
      const sl = slots[i]!;
      sl.pilhaFusao = fusaoMpr.pet;
      sl.idsFusao = idsPet;
      sl.fusao = i === 0 ? fusaoMpr.config : slots[0]!.fusao;
      sl.fusaoCompartilhada = i > 0;
    }
    slots[0]!.volumeFusaoId = fusaoMpr.pet.id; // o 1º plano guarda a referência do volume do PET
    mprComFusao = true;
  } else if (!mprAtivo || estadoAntesDoMpr.length === 0) {
    mprComFusao = false;
  }

  grade.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  grade.style.gridTemplateRows = 'minmax(0, 1fr)';

  const nome = nomeDaSerie(stack);
  for (let i = 0; i < 3; i++) {
    mostrarMensagem(slots[i]!, `Montando MPR (${PLANOS_MPR[i]!.rotulo}) de ${nome}…`);
  }
  sincronizar();

  try {
    const motor = await iniciarCornerstone();
    if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;

    const vps: Types.IVolumeViewport[] = [];
    for (let i = 0; i < 3; i++) {
      const vp = await garantirViewportMpr(slots[i]!, PLANOS_MPR[i]!);
      vps.push(vp);
    }
    if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;

    await resVol.promessa;
    if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;

    const idsViewports = [slots[0]!.idViewport, slots[1]!.idViewport, slots[2]!.idViewport];
    const entradas = [{ volumeId: resVol.volumeId }];
    if (resPet?.ok) {
      await resPet.promessa;
      if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;
      entradas.push({ volumeId: resPet.volumeId });
    }
    await setVolumesForViewports(motor, entradas, idsViewports, true);
    if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;
    if (resPet?.ok) {
      for (let i = 0; i < 3; i++) {
        const sl = slots[i]!;
        sl.volumesFusao = { ct: resVol.volumeId, pet: resPet.volumeId };
        if (i === 0) montarControlesFusao(sl, resVol.volumeId, resPet.volumeId, { alvos: [slots[0]!, slots[1]!, slots[2]!], mpr: true });
        else criarLegendaFusao(sl);
        aplicarFusao(sl, resVol.volumeId, resPet.volumeId);
      }
    }

    const voiInicial = voiPadraoDaPilha(stack);

    for (let i = 0; i < 3; i++) {
      const vp = vps[i]!;
      if (voiInicial) vp.setProperties({ voiRange: voiInicial });
      aplicarSlabAoViewport(vp, modoSlabMpr, slabMprMm);
      vp.render();
      esconderMensagem(slots[i]!);
      slots[i]!.overlay.atualizar();
    }

    definirModoMprFerramentas(true);
    sincronizar();

    const meio = Math.floor(ids.length / 2);
    void carregarRestante(slots[0]!, ids, ordemDoMeio(ids.length, meio), slots[0]!.geracao);
  } catch (e) {
    if (minhaGeracaoMpr !== geracaoMpr) return;
    for (let i = 0; i < 3; i++) {
      mostrarMensagem(slots[i]!, `Erro ao montar MPR de ${nome}`, textoDoErro(e), true);
    }
  }
}

async function sairDoMpr(novoLayout?: Layout): Promise<void> {
  desmaximizar();
  if (!mprAtivo) return;
  geracaoMpr++;
  mprAtivo = false;
  definirModoMprFerramentas(false);

  const stackPrincipal = slots[0]?.pilha ?? null;
  const comFusao = mprComFusao;
  mprComFusao = false;
  const salvas = estadoAntesDoMpr;
  estadoAntesDoMpr = [];

  for (let i = 0; i < 3; i++) {
    const s = slots[i]!;
    await desabilitar(s);
    if (i === 0) {
      liberarRecursosSlot(s);
    } else {
      soltarFusao(s); // planos 2 e 3 do MPR: só limpam a fusão compartilhada
      s.pilha = null;
      s.planoSlot = 'original';
      s.modoSlab = 'normal';
      s.slabMm = 1;
      s.ids = [];
      s.volumePilhaId = null;
    }
  }

  const destino = novoLayout ?? layoutAtual;
  layoutAtual = destino;
  const { colunas, linhas } = geometriaLayout(destino);
  const quantidade = colunas * linhas;
  grade.style.gridTemplateColumns = `repeat(${colunas}, minmax(0, 1fr))`;
  grade.style.gridTemplateRows = `repeat(${linhas}, minmax(0, 1fr))`;

  for (const slot of slots) {
    slot.celula.hidden = slot.indice >= quantidade;
  }
  if (ativo >= quantidade) ativo = 0;

  const arquivos = estado.resultado?.arquivos;
  if (arquivos) {
    for (let i = 0; i < quantidade; i++) {
      const s = slots[i]!;
      const restaurada =
        i === 0 && !comFusao ? (stackPrincipal ?? salvas[0]?.pilha ?? null) : (salvas[i]?.pilha ?? null);
      const corte = salvas[i]?.corte;
      const plano = salvas[i]?.planoSlot ?? 'original';
      const modo = salvas[i]?.modoSlab ?? 'normal';
      const slab = salvas[i]?.slabMm ?? 1;
      if (restaurada) {
        try {
          s.ids = adquirirIds(restaurada, arquivos);
          s.pilha = restaurada;
          if (salvas[i]?.pilhaFusao) {
            s.pilhaFusao = salvas[i]!.pilhaFusao!;
            s.idsFusao = adquirirIds(s.pilhaFusao, arquivos);
            if (salvas[i]!.fusao) s.fusao = salvas[i]!.fusao!;
          }
          s.planoSlot = plano;
          s.modoSlab = modo;
          s.slabMm = slab;
          s.corteSalvo = corte;
          void exibirSlot(s, corte);
        } catch {
          mostrarMensagem(s, 'Escolha uma série no painel.');
        }
      } else {
        mostrarMensagem(s, 'Escolha uma série no painel.');
      }
    }
  }
  sincronizar();
}

/** Botão MPR / tecla R: entra ou sai do modo MPR para a série ativa. */
export async function alternarMpr(): Promise<void> {
  desmaximizar();
  if (compararAtivo) {
    desativarComparacaoInterno();
  }
  if (mprAtivo) {
    await sairDoMpr();
    return;
  }
  // Se há uma fusão PET/TC no layout (de preferência a do viewport ativo), o MPR leva o PET junto.
  const fonte =
    slots[ativo] && emFusao(slots[ativo]!)
      ? slots[ativo]
      : slots.find((s) => !s.celula.hidden && emFusao(s));
  const stack = fonte?.pilha ?? slots[ativo]?.pilha ?? slots[0]?.pilha ?? null;
  if (!stack) return;
  await montarLayoutMpr(stack, fonte?.pilhaFusao ? { pet: fonte.pilhaFusao, config: { ...fonte.fusao } } : undefined);
}

// ---------- Modo Comparar (Fase 4: 4.1, 4.2 e 4.3) ----------

function esconderAvisoCobertura(slot: Slot): void {
  slot.avisoCobertura.hidden = true;
}

function mostrarAvisoCobertura(slot: Slot, foraDaCobertura: boolean): void {
  slot.avisoCobertura.hidden = !foraDaCobertura;
}

function atualizarEtiquetasComparacao(): void {
  if (mprAtivo) {
    for (const s of slots) {
      s.etiquetaComparacao.hidden = true;
      s.etiquetaComparacao.replaceChildren();
      esconderAvisoCobertura(s);
    }
    return;
  }

  if (!compararAtivo) {
    for (const s of slots) {
      esconderAvisoCobertura(s);
    }
  }

  const quantidadeVisivel = geometriaLayout(layoutAtual).colunas * geometriaLayout(layoutAtual).linhas;
  const pilhasVisiveis = slots
    .slice(0, quantidadeVisivel)
    .map((s) => (s.celula.hidden ? null : s.pilha));
  const rotulos = calcularRotulosParaSlots(pilhasVisiveis, compararAtivo);

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    const r = i < quantidadeVisivel ? rotulos[i] : null;
    s.etiquetaComparacao.replaceChildren();
    if (!r) {
      s.etiquetaComparacao.hidden = true;
      continue;
    }

    const linhaPrincipal = document.createElement('div');
    linhaPrincipal.className = 'linha-etiqueta-comparar';

    const selo = document.createElement('span');
    selo.className = `selo-comparar ${r.papel === 'ATUAL' ? 'atual' : 'anterior'}`;
    selo.textContent = r.papel;

    const data = document.createElement('span');
    data.className = 'data-comparar';
    data.textContent = r.dataFormatada;

    linhaPrincipal.append(selo, data);
    s.etiquetaComparacao.append(linhaPrincipal);

    if (r.avisoPaciente) {
      const alerta = document.createElement('div');
      alerta.className = 'alerta-paciente-diferente';
      alerta.textContent = '⚠ Paciente diferente (nome/ID)';
      alerta.title = r.avisoPaciente;
      s.etiquetaComparacao.append(alerta);
    }

    s.etiquetaComparacao.hidden = false;
  }
}

/**
 * Padrão da sincronia ao formar o par: se os dois lados são do mesmo estudo, zoom e pan ficam
 * ligados (e a rolagem por posição, que já é o padrão); a janela só quando a modalidade é a mesma
 * (PET em SUV e TC em HU não compartilham janela). Estudos diferentes: tudo como antes.
 */
function definirPadroesSincroniaComparar(): void {
  const a = slots[0]?.pilha ?? null;
  const b = slots[1]?.pilha ?? null;
  const mesmo = mesmoEstudo(a, b);
  zoomPanCompararLigado = mesmo;
  janelaCompararLigada = mesmo && mesmaModalidade(a, b);
}

function atualizarSincronizadoresCornerstoneComparar(): void {
  if (!compararAtivo) {
    destruirSincronizadoresComparacao();
    return;
  }
  sincronizarParCornerstone(ID_MOTOR, [idViewport(0), idViewport(1)], {
    janela: janelaCompararLigada,
    zoomPan: zoomPanCompararLigado,
  });
}

function recalcularVinculoInicialComparacao(): void {
  if (!compararAtivo) return;
  const s0 = slots[0];
  const s1 = slots[1];
  if (!s0 || !s1) return;
  esconderAvisoCobertura(s0);
  esconderAvisoCobertura(s1);

  const res = criarVinculoComparacao(s0.pilha, s1.pilha);
  linkRolagemComparar = res.link;
  erroVinculoComparar = res.erro?.message ?? null;
  if (res.erro) {
    rolagemCompararLigada = false;
    mostrarAvisoVolume(s1, [res.erro.message]);
  } else {
    esconderAvisoVolume(s1);
  }
  sincronizar();
  if (rolagemCompararLigada && linkRolagemComparar) {
    aoRolarSlotComparar(0);
  }
}

function aoRolarSlotComparar(origemIndice: number): void {
  if (!compararAtivo || !rolagemCompararLigada || !linkRolagemComparar || sincronizandoRolagemComparar) {
    return;
  }
  if (origemIndice !== 0 && origemIndice !== 1) return;
  const destinoIndice = origemIndice === 0 ? 1 : 0;
  const slotOrigem = slots[origemIndice];
  const slotDestino = slots[destinoIndice];
  if (
    !slotOrigem?.pilha ||
    !slotOrigem.viewport ||
    !slotDestino?.pilha ||
    !slotDestino.viewport ||
    !slotDestino.habilitado
  ) {
    return;
  }

  const posOrigem = obterPosicaoCorteAtual(slotOrigem.pilha, slotOrigem.viewport);
  if (posOrigem === undefined) return;

  const sincronizado = calcularCorteSincronizado(
    linkRolagemComparar,
    origemIndice,
    posOrigem,
    slotDestino.pilha,
  );
  if (!sincronizado) return;

  esconderAvisoCobertura(slotOrigem);
  mostrarAvisoCobertura(slotDestino, sincronizado.outOfRange);

  sincronizandoRolagemComparar = true;
  const vpDestino = slotDestino.viewport;
  if (slotDestino.tipoViewport === Enums.ViewportType.STACK && 'setImageIdIndex' in vpDestino) {
    const atualIdx = vpDestino.getCurrentImageIdIndex();
    if (atualIdx !== sincronizado.index) {
      void vpDestino
        .setImageIdIndex(sincronizado.index)
        .then(() => {
          vpDestino.render();
          slotDestino.overlay.atualizar();
        })
        .finally(() => {
          sincronizandoRolagemComparar = false;
        });
      return;
    }
    sincronizandoRolagemComparar = false;
    return;
  }

  try {
    if (
      slotDestino.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC &&
      'jumpToWorld' in vpDestino
    ) {
      const instAlvo = slotDestino.pilha.instances[sincronizado.index];
      const posMundo = instAlvo?.imagePositionPatient;
      if (posMundo) {
        vpDestino.jumpToWorld([posMundo[0], posMundo[1], posMundo[2]]);
        vpDestino.render();
        slotDestino.overlay.atualizar();
      }
    }
  } finally {
    sincronizandoRolagemComparar = false;
  }
}

function desativarComparacaoInterno(): void {
  if (!compararAtivo) return;
  compararAtivo = false;
  linkRolagemComparar = null;
  erroVinculoComparar = null;
  destruirSincronizadoresComparacao();
  atualizarEtiquetasComparacao();
}

/** Entra ou sai do modo Comparar (4.1, 4.2, 4.3). */
export async function alternarModoComparar(): Promise<void> {
  if (compararAtivo) {
    desativarComparacaoInterno();
    sincronizar();
    return;
  }

  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) return;

  if (mprAtivo) {
    await sairDoMpr('1x2');
  }

  compararAtivo = true;
  rolagemCompararLigada = true;
  erroVinculoComparar = null;

  const s0 = slots[0]!;
  const s1 = slots[1]!;

  // Se ainda não temos duas pilhas abertas nos slots 0 e 1, preenche automaticamente
  // a partir do índice (ex.: TC atual e TC anterior do phantom):
  if (!s0.pilha || !s1.pilha || s0.pilha.id === s1.pilha.id) {
    const [p0, p1] = escolherParInicialComparacao(
      estado.resultado?.index,
      slots[ativo]?.pilha ?? s0.pilha,
    );
    if (p0 && s0.pilha?.id !== p0.id) {
      const ant0 = s0.pilha?.id;
      const vol0 = s0.volumePilhaId;
      s0.ids = adquirirIds(p0, arquivos);
      s0.pilha = p0;
      s0.planoSlot = 'original';
      s0.modoSlab = 'normal';
      s0.slabMm = 1;
      s0.volumePilhaId = null;
      if (vol0) liberarVolume(vol0);
      liberarIds(ant0);
    }
    if (p1 && s1.pilha?.id !== p1.id) {
      const ant1 = s1.pilha?.id;
      const vol1 = s1.volumePilhaId;
      s1.ids = adquirirIds(p1, arquivos);
      s1.pilha = p1;
      s1.planoSlot = 'original';
      s1.modoSlab = 'normal';
      s1.slabMm = 1;
      s1.volumePilhaId = null;
      if (vol1) liberarVolume(vol1);
      liberarIds(ant1);
    } else if (s1.planoSlot === 'mip-rotatorio') {
      s1.planoSlot = 'original';
    }
  }

  await definirLayout('1x2');
  // Garante que ambos os slots estejam exibidos caso já estivessem habilitados:
  await Promise.all([
    s0.pilha ? exibirSlot(s0, s0.corteSalvo) : Promise.resolve(),
    s1.pilha ? exibirSlot(s1, s1.corteSalvo) : Promise.resolve(),
  ]);

  atualizarEtiquetasComparacao();
  definirPadroesSincroniaComparar();
  atualizarSincronizadoresCornerstoneComparar();
  recalcularVinculoInicialComparacao();
}

/**
 * Botão de cadeado (4.2): liga ou desliga o vínculo de rolagem por posição.
 * Ao religar, chama `relink` com as posições atuais dos dois lados para manter
 * o alinhamento anatômico escolhido manualmente pelo usuário.
 */
export function alternarCadeadoRolagemComparar(): void {
  if (!compararAtivo) return;
  const s0 = slots[0];
  const s1 = slots[1];
  if (!s0?.pilha || !s1?.pilha) return;

  if (rolagemCompararLigada && linkRolagemComparar) {
    rolagemCompararLigada = false;
    esconderAvisoCobertura(s0);
    esconderAvisoCobertura(s1);
    sincronizar();
    return;
  }

  const pos0 = obterPosicaoCorteAtual(s0.pilha, s0.viewport);
  const pos1 = obterPosicaoCorteAtual(s1.pilha, s1.viewport);
  const res = recalcularVinculoPorPosicoesAtuais(
    linkRolagemComparar,
    s0.pilha,
    s1.pilha,
    pos0,
    pos1,
  );
  linkRolagemComparar = res.link;
  erroVinculoComparar = res.erro?.message ?? null;
  if (res.erro || !res.link) {
    rolagemCompararLigada = false;
    if (res.erro) mostrarAvisoVolume(s1, [res.erro.message]);
  } else {
    rolagemCompararLigada = true;
    esconderAvisoVolume(s1);
    aoRolarSlotComparar(ativo === 1 ? 1 : 0);
  }
  sincronizar();
}

/** Botão "Zerar" (4.2): refaz o `createLink` inicial entre os dois exames. */
export function zerarVinculoRolagemComparar(): void {
  if (!compararAtivo) return;
  rolagemCompararLigada = true;
  recalcularVinculoInicialComparacao();
}

/** Liga ou desliga a sincronização de janela/nível entre os dois exames (4.3). */
export function alternarSincronizacaoJanelaComparar(): void {
  if (!compararAtivo) return;
  janelaCompararLigada = !janelaCompararLigada;
  atualizarSincronizadoresCornerstoneComparar();
  sincronizar();
}

/** Liga ou desliga a sincronização de zoom/pan entre os dois exames (4.3). */
export function alternarSincronizacaoZoomPanComparar(): void {
  if (!compararAtivo) return;
  zoomPanCompararLigado = !zoomPanCompararLigado;
  atualizarSincronizadoresCornerstoneComparar();
  sincronizar();
}

/**
 * Abre o gráfico de Curva Tempo-Intensidade / Perfusão (`Ctrl+Shift+E`) para as ROIs
 * desenhadas no viewport ativo (ou ROI automática no ponto `┼` / centro).
 */
export async function abrirCurvaPerfusaoAtiva(): Promise<void> {
  const slot = slots[ativo] ?? slots[0];
  if (!slot?.pilha || !slot.viewport || !slot.habilitado) return;
  let indiceCorte = 0;
  if ('setImageIdIndex' in slot.viewport) {
    try {
      indiceCorte = slot.viewport.getCurrentImageIdIndex();
    } catch {
      indiceCorte = 0;
    }
  } else {
    try {
      const fp = slot.viewport.getCamera()?.focalPoint;
      if (fp) indiceCorte = indiceCorteMaisProximoDoPonto(slot.pilha, fp);
    } catch {
      indiceCorte = 0;
    }
  }

  await abrirDialogoCurvaPerfusao({
    elementoViewport: slot.elemento,
    pilhaAtiva: slot.pilha,
    indiceCorteAtual: indiceCorte,
    pontoMiraMundo: slot.pontoMiraMundo,
    aoSelecionarQuadro: (pilhaAlvo, idxCorte) => {
      const s = slots[ativo] ?? slots[0];
      if (!s) return;
      if (s.pilha?.id === pilhaAlvo.id && s.viewport) {
        if ('setImageIdIndex' in s.viewport) {
          void s.viewport.setImageIdIndex(idxCorte).then(() => {
            s.viewport?.render();
            s.overlay.atualizar();
          });
        } else if ('jumpToWorld' in s.viewport) {
          const pos = pilhaAlvo.instances[idxCorte]?.imagePositionPatient;
          if (pos) {
            s.viewport.jumpToWorld([pos[0], pos[1], pos[2]]);
            s.viewport.render();
            s.overlay.atualizar();
          }
        }
      } else {
        void abrirPilha2d(pilhaAlvo).then(() => {
          const vp = (slots[ativo] ?? slots[0])?.viewport;
          if (vp && 'setImageIdIndex' in vp) {
            void vp.setImageIdIndex(idxCorte);
          }
        });
      }
    },
  });
}

/** Abre a pilha no viewport ativo (ou nos 3 planos se já estiver em MPR e a pilha suportar volume). */
export async function abrirPilha2d(stack: StackNode): Promise<void> {
  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) return;

  if (mprAtivo) {
    if (avaliarVolume(stack).ok) {
      await montarLayoutMpr(stack);
      return;
    }
    await sairDoMpr();
  }

  const slot = slots[ativo];
  if (!slot) return;

  const anterior = slot.pilha?.id;
  const volumeAnterior = slot.volumePilhaId;
  soltarFusao(slot);
  try {
    slot.ids = adquirirIds(stack, arquivos);
  } catch (e) {
    slot.geracao++;
    mostrarMensagem(slot, `Não foi possível abrir a série ${nomeDaSerie(stack)}`, textoDoErro(e), true);
    return;
  }
  pararCine(slot.indice);
  slot.pilha = stack;
  slot.planoSlot = 'original';
  slot.modoSlab = 'normal';
  slot.slabMm = 1;
  slot.volumePilhaId = null;
  slot.corteSalvo = undefined;
  esconderAvisoVolume(slot);
  sincronizar();
  try {
    await exibirSlot(slot);
    if (compararAtivo) {
      atualizarEtiquetasComparacao();
      definirPadroesSincroniaComparar();
      atualizarSincronizadoresCornerstoneComparar();
      recalcularVinculoInicialComparacao();
    }
  } finally {
    if (volumeAnterior) liberarVolume(volumeAnterior);
    liberarIds(anterior);
  }
}

/** Esvazia todos os viewports (ao abrir outra pasta). */
export async function limparViewports(): Promise<void> {
  desmaximizar();
  geracaoMpr++;
  if (compararAtivo) {
    desativarComparacaoInterno();
  }
  if (mprAtivo) {
    mprAtivo = false;
    definirModoMprFerramentas(false);
  }
  estadoAntesDoMpr = [];
  pararTodosCines();
  for (const slot of slots) {
    slot.geracao++;
    liberarRecursosSlot(slot);
    slot.corteSalvo = undefined;
    await desabilitar(slot);
    slot.overlay.atualizar();
    mostrarMensagem(slot, 'Escolha uma série no painel.');
  }
  const { colunas, linhas } = geometriaLayout(layoutAtual);
  const quantidade = colunas * linhas;
  grade.style.gridTemplateColumns = `repeat(${colunas}, minmax(0, 1fr))`;
  grade.style.gridTemplateRows = `repeat(${linhas}, minmax(0, 1fr))`;
  for (const slot of slots) slot.celula.hidden = slot.indice >= quantidade;
  if (ativo >= quantidade) ativo = 0;
  sincronizar();
}

// ---------- layout ----------

async function redimensionarMotor(manterCamera = false): Promise<void> {
  const motor = await iniciarCornerstone();
  requestAnimationFrame(() => {
    try {
      motor.resize(true, manterCamera);
      for (const s of slots) {
        if (s.habilitado && !s.celula.hidden) {
          if (s.controladorMip) {
            s.controladorMip.definirAngulo(s.controladorMip.anguloAtual());
          }
          s.overlay.atualizar();
          atualizarMiraSlot(s);
        }
      }
    } catch {
      /* ignora se ainda não houver viewports prontos */
    }
  });
}

/** Volta da tela cheia de um viewport para a grade anterior. */
function desmaximizar(redimensionar = false): void {
  if (maximizado === null || !gradeAntesDeMaximizar) return;
  grade.style.gridTemplateColumns = gradeAntesDeMaximizar.colunas;
  grade.style.gridTemplateRows = gradeAntesDeMaximizar.linhas;
  for (const s of slots) s.celula.hidden = gradeAntesDeMaximizar.ocultas[s.indice] ?? true;
  maximizado = null;
  gradeAntesDeMaximizar = null;
  sincronizar();
  if (redimensionar) void redimensionarMotor(true);
}

/**
 * Duplo clique (ou tecla F): o viewport ativo (ou o indicado) ocupa a grade toda, como num
 * layout 1x1; de novo, volta à divisão anterior. Os outros viewports continuam carregados.
 */
export function alternarMaximizado(indice: number = ativo): void {
  if (maximizado !== null) {
    desmaximizar(true);
    return;
  }
  const visiveis = slots.filter((s) => !s.celula.hidden);
  const alvo = slots[indice];
  if (visiveis.length < 2 || !alvo || alvo.celula.hidden) return;
  gradeAntesDeMaximizar = {
    colunas: grade.style.gridTemplateColumns,
    linhas: grade.style.gridTemplateRows,
    ocultas: slots.map((s) => s.celula.hidden === true),
  };
  maximizado = alvo.indice;
  ativo = alvo.indice;
  grade.style.gridTemplateColumns = 'minmax(0, 1fr)';
  grade.style.gridTemplateRows = 'minmax(0, 1fr)';
  for (const s of slots) s.celula.hidden = s.indice !== alvo.indice;
  sincronizar();
  void redimensionarMotor(true);
}

export async function definirLayout(novo: Layout): Promise<void> {
  desmaximizar();
  if (compararAtivo && novo !== '1x2') {
    desativarComparacaoInterno();
  }
  if (mprAtivo) {
    await sairDoMpr(novo);
    return;
  }
  layoutAtual = novo;
  const { colunas, linhas } = geometriaLayout(novo);
  const quantidade = colunas * linhas;
  grade.style.gridTemplateColumns = `repeat(${colunas}, minmax(0, 1fr))`;
  grade.style.gridTemplateRows = `repeat(${linhas}, minmax(0, 1fr))`;
  for (const slot of slots) {
    const visivel = slot.indice < quantidade;
    slot.celula.hidden = !visivel;
    if (!visivel) await desabilitar(slot);
  }
  if (ativo >= quantidade) ativo = 0;
  sincronizar();
  await redimensionarMotor(false);
  for (const slot of slots) {
    if (slot.indice < quantidade && slot.pilha && !slot.habilitado) void exibirSlot(slot, slot.corteSalvo);
  }
}

/** Espera o streaming do volume terminar (todos os cortes decodificados). */
async function aguardarVolumeCompleto(vol: Types.IImageVolume): Promise<void> {
  const completo = (): boolean => (vol.loadStatus as { loaded?: boolean } | undefined)?.loaded === true;
  const limite = Date.now() + 180_000;
  while (!completo()) {
    if (Date.now() > limite) throw new Error('Tempo esgotado carregando o volume.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

interface Voxels {
  data: ArrayLike<number>;
  grid: ReturnType<typeof gridFromVolumeProps>;
}

/** Voxels já copiados por pilha (evita remontar o volume a cada medida). Invalidado ao recalcular o SUV. */
const cacheVoxels = new Map<string, Voxels>();

/**
 * Copia os voxels e a grade do volume da pilha (monta o volume se preciso e solta a referência
 * ao terminar).
 */
async function carregarVoxels(stack: StackNode, ids: string[]): Promise<Voxels | { erro: string }> {
  const guardado = cacheVoxels.get(stack.id);
  if (guardado) return guardado;
  const res = adquirirVolume(stack, ids);
  if (!res.ok) return { erro: `Medida volumétrica indisponível: ${res.mensagens.join(' · ')}` };
  try {
    const vol = (await res.promessa) as Types.IImageVolume;
    await aguardarVolumeCompleto(vol);
    const dados = vol.voxelManager?.getCompleteScalarDataArray?.();
    if (!dados) return { erro: 'Não foi possível ler os voxels do volume.' };
    const v: Voxels = {
      data: dados,
      grid: gridFromVolumeProps({
        dimensions: vol.dimensions,
        spacing: vol.spacing,
        origin: vol.origin,
        direction: vol.direction,
      }),
    };
    cacheVoxels.set(stack.id, v);
    return v;
  } catch (e) {
    return { erro: textoDoErro(e) };
  } finally {
    liberarVolume(stack.id);
  }
}

function unidadeDaSerie(stack: StackNode): string {
  if (stack.instances.some((i) => i.modality === 'PT')) return unidadeDaPilha(stack.id);
  return stack.instances.some((i) => i.modality === 'CT') ? 'HU' : '';
}

/**
 * Volume para medidas volumétricas do viewport. Na fusão PET/TC a medida é do PET
 * (considerando o deslocamento manual do registro).
 */
async function volumeParaVoi(idVp: string): Promise<RespostaResolvedor> {
  const slot = slots.find((s) => s.idViewport === idVp);
  if (!slot?.pilha) return { erro: 'Série não encontrada no viewport.' };
  const naFusao = emFusao(slot) && slot.pilhaFusao;
  const stack = naFusao ? slot.pilhaFusao! : slot.pilha;
  const v = await carregarVoxels(stack, naFusao ? slot.idsFusao : slot.ids);
  if ('erro' in v) return v;
  const ehPet = stack.instances.some((i) => i.modality === 'PT');
  return {
    volume: { data: v.data, grid: v.grid },
    unidade: unidadeDaSerie(stack),
    ehPet,
    ...(naFusao ? { deslocamentoMm: [...slot.registro.deslocamento] as [number, number, number] } : {}),
  };
}

function valorNoPonto(v: Voxels, mundo: [number, number, number]): number | undefined {
  const ijk = worldToVoxel(v.grid, mundo);
  if (!ijk) return undefined;
  const [i, j, k] = [Math.round(ijk[0]), Math.round(ijk[1]), Math.round(ijk[2])];
  const [nx, ny, nz] = v.grid.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return undefined;
  return v.data[i + j * nx + k * nx * ny];
}

function formatarValor(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Sonda: HU e SUV do ponto (na fusão, os dois; nas demais séries, o valor da série). */
async function valoresNoPonto(idVp: string, mundo: [number, number, number]) {
  const slot = slots.find((s) => s.idViewport === idVp);
  if (!slot?.pilha) return { erro: 'Série não encontrada no viewport.' };
  const linhas: string[] = [];
  const medir = async (stack: StackNode, ids: string[], desl?: [number, number, number]): Promise<string | { erro: string }> => {
    const v = await carregarVoxels(stack, ids);
    if ('erro' in v) return v;
    const p: [number, number, number] = desl ? [mundo[0] - desl[0], mundo[1] - desl[1], mundo[2] - desl[2]] : mundo;
    const valor = valorNoPonto(v, p);
    const un = unidadeDaSerie(stack);
    if (valor === undefined) return `${un || 'Valor'}: fora do volume`;
    const eSuv = un.startsWith('SU');
    return `${un || 'Valor'}: ${formatarValor(valor, eSuv ? 2 : un === 'HU' ? 0 : 1)}${eSuv || un === '' ? '' : ' ' + (un === 'HU' ? '' : un)}`.trim();
  };
  const principal = await medir(slot.pilha, slot.ids);
  if (typeof principal !== 'string') return principal;
  linhas.push(principal);
  if (emFusao(slot) && slot.pilhaFusao) {
    const pet = await medir(slot.pilhaFusao, slot.idsFusao, slot.registro.deslocamento);
    if (typeof pet !== 'string') return pet;
    linhas.push(pet);
  }
  return { linhas };
}

/**
 * Aplica (ou remove, com `null`) as correções do usuário ao SUV de uma pilha de PET.
 * O SUV é entregue na decodificação, então as imagens e os volumes da série são descartados e
 * recarregados com os novos fatores; janela, corte e plano de cada viewport são mantidos.
 */
export async function aplicarCorrecoesPet(stack: StackNode, correcoes: CorrecoesPet | null): Promise<void> {
  const ids = registro.get(stack.id)?.ids;
  if (!ids) return;
  definirCorrecoesDaPilha(stack.id, correcoes);
  cacheVoxels.delete(stack.id);
  registrarSuvDaPilha(stack, ids);

  const afetados = slots.filter((s) => s.pilha?.id === stack.id);
  const salvos = afetados.map((s) => {
    pararCine(s.indice);
    return { slot: s, ...salvarEstadoVisualSlot(s) };
  });
  descartarVolume(stack.id);
  for (const id of ids) {
    try {
      cache.removeImageLoadObject(id);
    } catch {
      /* não estava no cache */
    }
  }
  for (const { slot } of salvos) slot.volumePilhaId = null;
  for (const { slot, corte, voiPreservado } of salvos) {
    if (slot.habilitado) await exibirSlot(slot, corte, voiPreservado);
  }
  sincronizar();
  document.dispatchEvent(new CustomEvent(EVENTO_SUV_ATUALIZADO, { detail: stack.id }));
}

/** Estudo que contém a pilha ativa; se não houver, o mais recente com par PET + TC/RM. */
function estudoParaPet(): { estudo: StudyNode; par: FusionCandidate } | null {
  const pacientes = estado.resultado?.index.patients ?? [];
  const todos = pacientes.flatMap((p) => p.studies);
  const ativa = estado.pilhaAtiva?.id;
  const doAtivo = ativa ? todos.find((e) => e.series.some((sr) => sr.stacks.some((st) => st.id === ativa))) : undefined;
  for (const estudo of doAtivo ? [doAtivo, ...todos] : todos) {
    const pares = findFusionCandidates(estudo);
    // Se a série aberta no viewport ativo (PET ou TC/RM) faz parte de algum par, usa esse par.
    const par = (ativa && pares.find((c) => c.pet.id === ativa || c.anatomic.id === ativa)) || pares[0];
    if (par) return { estudo, par };
  }
  return null;
}

/**
 * Grades de PET/CT. Ordem das células:
 * 4 campos (2x2): MIP 3D, PET, TC, Fusão.  3 campos (lado a lado): PET, TC, Fusão.
 * A célula de Fusão fica reservada: a fusão em si é da Fase 6.
 */
export async function abrirLayoutPet(campos: 3 | 4): Promise<void> {
  const achado = estudoParaPet();
  const slotAtivo = slots[ativo] ?? slots[0];
  if (!achado) {
    if (slotAtivo) mostrarMensagem(slotAtivo, 'Sem par PET + TC/RM', 'Abra um estudo que tenha uma série de PET e uma de TC ou RM.');
    return;
  }
  const { par } = achado;
  await definirLayout(campos === 4 ? '2x2' : '1x3');
  const mip = par.pet;
  const celulas: Array<{ pilha: StackNode | null; plano: PlanoSlot; aviso?: string; fusao?: boolean }> =
    campos === 4
      ? [
          { pilha: mip, plano: 'mip-rotatorio' },
          { pilha: par.pet, plano: 'original' },
          { pilha: par.anatomic, plano: 'original' },
          { pilha: par.anatomic, plano: 'axial', fusao: true },
        ]
      : [
          { pilha: par.pet, plano: 'original' },
          { pilha: par.anatomic, plano: 'original' },
          { pilha: par.anatomic, plano: 'axial', fusao: true },
        ];
  for (let i = 0; i < celulas.length; i++) {
    const c = celulas[i]!;
    const slot = slots[i];
    if (!slot) continue;
    ativo = i;
    if (c.pilha) {
      await abrirPilha2d(c.pilha);
      if (c.fusao) {
        // TC como base e PET por cima; `sameFrame: false` = fusão manual, com aviso.
        await configurarFusaoNoSlot(slot, par.anatomic, par.pet, par.sameFrame);
      } else if (c.plano !== 'original') {
        await definirPlanoSlotAtivo(c.plano);
      }
    } else if (c.aviso) {
      // Esvazia a célula (pode ter sobrado uma série de um layout anterior).
      slot.geracao++;
      pararCine(slot.indice);
      liberarRecursosSlot(slot);
      await desabilitar(slot);
      slot.overlay.atualizar();
      mostrarMensagem(slot, c.aviso, 'Esta célula está reservada para a fusão; ainda não disponível.');
    }
  }
  ativo = 0;
  sincronizar();
}

/** Tecla L: passa para o próximo layout (1x1, 1x2, 2x2 e volta). */
export function proximoLayout(): Promise<void> {
  const i = ORDEM_LAYOUTS.indexOf(layoutAtual);
  return definirLayout(ORDEM_LAYOUTS[(i + 1) % ORDEM_LAYOUTS.length]!);
}

// ---------- cine ----------

function passoDoCine(indice: number): () => void {
  return () => {
    const vp = slots[indice]?.viewport;
    if (!vp) return;
    if ('setImageIdIndex' in vp) {
      vp.scroll(1, false, true);
    } else {
      vp.scroll(1);
    }
  };
}

/** Toca ou pausa o cine (ou a rotação do MIP rotatório) do viewport ativo. */
export function alternarCine(): void {
  if (mprAtivo) return;
  const slot = slots[ativo];
  if (!slot?.viewport || !slot.pilha) return;
  if (slot.controladorMip) {
    slot.controladorMip.alternarRotacao();
    sincronizar();
    return;
  }
  if (cineTocando(slot.indice)) pararCine(slot.indice);
  else tocarCine(slot.indice, passoDoCine(slot.indice));
  sincronizar();
}

export function definirVelocidadeCine(fps: number): void {
  definirFps(fps, passoDoCine);
  sincronizar();
}

// ---------- montagem ----------

function sincronizarVoiMpr(origemIndice: number): void {
  if (!mprAtivo || sincronizandoVoi) return;
  const origem = slots[origemIndice]?.viewport;
  if (!origem) return;
  const props = origem.getProperties();
  if (!props?.voiRange) return;
  sincronizandoVoi = true;
  try {
    for (let i = 0; i < 3; i++) {
      if (i === origemIndice) continue;
      const vp = slots[i]?.viewport;
      if (vp) {
        vp.setProperties({ voiRange: props.voiRange, invert: props.invert });
        vp.render();
        slots[i]?.overlay.atualizar();
      }
    }
  } finally {
    sincronizandoVoi = false;
  }
}

function criarSlot(indice: number): Slot {
  const celula = document.createElement('div');
  celula.className = 'celula';
  const elemento = document.createElement('div');
  elemento.id = idElemento(indice);
  elemento.className = 'viewport-2d';
  elemento.addEventListener('contextmenu', (e) => e.preventDefault());
  const mensagem = document.createElement('div');
  mensagem.className = 'msg-celula';
  mensagem.hidden = true;
  const avisoVolume = document.createElement('div');
  avisoVolume.className = 'aviso-volume';
  avisoVolume.hidden = true;
  const controlesMip = document.createElement('div');
  controlesMip.className = 'controles-mip';
  controlesMip.hidden = true;
  const controlesFusao = document.createElement('div');
  controlesFusao.className = 'controles-fusao';
  controlesFusao.hidden = true;
  const etiquetaComparacao = document.createElement('div');
  etiquetaComparacao.className = 'etiqueta-comparacao';
  etiquetaComparacao.hidden = true;
  const avisoCobertura = document.createElement('div');
  avisoCobertura.className = 'aviso-cobertura';
  avisoCobertura.textContent = 'Fora da cobertura';
  avisoCobertura.hidden = true;
  const canvasMira = document.createElement('canvas');
  canvasMira.className = 'canvas-mira';
  const botaoDadosPet = document.createElement('button');
  botaoDadosPet.type = 'button';
  botaoDadosPet.className = 'btn-dados-pet';
  botaoDadosPet.textContent = 'Dados PET';
  botaoDadosPet.title = 'Ver e corrigir peso, altura, dose e horários usados no cálculo do SUV';
  botaoDadosPet.hidden = true;
  celula.append(elemento, canvasMira, mensagem, avisoVolume, controlesMip, controlesFusao, etiquetaComparacao, avisoCobertura, botaoDadosPet);

  const slot: Slot = {
    indice,
    idViewport: idViewport(indice),
    celula,
    elemento,
    mensagem,
    avisoVolume,
    controlesMip,
    controlesFusao,
    etiquetaComparacao,
    avisoCobertura,
    botaoDadosPet,
    canvasMira,
    pontoMiraMundo: null,
    tipoViewport: Enums.ViewportType.STACK,
    planoSlot: 'original',
    modoSlab: 'normal',
    slabMm: 1,
    habilitado: false,
    montandoVolume: false,
    pilha: null,
    volumePilhaId: null,
    ids: [],
    geracao: 0,
    pilhaFusao: null,
    idsFusao: [],
    volumeFusaoId: null,
    fusao: { opacidade: 0.5, colormap: NOME_HOT_IRON, teto: 10, minimo: 0 },
    registro: { ativo: false, deslocamento: [0, 0, 0] },
    overlay: undefined as unknown as Overlay,
  };
  slot.overlay = criarOverlay(celula, {
    viewport: () => slot.viewport,
    pilha: () => slot.pilha,
    planoMpr: () => slot.planoMpr,
    modoSlab: () => MODOS_SLAB[mprAtivo ? modoSlabMpr : slot.modoSlab]?.rotulo,
  });
  slot.overlay.ligar(elemento);
  elemento.addEventListener(Enums.Events.VOI_MODIFIED, () => {
    sincronizarVoiMpr(indice);
    document.dispatchEvent(new CustomEvent(EVENTO_JANELA_MUDOU, { detail: { idViewport: slot.idViewport } }));
  });
  elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    aoRolarSlotEstudo(indice);
    atualizarMiraSlot(slot);
  });
  elemento.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    aoRolarSlotEstudo(indice);
    atualizarMiraSlot(slot);
  });
  elemento.addEventListener(Enums.Events.CAMERA_MODIFIED, () => {
    aoMudarCameraEstudo(indice);
    atualizarMiraSlot(slot);
  });
  celula.addEventListener('mousedown', () => ativarViewport(indice), true);
  // Registro manual: com "Mover PET" ligado, arrastar na fusão desloca o PET (no plano da imagem).
  celula.addEventListener(
    'mousedown',
    (ev) => {
      const v = slot.viewport;
      if (ev.button !== 0 || !slot.registro.ativo || !emFusao(slot) || !v || !slot.volumesFusao) return;
      if (ev.target instanceof Element && ev.target.closest('.controles-fusao')) return;
      const rect = elemento.getBoundingClientRect();
      const mundoInicial = v.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]);
      const base = [...slot.registro.deslocamento] as [number, number, number];
      const aoMover = (m: MouseEvent): void => {
        const atual = v.canvasToWorld([m.clientX - rect.left, m.clientY - rect.top]);
        // Só no plano da imagem: tira do deslocamento a componente ao longo da normal do corte
        // (o ajuste na direção cabeça-pés é feito pelos botões z− e z+).
        const dx = atual[0] - mundoInicial[0];
        const dy = atual[1] - mundoInicial[1];
        const dz = atual[2] - mundoInicial[2];
        const n = v.getCamera().viewPlaneNormal ?? [0, 0, 1];
        const ao = dx * n[0] + dy * n[1] + dz * n[2];
        slot.registro.deslocamento = [base[0] + dx - ao * n[0], base[1] + dy - ao * n[1], base[2] + dz - ao * n[2]];
        aplicarRegistroPet(slot, slot.volumesFusao!.pet);
        slot.atualizarLeituraRegistro?.();
        void iniciarCornerstone().then((mot) => mot.render());
      };
      const aoSoltar = (): void => {
        window.removeEventListener('mousemove', aoMover, true);
        window.removeEventListener('mouseup', aoSoltar, true);
      };
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
      ev.stopPropagation();
      ev.preventDefault();
    },
    true,
  );
  botaoDadosPet.addEventListener('click', () => {
    if (slot.pilha) document.dispatchEvent(new CustomEvent(EVENTO_DADOS_PET, { detail: slot.pilha }));
  });
  // Duplo clique maximiza/restaura. Com ferramenta de medida ativa só com Shift (o duplo clique
  // pode ser parte do desenho, ex.: terminar uma polilinha).
  celula.addEventListener('dblclick', (e) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button, input, select, a'))) return;
    const atual = ferramentaPrimariaAtual();
    const medindo = FERRAMENTAS_PRIMARIAS.some((f) => f.nome === atual && f.categoria === 'medida');
    if (medindo && !e.shiftKey) return;
    alternarMaximizado(indice);
  });

  // Ferramenta Localizador 3D (┼ Localizar): clicando ou arrastando com o botão atribuído,
  // marca a cruzinha neste viewport e sincroniza todos os demais (mesmo exame ou comparado).
  elemento.addEventListener(
    'mousedown',
    (e) => {
      if (!slot.viewport || !slot.habilitado || slot.planoSlot === 'mip-rotatorio') return;
      const botao =
        e.button === 0 ? 'esquerdo' : e.button === 1 ? 'meio' : e.button === 2 ? 'direito' : null;
      if (!botao || botaoAtribuido(botao) !== FERRAMENTA_LOCALIZADOR_3D) return;

      e.preventDefault();
      e.stopPropagation();

      const atualizarPorEvento = (ev: MouseEvent) => {
        if (!slot.viewport) return;
        const rect = elemento.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
        try {
          const mundo = slot.viewport.canvasToWorld([x, y]);
          if (mundo && Number.isFinite(mundo[0]) && Number.isFinite(mundo[1]) && Number.isFinite(mundo[2])) {
            aplicarLocalizador3d(indice, mundo);
          }
        } catch {
          /* ignora se a imagem ainda não estiver pronta */
        }
      };

      atualizarPorEvento(e);

      const aoMover = (ev: MouseEvent) => atualizarPorEvento(ev);
      const aoSoltar = () => {
        window.removeEventListener('mousemove', aoMover, true);
        window.removeEventListener('mouseup', aoSoltar, true);
      };
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
    },
    true,
  );

  celula.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      ativarViewport(indice);
      if (slot.planoSlot === 'mip-rotatorio') return;
      const deltaMm = e.deltaY < 0 ? 1 : -1;
      const atual = mprAtivo ? slabMprMm : slot.slabMm;
      definirSlabMpr(atual + deltaMm);
    },
    { capture: true, passive: false },
  );
  return slot;
}

/** Monta a grade (vazia) dentro da área de viewports. Chamar uma vez. */
export function configurarViewport2d(elementos: ElementosViewport2d): void {
  definirResolvedorVoi(volumeParaVoi);
  definirResolvedorSonda(valoresNoPonto);
  iniciarVoiEsfera();
  grade = document.createElement('div');
  grade.id = 'grade';
  const observadorTamanho = new ResizeObserver(() => {
    void redimensionarMotor(false);
  });
  for (let i = 0; i < MAX_VIEWPORTS; i++) {
    const slot = criarSlot(i);
    slots.push(slot);
    grade.append(slot.celula);
    observadorTamanho.observe(slot.elemento);
  }
  elementos.contentor.append(grade);
  eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, () => {
    for (const slot of slots) {
      if (slot.habilitado && slot.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC) {
        slot.reaplicarFusao?.();
        // Fusão: aproxima o zoom ao corpo (como nas outras células), uma vez, com a TC já carregada.
        if (emFusao(slot) && !slot.zoomFusaoAjustado && slot.viewport && slot.ids.length > 0) {
          slot.zoomFusaoAjustado = true;
          ajustarZoomAoConteudo(slot.viewport, slot.ids[Math.floor(slot.ids.length / 2)]!, slot.pilha?.instances[0]?.modality);
        }
        slot.viewport?.render();
        slot.overlay.atualizar();
      }
    }
  });
  void definirLayout('1x1');
}
