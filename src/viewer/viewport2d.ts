/**
 * Grade de viewports 2D de pilha (layouts 1x1, 1x2 e 2x2). Cada célula é um "slot" com
 * seu viewport, seu overlay e sua pilha. Um slot fica ativo e recebe a série clicada no
 * painel. Os imageIds seguem a ordem de `stack.instances` (já ordenada) e são
 * compartilhados entre slots que mostram a mesma pilha. O corte do meio e os vizinhos
 * carregam primeiro.
 */

import { cache, Enums, imageLoader, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode } from '../io/organize';
import { adicionarViewportAoGrupo, removerViewportDoGrupo } from '../tools/grupo';
import { estado } from '../state/store';
import { cineTocando, definirFps, fpsAtual, pararCine, pararTodosCines, tocarCine } from './cine';
import { idElemento, idViewport, iniciarCornerstone, MAX_VIEWPORTS } from './iniciar';
import { criarOverlay, type Overlay } from './overlay';

const CARGAS_SIMULTANEAS = 4;

export type Layout = '1x1' | '1x2' | '2x2';

export const LAYOUTS: Record<Layout, { rotulo: string; colunas: number; linhas: number }> = {
  '1x1': { rotulo: '1x1', colunas: 1, linhas: 1 },
  '1x2': { rotulo: '1x2', colunas: 2, linhas: 1 },
  '2x2': { rotulo: '2x2', colunas: 2, linhas: 2 },
};

export const ORDEM_LAYOUTS: Layout[] = ['1x1', '1x2', '2x2'];

/** Disparado em `document` quando muda o viewport ativo, o layout ou o cine. */
export const EVENTO_ESTADO_VIEWPORTS = 'estadoViewports';

export interface EstadoViewports {
  layout: Layout;
  /** Id da pilha mostrada no viewport ativo (null se vazio). */
  pilhaId: string | null;
  cineTocando: boolean;
  fps: number;
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
  overlay: Overlay;
  viewport?: Types.IStackViewport;
  habilitado: boolean;
  pilha: StackNode | null;
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
    // Tira a imagem do cache do Cornerstone (isso também solta o dataset DICOM dela).
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
  return {
    layout: layoutAtual,
    pilhaId: slots[ativo]?.pilha?.id ?? null,
    cineTocando: cineTocando(ativo),
    fps: fpsAtual(),
  };
}

/** Atualiza o estado global, a borda do slot ativo e avisa a interface. */
function sincronizar(): void {
  const s = slots[ativo];
  estado.pilhaAtiva = s?.pilha ?? null;
  estado.idViewportAtivo = s?.idViewport ?? null;
  const varios = LAYOUTS[layoutAtual].colunas * LAYOUTS[layoutAtual].linhas > 1;
  for (const x of slots) x.celula.classList.toggle('ativa', varios && x.indice === ativo);
  document.dispatchEvent(new CustomEvent<EstadoViewports>(EVENTO_ESTADO_VIEWPORTS, { detail: estadoAtual() }));
}

export function ativarViewport(indice: number): void {
  if (!slots[indice] || indice === ativo) return;
  ativo = indice;
  sincronizar();
}

export function layoutId(): Layout {
  return layoutAtual;
}

async function garantirViewport(slot: Slot): Promise<Types.IStackViewport> {
  const motor = await iniciarCornerstone();
  if (!slot.habilitado || !slot.viewport) {
    motor.enableElement({
      viewportId: slot.idViewport,
      type: Enums.ViewportType.STACK,
      element: slot.elemento,
    });
    adicionarViewportAoGrupo(slot.idViewport);
    slot.viewport = motor.getViewport<Types.IStackViewport>(slot.idViewport);
    slot.habilitado = true;
  }
  return slot.viewport;
}

/** Desliga o viewport de um slot escondido. A pilha continua nele para voltar depois. */
async function desabilitar(slot: Slot): Promise<void> {
  if (!slot.habilitado) return;
  pararCine(slot.indice);
  slot.geracao++;
  try {
    slot.corteSalvo = slot.viewport?.getCurrentImageIdIndex();
  } catch {
    slot.corteSalvo = undefined;
  }
  const motor = await iniciarCornerstone();
  removerViewportDoGrupo(slot.idViewport);
  motor.disableElement(slot.idViewport);
  slot.viewport = undefined;
  slot.habilitado = false;
}

