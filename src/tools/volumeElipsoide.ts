/**
 * Volume elipsoide a partir de 3 medidas:
 *
 * 1. **Automático em 3D** (`iniciarVolumeElipsoideAuto`): detecta quando 3 medidas comuns
 *    (`Length` / `OrthogonalLengths`) estão no mesmo `FrameOfReferenceUID`, na mesma região 3D
 *    e com 1 eixo em plano ortogonal/oblíquo, exibindo `(Vol. XX,X mL)` entre parênteses em
 *    todos os planos que contêm as medidas. Pode ser ligado/desligado em Ajustes → Medidas.
 *
 * 2. **Ferramenta dedicada `EllipsoidVolumeTool`** (estilo ultrassom — 3 eixos): o usuário
 *    traça D1, D2 e D3 em qualquer combinação de cortes, planos ou séries (mesmo com
 *    `FrameOfReferenceUID` diferente, como RM em séries 2D separadas ou ultrassom). Ao fechar
 *    D3, todas as 3 medidas passam a exibir `(Vol. XX,X mL)` com recálculo ao vivo ao mover alças.
 */

import { eventTarget, getEnabledElement, type Types as CoreTypes } from '@cornerstonejs/core';
import {
  annotation as anotacoes,
  drawing,
  Enums as EnumsTools,
  LengthTool,
  type Types,
} from '@cornerstonejs/tools';
import { EVENTO_PREFERENCIAS, medidas } from '../state/preferencias';
import { distancia3, FerramentaMultiCliqueBase, type Ponto } from './desenhoMultiClique';
import { desenharTracinhos, redesenharTudo } from './estiloMedidas';
import { formatarComprimentoMm } from './formatoMedidas';
import { MedidasOrtogonaisTool } from './medidasAvancadas';
import {
  calcularVolumeElipsoideMl,
  detectarVolumesElipsoideAuto,
  formatarVolumeElipsoide,
  type ResultadoVolumeAuto,
  type SegmentoMedida3D,
} from './volumeElipsoideMath';

type Ponto2 = CoreTypes.Point2;

export const NOME_VOLUME_ELIPSOIDE = 'EllipsoidVolume';

// ============================================================================
// 1. Detecção automática 3D (Length + OrthogonalLengths)
// ============================================================================

let cachePorUid = new Map<string, ResultadoVolumeAuto>();
let cachePorDados = new WeakMap<object, ResultadoVolumeAuto>();
let ultimaAssinatura = '';
let autoIniciado = false;

function assinaturaMapa(mapa: Map<string, ResultadoVolumeAuto>): string {
  if (mapa.size === 0) return '';
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([uid, r]) => `${uid}:${r.volumeMl.toFixed(2)}`)
    .join('|');
}

function extrairSegmentosAuto(): { segmentos: SegmentoMedida3D[]; dadosPorUid: Map<string, object> } {
  const segmentos: SegmentoMedida3D[] = [];
  const dadosPorUid = new Map<string, object>();
  const todas = anotacoes.state.getAllAnnotations();

  for (const ann of todas) {
    if (!ann.annotationUID || ann.isVisible === false) continue;
    const nome = ann.metadata?.toolName;
    const forUid = ann.metadata?.FrameOfReferenceUID;
    if (!forUid) continue;
    const pts = ann.data?.handles?.points as Ponto[] | undefined;
    if (!pts) continue;

    if (nome === LengthTool.toolName && pts.length >= 2) {
      segmentos.push({
        annotationUID: ann.annotationUID,
        frameOfReferenceUid: forUid,
        a: pts[0]!,
        b: pts[1]!,
      });
      if (ann.data) dadosPorUid.set(ann.annotationUID, ann.data);
    } else if (nome === MedidasOrtogonaisTool.toolName && pts.length >= 4) {
      segmentos.push(
        {
          annotationUID: ann.annotationUID,
          frameOfReferenceUid: forUid,
          a: pts[0]!,
          b: pts[1]!,
          parId: ann.annotationUID,
        },
        {
          annotationUID: ann.annotationUID,
          frameOfReferenceUid: forUid,
          a: pts[2]!,
          b: pts[3]!,
          parId: ann.annotationUID,
        },
      );
      if (ann.data) dadosPorUid.set(ann.annotationUID, ann.data);
    }
  }
  return { segmentos, dadosPorUid };
}

/**
 * Recalcula o pareamento 3D automático de volumes elipsoides sobre todas as medidas abertas.
 * Se `redesenhar = true` e o resultado mudou, redesenha todos os viewports.
 */
