/**
 * Ferramenta Seta / Anotação (`SetaTool`):
 * - 1º clique: ponta da seta (onde se quer apontar a lesão ou estrutura).
 * - Movimento + 2º clique (ou arrastar e soltar): cauda da seta.
 * - Desenha a seta imediatamente sem interromper o fluxo com janelas de texto.
 * - Se quiser adicionar ou editar uma legenda na seta já desenhada, basta selecioná-la
 *   e pressionar `Enter` (ou dar duplo clique sobre ela).
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import { annotation as anotacoes, drawing, type Types } from '@cornerstonejs/tools';
import { FerramentaMultiCliqueBase, type Ponto } from './desenhoMultiClique';

type Ponto2 = CoreTypes.Point2;

interface EstiloDaAnotacao {
  toolGroupId: string;
  toolName: string;
  viewportId: string;
  annotationUID?: string;
}

function distanciaPontoSegmento2d(p: Ponto2, a: Ponto2, b: Ponto2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const q = dx * dx + dy * dy;
  const t = q === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export class SetaTool extends FerramentaMultiCliqueBase {
  static override toolName = 'ArrowCustom';
  protected readonly inicioDeSegmento = [true, false] as const;

  protected override aoCriarAnotacao(ann: Types.Annotation): void {
    (ann.data as { texto?: string }).texto = '';
  }

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(SetaTool.toolName, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;

    for (const ann of anns) {
      const pontos = ann.data.handles!.points as Ponto[];
      if (pontos.length < 2) continue;

      const estiloSpec: EstiloDaAnotacao = {
        toolGroupId: this.toolGroupId!,
        toolName: SetaTool.toolName,
        viewportId: viewport.id,
        annotationUID: ann.annotationUID,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
      const cor = (estilo.color as string) || '#fbbf24';
      const larguraBase = Number(estilo.lineWidth);
      const largura = Number.isFinite(larguraBase) && larguraBase > 0 ? larguraBase : 1.25;

      // pontos[0] = início (cauda da seta); pontos[1] = 2º clique (ponta da seta)
      const inicioCanvas = viewport.worldToCanvas(pontos[0]!) as Ponto2;
      const pontaCanvas = viewport.worldToCanvas(pontos[1]!) as Ponto2;

      drawing.drawArrow(svgDrawingHelper, ann.annotationUID!, 'seta', inicioCanvas, pontaCanvas, {
        color: cor,
        width: largura,
      });

      const texto = (ann.data as { texto?: string }).texto?.trim();
      if (texto) {
        this.renderLinkedTextBoxAnnotation({
          enabledElement,
          svgDrawingHelper,
          annotation: ann,
          styleSpecifier: estiloSpec as never,
          textLines: [texto],
          canvasCoordinates: [inicioCanvas, pontaCanvas],
        });
      }

      desenhou = true;
    }
    return desenhou;
  }

  override isPointNearTool(
    element: HTMLDivElement,
    ann: Types.Annotation,
    canvasCoords: Ponto2,
    proximity: number,
  ): boolean {
    const enabled = getEnabledElement(element);
    if (!enabled) return false;
    const { viewport } = enabled;
    const pontos = ann.data.handles!.points as Ponto[];
    if (pontos.length < 2) return false;
    const ca = viewport.worldToCanvas(pontos[0]!) as Ponto2;
    const cb = viewport.worldToCanvas(pontos[1]!) as Ponto2;
    return distanciaPontoSegmento2d(canvasCoords, ca, cb) <= proximity;
  }
}
