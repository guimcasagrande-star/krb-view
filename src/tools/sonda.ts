/**
 * Sonda de HU e SUV: um clique mostra o valor do ponto. Na fusão PET/TC mostra os dois
 * (HU da TC e SUV do PET); nas demais séries, o valor da série do viewport.
 * Os valores vêm de um "resolvedor" registrado por `viewport2d` (que conhece os volumes).
 */

import { getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  AnnotationTool,
  drawing,
  utilities as utilitarios,
  type Types,
} from '@cornerstonejs/tools';
import { medidas } from '../state/preferencias';

type Ponto3 = [number, number, number];
type Ponto2 = CoreTypes.Point2;

export const NOME_SONDA = 'ProbeHuSuv';

/** Linhas de texto para o ponto (ex.: ['HU: 40', 'SUVbw: 1,00']) ou um erro em português. */
export type RespostaSonda = { linhas: string[] } | { erro: string };
export type ResolvedorSonda = (viewportId: string, mundo: Ponto3) => Promise<RespostaSonda>;

let resolvedor: ResolvedorSonda | null = null;

export function definirResolvedorSonda(fn: ResolvedorSonda): void {
  resolvedor = fn;
}

interface DadosSonda {
  viewportId?: string;
  linhas?: string[];
}

function dados(ann: Types.Annotation): DadosSonda {
  const d = ann.data as { sonda?: DadosSonda };
  d.sonda ??= {};
  return d.sonda;
}

/** Lê o(s) valor(es) no ponto da anotação e redesenha. */
export async function recalcularSonda(ann: Types.Annotation): Promise<void> {
  const s = dados(ann);
  const p = (ann.data.handles?.points?.[0] ?? null) as Ponto3 | null;
  if (!p || !s.viewportId) return;
  const redesenhar = (): void => utilitarios.triggerAnnotationRenderForViewportIds([s.viewportId!]);
  if (!resolvedor) {
    s.linhas = ['Sonda indisponível.'];
    redesenhar();
    return;
  }
  s.linhas = ['…'];
  redesenhar();
  try {
    const r = await resolvedor(s.viewportId, p);
    s.linhas = 'erro' in r ? [r.erro] : r.linhas;
  } catch (e) {
    s.linhas = [e instanceof Error ? e.message : 'Falha ao ler o valor.'];
  }
  redesenhar();
}

export class SondaTool extends AnnotationTool {
  static override toolName = NOME_SONDA;

  constructor(
    toolProps: Record<string, unknown> = {},
    defaultToolProps: Record<string, unknown> = {
      supportedInteractionTypes: ['Mouse'],
      configuration: {},
    },
  ) {
    super(toolProps, defaultToolProps as never);
  }

  override addNewAnnotation(evt: Types.EventTypes.InteractionEventType): Types.Annotation {
    const d = evt.detail;
    const mundo = [...d.currentPoints.world] as Ponto3;
    const ann = this.createAnnotation(evt, [mundo] as never) as Types.Annotation;
    dados(ann).viewportId = d.viewportId;
    anotacoes.state.addAnnotation(ann, d.element);
    evt.preventDefault();
    void recalcularSonda(ann);
    utilitarios.triggerAnnotationRenderForViewportIds([d.viewportId]);
    return ann;
  }

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(SondaTool.toolName, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;
    for (const ann of anns) {
      const ponto = ann.data.handles?.points?.[0];
      if (!ponto || !ann.annotationUID) continue;
      const spec = {
        toolGroupId: this.toolGroupId!,
        toolName: SondaTool.toolName,
        viewportId: viewport.id,
        annotationUID: ann.annotationUID,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: spec as never });
      const cor = (estilo.color as string) || medidas().cor;
      const largura = Number(estilo.lineWidth) || medidas().espessura;
      const c = viewport.worldToCanvas(ponto) as Ponto2;
      const uid = ann.annotationUID;
      drawing.drawLine(svgDrawingHelper, uid, 'h', [c[0] - 7, c[1]], [c[0] + 7, c[1]], { color: cor, width: largura });
      drawing.drawLine(svgDrawingHelper, uid, 'v', [c[0], c[1] - 7], [c[0], c[1] + 7], { color: cor, width: largura });
      desenhou = true;
      const linhas = dados(ann).linhas;
      if (linhas?.length) {
        this.renderLinkedTextBoxAnnotation({
          enabledElement,
          svgDrawingHelper,
          annotation: ann,
          styleSpecifier: spec as never,
          textLines: linhas,
          canvasCoordinates: [c],
        });
      }
    }
    return desenhou;
  }

  override isPointNearTool(
    element: HTMLDivElement,
    ann: Types.Annotation,
    canvasCoords: Ponto2,
    proximity: number,
  ): boolean {
    const viewport = getEnabledElement(element)?.viewport;
    const ponto = ann.data.handles?.points?.[0];
    if (!viewport || !ponto) return false;
    const c = viewport.worldToCanvas(ponto);
    return Math.hypot(c[0] - canvasCoords[0], c[1] - canvasCoords[1]) <= proximity + 4;
  }

  override cancel(): string | undefined {
    return undefined;
  }

  override toolSelectedCallback(): void {}
  override handleSelectedCallback(): void {}
}
