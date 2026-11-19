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
  MedidasOrtogonaisTool,
  ProporcaoLinearTool,
} from '../tools/medidasAvancadas';
import { MIPJumpToClickTool } from '../tools/mipRotatorio';
import { DistanciaTool } from '../tools/estiloMedidas';
import { PolilinhaTool } from '../tools/polilinha';
import { SetaTool } from '../tools/seta';
import { LesaoPetTool, VoiEsferaTool } from '../tools/voiEsfera';
import { EllipsoidVolumeTool } from '../tools/volumeElipsoide';
import { BrushTool, VasoTool } from '../segmentation/ferramentas';
import {
  addTool,
  AngleTool,
  EllipticalROITool,
  init as iniciarTools,
  PanTool,
  PlanarFreehandROITool,
  ReferenceLinesTool,
  StackScrollTool,
  TrackballRotateTool,
  VolumeCroppingTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';

import { GirarPlanoTool } from '../tools/girarPlano';
import { preferencias, type PreferenciaGpu } from '../state/preferencias';

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
let contextoWebglConfigurado = false;

interface TauriGpuBridge {
  core?: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

/** Grava a preferência de GPU para o WebView2 nativo usar na próxima inicialização (em notebooks híbridos). */
export function sincronizarPreferenciaGpuNativa(modo: PreferenciaGpu): void {
  const t = (globalThis as { __TAURI__?: TauriGpuBridge }).__TAURI__;
  if (!t?.core?.invoke) return;
  void t.core.invoke('gpu_definir_preferencia', { modo }).catch(() => undefined);
}

function instalarPreferenciaWebgl(): void {
  if (contextoWebglConfigurado || typeof HTMLCanvasElement === 'undefined') return;
  contextoWebglConfigurado = true;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown,
  ): RenderingContext | null {
    if (contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl') {
      const pref = preferencias().preferenciaGpu;
      const powerPreference: WebGLPowerPreference | undefined =
        pref === 'alto-desempenho' ? 'high-performance' : pref === 'economia' ? 'low-power' : undefined;
      if (powerPreference) {
        const base = options && typeof options === 'object' ? (options as WebGLContextAttributes) : {};
        return original.call(this, contextId as 'webgl2', { ...base, powerPreference });
      }
    }
    return original.call(this, contextId as never, options as never);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

/** Inicializa tudo uma vez e devolve o único RenderingEngine do app. */
export function iniciarCornerstone(): Promise<RenderingEngine> {
  promessa ??= (async () => {
    instalarPreferenciaWebgl();
    sincronizarPreferenciaGpuNativa(preferencias().preferenciaGpu);
    await iniciarCore();
    iniciarLoader({ maxWebWorkers: Math.max(1, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1)) });
    iniciarTools();
    for (const ferramenta of [
      StackScrollTool,
      WindowLevelTool,
      ZoomTool,
      PanTool,
      DistanciaTool,
      MedidasOrtogonaisTool,
      EllipsoidVolumeTool,
      DesvioLinhaMediaTool,
      ProporcaoLinearTool,
      EstenoseTool,
      AngleTool,
      AnguloCobbTool,
      AnguloReferenciaTool,
      SetaTool,
      VoiEsferaTool,
      LesaoPetTool,
      EllipticalROITool,
      PlanarFreehandROITool,
      ReferenceLinesTool,
      PolilinhaTool,
      CrosshairsMprTool,
      GirarPlanoTool,
      MIPJumpToClickTool,
      TrackballRotateTool,
      VolumeCroppingTool,
      BrushTool,
      VasoTool,
    ]) {
      addTool(ferramenta);
    }
    return new RenderingEngine(ID_MOTOR);
  })();
  return promessa;
}
