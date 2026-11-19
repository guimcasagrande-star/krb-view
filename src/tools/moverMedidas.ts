/**
 * Arrastar medidas para mudar a posição no corte.
 *
 * - Pressionar sobre uma medida (na linha, no texto ou, nas ROIs, no meio) e arrastar move a
 *   medida inteira; pressionar numa ponta (alça) de uma medida de linha ou ângulo edita só aquele
 *   ponto. Ao soltar a medida continua selecionada.
 * - Sobre uma medida o cursor vira uma mãozinha: ali o clique arrasta a medida, mesmo com uma
 *   ferramenta de medida ativa (fora dela, o clique começa outra medida).
 * - Nas alças da ROI elíptica o cursor vira um dedo: arrastar ali muda o tamanho (pelo Cornerstone).
 * - Vale para todas as medidas, nativas ou desta aplicação. Ao mover a ROI volumétrica, as
 *   estatísticas são recalculadas na nova posição.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  state as estadoTools,
  ToolGroupManager,
  utilities as utilitarios,
  type Types,
} from '@cornerstonejs/tools';
import { ehFerramentaSegmentacao } from '../segmentation/ferramentas';
import { ferramentaPrimariaAtual, ID_GRUPO } from './grupo';
import { ajustarPontosOrtogonaisAoMoverAlca, MedidasOrtogonaisTool } from './medidasAvancadas';
import { PolilinhaTool } from './polilinha';
import { medidaNoPonto, noTexto } from './selecao';
import { ehFerramentaVoi, NOME_LESAO_PET, NOME_VOI_ESFERA, recalcularVoi } from './voiEsfera';
import { recalcularVolumesElipsoideAuto } from './volumeElipsoide';

type Ponto3 = [number, number, number];

const LIMIAR_PX = 3;
/** Distância (px) para uma alça (ponta) contar como clicada. */
const RAIO_ALCA_PX = 9;
/** Classes de cursor postas no elemento do viewport. */
const CLASSE_SOBRE = 'sobre-medida';
const CLASSE_ALCA = 'sobre-alca-medida';
const CLASSE_ARRASTANDO = 'arrastando-medida';
/** ROI elíptica: as alças mudam o tamanho, e quem faz isso é o próprio Cornerstone. */
const REDIMENSIONA_PELA_ALCA = new Set(['EllipticalROI']);
/** ROIs e esfera movem inteiras; nas demais, clicar numa ponta edita só aquele ponto. */
const SEM_ALCA = new Set(['EllipticalROI', 'PlanarFreehandROI', NOME_VOI_ESFERA, NOME_LESAO_PET]);

interface Arrasto {
  ann: Types.Annotation;
  element: HTMLDivElement;
  inicioCanvas: [number, number];
  inicioMundo: Ponto3;
  moveu: boolean;
  /** Índice da alça (ponta) sendo editada; ausente = mover a medida inteira. */
  alca?: number;
  /** Verdadeiro quando o arrasto começou sobre a caixa de texto (move só o rótulo). */
  soTexto?: boolean;
  /** Cópias das posições originais, para aplicar o deslocamento total a cada movimento. */
  pontos: Ponto3[];
  polilinha?: Ponto3[];
  texto?: Ponto3;
}

interface Alvo {
  ann: Types.Annotation;
  uid: string;
  /** O ponto está sobre a caixa de texto (move só o rótulo). */
  soTexto: boolean;
  /** Índice da ponta sob o ponto, nas medidas de linha e ângulo. */
  alca?: number;
  /** Alça de redimensionar da ROI elíptica: fica com o Cornerstone. */
  redimensiona: boolean;
}

const copia = (p: ArrayLike<number>): Ponto3 => [p[0]!, p[1]!, p[2]!];

function idsDosViewports(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-viewport-uid]'))
    .map((e) => e.getAttribute('data-viewport-uid'))
    .filter((v): v is string => !!v);
}

/** Há um desenho em andamento (os cliques são pontos dele) ou uma ferramenta de pintura ativa. */
function ocupado(): boolean {
  if (estadoTools.isInteractingWithTool) return true;
  if (ehFerramentaSegmentacao(ferramentaPrimariaAtual())) return true;
  const poli = ToolGroupManager.getToolGroup(ID_GRUPO)?.getToolInstance(PolilinhaTool.toolName) as
    | { desenhando?: boolean }
    | undefined;
  return !!poli?.desenhando;
}

