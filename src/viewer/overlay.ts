/**
 * Overlay de texto nos quatro cantos de cada viewport 2D. Os textos vêm de montarOverlay
 * (função pura). Atualiza ao rolar, mudar janela ou zoom. A tecla O liga e desliga todos.
 */

import { Enums, type Types } from '@cornerstonejs/core';
import type { StackNode } from '../io/organize';
import { montarOverlay, type CantosOverlay } from './overlayTexto';

type Canto = keyof CantosOverlay;

/** O que o overlay precisa saber do viewport a que pertence. */
export interface FonteOverlay {
  viewport(): Types.IStackViewport | undefined;
  pilha(): StackNode | null;
}

export interface Overlay {
  atualizar(): void;
  /** Liga aos eventos do elemento do viewport (rolar, janela e câmera). Uma vez só. */
  ligar(elemento: HTMLElement): void;
}

const CLASSE_CANTO: Record<Canto, string> = {
  superiorEsquerdo: 'canto-se',
  superiorDireito: 'canto-sd',
  inferiorEsquerdo: 'canto-ie',
  inferiorDireito: 'canto-id',
};

/** Cada overlay criado: sua raiz no DOM e a função que atualiza o texto. */
const overlays = new Map<HTMLElement, () => void>();
let visivel = true;

/** Cria os quatro cantos dentro de `celula` e devolve o controle do overlay. */
export function criarOverlay(celula: HTMLElement, fonte: FonteOverlay): Overlay {
  const raiz = document.createElement('div');
  raiz.className = 'overlay';
  raiz.setAttribute('aria-hidden', 'true');
  raiz.hidden = !visivel;
  const cantos = {} as Record<Canto, HTMLDivElement>;
  for (const canto of Object.keys(CLASSE_CANTO) as Canto[]) {
    const d = document.createElement('div');
    d.className = `canto ${CLASSE_CANTO[canto]}`;
    cantos[canto] = d;
    raiz.append(d);
  }
  celula.append(raiz);

  function atualizar(): void {
    if (!visivel) return;
    const viewport = fonte.viewport();
    const stack = fonte.pilha();
    const indice = viewport?.getCurrentImageIdIndex() ?? 0;
    const atual = stack?.instances[indice];
    const primeira = stack?.instances[0];
    if (!viewport || !stack || !atual || !primeira) {
      for (const d of Object.values(cantos)) d.replaceChildren();
      return;
    }
    const texto = montarOverlay({
      primeira,
      atual,
      indice,
      total: stack.instances.length,
      voiRange: viewport.getProperties().voiRange,
      zoom: viewport.getZoom(),
    });
    for (const canto of Object.keys(cantos) as Canto[]) {
      cantos[canto].replaceChildren(
        ...texto[canto].map((linha) => {
          const p = document.createElement('div');
          p.textContent = linha;
          return p;
        }),
      );
    }
  }

  function ligar(elemento: HTMLElement): void {
    elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, atualizar);
    elemento.addEventListener(Enums.Events.VOI_MODIFIED, atualizar);
    elemento.addEventListener(Enums.Events.CAMERA_MODIFIED, atualizar);
  }

  overlays.set(raiz, atualizar);
  return { atualizar, ligar };
}

/** Tecla O: mostra ou esconde os textos de todos os viewports. */
export function alternarOverlay(): void {
  visivel = !visivel;
  for (const [raiz, atualizar] of overlays) {
    raiz.hidden = !visivel;
    atualizar();
  }
}

export function overlayVisivel(): boolean {
  return visivel;
}
