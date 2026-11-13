/**
 * Letras de orientação (A, P, D, E, S, I) e régua de escala dos viewports.
 *
 * As letras saem da câmera: os vetores "para cima" e "para a direita" da tela, em
 * coordenadas do paciente (LPS: +x = esquerda, +y = posterior, +z = superior).
 */

import type { Types } from '@cornerstonejs/core';

type Vec = [number, number, number];

export interface RotulosOrientacao {
  topo: string;
  base: string;
  esquerda: string;
  direita: string;
}

const EIXOS: Array<{ positivo: string; negativo: string }> = [
  { positivo: 'E', negativo: 'D' }, // x: esquerda / direita
  { positivo: 'P', negativo: 'A' }, // y: posterior / anterior
  { positivo: 'S', negativo: 'I' }, // z: superior / inferior
];

/** Letra(s) do lado do paciente para onde o vetor aponta (a 2ª letra só se for bem oblíquo). */
export function rotuloDoVetor(v: Vec): string {
  const ordem = [0, 1, 2].sort((a, b) => Math.abs(v[b]!) - Math.abs(v[a]!));
  const norma = Math.hypot(v[0], v[1], v[2]) || 1;
  const letra = (i: number): string => (v[i]! >= 0 ? EIXOS[i]!.positivo : EIXOS[i]!.negativo);
  let r = letra(ordem[0]!);
  if (Math.abs(v[ordem[1]!]!) / norma > 0.35) r += letra(ordem[1]!);
  return r;
}

function oposto(v: Vec): Vec {
  return [-v[0], -v[1], -v[2]];
}

function produtoVetorial(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Vetores da tela (cima e direita) em coordenadas do paciente, já considerando espelhamento. */
export function vetoresDaTela(camera: Types.ICamera): { cima: Vec; direita: Vec } | null {
  const up = camera.viewUp as Vec | undefined;
  const normal = camera.viewPlaneNormal as Vec | undefined;
  if (!up || !normal) return null;
  let cima = up;
  let direita = produtoVetorial(up, normal);
  const c = camera as { flipHorizontal?: boolean; flipVertical?: boolean };
  if (c.flipHorizontal) direita = oposto(direita);
  if (c.flipVertical) cima = oposto(cima);
  return { cima, direita };
}

export function rotulosOrientacao(camera: Types.ICamera): RotulosOrientacao | null {
  const v = vetoresDaTela(camera);
  if (!v) return null;
  return {
    topo: rotuloDoVetor(v.cima),
    base: rotuloDoVetor(oposto(v.cima)),
    esquerda: rotuloDoVetor(oposto(v.direita)),
    direita: rotuloDoVetor(v.direita),
  };
}

const PASSOS_MM = [10, 20, 50, 100, 200, 500];

/**
 * Desenha a régua vertical no canto direito: tracinhos a cada 1/5 do passo e números em cm.
 * `pxPorMm` vem do viewport (distância na tela de 1 mm no plano da imagem).
 */
export function desenharRegua(
  canvas: HTMLCanvasElement,
  largura: number,
  altura: number,
  pxPorMm: number,
  fundoClaro: boolean,
): void {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(largura * dpr) || canvas.height !== Math.round(altura * dpr)) {
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);
  if (!(pxPorMm > 0) || largura < 120 || altura < 120) return;

  const passo = PASSOS_MM.find((p) => p * pxPorMm >= 45) ?? PASSOS_MM[PASSOS_MM.length - 1]!;
  const xLinha = largura - 12;
  const yBase = altura - 56;
  const comprimentoMax = altura - 56 - 40;
  const nMajores = Math.floor(comprimentoMax / (passo * pxPorMm));
  if (nMajores < 1) return;
  const topo = yBase - nMajores * passo * pxPorMm;

  const cor = fundoClaro ? '#111111' : '#f2f5f7';
  const halo = fundoClaro ? '#ffffff' : '#000000';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const tracar = (corTraco: string, largLinha: number): void => {
    ctx.strokeStyle = corTraco;
    ctx.lineWidth = largLinha;
    ctx.beginPath();
    ctx.moveTo(xLinha, yBase);
    ctx.lineTo(xLinha, topo);
    const minor = passo / 5;
    for (let m = 0; m <= nMajores * 5; m++) {
      const y = yBase - m * minor * pxPorMm;
      const major = m % 5 === 0;
      ctx.moveTo(xLinha, y);
      ctx.lineTo(xLinha - (major ? 9 : 4), y);
    }
    ctx.stroke();
  };
  tracar(halo, 3);
  tracar(cor, 1);

  for (let n = 0; n <= nMajores; n++) {
    const y = yBase - n * passo * pxPorMm;
    const texto = String((n * passo) / 10).replace('.', ',');
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeText(texto, xLinha - 13, y);
    ctx.fillStyle = cor;
    ctx.fillText(texto, xLinha - 13, y);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText('cm', xLinha - 4, topo - 10);
  ctx.fillStyle = cor;
  ctx.fillText('cm', xLinha - 4, topo - 10);
}