/** Medida arrastável sob o ponto (em px do elemento), com a parte dela que seria arrastada. */
function alvoNoPonto(element: HTMLDivElement, canvas: [number, number]): Alvo | null {
  const viewport = getEnabledElement(element)?.viewport;
  if (!viewport) return null;
  const uid = medidaNoPonto(element, canvas);
  const ann = uid ? anotacoes.state.getAnnotation(uid) : undefined;
  if (!uid || !ann?.data?.handles || ann.isLocked) return null;
  const nome = ann.metadata?.toolName ?? '';
  const soTexto = noTexto(element, ann, canvas, 4);
  let alca: number | undefined;
  let melhor = RAIO_ALCA_PX;
  if (!soTexto) {
    ((ann.data.handles.points ?? []) as Ponto3[]).forEach((q, i) => {
      const c = viewport.worldToCanvas(q);
      const dist = Math.hypot(c[0] - canvas[0], c[1] - canvas[1]);
      if (dist <= melhor) {
        melhor = dist;
        alca = i;
      }
    });
  }
  const redimensiona = alca !== undefined && REDIMENSIONA_PELA_ALCA.has(nome);
  if (SEM_ALCA.has(nome)) alca = undefined;
  return { ann, uid, soTexto, redimensiona, ...(alca !== undefined ? { alca } : {}) };
}

function elementoDoEvento(ev: MouseEvent): HTMLDivElement | null {
  return ev.target instanceof Element ? ev.target.closest<HTMLDivElement>('[data-viewport-uid]') : null;
}

function aplicarDeslocamento(a: Arrasto, d: Ponto3): void {
  const dados = a.ann.data as {
    handles?: { points?: Ponto3[]; textBox?: { hasMoved?: boolean; worldPosition?: Ponto3 } };
    contour?: { polyline?: Ponto3[] };
  };
  const caixa = dados.handles?.textBox;
  if (a.soTexto) {
    if (caixa && a.texto) {
      caixa.hasMoved = true;
      caixa.worldPosition = [a.texto[0] + d[0], a.texto[1] + d[1], a.texto[2] + d[2]];
      a.ann.invalidated = true;
    }
    return;
  }
  const pts = dados.handles?.points;
  if (pts && a.alca !== undefined) {
    const o = a.pontos[a.alca];
    if (o) pts[a.alca] = [o[0] + d[0], o[1] + d[1], o[2] + d[2]];
    if (a.ann.metadata?.toolName === MedidasOrtogonaisTool.toolName) {
      ajustarPontosOrtogonaisAoMoverAlca(a.pontos, pts, a.alca);
    }
    a.ann.invalidated = true;
    return;
  }
  if (pts) {
    for (let i = 0; i < pts.length && i < a.pontos.length; i++) {
      const o = a.pontos[i]!;
      pts[i] = [o[0] + d[0], o[1] + d[1], o[2] + d[2]];
    }
  }
  const poli = dados.contour?.polyline;
  if (poli && a.polilinha) {
    for (let i = 0; i < poli.length && i < a.polilinha.length; i++) {
      const o = a.polilinha[i]!;
      poli[i] = [o[0] + d[0], o[1] + d[1], o[2] + d[2]];
    }
  }
  if (caixa?.hasMoved && a.texto) {
    caixa.worldPosition = [a.texto[0] + d[0], a.texto[1] + d[1], a.texto[2] + d[2]];
  }
  a.ann.invalidated = true;
}

