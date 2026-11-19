/**
 * Base para ferramentas desenhadas em vários pontos (segmentos, ângulos, setas, desvio).
 *
 * Só o 1º clique passa pelo Cornerstone (`addNewAnnotation`). A partir daí o desenho é
 * conduzido por eventos NATIVOS do navegador (mousedown / mousemove / mouseup em `window`,
 * fase de captura), porque o `mouseDownListener` do Cornerstone atrasa o MOUSE_DOWN em até
 * 400 ms (detecção de duplo clique) e, conforme a velocidade dos cliques, o evento do 2º
 * segmento chegava fora de ordem ou nem chegava.
 *
 * - Enquanto o rascunho existe, `state.isInteractingWithTool = true`: o despachante do
 *   Cornerstone não seleciona alças nem cria outra anotação por cima.
 * - mousedown fixa a posição do ponto corrente (ou inicia um novo segmento).
 * - mousemove faz o ponto corrente acompanhar o cursor.
 * - mouseup só avança de etapa se o ponto corrente já se afastou do anterior, então funciona
 *   tanto "clicar-arrastar-soltar" quanto "clicar, mover, clicar".
 * - Trocar de ferramenta ou apertar Esc descarta o rascunho e libera a interação.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { medidas } from '../state/preferencias';
import { AnnotationTool, annotation as anotacoes, state as estadoTools, utilities, type Types } from '@cornerstonejs/tools';

export type Ponto = [number, number, number];

/** Distância mínima (mm) para um ponto contar como válido em relação ao anterior. */
const DISTANCIA_MINIMA_MM = 0.5;
/**
 * Distância mínima em pixels na tela para o soltar do 1º clique (`mouseup`) contar como
 * arrasto intencional ("clicar, arrastar e soltar") em vez de um clique com micro-tremor da mão.
 */
const DISTANCIA_ARRASTE_PX = 10;

export function distancia3(a: Ponto, b: Ponto): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface RascunhoMultiClique {
  annotation: Types.Annotation;
  element: HTMLDivElement;
  viewportId: string;
  /** Índice do ponto que está sendo posicionado agora. */
  indice: number;
  /** Verdadeiro quando o próximo ponto inicia um segmento novo e ainda não foi clicado. */
  aguardandoInicio: boolean;
  /** O ponto corrente já se afastou do anterior em mm (válido para fechar no 2º clique). */
  moveu: boolean;
  /** Posição na tela (px) onde o segmento atual começou, para distinguir clique com tremor de arrasto real. */
  origemCanvas: [number, number];
  /** Verdadeiro quando o ponto atual já foi arrastado >= DISTANCIA_ARRASTE_PX na tela. */
  arrastouNaTela: boolean;
}

export abstract class FerramentaMultiCliqueBase extends AnnotationTool {
  /**
   * Para cada ponto da anotação, se ele inicia um segmento novo (`true`) ou é ligado ao
   * ponto anterior com elástico (`false`). O índice 0 é sempre início.
   * Ex.: 2 segmentos independentes = [true, false, true, false].
   */
  protected abstract readonly inicioDeSegmento: readonly boolean[];

  protected rascunho: RascunhoMultiClique | null = null;
  private ultimoViewportId: string | undefined;
  /**
   * mousedowns nativos já usados pelo desenho. O Cornerstone ainda entrega cada um deles
   * (atrasado) como MOUSE_DOWN; o do clique final chegaria depois do fim do desenho e
   * criaria uma medida nova sozinha — por isso são ignorados em `addNewAnnotation`.
   */
  private cliquesConsumidos = new WeakSet<Event>();

  constructor(
    toolProps: Record<string, unknown> = {},
    defaultToolProps: Record<string, unknown> = {
      supportedInteractionTypes: ['Mouse'],
      configuration: { preventHandleOutsideImage: false },
    },
  ) {
    super(toolProps, defaultToolProps as never);
  }

  /** Gancho para preencher dados extras da anotação recém-criada. */
  protected aoCriarAnotacao(_ann: Types.Annotation, _viewportId?: string): void {}

