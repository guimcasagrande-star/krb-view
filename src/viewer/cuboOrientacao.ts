/**
 * Cubo de orientação no canto inferior direito do viewport: gira junto com a câmera, mostra as
 * faces do paciente (A, P, D, E, S, I) e, embaixo, o nome do plano (Axial, Coronal, Sagital ou
 * Oblíquo). Clicar nele (qualquer botão) abre o menu para trocar de plano.
 *
 * A conta é pura (`matrizDoCubo`, `nomeDoPlano`) e testada em `tests/cuboOrientacao.test.ts`.
 */

import type { Types } from '@cornerstonejs/core';
import { vetoresDaTela } from './orientacaoRegua';

type Vec = [number, number, number];

/** Faces do cubo: letra e normal externa, em coordenadas do paciente (LPS). */
export const FACES_DO_CUBO: Array<{ letra: string; normal: Vec; cima: Vec }> = [
  { letra: 'E', normal: [1, 0, 0], cima: [0, 0, 1] },
  { letra: 'D', normal: [-1, 0, 0], cima: [0, 0, 1] },
  { letra: 'P', normal: [0, 1, 0], cima: [0, 0, 1] },
  { letra: 'A', normal: [0, -1, 0], cima: [0, 0, 1] },
  { letra: 'S', normal: [0, 0, 1], cima: [0, -1, 0] },
  { letra: 'I', normal: [0, 0, -1], cima: [0, -1, 0] },
];

const vetorial = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const escalar = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Leva um vetor do paciente para a tela: x para a direita, y para baixo, z para o observador
 * (os eixos do CSS). `direita` e `cima` são os vetores da tela; `normal` aponta para o observador.
 */
export function paraTela(v: Vec, direita: Vec, cima: Vec, normal: Vec): Vec {
  return [escalar(v, direita), -escalar(v, cima), escalar(v, normal)];
}

/** `matrix3d(...)` do CSS que gira o cubo (em eixos do paciente) para a vista da câmera. */
export function matrizDoCubo(direita: Vec, cima: Vec, normal: Vec): string {
  const colunas = ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec[]).map((eixo) => paraTela(eixo, direita, cima, normal));
  const n = (x: number): string => (Math.abs(x) < 1e-6 ? '0' : x.toFixed(5));
  return `matrix3d(${colunas.map((c) => `${n(c[0])},${n(c[1])},${n(c[2])},0`).join(',')},0,0,0,1)`;
}

/** `matrix3d(...)` que põe uma face (letra legível, voltada para fora) a `meio` px do centro. */
export function matrizDaFace(face: { normal: Vec; cima: Vec }, meio: number): string {
  const baixo: Vec = [-face.cima[0], -face.cima[1], -face.cima[2]];
  const direita = vetorial(face.cima, face.normal);
  const t: Vec = [face.normal[0] * meio, face.normal[1] * meio, face.normal[2] * meio];
  const c = (v: Vec): string => `${v[0]},${v[1]},${v[2]},0`;
  return `matrix3d(${c(direita)},${c(baixo)},${c(face.normal)},${t[0]},${t[1]},${t[2]},1)`;
}

/** Nome do plano pela normal da câmera; fora dos três eixos (tolerância ~8°) é oblíquo. */
export function nomeDoPlano(normal: Vec): 'Axial' | 'Coronal' | 'Sagital' | 'Oblíquo' {
  const norma = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const a = normal.map((x) => Math.abs(x) / norma) as Vec;
  if (a[2] > 0.99) return 'Axial';
  if (a[1] > 0.99) return 'Coronal';
  if (a[0] > 0.99) return 'Sagital';
  return 'Oblíquo';
}

export interface CuboOrientacao {
  /** Redesenha pela câmera atual; some se não houver imagem ou se for o 3D. */
  atualizar(): void;
}

const LADO_PX = 30;

export function criarCuboOrientacao(
  celula: HTMLElement,
  fonte: {
    viewport: () => Types.IStackViewport | Types.IVolumeViewport | undefined;
    /** Falso esconde o cubo (quadro vazio, 3D, carregando). */
    visivel: () => boolean;
    /** Pedido de menu de planos, na posição do clique (px da janela). */
    aoPedirMenu: (x: number, y: number) => void;
  },
): CuboOrientacao {
  const raiz = document.createElement('div');
  raiz.className = 'cubo-orientacao';
  raiz.hidden = true;
  raiz.title = 'Orientação da imagem. Clique para trocar de plano (axial, coronal, sagital).';
  const cena = document.createElement('div');
  cena.className = 'cubo-cena';
  const cubo = document.createElement('div');
  cubo.className = 'cubo';
  for (const f of FACES_DO_CUBO) {
    const face = document.createElement('div');
    face.className = 'cubo-face';
    face.textContent = f.letra;
    face.style.transform = matrizDaFace(f, LADO_PX / 2);
    cubo.append(face);
  }
  cena.append(cubo);
  const rotulo = document.createElement('div');
  rotulo.className = 'cubo-rotulo';
  raiz.append(cena, rotulo);
  celula.append(raiz);

  // O clique no cubo é dele: não pode começar zoom, medida nem o menu geral.
  for (const tipo of ['mousedown', 'mouseup', 'pointerdown', 'dblclick', 'wheel'] as const) {
    raiz.addEventListener(tipo, (e) => e.stopPropagation());
  }
  raiz.addEventListener('click', (e) => {
    e.stopPropagation();
    fonte.aoPedirMenu(e.clientX, e.clientY);
  });
  raiz.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fonte.aoPedirMenu(e.clientX, e.clientY);
  });

  function atualizar(): void {
    const viewport = fonte.viewport();
    if (!viewport || !fonte.visivel()) {
      raiz.hidden = true;
      return;
    }
    try {
      const camera = viewport.getCamera();
      const tela = vetoresDaTela(camera);
      const normal = camera.viewPlaneNormal as Vec | undefined;
      if (!tela || !normal) {
        raiz.hidden = true;
        return;
      }
      cubo.style.transform = matrizDoCubo(tela.direita, tela.cima, normal);
      rotulo.textContent = nomeDoPlano(normal);
      raiz.hidden = false;
    } catch {
      raiz.hidden = true;
    }
  }

  return { atualizar };
}
