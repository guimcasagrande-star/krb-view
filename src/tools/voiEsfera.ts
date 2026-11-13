/**
 * ROI volumétrica (VOI esférica):
 * - 1º clique: centro da esfera. Arrastar (ou 2º clique): define o raio.
 * - O círculo é desenhado em todos os cortes que a esfera atravessa, com o raio da seção.
 * - Ao terminar, mede os voxels do volume da série: máx., média, desvio, mín. e volume;
 *   no PET também o SUVpico (esfera de 1 mL). Os valores são os do volume (HU ou SUV).
 *
 * O volume vem de um "resolvedor" registrado por `viewport2d` (que sabe qual série está em
 * cada viewport); aqui não há dependência da grade de viewports.
 */

import { eventTarget, getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  drawing,
  Enums as EnumsTools,
  utilities as utilitarios,
  type Types,
} from '@cornerstonejs/tools';
import { medidas } from '../state/preferencias';
import { calcularVoiEsfera, type ResultadoVoi } from '../volume/voi';
import type { ScalarVolume } from '../volume/voxelStats';
import { distancia3, FerramentaMultiCliqueBase, type Ponto } from './desenhoMultiClique';
import { formatarNumero } from './formatoMedidas';

type Ponto2 = CoreTypes.Point2;

export const NOME_VOI_ESFERA = 'SphereVOI';

export interface VolumeParaVoi {
  volume: ScalarVolume;
  /** 'SUV', 'Bq/mL', 'HU'... */
  unidade: string;
  ehPet: boolean;
}

export type RespostaResolvedor = VolumeParaVoi | { erro: string };
export type ResolvedorVolumeVoi = (viewportId: string) => Promise<RespostaResolvedor>;

let resolvedor: ResolvedorVolumeVoi | null = null;

/** `viewport2d` registra aqui como obter o volume da série mostrada num viewport. */
export function definirResolvedorVoi(fn: ResolvedorVolumeVoi): void {
  resolvedor = fn;
}

interface DadosVoi {
  viewportId?: string;
  estado: 'medindo' | 'calculando' | 'pronto' | 'erro';
  resultado?: ResultadoVoi;
  unidade?: string;
  ehPet?: boolean;
  mensagem?: string;
}

function dadosVoi(ann: Types.Annotation): DadosVoi {
  const d = ann.data as { voi?: DadosVoi };
  d.voi ??= { estado: 'medindo' };
  return d.voi;
}

function produtoVetorial(a: number[], b: number[]): number[] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

/** Medida terminada: calcula as estatísticas com o volume da série. */
async function calcular(ann: Types.Annotation): Promise<void> {
  const voi = dadosVoi(ann);
  const pontos = ann.data.handles!.points as Ponto[];
  const viewportId = voi.viewportId;
  const redesenhar = (): void => {
    if (viewportId) utilitarios.triggerAnnotationRenderForViewportIds([viewportId]);
  };
  if (!resolvedor || !viewportId) {
    voi.estado = 'erro';
    voi.mensagem = 'Volume indisponível.';
    redesenhar();
    return;
  }
  voi.estado = 'calculando';
  redesenhar();
  try {
    const r = await resolvedor(viewportId);
    if ('erro' in r) {
      voi.estado = 'erro';
      voi.mensagem = r.erro;
    } else {
      const resposta = calcularVoiEsfera(r.volume, pontos[0]!, distancia3(pontos[0]!, pontos[1]!), r.ehPet);
      if (resposta.ok) {
        voi.estado = 'pronto';
        voi.resultado = resposta;
        voi.unidade = r.unidade;
        voi.ehPet = r.ehPet;
      } else {
        voi.estado = 'erro';
        voi.mensagem = resposta.motivo;
      }
    }
  } catch (e) {
    voi.estado = 'erro';
    voi.mensagem = e instanceof Error ? e.message : 'Falha ao medir.';
  }
  redesenhar();
}

/** Liga o cálculo ao fim do desenho. Chamar uma vez. */
export function iniciarVoiEsfera(): void {
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_COMPLETED, (evt: Event) => {
    const ann = (evt as CustomEvent<{ annotation?: Types.Annotation }>).detail?.annotation;
    if (ann?.metadata?.toolName === NOME_VOI_ESFERA) void calcular(ann);
  });
}

function linhasDoTexto(voi: DadosVoi): string[] {
  const casas = medidas().casasValores;
  const n = (v: number): string => formatarNumero(v, casas);
  if (voi.estado === 'calculando') return ['Medindo o volume…'];
  if (voi.estado === 'erro') return [`VOI: ${voi.mensagem ?? 'erro'}`];
  const r = voi.resultado;
  if (voi.estado !== 'pronto' || !r) return [];
  const un = voi.unidade ?? '';
  const eSuv = un.startsWith('SU');
  const sufixo = eSuv ? '' : ` ${un}`;
  const rot = un === 'SUVbw' ? 'SUV' : eSuv ? un : '';
  const linhas = [
    `${rot}máx.: ${n(r.max)}${sufixo}`,
    `${rot}média: ${n(r.media)}${sufixo} (DP ${n(r.desvio)})`,
  ];
  if (r.pico !== undefined) linhas.push(`${rot}pico: ${n(r.pico)}${sufixo}`);
  else linhas.push(`mín.: ${n(r.min)}${sufixo}`);
  linhas.push(`Volume: ${formatarNumero(r.volumeMl, 1)} mL · raio ${formatarNumero(r.raioMm, 1)} mm`);
  return linhas;
}

