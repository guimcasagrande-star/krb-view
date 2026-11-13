/**
 * Ferramentas clínicas de proporção e ortopedia/vascular:
 * 1. `EstenoseTool` (Relação de Estenose — 2 diâmetros):
 *    Compara o vaso de referência ($D_{\text{máx}}$) com o lúmen estreitado ($D_{\text{mín}}$)
 *    e informa a % de obstrução em diâmetro ($1 - D_{\text{mín}}/D_{\text{máx}}$) e em área circular ($1 - (D_{\text{mín}}/D_{\text{máx}})^2$).
 * 2. `ProporcaoLinearTool` (Proporção de Comprimento / Razão Linear — 2 segmentos):
 *    Mede dois comprimentos ($L_1$ e $L_2$) e calcula a razão $L_1/L_2$, a porcentagem ($L_1/L_2 \times 100\%$)
 *    e a diferença absoluta ($\Delta = |L_1 - L_2|$).
 * 3. `AnguloCobbTool` (Ângulo de Cobb — 2 retas independentes):
 *    Calcula o ângulo entre duas retas que não se tocam diretamente (ex.: platôs vertebrais
 *    para escoliose/cifose).
 * 4. `AnguloReferenciaTool` (Ângulo com Linha de Referência):
 *    Traça uma reta anatômica e calcula automaticamente sua inclinação em relação ao eixo
 *    horizontal e ao eixo vertical perfeitos da imagem.
 *
 * O desenho (cliques, arrastes, Esc) é tratado por `FerramentaMultiCliqueBase`.
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import { annotation as anotacoes, drawing, type Types } from '@cornerstonejs/tools';
import { medidas } from '../state/preferencias';
import { distancia3, FerramentaMultiCliqueBase, type Ponto } from './desenhoMultiClique';
import { desenharTracinhos, formatarRazao } from './estiloMedidas';
import { formatarComprimentoMm, formatarNumero } from './formatoMedidas';

type Ponto2 = CoreTypes.Point2;

interface EstiloDaAnotacao {
  toolGroupId: string;
  toolName: string;
  viewportId: string;
  annotationUID?: string;
}

function distanciaPontoSegmento2d(p: Ponto2, a: Ponto2, b: Ponto2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const q = dx * dx + dy * dy;
  const t = q === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function pontoMedio2d(a: Ponto2, b: Ponto2): Ponto2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function formatarNumeroPtBr(n: number, casas = medidas().casasValores): string {
  return formatarNumero(n, casas);
}

const mm = (v: number): string => formatarComprimentoMm(v, medidas());

/** Contexto comum de renderização de cada anotação. */
interface ContextoDesenho {
  ann: Types.Annotation;
  pontos: Ponto[];
  estiloSpec: EstiloDaAnotacao;
  cor: string;
  largura: number;
}

/**
 * Classe base para ferramentas de 2 segmentos independentes (P0–P1 e P2–P3).
 * Suporta tanto clicar-e-arrastar cada segmento quanto clicar no início e no fim de cada segmento.
 */
abstract class FerramentaDoisSegmentosBase extends FerramentaMultiCliqueBase {
  protected readonly inicioDeSegmento = [true, false, true, false] as const;

  protected abstract readonly corPadrao: string;

  /** Texto enquanto só o 1º segmento existe (ou `null` para não mostrar). */
  protected abstract textoPrimeiroSegmento(d1: number): string;

