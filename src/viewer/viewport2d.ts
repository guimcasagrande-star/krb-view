/**
 * Viewport 2D de pilha. Recebe um StackNode, cria os imageIds na ordem de
 * `stack.instances` (já ordenada) e carrega primeiro o corte do meio e os vizinhos.
 */

import { Enums, imageLoader, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode } from '../io/organize';
import { criarGrupoFerramentas, ID_ELEMENTO_2D } from '../tools/grupo';
import { estado } from '../state/store';
import { ID_VIEWPORT_2D, iniciarCornerstone } from './iniciar';

const ID_VIEWPORT = ID_VIEWPORT_2D;
const CARGAS_SIMULTANEAS = 4;

export interface ElementosViewport2d {
  /** Contêiner onde o canvas do viewport é criado. */
  contentor: HTMLElement;
  /** Mensagem sobre o viewport (vazio, carregando, erro). */
  mensagem: HTMLElement;
}

let el: ElementosViewport2d;
let elementoViewport: HTMLDivElement | undefined;
let imageIdsAtuais: string[] = [];
let geracao = 0;

export function configurarViewport2d(elementos: ElementosViewport2d): void {
  el = elementos;
}

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

function mostrarMensagem(titulo: string, detalhe?: string, erro = false): void {
  el.mensagem.hidden = false;
  el.mensagem.replaceChildren();
  const t = document.createElement('div');
  t.textContent = titulo;
  if (erro) t.className = 'erro';
  el.mensagem.append(t);
  if (detalhe) {
    const d = document.createElement('span');
    d.textContent = detalhe;
    el.mensagem.append(d);
  }
}

function liberarImageIds(): void {
  for (const id of imageIdsAtuais) {
    const indice = Number(id.slice(id.indexOf(':') + 1));
    if (Number.isInteger(indice)) wadouri.fileManager.remove(indice);
  }
  imageIdsAtuais = [];
  wadouri.dataSetCacheManager.purge();
}

async function garantirViewport(): Promise<Types.IStackViewport> {
  const motor = await iniciarCornerstone();
  if (!elementoViewport) {
    elementoViewport = document.createElement('div');
    elementoViewport.id = ID_ELEMENTO_2D;
    elementoViewport.addEventListener('contextmenu', (e) => e.preventDefault());
    el.contentor.append(elementoViewport);
    motor.enableElement({
      viewportId: ID_VIEWPORT,
      type: Enums.ViewportType.STACK,
      element: elementoViewport,
    });
    criarGrupoFerramentas();
  }
  return motor.getViewport<Types.IStackViewport>(ID_VIEWPORT);
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

async function carregarRestante(ids: string[], ordem: number[], minhaGeracao: number): Promise<void> {
  let proximo = 1; // o corte do meio já foi carregado
  let primeiroErro: string | undefined;
  async function trabalhador(): Promise<void> {
    while (minhaGeracao === geracao) {
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
  if (minhaGeracao === geracao && primeiroErro) {
    console.warn(`Alguns cortes não carregaram: ${primeiroErro}`);
  }
}

/** Mostra a pilha no viewport. Erros aparecem na tela com o nome da série. */
export async function abrirPilha2d(stack: StackNode): Promise<void> {
  const minhaGeracao = ++geracao;
  const primeira = stack.instances[0];
  const nomeSerie = [primeira?.modality, primeira?.seriesDescription].filter(Boolean).join(' · ') || stack.id;
  const arquivos = estado.resultado?.arquivos;
  if (!arquivos) return;

  mostrarMensagem(`Carregando ${nomeSerie}…`);
  try {
    const viewport = await garantirViewport();
    if (minhaGeracao !== geracao) return;

    liberarImageIds();
    const ids = stack.instances.map((inst) => {
      const arquivo = arquivos.get(inst.fileId);
      if (!arquivo) throw new Error(`Arquivo não encontrado: ${inst.fileId}`);
      return wadouri.fileManager.add(arquivo);
    });
    imageIdsAtuais = ids;

    const meio = Math.floor(ids.length / 2);
    // Carregar o corte do meio antes: se a série não decodifica, o erro aparece já aqui.
    await imageLoader.loadAndCacheImage(ids[meio]!);
    if (minhaGeracao !== geracao) return;
    await viewport.setStack(ids, meio);
    viewport.render();
    el.mensagem.hidden = true;
    void carregarRestante(ids, ordemDoMeio(ids.length, meio), minhaGeracao);
  } catch (e) {
    if (minhaGeracao !== geracao) return;
    mostrarMensagem(`Não foi possível abrir a série ${nomeSerie}`, textoDoErro(e), true);
  }
}
