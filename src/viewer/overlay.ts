/**
 * Overlay de texto nos quatro cantos de cada viewport (2D ou MPR). Os textos vêm de montarOverlay
 * (função pura). Atualiza ao rolar, mudar janela ou zoom. A tecla O liga e desliga todos.
 */

import { Enums, type Types } from '@cornerstonejs/core';
import type { StackNode } from '../io/organize';
import type { InstanceMeta } from '../io/types';
import { definirEstiloPorFundo } from '../tools/estiloMedidas';
import { unidadeDaPilha } from '../pet/provedorSuv';
import { ehPet } from './exibicaoInicial';
import { desenharRegua, rotulosOrientacao, vetoresDaTela } from './orientacaoRegua';
import { montarOverlay, type CantosOverlay } from './overlayTexto';

type Canto = keyof CantosOverlay;

export interface PlanoMprOverlay {
  rotulo: string;
  eixo: Enums.OrientationAxis;
}

/** O que o overlay precisa saber do viewport a que pertence. */
export interface FonteOverlay {
  viewport(): Types.IStackViewport | Types.IVolumeViewport | undefined;
  pilha(): StackNode | null;
  planoMpr?(): PlanoMprOverlay | undefined;
  modoSlab?(): string | undefined;
  /** No 3D (fase 8): nome da predefinição em uso; os textos de corte e janela não se aplicam. */
  rotulo3d?(): string | undefined;
  /** Clique no texto do zoom ou da espessura (posição em px da janela). */
  aoClicar?(campo: CampoClicavel, x: number, y: number): void;
}

export type CampoClicavel = 'zoom' | 'espessura';

