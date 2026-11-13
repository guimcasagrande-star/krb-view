/**
 * Inicialização única do Cornerstone3D: core, loader DICOM (workers) e tools.
 * Nada aqui faz requisição de rede; os arquivos vêm de `File` locais.
 */

import { init as iniciarCore, RenderingEngine } from '@cornerstonejs/core';
import { init as iniciarLoader } from '@cornerstonejs/dicom-image-loader';
import { CrosshairsMprTool } from '../tools/crosshairsMpr';
import { MIPJumpToClickTool } from '../tools/mipRotatorio';
import { PolilinhaTool } from '../tools/polilinha';
import {
  addTool,
  AngleTool,
  EllipticalROITool,
  init as iniciarTools,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';

export const ID_MOTOR = 'motor';
/** Máximo de viewports na grade (layout 2x2). */
export const MAX_VIEWPORTS = 4;

/** Id do viewport do Cornerstone para a posição `i` da grade. */
export function idViewport(i: number): string {
  return `vp-${i}`;
}

/** Id do elemento HTML do viewport da posição `i`. */
export function idElemento(i: number): string {
  return `viewport-${i}`;
}

let promessa: Promise<RenderingEngine> | undefined;

/** Inicializa tudo uma vez e devolve o único RenderingEngine do app. */
export function iniciarCornerstone(): Promise<RenderingEngine> {
  promessa ??= (async () => {
    await iniciarCore();
    iniciarLoader({ maxWebWorkers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)) });
    iniciarTools();
    for (const ferramenta of [
      StackScrollTool,
      WindowLevelTool,
      ZoomTool,
      PanTool,
      LengthTool,
      AngleTool,
      EllipticalROITool,
      PlanarFreehandROITool,
      PolilinhaTool,
      CrosshairsMprTool,
      MIPJumpToClickTool,
    ]) {
      addTool(ferramenta);
    }
    return new RenderingEngine(ID_MOTOR);
  })();
  return promessa;
}
