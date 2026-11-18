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

const PASSOS_MM = [5, 10, 20, 50, 100, 200, 500];

export interface GeometriaRegua {
  xLinha: number;
  topo: number;
  yBase: number;
  passoMm: number;
  nMajores: number;
}

/**
 * Calcula a posição da régua compacta à esquerda, centralizada verticalmente e ocupando
 * cerca de 1/3 da altura do quadro (sem encostar nos cantos superior/inferior nem na letra de orientação).
 */
export function calcularGeometriaRegua(
  largura: number,
  altura: number,
  pxPorMm: number,
): GeometriaRegua | null {
  if (!(pxPorMm > 0) || largura < 120 || altura < 120) return null;
  const comprimentoMax = Math.max(36, Math.min(Math.floor(altura / 3), altura - 104));
  // Escolhe o passo (mm) para caber ao menos 1 divisão inteira dentro de ~1/3 da altura
  const passoMm =
    PASSOS_MM.find((p) => p * pxPorMm >= 28 && p * pxPorMm <= comprimentoMax) ??
    PASSOS_MM.find((p) => p * pxPorMm <= comprimentoMax) ??
    PASSOS_MM[0]!;
  const nMajores = Math.floor(comprimentoMax / (passoMm * pxPorMm));
  if (nMajores < 1) return null;
  const comprimentoReal = nMajores * passoMm * pxPorMm;
  const centroY = altura / 2;
  const topo = centroY - comprimentoReal / 2;
  const yBase = centroY + comprimentoReal / 2;
  return {
    xLinha: 26,
    topo,
    yBase,
    passoMm,
    nMajores,
  };
}

/**
 * Desenha a régua vertical compacta no lado esquerdo (centralizada, ~1/3 da altura):
 * tracinhos a cada 1/5 do passo e números em cm.
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
  const geo = calcularGeometriaRegua(largura, altura, pxPorMm);
  if (!geo) return;

  const { xLinha, topo, yBase, passoMm, nMajores } = geo;
  const cor = fundoClaro ? '#111111' : '#f2f5f7';
  const halo = fundoClaro ? '#ffffff' : '#000000';
  ctx.font = '10.5px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const tracar = (corTraco: string, largLinha: number): void => {
    ctx.strokeStyle = corTraco;
    ctx.lineWidth = largLinha;
    ctx.beginPath();
    ctx.moveTo(xLinha, yBase);
    ctx.lineTo(xLinha, topo);
    const minor = passoMm / 5;
    for (let m = 0; m <= nMajores * 5; m++) {
      const y = yBase - m * minor * pxPorMm;
      const major = m % 5 === 0;
      ctx.moveTo(xLinha, y);
      ctx.lineTo(xLinha + (major ? 7 : 3.5), y);
    }
    ctx.stroke();
  };
  tracar(halo, 3);
  tracar(cor, 1);

  for (let n = 0; n <= nMajores; n++) {
    const y = yBase - n * passoMm * pxPorMm;
    const cm = (n * passoMm) / 10;
    const texto = Number.isInteger(cm) ? String(cm) : cm.toFixed(1).replace('.', ',');
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeText(texto, xLinha + 10, y);
    ctx.fillStyle = cor;
    ctx.fillText(texto, xLinha + 10, y);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText('cm', xLinha, topo - 9);
  ctx.fillStyle = cor;
  ctx.fillText('cm', xLinha, topo - 9);
}
