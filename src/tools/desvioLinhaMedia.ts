/**
 * Desvio da linha média / Distância perpendicular à linha de referência:
 * - 1º clique: início da linha de referência (ex.: inserção anterior da foice cerebral).
 * - 2º clique: fim da linha de referência (ex.: inserção posterior da foice).
 * - 3º clique: ponto cujo desvio em relação à linha se deseja medir (ex.: septo pelúcido).
 * Calcula a projeção ortogonal 3D (em mm, coordenadas LPS do paciente) do 3º ponto sobre a
 * reta definida pelos 2 primeiros pontos, desenha a linha média tracejada, o segmento
 * perpendicular contínuo com símbolo de ângulo reto (∟) e exibe a distância em mm.
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import { annotation as anotacoes, drawing, type Types } from '@cornerstonejs/tools';
import { medidas } from '../state/preferencias';
import { distancia3, FerramentaMultiCliqueBase, type Ponto } from './desenhoMultiClique';
import { desenharTracinhos } from './estiloMedidas';
import { formatarComprimentoMm } from './formatoMedidas';

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

/**
 * Projeta ortogonalmente o ponto `p` sobre a reta infinita que passa por `a` e `b` no espaço 3D.
 * Devolve o pé da perpendicular `pe` e a distância perpendicular em mm.
 */
export function projecaoPerpendicular3d(a: Ponto, b: Ponto, p: Ponto): { pe: Ponto; distanciaMm: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const vz = b[2] - a[2];
  const norma2 = vx * vx + vy * vy + vz * vz;
  if (norma2 < 1e-12) {
    return { pe: [a[0], a[1], a[2]], distanciaMm: distancia3(a, p) };
  }
  const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy + (p[2] - a[2]) * vz) / norma2;
  const pe: Ponto = [a[0] + t * vx, a[1] + t * vy, a[2] + t * vz];
  return { pe, distanciaMm: distancia3(pe, p) };
}

export class DesvioLinhaMediaTool extends FerramentaMultiCliqueBase {
  static override toolName = 'MidlineShift';

  /** Linha de referência (P0–P1) e o ponto-alvo P2 ligado por elástico ao fim da linha. */
  protected readonly inicioDeSegmento = [true, false, false] as const;

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(DesvioLinhaMediaTool.toolName, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;

    for (const ann of anns) {
      const pontos = ann.data.handles!.points as Ponto[];
      if (pontos.length < 2) continue;

      const estiloSpec: EstiloDaAnotacao = {
        toolGroupId: this.toolGroupId!,
        toolName: DesvioLinhaMediaTool.toolName,
        viewportId: viewport.id,
        annotationUID: ann.annotationUID,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
      const cor = (estilo.color as string) || '#38bdf8';
      const largura = Number(estilo.lineWidth) || 1.5;

      const a = pontos[0]!;
      const b = pontos[1]!;
      const ca = viewport.worldToCanvas(a) as Ponto2;
      const cb = viewport.worldToCanvas(b) as Ponto2;

      // Linha de referência (linha média) tracejada:
      drawing.drawLine(svgDrawingHelper, ann.annotationUID!, 'linha-ref', ca, cb, {
        color: cor,
        width: largura,
        lineDash: '5,4',
      });

      if (medidas().tracinhos) desenharTracinhos(svgDrawingHelper, ann.annotationUID!, 'tr-ref', ca, cb, cor, largura);

      if (pontos.length >= 3) {
        const p = pontos[2]!;
        const { pe, distanciaMm } = projecaoPerpendicular3d(a, b, p);
        const cPe = viewport.worldToCanvas(pe) as Ponto2;
        const cP = viewport.worldToCanvas(p) as Ponto2;

        // Se o pé da perpendicular cair fora do segmento AB, estende suavemente a linha tracejada até ele:
        const distAB = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
        const distAPe = Math.hypot(cPe[0] - ca[0], cPe[1] - ca[1]);
        const distBPe = Math.hypot(cPe[0] - cb[0], cPe[1] - cb[1]);
        if (distAPe > distAB || distBPe > distAB) {
          const extremoMaisProximo = distAPe < distBPe ? ca : cb;
          drawing.drawLine(svgDrawingHelper, ann.annotationUID!, 'linha-ext', extremoMaisProximo, cPe, {
            color: cor,
            width: 1,
            lineDash: '2,3',
          });
        }

        // Segmento perpendicular principal (do pé na linha média até o ponto-alvo):
        drawing.drawLine(svgDrawingHelper, ann.annotationUID!, 'linha-perp', cPe, cP, {
          color: cor,
          width: largura + 0.5,
        });

        // Pequeno símbolo de ângulo reto (∟) no pé da perpendicular:
        const dxRef = cb[0] - ca[0];
        const dyRef = cb[1] - ca[1];
        const lenRef = Math.hypot(dxRef, dyRef);
        const dxPerp = cP[0] - cPe[0];
        const dyPerp = cP[1] - cPe[1];
        const lenPerp = Math.hypot(dxPerp, dyPerp);
        if (lenRef > 8 && lenPerp > 8) {
          const tam = 6;
          const ux = dxRef / lenRef;
          const uy = dyRef / lenRef;
          const vx = dxPerp / lenPerp;
          const vy = dyPerp / lenPerp;
          const p1: Ponto2 = [cPe[0] + ux * tam, cPe[1] + uy * tam];
          const p2: Ponto2 = [cPe[0] + ux * tam + vx * tam, cPe[1] + uy * tam + vy * tam];
          const p3: Ponto2 = [cPe[0] + vx * tam, cPe[1] + vy * tam];
          drawing.drawPolyline(svgDrawingHelper, ann.annotationUID!, 'angulo-reto', [p1, p2, p3], {
            color: cor,
            width: 1,
          });
        }

        const texto = `Desvio: ${formatarComprimentoMm(distanciaMm, medidas())}`;
        this.renderLinkedTextBoxAnnotation({
          enabledElement,
          svgDrawingHelper,
          annotation: ann,
          styleSpecifier: estiloSpec as never,
          textLines: [texto],
          canvasCoordinates: [cP, cPe],
        });
      }

      desenhou = true;
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
    const ca = viewport.worldToCanvas(pontos[0]!) as Ponto2;
    const cb = viewport.worldToCanvas(pontos[1]!) as Ponto2;
    if (distanciaPontoSegmento2d(canvasCoords, ca, cb) <= proximity) return true;
    if (pontos.length >= 3) {
      const { pe } = projecaoPerpendicular3d(pontos[0]!, pontos[1]!, pontos[2]!);
      const cPe = viewport.worldToCanvas(pe) as Ponto2;
      const cP = viewport.worldToCanvas(pontos[2]!) as Ponto2;
      if (distanciaPontoSegmento2d(canvasCoords, cPe, cP) <= proximity) return true;
    }
    return false;
  }

  override toolSelectedCallback(): void {}
  override handleSelectedCallback(): void {}
}