/** Mostra no slot a pilha que ele já tem (os imageIds já estão registrados). */
async function exibirSlot(slot: Slot, corteInicial?: number): Promise<void> {
  const stack = slot.pilha;
  if (!stack) return;
  const minhaGeracao = ++slot.geracao;
  const nome = nomeDaSerie(stack);
  mostrarMensagem(slot, `Carregando ${nome}…`);
  try {
    const viewport = await garantirViewport(slot);
    if (minhaGeracao !== slot.geracao) return;

    const ids = slot.ids;
    const inicial = Math.min(Math.max(corteInicial ?? Math.floor(ids.length / 2), 0), ids.length - 1);
    // Carregar o primeiro corte antes: se a série não decodifica, o erro aparece já aqui.
    await imageLoader.loadAndCacheImage(ids[inicial]!);
    if (minhaGeracao !== slot.geracao) return;
    await viewport.setStack(ids, inicial);
    viewport.render();
    slot.overlay.atualizar();
    esconderMensagem(slot);
    void carregarRestante(slot, ids, ordemDoMeio(ids.length, inicial), minhaGeracao);
  } catch (e) {
    if (minhaGeracao !== slot.geracao) return;
    mostrarMensagem(slot, `Não foi possível abrir a série ${nome}`, textoDoErro(e), true);
  }
}

/** Abre a pilha no viewport ativo. Erros aparecem na célula com o nome da série. */
export async function abrirPilha2d(stack: StackNode): Promise<void> {
  const slot = slots[ativo];
  const arquivos = estado.resultado?.arquivos;
  if (!slot || !arquivos) return;

  const anterior = slot.pilha?.id;
  try {
    slot.ids = adquirirIds(stack, arquivos);
  } catch (e) {
    slot.geracao++;
    mostrarMensagem(slot, `Não foi possível abrir a série ${nomeDaSerie(stack)}`, textoDoErro(e), true);
    return;
  }
  pararCine(slot.indice);
  slot.pilha = stack;
  slot.corteSalvo = undefined;
  sincronizar();
  try {
    await exibirSlot(slot);
  } finally {
    liberarIds(anterior);
  }
}

/** Esvazia todos os viewports (ao abrir outra pasta). */
export async function limparViewports(): Promise<void> {
  pararTodosCines();
  for (const slot of slots) {
    slot.geracao++;
    liberarIds(slot.pilha?.id);
    slot.pilha = null;
    slot.ids = [];
    slot.corteSalvo = undefined;
    await desabilitar(slot);
    slot.overlay.atualizar();
    mostrarMensagem(slot, 'Escolha uma série no painel.');
  }
  sincronizar();
}

// ---------- layout ----------

export async function definirLayout(novo: Layout): Promise<void> {
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
    // Avança um corte e volta ao primeiro depois do último.
    slots[indice]?.viewport?.scroll(1, false, true);
  };
}

/** Toca ou pausa o cine do viewport ativo. */
export function alternarCine(): void {
  const slot = slots[ativo];
  if (!slot?.viewport || !slot.pilha) return;
  if (cineTocando(slot.indice)) pararCine(slot.indice);
  else tocarCine(slot.indice, passoDoCine(slot.indice));
  sincronizar();
}

export function definirVelocidadeCine(fps: number): void {
  definirFps(fps, passoDoCine);
  sincronizar();
}

// ---------- montagem ----------

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
  celula.append(elemento, mensagem);

  const slot: Slot = {
    indice,
    idViewport: idViewport(indice),
    celula,
    elemento,
    mensagem,
    habilitado: false,
    pilha: null,
    ids: [],
    geracao: 0,
    overlay: undefined as unknown as Overlay,
  };
  slot.overlay = criarOverlay(celula, { viewport: () => slot.viewport, pilha: () => slot.pilha });
  slot.overlay.ligar(elemento);
  // Fase de captura: o clique ativa a célula e ainda chega à ferramenta.
  celula.addEventListener('mousedown', () => ativarViewport(indice), true);
  return slot;
}

/** Monta a grade (vazia) dentro da área de viewports. Chamar uma vez. */
export function configurarViewport2d(elementos: ElementosViewport2d): void {
  grade = document.createElement('div');
  grade.id = 'grade';
  for (let i = 0; i < MAX_VIEWPORTS; i++) {
    const slot = criarSlot(i);
    slots.push(slot);
    grade.append(slot.celula);
  }
  elementos.contentor.append(grade);
  void definirLayout('1x1');
}
