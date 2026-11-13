/**
 * Seleção fácil de medidas:
 * - clique perto da linha, de uma alça ou do texto seleciona a medida (tolerância configurável);
 * - Shift+clique soma à seleção; clique no vazio limpa;
 * - com uma ferramenta de medida ativa, Ctrl+clique seleciona sem começar outra medida;
 * - um botão "Apagar" aparece enquanto houver medida selecionada.
 */

import { eventTarget, getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  Enums as EnumsTools,
  ToolGroupManager,
  utilities,
  type Types,
} from '@cornerstonejs/tools';
import { medidas } from '../state/preferencias';
import { circuloVoiCanvas, NOME_VOI_ESFERA } from './voiEsfera';
import { apagarSelecionadas, FERRAMENTAS_PRIMARIAS, ferramentaPrimariaAtual, ID_GRUPO } from './grupo';

type Ponto2 = [number, number];

interface FerramentaSelecionavel {
  filterInteractableAnnotationsForElement(el: HTMLDivElement, anns: Types.Annotation[]): Types.Annotation[];
  isPointNearTool(el: HTMLDivElement, ann: Types.Annotation, canvas: Ponto2, proximidade: number): boolean;
}

const MOVIMENTO_MAXIMO_PX = 4;

function noTexto(
  element: HTMLDivElement,
  ann: Types.Annotation,
  canvas: Ponto2,
  folga: number,
): boolean {
  const caixa = ann.data?.handles?.textBox?.worldBoundingBox;
  const viewport = getEnabledElement(element)?.viewport;
  if (!caixa || !viewport) return false;
  try {
    const a = viewport.worldToCanvas(caixa.topLeft);
    const b = viewport.worldToCanvas(caixa.bottomRight);
    return (
      canvas[0] >= Math.min(a[0], b[0]) - folga &&
      canvas[0] <= Math.max(a[0], b[0]) + folga &&
      canvas[1] >= Math.min(a[1], b[1]) - folga &&
      canvas[1] <= Math.max(a[1], b[1]) + folga
    );
  } catch {
    return false;
  }
}

