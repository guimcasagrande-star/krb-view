/**
 * Arrastar medidas para mudar a posição no corte.
 *
 * - Pressionar sobre uma medida (na linha, no texto ou, nas ROIs, no meio) e arrastar move a
 *   medida inteira; pressionar numa ponta (alça) de uma medida de linha ou ângulo edita só aquele
 *   ponto. Ao soltar a medida continua selecionada.
 * - Com uma ferramenta de medida ativa, o clique comum começa outra medida: use Ctrl+arrastar.
 * - Vale para todas as medidas, nativas ou desta aplicação. Ao mover a ROI volumétrica, as
 *   estatísticas são recalculadas na nova posição.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { annotation as anotacoes, utilities as utilitarios, type Types } from '@cornerstonejs/tools';
import { ferramentaAtivaEhMedida, medidaNoPonto, noTexto } from './selecao';
import { ehFerramentaVoi, NOME_LESAO_PET, NOME_VOI_ESFERA, recalcularVoi } from './voiEsfera';

type Ponto3 = [number, number, number];

const LIMIAR_PX = 3;
/** Distância (px) para uma alça (ponta) contar como clicada. */
const RAIO_ALCA_PX = 9;
/** ROIs e esfera movem inteiras; nas demais, clicar numa ponta edita só aquele ponto. */
/** Ferramentas do Cornerstone: ele mesmo edita as pontas quando a ferramenta está ativa. */
const NATIVAS = new Set(['Length', 'Angle', 'EllipticalROI', 'PlanarFreehandROI']);
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

const copia = (p: ArrayLike<number>): Ponto3 => [p[0]!, p[1]!, p[2]!];

function idsDosViewports(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-viewport-uid]'))
    .map((e) => e.getAttribute('data-viewport-uid'))
    .filter((v): v is string => !!v);
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
    utilitarios.triggerAnnotationRenderForViewportIds(idsDosViewports());
    ev.preventDefault();
  };

  const aoSoltar = (): void => {
    const a = arrasto;
    arrasto = null;
    window.removeEventListener('mousemove', aoMover, true);
    window.removeEventListener('mouseup', aoSoltar, true);
    if (!a) return;
    if (a.moveu && !a.soTexto && ehFerramentaVoi(a.ann.metadata?.toolName)) recalcularVoi(a.ann);
    utilitarios.triggerAnnotationRenderForViewportIds(idsDosViewports());
  };

  area.addEventListener(
    'mousedown',
    (ev) => {
      if (ev.button !== 0 || arrasto) return;
      // Com ferramenta de medida ativa: só Ctrl move; e uma ponta de medida desta aplicação
      // (que o Cornerstone não edita) é editada mesmo sem Ctrl.
      const medindoSemCtrl = ferramentaAtivaEhMedida() && !ev.ctrlKey;
      const alvo = ev.target instanceof Element ? ev.target.closest<HTMLDivElement>('[data-viewport-uid]') : null;
      if (!alvo) return;
      const viewport = getEnabledElement(alvo)?.viewport;
      if (!viewport) return;
      const rect = alvo.getBoundingClientRect();
      const canvas: [number, number] = [ev.clientX - rect.left, ev.clientY - rect.top];
      const uid = medidaNoPonto(alvo, canvas);
      const ann = uid ? anotacoes.state.getAnnotation(uid) : undefined;
      if (!uid || !ann?.data?.handles) return;
      if (ann.isLocked) return;

      const dados = ann.data as {
        handles: { points?: Ponto3[]; textBox?: { worldPosition?: Ponto3 } };
        contour?: { polyline?: Ponto3[] };
      };
      anotacoes.selection.setAnnotationSelected(uid, true, ev.shiftKey);
      const mundo = viewport.canvasToWorld(canvas);
      // Clicou na caixa de texto da medida? Move só a caixa de texto (sem deslocar a lesão/seta).
      const soTexto = noTexto(alvo, ann, canvas, 4);
      // Clicou numa ponta de uma medida de linha/ângulo? Então só esse ponto é editado.
      let alca: number | undefined;
      if (!soTexto && !SEM_ALCA.has(ann.metadata?.toolName ?? '')) {
        let melhor = RAIO_ALCA_PX;
        (dados.handles.points ?? []).forEach((q, i) => {
          const c = viewport.worldToCanvas(q);
          const dist = Math.hypot(c[0] - canvas[0], c[1] - canvas[1]);
          if (dist <= melhor) {
            melhor = dist;
            alca = i;
          }
        });
      }
      if (medindoSemCtrl && !soTexto && (alca === undefined || NATIVAS.has(ann.metadata?.toolName ?? ''))) return;
      arrasto = {
        ann,
        element: alvo,
        inicioCanvas: [ev.clientX, ev.clientY],
        inicioMundo: copia(mundo),
        moveu: false,
        ...(soTexto ? { soTexto: true } : {}),
        ...(alca !== undefined ? { alca } : {}),
        pontos: (dados.handles.points ?? []).map(copia),
        ...(dados.contour?.polyline ? { polilinha: dados.contour.polyline.map(copia) } : {}),
        ...(dados.handles.textBox?.worldPosition ? { texto: copia(dados.handles.textBox.worldPosition) } : {}),
      };
      // A ferramenta ativa (cortes, janela, pan...) não deve agir neste clique.
      ev.stopPropagation();
      ev.preventDefault();
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
    },
    true,
  );
}
