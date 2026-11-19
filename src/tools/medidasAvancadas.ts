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
import { sufixoVolumeAutoPorUid } from './volumeElipsoide';

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
  protected abstract textoFinal(p: Ponto[], ann?: Types.Annotation): string[];

  /** Gancho opcional para desenhar elementos extras (ex.: símbolo de ângulo reto 90°). */
  protected desenharExtrasDoisSegmentos(
    svgDrawingHelper: Types.SVGDrawingHelper,
    uid: string,
    c0: Ponto2,
    c1: Ponto2,
    c2: Ponto2,
    c3: Ponto2,
    cor: string,
    _largura: number,
  ): void {
    const m1 = pontoMedio2d(c0, c1);
    const m2 = pontoMedio2d(c2, c3);
    drawing.drawLine(svgDrawingHelper, uid, 'conector', m1, m2, {
      color: cor,
      width: 1,
      lineDash: '3,3',
    });
  }

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

      this.desenharExtrasDoisSegmentos(svgDrawingHelper, uid, c0, c1, c2, c3, ctx.cor, ctx.largura);

      this.renderLinkedTextBoxAnnotation({
        enabledElement,
        svgDrawingHelper,
        annotation: ann,
        styleSpecifier: ctx.estiloSpec as never,
        textLines: this.textoFinal(pontos, ann),
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

// ============================================================================
// 5. Medidas Ortogonais (OrthogonalLengths — 2 medidas obrigatoriamente a 90°)
// ============================================================================

/**
 * Projeta `pMovelBruto` (a partir da âncora `pAncora`) para que o segmento
 * `pAncora → resultado` fique estritamente perpendicular (90°) ao 1º eixo `p0 → p1`.
 */
export function projetarPontoOrtogonal(p0: Ponto, p1: Ponto, pAncora: Ponto, pMovelBruto: Ponto): Ponto {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const uLen2 = ux * ux + uy * uy + uz * uz;
  if (uLen2 < 1e-9) return [...pMovelBruto] as Ponto;
  const wx = pMovelBruto[0] - pAncora[0];
  const wy = pMovelBruto[1] - pAncora[1];
  const wz = pMovelBruto[2] - pAncora[2];
  const proj = (wx * ux + wy * uy + wz * uz) / uLen2;
  return [
    pAncora[0] + (wx - proj * ux),
    pAncora[1] + (wy - proj * uy),
    pAncora[2] + (wz - proj * uz),
  ];
}

/**
 * Mantém a restrição de 90° entre o 1º segmento (`pts[0]–pts[1]`) e o 2º (`pts[2]–pts[3]`)
 * quando o usuário arrasta uma das 4 pontas (alças) após o desenho.
 */
export function ajustarPontosOrtogonaisAoMoverAlca(
  originais: Ponto[],
  pts: Ponto[],
  alca: number,
): void {
  if (pts.length < 4 || originais.length < 4) return;
  if (alca === 3) {
    pts[3] = projetarPontoOrtogonal(pts[0]!, pts[1]!, pts[2]!, pts[3]!);
    return;
  }
  if (alca === 2) {
    pts[2] = projetarPontoOrtogonal(pts[0]!, pts[1]!, pts[3]!, pts[2]!);
    return;
  }
  if (alca === 0 || alca === 1) {
    // O 1º eixo girou: gira o 2º segmento no mesmo plano mantendo o comprimento L2 e o centro dele.
    const uAnt: Ponto = [
      originais[1]![0] - originais[0]![0],
      originais[1]![1] - originais[0]![1],
      originais[1]![2] - originais[0]![2],
    ];
    const vAnt: Ponto = [
      originais[3]![0] - originais[2]![0],
      originais[3]![1] - originais[2]![1],
      originais[3]![2] - originais[2]![2],
    ];
    const l2 = Math.hypot(vAnt[0], vAnt[1], vAnt[2]);
    if (l2 < 1e-6) return;
    // Normal do plano do corte = uAnt × vAnt
    const nx = uAnt[1] * vAnt[2] - uAnt[2] * vAnt[1];
    const ny = uAnt[2] * vAnt[0] - uAnt[0] * vAnt[2];
    const nz = uAnt[0] * vAnt[1] - uAnt[1] * vAnt[0];
    const uNovo: Ponto = [
      pts[1]![0] - pts[0]![0],
      pts[1]![1] - pts[0]![1],
      pts[1]![2] - pts[0]![2],
    ];
    // Direção perpendicular no mesmo plano = n × uNovo
    let dx = ny * uNovo[2] - nz * uNovo[1];
    let dy = nz * uNovo[0] - nx * uNovo[2];
    let dz = nx * uNovo[1] - ny * uNovo[0];
    const dLen = Math.hypot(dx, dy, dz);
    if (dLen < 1e-9) {
      pts[3] = projetarPontoOrtogonal(pts[0]!, pts[1]!, pts[2]!, pts[3]!);
      return;
    }
    dx /= dLen;
    dy /= dLen;
    dz /= dLen;
    if (dx * vAnt[0] + dy * vAnt[1] + dz * vAnt[2] < 0) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
    const mx = (originais[2]![0] + originais[3]![0]) / 2;
    const my = (originais[2]![1] + originais[3]![1]) / 2;
    const mz = (originais[2]![2] + originais[3]![2]) / 2;
    const metade = l2 / 2;
    pts[2] = [mx - dx * metade, my - dy * metade, mz - dz * metade];
    pts[3] = [mx + dx * metade, my + dy * metade, mz + dz * metade];
  }
}

export class MedidasOrtogonaisTool extends FerramentaDoisSegmentosBase {
  static override toolName = 'OrthogonalLengths';
  protected readonly corPadrao = '#38bdf8';

  protected override ajustarPontoCorrente(indice: number, mundo: Ponto, pontos: Ponto[]): Ponto {
    if (indice === 3 && pontos.length >= 3) {
      return projetarPontoOrtogonal(pontos[0]!, pontos[1]!, pontos[2]!, mundo);
    }
    return mundo;
  }

  protected textoPrimeiroSegmento(d1: number): string {
    return `${mm(d1)} (trace a 2ª medida a 90°)`;
  }

  protected textoFinal(p: Ponto[], ann?: Types.Annotation): string[] {
    const l1 = distancia3(p[0]!, p[1]!);
    const l2 = distancia3(p[2]!, p[3]!);
    return [`${mm(l1)} × ${mm(l2)}${sufixoVolumeAutoPorUid(ann?.annotationUID)}`];
  }

  protected override desenharExtrasDoisSegmentos(
    svgDrawingHelper: Types.SVGDrawingHelper,
    uid: string,
    c0: Ponto2,
    c1: Ponto2,
    c2: Ponto2,
    c3: Ponto2,
    cor: string,
  ): void {
    const ux = c1[0] - c0[0];
    const uy = c1[1] - c0[1];
    const vx = c3[0] - c2[0];
    const vy = c3[1] - c2[1];
    const nu = Math.hypot(ux, uy);
    const nv = Math.hypot(vx, vy);
    if (nu < 4 || nv < 4) return;

    // Interseção das retas c0–c1 e c2–c3 (projeção de c2 sobre a reta c0–c1):
    const t1 = ((c2[0] - c0[0]) * ux + (c2[1] - c0[1]) * uy) / (nu * nu);
    const inter: Ponto2 = [c0[0] + t1 * ux, c0[1] + t1 * uy];

    // Se o 2º segmento não encosta na 1ª reta, liga a ponta mais próxima até a interseção com tracejado fino:
    const distSeg2 = distanciaPontoSegmento2d(inter, c2, c3);
    if (distSeg2 > 3) {
      const d2 = Math.hypot(c2[0] - inter[0], c2[1] - inter[1]);
      const d3 = Math.hypot(c3[0] - inter[0], c3[1] - inter[1]);
      const ponta = d2 <= d3 ? c2 : c3;
      drawing.drawLine(svgDrawingHelper, uid, 'conector', ponta, inter, {
        color: cor,
        width: 1,
        lineDash: '3,3',
      });
    }

    // Desenha o quadradinho de 90° (∟) na interseção:
    const tam = 7;
    const m1 = pontoMedio2d(c0, c1);
    const m2 = pontoMedio2d(c2, c3);
    const su = (m1[0] - inter[0]) * ux + (m1[1] - inter[1]) * uy >= 0 ? 1 : -1;
    const sv = (m2[0] - inter[0]) * vx + (m2[1] - inter[1]) * vy >= 0 ? 1 : -1;
    const du: Ponto2 = [(ux / nu) * tam * su, (uy / nu) * tam * su];
    const dv: Ponto2 = [(vx / nv) * tam * sv, (vy / nv) * tam * sv];
    const pA: Ponto2 = [inter[0] + du[0], inter[1] + du[1]];
    const pC: Ponto2 = [inter[0] + dv[0], inter[1] + dv[1]];
    const pB: Ponto2 = [inter[0] + du[0] + dv[0], inter[1] + du[1] + dv[1]];
    drawing.drawLine(svgDrawingHelper, uid, 'ang90-1', pA, pB, { color: cor, width: 1 });
    drawing.drawLine(svgDrawingHelper, uid, 'ang90-2', pC, pB, { color: cor, width: 1 });
  }
}
