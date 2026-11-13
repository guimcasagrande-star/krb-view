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

type Ponto2 = CoreTypes.Point2;
type DadosAnotacao = { cachedStats?: Record<string, unknown> };

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
  return [comprimentoComUnidade(s.length, s.unit, medidas())];
}

export function textoAngulo(data: DadosAnotacao, alvo: string): string[] | undefined {
  const s = estatisticas(data, alvo) as { angle?: number } | undefined;
  if (!s || s.angle === undefined) return undefined;
  if (Number.isNaN(s.angle)) return [String(s.angle)];
  return [linhaAngulo(s.angle, medidas())];
}

export function textoRoi(data: DadosAnotacao, alvo: string): string[] | undefined {
  return linhasRoi(estatisticas(data, alvo) as EstatisticasRoi | undefined, medidas());
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

/** Distância nativa (LengthTool) com os tracinhos das extremidades. Mantém o nome `Length`. */
export class DistanciaTool extends LengthTool {
  constructor(...args: ConstructorParameters<typeof LengthTool>) {
    super(...args);
    // No LengthTool `renderAnnotation` é um campo (função de seta), não um método: embrulha-se aqui.
    const original = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, svgDrawingHelper) => {
      const resultado = original(enabledElement, svgDrawingHelper);
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
