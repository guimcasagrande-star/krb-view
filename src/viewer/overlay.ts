/**
 * Overlay de texto nos quatro cantos do viewport 2D. Os textos vêm de montarOverlay
 * (função pura). Atualiza ao rolar, mudar janela ou zoom. A tecla O liga e desliga.
 */

import { Enums, type Types } from '@cornerstonejs/core';
import { estado } from '../state/store';
import { montarOverlay, type CantosOverlay } from './overlayTexto';

type Canto = keyof CantosOverlay;

let raiz: HTMLDivElement | undefined;
let cantos: Record<Canto, HTMLDivElement> | undefined;
let viewportLigado: Types.IStackViewport | undefined;
let visivel = true;

const CLASSE_CANTO: Record<Canto, string> = {
  superiorEsquerdo: 'canto-se',
  superiorDireito: 'canto-sd',
  inferiorEsquerdo: 'canto-ie',
  inferiorDireito: 'canto-id',
};

/** Cria os quatro cantos dentro do contentor (uma vez). */
export function criarOverlay(contentor: HTMLElement): void {
  if (raiz) return;
  raiz = document.createElement('div');
  raiz.id = 'overlay';
  raiz.setAttribute('aria-hidden', 'true');
  raiz.hidden = !visivel;
  const novos = {} as Record<Canto, HTMLDivElement>;
  for (const canto of Object.keys(CLASSE_CANTO) as Canto[]) {
    const d = document.createElement('div');
    d.className = `canto ${CLASSE_CANTO[canto]}`;
    novos[canto] = d;
    raiz.append(d);
  }
  cantos = novos;
  contentor.append(raiz);
}

/** Atualiza o texto dos cantos com o corte e os valores atuais do viewport. */
export function atualizarOverlay(viewport: Types.IStackViewport | undefined = viewportLigado): void {
  if (!raiz || !cantos || !visivel || !viewport) return;
  const stack = estado.pilhaAtiva;
  const indice = viewport.getCurrentImageIdIndex();
  const atual = stack?.instances[indice];
  const primeira = stack?.instances[0];
  if (!stack || !atual || !primeira) {
    for (const d of Object.values(cantos)) d.replaceChildren();
    return;
  }
  const { voiRange } = viewport.getProperties();
  const texto = montarOverlay({
    primeira,
    atual,
    indice,
    total: stack.instances.length,
    voiRange,
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

/** Liga o overlay aos eventos do viewport (rolar, janela e câmera). Chamar uma vez por elemento. */
export function ligarOverlay(elemento: HTMLElement, viewport: Types.IStackViewport): void {
  viewportLigado = viewport;
  const atualizar = (): void => atualizarOverlay();
  elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, atualizar);
  elemento.addEventListener(Enums.Events.VOI_MODIFIED, atualizar);
  elemento.addEventListener(Enums.Events.CAMERA_MODIFIED, atualizar);
}

/** Tecla O: mostra ou esconde os textos. */
export function alternarOverlay(): void {
  visivel = !visivel;
  if (raiz) raiz.hidden = !visivel;
  atualizarOverlay();
}
