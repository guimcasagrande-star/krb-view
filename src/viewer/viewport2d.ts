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
} from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode } from '../io/organize';
import {
  adicionarViewportAoGrupo,
  botaoAtribuido,
  definirModoMprFerramentas,
  removerViewportDoGrupo,
} from '../tools/grupo';
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
} from '../compare/modoComparar';
import { invertLink, type ScrollLink } from '../compare/sync';
import { estado } from '../state/store';
import { adquirirVolume, liberarVolume } from '../volume/montarVolume';
import { avaliarVolume } from '../volume/validarVolume';
import { cineTocando, definirFps, fpsAtual, pararCine, pararTodosCines, tocarCine } from './cine';
import { idElemento, ID_MOTOR, idViewport, iniciarCornerstone, MAX_VIEWPORTS } from './iniciar';
import { criarOverlay, type Overlay, type PlanoMprOverlay } from './overlay';

const CARGAS_SIMULTANEAS = 4;

export type Layout = '1x1' | '1x2' | '2x2';
export type PlanoSlot = 'original' | 'axial' | 'coronal' | 'sagital' | 'mip-rotatorio';
export type ModoSlab = 'normal' | 'mip' | 'minip' | 'media';

export const LAYOUTS: Record<Layout, { rotulo: string; colunas: number; linhas: number }> = {
  '1x1': { rotulo: '1x1', colunas: 1, linhas: 1 },
  '1x2': { rotulo: '1x2', colunas: 2, linhas: 1 },
  '2x2': { rotulo: '2x2', colunas: 2, linhas: 2 },
};

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
  etiquetaComparacao: HTMLDivElement;
  avisoCobertura: HTMLDivElement;
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
}

