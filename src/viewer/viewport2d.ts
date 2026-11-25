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
  getEnabledElement,
  imageLoader,
  setVolumesForViewports,
  type Types,
} from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode, StudyNode } from '../io/organize';
import {
  aplicarFusao,
  corrigirOpacidadePeloSlab,
  criarLegendaFusao,
  emFusao,
  ligarArrastoRegistroPet,
  montarControlesFusao,
  NOME_HOT_IRON,
  ocultarFusaoVisual,
  type OpcoesControlesFusao,
} from './fusaoUi';
import {
  carregarVoxels,
  invalidarCacheVoxels,
  textoDoErro,
  valorNoPonto,
} from './voxelsCache';
import { ajustarZoomAoConteudo, exibicaoPadraoPet } from './exibicaoInicial';
import { aplicarFiltroVisualElemento, sanearNivelFiltro } from './filtroImagem';
import { preferencias } from '../state/preferencias';
import { SynchronizerManager, synchronizers, ToolGroupManager } from '@cornerstonejs/tools';
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
  centroCrosshair,
  escolherFerramentaPrimaria,
  moverCentroCrosshair,
  definirLinhasReferencia,
  botaoAtribuido,
  EVENTO_BOTOES_MUDARAM,
  EVENTO_VIEWPORT_RESTAURADO,
  ferramentaPrimariaAtual,
  FERRAMENTAS_PRIMARIAS,
  ID_GRUPO,
  predefinicoes,
  definirModoMprFerramentas,
  removerViewportDoGrupo,
} from '../tools/grupo';
import { definirApoioGirarPlano, esquecerPlanoGirado, restaurarPlanoGirado } from '../tools/girarPlano';
import { desenharMiraNoCanvas, FERRAMENTA_LOCALIZADOR_3D } from '../tools/localizador3d';
import {
  aplicarCameraMipRotatorio,
  type ControladorMipRotatorio,
  criarControladorMipRotatorio,
} from '../tools/mipRotatorio';
import { modalidade3d } from '../render3d/predefinicoes3d';
import {
  apagarSegmentacao,
  apagarTodasSegmentacoes,
  aplicarSegmentacaoSalva,
  autoLigarCortesPincel,
  criarSegmentacao,
  definirResolvedorCriacaoSegmentacao,
  definirResolvedorRecalculoVaso,
  definirResolvedorValores,
  definirCorSegmento,
  geometriaDaSegmentacao,
  temVoxelsPintados,
  mostrarNosViewports,
  buracosDoCorte,
  corteDaMascara,
  type CorteDaMascara,
  ligarCortesProximos,
  pintarIndices,
  preencherBuracosNovos,
  prepararSegmentoVaso,
  reaplicarIndicesNoSegmento,
  registrarUltimaSementeVaso,
  segmentacaoDaPilha,
  ultimaSementeVasoDa,
  vasoConfig,
} from '../segmentation/segmentacao';
import {
  ajustarRaioPincelDelta,
  definirModoSegmentacao,
  definirResolvedorVaso,
  ehFerramentaSegmentacao,
  emModoSegmentacao,
  EVENTO_MENSAGEM_SEGMENTACAO,
  EVENTO_MODO_SEGMENTACAO,
  NOME_PINCEL,
} from '../segmentation/ferramentas';
import { calcularFaixaInteligenteVaso, crescerVaso } from '../segmentation/vaso';
import { descartarVolumeDoWorker } from '../workers/computeClient';
import { conferirSegmentacao, lerSegmentacao } from '../segmentation/arquivoSegmentacao';
import type { Controlador3d } from '../render3d/viewport3d';

type Modulo3d = typeof import('../render3d/viewport3d');
let modulo3dCache: Modulo3d | undefined;
let promessaModulo3d: Promise<Modulo3d> | undefined;

async function carregarModulo3d(): Promise<Modulo3d> {
  if (modulo3dCache) return modulo3dCache;
  promessaModulo3d ??= import('../render3d/viewport3d').then((m) => {
    modulo3dCache = m;
    return m;
  });
  return promessaModulo3d;
}
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
} from '../compare/modoComparar';
import { invertLink, mapPosition, type ScrollLink } from '../compare/sync';
import {
  cantosMundoDaInstancia,
  decidirSincRolagemSlot,
  deveSincronizarJanelaSlot,
  encontrarPilhaEnviada,
  intersecaoQuadComPlano,
  type MensagemSincJanela,
  type MensagemSincLocalizador,
  type MensagemSincRolagem,
  type OpcoesSincroniaJanelas,
} from '../compare/segundaJanelaLogica';
import {
  EVENTO_ABRIR_PILHA,
  extrairDadosPilhaArrastada,
  temPilhaEmArraste,
} from '../ui/painelEstudos';
import { estado } from '../state/store';
import { adquirirVolume, descartarVolume, idVolumeParaPilha, liberarVolume } from '../volume/montarVolume';
import { avaliarVolume } from '../volume/validarVolume';
import { cineTocando, definirFps, fpsAtual, pararCine, pararTodosCines, tocarCine } from './cine';
import { idElemento, ID_MOTOR, idViewport, iniciarCornerstone, MAX_VIEWPORTS } from './iniciar';
import { criarCuboOrientacao, type CuboOrientacao } from './cuboOrientacao';
import { criarOverlay, type Overlay, type PlanoMprOverlay } from './overlay';
import { abrirMenuFlutuante, type EntradaMenuFlutuante } from '../ui/menuFlutuante';

const CARGAS_SIMULTANEAS = 4;

/**
 * Layout da grade: `${linhas}x${colunas}` (ex.: '2x2', '1x3', '3x4'), até 5x5.
 * '1x2' = 1 linha e 2 colunas (lado a lado).
 */
export type Layout = string;
export type PlanoSlot = 'original' | 'axial' | 'coronal' | 'sagital' | 'mip-rotatorio' | '3d';
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
  '3d': { rotulo: '3D', eixo: Enums.OrientationAxis.CORONAL },
};

/** Planos sem cortes (MIP rotatório e 3D): ficam fora da rolagem, das linhas e da sincronia. */
function semCortes(s: { planoSlot: PlanoSlot }): boolean {
  return s.planoSlot === 'mip-rotatorio' || s.planoSlot === '3d';
}

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
  /** Verdadeiro quando algum viewport visível exibe o 3D (fase 8). */
  visao3dVisivel: boolean;
  /** Estado do modo Comparar (Fase 4). */
  comparacao: EstadoComparacao;
  /** Um viewport está maximizado (tela cheia da grade). */
  maximizado: boolean;
  /** Sincronia automática (rolagem, zoom, pan e janela) entre séries do mesmo estudo. */
  sincroniaEstudo: boolean;
  /** Linhas de referência entre cortes de planos diferentes. */
  linhasReferencia: boolean;
  /** Filtro visual (Suave <-> Nítido, -5..+5, 0 = Original) do viewport ativo. */
  filtroImagemAtivo: number;
  /** Verdadeiro quando o viewport ativo aceita filtro visual (2D ou MPR com imagem). */
  suportaFiltroImagemAtivo: boolean;
}

export interface ElementosViewport2d {
  /** Contêiner da área de viewports; a grade é criada dentro dele. */
  contentor: HTMLElement;
  /** Grade inicial ao montar (ex.: '2x2' ou '1x2' salva nas preferências). */
  layoutInicial?: Layout;
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
  botaoVoltar: HTMLButtonElement;
  scrubber: HTMLDivElement;
  scrubberPino: HTMLDivElement;
  canvasMira: HTMLCanvasElement;
  pontoMiraMundo: Types.Point3 | null;
  controladorMip?: ControladorMipRotatorio;
  /** Controles do 3D (fase 8), quando o slot mostra a renderização volumétrica. */
  controlador3d?: Controlador3d;
  overlay: Overlay;
  /** Cubo de orientação no canto inferior direito (some no 3D e no quadro vazio). */
  cubo: CuboOrientacao;
  viewport?: Types.IStackViewport | Types.IVolumeViewport;
  tipoViewport: Enums.ViewportType;
  planoSlot: PlanoSlot;
  modoSlab: ModoSlab;
  slabMm: number;
  /** Filtro visual por viewport (-5 Suave a +5 Nítido; 0 = Original). */
  filtroImagem: number;
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

export function obterLayoutAtual(): Layout {
  return layoutAtual;
}

// Sincronia automática entre séries do mesmo estudo (fora do modo Comparar):
// por padrão sincroniza apenas posição/rolagem; janela/nível e zoom/pan são opcionais.
let sincroniaEstudoLigada = true;
let janelaEstudoLigada = false;
let zoomPanEstudoLigado = false;
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
  invalidarCacheVoxels(stackId);
  descartarVolumeDoWorker(stackId);
  esquecerSuvDaPilha(stackId);
  removerArquivos(r.ids);
}

// ---------- mensagens e utilidades ----------

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
    visao3dVisivel: slots.some((s) => !s.celula.hidden && s.planoSlot === '3d'),
    maximizado: maximizado !== null,
    sincroniaEstudo: sincroniaEstudoLigada,
    linhasReferencia: linhasReferenciaLigadas,
    filtroImagemAtivo: slot?.filtroImagem ?? 0,
    suportaFiltroImagemAtivo: Boolean(slot && slot.pilha && slot.planoSlot !== '3d'),
    comparacao: {
      ativo: compararAtivo,
      rolagemLigada: compararAtivo ? rolagemCompararLigada && linkRolagemComparar !== null : sincroniaEstudoLigada,
      deslocamentoMm: linkRolagemComparar?.offsetMm ?? null,
      erroVinculo: erroVinculoComparar,
      janelaLigada: compararAtivo ? janelaCompararLigada : janelaEstudoLigada,
      zoomPanLigado: compararAtivo ? zoomPanCompararLigado : zoomPanEstudoLigado,
    },
  };
}

// ---------- sincronia automática entre séries do mesmo estudo ----------

const ID_SYNC_ESTUDO_VOI = 'sync-estudo-voi';

