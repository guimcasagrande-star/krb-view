/**
 * Extensão do CrosshairsTool para navegação tradicional em MPR:
 * - Centro vazado: as linhas se abrem em volta do cruzamento (sem bolinha) para o ponto ficar visível.
 * - Clicar e arrastar pelo centro (em qualquer plano e mesmo quando outra ferramenta
 *   como Janela/nível está selecionada) move o centro livremente nos dois eixos do plano
 *   e atualiza os três planos simultaneamente para o ponto onde o usuário soltar.
 * - Arrastar uma linha individual move só o plano correspondente; arrastar as alças
 *   circulares gira para MPR oblíquo; arrastar as alças retangulares ajusta o slab.
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import {
  CrosshairsTool,
  utilities,
  type Types,
} from '@cornerstonejs/tools';
import type { CrosshairsAnnotation } from '@cornerstonejs/tools/tools/CrosshairsTool';

const OPERACAO_ARRASTAR = 1;
const RAIO_CAPTURA_CENTRO_PX = 14;

export class CrosshairsMprTool extends CrosshairsTool {
  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps?: Types.ToolProps,
  ) {
    super(toolProps, defaultToolProps);

    const dragOriginal = this._dragCallback;
    this._dragCallback = (evt: Types.EventTypes.InteractionEventType) => {
      const detalhe = evt.detail;
      const enabledElement = getEnabledElement(detalhe.element);
      if (enabledElement) {
        const annotations = this._getAnnotations(enabledElement);
        const filtradas = this.filterInteractableAnnotationsForElement(
          detalhe.element,
          annotations,
        ) as CrosshairsAnnotation[] | undefined;
        const vpAnn = filtradas?.[0];
        if (
          vpAnn?.data?.handles?.activeOperation === OPERACAO_ARRASTAR &&
          vpAnn.data.activeViewportIds?.length >= 2 &&
          detalhe.currentPoints?.world
        ) {
          this._jump(enabledElement, detalhe.currentPoints.world);
          const viewportIds = this._getViewportsInfo().map(
            (v: { viewportId: string }) => v.viewportId,
          );
          utilities.triggerAnnotationRenderForViewportIds(viewportIds);
          return;
        }
      }
      dragOriginal(evt);
    };
  }

  override _pointNearTool(
    element: HTMLDivElement,
    annotation: CrosshairsAnnotation,
    canvasCoords: CoreTypes.Point2,
    proximity: number,
  ): boolean {
    const enabledElement = getEnabledElement(element);
    if (enabledElement && this.toolCenter) {
      const centroCanvas = enabledElement.viewport.worldToCanvas(this.toolCenter);
      const distCentro = Math.hypot(
        canvasCoords[0] - centroCanvas[0],
        canvasCoords[1] - centroCanvas[1],
      );
      if (distCentro <= Math.max(proximity, RAIO_CAPTURA_CENTRO_PX)) {
        const ids: string[] = [];
        const rotPoints = annotation.data?.handles?.rotationPoints ?? [];
        for (const rp of rotPoints) {
          const outroVp = (rp as unknown as [unknown, { id?: string }])[1];
          if (outroVp?.id && !ids.includes(outroVp.id)) {
            ids.push(outroVp.id);
          }
        }
        if (ids.length === 0) {
          for (const info of this._getViewportsInfo()) {
            if (info.viewportId !== enabledElement.viewport.id) {
              ids.push(info.viewportId);
            }
          }
        }
        annotation.data.activeViewportIds = ids;
        annotation.data.handles.activeOperation = OPERACAO_ARRASTAR;
        (this as unknown as { editData: unknown }).editData = { annotation };
        return true;
      }
    }
    return super._pointNearTool(element, annotation, canvasCoords, proximity);
  }
}