const slots: Slot[] = [];
let grade: HTMLDivElement;
let layoutAtual: Layout = '1x1';
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
let estadoAntesDoMpr: Array<{
  pilha: StackNode | null;
  planoSlot: PlanoSlot;
  modoSlab: ModoSlab;
  slabMm: number;
  corte?: number;
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

/** Atualiza o estado global, a borda do slot ativo, os rótulos ATUAL/ANTERIOR e avisa a interface. */
function sincronizar(): void {
  const s = slots[ativo];
  estado.pilhaAtiva = s?.pilha ?? null;
  estado.idViewportAtivo = s?.idViewport ?? null;
  const varios = mprAtivo || LAYOUTS[layoutAtual].colunas * LAYOUTS[layoutAtual].linhas > 1;
  for (const x of slots) x.celula.classList.toggle('ativa', varios && x.indice === ativo);
  atualizarEtiquetasComparacao();
  document.dispatchEvent(new CustomEvent<EstadoViewports>(EVENTO_ESTADO_VIEWPORTS, { detail: estadoAtual() }));
}

export function ativarViewport(indice: number): void {
  const limite = mprAtivo ? 3 : LAYOUTS[layoutAtual].colunas * LAYOUTS[layoutAtual].linhas;
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
    return;
  }
  vp.setSlabThickness(mm);
  const blendMode =
    modo === 'normal'
      ? Enums.BlendModes.AVERAGE_INTENSITY_BLEND
      : MODOS_SLAB[modo].blendMode;
  vp.setBlendMode(blendMode);
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

      await setVolumesForViewports(motor, [{ volumeId }], [slot.idViewport], true);
      if (minhaGeracao !== slot.geracao) return;

      if (slot.planoSlot === 'original' && corteInicial !== undefined) {
        const pos = stack.instances[corteInicial]?.imagePositionPatient;
        if (pos) {
          vp.jumpToWorld([pos[0], pos[1], pos[2]]);
        }
      }

      const voi = voiPreservado?.voiRange ?? voiPadraoDaPilha(stack);
      if (voi) vp.setProperties({ voiRange: voi, invert: voiPreservado?.invert });

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

function liberarRecursosSlot(slot: Slot): void {
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

async function montarLayoutMpr(stack: StackNode): Promise<void> {
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

  if (!mprAtivo) {
    estadoAntesDoMpr = slots.map((s) => ({
      pilha: s.pilha,
      planoSlot: s.planoSlot,
      modoSlab: s.modoSlab,
      slabMm: s.slabMm,
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
    await setVolumesForViewports(motor, [{ volumeId: resVol.volumeId }], idsViewports, true);
    if (minhaGeracaoMpr !== geracaoMpr || !mprAtivo) return;

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
  if (!mprAtivo) return;
  geracaoMpr++;
  mprAtivo = false;
  definirModoMprFerramentas(false);

  const stackPrincipal = slots[0]?.pilha ?? null;
  const salvas = estadoAntesDoMpr;
  estadoAntesDoMpr = [];

  for (let i = 0; i < 3; i++) {
    const s = slots[i]!;
    await desabilitar(s);
    if (i === 0) {
      liberarRecursosSlot(s);
    } else {
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
  const { colunas, linhas } = LAYOUTS[destino];
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
      const restaurada = i === 0 ? (stackPrincipal ?? salvas[0]?.pilha ?? null) : (salvas[i]?.pilha ?? null);
      const corte = salvas[i]?.corte;
      const plano = salvas[i]?.planoSlot ?? 'original';
      const modo = salvas[i]?.modoSlab ?? 'normal';
      const slab = salvas[i]?.slabMm ?? 1;
      if (restaurada) {
        try {
          s.ids = adquirirIds(restaurada, arquivos);
          s.pilha = restaurada;
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
  if (compararAtivo) {
    desativarComparacaoInterno();
  }
  if (mprAtivo) {
    await sairDoMpr();
    return;
  }
  const stack = slots[ativo]?.pilha ?? slots[0]?.pilha ?? null;
  if (!stack) return;
  await montarLayoutMpr(stack);
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

  const quantidadeVisivel = LAYOUTS[layoutAtual].colunas * LAYOUTS[layoutAtual].linhas;
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
  const { colunas, linhas } = LAYOUTS[layoutAtual];
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

export async function definirLayout(novo: Layout): Promise<void> {
  if (compararAtivo && novo !== '1x2') {
    desativarComparacaoInterno();
  }
  if (mprAtivo) {
    await sairDoMpr(novo);
    return;
  }
  layoutAtual = novo;
  const { colunas, linhas } = LAYOUTS[novo];
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
  const etiquetaComparacao = document.createElement('div');
  etiquetaComparacao.className = 'etiqueta-comparacao';
  etiquetaComparacao.hidden = true;
  const avisoCobertura = document.createElement('div');
  avisoCobertura.className = 'aviso-cobertura';
  avisoCobertura.textContent = 'Fora da cobertura';
  avisoCobertura.hidden = true;
  const canvasMira = document.createElement('canvas');
  canvasMira.className = 'canvas-mira';
  celula.append(elemento, canvasMira, mensagem, avisoVolume, controlesMip, etiquetaComparacao, avisoCobertura);

  const slot: Slot = {
    indice,
    idViewport: idViewport(indice),
    celula,
    elemento,
    mensagem,
    avisoVolume,
    controlesMip,
    etiquetaComparacao,
    avisoCobertura,
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
    overlay: undefined as unknown as Overlay,
  };
  slot.overlay = criarOverlay(celula, {
    viewport: () => slot.viewport,
    pilha: () => slot.pilha,
    planoMpr: () => slot.planoMpr,
    modoSlab: () => MODOS_SLAB[mprAtivo ? modoSlabMpr : slot.modoSlab]?.rotulo,
  });
  slot.overlay.ligar(elemento);
  elemento.addEventListener(Enums.Events.VOI_MODIFIED, () => sincronizarVoiMpr(indice));
  elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    atualizarMiraSlot(slot);
  });
  elemento.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, () => {
    aoRolarSlotComparar(indice);
    atualizarMiraSlot(slot);
  });
  elemento.addEventListener(Enums.Events.CAMERA_MODIFIED, () => {
    atualizarMiraSlot(slot);
  });
  celula.addEventListener('mousedown', () => ativarViewport(indice), true);

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
        slot.viewport?.render();
        slot.overlay.atualizar();
      }
    }
  });
  void definirLayout('1x1');
}