  override addNewAnnotation(evt: Types.EventTypes.InteractionEventType): Types.Annotation | null {
    if (this.rascunho) return null;
    const detalhe = evt.detail;
    const nativo = (detalhe as { event?: Event }).event;
    if (nativo && this.cliquesConsumidos.has(nativo)) return null;

    const { element } = detalhe;
    const mundo = [...detalhe.currentPoints.world] as Ponto;
    const canvas = detalhe.currentPoints.canvas;
    const origemCanvas: [number, number] = [canvas[0], canvas[1]];
    const ann = this.createAnnotation(evt, [mundo, [...mundo]] as never) as Types.Annotation;
    this.aoCriarAnotacao(ann, detalhe.viewportId);
    anotacoes.state.addAnnotation(ann, element);
    this.rascunho = {
      annotation: ann,
      element,
      viewportId: detalhe.viewportId,
      indice: 1,
      aguardandoInicio: false,
      moveu: false,
      origemCanvas,
      arrastouNaTela: false,
    };
    this.ativarDesenho();
    evt.preventDefault();
    this.renderizar();
    return ann;
  }

  private pontos(): Ponto[] {
    return this.rascunho!.annotation.data.handles!.points as Ponto[];
  }

  private canvasDoEvento(ev: MouseEvent): [number, number] {
    const rect = this.rascunho!.element.getBoundingClientRect();
    return [ev.clientX - rect.left, ev.clientY - rect.top];
  }

  /** Converte a posição do mouse para coordenadas do paciente no viewport do rascunho. */
  private mundoDoEvento(ev: MouseEvent): Ponto | null {
    const r = this.rascunho;
    if (!r) return null;
    const viewport = getEnabledElement(r.element)?.viewport;
    if (!viewport) return null;
    const canvas = this.canvasDoEvento(ev);
    try {
      const w = viewport.canvasToWorld(canvas);
      if (!w || !Number.isFinite(w[0]) || !Number.isFinite(w[1]) || !Number.isFinite(w[2])) return null;
      return [w[0], w[1], w[2]];
    } catch {
      return null;
    }
  }

  /** Gancho opcional para restringir a posição de um ponto durante o desenho (ex.: forçar 90°). */
  protected ajustarPontoCorrente(_indice: number, mundo: Ponto, _pontos: Ponto[]): Ponto {
    return mundo;
  }

  private posicionarPontoCorrente(mundoBruto: Ponto, canvas?: [number, number]): void {
    const r = this.rascunho!;
    const pontos = this.pontos();
    const mundo = this.ajustarPontoCorrente(r.indice, mundoBruto, pontos);
    pontos[r.indice] = mundo;
    r.moveu = distancia3(pontos[r.indice - 1]!, mundo) >= DISTANCIA_MINIMA_MM;
    if (canvas && Math.hypot(canvas[0] - r.origemCanvas[0], canvas[1] - r.origemCanvas[1]) >= DISTANCIA_ARRASTE_PX) {
      r.arrastouNaTela = true;
    }
    r.annotation.invalidated = true;
  }

  private aoPressionar = (ev: MouseEvent): void => {
    const r = this.rascunho;
    if (!r || ev.button !== 0) return;
    if (!(ev.target instanceof Node) || !r.element.contains(ev.target)) return;
    const mundo = this.mundoDoEvento(ev);
    if (!mundo) return;
    const canvas = this.canvasDoEvento(ev);
    this.cliquesConsumidos.add(ev);
    const pontos = this.pontos();

    if (r.aguardandoInicio) {
      // Início de um novo segmento: fixa o 1º ponto e cria o 2º (elástico) no mesmo lugar.
      pontos[r.indice] = mundo;
      pontos[r.indice + 1] = [...mundo] as Ponto;
      r.indice += 1;
      r.aguardandoInicio = false;
      r.moveu = false;
      r.origemCanvas = canvas;
      r.arrastouNaTela = false;
      r.annotation.invalidated = true;
    } else {
      this.posicionarPontoCorrente(mundo, canvas);
      // 2º clique explícito fecha o segmento imediatamente (funciona tanto em "clicar" quanto em "arrastar", inclusive para lesões pequenas).
      if (r.moveu) {
        this.avancar();
        return;
      }
      return;
    }
    this.renderizar();
  };

  private aoMover = (ev: MouseEvent): void => {
    const r = this.rascunho;
    if (!r || r.aguardandoInicio) return;
    const mundo = this.mundoDoEvento(ev);
    if (!mundo) return;
    this.posicionarPontoCorrente(mundo, this.canvasDoEvento(ev));
    this.renderizar();
  };

