/**
 * Aparência inicial de uma série ao ser aberta:
 * - PET com SUV: cinza invertido (osso e fundo claros, captação escura) e janela de SUV 0 a 5;
 * - zoom automático para o conteúdo da imagem ocupar o quadrado (corta a margem vazia).
 */

import { cache, utilities, type Types } from '@cornerstonejs/core';
import type { StackNode } from '../io/organize';
import { pilhaEmSuv } from '../pet/provedorSuv';

/** Tetos de SUV das teclas 1, 2 e 3 quando o viewport ativo mostra PET. */
export const TETOS_SUV = [5, 7, 10] as const;
export const TETO_SUV_PADRAO = TETOS_SUV[0];

export function ehPet(stack: StackNode | null | undefined): boolean {
  return !!stack?.instances.some((i) => i.modality === 'PT');
}

export function petEmSuv(stack: StackNode | null | undefined): boolean {
  return !!stack && ehPet(stack) && pilhaEmSuv(stack.id);
}

/** Janela e inversão padrão do PET (nada para outras modalidades). */
export function exibicaoPadraoPet(
  stack: StackNode,
): { invert: true; voiRange?: { lower: number; upper: number } } | null {
  if (!ehPet(stack)) return null;
  // Sem SUV (Bq/mL) não há teto conhecido: só inverte e deixa a janela do arquivo.
  if (!petEmSuv(stack)) return { invert: true };
  return { invert: true, voiRange: { lower: 0, upper: TETO_SUV_PADRAO } };
}

/**
 * Aproxima o zoom para a parte "com conteúdo" da imagem (corpo, ou captação no PET) ocupar a
 * maior área possível do viewport, centralizando-a. Só aproxima (nunca afasta). Usa a imagem
 * atual do viewport; em qualquer dúvida não faz nada.
 */
export function ajustarZoomAoConteudo(
  viewport: Types.IStackViewport,
  imageId: string,
  modalidade: string | undefined,
): void {
  try {
    const img = cache.getImage(imageId);
    const pixels = img?.getPixelData?.() as ArrayLike<number> | undefined;
    if (!img || !pixels) return;
    const w = img.columns;
    const h = img.rows;
    if (pixels.length < w * h || img.color) return;
    const slope = img.slope ?? 1;
    const inter = img.intercept ?? 0;

    let limiar: number;
    if (modalidade === 'CT') {
      limiar = (-300 - inter) / (slope || 1);
    } else {
      let max = -Infinity;
      for (let i = 0; i < w * h; i++) if (pixels[i]! > max) max = pixels[i]!;
      limiar = max * (modalidade === 'PT' ? 0.02 : 0.1);
    }

    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        if (pixels[base + x]! > limiar) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    // Pouco conteúdo (ruído) ou conteúdo já ocupando quase tudo: não mexe.
    if (x1 < 0 || x1 - x0 < w * 0.1 || y1 - y0 < h * 0.1) return;

    const canto = (x: number, y: number): [number, number] => {
      const mundo = utilities.imageToWorldCoords(imageId, [x, y]);
      if (!mundo) return [NaN, NaN];
      const c = viewport.worldToCanvas(mundo);
      return [c[0], c[1]];
    };
    const a = canto(x0, y0);
    const b = canto(x1 + 1, y1 + 1);
    if (![...a, ...b].every(Number.isFinite)) return;
    const larguraBox = Math.abs(b[0] - a[0]);
    const alturaBox = Math.abs(b[1] - a[1]);
    const el = viewport.element;
    if (larguraBox < 1 || alturaBox < 1 || el.clientWidth < 10 || el.clientHeight < 10) return;

    const fator = Math.min((el.clientWidth * 0.94) / larguraBox, (el.clientHeight * 0.94) / alturaBox);
    if (!(fator > 1.05)) return;

    const centroCanvas: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const centroMundo = viewport.canvasToWorld(centroCanvas);
    const cam = viewport.getCamera();
    if (!cam.focalPoint || !cam.position || cam.parallelScale === undefined) return;
    const delta = [
      centroMundo[0] - cam.focalPoint[0],
      centroMundo[1] - cam.focalPoint[1],
      centroMundo[2] - cam.focalPoint[2],
    ];
    viewport.setCamera({
      parallelScale: cam.parallelScale / Math.min(fator, 4),
      focalPoint: [cam.focalPoint[0] + delta[0]!, cam.focalPoint[1] + delta[1]!, cam.focalPoint[2] + delta[2]!],
      position: [cam.position[0] + delta[0]!, cam.position[1] + delta[1]!, cam.position[2] + delta[2]!],
    });
  } catch {
    /* ajuste é só conveniência */
  }
}