export function recalcularVolumesElipsoideAuto(redesenhar = true): void {
  if (!medidas().volumeElipsoideAuto) {
    const tinha = cachePorUid.size > 0;
    cachePorUid = new Map();
    cachePorDados = new WeakMap();
    ultimaAssinatura = '';
    if (tinha && redesenhar) redesenharTudo();
    return;
  }

  const { segmentos, dadosPorUid } = extrairSegmentosAuto();
  const novoMapa = detectarVolumesElipsoideAuto(segmentos);
  const novaAssinatura = assinaturaMapa(novoMapa);

  cachePorUid = novoMapa;
  cachePorDados = new WeakMap();
  for (const [uid, res] of novoMapa) {
    const dados = dadosPorUid.get(uid);
    if (dados) cachePorDados.set(dados, res);
  }

  if (novaAssinatura !== ultimaAssinatura) {
    ultimaAssinatura = novaAssinatura;
    if (redesenhar) redesenharTudo();
  }
}

export function obterVolumeAutoPorUid(uid: string | undefined): ResultadoVolumeAuto | undefined {
  if (!uid || !medidas().volumeElipsoideAuto) return undefined;
  return cachePorUid.get(uid);
}

export function obterVolumeAutoPorDados(dados: object | undefined): ResultadoVolumeAuto | undefined {
  if (!dados || !medidas().volumeElipsoideAuto) return undefined;
  return cachePorDados.get(dados);
}

export function sufixoVolumeAutoPorUid(uid: string | undefined): string {
  const r = obterVolumeAutoPorUid(uid);
  return r ? ` (${formatarVolumeElipsoide(r.volumeMl, medidas().casasValores)})` : '';
}

export function sufixoVolumeAutoPorDados(dados: object | undefined): string {
  const r = obterVolumeAutoPorDados(dados);
  return r ? ` (${formatarVolumeElipsoide(r.volumeMl, medidas().casasValores)})` : '';
}

function aoEventoAnotacao(evt: Event): void {
  const nome = (evt as CustomEvent<{ annotation?: { metadata?: { toolName?: string } } }>).detail?.annotation?.metadata?.toolName;
  if (nome === NOME_VOLUME_ELIPSOIDE) {
    redesenharTudo();
    return;
  }
  if (!nome || nome === LengthTool.toolName || nome === MedidasOrtogonaisTool.toolName) {
    recalcularVolumesElipsoideAuto(true);
  }
}

/** Ativa a observação de medidas para o cálculo automático 3D e sincronização do volume elipsoide. */
export function iniciarVolumeElipsoideAuto(): void {
  if (autoIniciado) return;
  autoIniciado = true;
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_ADDED, aoEventoAnotacao);
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_MODIFIED, aoEventoAnotacao);
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_COMPLETED, aoEventoAnotacao);
  eventTarget.addEventListener(EnumsTools.Events.ANNOTATION_REMOVED, aoEventoAnotacao);
  document.addEventListener(EVENTO_PREFERENCIAS, () => recalcularVolumesElipsoideAuto(true));
}

// ============================================================================
// 2. Ferramenta dedicada: Volume elipsoide (3 eixos — estilo ultrassom)
// ============================================================================

interface DadosVolumeElipsoide {
  volumeGrupoId?: string;
  volumeEixo?: 1 | 2 | 3;
}

let seqGrupo = 0;
let grupoAtivoId: string | null = null;

function anotacoesDoGrupo(grupoId: string): Types.Annotation[] {
  return anotacoes.state
    .getAllAnnotations()
    .filter(
      (a) =>
        a.metadata?.toolName === NOME_VOLUME_ELIPSOIDE &&
        a.isVisible !== false &&
        (a.data as DadosVolumeElipsoide | undefined)?.volumeGrupoId === grupoId,
    )
    .sort((a, b) => {
      const ea = (a.data as DadosVolumeElipsoide).volumeEixo ?? 9;
      const eb = (b.data as DadosVolumeElipsoide).volumeEixo ?? 9;
      return ea - eb;
    });
}

function proximoEixoParaGrupo(): { grupoId: string; eixo: 1 | 2 | 3 } {
  if (grupoAtivoId) {
    const existentes = anotacoesDoGrupo(grupoAtivoId);
    const eixosUsados = new Set(existentes.map((a) => (a.data as DadosVolumeElipsoide).volumeEixo));
    if (existentes.length > 0 && existentes.length < 3) {
      const livre = ([1, 2, 3] as const).find((e) => !eixosUsados.has(e));
      if (livre) return { grupoId: grupoAtivoId, eixo: livre };
    }
  }
  grupoAtivoId = `elip-${++seqGrupo}`;
  return { grupoId: grupoAtivoId, eixo: 1 };
}

/** Verdadeiro quando a anotação `EllipsoidVolume` fechou os 3 eixos do grupo. */
export function volumeElipsoideGrupoConcluido(ann: Types.Annotation | undefined): boolean {
  const grupoId = (ann?.data as DadosVolumeElipsoide | undefined)?.volumeGrupoId;
  if (!grupoId) return true;
  return anotacoesDoGrupo(grupoId).length >= 3;
}