/** Geometria do corte atual: centro projetado no plano, raio da seção (mm) e eixo "direita". */
function secaoVoi(viewport: CoreTypes.IStackViewport | CoreTypes.IVolumeViewport, ann: Types.Annotation) {
  const pontos = ann.data.handles!.points as Ponto[];
  const raio = distancia3(pontos[0]!, pontos[1]!);
  const cam = viewport.getCamera();
  const normal = cam.viewPlaneNormal;
  const foco = cam.focalPoint;
  const viewUp = cam.viewUp;
  if (!normal || !foco || !viewUp || raio <= 0) return null;
  const c = pontos[0]!;
  const dz = (c[0] - foco[0]) * normal[0] + (c[1] - foco[1]) * normal[1] + (c[2] - foco[2]) * normal[2];
  if (Math.abs(dz) > raio) return null;
  const rSecao = Math.sqrt(Math.max(0, raio * raio - dz * dz));
  const centro: Ponto = [c[0] - normal[0] * dz, c[1] - normal[1] * dz, c[2] - normal[2] * dz];
  const dir = produtoVetorial(viewUp as number[], normal as number[]);
  const n = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
  return { centro, rSecao, direita: [dir[0]! / n, dir[1]! / n, dir[2]! / n] as Ponto };
}

/** Círculo (centro e raio em px de tela) da seção da esfera no corte atual, ou null se não a corta. */
export function circuloVoiCanvas(
  viewport: CoreTypes.IStackViewport | CoreTypes.IVolumeViewport,
  ann: Types.Annotation,
) {
  const s = secaoVoi(viewport, ann);
  if (!s) return null;
  const cc = viewport.worldToCanvas(s.centro) as Ponto2;
  const borda = viewport.worldToCanvas([
    s.centro[0] + s.direita[0] * s.rSecao,
    s.centro[1] + s.direita[1] * s.rSecao,
    s.centro[2] + s.direita[2] * s.rSecao,
  ]) as Ponto2;
  return { cc, r: Math.hypot(borda[0] - cc[0], borda[1] - cc[1]) };
}

/** Recalcula as estatísticas (depois de a esfera ser movida). */
export function recalcularVoi(ann: Types.Annotation): void {
  void calcular(ann);
}

export class VoiEsferaTool extends FerramentaMultiCliqueBase {
  static override toolName = NOME_VOI_ESFERA;
  protected readonly inicioDeSegmento = [true, false] as const;

  protected override aoCriarAnotacao(ann: Types.Annotation, viewportId?: string): void {
    dadosVoi(ann).viewportId = viewportId;
  }

  private circuloCanvas(viewport: CoreTypes.IStackViewport | CoreTypes.IVolumeViewport, ann: Types.Annotation) {
    return circuloVoiCanvas(viewport, ann);
  }

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    const anns = anotacoes.state.getAnnotations(NOME_VOI_ESFERA, element);
    if (!anns?.length) return false;
    let desenhou = false;
    const frame = viewport.getFrameOfReferenceUID?.();

    for (const ann of anns) {
      if (ann.isVisible === false || !ann.annotationUID) continue;
      if (frame && ann.metadata?.FrameOfReferenceUID && ann.metadata.FrameOfReferenceUID !== frame) continue;
      const pontos = ann.data.handles?.points as Ponto[] | undefined;
      if (!pontos || pontos.length < 2) continue;
      const circ = this.circuloCanvas(viewport, ann);
      if (!circ) continue;

      const spec = {
        toolGroupId: this.toolGroupId!,
        toolName: NOME_VOI_ESFERA,
        viewportId: viewport.id,
        annotationUID: ann.annotationUID,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: spec as never });
      const cor = (estilo.color as string) || medidas().cor;
      const largura = Number(estilo.lineWidth) || medidas().espessura;
      const uid = ann.annotationUID;

      drawing.drawCircle(svgDrawingHelper, uid, 'esfera', circ.cc, circ.r, { color: cor, lineWidth: largura });
      drawing.drawCircle(svgDrawingHelper, uid, 'centro', circ.cc, 2, { color: cor, lineWidth: largura });
      desenhou = true;

      const linhas = linhasDoTexto(dadosVoi(ann));
      if (linhas.length > 0) {
        const topo: Ponto2 = [circ.cc[0], circ.cc[1] - circ.r];
        const base: Ponto2 = [circ.cc[0], circ.cc[1] + circ.r];
        const direita: Ponto2 = [circ.cc[0] + circ.r, circ.cc[1]];
        this.renderLinkedTextBoxAnnotation({
          enabledElement,
          svgDrawingHelper,
          annotation: ann,
          styleSpecifier: spec as never,
          textLines: linhas,
          canvasCoordinates: [topo, base, direita],
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
    if (!viewport) return false;
    const circ = this.circuloCanvas(viewport, ann);
    if (!circ) return false;
    const d = Math.hypot(canvasCoords[0] - circ.cc[0], canvasCoords[1] - circ.cc[1]);
    return Math.abs(d - circ.r) <= proximity || d <= Math.min(proximity, circ.r);
  }
}