  /** Linhas finais com os 2 segmentos completos. */
  protected abstract textoFinal(p: Ponto[]): string[];

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    const nome = this.getToolName();
    let anns = anotacoes.state.getAnnotations(nome, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;

    for (const ann of anns) {
      const pontos = ann.data.handles!.points as Ponto[];
      if (pontos.length < 2 || !ann.annotationUID) continue;
      const ctx = this.contexto(ann, pontos, viewport.id);
      const uid = ann.annotationUID;

      const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
      const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
      const d1 = distancia3(pontos[0]!, pontos[1]!);
      drawing.drawLine(svgDrawingHelper, uid, 'seg-1', c0, c1, { color: ctx.cor, width: ctx.largura });
      if (medidas().tracinhos) desenharTracinhos(svgDrawingHelper, uid, 'tr-1', c0, c1, ctx.cor, ctx.largura);
      desenhou = true;

      if (pontos.length < 4) {
        if (d1 >= 0.5) {
          this.renderLinkedTextBoxAnnotation({
            enabledElement,
            svgDrawingHelper,
            annotation: ann,
            styleSpecifier: ctx.estiloSpec as never,
            textLines: [this.textoPrimeiroSegmento(d1)],
            canvasCoordinates: [c0, c1],
          });
        }
        continue;
      }

      const c2 = viewport.worldToCanvas(pontos[2]!) as Ponto2;
      const c3 = viewport.worldToCanvas(pontos[3]!) as Ponto2;
      drawing.drawLine(svgDrawingHelper, uid, 'seg-2', c2, c3, { color: ctx.cor, width: ctx.largura });
      if (medidas().tracinhos) desenharTracinhos(svgDrawingHelper, uid, 'tr-2', c2, c3, ctx.cor, ctx.largura);

      const m1 = pontoMedio2d(c0, c1);
      const m2 = pontoMedio2d(c2, c3);
      drawing.drawLine(svgDrawingHelper, uid, 'conector', m1, m2, {
        color: ctx.cor,
        width: 1,
        lineDash: '3,3',
      });

      this.renderLinkedTextBoxAnnotation({
        enabledElement,
        svgDrawingHelper,
        annotation: ann,
        styleSpecifier: ctx.estiloSpec as never,
        textLines: this.textoFinal(pontos),
        canvasCoordinates: [c0, c1, c2, c3],
      });
    }
    return desenhou;
  }

  private contexto(ann: Types.Annotation, pontos: Ponto[], viewportId: string): ContextoDesenho {
    const estiloSpec: EstiloDaAnotacao = {
      toolGroupId: this.toolGroupId!,
      toolName: this.getToolName(),
      viewportId,
      annotationUID: ann.annotationUID,
    };
    const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
    return {
      ann,
      pontos,
      estiloSpec,
      cor: (estilo.color as string) || this.corPadrao,
      largura: (estilo.lineWidth as number) || 1.5,
    };
  }

  override isPointNearTool(
    element: HTMLDivElement,
    ann: Types.Annotation,
    canvasCoords: Ponto2,
    proximity: number,
  ): boolean {
    const enabled = getEnabledElement(element);
    if (!enabled) return false;
    const { viewport } = enabled;
    const pontos = ann.data.handles!.points as Ponto[];
    if (pontos.length >= 2) {
      const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
      const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
      if (distanciaPontoSegmento2d(canvasCoords, c0, c1) <= proximity) return true;
    }
    if (pontos.length >= 4) {
      const c2 = viewport.worldToCanvas(pontos[2]!) as Ponto2;
      const c3 = viewport.worldToCanvas(pontos[3]!) as Ponto2;
      if (distanciaPontoSegmento2d(canvasCoords, c2, c3) <= proximity) return true;
    }
    return false;
  }
}

// ============================================================================
// 1. Relação de Estenose (StenosisRatio)
// ============================================================================

export class EstenoseTool extends FerramentaDoisSegmentosBase {
  static override toolName = 'StenosisRatio';
  protected readonly corPadrao = '#f87171';

  protected textoPrimeiroSegmento(d1: number): string {
    return `D1: ${mm(d1)} (trace o 2º diâmetro)`;
  }

  protected textoFinal(p: Ponto[]): string[] {
    const d1 = distancia3(p[0]!, p[1]!);
    const d2 = distancia3(p[2]!, p[3]!);
    const dRef = Math.max(d1, d2);
    const dEst = Math.min(d1, d2);
    const estDiam = dRef > 1e-6 ? (1 - dEst / dRef) * 100 : 0;
    const estArea = dRef > 1e-6 ? (1 - (dEst / dRef) ** 2) * 100 : 0;
    return [
      `Ref: ${mm(dRef)} · Luz: ${mm(dEst)}`,
      `Estenose: ${formatarNumeroPtBr(estDiam)}% (diâm.) · ${formatarNumeroPtBr(estArea)}% (área)`,
    ];
  }
}

// ============================================================================
// 2. Proporção de Comprimento / Razão Linear (LinearRatio)
// ============================================================================

export class ProporcaoLinearTool extends FerramentaDoisSegmentosBase {
  static override toolName = 'LinearRatio';
  protected readonly corPadrao = '#38bdf8';

  protected textoPrimeiroSegmento(l1: number): string {
    return `L1: ${mm(l1)} (trace L2 para a proporção)`;
  }

