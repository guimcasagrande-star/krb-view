/**
 * Inicialização única do Cornerstone3D: core, loader DICOM (workers) e tools.
 * Nada aqui faz requisição de rede; os arquivos vêm de `File` locais.
 */

import { init as iniciarCore, RenderingEngine } from '@cornerstonejs/core';
import { init as iniciarLoader } from '@cornerstonejs/dicom-image-loader';
import { CrosshairsMprTool } from '../tools/crosshairsMpr';
import { DesvioLinhaMediaTool } from '../tools/desvioLinhaMedia';
import {
  AnguloCobbTool,
  AnguloReferenciaTool,
  EstenoseTool,
  ProporcaoLinearTool,
} from '../tools/medidasAvancadas';
import { MIPJumpToClickTool } from '../tools/mipRotatorio';
import { DistanciaTool } from '../tools/estiloMedidas';
import { PolilinhaTool } from '../tools/polilinha';
import { SetaTool } from '../tools/seta';
import { SondaTool } from '../tools/sonda';
import { LesaoPetTool, VoiEsferaTool } from '../tools/voiEsfera';
import {
  addTool,
  AngleTool,
  EllipticalROITool,
  init as iniciarTools,
  PanTool,
  PlanarFreehandROITool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';

export const ID_MOTOR = 'motor';
/** Máximo de viewports na grade (grade personalizada de até 5x5). */
export const MAX_VIEWPORTS = 25;

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
      DistanciaTool,
      DesvioLinhaMediaTool,
      ProporcaoLinearTool,
      EstenoseTool,
      AngleTool,
      AnguloCobbTool,
      AnguloReferenciaTool,
      SetaTool,
      SondaTool,
      VoiEsferaTool,
      LesaoPetTool,
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
