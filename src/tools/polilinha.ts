/**
 * Polilinha: medida com vários pontos (ex.: curva). Clique para cada ponto,
 * duplo clique para terminar, Esc cancela o traçado em andamento.
 * O comprimento é a soma das distâncias entre pontos consecutivos, em mm
 * (coordenadas do paciente, já em milímetros).
 */

import { getEnabledElement, utilities as coreUtilities, type Types as CoreTypes } from '@cornerstonejs/core';
import { AnnotationTool, annotation as anotacoes, drawing, Enums, utilities, type Types } from '@cornerstonejs/tools';

type Ponto = [number, number, number];
type Ponto2 = CoreTypes.Point2;
type DetalheEvento = Types.EventTypes.InteractionEventType['detail'];

const TOLERANCIA_CLIQUE_PX = 4;

interface Rascunho {
  annotation: Types.Annotation;
  element: HTMLDivElement;
  viewportId: string;
  pendente: boolean;
  inicioCanvas: Ponto2;
}

interface EstiloDaAnotacao {
  toolGroupId: string;
  toolName: string;
  viewportId: string;
  annotationUID?: string;
}

function distancia3(a: Ponto, b: Ponto): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function distanciaPontoSegmento(p: Ponto2, a: Ponto2, b: Ponto2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const q = dx * dx + dy * dy;
  const t = q === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Comprimento total em mm de uma lista de pontos. */
export function comprimentoPolilinha(pontos: Ponto[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    total += distancia3(pontos[i - 1]!, pontos[i]!);
  }
  return total;
}

/** Remove pontos iguais consecutivos (duplo clique gera dois cliques no mesmo lugar). */
function semDuplicados(pontos: Ponto[]): Ponto[] {
  const saida: Ponto[] = [];
  for (const p of pontos) {
    const ultimo = saida[saida.length - 1];
    if (!ultimo || distancia3(ultimo, p) > 1e-6) saida.push(p);
  }
  return saida;
}

export class PolilinhaTool extends AnnotationTool {
  static override toolName = 'Polyline';

  private rascunho: Rascunho | null = null;
  private ultimoViewportId: string | undefined;

  constructor(
    toolProps: Record<string, unknown> = {},
    defaultToolProps: Record<string, unknown> = {
      supportedInteractionTypes: ['Mouse'],
      configuration: { preventHandleOutsideImage: false },
    },
  ) {
    super(toolProps, defaultToolProps as never);
  }

  override addNewAnnotation(evt: Types.EventTypes.InteractionEventType): Types.Annotation | null {
    if (this.rascunho) return null;
    const detalhe = evt.detail;
    const { element } = detalhe;
    const mundo = [...detalhe.currentPoints.world] as Ponto;
    const ann = this.createAnnotation(evt, [mundo, [...mundo]] as never) as Types.Annotation;
    anotacoes.state.addAnnotation(ann, element);
    this.rascunho = {
      annotation: ann,
      element,
      viewportId: detalhe.viewportId,
      pendente: true,
      inicioCanvas: [...detalhe.currentPoints.canvas] as Ponto2,
    };
    element.addEventListener(Enums.Events.MOUSE_MOVE, this.aoMover);
    element.addEventListener(Enums.Events.MOUSE_CLICK, this.aoClicar);
    element.addEventListener(Enums.Events.MOUSE_DOUBLE_CLICK, this.aoDuploClique);
    this.renderizar();
    return ann;
  }

  private pontosDoRascunho(): Ponto[] {
    return this.rascunho!.annotation.data.handles!.points as Ponto[];
  }

  private aoMover = (e: Event): void => {
    if (!this.rascunho) return;
    const detalhe = (e as CustomEvent<DetalheEvento>).detail;
    const pontos = this.pontosDoRascunho();
    pontos[pontos.length - 1] = [...detalhe.currentPoints.world] as Ponto;
    this.rascunho.annotation.invalidated = true;
    this.renderizar();
  };

  private aoClicar = (e: Event): void => {
    const r = this.rascunho;
    if (!r) return;
    const detalhe = (e as CustomEvent<DetalheEvento>).detail;
    const canvas = detalhe.currentPoints.canvas as Ponto2;
    // O clique que criou o traçado chega logo depois do mousedown: é ignorado.
    if (r.pendente) {
      r.pendente = false;
      if (Math.hypot(canvas[0] - r.inicioCanvas[0], canvas[1] - r.inicioCanvas[1]) < TOLERANCIA_CLIQUE_PX) {
        return;
      }
    }
    const pontos = this.pontosDoRascunho();
    const mundo = [...detalhe.currentPoints.world] as Ponto;
    pontos[pontos.length - 1] = mundo;
    pontos.push([...mundo] as Ponto);
    r.annotation.invalidated = true;
    this.renderizar();
  };

  private aoDuploClique = (e: Event): void => {
    if (!this.rascunho) return;
    // Um duplo clique rápido pode não gerar o clique final: a posição do duplo clique
    // vira o último ponto fixo.
    const detalhe = (e as CustomEvent<DetalheEvento>).detail;
    const pontos = this.pontosDoRascunho();
    pontos[pontos.length - 1] = [...detalhe.currentPoints.world] as Ponto;
    this.finalizar();
  };

  /** Encerra o traçado: fica com os pontos fixos, ou é apagado se tiver menos de dois. */
  private finalizar(): void {
    const r = this.rascunho;
    if (!r) return;
    this.rascunho = null;
    const { element, annotation: ann } = r;
    element.removeEventListener(Enums.Events.MOUSE_MOVE, this.aoMover);
    element.removeEventListener(Enums.Events.MOUSE_CLICK, this.aoClicar);
    element.removeEventListener(Enums.Events.MOUSE_DOUBLE_CLICK, this.aoDuploClique);

    // O último ponto é sempre o cursor (rascunho): sai da lista.
    const pontos = semDuplicados(this.pontosDoRascunho().slice(0, -1));
    if (pontos.length < 2) {
      anotacoes.state.removeAnnotation(ann.annotationUID!);
    } else {
      ann.data.handles!.points = pontos;
      ann.invalidated = true;
      anotacoes.state.triggerAnnotationCompleted(ann);
    }
    this.renderizar();
  }

  /** Esc: descarta o traçado em andamento (não grava a medida). */
  override cancel(element: HTMLDivElement): string | undefined {
    const r = this.rascunho;
    if (!r || r.element !== element) return undefined;
    const uid = r.annotation.annotationUID!;
    this.rascunho = null;
    element.removeEventListener(Enums.Events.MOUSE_MOVE, this.aoMover);
    element.removeEventListener(Enums.Events.MOUSE_CLICK, this.aoClicar);
    element.removeEventListener(Enums.Events.MOUSE_DOUBLE_CLICK, this.aoDuploClique);
    anotacoes.state.removeAnnotation(uid);
    this.renderizar();
    return uid;
  }

  private renderizar(): void {
    if (this.rascunho) this.ultimoViewportId = this.rascunho.viewportId;
    if (this.ultimoViewportId) utilities.triggerAnnotationRenderForViewportIds([this.ultimoViewportId]);
  }

  override renderAnnotation(enabledElement: CoreTypes.IEnabledElement, svgDrawingHelper: Types.SVGDrawingHelper): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(PolilinhaTool.toolName, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;
    for (const ann of anns) {
      const pontos = ann.data.handles!.points as Ponto[];
      if (pontos.length < 2) continue;
      const estiloSpec: EstiloDaAnotacao = {
        toolGroupId: this.toolGroupId!,
        toolName: PolilinhaTool.toolName,
        viewportId: viewport.id,
        annotationUID: ann.annotationUID,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
      const canvas = pontos.map((p) => viewport.worldToCanvas(p) as Ponto2);
      drawing.drawPolyline(svgDrawingHelper, ann.annotationUID!, 'linha', canvas, {
        color: estilo.color as string,
        width: estilo.lineWidth as number,
        lineDash: estilo.lineDash as string,
      });
      const texto = `Comprimento: ${coreUtilities.roundNumber(comprimentoPolilinha(pontos))} mm`;
      this.renderLinkedTextBoxAnnotation({
        enabledElement,
        svgDrawingHelper,
        annotation: ann,
        styleSpecifier: estiloSpec as never,
        textLines: [texto],
        canvasCoordinates: canvas,
      });
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
    const canvas = (ann.data.handles!.points as Ponto[]).map((p) => viewport.worldToCanvas(p) as Ponto2);
    for (let i = 1; i < canvas.length; i++) {
      if (distanciaPontoSegmento(canvasCoords, canvas[i - 1]!, canvas[i]!) <= proximity) return true;
    }
    return false;
  }

  override toolSelectedCallback(): void {
    // Sem edição de pontos nesta versão: a seleção serve para apagar (Delete).
  }

  override handleSelectedCallback(): void {
    // Sem alças de edição nesta versão.
  }
}