  protected textoFinal(p: Ponto[]): string[] {
    const l1 = distancia3(p[0]!, p[1]!);
    const l2 = distancia3(p[2]!, p[3]!);
    const razao = l2 > 1e-6 ? l1 / l2 : 0;
    const diff = Math.abs(l1 - l2);
    return [
      `L1: ${mm(l1)} · L2: ${mm(l2)} (Δ ${mm(diff)})`,
      `Proporção L1/L2: ${formatarRazao(razao)} (${formatarNumeroPtBr(razao * 100)}%)`,
    ];
  }
}

// ============================================================================
// 3. Ângulo de Cobb — 4 pontos (CobbAngleCustom)
// ============================================================================

/** Calcula o ângulo agudo (0° a 90°) entre dois vetores 3D. */
export function calcularAnguloCobbGraus(p0: Ponto, p1: Ponto, p2: Ponto, p3: Ponto): number {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p3[0] - p2[0];
  const vy = p3[1] - p2[1];
  const vz = p3[2] - p2[2];
  const nu = Math.hypot(ux, uy, uz);
  const nv = Math.hypot(vx, vy, vz);
  if (nu < 1e-9 || nv < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, Math.abs(ux * vx + uy * vy + uz * vz) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export class AnguloCobbTool extends FerramentaDoisSegmentosBase {
  static override toolName = 'CobbAngleCustom';
  protected readonly corPadrao = '#4ade80';

  protected textoPrimeiroSegmento(): string {
    return '1ª reta traçada (trace a 2ª reta)';
  }

  protected textoFinal(p: Ponto[]): string[] {
    return [`Cobb: ${formatarNumeroPtBr(calcularAnguloCobbGraus(p[0]!, p[1]!, p[2]!, p[3]!))}°`];
  }
}

// ============================================================================
// 4. Ângulo com Linha de Referência Horizontal / Vertical (ReferenceAngle)
// ============================================================================

/**
 * Inclinação (0° a 90°) de um segmento em relação ao eixo horizontal da tela/imagem.
 * O ângulo com a vertical é o complemento.
 */
export function inclinacaoHorizontalGraus(a: Ponto2, b: Ponto2): number {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dx < 1e-9 && dy < 1e-9) return 0;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export class AnguloReferenciaTool extends FerramentaMultiCliqueBase {
  static override toolName = 'ReferenceAngle';
  protected readonly inicioDeSegmento = [true, false] as const;

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(AnguloReferenciaTool.toolName, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;

    for (const ann of anns) {
      const pontos = ann.data.handles!.points as Ponto[];
      if (pontos.length < 2 || !ann.annotationUID) continue;
      const uid = ann.annotationUID;
      const estiloSpec: EstiloDaAnotacao = {
        toolGroupId: this.toolGroupId!,
        toolName: AnguloReferenciaTool.toolName,
        viewportId: viewport.id,
        annotationUID: uid,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
      const cor = (estilo.color as string) || '#c084fc';
      const largura = (estilo.lineWidth as number) || 1.5;

      const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
      const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
      drawing.drawLine(svgDrawingHelper, uid, 'reta', c0, c1, { color: cor, width: largura });
      desenhou = true;

      const comprimentoTela = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
      if (comprimentoTela < 2) continue;

      // Linha de referência horizontal tracejada partindo do 1º ponto, para o lado da reta:
      const sentido = c1[0] >= c0[0] ? 1 : -1;
      const fimHorizontal: Ponto2 = [c0[0] + sentido * comprimentoTela, c0[1]];
      drawing.drawLine(svgDrawingHelper, uid, 'ref-horizontal', c0, fimHorizontal, {
        color: cor,
        width: 1,
        lineDash: '4,4',
      });

      const horiz = inclinacaoHorizontalGraus(c0, c1);
      this.renderLinkedTextBoxAnnotation({
        enabledElement,
        svgDrawingHelper,
        annotation: ann,
        styleSpecifier: estiloSpec as never,
        textLines: [
          `Horizontal: ${formatarNumeroPtBr(horiz)}°`,
          `Vertical: ${formatarNumeroPtBr(90 - horiz)}°`,
        ],
        canvasCoordinates: [c0, c1],
      });
    }
    return desenhou;
  }

  override isPointNearTool(
    element: HTMLDivElement,
    ann: Types.Annotation,
    canvasCoords: Ponto2,
    proximity: number,
  ): boolean {
    const enabled = getEnabledElement(element);
    if (!enabled) return false;
    const { viewport } = enabled;
    const pontos = ann.data.handles!.points as Ponto[];
    if (pontos.length < 2) return false;
    const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
    const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
    return distanciaPontoSegmento2d(canvasCoords, c0, c1) <= proximity;
  }
}