export function iniciarMoverMedidas(area: HTMLElement): void {
  let arrasto: Arrasto | null = null;

  const aoMover = (ev: MouseEvent): void => {
    const a = arrasto;
    if (!a) return;
    if (!a.moveu && Math.hypot(ev.clientX - a.inicioCanvas[0], ev.clientY - a.inicioCanvas[1]) < LIMIAR_PX) return;
    a.moveu = true;
    const viewport = getEnabledElement(a.element)?.viewport;
    if (!viewport) return;
    const rect = a.element.getBoundingClientRect();
    const atual = viewport.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]);
    aplicarDeslocamento(a, [atual[0] - a.inicioMundo[0], atual[1] - a.inicioMundo[1], atual[2] - a.inicioMundo[2]]);
    recalcularVolumesElipsoideAuto(false);
    utilitarios.triggerAnnotationRenderForViewportIds(idsDosViewports());
    ev.preventDefault();
  };

  const aoSoltar = (): void => {
    const a = arrasto;
    arrasto = null;
    window.removeEventListener('mousemove', aoMover, true);
    window.removeEventListener('mouseup', aoSoltar, true);
    if (!a) return;
    a.element.classList.remove(CLASSE_ARRASTANDO);
    if (a.moveu && !a.soTexto && ehFerramentaVoi(a.ann.metadata?.toolName)) recalcularVoi(a.ann);
    recalcularVolumesElipsoideAuto(false);
    utilitarios.triggerAnnotationRenderForViewportIds(idsDosViewports());
  };

  area.addEventListener(
    'mousedown',
    (ev) => {
      if (ev.button !== 0 || arrasto || ocupado()) return;
      const alvo = elementoDoEvento(ev);
      if (!alvo) return;
      const viewport = getEnabledElement(alvo)?.viewport;
      if (!viewport) return;
      const rect = alvo.getBoundingClientRect();
      const canvas: [number, number] = [ev.clientX - rect.left, ev.clientY - rect.top];
      const achado = alvoNoPonto(alvo, canvas);
      if (!achado) return;
      const { ann, uid, soTexto, alca } = achado;
      anotacoes.selection.setAnnotationSelected(uid, true, ev.shiftKey);
      // Alça da ROI elíptica: o Cornerstone redimensiona (este clique segue para ele).
      if (achado.redimensiona) return;

      const dados = ann.data as {
        handles: { points?: Ponto3[]; textBox?: { worldPosition?: Ponto3 } };
        contour?: { polyline?: Ponto3[] };
      };
      arrasto = {
        ann,
        element: alvo,
        inicioCanvas: [ev.clientX, ev.clientY],
        inicioMundo: copia(viewport.canvasToWorld(canvas)),
        moveu: false,
        ...(soTexto ? { soTexto: true } : {}),
        ...(alca !== undefined ? { alca } : {}),
        pontos: (dados.handles.points ?? []).map(copia),
        ...(dados.contour?.polyline ? { polilinha: dados.contour.polyline.map(copia) } : {}),
        ...(dados.handles.textBox?.worldPosition ? { texto: copia(dados.handles.textBox.worldPosition) } : {}),
      };
      alvo.classList.add(CLASSE_ARRASTANDO);
      // A ferramenta ativa (cortes, janela, pan, outra medida...) não deve agir neste clique.
      ev.stopPropagation();
      ev.preventDefault();
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
    },
    true,
  );

  // Mãozinha: mostra onde o clique arrasta uma medida em vez de usar a ferramenta ativa.
  let marcado: HTMLDivElement | null = null;
  let pendente: MouseEvent | null = null;
  const limparCursor = (): void => {
    marcado?.classList.remove(CLASSE_SOBRE, CLASSE_ALCA);
    marcado = null;
  };
  const atualizarCursor = (): void => {
    const ev = pendente;
    pendente = null;
    if (!ev || arrasto) return;
    const element = ev.buttons === 0 && !ocupado() ? elementoDoEvento(ev) : null;
    let achado: Alvo | null = null;
    if (element) {
      const rect = element.getBoundingClientRect();
      try {
        achado = alvoNoPonto(element, [ev.clientX - rect.left, ev.clientY - rect.top]);
      } catch {
        achado = null;
      }
    }
    if (marcado && marcado !== element) limparCursor();
    if (!element) return;
    marcado = element;
    element.classList.toggle(CLASSE_SOBRE, !!achado && !achado.redimensiona);
    element.classList.toggle(CLASSE_ALCA, !!achado?.redimensiona);
  };
  area.addEventListener('mousemove', (ev) => {
    const agendar = pendente === null;
    pendente = ev;
    if (agendar) requestAnimationFrame(atualizarCursor);
  });
  area.addEventListener('mouseleave', limparCursor);
}