  private aoSoltar = (ev: MouseEvent): void => {
    const r = this.rascunho;
    if (!r || ev.button !== 0 || r.aguardandoInicio) return;
    if (medidas().modoClique === 'clicar') return;
    const canvas = this.canvasDoEvento(ev);
    const mundo = this.mundoDoEvento(ev);
    if (mundo && distancia3(this.pontos()[r.indice - 1]!, mundo) >= DISTANCIA_MINIMA_MM) {
      this.posicionarPontoCorrente(mundo, canvas);
    }
    // Só conclui ao soltar se houve arrasto real (>= 10 px na tela); micro-tremor no 1º clique mantém o modo "clicar e clicar".
    if (!r.moveu || !r.arrastouNaTela) return;
    this.avancar();
  };

  /** Fixa o ponto corrente e passa ao próximo (ou termina a medida). */
  private avancar(): void {
    const r = this.rascunho;
    if (!r) return;
    const total = this.inicioDeSegmento.length;
    if (r.indice >= total - 1) {
      this.finalizar();
      return;
    }
    const proximo = r.indice + 1;
    if (this.inicioDeSegmento[proximo]) {
      r.indice = proximo;
      r.aguardandoInicio = true;
      r.moveu = false;
      r.arrastouNaTela = false;
    } else {
      const pontos = this.pontos();
      pontos[proximo] = [...pontos[r.indice]!] as Ponto;
      r.indice = proximo;
      r.moveu = false;
      r.arrastouNaTela = false;
      const vp = getEnabledElement(r.element)?.viewport;
      if (vp) {
        const c = vp.worldToCanvas(pontos[proximo]!);
        r.origemCanvas = [c[0], c[1]];
      }
    }
    r.annotation.invalidated = true;
    this.renderizar();
  }

  private ativarDesenho(): void {
    estadoTools.isInteractingWithTool = true;
    window.addEventListener('mousedown', this.aoPressionar, true);
    window.addEventListener('mousemove', this.aoMover, true);
    window.addEventListener('mouseup', this.aoSoltar, true);
  }

  private desativarDesenho(): void {
    estadoTools.isInteractingWithTool = false;
    window.removeEventListener('mousedown', this.aoPressionar, true);
    window.removeEventListener('mousemove', this.aoMover, true);
    window.removeEventListener('mouseup', this.aoSoltar, true);
  }

  private finalizar(): void {
    const r = this.rascunho;
    if (!r) return;
    this.rascunho = null;
    this.desativarDesenho();
    const ann = r.annotation;
    const pontos = ann.data.handles!.points as Ponto[];
    const total = this.inicioDeSegmento.length;
    let valido = pontos.length >= total;
    for (let i = 1; valido && i < total; i++) {
      if (!this.inicioDeSegmento[i] && distancia3(pontos[i - 1]!, pontos[i]!) < DISTANCIA_MINIMA_MM) valido = false;
    }
    if (!valido) {
      if (ann.annotationUID) anotacoes.state.removeAnnotation(ann.annotationUID);
    } else {
      ann.highlighted = false;
      ann.invalidated = true;
      anotacoes.state.triggerAnnotationCompleted(ann);
    }
    this.renderizar();
  }

  /** Descarta o rascunho (se houver) e libera a interação global. */
  protected descartarRascunho(): string | undefined {
    const r = this.rascunho;
    if (!r) return undefined;
    this.rascunho = null;
    this.desativarDesenho();
    const uid = r.annotation.annotationUID;
    if (uid) anotacoes.state.removeAnnotation(uid);
    this.renderizar();
    return uid;
  }

  override cancel(element: HTMLDivElement): string | undefined {
    if (!this.rascunho || this.rascunho.element !== element) return undefined;
    return this.descartarRascunho();
  }

  // Chamados pelo ToolGroup ao trocar de ferramenta: nunca deixar a interação presa.
  onSetToolPassive(): void {
    this.descartarRascunho();
  }
  onSetToolEnabled(): void {
    this.descartarRascunho();
  }
  onSetToolDisabled(): void {
    this.descartarRascunho();
  }

  protected renderizar(): void {
    if (this.rascunho) this.ultimoViewportId = this.rascunho.viewportId;
    if (this.ultimoViewportId) utilities.triggerAnnotationRenderForViewportIds([this.ultimoViewportId]);
  }

  override toolSelectedCallback(): void {}
  override handleSelectedCallback(): void {}
}
