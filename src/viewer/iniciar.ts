/**
 * Inicialização única do Cornerstone3D: core, loader DICOM (workers) e tools.
 * Nada aqui faz requisição de rede; os arquivos vêm de `File` locais.
 */

import { init as iniciarCore, RenderingEngine } from '@cornerstonejs/core';
import { init as iniciarLoader } from '@cornerstonejs/dicom-image-loader';
import {
  addTool,
  AngleTool,
  EllipticalROITool,
  init as iniciarTools,
  LengthTool,
  PanTool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';

export const ID_MOTOR = 'motor';
export const ID_VIEWPORT_2D = 'vp-principal';

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
      RectangleROITool,
      ProbeTool,
    ]) {
      addTool(ferramenta);
    }
    return new RenderingEngine(ID_MOTOR);
  })();
  return promessa;
}
