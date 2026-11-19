/**
 * Aparência e texto das medidas conforme as preferências do usuário:
 * cor, espessura, texto, unidade, casas decimais, campos da ROI e tracinhos nas extremidades.
 */

import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  drawing,
  LengthTool,
  type Types,
  utilities as utilitarios,
} from '@cornerstonejs/tools';
import { EVENTO_PREFERENCIAS, medidas } from '../state/preferencias';
import {
  comprimentoComUnidade,
  type EstatisticasRoi,
  formatarNumero,
  linhaAngulo,
  linhasRoi,
} from './formatoMedidas';
import { sufixoVolumeAutoPorDados } from './volumeElipsoide';

type Ponto2 = CoreTypes.Point2;
type DadosAnotacao = { label?: string; cachedStats?: Record<string, unknown> };

/** Cor da medida selecionada: fixa e distinta de qualquer cor escolhida pelo usuário. */
const COR_SELECIONADA = '#ffffff';
const COR_DESTAQUE = '#fde047';

/** Empurra as preferências para o estilo global do Cornerstone e redesenha. */
export function aplicarEstiloMedidas(): void {
  const p = medidas();
  const estilo = anotacoes.config.style;
  const atual = estilo.getDefaultToolStyles();
  const texto = `${p.tamanhoTexto}px`;
  estilo.setDefaultToolStyles({
    ...atual,
    global: {
      ...atual.global,
      color: p.cor,
      colorHighlighted: COR_DESTAQUE,
      colorSelected: COR_SELECIONADA,
      lineWidth: String(p.espessura),
      lineWidthSelected: String(p.espessura + 1),
      lineWidthHighlighted: String(p.espessura + 0.5),
      textBoxFontSize: texto,
      textBoxColor: p.corTexto,
      textBoxColorHighlighted: p.corTexto,
      textBoxColorSelected: p.corTexto,
      textBoxLinkLineColor: p.cor,
    },
  });
  redesenharTudo();
}

/** Pede o redesenho de todas as medidas visíveis. */
export function redesenharTudo(): void {
  const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-viewport-uid]'))
    .map((e) => e.getAttribute('data-viewport-uid'))
    .filter((v): v is string => !!v);
  if (ids.length > 0) utilitarios.triggerAnnotationRenderForViewportIds(ids);
}

export function iniciarEstiloMedidas(): void {
  aplicarEstiloMedidas();
  document.addEventListener(EVENTO_PREFERENCIAS, () => aplicarEstiloMedidas());
}

// ---------------------------------------------------------------------------
// Texto das ferramentas nativas (configuration.getTextLines)
// ---------------------------------------------------------------------------

function estatisticas(data: DadosAnotacao, alvo: string): Record<string, unknown> | undefined {
  return data.cachedStats?.[alvo] as Record<string, unknown> | undefined;
}

export function textoDistancia(data: DadosAnotacao, alvo: string): string[] | undefined {
  const s = estatisticas(data, alvo) as { length?: number; unit?: string } | undefined;
  if (!s || typeof s.length !== 'number' || Number.isNaN(s.length)) return undefined;
  return [`${comprimentoComUnidade(s.length, s.unit, medidas())}${sufixoVolumeAutoPorDados(data)}`];
}

export function textoAngulo(data: DadosAnotacao, alvo: string): string[] | undefined {
  const s = estatisticas(data, alvo) as { angle?: number } | undefined;
  if (!s || s.angle === undefined) return undefined;
  if (Number.isNaN(s.angle)) return [String(s.angle)];
  return [linhaAngulo(s.angle, medidas())];
}

export function textoRoi(data: DadosAnotacao, alvo: string): string[] | undefined {
  const linhas = linhasRoi(estatisticas(data, alvo) as EstatisticasRoi | undefined, medidas());
  const rotulo = data.label?.trim();
  if (!linhas) return rotulo ? [rotulo] : undefined;
  return rotulo ? [rotulo, ...linhas] : linhas;
}

// ---------------------------------------------------------------------------
// Tracinhos nas extremidades
// ---------------------------------------------------------------------------

/** Tracinho perpendicular à linha a→b em cada extremidade (coordenadas de tela). */
export function desenharTracinhos(
  svg: Types.SVGDrawingHelper,
  uid: string,
  id: string,
  a: Ponto2,
  b: Ponto2,
  cor: string,
  largura: number,
  tamanho = 10,
): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const n = Math.hypot(dx, dy);
  if (n < 2) return;
  const px = (-dy / n) * (tamanho / 2);
  const py = (dx / n) * (tamanho / 2);
  const opcoes = { color: cor, width: largura };
  drawing.drawLine(svg, uid, `${id}-a`, [a[0] - px, a[1] - py], [a[0] + px, a[1] + py], opcoes);
  drawing.drawLine(svg, uid, `${id}-b`, [b[0] - px, b[1] - py], [b[0] + px, b[1] + py], opcoes);
}

