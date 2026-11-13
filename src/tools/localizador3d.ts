/**
 * Cursor 3D / Localizador de ponto ("Cruzinha / X"):
 * - Permite clicar ou arrastar sobre qualquer viewport (2D STACK ou Volume ORTHOGRAPHIC,
 *   em axial, coronal ou sagital, mesmo fora da janela MPR) para colocar uma mira/cruzinha
 *   naquele ponto 3D.
 * - Navega automaticamente todos os outros viewports visíveis para o corte correspondente
 *   e desenha a cruzinha na posição projetada em cada viewport:
 *   - No mesmo estudo/exame (ex.: uma sequência em Coronal e outra em Axial): usa a mesma
 *     coordenada 3D de mundo `(x, y, z)`.
 *   - Entre exames comparados de datas diferentes: aplica o deslocamento do vínculo
 *     de comparação (`ScrollLink` ao longo da normal ou translação 3D) para levar o
 *     outro exame ao ponto equivalente e colocar a cruzinha nele também.
 */

export const FERRAMENTA_LOCALIZADOR_3D = 'Localizador3D';

/** Desenha uma mira/cruzinha com centro aberto num `<canvas>` sobreposto ao viewport. */
export function desenharMiraNoCanvas(
  canvas: HTMLCanvasElement,
  pontoCanvas: [number, number] | null,
  cor = '#38bdf8',
): void {
  const rect = canvas.parentElement?.getBoundingClientRect();
  const largura = Math.max(1, Math.round(rect?.width ?? canvas.clientWidth));
  const altura = Math.max(1, Math.round(rect?.height ?? canvas.clientHeight));
  const dpr = window.devicePixelRatio || 1;

  if (canvas.width !== Math.round(largura * dpr) || canvas.height !== Math.round(altura * dpr)) {
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);

  if (!pontoCanvas) return;
  const [cx, cy] = pontoCanvas;
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
  if (cx < -30 || cy < -30 || cx > largura + 30 || cy > altura + 30) return;

  const raioInterno = 3.5;
  const raioExterno = 9.5;

  ctx.save();
  ctx.lineCap = 'round';
  // Contorno discreto para contraste sobre áreas claras
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = 2.25;
  tracarBracosMira(ctx, cx, cy, raioInterno, raioExterno);

  // Os 4 traços finos da cruzinha
  ctx.strokeStyle = cor;
  ctx.lineWidth = 1.25;
  tracarBracosMira(ctx, cx, cy, raioInterno, raioExterno);
  ctx.restore();
}

function tracarBracosMira(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx - rOut, cy);
  ctx.lineTo(cx - rIn, cy);
  ctx.moveTo(cx + rIn, cy);
  ctx.lineTo(cx + rOut, cy);
  ctx.moveTo(cx, cy - rOut);
  ctx.lineTo(cx, cy - rIn);
  ctx.moveTo(cx, cy + rIn);
  ctx.lineTo(cx, cy + rOut);
  ctx.stroke();
}