/** Viewports 2D (pilha) visíveis agrupados por estudo + referencial; só grupos com 2 ou mais. */
function gruposSincroniaEstudo(): Slot[][] {
  if (compararAtivo || mprAtivo || maximizado !== null) return [];
  const grupos = new Map<string, Slot[]>();
  for (const s of slots) {
    if (s.celula.hidden || !s.pilha || !s.habilitado || !s.viewport) continue;
    // Entram os cortes originais (pilha) e a fusão PET/TC (volume axial).
    // Entram cortes originais (pilha) e planos de volume (axial, coronal, sagital; com ou sem fusão).
    if (s.planoSlot === 'original' ? !('setImageIdIndex' in s.viewport) : semCortes(s)) continue;
    const inst = s.pilha.instances[0];
    if (!inst?.studyInstanceUid || !inst.frameOfReferenceUid) continue;
    const chave = `${inst.studyInstanceUid}|${inst.frameOfReferenceUid}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(s);
    grupos.set(chave, lista);
  }
  return [...grupos.values()].filter((g) => g.length >= 2);
}

/** Grupos (por estudo) cujo zoom automático ainda espera uma imagem carregada. */
const zoomsPendentes = new Set<string>();
let idsSincronizadoresEstudo: string[] = [];

const chaveDoGrupo = (g: Slot[]): string => g.map((s) => s.idViewport).join(',');

/**
 * Aproxima o zoom ao corpo usando a TC (ou a 1ª série) de cada grupo; o sincronizador leva às
 * demais células do grupo. Precisa de uma imagem já carregada: fica pendente e é tentado de novo.
 */
function tentarZoomDoGrupo(): void {
  if (!zoomPanEstudoLigado || zoomsPendentes.size === 0) return;
  for (const grupo of gruposSincroniaEstudo()) {
    const chave = chaveDoGrupo(grupo);
    if (!zoomsPendentes.has(chave)) continue;
    const todosProntos = grupo.every(
      (s) => s.viewport && !semCortes(s) && s.viewport.getActors().length > 0,
    );
    if (!todosProntos) continue;
    const base =
      grupo.find((s) => s.pilha?.instances[0]?.modality === 'CT' && s.viewport && 'setImageIdIndex' in s.viewport) ??
      grupo.find((s) => s.viewport && 'setImageIdIndex' in s.viewport);
    if (!base?.viewport || base.ids.length === 0) continue;
    const id = base.ids[Math.floor(base.ids.length / 2)]!;
    if (!cache.getImage(id)) continue;
    zoomsPendentes.delete(chave);
    ajustarZoomAoConteudo(base.viewport, id, base.pilha?.instances[0]?.modality);
    aoMudarCameraEstudo(base.indice);
  }
}

/** Refaz os sincronizadores opcionais de janela e zoom físico quando os grupos ou opções mudam. */
function atualizarSincroniaEstudo(): void {
  const grupos = sincroniaEstudoLigada ? gruposSincroniaEstudo() : [];
  const assinatura =
    grupos.map((g) => g.map((s) => `${s.idViewport}:${s.pilha?.id}`).join(',')).join('|') +
    `|j=${janelaEstudoLigada}|z=${zoomPanEstudoLigado}`;
  if (assinatura === assinaturaSincroniaEstudo) {
    tentarZoomDoGrupo();
    return;
  }
  assinaturaSincroniaEstudo = assinatura;
  zoomsPendentes.clear();
  if (zoomPanEstudoLigado) {
    for (const g of grupos) zoomsPendentes.add(chaveDoGrupo(g));
  }

  for (const id of idsSincronizadoresEstudo) SynchronizerManager.destroySynchronizer(id);
  idsSincronizadoresEstudo = [];
  if (grupos.length === 0 || (!janelaEstudoLigada && !zoomPanEstudoLigado)) return;

  grupos.forEach((grupo, n) => {
    if (zoomPanEstudoLigado) {
      for (const s of grupo) {
        try {
          s.viewport?.resetCamera();
          s.viewport?.render();
        } catch {
          /* viewport ainda sem imagem */
        }
      }
    }
    if (janelaEstudoLigada) {
      const idVoi = `${ID_SYNC_ESTUDO_VOI}-${n}`;
      idsSincronizadoresEstudo.push(idVoi);
      const voi = synchronizers.createVOISynchronizer(idVoi, { syncInvertState: true, syncColormap: true });
      // Janela só entre séries da mesma modalidade (PET em SUV e TC em HU não compartilham janela).
      const modalidade = grupo[0]!.pilha?.instances[0]?.modality;
      const mesmas = grupo.filter((s) => s.planoSlot === 'original' && s.pilha?.instances[0]?.modality === modalidade);
      if (mesmas.length >= 2) {
        for (const s of mesmas) voi.add({ renderingEngineId: ID_MOTOR, viewportId: s.idViewport });
      }
    }
  });
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
    if (d.viewport.getImageIds().length <= idx) return undefined; // série ainda sendo (re)carregada
    if (d.viewport.getCurrentImageIdIndex() === idx) return undefined;
    void d.viewport.setImageIdIndex(idx).catch(() => undefined);
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
    // Layout de comparação PET/CT: leva também a outra linha (outro exame) à mesma posição anatômica.
    if (comparacaoPetCtLayout) {
      const posGeo = so.pilha && so.viewport ? obterPosicaoCorteAtual(so.pilha, so.viewport) : undefined;
      if (posGeo !== undefined) {
        for (const outro of gruposSincroniaEstudo()) {
          if (outro === grupo) continue;
          const link = vinculoEntreGrupos(grupo, outro);
          if (!link) continue;
          const alvoGeo = mapPosition(link, posGeo);
          for (const d of outro) {
            if (!d.pilha || !d.viewport) continue;
            if ('setImageIdIndex' in d.viewport) {
              const posicoes = d.pilha.geometry.positions;
              const passo = d.pilha.instances[0]?.sliceThickness ?? 5;
              if (posicoes.length === 0 || Math.abs(posicoes[nearestIndex(posicoes, alvoGeo)]! - alvoGeo) > Math.max(passo, 1)) continue;
            }
            const nGeo = d.pilha.geometry.normal;
            const nCam = normalDoSlot(d);
            const sinalCam = !('setImageIdIndex' in d.viewport) && nGeo && nCam && nGeo[0] * nCam[0] + nGeo[1] * nCam[1] + nGeo[2] * nCam[2] < 0 ? -1 : 1;
            const usada = irParaPosicaoMm(d, alvoGeo * sinalCam);
            if (usada !== undefined) indicesImpostosPorEstudo.set(d.indice, usada);
          }
        }
      }
    }
  } finally {
    sincronizandoEstudo = false;
  }
}

/** Vínculo (deslocamento em mm) entre as TCs de dois grupos de estudos diferentes; null se não der. */
function vinculoEntreGrupos(a: Slot[], b: Slot[]): ScrollLink | null {
  const anat = (g: Slot[]): StackNode | null => (g.find((s) => emFusao(s)) ?? g[0])?.pilha ?? null;
  const pa = anat(a);
  const pb = anat(b);
  if (!pa || !pb) return null;
  const chave = `${pa.id}|${pb.id}`;
  if (!vinculosEntreGrupos.has(chave)) vinculosEntreGrupos.set(chave, criarVinculoComparacao(pa, pb).link);
  return vinculosEntreGrupos.get(chave) ?? null;
}

let linhasReferenciaLigadas = true;
let linhasReferenciaAtivas: string | null = null;

/**
 * Linhas de referência: com cortes em planos diferentes no layout (ex.: axial e coronal, PET, TC e
 * fusão), o viewport ativo mostra nos outros onde o seu corte cruza. Só com 2+ planos distintos.
 */
function atualizarLinhasReferencia(): void {
  let origem: string | null = null;
  if (linhasReferenciaLigadas && !mprAtivo) {
    const vis = slots.filter((s) => !s.celula.hidden && s.habilitado && s.viewport && !semCortes(s));
    const normais = vis.map((s) => normalDoSlot(s));
    let planosDiferentes = false;
    for (let i = 0; i < vis.length && !planosDiferentes; i++) {
      for (let j = i + 1; j < vis.length; j++) {
        const a = normais[i];
        const b = normais[j];
        if (a && b && Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) < 0.9) {
          planosDiferentes = true;
          break;
        }
      }
    }
    if (planosDiferentes) {
      const fonte = vis.find((s) => s.indice === ativo) ?? vis[0];
      origem = fonte?.idViewport ?? null;
    }
  }
  if (origem === linhasReferenciaAtivas) return;
  linhasReferenciaAtivas = origem;
  definirLinhasReferencia(origem);
}

export function alternarLinhasReferencia(): void {
  linhasReferenciaLigadas = !linhasReferenciaLigadas;
  linhasReferenciaAtivas = '#forcar';
  atualizarLinhasReferencia();
  sincronizar();
}

let sincronizandoCameraEstudo = false;

/**
 * Copia a escala física em milímetros (`parallelScale`) e o centro anatômico no plano do corte
 * (`focalPoint` projetado no plano de destino) entre dois viewports.
 * Assim, mesmo quando uma série tem FOV maior que outra (ex.: PET de 700 mm vs TC de 450 mm),
 * o paciente fica exatamente do mesmo tamanho e alinhado nos dois quadros.
 */
function copiarCameraFisicaNoMesmoPlano(
  origemVp: Types.IStackViewport | Types.IVolumeViewport,
  destinoVp: Types.IStackViewport | Types.IVolumeViewport,
  mesmoReferencial: boolean,
): void {
  const camO = origemVp.getCamera();
  const camD = destinoVp.getCamera();
  if (
    camO.parallelScale === undefined ||
    !Number.isFinite(camO.parallelScale) ||
    camO.parallelScale <= 0
  ) {
    return;
  }

  if (mesmoReferencial && camO.focalPoint && camD.focalPoint && camD.position && camD.viewPlaneNormal) {
    const nD = camD.viewPlaneNormal;
    const diffX = camO.focalPoint[0] - camD.focalPoint[0];
    const diffY = camO.focalPoint[1] - camD.focalPoint[1];
    const diffZ = camO.focalPoint[2] - camD.focalPoint[2];
    const aoNormal = diffX * nD[0] + diffY * nD[1] + diffZ * nD[2];
    const dx = diffX - aoNormal * nD[0];
    const dy = diffY - aoNormal * nD[1];
    const dz = diffZ - aoNormal * nD[2];

    const mudouEscala =
      camD.parallelScale === undefined || Math.abs(camD.parallelScale - camO.parallelScale) > 0.05;
    const mudouCentro = Math.hypot(dx, dy, dz) > 0.05;
    if (!mudouEscala && !mudouCentro) return;

    destinoVp.setCamera({
      parallelScale: camO.parallelScale,
      focalPoint: [camD.focalPoint[0] + dx, camD.focalPoint[1] + dy, camD.focalPoint[2] + dz],
      position: [camD.position[0] + dx, camD.position[1] + dy, camD.position[2] + dz],
    });
    destinoVp.render();
    return;
  }

  // Entre estudos diferentes (ex.: comparação ATUAL × ANTERIOR): iguala o tamanho físico em mm e o pan.
  const mudouEscala =
    camD.parallelScale === undefined || Math.abs(camD.parallelScale - camO.parallelScale) > 0.05;
  if (mudouEscala) {
    destinoVp.setCamera({ parallelScale: camO.parallelScale });
  }
  const pan = origemVp.getPan?.();
  const pt = destinoVp.getPan?.();
  const mudouPan = Boolean(pan && (!pt || Math.abs(pt[0] - pan[0]) > 0.01 || Math.abs(pt[1] - pan[1]) > 0.01));
  if (pan && mudouPan) {
    destinoVp.setPan?.(pan);
  }
  if (mudouEscala || mudouPan) {
    destinoVp.render();
  }
}

/**
 * Sincroniza o zoom físico (em mm) e o centro anatômico no plano entre os cortes do mesmo estudo/plano
 * (tanto viewports de pilha 2D quanto volumes de fusão e planos reconstruídos).
 */
function aoMudarCameraEstudo(origem: number): void {
  // Comparação com fusões (volumes): zoom/pan copiados entre os dois lados quando ligados.
  if (compararAtivo && !mprAtivo) {
    if (!zoomPanCompararLigado || sincronizandoCameraEstudo || (origem !== 0 && origem !== 1)) return;
    const so = slots[origem];
    const d = slots[origem === 0 ? 1 : 0];
    if (!so?.viewport || !d?.viewport || semCortes(so) || semCortes(d)) return;
    if ('setImageIdIndex' in so.viewport && 'setImageIdIndex' in d.viewport) return;
    const v = so.viewport as Types.IStackViewport | Types.IVolumeViewport;
    const t = d.viewport as Types.IStackViewport | Types.IVolumeViewport;
    sincronizandoCameraEstudo = true;
    try {
      copiarCameraFisicaNoMesmoPlano(v, t, false);
    } finally {
      sincronizandoCameraEstudo = false;
    }
    return;
  }
  if (!sincroniaEstudoLigada || !zoomPanEstudoLigado || sincronizandoCameraEstudo || compararAtivo || mprAtivo) return;
  const so = slots[origem];
  if (!so?.viewport || !so.pilha || semCortes(so)) return;
  const grupo = gruposSincroniaEstudo().find((g) => g.includes(so));
  if (!grupo) return;
  const destinosMesmoEstudo = destinosNoMesmoPlano(grupo, so);
  const destinosOutroEstudo: Array<{ d: Slot; sinal: 1 | -1 }> = [];
  // Layout de comparação PET/CT: o zoom e o pan também vão para a outra linha (outro exame).
  if (comparacaoPetCtLayout) {
    const outras = gruposSincroniaEstudo().filter((g) => g !== grupo).flat();
    destinosOutroEstudo.push(...destinosNoMesmoPlano(outras, so));
  }
  if (destinosMesmoEstudo.length === 0 && destinosOutroEstudo.length === 0) return;
  const v = so.viewport as Types.IStackViewport | Types.IVolumeViewport;
  sincronizandoCameraEstudo = true;
  try {
    for (const { d } of destinosMesmoEstudo) {
      const t = d.viewport as Types.IStackViewport | Types.IVolumeViewport | undefined;
      if (!t || semCortes(d)) continue;
      copiarCameraFisicaNoMesmoPlano(v, t, true);
    }
    for (const { d } of destinosOutroEstudo) {
      const t = d.viewport as Types.IStackViewport | Types.IVolumeViewport | undefined;
      if (!t || semCortes(d)) continue;
      copiarCameraFisicaNoMesmoPlano(v, t, false);
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
  atualizarLinhasReferencia();
  atualizarMascaras();
  for (const x of slots) {
    x.cubo.atualizar();
    x.botaoDadosPet.hidden = x.celula.hidden || !x.pilha?.instances.some((i) => i.modality === 'PT');
    atualizarBotaoVoltarSlot(x);
    atualizarScrubberSlot(x);
    aplicarFiltroAoSlot(x);
  }
  document.dispatchEvent(new CustomEvent<EstadoViewports>(EVENTO_ESTADO_VIEWPORTS, { detail: estadoAtual() }));
}

// ---------- segmentação (fase 9.1) ----------

/** Quadro pronto para receber a máscara: habilitado, com imagem e com cortes (não 3D nem MIP). */
function prontoParaMascara(s: Slot): boolean {
  if (s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha || s.montandoVolume || semCortes(s)) return false;
  try {
    return 'setImageIdIndex' in s.viewport ? !!s.viewport.getCurrentImageId() : s.viewport.getActors().length > 0;
  } catch {
    return false;
  }
}

/** Mostra a máscara da série em cada quadro que a exibe (e tira dos que mudaram de série). */
function atualizarMascaras(): void {
  try {
    mostrarNosViewports(
      slots.filter(prontoParaMascara).map((s) => ({ idViewport: s.idViewport, pilhaId: s.pilha?.id ?? null })),
    );
  } catch (e) {
    console.warn('Segmentação: não foi possível mostrar a máscara.', e);
  }
}

let criandoSegmentacao: Promise<void> | null = null;

interface SnapshotAmbienteSegmentacao {
  layoutAnterior: Layout;
  mprAnterior: boolean;
  slotsAnteriores: typeof estadoAntesDoMpr;
  pilhaAlvo: StackNode;
}
let snapshotAmbienteSeg: SnapshotAmbienteSegmentacao | null = null;

function capturarSnapshotSlots(): typeof estadoAntesDoMpr {
  return slots.map((s) => ({
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

/**
 * Entra no ambiente dedicado de segmentação (colocando a sequência selecionada em MPR se
 * ela suportar volume) e cria a segmentação da série, se ainda não houver.
 */
export async function garantirSegmentacaoAtiva(): Promise<void> {
  const slotInicial =
    (slots[ativo] && !slots[ativo]!.celula.hidden && slots[ativo]!.pilha ? slots[ativo] : undefined) ??
    slots.find((s) => !s.celula.hidden && s.pilha && !semCortes(s)) ??
    slots.find((s) => s.pilha !== null);
  const stack = slotInicial?.pilha ?? null;
  if (!slotInicial || !stack) return;

  if (emModoSegmentacao() && !snapshotAmbienteSeg) {
    snapshotAmbienteSeg = {
      layoutAnterior: layoutAtual,
      mprAnterior: mprAtivo,
      slotsAnteriores: mprAtivo && estadoAntesDoMpr.length > 0 ? [...estadoAntesDoMpr] : capturarSnapshotSlots(),
      pilhaAlvo: stack,
    };

    if (!mprAtivo) {
      desmaximizar();
      if (compararAtivo) desativarComparacaoInterno();
      if (avaliarVolume(stack).ok) {
        await montarLayoutMpr(
          stack,
          slotInicial.pilhaFusao ? { pet: slotInicial.pilhaFusao, config: { ...slotInicial.fusao } } : undefined,
        );
      } else if (layoutAtual !== '1x1') {
        ativo = 0;
        if (slotInicial.indice !== 0) {
          await abrirPilha2d(stack);
        }
        await definirLayout('1x1');
      }
    }
  }

  const slotAlvo =
    slots.find((s) => !s.celula.hidden && s.pilha?.id === stack.id && !semCortes(s)) ??
    slots[ativo] ??
    slots[0];
  await garantirSegmentacaoNoSlot(slotAlvo);
}

/**
 * Alterna a disposição visual dentro do Ambiente de Segmentação sem sair dele:
 * - `'mpr'`: Axial + Coronal + Sagital sincronizados da sequência ativa;
 * - `'2d'`: Corte 2D grande (`1x1`) da sequência ativa;
 * - `'3d'`: Corte 2D + Reconstrução 3D lado a lado (`1x2`).
 */
export async function definirVistaAmbienteSegmentacao(vista: 'mpr' | '2d' | '3d'): Promise<void> {
  const stack = snapshotAmbienteSeg?.pilhaAlvo ?? slots[ativo]?.pilha ?? slots[0]?.pilha ?? null;
  if (!stack) return;

  if (vista === 'mpr') {
    if (mprAtivo) return;
    if (avaliarVolume(stack).ok) {
      await montarLayoutMpr(stack);
      if (snapshotAmbienteSeg) {
        estadoAntesDoMpr = [...snapshotAmbienteSeg.slotsAnteriores];
      }
    }
    return;
  }

  if (vista === '2d') {
    if (mprAtivo) {
      estadoAntesDoMpr = [
        {
          pilha: stack,
          planoSlot: 'original',
          modoSlab: 'normal',
          slabMm: 1,
          pilhaFusao: null,
          fusao: { opacidade: 0.5, colormap: NOME_HOT_IRON, teto: 10, minimo: 0 },
          corte: undefined,
        },
      ];
      await sairDoMpr('1x1');
      return;
    }
    if (layoutAtual !== '1x1' || slots[0]?.planoSlot === '3d' || slots[0]?.planoSlot === 'mip-rotatorio') {
      if (slots[1]) slots[1].planoSlot = 'original';
      if (slots[0]) slots[0].planoSlot = 'original';
      ativo = 0;
      await definirLayout('1x1');
    }
    return;
  }

  if (vista === '3d') {
    await abrir3dParaPilhaAtiva();
  }
}

/**
 * Devolve todas as sequências (`StackNode`) pertencentes ao mesmo estudo (`StudyNode`) da sequência informada.
 */
export function pilhasDoMesmoEstudo(stack: StackNode | null | undefined): StackNode[] {
  if (!stack) return [];
  const estudo = estudoDaPilha(stack);
  if (!estudo) return [stack];
  const lista = estudo.series.flatMap((sr) => sr.stacks);
  return lista.length > 0 ? lista : [stack];
}

/**
 * Troca a sequência ativa dentro do Ambiente de Segmentação (mantendo o snapshot do exame de origem
 * intacto para quando o usuário clicar em "Concluir e voltar ao exame").
 */
export async function trocarSequenciaAmbienteSegmentacao(novaPilha: StackNode): Promise<void> {
  if (snapshotAmbienteSeg) {
    snapshotAmbienteSeg.pilhaAlvo = novaPilha;
  }
  const tinha3d = slots.some((s) => !s.celula.hidden && s.planoSlot === '3d');
  if (avaliarVolume(novaPilha).ok) {
    if (mprAtivo || (!tinha3d && layoutAtual !== '1x1')) {
      await montarLayoutMpr(novaPilha);
      if (snapshotAmbienteSeg) {
        estadoAntesDoMpr = [...snapshotAmbienteSeg.slotsAnteriores];
      }
    } else if (tinha3d) {
      if (slots[1]) slots[1].planoSlot = 'original';
      ativo = 0;
      await definirLayout('1x1');
      await abrirPilha2d(novaPilha);
      await abrir3dParaPilhaAtiva();
    } else {
      ativo = 0;
      await abrirPilha2d(novaPilha);
    }
  } else {
    if (mprAtivo) {
      estadoAntesDoMpr = [
        {
          pilha: novaPilha,
          planoSlot: 'original',
          modoSlab: 'normal',
          slabMm: 1,
          pilhaFusao: null,
          fusao: { opacidade: 0.5, colormap: NOME_HOT_IRON, teto: 10, minimo: 0 },
          corte: undefined,
        },
      ];
      await sairDoMpr('1x1');
    } else {
      for (const s of slots) {
        if (s.planoSlot === '3d' || s.planoSlot === 'mip-rotatorio') s.planoSlot = 'original';
      }
      ativo = 0;
      if (layoutAtual !== '1x1') await definirLayout('1x1');
      await abrirPilha2d(novaPilha);
    }
  }
  const slotAlvo =
    slots.find((s) => !s.celula.hidden && s.pilha?.id === novaPilha.id && !semCortes(s)) ??
    slots[ativo] ??
    slots[0];
  await garantirSegmentacaoNoSlot(slotAlvo);
  sincronizar();
}

function garantirSegmentacaoNoSlot(slot: Slot | undefined): Promise<void> {
  criandoSegmentacao ??= (async () => {
    const stack = slot?.pilha;
    if (!slot || !stack || segmentacaoDaPilha(stack.id)) return;
    if (semCortes(slot)) {
      mostrarAvisoVolume(slot, ['Para segmentar, use um quadro de cortes (original, axial, coronal ou sagital).']);
      return;
    }
    const res = adquirirVolume(stack, slot.ids);
    if (!res.ok) {
      mostrarAvisoVolume(slot, [`Segmentação indisponível: ${res.mensagens.join(' · ')}`]);
      return;
    }
    let liberado = false;
    const liberar = (): void => {
      if (liberado) return;
      liberado = true;
      liberarVolume(stack.id);
    };
    try {
      await res.promessa;
      criarSegmentacao(stack.id, res.volumeId, liberar);
    } catch (e) {
      liberar();
      mostrarAvisoVolume(slot, [`Não foi possível criar a segmentação (${textoDoErro(e)}).`]);
    }
    sincronizar();
  })().finally(() => {
    criandoSegmentacao = null;
  });
  return criandoSegmentacao;
}

/**
 * Reabre uma segmentação salva (.vseg) na série aberta de mesmo UID, conferindo a grade.
 * Devolve uma mensagem para o usuário (sucesso ou motivo da recusa).
 */
export async function abrirSegmentacaoSalva(bytes: Uint8Array): Promise<string> {
  const { cabecalho, rotulos } = await lerSegmentacao(bytes);
  const slot =
    (slots[ativo]?.pilha?.instances[0]?.seriesInstanceUid === cabecalho.serieUid ? slots[ativo] : undefined) ??
    slots.find(
      (s) =>
        !s.celula.hidden && !semCortes(s) && s.pilha?.instances[0]?.seriesInstanceUid === cabecalho.serieUid,
    );
  const stack = slot?.pilha;
  if (!slot || !stack) {
    return `Abra a série da segmentação (${cabecalho.serie || cabecalho.serieUid}) num quadro de cortes e tente de novo.`;
  }
  const jaTinha = !!segmentacaoDaPilha(stack.id);
  if (jaTinha && temVoxelsPintados(stack.id)) {
    if (!window.confirm('Esta série já tem uma segmentação. Substituir pela do arquivo?')) return 'Nada foi alterado.';
  }
  definirModoSegmentacao(true);
  ativarViewport(slot.indice);
  await garantirSegmentacaoAtiva();
  const geometria = geometriaDaSegmentacao(stack.id);
  if (!geometria) return 'Não foi possível preparar a segmentação desta série.';
  const motivo = conferirSegmentacao(cabecalho, { serieUid: stack.instances[0]?.seriesInstanceUid, geometria });
  if (motivo) {
    if (!jaTinha) apagarSegmentacao(stack.id);
    return `Segmentação não aplicada: ${motivo}`;
  }
  aplicarSegmentacaoSalva(stack.id, cabecalho.segmentos, cabecalho.ativo, rotulos);
  sincronizar();
  const n = cabecalho.segmentos.length;
  return `Segmentação reaberta: ${n} segmento${n === 1 ? '' : 's'}.`;
}

/**
 * Sai do ambiente dedicado de segmentação: restaura a disposição anterior dos quadros
 * (mantendo os segmentos já pintados visíveis na série) e devolve o botão esquerdo para a navegação.
 */
export function sairModoSegmentacaoUI(): void {
  definirModoSegmentacao(false);
  const snap = snapshotAmbienteSeg;
  snapshotAmbienteSeg = null;

  void (async () => {
    if (snap) {
      if (snap.mprAnterior) {
        if (!mprAtivo && avaliarVolume(snap.pilhaAlvo).ok) {
          await montarLayoutMpr(snap.pilhaAlvo);
        }
        estadoAntesDoMpr = [...snap.slotsAnteriores];
      } else if (mprAtivo) {
        estadoAntesDoMpr = [...snap.slotsAnteriores];
        await sairDoMpr(snap.layoutAnterior);
      } else {
        // Caso o usuário tenha alternado para 2D (1x1) ou 2D+3D (1x2) dentro do ambiente de segmentação
        for (const s of slots) {
          if (s.planoSlot === '3d' || s.planoSlot === 'mip-rotatorio') {
            s.planoSlot = 'original';
          }
        }
        if (layoutAtual !== snap.layoutAnterior) {
          await definirLayout(snap.layoutAnterior);
        } else if (slots[0]?.planoSlot !== (snap.slotsAnteriores[0]?.planoSlot ?? 'original')) {
          await definirPlanoSlotAtivo(snap.slotsAnteriores[0]?.planoSlot ?? 'original');
        }
      }
    }
    if (ehFerramentaSegmentacao(ferramentaPrimariaAtual())) {
      escolherFerramentaPrimaria(mprAtivo ? 'Crosshairs' : 'StackScroll');
    }
    sincronizar();
  })();
}

/**
 * Vaso (fase 10.2): a partir de um clique 2D/MPR, cresce de forma contígua em 3D pela faixa
 * configurável `[huReferencia + deltaMin, huReferencia + deltaMax]` (padrão -80 a +300 HU)
 * e cria um novo segmento ("Vaso N") ou aplica no segmento ativo.
 */
async function vasoNoPonto(idVp: string, mundo: [number, number, number]): Promise<string> {
  const slot = slots.find((s) => s.idViewport === idVp);
  const stack = slot?.pilha;
  if (!slot || !stack) return 'Série não encontrada no quadro.';
  if (!segmentacaoDaPilha(stack.id)) await garantirSegmentacaoNoSlot(slot);
  const seg = segmentacaoDaPilha(stack.id);
  if (!seg) return 'Crie a segmentação antes (Novo segmento).';

  const cfg = vasoConfig();
  if (!cfg.novoSegmento && seg.segmentos.find((x) => x.indice === seg.ativo)?.bloqueado) {
    return 'O segmento ativo está bloqueado.';
  }

  const v = await carregarVoxels(stack, slot.ids);
  if ('erro' in v) return v.erro;
  const ijk = worldToVoxel(v.grid, mundo);
  if (!ijk) return 'O ponto está fora do volume.';
  const [nx, ny, nz] = v.grid.dims;
  const semente: [number, number, number] = [Math.round(ijk[0]), Math.round(ijk[1]), Math.round(ijk[2])];
  const [i, j, k] = semente;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 'O ponto está fora do volume.';

  const volEscalar = { data: v.data, grid: v.grid };
  const ehTc = stack.instances[0]?.modality === 'CT';
  const huCentro = v.data[i + j * nx + k * nx * ny]!;
  const faixaInteligente = calcularFaixaInteligenteVaso(huCentro, cfg.modo, cfg.alcancePct, ehTc);

  const res = crescerVaso(volEscalar, semente, {
    deltaMin: faixaInteligente.deltaMin,
    deltaMax: faixaInteligente.deltaMax,
    ...(faixaInteligente.pisoMin !== undefined ? { pisoMin: faixaInteligente.pisoMin } : {}),
    ...(faixaInteligente.tetoMax !== undefined ? { tetoMax: faixaInteligente.tetoMax } : {}),
  });
  if (res.indices.length === 0) return 'Nenhum voxel conectado encontrado na faixa do vaso.';

  const alvo = cfg.novoSegmento
    ? prepararSegmentoVaso(stack.id, faixaInteligente.modoEfetivo)
    : seg.segmentos.find((x) => x.indice === seg.ativo);
  if (!alvo) return 'Não foi possível criar um novo segmento (limite de 255 segmentos).';

  const pintura = pintarIndices(stack.id, res.indices, nx * ny);
  registrarUltimaSementeVaso(stack.id, {
    seedIjk: res.semente,
    segmentoIndice: alvo.indice,
    indicesPintados: pintura.indices,
  });

  return textoStatusVaso(stack, alvo.nome, res);
}

function textoStatusVaso(
  stack: StackNode,
  nomeSegmento: string,
  res: { indices: Int32Array; min: number; max: number; huReferencia: number; volumeMl: number },
): string {
  const ehPet = stack.instances.some((x) => x.modality === 'PT');
  const un = unidadeDaSerie(stack);
  const casas = ehPet ? 2 : 0;
  const fmt = (x: number): string => formatarValor(x, casas);
  const faixaTexto = `${fmt(res.min)} a ${fmt(res.max)}${un ? ' ' + un : ''}`;
  const volTexto =
    res.volumeMl > 0
      ? ` · ${res.volumeMl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mL`
      : '';
  return `Vaso ("${nomeSegmento}"): ${res.indices.length.toLocaleString('pt-BR')} voxels${volTexto} (ref. ${fmt(res.huReferencia)}${un ? ' ' + un : ''}, faixa ${faixaTexto}).`;
}

async function recalcularVasoDaPilha(
  pilhaId: string,
  cor?: [number, number, number],
): Promise<string | undefined> {
  const ultima = ultimaSementeVasoDa(pilhaId);
  const seg = segmentacaoDaPilha(pilhaId);
  const slot = slots.find((s) => s.pilha?.id === pilhaId);
  const stack = slot?.pilha;
  if (!ultima || !seg || !slot || !stack) return undefined;
  const alvo = seg.segmentos.find((x) => x.indice === ultima.segmentoIndice);
  if (!alvo || alvo.bloqueado) return undefined;

  const v = await carregarVoxels(stack, slot.ids);
  if ('erro' in v) return v.erro;
  if (cor) definirCorSegmento(pilhaId, alvo.indice, cor);

  const cfg = vasoConfig();
  const volEscalar = { data: v.data, grid: v.grid };
  const ehTc = stack.instances[0]?.modality === 'CT';
  const [nx, ny] = v.grid.dims;
  const [si, sj, sk] = ultima.seedIjk;
  const huCentro = v.data[si + sj * nx + sk * nx * ny]!;
  const faixaInteligente = calcularFaixaInteligenteVaso(huCentro, cfg.modo, cfg.alcancePct, ehTc);

  const res = crescerVaso(volEscalar, ultima.seedIjk, {
    deltaMin: faixaInteligente.deltaMin,
    deltaMax: faixaInteligente.deltaMax,
    ...(faixaInteligente.pisoMin !== undefined ? { pisoMin: faixaInteligente.pisoMin } : {}),
    ...(faixaInteligente.tetoMax !== undefined ? { tetoMax: faixaInteligente.tetoMax } : {}),
  });
  ultima.indicesPintados = reaplicarIndicesNoSegmento(
    pilhaId,
    alvo.indice,
    ultima.indicesPintados,
    res.indices,
    nx * ny,
  );
  return textoStatusVaso(stack, alvo.nome, res);
}

/** Distância máxima (mm) entre dois cortes pintados para o pincel preencher os cortes entre eles. */
const LIMITE_LIGAR_CORTES_MM = 20;

// Pincel: ao soltar o botão, o miolo de um contorno fechado pela pincelada é preenchido e
// os cortes pintados próximos (até 20 mm) são ligados quando "Auto-ligar cortes" está ativo (padrão).
// Segurar Shift com o Pincel apaga temporariamente como borracha sem precisar trocar de ferramenta.
function iniciarPreenchimentoDoPincel(): void {
  let pincelada: { pilhaId: string; corte: CorteDaMascara; antes: Set<number> } | null = null;
  let apagandoComShift = false;

  grade.addEventListener(
    'mousedown',
    (ev) => {
      pincelada = null;
      if (ev.button !== 0 || ferramentaPrimariaAtual() !== NOME_PINCEL || !(ev.target instanceof Node)) return;
      const slot = slots.find((s) => s.elemento.contains(ev.target as Node));
      const v = slot?.viewport;
      if (!slot?.pilha || !v || semCortes(slot) || !segmentacaoDaPilha(slot.pilha.id)) return;

      if (ev.shiftKey) {
        const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
        if (grupo?.hasTool(NOME_PINCEL)) {
          grupo.setToolConfiguration(NOME_PINCEL, { activeStrategy: 'ERASE_INSIDE_CIRCLE' });
          apagandoComShift = true;
        }
        return;
      }

      const camera = v.getCamera();
      if (!camera.viewPlaneNormal || !camera.focalPoint) return;
      const fp = camera.focalPoint;
      const corte = corteDaMascara(slot.pilha.id, camera.viewPlaneNormal, [fp[0], fp[1], fp[2]]);
      if (!corte) return;
      pincelada = { pilhaId: slot.pilha.id, corte, antes: buracosDoCorte(slot.pilha.id, corte) };
    },
    true,
  );
  window.addEventListener(
    'mouseup',
    () => {
      if (apagandoComShift) {
        apagandoComShift = false;
        const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
        if (grupo?.hasTool(NOME_PINCEL)) {
          grupo.setToolConfiguration(NOME_PINCEL, { activeStrategy: 'FILL_INSIDE_CIRCLE' });
        }
      }
      const p = pincelada;
      pincelada = null;
      // Depois de o pincel do Cornerstone terminar a pincelada deste mesmo mouseup.
      if (!p) return;
      setTimeout(() => {
        preencherBuracosNovos(p.pilhaId, p.corte, p.antes);
        if (!autoLigarCortesPincel()) return;
        const ligados = ligarCortesProximos(p.pilhaId, p.corte, LIMITE_LIGAR_CORTES_MM);
        if (ligados > 0) {
          document.dispatchEvent(
            new CustomEvent(EVENTO_MENSAGEM_SEGMENTACAO, {
              detail: `Pincel: ${ligados} ${ligados === 1 ? 'corte intermediário ligado' : 'cortes intermediários ligados'} automaticamente.`,
            }),
          );
        }
      }, 0);
    },
    true,
  );
}

/** Liga manualmente o corte visível no viewport ativo aos cortes próximos pintados no segmento ativo. */
export function ligarCortesProximosNoViewportAtivo(): number {
  const slot = slots[ativo];
  const v = slot?.viewport;
  if (!slot?.pilha || !v || semCortes(slot) || !segmentacaoDaPilha(slot.pilha.id)) return 0;
  const camera = v.getCamera();
  if (!camera.viewPlaneNormal || !camera.focalPoint) return 0;
  const fp = camera.focalPoint;
  const corte = corteDaMascara(slot.pilha.id, camera.viewPlaneNormal, [fp[0], fp[1], fp[2]]);
  if (!corte) return 0;
  return ligarCortesProximos(slot.pilha.id, corte, LIMITE_LIGAR_CORTES_MM);
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

async function garantirViewport3d(slot: Slot): Promise<Types.IVolumeViewport> {
  const [motor, mod3d] = await Promise.all([iniciarCornerstone(), carregarModulo3d()]);
  if (slot.habilitado) {
    await desabilitar(slot, false);
  }
  slot.planoMpr = PLANOS_SLOTS['3d'];
  slot.tipoViewport = Enums.ViewportType.VOLUME_3D;
  motor.enableElement({
    viewportId: slot.idViewport,
    type: Enums.ViewportType.VOLUME_3D,
    element: slot.elemento,
    defaultOptions: {
      orientation: Enums.OrientationAxis.CORONAL,
      background: [0, 0, 0],
    },
  });
  mod3d.adicionarAoGrupo3d(slot.idViewport);
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
  if (slot.controlador3d) {
    slot.controlador3d.destruir();
    slot.controlador3d = undefined;
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
  modulo3dCache?.removerDoGrupo3d(slot.idViewport);
  motor.disableElement(slot.idViewport);
  esquecerPlanoGirado(slot.idViewport);
  slot.viewport = undefined;
  slot.planoMpr = undefined;
  slot.habilitado = false;
  slot.cubo.atualizar();
}

/** Janela da TC na fusão: a 1ª predefinição (partes moles por padrão), em vez da janela do arquivo. */
function voiTcDaFusao(stack: StackNode): { lower: number; upper: number } | undefined {
  if (!stack.instances.some((i) => i.modality === 'CT')) return undefined;
  const p = predefinicoes()[0];
  return p ? { lower: p.centro - p.largura / 2, upper: p.centro + p.largura / 2 } : undefined;
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

export interface OuvinteSegundaJanela {
  aoRolar: (msg: MensagemSincRolagem) => void;
  aoMudarJanela: (msg: MensagemSincJanela) => void;
  aoLocalizar: (msg: MensagemSincLocalizador) => void;
  aoLimparLocalizador: () => void;
}

let ouvinteSegundaJanela: OuvinteSegundaJanela | null = null;
let aplicandoSincRemota = false;
const posicoesImpostasRemotas = new Map<number, number>();
let ultimoCorteRemoto: MensagemSincRolagem | null = null;
let mostrarLinhaRemota = true;

export function definirOuvinteSegundaJanela(ouvinte: OuvinteSegundaJanela | null): void {
  ouvinteSegundaJanela = ouvinte;
}

function pontoNoPlanoDoSlot(slot: Slot): [number, number, number] | undefined {
  if (!slot.viewport || !slot.pilha) return undefined;
  if ('setImageIdIndex' in slot.viewport) {
    const idx = slot.viewport.getCurrentImageIdIndex();
    const inst = slot.pilha.instances[idx] ?? slot.pilha.instances[0];
    return inst?.imagePositionPatient as [number, number, number] | undefined;
  }
  const fp = slot.viewport.getCamera().focalPoint;
  return fp ? [fp[0], fp[1], fp[2]] : undefined;
}

function cantosMundoDoSlot(
  slot: Slot,
): [[number, number, number], [number, number, number], [number, number, number], [number, number, number]] | undefined {
  if (!slot.viewport || !slot.pilha) return undefined;
  if ('setImageIdIndex' in slot.viewport) {
    const idx = slot.viewport.getCurrentImageIdIndex();
    const inst = slot.pilha.instances[idx] ?? slot.pilha.instances[0];
    if (!inst) return undefined;
    return cantosMundoDaInstancia(inst) ?? undefined;
  }
  try {
    const w = slot.elemento.clientWidth;
    const h = slot.elemento.clientHeight;
    if (w <= 0 || h <= 0) return undefined;
    const c0 = slot.viewport.canvasToWorld([0, 0]);
    const c1 = slot.viewport.canvasToWorld([w, 0]);
    const c2 = slot.viewport.canvasToWorld([w, h]);
    const c3 = slot.viewport.canvasToWorld([0, h]);
    if (!c0 || !c1 || !c2 || !c3) return undefined;
    return [
      [c0[0], c0[1], c0[2]],
      [c1[0], c1[1], c1[2]],
      [c2[0], c2[1], c2[2]],
      [c3[0], c3[1], c3[2]],
    ];
  } catch {
    return undefined;
  }
}

function calcularLinhaReferenciaRemotaCanvas(slot: Slot): [[number, number], [number, number]] | null {
  if (
    !mostrarLinhaRemota ||
    !ultimoCorteRemoto?.cantosMundo ||
    !slot.pilha ||
    !slot.viewport ||
    !slot.habilitado ||
    slot.celula.hidden ||
    semCortes(slot)
  ) {
    return null;
  }
  const inst = slot.pilha.instances[0];
  const normal = normalDoSlot(slot);
  const pPlano = pontoNoPlanoDoSlot(slot);
  if (!inst || !normal || !pPlano) return null;
  const decisao = decidirSincRolagemSlot(ultimoCorteRemoto, {
    studyInstanceUid: inst.studyInstanceUid ?? '',
    ...(inst.frameOfReferenceUid ? { frameOfReferenceUid: inst.frameOfReferenceUid } : {}),
    normal,
    positions: slot.pilha.geometry.positions,
    ...(inst.sliceThickness !== undefined ? { sliceThickness: inst.sliceThickness } : {}),
    ehPilha2d: 'setImageIdIndex' in slot.viewport,
  });
  if (decisao.acao !== 'linha-referencia') return null;
  const seg = intersecaoQuadComPlano(ultimoCorteRemoto.cantosMundo, pPlano, normal);
  if (!seg) return null;
  try {
    const p1 = slot.viewport.worldToCanvas([seg[0][0], seg[0][1], seg[0][2]]);
    const p2 = slot.viewport.worldToCanvas([seg[1][0], seg[1][1], seg[1][2]]);
    if (!p1 || !p2) return null;
    if (!Number.isFinite(p1[0]) || !Number.isFinite(p1[1]) || !Number.isFinite(p2[0]) || !Number.isFinite(p2[1])) {
      return null;
    }
    return [
      [p1[0], p1[1]],
      [p2[0], p2[1]],
    ];
  } catch {
    return null;
  }
}

function atualizarMiraSlot(slot: Slot): void {
  if (!slot.viewport || !slot.habilitado || slot.celula.hidden || semCortes(slot)) {
    desenharMiraNoCanvas(slot.canvasMira, null, '#38bdf8', null);
    return;
  }
  const linhaCanvas = calcularLinhaReferenciaRemotaCanvas(slot);
  if (!slot.pontoMiraMundo) {
    desenharMiraNoCanvas(slot.canvasMira, null, '#38bdf8', linhaCanvas);
    return;
  }
  try {
    const pontoCanvas = slot.viewport.worldToCanvas(slot.pontoMiraMundo);
    if (!pontoCanvas || !Number.isFinite(pontoCanvas[0]) || !Number.isFinite(pontoCanvas[1])) {
      desenharMiraNoCanvas(slot.canvasMira, null, '#38bdf8', linhaCanvas);
      return;
    }
    desenharMiraNoCanvas(slot.canvasMira, [pontoCanvas[0], pontoCanvas[1]], '#38bdf8', linhaCanvas);
  } catch {
    desenharMiraNoCanvas(slot.canvasMira, null, '#38bdf8', linhaCanvas);
  }
}

export function limparMirasLocalizador(): void {
  ultimoCorteRemoto = null;
  for (const s of slots) {
    s.pontoMiraMundo = null;
    desenharMiraNoCanvas(s.canvasMira, null, '#38bdf8', null);
  }
  if (!aplicandoSincRemota) {
    ouvinteSegundaJanela?.aoLimparLocalizador();
  }
}

function emitirRolagemSegundaJanela(indice: number): void {
  if (aplicandoSincRemota || !ouvinteSegundaJanela) return;
  const so = slots[indice];
  if (!so?.pilha || !so.viewport || so.celula.hidden || !so.habilitado || semCortes(so)) return;
  const posicao = posicaoDoSlot(so);
  const normal = normalDoSlot(so);
  const inst = so.pilha.instances[0];
  if (posicao === undefined || !normal || !inst) return;
  const imposta = posicoesImpostasRemotas.get(indice);
  if (imposta !== undefined && Math.abs(imposta - posicao) < 0.5) {
    posicoesImpostasRemotas.delete(indice);
    return;
  }
  const cantos = cantosMundoDoSlot(so);
  ouvinteSegundaJanela.aoRolar({
    tipo: 'sinc-rolagem',
    studyInstanceUid: inst.studyInstanceUid ?? '',
    ...(inst.frameOfReferenceUid ? { frameOfReferenceUid: inst.frameOfReferenceUid } : {}),
    normal,
    posicaoMm: posicao,
    ...(cantos ? { cantosMundo: cantos } : {}),
  });
}

function emitirJanelaSegundaJanela(indice: number): void {
  if (aplicandoSincRemota || !ouvinteSegundaJanela) return;
  const so = slots[indice];
  if (!so?.pilha || !so.viewport || so.celula.hidden || !so.habilitado || semCortes(so)) return;
  if (!('getProperties' in so.viewport)) return;
  const props = so.viewport.getProperties();
  const inst = so.pilha.instances[0];
  if (!props?.voiRange || !inst?.modality) return;
  ouvinteSegundaJanela.aoMudarJanela({
    tipo: 'sinc-janela',
    studyInstanceUid: inst.studyInstanceUid ?? '',
    modality: inst.modality,
    lower: props.voiRange.lower,
    upper: props.voiRange.upper,
    ...(props.invert !== undefined ? { invert: props.invert } : {}),
  });
}

export function aplicarRolagemDaOutraJanela(msg: MensagemSincRolagem, opcoes: OpcoesSincroniaJanelas): void {
  mostrarLinhaRemota = opcoes.linhas;
  ultimoCorteRemoto = opcoes.linhas ? msg : null;
  aplicandoSincRemota = true;
  try {
    for (const s of slots) {
      if (s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha || semCortes(s)) continue;
      const inst = s.pilha.instances[0];
      const normal = normalDoSlot(s);
      if (!inst || !normal) continue;
      const decisao = decidirSincRolagemSlot(msg, {
        studyInstanceUid: inst.studyInstanceUid ?? '',
        ...(inst.frameOfReferenceUid ? { frameOfReferenceUid: inst.frameOfReferenceUid } : {}),
        normal,
        positions: s.pilha.geometry.positions,
        ...(inst.sliceThickness !== undefined ? { sliceThickness: inst.sliceThickness } : {}),
        ehPilha2d: 'setImageIdIndex' in s.viewport,
      });
      if (decisao.acao === 'rolar' && opcoes.rolagem) {
        const usada = irParaPosicaoMm(s, decisao.alvoMm);
        if (usada !== undefined) {
          posicoesImpostasRemotas.set(s.indice, usada);
        }
      }
      atualizarMiraSlot(s);
    }
  } finally {
    aplicandoSincRemota = false;
  }
}

export function definirMostrarLinhaOutraJanela(ativo: boolean): void {
  mostrarLinhaRemota = ativo;
  if (!ativo) ultimoCorteRemoto = null;
  for (const s of slots) {
    atualizarMiraSlot(s);
  }
}

export function aplicarJanelaDaOutraJanela(msg: MensagemSincJanela): void {
  aplicandoSincRemota = true;
  try {
    for (const s of slots) {
      if (s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha || semCortes(s)) continue;
      if (!('setProperties' in s.viewport)) continue;
      const inst = s.pilha.instances[0];
      if (!inst) continue;
      if (!deveSincronizarJanelaSlot(msg, inst.modality)) {
        continue;
      }
      s.viewport.setProperties({
        voiRange: { lower: msg.lower, upper: msg.upper },
        ...(msg.invert !== undefined ? { invert: msg.invert } : {}),
      });
      s.viewport.render();
      s.overlay.atualizar();
    }
  } finally {
    aplicandoSincRemota = false;
  }
}

export function aplicarLocalizadorDaOutraJanela(msg: MensagemSincLocalizador): void {
  aplicandoSincRemota = true;
  try {
    const ponto: Types.Point3 = [msg.pontoMundo[0], msg.pontoMundo[1], msg.pontoMundo[2]];
    for (const s of slots) {
      if (s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha || semCortes(s)) continue;
      const inst = s.pilha.instances[0];
      const mesmoRef =
        msg.frameOfReferenceUid && inst?.frameOfReferenceUid
          ? msg.frameOfReferenceUid === inst.frameOfReferenceUid
          : Boolean(msg.studyInstanceUid && inst?.studyInstanceUid === msg.studyInstanceUid);
      if (!mesmoRef) continue;
      s.pontoMiraMundo = [ponto[0], ponto[1], ponto[2]];
      if (s.tipoViewport === Enums.ViewportType.ORTHOGRAPHIC && 'jumpToWorld' in s.viewport) {
        s.viewport.jumpToWorld(ponto);
        s.viewport.render();
        s.overlay.atualizar();
        atualizarMiraSlot(s);
      } else if (s.tipoViewport === Enums.ViewportType.STACK && 'setImageIdIndex' in s.viewport) {
        const idx = indiceCorteMaisProximoDoPonto(s.pilha, ponto);
        const atualIdx = s.viewport.getCurrentImageIdIndex();
        if (atualIdx !== idx) {
          const posAlvo = s.pilha.geometry.positions[idx];
          if (posAlvo !== undefined) posicoesImpostasRemotas.set(s.indice, posAlvo);
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
    aplicandoSincRemota = false;
  }
}

export function aplicarLimparLocalizadorDaOutraJanela(): void {
  aplicandoSincRemota = true;
  try {
    limparMirasLocalizador();
  } finally {
    aplicandoSincRemota = false;
  }
}

function aplicarLocalizador3d(origemIndice: number, pontoMundoOrigem: Types.Point3): void {
  const slotOrigem = slots[origemIndice];
  if (slotOrigem) {
    slotOrigem.pontoMiraMundo = [pontoMundoOrigem[0], pontoMundoOrigem[1], pontoMundoOrigem[2]];
    atualizarMiraSlot(slotOrigem);
  }
  if (!aplicandoSincRemota && ouvinteSegundaJanela && slotOrigem?.pilha) {
    const inst = slotOrigem.pilha.instances[0];
    ouvinteSegundaJanela.aoLocalizar({
      tipo: 'sinc-localizador',
      studyInstanceUid: inst?.studyInstanceUid ?? '',
      ...(inst?.frameOfReferenceUid ? { frameOfReferenceUid: inst.frameOfReferenceUid } : {}),
      pontoMundo: [pontoMundoOrigem[0], pontoMundoOrigem[1], pontoMundoOrigem[2]],
    });
  }

  const sincronizandoAnterior = sincronizandoRolagemComparar;
  sincronizandoRolagemComparar = true;
  try {
    for (const s of slots) {
      if (s.indice === origemIndice || s.celula.hidden || !s.habilitado || !s.viewport || !s.pilha) {
        continue;
      }
      if (semCortes(s)) {
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

function renderizarMotor(): void {
  void iniciarCornerstone().then((m) => m.render());
}

function opcoesControlesFusao(
  slot: Slot,
  alvos?: Slot[],
  mpr?: boolean,
): OpcoesControlesFusao {
  return {
    mpr,
    obterAlvos: () =>
      alvos ??
      (compararAtivo && emFusao(slots[0]!) && emFusao(slots[1]!) && (slot === slots[0] || slot === slots[1])
        ? [slots[0]!, slots[1]!]
        : [slot]),
    estudoDaPilha,
    nomeDaSerie,
    trocarSeries: (anat, pet, sameFrame) => {
      void configurarFusaoNoSlot(slot, anat, pet, sameFrame);
    },
    renderizarMotor,
  };
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

  // 3D (fase 8): renderização volumétrica do mesmo volume, com grupo de ferramentas próprio.
  const mod3d = modalidade3d(stack.instances[0]?.modality);
  if (slot.planoSlot === '3d' && (!mod3d || !volumeId || !promessaVolume)) {
    slot.planoSlot = 'original';
    if (!mod3d) mostrarAvisoVolume(slot, ['O 3D está disponível para TC e RM; no PET, use o MIP 3D.']);
  }
  if (slot.planoSlot === '3d' && mod3d && volumeId && promessaVolume) {
    slot.montandoVolume = true;
    mostrarMensagem(slot, `Montando o 3D de ${nome}…`);
    sincronizar();
    try {
      const [motor, modulo3d] = await Promise.all([iniciarCornerstone(), carregarModulo3d()]);
      const vp = await garantirViewport3d(slot);
      slot.montandoVolume = true;
      if (minhaGeracao !== slot.geracao) return;
      await promessaVolume;
      if (minhaGeracao !== slot.geracao) return;
      await setVolumesForViewports(motor, [{ volumeId }], [slot.idViewport], true);
      if (minhaGeracao !== slot.geracao) return;
      slot.controlador3d = modulo3d.montar3d({
        contentor: slot.celula,
        modalidade: mod3d,
        obterViewport: () =>
          slot.tipoViewport === Enums.ViewportType.VOLUME_3D
            ? (slot.viewport as Types.IVolumeViewport | undefined)
            : undefined,
        obterPilhaId: () => slot.pilha?.id,
        aoMudar: () => slot.overlay.atualizar(),
        // Clique no 3D: leva os cortes 2D ao primeiro tecido visível na linha do clique.
        aoClicar: (canvas) => {
          void (async () => {
            const v3 = slot.viewport as Types.IVolumeViewport | undefined;
            if (!v3 || slot.tipoViewport !== Enums.ViewportType.VOLUME_3D) return;
            const voxels = await carregarVoxels(stack, ids);
            if ('erro' in voxels) return;
            const ponto = modulo3d.pontoVisivelNoClique(v3, canvas, (p) => valorNoPonto(voxels, [p[0], p[1], p[2]]));
            if (ponto) saltarParaPontoMundo(slot.indice, ponto);
          })();
        },
      });
      vp.render();
      slot.montandoVolume = false;
      esconderMensagem(slot);
      slot.overlay.atualizar();
      atualizarMiraSlot(slot);
      emitirRolagemSegundaJanela(slot.indice);
      sincronizar();
      return;
    } catch (e) {
      slot.montandoVolume = false;
      if (minhaGeracao !== slot.geracao) return;
      slot.planoSlot = 'original';
      mostrarAvisoVolume(slot, [`Não foi possível montar o 3D (${textoDoErro(e)}); voltando ao corte original.`]);
    } finally {
      if (minhaGeracao === slot.geracao) slot.montandoVolume = false;
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
        montarControlesFusao(slot, volumeId, volumePetId, opcoesControlesFusao(slot));
        aplicarFusao(slot, volumeId, volumePetId, renderizarMotor);
      }

      if (slot.planoSlot === 'original' && corteInicial !== undefined) {
        const pos = stack.instances[corteInicial]?.imagePositionPatient;
        if (pos) {
          vp.jumpToWorld([pos[0], pos[1], pos[2]]);
        }
      }

      const pet = voiPreservado || emFusao(slot) ? null : exibicaoPadraoPet(stack);
      const voi =
        voiPreservado?.voiRange ??
        pet?.voiRange ??
        (emFusao(slot) ? voiTcDaFusao(stack) : undefined) ??
        voiPadraoDaPilha(stack);
      if (voi) vp.setProperties({ voiRange: voi, invert: voiPreservado?.invert ?? pet?.invert });
      else if (pet) vp.setProperties({ invert: true });
      aplicarFiltroAoSlot(slot);

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
          // Abre parado na vista anterior (AP); gira com ▶, Espaço ou arrastando.
          iniciarGirando: false,
        });
      } else {
        aplicarSlabAoViewport(vp, slot.modoSlab, slot.slabMm);
        vp.render();
      }

      slot.montandoVolume = false;
      esconderMensagem(slot);
      slot.overlay.atualizar();
      atualizarMiraSlot(slot);
      emitirRolagemSegundaJanela(slot.indice);
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
    aplicarFiltroAoSlot(slot);
    viewport.render();
    slot.overlay.atualizar();
    esconderMensagem(slot);
    atualizarMiraSlot(slot);
    emitirRolagemSegundaJanela(slot.indice);
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
  if (plano === '3d' && !modalidade3d(slot.pilha.instances[0]?.modality)) {
    mostrarAvisoVolume(slot, ['O 3D está disponível para TC e RM; no PET, use o MIP 3D.']);
    sincronizar();
    return;
  }

  pararCine(slot.indice);
  const saindoDo3d = slot.planoSlot === '3d';
  const { corte, voiPreservado } = salvarEstadoVisualSlot(slot);
  slot.planoSlot = plano;
  // A janela do 3D é a da predefinição, não serve para os cortes.
  await exibirSlot(slot, corte, saindoDo3d ? undefined : voiPreservado);
}

/** Zooms oferecidos ao clicar no texto "Zoom" do canto (100% = imagem ajustada ao quadro). */
const ZOOMS_PREDEFINIDOS = [50, 75, 100, 125, 150, 200, 300, 400];

/** Itens do menu de zoom do quadro `indice`. */
export function itensMenuZoom(indice: number = ativo): EntradaMenuFlutuante[] {
  const slot = slots[indice];
  const v = slot?.viewport;
  if (!slot || !v || !slot.habilitado || slot.planoSlot === '3d') return [];
  const atual = Math.round(v.getZoom() * 100);
  return ZOOMS_PREDEFINIDOS.map<EntradaMenuFlutuante>((pct) => ({
    rotulo: pct === 100 ? '100% (ajustar ao quadro)' : `${pct}%`,
    marcado: atual === pct,
    acao: () => {
      const alvo = slots[indice]?.viewport;
      if (!alvo) return;
      alvo.setZoom(pct / 100);
      alvo.render();
      slots[indice]!.overlay.atualizar();
    },
  }));
}

/** Espessuras (mm) oferecidas ao clicar no texto "Espessura" do canto. */
const ESPESSURAS_MM = [3, 5, 10, 15, 20, 30, 50];

/**
 * Itens do menu de espessura do quadro `indice`. No modo Normal, engrossar o corte usa a média
 * (é o que `aplicarSlabAoViewport` faz); em MIP, MinIP ou Média só a espessura muda.
 */
export function itensMenuEspessura(indice: number = ativo): EntradaMenuFlutuante[] {
  const slot = slots[indice];
  if (!slot?.pilha || !slot.habilitado || semCortes(slot)) return [];
  const modo = mprAtivo ? modoSlabMpr : slot.modoSlab;
  const mm = mprAtivo ? slabMprMm : slot.slabMm;
  const engrossar = (alvo: number): void => {
    ativarViewport(indice);
    const s = slots[indice];
    if (!s?.pilha) return;
    const av = avaliarVolume(s.pilha);
    if (!av.ok) {
      mostrarAvisoVolume(s, av.mensagens);
      return;
    }
    definirSlabMpr(alvo);
  };
  const itens: EntradaMenuFlutuante[] = [
    {
      rotulo: 'Corte original (sem engrossar)',
      marcado: modo === 'normal' && mm <= 1,
      acao: () => {
        ativarViewport(indice);
        if (modo !== 'normal') void definirModoSlabAtivo('normal');
        else definirSlabMpr(1);
      },
    },
    ...ESPESSURAS_MM.map<EntradaMenuFlutuante>((e) => ({
      rotulo: `${e} mm`,
      marcado: mm === e,
      acao: () => engrossar(e),
    })),
    'divisor',
  ];
  const modos: Array<[ModoSlab, string]> = [
    ['normal', 'Média (padrão)'],
    ['mip', 'MIP'],
    ['minip', 'MinIP'],
  ];
  for (const [m, rotulo] of modos) {
    itens.push({
      rotulo,
      // "Média" do menu de modo da barra é o mesmo cálculo do Normal com corte grosso.
      marcado: m === modo || (m === 'normal' && modo === 'media'),
      acao: () => {
        ativarViewport(indice);
        void definirModoSlabAtivo(m);
      },
    });
  }
  return itens;
}

/** Planos que o cubo de orientação e o menu do botão direito oferecem. */
const PLANOS_DO_MENU: Array<'original' | 'axial' | 'coronal' | 'sagital'> = ['original', 'axial', 'coronal', 'sagital'];

/**
 * MPR: põe `plano` no quadro `slot`. Os três quadros continuam com planos diferentes: o quadro
 * que mostrava `plano` fica com o que este mostrava. Escolher o plano que o quadro já tem
 * desfaz um giro (plano oblíquo) e volta ao plano reto.
 */
function trocarPlanoMpr(slot: Slot, plano: 'axial' | 'coronal' | 'sagital'): void {
  const outro = slots.slice(0, 3).find((s) => s !== slot && s.planoSlot === plano);
  const anterior = slot.planoSlot;
  const centro = centroCrosshair();
  const aplicar = (s: Slot, p: PlanoSlot): void => {
    const v = s.viewport;
    if (!v || s.tipoViewport !== Enums.ViewportType.ORTHOGRAPHIC || !('setOrientation' in v)) return;
    s.planoSlot = p;
    s.planoMpr = PLANOS_SLOTS[p];
    esquecerPlanoGirado(s.idViewport);
    v.setOrientation(PLANOS_SLOTS[p].eixo);
    if (centro) v.jumpToWorld(centro);
    aplicarSlabAoViewport(v, modoSlabMpr, slabMprMm);
    v.render();
    s.overlay.atualizar();
  };
  aplicar(slot, plano);
  if (outro && anterior !== plano) aplicar(outro, anterior);
  sincronizar();
}

/** Itens do menu de planos do quadro `indice` (cubo de orientação e menu do botão direito). */
export function itensMenuPlano(indice: number = ativo): EntradaMenuFlutuante[] {
  const slot = slots[indice];
  if (!slot?.pilha || !slot.habilitado || semCortes(slot)) return [];
  const itens: EntradaMenuFlutuante[] = [];
  for (const plano of PLANOS_DO_MENU) {
    if (mprAtivo && plano === 'original') continue;
    itens.push({
      rotulo: PLANOS_SLOTS[plano].rotulo,
      marcado: slot.planoSlot === plano,
      acao: () => {
        ativarViewport(indice);
        if (mprAtivo) {
          if (plano !== 'original') trocarPlanoMpr(slot, plano);
          return;
        }
        if (slot.planoSlot === plano) {
          // Mesmo plano: só desfaz o giro (plano oblíquo), se houver.
          if (slot.viewport && restaurarPlanoGirado(slot.viewport)) {
            slot.viewport.render();
            slot.overlay.atualizar();
          }
          return;
        }
        void definirPlanoSlotAtivo(plano);
      },
    });
  }
  return itens;
}

/**
 * Botão MIP 3D: abre ou fecha rapidamente uma janela de MIP rotatório ao lado do corte 2D:
 * - Se estiver em 1x1 com uma série volumétrica, muda para 1x2 mantendo o corte 2D à esquerda
 *   e abrindo o MIP rotatório à direita (clicar nas lesões do MIP leva o corte 2D ao ponto).
 * - Se já houver um MIP rotatório no layout 1x2 ao lado da mesma série, fecha-o e volta para 1x1.
 * - Nos demais layouts (ou no MPR), alterna o slot ativo entre 'mip-rotatorio' e 'original'.
 */
export function alternarMipRotatorio(): Promise<void> {
  return alternarPlanoAoLado('mip-rotatorio');
}

/** Botão 3D (fase 8): como o MIP 3D, mas com a renderização volumétrica ao lado do corte 2D. */
export function alternar3d(): Promise<void> {
  return alternarPlanoAoLado('3d');
}

/**
 * Garante que a reconstrução 3D esteja visível para a série ativa (sem fechá-la caso já esteja aberta),
 * usado pelo botão "🧊 Reconstruir 3D" da segmentação.
 */
export async function abrir3dParaPilhaAtiva(): Promise<void> {
  const slotAtivo = slots[ativo] ?? slots[0];
  const stack = slotAtivo?.pilha ?? slots[0]?.pilha ?? null;
  if (!stack) return;
  const jaAberto = slots.find(
    (s) => !s.celula.hidden && s.planoSlot === '3d' && s.pilha?.id === stack.id,
  );
  if (jaAberto) {
    jaAberto.viewport?.render();
    sincronizar();
    return;
  }
  await alternarPlanoAoLado('3d');
}

function slotMostraBotaoVoltar(slot: Slot): boolean {
  if (slot.celula.hidden || !slot.habilitado || !slot.pilha) return false;
  if (emModoSegmentacao()) return false;
  if (mprAtivo) return slot.indice === 0;
  if (slot.planoSlot === '3d' || slot.planoSlot === 'mip-rotatorio') return true;
  if (slot.planoSlot !== 'original' && !emFusao(slot)) return true;
  return false;
}

function atualizarBotaoVoltarSlot(slot: Slot): void {
  const visivel = slotMostraBotaoVoltar(slot);
  slot.botaoVoltar.hidden = !visivel;
  if (!visivel) return;
  if (mprAtivo) {
    slot.botaoVoltar.title = 'Sair do MPR e retornar à imagem original (F2 ou R)';
  } else if (slot.planoSlot === '3d') {
    slot.botaoVoltar.title = 'Fechar o 3D e retornar à imagem 2D de origem (F3)';
  } else if (slot.planoSlot === 'mip-rotatorio') {
    slot.botaoVoltar.title = 'Fechar o MIP 3D e retornar à imagem 2D de origem';
  } else {
    slot.botaoVoltar.title = 'Retornar ao plano de aquisição original';
  }
}

/**
 * Atalho estilo RadiAnt (Ctrl+Alt+1 Coronal, Ctrl+Alt+2 Sagital, Ctrl+Alt+3 Axial):
 * muda o plano do quadro ativo (tanto em 2D quanto dentro do MPR).
 */
export async function selecionarPlanoOrtogonalAtivo(plano: 'coronal' | 'sagital' | 'axial'): Promise<void> {
  const slot = slots[ativo];
  if (!slot?.pilha || !slot.habilitado || semCortes(slot)) return;
  if (mprAtivo) {
    trocarPlanoMpr(slot, plano);
    return;
  }
  await definirPlanoSlotAtivo(plano);
}

async function voltarDaReconstrucaoSlot(indice: number): Promise<void> {
  if (mprAtivo) {
    await sairDoMpr();
    return;
  }
  const slot = slots[indice];
  if (!slot?.pilha) return;
  if (slot.planoSlot === '3d' || slot.planoSlot === 'mip-rotatorio') {
    if (
      layoutAtual === '1x2' &&
      indice === 1 &&
      slots[0]?.pilha?.id === slot.pilha.id &&
      slots[1]?.pilha?.id === slot.pilha.id
    ) {
      await alternarPlanoAoLado(slot.planoSlot);
      return;
    }
    ativarViewport(indice);
    await definirPlanoSlotAtivo('original');
    return;
  }
  if (slot.planoSlot !== 'original') {
    ativarViewport(indice);
    await definirPlanoSlotAtivo('original');
  }
}

function obterCorteETotalSlot(slot: Slot): { indice: number; total: number } | null {
  const vp = slot.viewport;
  if (!slot.habilitado || !vp || !slot.pilha || semCortes(slot) || !slot.mensagem.hidden) {
    return null;
  }
  try {
    if ('setImageIdIndex' in vp) {
      const total = vp.getImageIds().length || slot.pilha.instances.length;
      const idx = vp.getCurrentImageIdIndex() ?? 0;
      return { indice: Math.min(Math.max(idx, 0), Math.max(0, total - 1)), total };
    }
    const total = vp.getNumberOfSlices() || slot.pilha.instances.length;
    const idx = vp.getSliceIndex() ?? 0;
    return { indice: Math.min(Math.max(idx, 0), Math.max(0, total - 1)), total };
  } catch {
    return null;
  }
}

function atualizarScrubberSlot(slot: Slot): void {
  const info = obterCorteETotalSlot(slot);
  if (!info || info.total <= 1) {
    slot.scrubber.hidden = true;
    return;
  }
  slot.scrubber.hidden = false;
  const frac = info.indice / (info.total - 1);
  const altPct = Math.max(6, Math.min(35, 100 / info.total));
  const topoPct = frac * (100 - altPct);
  slot.scrubberPino.style.height = `${altPct.toFixed(2)}%`;
  slot.scrubberPino.style.top = `${topoPct.toFixed(2)}%`;
  slot.scrubber.title = `Corte ${info.indice + 1} / ${info.total} — clique ou arraste para navegar`;
}

function pularParaFracaoScrubber(slot: Slot, fracao: number): void {
  const info = obterCorteETotalSlot(slot);
  const vp = slot.viewport;
  if (!info || info.total <= 1 || !vp) return;
  const f = Math.min(1, Math.max(0, fracao));
  const alvo = Math.round(f * (info.total - 1));
  if (alvo === info.indice) return;
  try {
    if ('setImageIdIndex' in vp) {
      void vp.setImageIdIndex(alvo);
    } else {
      vp.scroll(alvo - info.indice);
    }
  } catch {
    /* ignora durante transição */
  }
}

async function alternarPlanoAoLado(plano: 'mip-rotatorio' | '3d'): Promise<void> {
  if (mprAtivo) {
    const stackMpr = slots[0]?.pilha ?? null;
    if (stackMpr) {
      estadoAntesDoMpr = [
        {
          pilha: stackMpr,
          planoSlot: 'original',
          modoSlab: 'normal',
          slabMm: 1,
          pilhaFusao: null,
          fusao: { opacidade: 0.5, colormap: NOME_HOT_IRON, teto: 10, minimo: 0 },
          corte: undefined,
        },
      ];
    }
    await sairDoMpr('1x1');
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
  if (plano === '3d' && !modalidade3d(stack.instances[0]?.modality)) {
    if (slotAtivo) mostrarAvisoVolume(slotAtivo, ['O 3D está disponível para TC e RM; no PET, use o MIP 3D.']);
    sincronizar();
    return;
  }

  // Se estamos em 1x2 e o slot 1 já é o MIP rotatório da mesma série, fecha e volta para 1x1:
  if (
    layoutAtual === '1x2' &&
    slot1?.planoSlot === plano &&
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
    if (slot0.planoSlot === plano) {
      await definirPlanoSlotAtivo('original');
      return;
    }
    const anterior1 = slot1.pilha?.id;
    const volAnterior1 = slot1.volumePilhaId;
    slot1.ids = adquirirIds(stack, arquivos);
    slot1.pilha = stack;
    slot1.planoSlot = plano;
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
      slotAtivo.planoSlot === plano ? 'original' : plano;
    await definirPlanoSlotAtivo(novoPlano);
  }
}

/** Retorna o filtro visual padrão para uma pilha (preferência de TC quando for CT; 0 nas demais). */
function filtroPadraoParaPilha(stack: StackNode | null | undefined): number {
  const ehCt = !!stack?.instances.some((i) => i.modality === 'CT');
  return ehCt ? sanearNivelFiltro(preferencias().filtroImagemCtPadrao, 0) : 0;
}

/** Aplica o filtro visual (Suave / Nítido) aos canvases de imagem do slot sem alterar HU/SUV nem medidas. */
function aplicarFiltroAoSlot(slot: Slot): void {
  const nivelEfetivo = !slot.pilha || slot.planoSlot === '3d' ? 0 : slot.filtroImagem;
  aplicarFiltroVisualElemento(slot.elemento, slot.idViewport, nivelEfetivo);
}

/** Nível de filtro visual (-5 Suave a +5 Nítido; 0 = Original) do viewport ativo. */
export function filtroImagemAtivo(): number {
  return slots[ativo]?.filtroImagem ?? 0;
}

/** Define o filtro visual apenas do viewport ativo (por viewport) e atualiza a exibição. */
export function definirFiltroImagemAtivo(nivel: number): void {
  const slot = slots[ativo];
  if (!slot?.pilha || slot.planoSlot === '3d') return;
  const saneado = sanearNivelFiltro(nivel, 0);
  if (slot.filtroImagem === saneado) return;
  slot.filtroImagem = saneado;
  aplicarFiltroAoSlot(slot);
  sincronizar();
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
        if (i === 0) {
          montarControlesFusao(
            sl,
            resVol.volumeId,
            resPet.volumeId,
            opcoesControlesFusao(sl, [slots[0]!, slots[1]!, slots[2]!], true),
          );
        } else {
          criarLegendaFusao(sl);
        }
        aplicarFusao(sl, resVol.volumeId, resPet.volumeId, renderizarMotor);
      }
    }

    const voiInicial = (resPet?.ok ? voiTcDaFusao(stack) : undefined) ?? voiPadraoDaPilha(stack);
    const filtroInicialMpr =
      slots[ativo]?.pilha?.id === stack.id ? slots[ativo]!.filtroImagem : filtroPadraoParaPilha(stack);

    for (let i = 0; i < 3; i++) {
      const vp = vps[i]!;
      slots[i]!.filtroImagem = filtroInicialMpr;
      if (voiInicial) vp.setProperties({ voiRange: voiInicial });
      aplicarFiltroAoSlot(slots[i]!);
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
 * Padrão da sincronia ao formar o par: mantém apenas a rolagem por posição (mm) ligada por padrão;
 * zoom/pan e janela/nível ficam desligados (exceto escala de SUV em PET × PET).
 */
function definirPadroesSincroniaComparar(): void {
  const a = slots[0]?.pilha ?? null;
  const b = slots[1]?.pilha ?? null;
  zoomPanCompararLigado = false;
  // PET x PET (mesmo estudo ou não): a mesma escala de SUV nos dois lados.
  const ambosPet = !!a?.instances.some((i) => i.modality === 'PT') && !!b?.instances.some((i) => i.modality === 'PT');
  janelaCompararLigada = ambosPet;
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
      const posAlvo = slotDestino.pilha.geometry.positions[sincronizado.index];
      if (posAlvo !== undefined) {
        // Só ao longo da normal do plano (jumpToWorld com o canto da imagem deslocaria o pan).
        // A posição vem na convenção da normal da aquisição; a câmera pode ter a normal invertida.
        const nGeo = slotDestino.pilha.geometry.normal;
        const nCam = normalDoSlot(slotDestino);
        const sinalCam = nGeo && nCam && nGeo[0] * nCam[0] + nGeo[1] * nCam[1] + nGeo[2] * nCam[2] < 0 ? -1 : 1;
        irParaPosicaoMm(slotDestino, posAlvo * sinalCam);
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
    } else if (semCortes(s1)) {
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
  if (!compararAtivo) {
    alternarSincroniaEstudo();
    return;
  }
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

/** Liga ou desliga a sincronização de janela/nível (no modo Comparar ou entre séries do estudo). */
export function alternarSincronizacaoJanelaComparar(): void {
  if (!compararAtivo) {
    janelaEstudoLigada = !janelaEstudoLigada;
    atualizarSincroniaEstudo();
    sincronizar();
    return;
  }
  janelaCompararLigada = !janelaCompararLigada;
  atualizarSincronizadoresCornerstoneComparar();
  sincronizar();
}

/** Liga ou desliga a sincronização de zoom/pan (no modo Comparar ou entre séries do estudo). */
export function alternarSincronizacaoZoomPanComparar(): void {
  if (!compararAtivo) {
    zoomPanEstudoLigado = !zoomPanEstudoLigado;
    atualizarSincroniaEstudo();
    sincronizar();
    return;
  }
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

  const { abrirDialogoCurvaPerfusao } = await import('../tools/curvaPerfusao');
  await abrirDialogoCurvaPerfusao({
    elementoViewport: slot.elemento,
    pilhaAtiva: slot.pilha,
    indiceCorteAtual: indiceCorte,
    pontoMiraMundo: slot.pontoMiraMundo,
    obterImageIdDoQuadro: (pilhaAlvo, idxCorte) => {
      const arquivosAtuais = estado.resultado?.arquivos;
      if (!arquivosAtuais) return null;
      const existente = registro.get(pilhaAlvo.id);
      if (existente) return existente.ids[idxCorte] ?? null;
      try {
        const ids = adquirirIds(pilhaAlvo, arquivosAtuais);
        return ids[idxCorte] ?? null;
      } catch {
        return null;
      }
    },
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

/**
 * Quando a janela tem grade com vários quadros (ex.: 1x2 ou 2x2) e recebe uma série enviada
 * pela outra janela, prefere o primeiro quadro visível ainda vazio se o quadro ativo já estiver ocupado.
 */
export async function abrirPilhaEmSlotDisponivel(stack: StackNode): Promise<void> {
  if (!mprAtivo) {
    const jaAberta = slots.find((s) => !s.celula.hidden && s.pilha?.id === stack.id);
    if (jaAberta) {
      ativo = jaAberta.indice;
      sincronizar();
      return;
    }
    if (slots[ativo]?.pilha) {
      const livre = slots.find((s) => !s.celula.hidden && s.pilha === null);
      if (livre) {
        ativo = livre.indice;
      }
    }
  }
  await abrirPilha2d(stack);
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
  slot.filtroImagem = filtroPadraoParaPilha(stack);
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
  apagarTodasSegmentacoes();
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

/** Algum viewport visível tem o canvas com tamanho de desenho diferente do tamanho na tela. */
function canvasDesatualizado(): boolean {
  const dpr = window.devicePixelRatio || 1;
  return slots.some((s) => {
    if (!s.habilitado || s.celula.hidden) return false;
    const c = s.elemento.querySelector<HTMLCanvasElement>('canvas.cornerstone-canvas') ?? s.elemento.querySelector('canvas');
    if (!c) return false;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    return w > 0 && h > 0 && (c.width !== w || c.height !== h);
  });
}

async function redimensionarMotor(manterCamera = false, tentativa = 0): Promise<void> {
  const motor = await iniciarCornerstone();
  requestAnimationFrame(() => {
    try {
      motor.resize(true, manterCamera);
      // Se havia um quadro de desenho agendado (ex.: o 3D sendo montado ao lado), o Cornerstone só
      // anota o tamanho novo e não redimensiona o canvas: a imagem fica achatada. Tenta de novo.
      if (tentativa < 10 && canvasDesatualizado()) {
        void redimensionarMotor(manterCamera, tentativa + 1);
        return;
      }
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

/** Redimensiona os viewports ativos quando o painel de séries muda de tamanho ou posição. */
export function redimensionarViewports(): void {
  void redimensionarMotor(true);
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
  comparacaoPetCtLayout = false;
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
  invalidarCacheVoxels(stack.id);
  descartarVolumeDoWorker(stack.id);
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
 * Comparar PET/CT: dois estudos (atual e anterior) lado a lado, cada um como fusão TC + PET, com a
 * mesma escala de SUV e rolagem ligada por posição (como na fase 4). O par de cada estudo é o que
 * envolve a série aberta ou, na falta dele, o melhor candidato.
 */
/**
 * Escolhe os dois PET/CT (atual e anterior) para comparar: o estudo da série aberta e outro, de
 * preferência do mesmo paciente; o mais recente é o atual. `null` (e aviso no viewport) se faltar.
 */
function escolherParesPetCt(): { atual: FusionCandidate; anterior: FusionCandidate } | null {
  const slotAtivo = slots[ativo] ?? slots[0];
  const pacientes = estado.resultado?.index.patients ?? [];
  const ativa = estado.pilhaAtiva?.id;
  const itens = pacientes
    .flatMap((p) => p.studies)
    .map((estudo) => ({ estudo, pares: findFusionCandidates(estudo) }))
    .filter((x) => x.pares.length > 0);
  if (itens.length < 2) {
    if (slotAtivo) {
      mostrarMensagem(slotAtivo, 'Comparar PET/CT precisa de dois estudos', 'Abra dois estudos que tenham, cada um, uma série de PET e uma de TC ou RM.');
    }
    return null;
  }
  const base = itens.find((x) => x.pares.some((c) => c.pet.id === ativa || c.anatomic.id === ativa)) ?? itens[0]!;
  const baseUid = base.pares[0]!.pet.instances[0]?.patientId;
  const outro =
    itens.find((x) => x !== base && x.pares[0]!.pet.instances[0]?.patientId === baseUid) ?? itens.find((x) => x !== base)!;
  const chave = (x: (typeof itens)[number]): string => `${x.estudo.date ?? ''}${(x.estudo.time ?? '').padEnd(6, '0')}`;
  const [atual, anterior] = [base, outro].sort((p, q) => chave(q).localeCompare(chave(p)));
  const escolher = (x: (typeof itens)[number]): FusionCandidate =>
    (ativa && x.pares.find((c) => c.pet.id === ativa || c.anatomic.id === ativa)) || x.pares[0]!;
  return { atual: escolher(atual!), anterior: escolher(anterior!) };
}

export async function compararPetCt(): Promise<void> {
  const escolha = escolherParesPetCt();
  if (!escolha) return;
  const { atual: parA, anterior: parB } = escolha;
  if (!compararAtivo) await alternarModoComparar();
  if (!compararAtivo) return;
  // As duas fusões compartilham as mesmas configurações (escala, colormap, opacidade).
  slots[1]!.fusao = slots[0]!.fusao;
  await configurarFusaoNoSlot(slots[0]!, parA.anatomic, parA.pet, parA.sameFrame);
  await configurarFusaoNoSlot(slots[1]!, parB.anatomic, parB.pet, parB.sameFrame);
  sincronizar();
}

/** Layout de comparação PET/CT ativo: duas linhas (atual e anterior) com rolagem ligada entre elas. */
let comparacaoPetCtLayout = false;
const vinculosEntreGrupos = new Map<string, ScrollLink | null>();

/**
 * Grade de comparação PET/CT (2 linhas × 3 colunas): em cima o exame atual (PET, TC, Fusão) e
 * embaixo o anterior (PET, TC, Fusão). Cada linha sincroniza por estudo; entre as linhas a rolagem
 * é ligada por posição (como no modo Comparar), e a escala da fusão é a mesma nas duas.
 */
export async function abrirLayoutComparacaoPetCt(): Promise<void> {
  const escolha = escolherParesPetCt();
  if (!escolha) return;
  await definirLayout('2x3');
  vinculosEntreGrupos.clear();
  slots[5]!.fusao = slots[2]!.fusao; // mesma escala, colormap e opacidade nas duas fusões
  const linhas: Array<[number, FusionCandidate]> = [
    [0, escolha.atual],
    [3, escolha.anterior],
  ];
  for (const [base, par] of linhas) {
    ativo = base;
    await abrirPilha2d(par.pet);
    ativo = base + 1;
    await abrirPilha2d(par.anatomic);
    await configurarFusaoNoSlot(slots[base + 2]!, par.anatomic, par.pet, par.sameFrame);
  }
  ativo = 1;
  comparacaoPetCtLayout = true;
  sincronizar();
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

  const botaoVoltar = document.createElement('button');
  botaoVoltar.type = 'button';
  botaoVoltar.className = 'btn-voltar-reconstrucao';
  botaoVoltar.textContent = '← Voltar';
  botaoVoltar.hidden = true;
  botaoVoltar.addEventListener('click', (ev) => {
    ev.stopPropagation();
    void voltarDaReconstrucaoSlot(indice);
  });

  const scrubber = document.createElement('div');
  scrubber.className = 'scrubber-cortes';
  scrubber.hidden = true;
  const scrubberPino = document.createElement('div');
  scrubberPino.className = 'scrubber-pino';
  scrubber.append(scrubberPino);

  celula.append(
    elemento,
    canvasMira,
    mensagem,
    avisoVolume,
    controlesMip,
    controlesFusao,
    etiquetaComparacao,
    avisoCobertura,
    botaoDadosPet,
    botaoVoltar,
    scrubber,
  );

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
    botaoVoltar,
    scrubber,
    scrubberPino,
    canvasMira,
    pontoMiraMundo: null,
    tipoViewport: Enums.ViewportType.STACK,
    planoSlot: 'original',
    modoSlab: 'normal',
    slabMm: 1,
    filtroImagem: 0,
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
    cubo: undefined as unknown as CuboOrientacao,
  };
  slot.overlay = criarOverlay(celula, {
    viewport: () => slot.viewport,
    pilha: () => slot.pilha,
    planoMpr: () => slot.planoMpr,
    modoSlab: () => MODOS_SLAB[mprAtivo ? modoSlabMpr : slot.modoSlab]?.rotulo,
    aoClicar: (campo, x, y) => {
      ativarViewport(indice);
      abrirMenuFlutuante(x, y, campo === 'zoom' ? itensMenuZoom(indice) : itensMenuEspessura(indice));
    },
    rotulo3d: () => {
      const m = modalidade3d(slot.pilha?.instances[0]?.modality);
      return slot.tipoViewport === Enums.ViewportType.VOLUME_3D && slot.habilitado && m && modulo3dCache
        ? modulo3dCache.rotuloPredefinicao3d(slot.idViewport, m)
        : undefined;
    },
  });
  const overlayBase = slot.overlay;
  slot.cubo = criarCuboOrientacao(celula.querySelector<HTMLElement>('.overlay') ?? celula, {
    viewport: () => slot.viewport,
    visivel: () =>
      slot.habilitado && !slot.celula.hidden && !!slot.pilha && !slot.montandoVolume && slot.planoSlot !== '3d' && !!slot.mensagem.hidden,
    aoPedirMenu: (x, y) => {
      ativarViewport(indice);
      abrirMenuFlutuante(x, y, itensMenuPlano(indice));
    },
  });
  slot.overlay = {
    ligar: overlayBase.ligar,
    atualizar: () => {
      overlayBase.atualizar();
      slot.cubo.atualizar();
      atualizarBotaoVoltarSlot(slot);
      atualizarScrubberSlot(slot);
    },
  };
  slot.overlay.ligar(elemento);

  scrubber.addEventListener('mousedown', (ev) => {
    ev.stopPropagation();
  });
  scrubber.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    ativarViewport(indice);
    scrubber.setPointerCapture(ev.pointerId);
    scrubber.classList.add('arrastando');
    const aplicar = (clientY: number): void => {
      const r = scrubber.getBoundingClientRect();
      if (r.height <= 0) return;
      pularParaFracaoScrubber(slot, (clientY - r.top) / r.height);
      atualizarScrubberSlot(slot);
    };
    aplicar(ev.clientY);
    const aoMover = (m: PointerEvent): void => aplicar(m.clientY);
    const encerrar = (): void => {
      scrubber.classList.remove('arrastando');
      scrubber.removeEventListener('pointermove', aoMover);
      scrubber.removeEventListener('pointerup', encerrar);
      scrubber.removeEventListener('pointercancel', encerrar);
    };
    scrubber.addEventListener('pointermove', aoMover);
    scrubber.addEventListener('pointerup', encerrar);
    scrubber.addEventListener('pointercancel', encerrar);
  });

  elemento.addEventListener(Enums.Events.VOI_MODIFIED, () => {
    sincronizarVoiMpr(indice);
    emitirJanelaSegundaJanela(indice);
    document.dispatchEvent(new CustomEvent(EVENTO_JANELA_MUDOU, { detail: { idViewport: slot.idViewport } }));
  });
  elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    aoRolarSlotEstudo(indice);
    emitirRolagemSegundaJanela(indice);
    atualizarMiraSlot(slot);
    atualizarScrubberSlot(slot);
  });
  elemento.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    aoRolarSlotEstudo(indice);
    emitirRolagemSegundaJanela(indice);
    atualizarMiraSlot(slot);
    atualizarScrubberSlot(slot);
  });
  elemento.addEventListener(Enums.Events.CAMERA_MODIFIED, () => {
    aoMudarCameraEstudo(indice);
    atualizarMiraSlot(slot);
    slot.cubo.atualizar();
    atualizarScrubberSlot(slot);
  });
  celula.addEventListener('mousedown', () => ativarViewport(indice), true);
  // Arrastar e soltar uma série da barra lateral diretamente sobre este quadro:
  celula.addEventListener('dragover', (ev) => {
    if (!temPilhaEmArraste(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    celula.classList.add('alvo-soltar-serie');
  });
  celula.addEventListener('dragleave', (ev) => {
    if (ev.relatedTarget instanceof Node && celula.contains(ev.relatedTarget)) return;
    celula.classList.remove('alvo-soltar-serie');
  });
  celula.addEventListener('drop', (ev) => {
    celula.classList.remove('alvo-soltar-serie');
    const dados = extrairDadosPilhaArrastada(ev.dataTransfer);
    if (!dados) return;
    ev.preventDefault();
    ev.stopPropagation();
    const pilha = encontrarPilhaEnviada(estado.resultado?.index, dados);
    if (!pilha) return;
    ativarViewport(indice);
    document.dispatchEvent(new CustomEvent<StackNode>(EVENTO_ABRIR_PILHA, { detail: pilha }));
  });
  // Pintando numa série que ainda não tem segmentação: o 1º clique cria a segmentação (sem pintar).
  celula.addEventListener(
    'mousedown',
    (ev) => {
      if (ev.button !== 0 || !ehFerramentaSegmentacao(ferramentaPrimariaAtual())) return;
      if (!slot.pilha || semCortes(slot) || segmentacaoDaPilha(slot.pilha.id)) return;
      if (ev.target instanceof Element && ev.target.closest('button, input, select')) return;
      ev.stopPropagation();
      ev.preventDefault();
      void garantirSegmentacaoAtiva();
    },
    true,
  );
  // Registro manual: com "Mover PET" ligado, arrastar na fusão desloca o PET (no plano da imagem).
  ligarArrastoRegistroPet(celula, elemento, slot, renderizarMotor);
  botaoDadosPet.addEventListener('click', () => {
    if (slot.pilha) document.dispatchEvent(new CustomEvent(EVENTO_DADOS_PET, { detail: slot.pilha }));
  });
  // Duplo clique maximiza/restaura. Com ferramenta de medida ativa só com Shift (o duplo clique
  // pode ser parte do desenho, ex.: terminar uma polilinha).
  celula.addEventListener('dblclick', (e) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button, input, select, a'))) return;
    const atual = ferramentaPrimariaAtual();
    const medindo = FERRAMENTAS_PRIMARIAS.some(
      (f) => f.nome === atual && (f.categoria === 'medida' || f.categoria === 'segmentacao'),
    );
    if (medindo && !e.shiftKey) return;
    alternarMaximizado(indice);
  });

  // Ferramenta Localizador 3D (┼ Localizar): clicando ou arrastando com o botão atribuído,
  // marca a cruzinha neste viewport e sincroniza todos os demais (mesmo exame ou comparado).
  elemento.addEventListener(
    'mousedown',
    (e) => {
      if (!slot.viewport || !slot.habilitado || semCortes(slot)) return;
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

      let eventoPendente: MouseEvent | null = null;
      let rafLoc = 0;
      const aoMover = (ev: MouseEvent) => {
        eventoPendente = ev;
        if (rafLoc) return;
        rafLoc = requestAnimationFrame(() => {
          rafLoc = 0;
          if (eventoPendente) atualizarPorEvento(eventoPendente);
        });
      };
      const aoSoltar = () => {
        window.removeEventListener('mousemove', aoMover, true);
        window.removeEventListener('mouseup', aoSoltar, true);
        if (rafLoc) {
          cancelAnimationFrame(rafLoc);
          rafLoc = 0;
          if (eventoPendente) atualizarPorEvento(eventoPendente);
        }
      };
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
    },
    true,
  );

  celula.addEventListener(
    'wheel',
    (e) => {
      if (e.altKey && !e.ctrlKey && ehFerramentaSegmentacao(ferramentaPrimariaAtual())) {
        e.preventDefault();
        e.stopPropagation();
        ajustarRaioPincelDelta(e.deltaY < 0 ? 1 : -1);
        return;
      }
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      ativarViewport(indice);
      if (semCortes(slot)) return;
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
  definirResolvedorVaso(vasoNoPonto);
  definirResolvedorRecalculoVaso(recalcularVasoDaPilha);
  definirResolvedorCriacaoSegmentacao(async (pilhaId) => {
    const slot =
      slots.find((s) => !s.celula.hidden && s.pilha?.id === pilhaId && !semCortes(s)) ??
      slots.find((s) => s.pilha?.id === pilhaId);
    await garantirSegmentacaoNoSlot(slot);
  });
  // Volumetria: valores da série (HU ou SUV) na mesma grade da máscara.
  definirResolvedorValores(async (pilhaId) => {
    const slot = slots.find((s) => s.pilha?.id === pilhaId);
    const stack = slot?.pilha;
    const ids = registro.get(pilhaId)?.ids;
    if (!stack || !ids) return { erro: 'A série não está aberta em nenhum quadro.' };
    const v = await carregarVoxels(stack, ids);
    if ('erro' in v) return v;
    return {
      volume: { data: v.data, grid: v.grid },
      unidade: unidadeDaSerie(stack),
      ehPet: stack.instances.some((x) => x.modality === 'PT'),
    };
  });
  // Ferramenta de segmentação escolhida (barra, painel ou tecla): abre o modo segmentação e cria a máscara da série ativa.
  document.addEventListener(EVENTO_BOTOES_MUDARAM, () => {
    if (ehFerramentaSegmentacao(ferramentaPrimariaAtual())) {
      definirModoSegmentacao(true);
      void garantirSegmentacaoAtiva();
    }
    for (const s of slots) atualizarBotaoVoltarSlot(s);
  });
  document.addEventListener(EVENTO_MODO_SEGMENTACAO, () => {
    for (const s of slots) atualizarBotaoVoltarSlot(s);
  });
  document.addEventListener(EVENTO_VIEWPORT_RESTAURADO, () => {
    const s = slots[ativo];
    if (s && s.filtroImagem !== 0) {
      s.filtroImagem = 0;
      sincronizar();
    }
  });
  iniciarVoiEsfera();
  // Girar plano: o ponto fixo é o centro do crosshair (MPR) ou a cruzinha do ┼ Localizar.
  definirApoioGirarPlano({
    pivo: (id) => {
      if (mprAtivo) return centroCrosshair();
      const p = slots.find((s) => s.idViewport === id)?.pontoMiraMundo;
      return p ? [p[0], p[1], p[2]] : null;
    },
    marcar: (id, mundo) => {
      const slot = slots.find((s) => s.idViewport === id);
      if (!slot?.viewport) return;
      if (mprAtivo) {
        moverCentroCrosshair(getEnabledElement(slot.elemento), mundo);
        return;
      }
      aplicarLocalizador3d(slot.indice, mundo);
    },
    semVolume: (id) => {
      const slot = slots.find((s) => s.idViewport === id);
      if (!slot) return;
      const texto = 'Girar plano só funciona na imagem reconstruída: escolha Axial, Coronal ou Sagital no cubo do canto inferior direito, ou entre no MPR (tecla R).';
      slot.avisoVolume.textContent = texto;
      slot.avisoVolume.hidden = false;
      setTimeout(() => {
        if (slot.avisoVolume.textContent === texto) esconderAvisoVolume(slot);
      }, 6000);
    },
  });
  grade = document.createElement('div');
  grade.id = 'grade';
  let rafRedimensionar = 0;
  const observadorTamanho = new ResizeObserver(() => {
    if (slots.every((s) => !s.habilitado) || rafRedimensionar) return;
    rafRedimensionar = requestAnimationFrame(() => {
      rafRedimensionar = 0;
      void redimensionarMotor(false);
    });
  });
  observadorTamanho.observe(grade);
  for (let i = 0; i < MAX_VIEWPORTS; i++) {
    const slot = criarSlot(i);
    slots.push(slot);
    grade.append(slot.celula);
  }
  elementos.contentor.append(grade);
  iniciarPreenchimentoDoPincel();
  eventTarget.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, (ev: unknown) => {
    const volumeId = (ev as CustomEvent<{ volumeId?: string }> | undefined)?.detail?.volumeId;
    for (const slot of slots) {
      if (!slot.habilitado || slot.tipoViewport !== Enums.ViewportType.ORTHOGRAPHIC) continue;
      if (volumeId) {
        const ehPilha = slot.pilha !== null && idVolumeParaPilha(slot.pilha.id) === volumeId;
        const ehFusao = slot.pilhaFusao !== null && idVolumeParaPilha(slot.pilhaFusao.id) === volumeId;
        if (!ehPilha && !ehFusao) continue;
      }
      slot.reaplicarFusao?.();
      // Fusão: aproxima o zoom ao corpo (como nas outras células), uma vez, com a TC já carregada.
      if (emFusao(slot) && !slot.zoomFusaoAjustado && slot.viewport && slot.ids.length > 0) {
        slot.zoomFusaoAjustado = true;
        ajustarZoomAoConteudo(slot.viewport, slot.ids[Math.floor(slot.ids.length / 2)]!, slot.pilha?.instances[0]?.modality);
      }
      slot.viewport?.render();
      slot.overlay.atualizar();
    }
  });
  void definirLayout(elementos.layoutInicial ?? '1x1');
}