/** Distância mínima (px na tela) para o soltar do 1º clique da Distância contar como arrasto real. */
const DISTANCIA_ARRASTE_PX = 10;

/** Distância nativa (LengthTool) com os tracinhos das extremidades e proteção contra micro-tremor no 1º clique. */
export class DistanciaTool extends LengthTool {
  private inicioCanvasNovo: Ponto2 | null = null;
  private liberouPrimeiroClique = false;

  constructor(...args: ConstructorParameters<typeof LengthTool>) {
    super(...args);
    // No LengthTool os callbacks são campos (funções de seta), não métodos: embrulha-se aqui.
    const originalAdd = this.addNewAnnotation;
    this.addNewAnnotation = (evt) => {
      const c = evt.detail?.currentPoints?.canvas;
      this.inicioCanvasNovo = c ? [c[0], c[1]] : null;
      this.liberouPrimeiroClique = false;
      return originalAdd(evt);
    };

    const self = this as unknown as {
      _endCallback: (evt: Types.EventTypes.InteractionEventType) => void;
      editData: { newAnnotation?: boolean; hasMoved?: boolean } | null;
    };
    const originalEnd = self._endCallback;
    self._endCallback = (evt) => {
      if (self.editData?.newAnnotation && !this.liberouPrimeiroClique) {
        const c = evt.detail?.currentPoints?.canvas;
        const distPx =
          c && this.inicioCanvasNovo
            ? Math.hypot(c[0] - this.inicioCanvasNovo[0], c[1] - this.inicioCanvasNovo[1])
            : 0;
        // Se foi só um clique (ou micro-tremor < 10 px) — ou modo "só cliques" — não encerra no 1º soltar.
        if (medidas().modoClique === 'clicar' || distPx < DISTANCIA_ARRASTE_PX) {
          this.liberouPrimeiroClique = true;
          return;
        }
      }
      this.inicioCanvasNovo = null;
      this.liberouPrimeiroClique = false;
      originalEnd(evt);
    };

    const originalRender = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, svgDrawingHelper) => {
      const resultado = originalRender(enabledElement, svgDrawingHelper);
      this.desenharTracinhosDasDistancias(enabledElement, svgDrawingHelper);
      return resultado;
    };
  }

  private desenharTracinhosDasDistancias(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): void {
    if (!medidas().tracinhos) return;
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(this.getToolName(), element);
    if (!anns?.length) return;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    for (const ann of anns) {
      const pontos = ann.data.handles?.points;
      if (!pontos || pontos.length < 2 || !ann.annotationUID || ann.isVisible === false) continue;
      const estilo = this.getAnnotationStyle({
        annotation: ann,
        styleSpecifier: {
          toolGroupId: this.toolGroupId,
          toolName: this.getToolName(),
          viewportId: viewport.id,
          annotationUID: ann.annotationUID,
        } as never,
      });
      desenharTracinhos(
        svgDrawingHelper,
        ann.annotationUID,
        'tracinho',
        viewport.worldToCanvas(pontos[0]!) as Ponto2,
        viewport.worldToCanvas(pontos[1]!) as Ponto2,
        (estilo.color as string) || medidas().cor,
        Number(estilo.lineWidth) || medidas().espessura,
      );
    }
  }
}

/** Texto de razões e percentuais: casas de valores + 1 para a razão. */
export function formatarRazao(r: number): string {
  return formatarNumero(r, medidas().casasValores + 1);
}

const fundoClaroPorViewport = new Map<string, boolean>();

/**
 * Viewport com fundo claro (imagem invertida): o texto das medidas fica escuro, sobre uma
 * caixa clara translúcida; no fundo escuro volta ao estilo global.
 */
export function definirEstiloPorFundo(viewportId: string, claro: boolean): void {
  if ((fundoClaroPorViewport.get(viewportId) ?? false) === claro) return;
  fundoClaroPorViewport.set(viewportId, claro);
  anotacoes.config.style.setViewportToolStyles(
    viewportId,
    claro
      ? {
          global: {
            textBoxColor: '#111111',
            textBoxColorHighlighted: '#111111',
            textBoxColorSelected: '#111111',
            textBoxBackground: 'rgba(255, 255, 255, 0.75)',
          },
        }
      : {},
  );
  utilitarios.triggerAnnotationRenderForViewportIds([viewportId]);
}