function dentroDoPoligono(p: Ponto2, poli: Ponto2[]): boolean {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i]!;
    const [xj, yj] = poli[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Clique no interior de uma ROI (elipse, mão livre ou esfera), para selecionar/arrastar pelo meio. */
function noInterior(element: HTMLDivElement, ann: Types.Annotation, canvas: Ponto2): boolean {
  const viewport = getEnabledElement(element)?.viewport;
  if (!viewport) return false;
  const nome = ann.metadata?.toolName;
  try {
    if (nome === 'EllipticalROI') {
      const pts = (ann.data.handles?.points ?? []).map((q) => viewport.worldToCanvas(q));
      if (pts.length < 4) return false;
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2 || 1;
      const ry = (Math.max(...ys) - Math.min(...ys)) / 2 || 1;
      return ((canvas[0] - cx) / rx) ** 2 + ((canvas[1] - cy) / ry) ** 2 <= 1;
    }
    if (nome === 'PlanarFreehandROI') {
      const poli = ((ann.data as { contour?: { polyline?: CoreTypes.Point3[] } }).contour?.polyline ?? []).map(
        (q) => viewport.worldToCanvas(q) as Ponto2,
      );
      return poli.length >= 3 && dentroDoPoligono(canvas, poli);
    }
    if (nome === NOME_VOI_ESFERA) {
      const c = circuloVoiCanvas(viewport, ann);
      return !!c && Math.hypot(canvas[0] - c.cc[0], canvas[1] - c.cc[1]) <= c.r;
    }
  } catch {
    return false;
  }
  return false;
}

/** UID da medida mais próxima do ponto (em px de tela), ou null. */
export function medidaNoPonto(element: HTMLDivElement, canvas: Ponto2): string | null {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (!grupo) return null;
  const candidatos: Array<{ ferramenta: FerramentaSelecionavel; ann: Types.Annotation }> = [];
  for (const f of FERRAMENTAS_PRIMARIAS) {
    if (f.categoria !== 'medida') continue;
    const ferramenta = grupo.getToolInstance(f.nome) as unknown as FerramentaSelecionavel | undefined;
    if (!ferramenta) continue;
    const todas = anotacoes.state.getAnnotations(f.nome, element);
    if (!todas?.length) continue;
    // A esfera aparece em vários cortes; ela mesma decide (isPointNearTool) se corta o corte atual.
    const visiveis = f.nome === NOME_VOI_ESFERA ? todas : ferramenta.filterInteractableAnnotationsForElement(element, todas);
    for (const ann of visiveis) {
      if (ann.isVisible === false || !ann.annotationUID) continue;
      candidatos.push({ ferramenta, ann });
    }
  }
  const tolerancia = medidas().tolerancia;
  // Do mais perto para o mais longe, para escolher a medida realmente mais próxima.
  for (let prox = 3; prox <= tolerancia; prox += 3) {
    for (const { ferramenta, ann } of candidatos) {
      let perto = false;
      try {
        perto = ferramenta.isPointNearTool(element, ann, canvas, prox);
      } catch {
        perto = false;
      }
      if (perto || noTexto(element, ann, canvas, 2)) return ann.annotationUID ?? null;
    }
  }
  // Por último, o interior das ROIs (clicar no meio da ROI).
  for (const { ann } of candidatos) {
    if (noInterior(element, ann, canvas)) return ann.annotationUID ?? null;
  }
  return null;
}

export function ferramentaAtivaEhMedida(): boolean {
  const atual = ferramentaPrimariaAtual();
  return FERRAMENTAS_PRIMARIAS.some((f) => f.nome === atual && f.categoria === 'medida');
}

export function iniciarSelecaoFacil(area: HTMLElement): void {
  let inicio: { x: number; y: number } | null = null;

  area.addEventListener(
    'mousedown',
    (ev) => {
      inicio = ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null;
    },
    true,
  );

  area.addEventListener(
    'mouseup',
    (ev) => {
      const origem = inicio;
      inicio = null;
      if (!origem || ev.button !== 0) return;
      if (Math.hypot(ev.clientX - origem.x, ev.clientY - origem.y) > MOVIMENTO_MAXIMO_PX) return;
      // Com ferramenta de medida ativa, o clique comum começa uma medida; Ctrl+clique seleciona.
      if (ferramentaAtivaEhMedida() && !ev.ctrlKey) return;
      const alvo = ev.target instanceof Element ? ev.target.closest<HTMLDivElement>('[data-viewport-uid]') : null;
      if (!alvo) return;
      const viewport = getEnabledElement(alvo)?.viewport;
      if (!viewport) return;
      const rect = alvo.getBoundingClientRect();
      const uid = medidaNoPonto(alvo, [ev.clientX - rect.left, ev.clientY - rect.top]);
      if (uid) {
        anotacoes.selection.setAnnotationSelected(uid, true, ev.shiftKey);
      } else if (!ev.shiftKey) {
        anotacoes.selection.deselectAnnotation();
      }
      utilities.triggerAnnotationRenderForViewportIds([viewport.id]);
    },
    true,
  );

  // Botão "Apagar" flutuante enquanto houver medidas selecionadas.
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'chip-apagar-medidas';
  chip.hidden = true;
  chip.addEventListener('click', () => void apagarSelecionadas());
  area.append(chip);

  const atualizarChip = (): void => {
    const uids = anotacoes.selection
      .getAnnotationsSelected()
      .filter((uid) => anotacoes.state.getAnnotation(uid)?.metadata?.toolName !== 'Crosshairs');
    chip.hidden = uids.length === 0;
    chip.textContent = `🗑 Apagar ${uids.length === 1 ? 'medida selecionada' : `${uids.length} medidas selecionadas`} (Del)`;
  };
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_SELECTION_CHANGE, atualizarChip);
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_REMOVED, atualizarChip);
}
