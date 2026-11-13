/**
 * Cine: avança os cortes de um viewport em quadros por segundo. Genérico: quem chama
 * dá a chave (posição na grade) e o passo; este módulo só cuida dos temporizadores.
 */

export const VELOCIDADES_CINE = [2, 5, 10, 15, 20, 30];

interface Tocando {
  timer: ReturnType<typeof setInterval>;
  fps: number;
}

const tocando = new Map<number, Tocando>();
let fpsPadrao = 10;

export function fpsAtual(): number {
  return fpsPadrao;
}

export function cineTocando(chave: number): boolean {
  return tocando.has(chave);
}

export function pararCine(chave: number): void {
  const t = tocando.get(chave);
  if (!t) return;
  clearInterval(t.timer);
  tocando.delete(chave);
}

export function pararTodosCines(): void {
  for (const chave of [...tocando.keys()]) pararCine(chave);
}

export function tocarCine(chave: number, passo: () => void): void {
  pararCine(chave);
  tocando.set(chave, { timer: setInterval(passo, 1000 / fpsPadrao), fps: fpsPadrao });
}

/** Muda a velocidade de todos os cines em andamento (a próxima vez também usa ela). */
export function definirFps(fps: number, passoDe: (chave: number) => () => void): void {
  if (!Number.isFinite(fps) || fps <= 0) return;
  fpsPadrao = fps;
  for (const chave of [...tocando.keys()]) tocarCine(chave, passoDe(chave));
}