/** Cancela o grupo de 3 eixos em andamento (se tiver menos de 3 eixos) e remove suas medidas incompletas. */
export function cancelarGrupoVolumeEmAndamento(): boolean {
  if (!grupoAtivoId) return false;
  const existentes = anotacoesDoGrupo(grupoAtivoId);
  const id = grupoAtivoId;
  grupoAtivoId = null;
  if (existentes.length === 0 || existentes.length >= 3) return false;
  for (const a of existentes) {
    if (a.annotationUID) anotacoes.state.removeAnnotation(a.annotationUID);
  }
  if (id) redesenharTudo();
  return true;
}

function distanciaPontoSegmento2d(p: Ponto2, a: Ponto2, b: Ponto2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const q = dx * dx + dy * dy;
  const t = q === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / q));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export class EllipsoidVolumeTool extends FerramentaMultiCliqueBase {
  static override toolName = NOME_VOLUME_ELIPSOIDE;
  protected readonly inicioDeSegmento = [true, false] as const;

  protected override aoCriarAnotacao(ann: Types.Annotation): void {
    const { grupoId, eixo } = proximoEixoParaGrupo();
    const dados = ann.data as DadosVolumeElipsoide;
    dados.volumeGrupoId = grupoId;
    dados.volumeEixo = eixo;
    if (eixo === 3) {
      // Ao iniciar o 3º eixo, o próximo trio começará um novo grupo
      grupoAtivoId = null;
    }
  }

  protected override renderizar(): void {
    // Redesenha todos os viewports para que D1/D2 em outro plano atualizem o volume ao vivo durante D3
    redesenharTudo();
  }

  override renderAnnotation(
    enabledElement: CoreTypes.IEnabledElement,
    svgDrawingHelper: Types.SVGDrawingHelper,
  ): boolean {
    const { viewport } = enabledElement;
    const { element } = viewport;
    let anns = anotacoes.state.getAnnotations(NOME_VOLUME_ELIPSOIDE, element);
    if (!anns?.length) return false;
    anns = this.filterInteractableAnnotationsForElement(element, anns);
    let desenhou = false;
    const prefs = medidas();

    for (const ann of anns) {
      const pontos = ann.data.handles?.points as Ponto[] | undefined;
      if (!pontos || pontos.length < 2 || !ann.annotationUID) continue;
      const uid = ann.annotationUID;
      const estiloSpec = {
        toolGroupId: this.toolGroupId!,
        toolName: NOME_VOLUME_ELIPSOIDE,
        viewportId: viewport.id,
        annotationUID: uid,
      };
      const estilo = this.getAnnotationStyle({ annotation: ann, styleSpecifier: estiloSpec as never });
      const cor = (estilo.color as string) || '#a78bfa';
      const largura = Number(estilo.lineWidth) || prefs.espessura;

      const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
      const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
      drawing.drawLine(svgDrawingHelper, uid, 'eixo', c0, c1, { color: cor, width: largura });
      if (prefs.tracinhos) desenharTracinhos(svgDrawingHelper, uid, 'tr', c0, c1, cor, largura);
      desenhou = true;

      const comp = distancia3(pontos[0]!, pontos[1]!);
      if (comp < 0.5) continue;

      const dados = ann.data as DadosVolumeElipsoide;
      const eixo = dados.volumeEixo ?? 1;
      const grupoId = dados.volumeGrupoId;
      const textoComp = `D${eixo}: ${formatarComprimentoMm(comp, prefs)}`;

      let linha = textoComp;
      if (grupoId) {
        const membros = anotacoesDoGrupo(grupoId);
        const comprimentos = membros
          .map((m) => {
            const p = m.data.handles?.points as Ponto[] | undefined;
            return p && p.length >= 2 ? distancia3(p[0]!, p[1]!) : 0;
          })
          .filter((d) => d >= 0.5);

        if (comprimentos.length >= 3) {
          const vol = calcularVolumeElipsoideMl(comprimentos[0]!, comprimentos[1]!, comprimentos[2]!);
          linha = `${textoComp} (${formatarVolumeElipsoide(vol, prefs.casasValores)})`;
        } else if (grupoAtivoId === grupoId) {
          const ultimo = membros[membros.length - 1];
          if (ultimo?.annotationUID === uid) {
            linha =
              membros.length === 1
                ? `${textoComp} (trace D2)`
                : `${textoComp} (trace D3 no plano ortogonal)`;
          }
        }
      }

      this.renderLinkedTextBoxAnnotation({
        enabledElement,
        svgDrawingHelper,
        annotation: ann,
        styleSpecifier: estiloSpec as never,
        textLines: [linha],
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
    const pontos = ann.data.handles?.points as Ponto[] | undefined;
    if (!pontos || pontos.length < 2) return false;
    const c0 = viewport.worldToCanvas(pontos[0]!) as Ponto2;
    const c1 = viewport.worldToCanvas(pontos[1]!) as Ponto2;
    return distanciaPontoSegmento2d(canvasCoords, c0, c1) <= proximity;
  }
}
