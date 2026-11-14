/**
 * Girar plano: arrastar inclina o plano da imagem em torno de um ponto fixo (o ponto marcado com
 * ┼ Localizar, o centro do crosshair no MPR ou, sem nenhum dos dois, o centro da imagem).
 *
 * - Arrastar para os lados gira em torno do eixo vertical da tela; para cima/baixo, em torno do
 *   eixo horizontal. Com Shift, gira a imagem dentro do próprio plano.
 * - Só vale em imagens reconstruídas (viewport de volume); a conta (`girarCamera`) é pura e
 *   testada em `tests/girarPlano.test.ts`.
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import { BaseTool, type Types } from '@cornerstonejs/tools';

export const NOME_GIRAR_PLANO = 'GirarPlano';

type Vec = [number, number, number];

export interface CameraPlano {
  position: Vec;
  focalPoint: Vec;
  viewUp: Vec;
  viewPlaneNormal: Vec;
}

const GRAUS_POR_PX = 0.35;

const soma = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const menos = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vezes = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const escalar = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vetorial = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function unitario(a: Vec): Vec {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? vezes(a, 1 / n) : a;
}

/** Gira `v` em torno do eixo unitário `eixo` por `rad` (fórmula de Rodrigues). */
export function girarVetor(v: Vec, eixo: Vec, rad: number): Vec {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return soma(soma(vezes(v, c), vezes(vetorial(eixo, v), s)), vezes(eixo, escalar(eixo, v) * (1 - c)));
}

/** Ponto do plano da câmera (o que passa pelo ponto focal) mais próximo de `p`. */
export function projetarNoPlano(p: Vec, camera: CameraPlano): Vec {
  const n = unitario(camera.viewPlaneNormal);
  return menos(p, vezes(n, escalar(menos(p, camera.focalPoint), n)));
}

/**
 * Câmera girada em torno da reta que passa por `pivo` na direção `eixo`. O pivô continua no
 * mesmo lugar da tela e, se estava no plano da imagem, continua nele.
 */
export function girarCamera(camera: CameraPlano, pivo: Vec, eixo: Vec, rad: number): CameraPlano {
  const e = unitario(eixo);
  const ponto = (p: Vec): Vec => soma(pivo, girarVetor(menos(p, pivo), e, rad));
  return {
    position: ponto(camera.position),
    focalPoint: ponto(camera.focalPoint),
    viewUp: unitario(girarVetor(camera.viewUp, e, rad)),
    viewPlaneNormal: unitario(girarVetor(camera.viewPlaneNormal, e, rad)),
  };
}

/** Quem conhece os viewports informa o ponto marcado (ou null) e avisa quando não dá para girar. */
export interface ApoioGirarPlano {
  pivo(idViewport: string): Vec | null;
  semVolume(idViewport: string): void;
}

let apoio: ApoioGirarPlano | undefined;
/** Câmera de cada viewport antes do primeiro giro, para o botão Restaurar. */
const originais = new Map<string, CameraPlano>();

export function definirApoioGirarPlano(a: ApoioGirarPlano): void {
  apoio = a;
}

/** O mínimo que se usa do viewport (os tipos de pilha e de volume do Cornerstone divergem). */
interface ComCamera {
  id: string;
  getCamera(): CoreTypes.ICamera;
  setCamera(camera: CameraPlano): void;
}

function lerCamera(viewport: ComCamera): CameraPlano | null {
  const c = viewport.getCamera();
  if (!c.position || !c.focalPoint || !c.viewUp || !c.viewPlaneNormal) return null;
  return {
    position: [...c.position] as Vec,
    focalPoint: [...c.focalPoint] as Vec,
    viewUp: [...c.viewUp] as Vec,
    viewPlaneNormal: [...c.viewPlaneNormal] as Vec,
  };
}

/** Esquece o plano original (a série ou o plano do quadro mudou). */
export function esquecerPlanoGirado(idViewport: string): void {
  originais.delete(idViewport);
}

/** Desfaz o giro do viewport, se houve. Devolve se mudou a câmera. */
export function restaurarPlanoGirado(viewport: ComCamera): boolean {
  const original = originais.get(viewport.id);
  if (!original) return false;
  originais.delete(viewport.id);
  viewport.setCamera(original);
  return true;
}

export class GirarPlanoTool extends BaseTool {
  static override toolName = NOME_GIRAR_PLANO;

  /** Ponto fixo do arrasto em curso. */
  private pivo: Vec | null = null;

  constructor(
    toolProps: Types.PublicToolProps = {},
    defaultToolProps: Types.ToolProps = { supportedInteractionTypes: ['Mouse'] },
  ) {
    super(toolProps, defaultToolProps);
  }

  preMouseDownCallback = (evt: Types.EventTypes.InteractionEventType): boolean => {
    this.pivo = null;
    const viewport = getEnabledElement(evt.detail.element)?.viewport;
    if (!viewport) return false;
    // Pilha 2D não tem outros planos para mostrar: só a reconstrução (volume) gira.
    if ('setImageIdIndex' in viewport) {
      apoio?.semVolume(viewport.id);
      return false;
    }
    const camera = lerCamera(viewport);
    if (!camera) return false;
    if (!originais.has(viewport.id)) originais.set(viewport.id, camera);
    const marcado = apoio?.pivo(viewport.id);
    this.pivo = marcado ? projetarNoPlano(marcado, camera) : camera.focalPoint;
    return false;
  };

  mouseDragCallback = (evt: Types.EventTypes.InteractionEventType): void => {
    const viewport = getEnabledElement(evt.detail.element)?.viewport;
    const pivo = this.pivo;
    if (!viewport || !pivo || 'setImageIdIndex' in viewport) return;
    let camera = lerCamera(viewport);
    if (!camera) return;
    const [dx, dy] = (evt.detail as { deltaPoints: { canvas: [number, number] } }).deltaPoints.canvas;
    const rad = (px: number): number => (px * GRAUS_POR_PX * Math.PI) / 180;
    const nativo = (evt.detail as { event?: MouseEvent }).event;
    if (nativo?.shiftKey) {
      camera = girarCamera(camera, pivo, camera.viewPlaneNormal, rad(dx));
    } else {
      const direita = vetorial(camera.viewUp, camera.viewPlaneNormal);
      if (dx !== 0) camera = girarCamera(camera, pivo, camera.viewUp, rad(-dx));
      if (dy !== 0) camera = girarCamera(camera, pivo, direita, rad(-dy));
    }
    viewport.setCamera(camera);
    viewport.render();
  };
}