/** Linhas do overlay que abrem um menu ao clicar. */
function campoDaLinha(linha: string): CampoClicavel | undefined {
  if (linha.startsWith('Zoom ')) return 'zoom';
  if (linha.startsWith('Espessura ')) return 'espessura';
  return undefined;
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

function posicaoPlanoMm(
  viewport: Types.IVolumeViewport,
  eixo: Enums.OrientationAxis,
): number | undefined {
  const fp = viewport.getCamera()?.focalPoint;
  if (!fp) return undefined;
  if (eixo === Enums.OrientationAxis.AXIAL) return fp[2];
  if (eixo === Enums.OrientationAxis.CORONAL) return fp[1];
  if (eixo === Enums.OrientationAxis.SAGITTAL) return fp[0];
  return fp[2];
}

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
  const letras = {} as Record<'topo' | 'base' | 'esquerda' | 'direita', HTMLDivElement>;
  for (const lado of ['topo', 'base', 'esquerda', 'direita'] as const) {
    const d = document.createElement('div');
    d.className = `orientacao orientacao-${lado}`;
    letras[lado] = d;
    raiz.append(d);
  }
  const canvasRegua = document.createElement('canvas');
  canvasRegua.className = 'regua';
  raiz.append(canvasRegua);
  celula.append(raiz);

  function atualizarOrientacaoERegua(
    viewport: Types.IStackViewport | Types.IVolumeViewport,
    fundoClaro: boolean,
  ): void {
    try {
      const camera = viewport.getCamera();
      const rot = rotulosOrientacao(camera);
      for (const lado of ['topo', 'base', 'esquerda', 'direita'] as const) {
        letras[lado].textContent = rot ? rot[lado] : '';
      }
      const el = viewport.element;
      const larg = el.clientWidth;
      const alt = el.clientHeight;
      const v = vetoresDaTela(camera);
      let pxPorMm = 0;
      if (v && larg > 0 && alt > 0) {
        const c = viewport.canvasToWorld([larg / 2, alt / 2]);
        const d = viewport.worldToCanvas([c[0] + v.direita[0] * 10, c[1] + v.direita[1] * 10, c[2] + v.direita[2] * 10]);
        pxPorMm = Math.hypot(d[0] - larg / 2, d[1] - alt / 2) / 10;
      }
      desenharRegua(canvasRegua, larg, alt, pxPorMm, fundoClaro);
    } catch {
      for (const lado of ['topo', 'base', 'esquerda', 'direita'] as const) letras[lado].textContent = '';
      desenharRegua(canvasRegua, 0, 0, 0, false);
    }
  }

  function atualizar(): void {
    if (!visivel) return;
    const viewport = fonte.viewport();
    const stack = fonte.pilha();
    const primeira = stack?.instances[0];
    if (!viewport || !stack || !primeira) {
      for (const d of Object.values(cantos)) d.replaceChildren();
      for (const d of Object.values(letras)) d.textContent = '';
      desenharRegua(canvasRegua, 0, 0, 0, false);
      return;
    }

    // Fundo claro (imagem invertida, ex.: PET): texto escuro nos cantos e nas medidas.
    // Só no 2D de pilha: nos viewports de volume (MIP, MPR) o fundo fora do volume continua preto.
    const invertido = !!viewport.getProperties()?.invert;
    raiz.classList.toggle('invertido', invertido && 'setImageIdIndex' in viewport);
    // Medidas: texto escuro em caixa clara em qualquer viewport invertido (legível sobre qualquer fundo).
    definirEstiloPorFundo(viewport.id, invertido);

    const rotulo3d = fonte.rotulo3d?.();
    if (rotulo3d) {
      // 3D: paciente e estudo em cima; embaixo só o nome da predefinição. Sem letras e sem régua
      // (a vista gira livremente e a escala muda com a profundidade).
      for (const d of Object.values(letras)) d.textContent = '';
      desenharRegua(canvasRegua, 0, 0, 0, false);
      const t = montarOverlay({ primeira, atual: primeira, indice: 0, total: 1 });
      const linhas: CantosOverlay = {
        superiorEsquerdo: t.superiorEsquerdo,
        superiorDireito: t.superiorDireito,
        inferiorEsquerdo: [`3D · ${rotulo3d}`],
        inferiorDireito: [],
      };
      for (const canto of Object.keys(cantos) as Canto[]) {
        cantos[canto].replaceChildren(
          ...linhas[canto].map((linha) => {
            const p = document.createElement('div');
            p.textContent = linha;
            return p;
          }),
        );
      }
      return;
    }

    atualizarOrientacaoERegua(viewport, false);

    const plano = fonte.planoMpr?.();
    const rotuloModo = fonte.modoSlab?.();
    let indice = 0;
    let total = stack.instances.length;
    let atual: InstanceMeta | undefined;
    let slabAtual = 1;

    if (plano && 'getSlabThickness' in viewport) {
      total = Math.max(1, viewport.getNumberOfSlices() || stack.instances.length);
      indice = Math.min(Math.max(viewport.getSliceIndex() ?? 0, 0), total - 1);
      const base = stack.instances[Math.min(indice, stack.instances.length - 1)] ?? primeira;
      slabAtual = viewport.getSlabThickness();
      const posMm = posicaoPlanoMm(viewport, plano.eixo);
      atual = {
        ...base,
        sliceThickness: slabAtual > 1 ? slabAtual : base.sliceThickness,
        sliceLocation: posMm ?? base.sliceLocation,
      };
    } else {
      indice = viewport.getCurrentImageIdIndex() ?? 0;
      atual = stack.instances[indice];
    }

    if (!atual) {
      for (const d of Object.values(cantos)) d.replaceChildren();
      return;
    }

    const texto = montarOverlay({
      primeira,
      atual,
      indice,
      total,
      voiRange: viewport.getProperties()?.voiRange,
      zoom: viewport.getZoom(),
    });
    // PET: a janela é mostrada como faixa na unidade da série (ex.: SUVbw 0 – 10 ou Bq/mL 0 – 18000).
    const voi = viewport.getProperties()?.voiRange;
    if (voi && ehPet(stack)) {
      const un = unidadeDaPilha(stack.id);
      const casas = un === 'Bq/mL' ? 0 : 1;
      const f = (n: number): string => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
      const faixa = `${un} ${f(voi.lower)} – ${f(voi.upper)}`;
      const i = texto.inferiorDireito.findIndex((l) => l.startsWith('Janela '));
      if (i >= 0) texto.inferiorDireito[i] = faixa;
      else texto.inferiorDireito.unshift(faixa);
    }
    if (plano) {
      const partes: string[] = [];
      if (plano.rotulo !== 'Original') partes.push(plano.rotulo);
      if (plano.rotulo !== 'MIP rotatório') {
        if (rotuloModo && rotuloModo !== 'Normal') {
          const mmFmt = slabAtual.toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          });
          partes.push(`${rotuloModo} (${mmFmt} mm)`);
        } else if (slabAtual > 1) {
          const mmFmt = slabAtual.toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          });
          partes.push(`Slab ${mmFmt} mm`);
        }
      }
      if (partes.length > 0) {
        texto.superiorEsquerdo.unshift(partes.join(' · '));
      }
      // MIP de volume inteiro: não há corte, espessura nem posição para mostrar.
      if (plano.rotulo === 'MIP rotatório') texto.inferiorEsquerdo = [];
    }

    for (const canto of Object.keys(cantos) as Canto[]) {
      cantos[canto].replaceChildren(
        ...texto[canto].map((linha) => {
          const p = document.createElement('div');
          p.textContent = linha;
          const campo = fonte.aoClicar ? campoDaLinha(linha) : undefined;
          if (campo) {
            p.className = 'overlay-clicavel';
            p.dataset.campo = campo;
            p.title = campo === 'zoom' ? 'Clique para escolher o zoom' : 'Clique para mudar a espessura (slab)';
          }
          return p;
        }),
      );
    }
  }

  // Zoom e espessura: o clique é do texto, não da ferramenta nem do duplo clique de maximizar.
  const campoDoEvento = (e: Event): CampoClicavel | undefined => {
    const alvo = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-campo]') : null;
    return alvo?.dataset.campo as CampoClicavel | undefined;
  };
  for (const tipo of ['mousedown', 'mouseup', 'dblclick'] as const) {
    raiz.addEventListener(tipo, (e) => {
      if (campoDoEvento(e)) e.stopPropagation();
    });
  }
  raiz.addEventListener('click', (e) => {
    const campo = campoDoEvento(e);
    if (!campo) return;
    e.stopPropagation();
    fonte.aoClicar?.(campo, e.clientX, e.clientY);
  });

  function ligar(elemento: HTMLElement): void {
    elemento.addEventListener(Enums.Events.STACK_NEW_IMAGE, atualizar);
    elemento.addEventListener(Enums.Events.VOLUME_NEW_IMAGE, atualizar);
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
