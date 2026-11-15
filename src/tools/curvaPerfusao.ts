/**
 * Curva Tempo-Intensidade / Perfusão (`Ctrl+Shift+E` ou menu Medidas/Avançado):
 * - Mantém a(s) ROI(s) desenhada(s) no viewport ativo (`ROI elíptica` ou `ROI à mão livre`,
 *   ou uma ROI circular padrão no ponto do localizador `┼` / centro da imagem) na mesma
 *   posição espacial e mede a densidade/intensidade (Média, DP, Mín, Máx) ao longo:
 *   1. De todos os quadros/cortes da série ativa (`serie-ativa`), ou
 *   2. De todas as fases/séries do estudo na mesma posição anatômica (`fases-estudo`).
 * - Exibe um gráfico interativo em `<canvas>` com resumo hemodinâmico (Pico, TTP, Δ Máx),
 *   inspeção por mouse, clique para ir ao quadro/corte correspondente e exportação em CSV.
 */

import { getEnabledElement, imageLoader, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  annotation,
  EllipticalROITool,
  PlanarFreehandROITool,
  utilities as utilitariosTools,
} from '@cornerstonejs/tools';
import { pilhasExibicaoDaSerie } from '../compare/segundaJanelaLogica';
import { parseTM } from '../io/dicomTime';
import type { SeriesNode, StackNode } from '../io/organize';
import type { InstanceMeta } from '../io/types';
import { estado } from '../state/store';

type AnotacaoCornerstone = ReturnType<typeof annotation.state.getAnnotations>[number];

type Ponto2 = [number, number];
type Ponto3 = [number, number, number];

export type ModoCurvaPerfusao = 'serie-ativa' | 'fases-estudo' | 'cortes-pilha';

export interface PontoCurva {
  indice: number;
  rotuloX: string;
  valorX: number;
  unidadeX: 'quadro' | 's';
  media: number;
  dp: number;
  min: number;
  max: number;
  contagemPixels: number;
  instancia: InstanceMeta;
  pilha: StackNode;
  indiceNaPilha: number;
}

export interface SerieCurvaRoi {
  id: string;
  nome: string;
  cor: string;
  pontos: PontoCurva[];
  pico: number;
  indicePico: number;
  rotuloPico: string;
  amplitude: number;
}

interface RoiEmPixels {
  id: string;
  nome: string;
  cor: string;
  tipo: 'elipse' | 'poligono';
  /** Referência à anotação Cornerstone mestre na imagem. */
  anotacaoRef?: AnotacaoCornerstone;
  /** Réplicas criadas automaticamente nas outras fases da perfusão. */
  replicasRef?: AnotacaoCornerstone[];
  /** Pontos 3D do mundo (4 alças na elipse ou vértices da polilinha). */
  pontosMundo: Ponto3[];
  /** Centro e semi-eixos em coordenadas normalizadas [0..1] da imagem de referência. */
  centroNorm: Ponto2;
  eixoANorm: Ponto2;
  eixoBNorm: Ponto2;
  /** Polígono em coordenadas normalizadas [0..1] da imagem de referência. */
  poligonoNorm: Ponto2[];
}

const CORES_ROIS = ['#38bdf8', '#f87171', '#4ade80', '#fbbf24', '#c084fc', '#fb923c'];

function aplicarEstiloRoiNoViewport(
  anotacao: AnotacaoCornerstone | undefined,
  cor: string,
  destacada: boolean,
): void {
  const uid = anotacao?.annotationUID;
  if (!uid) return;
  annotation.config.style.setAnnotationStyles(uid, {
    color: cor,
    colorHighlighted: '#ffffff',
    colorSelected: cor,
    textBoxColor: cor,
    textBoxColorHighlighted: '#ffffff',
    textBoxColorSelected: cor,
    textBoxLinkLineColor: cor,
    textBoxLinkLineColorHighlighted: '#ffffff',
    textBoxLinkLineColorSelected: cor,
    lineWidth: destacada ? '4' : '1.8',
  });
}

type DadosReplicaRoi = {
  label?: string;
  replicaDeRoiUid?: string;
  assinaturaSincronizada?: string;
  cachedStats?: Record<string, unknown>;
  handles?: {
    points?: Ponto3[];
    activeHandleIndex?: number | null;
    textBox?: Record<string, unknown>;
  };
  contour?: {
    polyline?: Ponto3[];
    closed?: boolean;
  };
};

function idsDosViewportsAtivos(fallbackId?: string): string[] {
  const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-viewport-uid]'))
    .map((e) => e.getAttribute('data-viewport-uid'))
    .filter((v): v is string => !!v);
  if (fallbackId && !ids.includes(fallbackId)) ids.push(fallbackId);
  return ids;
}

const cacheImageIdsTemporarios = new Map<string, string>();

export type ObterImageIdDoQuadroFn = (
  pilha: StackNode,
  indiceCorte: number,
  instancia: InstanceMeta,
) => string | null;

function obterImageIdParaQuadro(
  pilha: StackNode,
  indiceCorte: number,
  inst: InstanceMeta,
  arquivos: Map<string, File>,
  obterImageIdDoQuadro?: ObterImageIdDoQuadroFn,
): string | null {
  if (obterImageIdDoQuadro) {
    const idSlot = obterImageIdDoQuadro(pilha, indiceCorte, inst);
    if (idSlot) return idSlot;
  }
  const jaRegistrado = cacheImageIdsTemporarios.get(inst.fileId);
  if (jaRegistrado) return jaRegistrado;
  const arq = arquivos.get(inst.fileId);
  if (!arq) return null;
  const id = wadouri.fileManager.add(arq);
  cacheImageIdsTemporarios.set(inst.fileId, id);
  return id;
}

function normalUnitariaDaInstancia(inst: InstanceMeta | undefined): Ponto3 | null {
  const iop = inst?.imageOrientationPatient;
  if (!iop || iop.length < 6) return null;
  const nx = iop[1]! * iop[5]! - iop[2]! * iop[4]!;
  const ny = iop[2]! * iop[3]! - iop[0]! * iop[5]!;
  const nz = iop[0]! * iop[4]! - iop[1]! * iop[3]!;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) return null;
  return [nx / len, ny / len, nz / len];
}

function coordenadaNormalDoPonto(ponto: Ponto3, instRef: InstanceMeta | undefined): number | undefined {
  const n = normalUnitariaDaInstancia(instRef);
  if (n) {
    return ponto[0] * n[0] + ponto[1] * n[1] + ponto[2] * n[2];
  }
  return ponto[2];
}

/**
 * Projeta um ponto 3D do mundo `(x, y, z)` sobre o plano da fatia `instAlvo`, preservando
 * exatamente a posição anatômica no plano quando há pequeno deslocamento axial entre fases.
 */
function projetarPontoNoPlanoDaInstancia(ponto: Ponto3, instAlvo: InstanceMeta | undefined): Ponto3 {
  const pos = instAlvo?.imagePositionPatient;
  const n = normalUnitariaDaInstancia(instAlvo);
  if (!pos || !n) return [ponto[0], ponto[1], ponto[2]];
  const dist = (ponto[0] - pos[0]) * n[0] + (ponto[1] - pos[1]) * n[1] + (ponto[2] - pos[2]) * n[2];
  return [ponto[0] - dist * n[0], ponto[1] - dist * n[1], ponto[2] - dist * n[2]];
}

function assinaturaPontosMundo(pontos: Ponto3[] | undefined): string {
  if (!pontos || pontos.length === 0) return '';
  const passo = Math.max(1, Math.floor(pontos.length / 8));
  const partes: string[] = [`n=${pontos.length}`];
  for (let i = 0; i < pontos.length; i += passo) {
    const p = pontos[i]!;
    partes.push(`${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)}`);
  }
  return partes.join(';');
}

/**
 * Converte um ponto 3D do mundo `(x, y, z)` para coordenadas normalizadas `(uNorm, vNorm)` em `[0..1]`
 * sobre a fatia `instRef`, ou usa `worldToCanvas` do viewport como fallback.
 */
function mundoParaNormalizadoNaFatia(
  pontoMundo: Ponto3,
  instRef: InstanceMeta | undefined,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
): Ponto2 {
  if (
    instRef?.imagePositionPatient &&
    instRef.imageOrientationPatient &&
    instRef.imageOrientationPatient.length >= 6 &&
    instRef.pixelSpacing &&
    instRef.columns &&
    instRef.rows
  ) {
    const pos = instRef.imagePositionPatient;
    const iop = instRef.imageOrientationPatient;
    const [rowSpacing, colSpacing] = instRef.pixelSpacing;
    const dx = pontoMundo[0] - pos[0];
    const dy = pontoMundo[1] - pos[1];
    const dz = pontoMundo[2] - pos[2];
    const col = (dx * iop[0]! + dy * iop[1]! + dz * iop[2]!) / (colSpacing || 1);
    const row = (dx * iop[3]! + dy * iop[4]! + dz * iop[5]!) / (rowSpacing || 1);
    return [col / instRef.columns, row / instRef.rows];
  }

  // Fallback via canvas do viewport:
  const c = viewport.worldToCanvas(pontoMundo);
  const el = viewport.element;
  const w = Math.max(1, el.clientWidth);
  const h = Math.max(1, el.clientHeight);
  return [c[0] / w, c[1] / h];
}

function normalizadoParaMundoNaFatia(
  uNorm: number,
  vNorm: number,
  instRef: InstanceMeta | undefined,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
): Ponto3 {
  if (
    instRef?.imagePositionPatient &&
    instRef.imageOrientationPatient &&
    instRef.imageOrientationPatient.length >= 6 &&
    instRef.pixelSpacing &&
    instRef.columns &&
    instRef.rows
  ) {
    const pos = instRef.imagePositionPatient;
    const iop = instRef.imageOrientationPatient;
    const [rowSpacing, colSpacing] = instRef.pixelSpacing;
    const colMm = uNorm * instRef.columns * (colSpacing || 1);
    const rowMm = vNorm * instRef.rows * (rowSpacing || 1);
    return [
      pos[0] + colMm * iop[0]! + rowMm * iop[3]!,
      pos[1] + colMm * iop[1]! + rowMm * iop[4]!,
      pos[2] + colMm * iop[2]! + rowMm * iop[5]!,
    ];
  }
  const el = viewport.element;
  const w = Math.max(1, el.clientWidth);
  const h = Math.max(1, el.clientHeight);
  const m = viewport.canvasToWorld([uNorm * w, vNorm * h]);
  return [m[0], m[1], m[2]];
}

/**
 * Se o usuário moveu ou redimensionou uma réplica da ROI em outra fase (na imagem atualmente
 * aberta no viewport), copia a nova posição de volta para a ROI mestre antes de extrair/recalcular.
 * Também remove réplicas órfãs caso a ROI mestre tenha sido apagada.
 */
function sincronizarEdicoesDeReplicasParaMestre(
  elemento: HTMLDivElement,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
): void {
  const imageIdAtual =
    'getCurrentImageId' in viewport && typeof viewport.getCurrentImageId === 'function'
      ? viewport.getCurrentImageId()
      : undefined;

  for (const toolName of [EllipticalROITool.toolName, PlanarFreehandROITool.toolName]) {
    const todas = [...(annotation.state.getAnnotations(toolName, elemento) ?? [])];
    const mestresPorUid = new Map<string, AnotacaoCornerstone>();
    for (const ann of todas) {
      const dados = ann.data as DadosReplicaRoi | undefined;
      if (!dados?.replicaDeRoiUid && ann.annotationUID) {
        mestresPorUid.set(ann.annotationUID, ann);
      }
    }

    for (const ann of todas) {
      const dados = ann.data as DadosReplicaRoi | undefined;
      const idMestre = dados?.replicaDeRoiUid;
      if (!idMestre) continue;
      const mestre = mestresPorUid.get(idMestre);
      if (!mestre) {
        if (ann.annotationUID) annotation.state.removeAnnotation(ann.annotationUID);
        continue;
      }

      if (imageIdAtual && ann.metadata?.referencedImageId === imageIdAtual) {
        const ptsRep =
          toolName === EllipticalROITool.toolName
            ? dados.handles?.points
            : (dados.contour?.polyline ?? dados.handles?.points);
        const assAtual = assinaturaPontosMundo(ptsRep);
        if (assAtual && dados.assinaturaSincronizada && assAtual !== dados.assinaturaSincronizada) {
          const dadosMestre = mestre.data as DadosReplicaRoi | undefined;
          if (dadosMestre && ptsRep) {
            if (toolName === EllipticalROITool.toolName && dadosMestre.handles) {
              dadosMestre.handles.points = ptsRep.map((p) => [...p] as Ponto3);
            } else if (dadosMestre.contour) {
              dadosMestre.contour.polyline = ptsRep.map((p) => [...p] as Ponto3);
            }
            mestre.invalidated = true;
            dadosMestre.cachedStats = {};
          }
          dados.assinaturaSincronizada = assAtual;
        }
      }
    }
  }
}

/**
 * Extrai as ROIs desenhadas (`EllipticalROI` e `PlanarFreehandROI`) no nível anatômico atual.
 * Ignora réplicas automáticas das outras fases, ROIs de outros níveis de corte e cliques degenerados.
 * Se não houver nenhuma ROI no nível atual, cria uma ROI circular no ponto `pontoPadraoMundo` (ou centro).
 */
function extrairRoisNormalizadas(
  elemento: HTMLDivElement,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
  instRef: InstanceMeta | undefined,
  pontoPadraoMundo?: Ponto3 | null,
): { rois: RoiEmPixels[]; usouRoiAutomatica: boolean } {
  sincronizarEdicoesDeReplicasParaMestre(elemento, viewport);

  const rois: RoiEmPixels[] = [];
  let idxCor = 0;
  const imageIdAtual =
    'getCurrentImageId' in viewport && typeof viewport.getCurrentImageId === 'function'
      ? viewport.getCurrentImageId()
      : undefined;
  const coordRef = instRef ? coordenadaNormalDaInstancia(instRef) : undefined;
  const espessuraRef = instRef?.sliceThickness ?? instRef?.spacingBetweenSlices ?? 1.5;
  const toleranciaNivelMm = Math.max(2.5, espessuraRef * 1.25);
  const colsRef = instRef?.columns ?? 512;
  const rowsRef = instRef?.rows ?? 512;

  const annsElipse = [...(annotation.state.getAnnotations(EllipticalROITool.toolName, elemento) ?? [])];
  for (const ann of annsElipse) {
    const dados = ann.data as DadosReplicaRoi | undefined;
    if (dados?.replicaDeRoiUid) continue;
    const pts = dados?.handles?.points;
    if (!pts || pts.length < 4) continue;

    // Filtra ROIs desenhadas em outros cortes anatômicos do exame:
    if (coordRef !== undefined && ann.metadata?.referencedImageId !== imageIdAtual) {
      const coordAnn = coordenadaNormalDoPonto(pts[0]!, instRef);
      if (coordAnn !== undefined && Math.abs(coordAnn - coordRef) > toleranciaNivelMm) {
        continue;
      }
    }

    const n0 = mundoParaNormalizadoNaFatia(pts[0]!, instRef, viewport);
    const n1 = mundoParaNormalizadoNaFatia(pts[1]!, instRef, viewport);
    const n2 = mundoParaNormalizadoNaFatia(pts[2]!, instRef, viewport);
    const n3 = mundoParaNormalizadoNaFatia(pts[3]!, instRef, viewport);
    const centroNorm: Ponto2 = [
      (n0[0] + n1[0] + n2[0] + n3[0]) / 4,
      (n0[1] + n1[1] + n2[1] + n3[1]) / 4,
    ];
    const eixoANorm: Ponto2 = [(n1[0] - n0[0]) / 2, (n1[1] - n0[1]) / 2];
    const eixoBNorm: Ponto2 = [(n3[0] - n2[0]) / 2, (n3[1] - n2[1]) / 2];

    // Descarta cliques acidentais minúsculos (< 1.5 px de raio):
    const raioAPx = Math.hypot(eixoANorm[0] * colsRef, eixoANorm[1] * rowsRef);
    const raioBPx = Math.hypot(eixoBNorm[0] * colsRef, eixoBNorm[1] * rowsRef);
    if (raioAPx < 1.5 || raioBPx < 1.5) {
      if (ann.annotationUID) annotation.state.removeAnnotation(ann.annotationUID);
      continue;
    }

    // Se já houver uma ROI praticamente idêntica na mesma posição (ex.: desenhada em outra fase),
    // converte-a em réplica da primeira para não duplicar a curva:
    const duplicada = rois.find(
      (r) =>
        r.tipo === 'elipse' &&
        Math.hypot(r.centroNorm[0] - centroNorm[0], r.centroNorm[1] - centroNorm[1]) < 0.015 &&
        Math.hypot(r.eixoANorm[0] - eixoANorm[0], r.eixoANorm[1] - eixoANorm[1]) < 0.015,
    );
    if (duplicada && dados) {
      dados.replicaDeRoiUid = duplicada.id;
      continue;
    }

    const cor = CORES_ROIS[idxCor % CORES_ROIS.length]!;
    idxCor++;
    const labelAtual = typeof dados?.label === 'string' ? dados.label.trim() : '';
    const nome = labelAtual || `ROI ${idxCor}`;
    if (!labelAtual && dados) {
      dados.label = nome;
    }
    aplicarEstiloRoiNoViewport(ann, cor, false);
    rois.push({
      id: ann.annotationUID ?? `roi-${idxCor}`,
      nome,
      cor,
      tipo: 'elipse',
      anotacaoRef: ann,
      replicasRef: [],
      pontosMundo: pts.slice(0, 4).map((p) => [...p] as Ponto3),
      centroNorm,
      eixoANorm,
      eixoBNorm,
      poligonoNorm: [],
    });
  }

  const annsFreehand = [...(annotation.state.getAnnotations(PlanarFreehandROITool.toolName, elemento) ?? [])];
  for (const ann of annsFreehand) {
    const dados = ann.data as DadosReplicaRoi | undefined;
    if (dados?.replicaDeRoiUid) continue;
    const polyline = dados?.contour?.polyline ?? dados?.handles?.points;
    if (!polyline || polyline.length < 3) continue;

    if (coordRef !== undefined && ann.metadata?.referencedImageId !== imageIdAtual) {
      const coordAnn = coordenadaNormalDoPonto(polyline[0]!, instRef);
      if (coordAnn !== undefined && Math.abs(coordAnn - coordRef) > toleranciaNivelMm) {
        continue;
      }
    }

    // Subamostra se tiver muitos vértices para acelerar o teste ponto-no-polígono
    const passo = Math.max(1, Math.floor(polyline.length / 80));
    const poligonoNorm: Ponto2[] = [];
    for (let i = 0; i < polyline.length; i += passo) {
      poligonoNorm.push(mundoParaNormalizadoNaFatia(polyline[i]!, instRef, viewport));
    }
    if (poligonoNorm.length < 3) continue;
    const cor = CORES_ROIS[idxCor % CORES_ROIS.length]!;
    idxCor++;
    const labelAtual = typeof dados?.label === 'string' ? dados.label.trim() : '';
    const nome = labelAtual || `ROI ${idxCor}`;
    if (!labelAtual && dados) {
      dados.label = nome;
    }
    aplicarEstiloRoiNoViewport(ann, cor, false);
    rois.push({
      id: ann.annotationUID ?? `roi-${idxCor}`,
      nome,
      cor,
      tipo: 'poligono',
      anotacaoRef: ann,
      replicasRef: [],
      pontosMundo: polyline.map((p) => [...p] as Ponto3),
      centroNorm: [0.5, 0.5],
      eixoANorm: [0.05, 0],
      eixoBNorm: [0, 0.05],
      poligonoNorm,
    });
  }

  if (rois.length > 0) {
    utilitariosTools.triggerAnnotationRenderForViewportIds(idsDosViewportsAtivos(viewport.id));
    return { rois, usouRoiAutomatica: false };
  }

  // Fallback: cria uma ROI circular real no viewport (e nas demais fases) no ponto do localizador `┼` ou no centro
  let centroNorm: Ponto2 = [0.5, 0.5];
  if (pontoPadraoMundo) {
    const n = mundoParaNormalizadoNaFatia(pontoPadraoMundo, instRef, viewport);
    if (n[0] >= 0.02 && n[0] <= 0.98 && n[1] >= 0.02 && n[1] <= 0.98) {
      centroNorm = n;
    }
  }
  const raioNorm = 0.045;
  const pBottom = normalizadoParaMundoNaFatia(centroNorm[0], centroNorm[1] - raioNorm, instRef, viewport);
  const pTop = normalizadoParaMundoNaFatia(centroNorm[0], centroNorm[1] + raioNorm, instRef, viewport);
  const pLeft = normalizadoParaMundoNaFatia(centroNorm[0] - raioNorm, centroNorm[1], instRef, viewport);
  const pRight = normalizadoParaMundoNaFatia(centroNorm[0] + raioNorm, centroNorm[1], instRef, viewport);
  const pontosMundoAuto: Ponto3[] = [pBottom, pTop, pLeft, pRight];

  let anotacaoAuto: AnotacaoCornerstone | undefined;
  if (imageIdAtual) {
    const viewRef =
      'getViewReference' in viewport && typeof viewport.getViewReference === 'function'
        ? (viewport.getViewReference() as Record<string, unknown> | undefined)
        : {};
    const uidAuto = `roi-auto-${Date.now()}`;
    const novaAnn = {
      annotationUID: uidAuto,
      highlighted: false,
      invalidated: true,
      isLocked: false,
      isVisible: true,
      metadata: {
        ...(viewRef ?? {}),
        toolName: EllipticalROITool.toolName,
        referencedImageId: imageIdAtual,
      },
      data: {
        label: 'ROI 1',
        cachedStats: {},
        handles: {
          points: pontosMundoAuto.map((p) => [...p] as Ponto3),
          activeHandleIndex: null,
          textBox: {
            hasMoved: false,
            worldPosition: [0, 0, 0] as Ponto3,
            worldBoundingBox: {
              topLeft: [0, 0, 0] as Ponto3,
              topRight: [0, 0, 0] as Ponto3,
              bottomLeft: [0, 0, 0] as Ponto3,
              bottomRight: [0, 0, 0] as Ponto3,
            },
          },
        },
      },
    };
    annotation.state.addAnnotation(novaAnn as never, elemento);
    anotacaoAuto = novaAnn as unknown as AnotacaoCornerstone;
    aplicarEstiloRoiNoViewport(anotacaoAuto, CORES_ROIS[0]!, false);
    utilitariosTools.triggerAnnotationRenderForViewportIds(idsDosViewportsAtivos(viewport.id));
  }

  return {
    rois: [
      {
        id: anotacaoAuto?.annotationUID ?? 'roi-padrao',
        nome: 'ROI 1',
        cor: CORES_ROIS[0]!,
        tipo: 'elipse',
        ...(anotacaoAuto ? { anotacaoRef: anotacaoAuto } : {}),
        replicasRef: [],
        pontosMundo: pontosMundoAuto,
        centroNorm,
        eixoANorm: [0, raioNorm],
        eixoBNorm: [raioNorm, 0],
        poligonoNorm: [],
      },
    ],
    usouRoiAutomatica: true,
  };
}

function pontoDentroDoPoligono(x: number, y: number, poligono: Ponto2[]): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const xi = poligono[i]![0];
    const yi = poligono[i]![1];
    const xj = poligono[j]![0];
    const yj = poligono[j]![1];
    const intersecta = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersecta) dentro = !dentro;
  }
  return dentro;
}

/**
 * Mede Média, DP, Mín e Máx dos pixels dentro de `roi` numa imagem já carregada pelo Cornerstone,
 * projetando as coordenadas 3D da ROI diretamente sobre a geometria da fatia `instanciaAlvo`.
 */
function medirRoiNaImagem(
  roi: RoiEmPixels,
  instanciaAlvo: InstanceMeta | undefined,
  viewport: Types.IStackViewport | Types.IVolumeViewport | undefined,
  pixels: ArrayLike<number>,
  largura: number,
  altura: number,
  slope: number,
  intercept: number,
): { media: number; dp: number; min: number; max: number; contagem: number } | null {
  if (largura <= 0 || altura <= 0 || pixels.length < largura * altura) return null;

  let minX = 0;
  let maxX = largura - 1;
  let minY = 0;
  let maxY = altura - 1;

  const indicesDentro: number[] = [];

  if (roi.tipo === 'elipse') {
    let centroNorm = roi.centroNorm;
    let eixoANorm = roi.eixoANorm;
    let eixoBNorm = roi.eixoBNorm;
    if (roi.pontosMundo.length >= 4 && instanciaAlvo && viewport) {
      const n0 = mundoParaNormalizadoNaFatia(roi.pontosMundo[0]!, instanciaAlvo, viewport);
      const n1 = mundoParaNormalizadoNaFatia(roi.pontosMundo[1]!, instanciaAlvo, viewport);
      const n2 = mundoParaNormalizadoNaFatia(roi.pontosMundo[2]!, instanciaAlvo, viewport);
      const n3 = mundoParaNormalizadoNaFatia(roi.pontosMundo[3]!, instanciaAlvo, viewport);
      centroNorm = [(n0[0] + n1[0] + n2[0] + n3[0]) / 4, (n0[1] + n1[1] + n2[1] + n3[1]) / 4];
      eixoANorm = [(n1[0] - n0[0]) / 2, (n1[1] - n0[1]) / 2];
      eixoBNorm = [(n3[0] - n2[0]) / 2, (n3[1] - n2[1]) / 2];
    }

    const cx = centroNorm[0] * largura;
    const cy = centroNorm[1] * altura;
    const ax = eixoANorm[0] * largura;
    const ay = eixoANorm[1] * altura;
    const bx = eixoBNorm[0] * largura;
    const by = eixoBNorm[1] * altura;
    const normA2 = ax * ax + ay * ay;
    const normB2 = bx * bx + by * by;
    if (normA2 < 1e-6 || normB2 < 1e-6) return null;

    const raioMax = Math.ceil(Math.max(Math.sqrt(normA2), Math.sqrt(normB2))) + 1;
    minX = Math.max(0, Math.floor(cx - raioMax));
    maxX = Math.min(largura - 1, Math.ceil(cx + raioMax));
    minY = Math.max(0, Math.floor(cy - raioMax));
    maxY = Math.min(altura - 1, Math.ceil(cy + raioMax));

    for (let r = minY; r <= maxY; r++) {
      const dy = r - cy;
      for (let c = minX; c <= maxX; c++) {
        const dx = c - cx;
        const projA = (dx * ax + dy * ay) / normA2;
        const projB = (dx * bx + dy * by) / normB2;
        if (projA * projA + projB * projB <= 1) {
          indicesDentro.push(r * largura + c);
        }
      }
    }
  } else {
    let poligonoNorm = roi.poligonoNorm;
    if (roi.pontosMundo.length >= 3 && instanciaAlvo && viewport) {
      const passo = Math.max(1, Math.floor(roi.pontosMundo.length / 80));
      poligonoNorm = [];
      for (let i = 0; i < roi.pontosMundo.length; i += passo) {
        poligonoNorm.push(mundoParaNormalizadoNaFatia(roi.pontosMundo[i]!, instanciaAlvo, viewport));
      }
    }
    const polyPx: Ponto2[] = poligonoNorm.map((p) => [p[0] * largura, p[1] * altura]);
    let pMinX = Infinity;
    let pMaxX = -Infinity;
    let pMinY = Infinity;
    let pMaxY = -Infinity;
    for (const [px, py] of polyPx) {
      if (px < pMinX) pMinX = px;
      if (px > pMaxX) pMaxX = px;
      if (py < pMinY) pMinY = py;
      if (py > pMaxY) pMaxY = py;
    }
    minX = Math.max(0, Math.floor(pMinX));
    maxX = Math.min(largura - 1, Math.ceil(pMaxX));
    minY = Math.max(0, Math.floor(pMinY));
    maxY = Math.min(altura - 1, Math.ceil(pMaxY));

    for (let r = minY; r <= maxY; r++) {
      for (let c = minX; c <= maxX; c++) {
        if (pontoDentroDoPoligono(c, r, polyPx)) {
          indicesDentro.push(r * largura + c);
        }
      }
    }
  }

  if (indicesDentro.length === 0) return null;

  let soma = 0;
  let min = Infinity;
  let max = -Infinity;
  const n = indicesDentro.length;
  for (let i = 0; i < n; i++) {
    const v = Number(pixels[indicesDentro[i]!]) * slope + intercept;
    soma += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const media = soma / n;

  let somaQuad = 0;
  for (let i = 0; i < n; i++) {
    const v = Number(pixels[indicesDentro[i]!]) * slope + intercept;
    const d = v - media;
    somaQuad += d * d;
  }
  const dp = Math.sqrt(somaQuad / n);
  return { media, dp, min, max, contagem: n };
}

function coordenadaNormalDaInstancia(inst: InstanceMeta): number | undefined {
  const pos = inst.imagePositionPatient;
  const n = normalUnitariaDaInstancia(inst);
  if (pos && n) {
    return pos[0] * n[0] + pos[1] * n[1] + pos[2] * n[2];
  }
  if (pos) return pos[2];
  return inst.sliceLocation;
}

function mesmaOrientacaoDeFatia(a: InstanceMeta | undefined, b: InstanceMeta | undefined): boolean {
  const iopA = a?.imageOrientationPatient;
  const iopB = b?.imageOrientationPatient;
  if (!iopA || !iopB || iopA.length < 6 || iopB.length < 6) return true;
  const dotRow = iopA[0]! * iopB[0]! + iopA[1]! * iopB[1]! + iopA[2]! * iopB[2]!;
  const dotCol = iopA[3]! * iopB[3]! + iopA[4]! * iopB[4]! + iopA[5]! * iopB[5]!;
  return dotRow >= 0.94 && dotCol >= 0.94;
}

function ehSerieNaoPerfusao(serie: SeriesNode, inst: InstanceMeta): boolean {
  const desc = `${serie.description ?? ''} ${(inst.imageType ?? []).join(' ')}`;
  return /\b(sub|subtr|subtracao|subtraç|mip|minip|proj|projection|adc|dwi|diff|difus|trace|t2|stir|flair|localizer|scout|survey|calibr)\b/i.test(
    desc,
  );
}

function segundosDoHorarioDicom(inst: InstanceMeta): number | undefined {
  const ms = parseTM(inst.acquisitionTime ?? inst.contentTime);
  if (ms === undefined) return undefined;
  return ms / 1000;
}

interface QuadroAlvo {
  instancia: InstanceMeta;
  pilha: StackNode;
  indiceNaPilha: number;
  tempoSegundos?: number;
  ordemFase?: number;
  ordemSerie?: number;
  rotuloCurto: string;
}

function ordenarQuadrosCronologicamente(quadros: QuadroAlvo[]): QuadroAlvo[] {
  return [...quadros].sort((a, b) => {
    const tpA = a.instancia.temporalPositionIdentifier;
    const tpB = b.instancia.temporalPositionIdentifier;
    if (tpA !== undefined && tpB !== undefined && tpA !== tpB) return tpA - tpB;

    if (
      a.tempoSegundos !== undefined &&
      b.tempoSegundos !== undefined &&
      Math.abs(a.tempoSegundos - b.tempoSegundos) > 0.2
    ) {
      return a.tempoSegundos - b.tempoSegundos;
    }

    if (a.ordemSerie !== undefined && b.ordemSerie !== undefined && a.ordemSerie !== b.ordemSerie) {
      return a.ordemSerie - b.ordemSerie;
    }

    const acqA = a.instancia.acquisitionNumber;
    const acqB = b.instancia.acquisitionNumber;
    if (acqA !== undefined && acqB !== undefined && acqA !== acqB) return acqA - acqB;

    if (a.ordemFase !== undefined && b.ordemFase !== undefined && a.ordemFase !== b.ordemFase) {
      return a.ordemFase - b.ordemFase;
    }

    return (a.instancia.instanceNumber ?? a.indiceNaPilha) - (b.instancia.instanceNumber ?? b.indiceNaPilha);
  });
}

function encontrarSerieDaInstancia(instRef: InstanceMeta): SeriesNode | undefined {
  const index = estado.resultado?.index;
  if (!index) return undefined;
  for (const p of index.patients) {
    for (const est of p.studies) {
      if (est.studyInstanceUid !== instRef.studyInstanceUid) continue;
      for (const s of est.series) {
        if (s.seriesInstanceUid === instRef.seriesInstanceUid) return s;
      }
    }
  }
  return undefined;
}

/**
 * Coleta as fases na mesma posição anatômica `coordRef` dentro da própria `serieAtiva`
 * (ex.: série dinâmica com 4 fases divididas em `serieAtiva.stacks` e unificadas em `pilhaAtiva`).
 * Garante exatamente 1 corte por fase (nunca cortes vizinhos da mesma fase).
 */
function coletarFasesDaMesmaSerie(
  pilhaAtiva: StackNode,
  instRef: InstanceMeta,
  coordRef: number,
): QuadroAlvo[] {
  const serieAtiva = encontrarSerieDaInstancia(instRef);
  const espessura = instRef.sliceThickness ?? instRef.spacingBetweenSlices ?? 1.5;
  const limiarMesmoNivelMm = Math.max(2.0, espessura * 1.3);

  // 1) Se `splitIntoStacks` dividiu a série em subpilhas por fase (ex.: fase 1..4), pega 1 corte por subpilha:
  if (serieAtiva && serieAtiva.stacks.length >= 2) {
    const porSubPilha: QuadroAlvo[] = [];
    serieAtiva.stacks.forEach((subPilha, idxSub) => {
      let melhorIdxSub = -1;
      let menorDist = Infinity;
      for (let i = 0; i < subPilha.instances.length; i++) {
        const cand = subPilha.instances[i]!;
        if (!mesmaOrientacaoDeFatia(cand, instRef)) continue;
        const c = coordenadaNormalDaInstancia(cand);
        if (c === undefined) continue;
        const d = Math.abs(c - coordRef);
        if (d < menorDist) {
          menorDist = d;
          melhorIdxSub = i;
        }
      }
      if (melhorIdxSub >= 0 && menorDist <= limiarMesmoNivelMm) {
        const inst = subPilha.instances[melhorIdxSub]!;
        const idxNaPilhaAtiva = pilhaAtiva.instances.findIndex((x) => x.fileId === inst.fileId);
        porSubPilha.push({
          instancia: inst,
          pilha: idxNaPilhaAtiva >= 0 ? pilhaAtiva : subPilha,
          indiceNaPilha: idxNaPilhaAtiva >= 0 ? idxNaPilhaAtiva : melhorIdxSub,
          tempoSegundos: segundosDoHorarioDicom(inst),
          ordemFase: idxSub,
          ordemSerie: serieAtiva.seriesNumber ?? 0,
          rotuloCurto: subPilha.label ?? `Fase ${porSubPilha.length + 1}`,
        });
      }
    });
    if (porSubPilha.length >= 2) {
      const ordenados = ordenarQuadrosCronologicamente(porSubPilha);
      return ordenados.map((q, idx) => ({
        ...q,
        rotuloCurto: q.rotuloCurto.startsWith('#') ? `Fase ${idx + 1}` : q.rotuloCurto,
      }));
    }
  }

  // 2) Se todas as fases estão em `pilhaAtiva.instances` na MESMA coordenada espacial exata:
  const coords = pilhaAtiva.instances
    .map((inst) => coordenadaNormalDaInstancia(inst))
    .filter((c): c is number => c !== undefined)
    .sort((a, b) => a - b);
  let menorPassoPositivo = Infinity;
  for (let i = 1; i < coords.length; i++) {
    const diff = Math.abs(coords[i]! - coords[i - 1]!);
    if (diff > 0.25 && diff < menorPassoPositivo) {
      menorPassoPositivo = diff;
    }
  }
  const toleranciaExataMm = Number.isFinite(menorPassoPositivo)
    ? Math.min(0.25, menorPassoPositivo * 0.35)
    : 0.15;

  const noMesmoCorteExato: QuadroAlvo[] = [];
  let emOutroNivel = 0;
  pilhaAtiva.instances.forEach((inst, idx) => {
    if (!mesmaOrientacaoDeFatia(inst, instRef)) return;
    const c = coordenadaNormalDaInstancia(inst);
    if (c !== undefined && Math.abs(c - coordRef) <= toleranciaExataMm) {
      noMesmoCorteExato.push({
        instancia: inst,
        pilha: pilhaAtiva,
        indiceNaPilha: idx,
        tempoSegundos: segundosDoHorarioDicom(inst),
        ordemFase: idx,
        rotuloCurto: `Fase ${noMesmoCorteExato.length + 1}`,
      });
    } else if (c !== undefined) {
      emOutroNivel++;
    }
  });

  if (noMesmoCorteExato.length >= 2 && emOutroNivel >= 1) {
    const ordenados = ordenarQuadrosCronologicamente(noMesmoCorteExato);
    return ordenados.map((q, idx) => ({
      ...q,
      rotuloCurto: `Fase ${idx + 1}`,
    }));
  }

  return [];
}

/**
 * Procura em todas as séries compatíveis do estudo atual o corte único na mesma posição
 * anatômica `coordRef` (1 corte por fase/série).
 * Quando `apenasMesmaSequencia === true`, exige mesma matriz (`rows`×`columns`), `echoTime`
 * compatível e exclui séries de subtração, MIP, T2, DWI e ADC.
 */
function coletarFasesCompativeisNoEstudo(
  instRef: InstanceMeta,
  coordRef: number,
  apenasMesmaSequencia: boolean,
): QuadroAlvo[] {
  const index = estado.resultado?.index;
  if (!index) return [];
  const serieRef = encontrarSerieDaInstancia(instRef);
  const refEhEspecial = serieRef ? ehSerieNaoPerfusao(serieRef, instRef) : false;
  const espessura = instRef.sliceThickness ?? instRef.spacingBetweenSlices ?? 1.5;
  const limiarMm = Math.max(2.5, espessura * 1.5);

  const candidatos: QuadroAlvo[] = [];
  for (const p of index.patients) {
    for (const est of p.studies) {
      if (est.studyInstanceUid !== instRef.studyInstanceUid) continue;
      for (const serie of est.series) {
        if (serie.kind !== 'imagem' || serie.modality !== instRef.modality) continue;
        const primeiraInst = serie.stacks[0]?.instances[0];
        if (!primeiraInst) continue;
        if (!refEhEspecial && ehSerieNaoPerfusao(serie, primeiraInst)) continue;

        if (apenasMesmaSequencia) {
          if (
            instRef.rows !== undefined &&
            primeiraInst.rows !== undefined &&
            instRef.rows !== primeiraInst.rows
          ) {
            continue;
          }
          if (
            instRef.columns !== undefined &&
            primeiraInst.columns !== undefined &&
            instRef.columns !== primeiraInst.columns
          ) {
            continue;
          }
          if (
            instRef.echoTime !== undefined &&
            primeiraInst.echoTime !== undefined &&
            Math.abs(instRef.echoTime - primeiraInst.echoTime) > 1.5
          ) {
            continue;
          }
        }

        const pilhasExibicao = pilhasExibicaoDaSerie(serie);
        const subPilhasBusca = serie.stacks.length >= 2 ? serie.stacks : pilhasExibicao;

        subPilhasBusca.forEach((subPilha, idxSub) => {
          let melhorIdx = -1;
          let menorDist = Infinity;
          for (let i = 0; i < subPilha.instances.length; i++) {
            const cand = subPilha.instances[i]!;
            if (!mesmaOrientacaoDeFatia(cand, instRef)) continue;
            const c = coordenadaNormalDaInstancia(cand);
            if (c === undefined) continue;
            const d = Math.abs(c - coordRef);
            if (d < menorDist) {
              menorDist = d;
              melhorIdx = i;
            }
          }
          if (melhorIdx >= 0 && menorDist <= limiarMm) {
            const inst = subPilha.instances[melhorIdx]!;
            const pilhaAlvo =
              pilhasExibicao.find((pe) => pe.instances.some((x) => x.fileId === inst.fileId)) ?? subPilha;
            const idxNaPilhaAlvo = pilhaAlvo.instances.findIndex((x) => x.fileId === inst.fileId);
            const rotuloBase = serie.description
              ? serie.description.slice(0, 14)
              : `Série ${serie.seriesNumber ?? candidatos.length + 1}`;
            candidatos.push({
              instancia: inst,
              pilha: pilhaAlvo,
              indiceNaPilha: idxNaPilhaAlvo >= 0 ? idxNaPilhaAlvo : melhorIdx,
              tempoSegundos: segundosDoHorarioDicom(inst),
              ordemSerie: serie.seriesNumber ?? 0,
              ordemFase: idxSub,
              rotuloCurto: subPilhasBusca.length > 1 && subPilha.label ? `${rotuloBase} (${subPilha.label})` : rotuloBase,
            });
          }
        });
      }
    }
  }

  const ordenados = ordenarQuadrosCronologicamente(candidatos);
  if (apenasMesmaSequencia && ordenados.length >= 2) {
    return ordenados.map((q, idx) => ({
      ...q,
      rotuloCurto: `Fase ${idx + 1}`,
    }));
  }
  return ordenados;
}

/**
 * Monta a lista de quadros a medir conforme o modo escolhido:
 * - `'serie-ativa'`: fases temporais da sequência ativa na mesma posição anatômica (1 corte por fase);
 *   se a sequência tiver 1 série por fase no estudo, reúne automaticamente as fases irmãs da sequência.
 * - `'fases-estudo'`: todas as séries/fases compatíveis do estudo neste nível anatômico.
 * - `'cortes-pilha'`: todos os cortes espaciais da pilha ativa.
 */
function coletarQuadrosAlvo(
  pilhaAtiva: StackNode,
  indiceCorteAtual: number,
  modo: ModoCurvaPerfusao,
): QuadroAlvo[] {
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];
  if (!instRef) return [];

  if (modo === 'cortes-pilha') {
    return pilhaAtiva.instances.map((inst, idx) => ({
      instancia: inst,
      pilha: pilhaAtiva,
      indiceNaPilha: idx,
      tempoSegundos: segundosDoHorarioDicom(inst),
      rotuloCurto: `#${idx + 1}`,
    }));
  }

  const coordRef = coordenadaNormalDaInstancia(instRef);
  if (coordRef !== undefined) {
    if (modo === 'serie-ativa') {
      const fasesSerie = coletarFasesDaMesmaSerie(pilhaAtiva, instRef, coordRef);
      if (fasesSerie.length >= 2) return fasesSerie;

      const fasesIrmas = coletarFasesCompativeisNoEstudo(instRef, coordRef, true);
      if (fasesIrmas.length >= 2) return fasesIrmas;
    } else if (modo === 'fases-estudo') {
      const fasesEstudo = coletarFasesCompativeisNoEstudo(instRef, coordRef, false);
      if (fasesEstudo.length >= 2) return fasesEstudo;
    }
  }

  return pilhaAtiva.instances.map((inst, idx) => ({
    instancia: inst,
    pilha: pilhaAtiva,
    indiceNaPilha: idx,
    tempoSegundos: segundosDoHorarioDicom(inst),
    rotuloCurto: `#${idx + 1}`,
  }));
}

function quantasFasesDaSequenciaAtiva(pilhaAtiva: StackNode, indiceCorteAtual: number): number {
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];
  if (!instRef) return pilhaAtiva.instances.length;
  const coordRef = coordenadaNormalDaInstancia(instRef);
  if (coordRef === undefined) return pilhaAtiva.instances.length;
  const daSerie = coletarFasesDaMesmaSerie(pilhaAtiva, instRef, coordRef);
  if (daSerie.length >= 2) return daSerie.length;
  const irmas = coletarFasesCompativeisNoEstudo(instRef, coordRef, true);
  if (irmas.length >= 2) return irmas.length;
  return pilhaAtiva.instances.length;
}

function quantasFasesNoEstudoNesteNivel(pilhaAtiva: StackNode, indiceCorteAtual: number): number {
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];
  if (!instRef) return 1;
  const coordRef = coordenadaNormalDaInstancia(instRef);
  if (coordRef === undefined) return 1;
  return Math.max(1, coletarFasesCompativeisNoEstudo(instRef, coordRef, false).length);
}

/**
 * Replica/sincroniza visualmente cada ROI mestre em todas as demais fases (`quadros`) na
 * mesma posição 3D do paciente, permitindo ao usuário rolar ou clicar nas fases do gráfico
 * e ver exatamente onde a ROI caiu e seus valores em cada fase.
 */
function sincronizarReplicasRoisNasFases(
  elemento: HTMLDivElement,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
  rois: RoiEmPixels[],
  quadros: QuadroAlvo[],
  arquivos: Map<string, File>,
  obterImageIdDoQuadro: ObterImageIdDoQuadroFn | undefined,
  roiDestaqueId: string | null,
): void {
  const imageIdsQuadros: Array<{ quadro: QuadroAlvo; imageId: string }> = [];
  const conjuntoImageIds = new Set<string>();
  for (const q of quadros) {
    const id = obterImageIdParaQuadro(q.pilha, q.indiceNaPilha, q.instancia, arquivos, obterImageIdDoQuadro);
    if (id && !conjuntoImageIds.has(id)) {
      conjuntoImageIds.add(id);
      imageIdsQuadros.push({ quadro: q, imageId: id });
    }
  }

  const idsRoisAtivas = new Set(rois.map((r) => r.id));

  // Remove réplicas antigas de ROIs removidas ou de quadros que não pertencem mais ao modo ativo:
  for (const toolName of [EllipticalROITool.toolName, PlanarFreehandROITool.toolName]) {
    const todas = [...(annotation.state.getAnnotations(toolName, elemento) ?? [])];
    for (const ann of todas) {
      const dados = ann.data as DadosReplicaRoi | undefined;
      const idMestre = dados?.replicaDeRoiUid;
      if (!idMestre) continue;
      const refId = ann.metadata?.referencedImageId;
      if (!idsRoisAtivas.has(idMestre) || !refId || !conjuntoImageIds.has(refId)) {
        if (ann.annotationUID) annotation.state.removeAnnotation(ann.annotationUID);
      }
    }
  }

  for (const roi of rois) {
    roi.replicasRef = [];
    if (!roi.anotacaoRef || roi.pontosMundo.length === 0) continue;
    const toolName = roi.tipo === 'elipse' ? EllipticalROITool.toolName : PlanarFreehandROITool.toolName;
    const imgIdMestre = roi.anotacaoRef.metadata?.referencedImageId;
    const existentes = annotation.state.getAnnotations(toolName, elemento) ?? [];

    for (const { quadro, imageId } of imageIdsQuadros) {
      if (imageId === imgIdMestre) continue;

      const pontosProj = roi.pontosMundo.map((pt) => projetarPontoNoPlanoDaInstancia(pt, quadro.instancia));
      const assProj = assinaturaPontosMundo(pontosProj);

      let replica = existentes.find((a) => {
        const d = a.data as DadosReplicaRoi | undefined;
        return d?.replicaDeRoiUid === roi.id && a.metadata?.referencedImageId === imageId;
      });

      if (replica) {
        const d = replica.data as DadosReplicaRoi;
        d.label = roi.nome;
        d.assinaturaSincronizada = assProj;
        d.cachedStats = {};
        if (roi.tipo === 'elipse' && d.handles) {
          d.handles.points = pontosProj.map((p) => [...p] as Ponto3);
        } else if (d.contour) {
          d.contour.polyline = pontosProj.map((p) => [...p] as Ponto3);
        }
        replica.invalidated = true;
      } else {
        const metaBase = { ...(roi.anotacaoRef.metadata ?? {}) } as Record<string, unknown>;
        delete metaBase.referencedImageURI;
        delete metaBase.sliceIndex;
        const novaReplica = {
          annotationUID: `replica-${roi.id}-${imageId}`,
          highlighted: false,
          invalidated: true,
          isLocked: false,
          isVisible: true,
          metadata: {
            ...metaBase,
            toolName,
            referencedImageId: imageId,
          },
          data: {
            label: roi.nome,
            replicaDeRoiUid: roi.id,
            assinaturaSincronizada: assProj,
            cachedStats: {},
            handles: {
              points: roi.tipo === 'elipse' ? pontosProj.map((p) => [...p] as Ponto3) : [],
              activeHandleIndex: null,
              textBox: {
                hasMoved: false,
                worldPosition: [0, 0, 0] as Ponto3,
                worldBoundingBox: {
                  topLeft: [0, 0, 0] as Ponto3,
                  topRight: [0, 0, 0] as Ponto3,
                  bottomLeft: [0, 0, 0] as Ponto3,
                  bottomRight: [0, 0, 0] as Ponto3,
                },
              },
            },
            ...(roi.tipo === 'poligono'
              ? {
                  contour: {
                    polyline: pontosProj.map((p) => [...p] as Ponto3),
                    closed: true,
                  },
                }
              : {}),
          },
        };
        annotation.state.addAnnotation(novaReplica as never, elemento);
        replica = novaReplica as unknown as AnotacaoCornerstone;
      }

      aplicarEstiloRoiNoViewport(replica, roi.cor, roiDestaqueId !== null && roiDestaqueId === roi.id);
      roi.replicasRef.push(replica);
    }
  }

  utilitariosTools.triggerAnnotationRenderForViewportIds(idsDosViewportsAtivos(viewport.id));
}

async function calcularCurvasRoi(
  rois: RoiEmPixels[],
  quadros: QuadroAlvo[],
  arquivos: Map<string, File>,
  viewport?: Types.IStackViewport | Types.IVolumeViewport,
  obterImageIdDoQuadro?: ObterImageIdDoQuadroFn,
  aoProgredir?: (feitos: number, total: number) => void,
): Promise<SerieCurvaRoi[]> {
  // Verifica se todos os quadros têm timestamps crescentes distintos para usar segundos no eixo X:
  const tempos = quadros.map((q) => q.tempoSegundos);
  const temposValidos = tempos.every((t): t is number => t !== undefined);
  const t0 = temposValidos ? Math.min(...tempos) : 0;
  const temVariacaoTempo = temposValidos && Math.max(...tempos) - t0 > 0.5;

  const pontosPorRoi: PontoCurva[][] = rois.map(() => []);

  for (let i = 0; i < quadros.length; i++) {
    const q = quadros[i]!;
    const imageId = obterImageIdParaQuadro(
      q.pilha,
      q.indiceNaPilha,
      q.instancia,
      arquivos,
      obterImageIdDoQuadro,
    );
    if (!imageId) continue;

    try {
      const img = await imageLoader.loadAndCacheImage(imageId);
      const pixels = img.getPixelData();
      const largura = img.columns ?? img.width ?? q.instancia.columns ?? 0;
      const altura = img.rows ?? img.height ?? q.instancia.rows ?? 0;
      // Quando `img.preScale?.scaled === true`, o `@cornerstonejs/dicom-image-loader` já aplicou
      // `rescaleSlope` e `rescaleIntercept` sobre `getPixelData()`. Não reaplicar para não distorcer fases!
      const jaEscalado = Boolean((img as { preScale?: { scaled?: boolean } }).preScale?.scaled);
      const slope = jaEscalado ? 1 : (img.slope ?? q.instancia.rescaleSlope ?? 1);
      const intercept = jaEscalado ? 0 : (img.intercept ?? q.instancia.rescaleIntercept ?? 0);

      const valorX = temVariacaoTempo ? Number((q.tempoSegundos! - t0).toFixed(1)) : i + 1;
      const unidadeX: 'quadro' | 's' = temVariacaoTempo ? 's' : 'quadro';
      const rotuloX = temVariacaoTempo ? `${valorX.toFixed(1)} s (${q.rotuloCurto})` : `${q.rotuloCurto}`;

      for (let rIdx = 0; rIdx < rois.length; rIdx++) {
        const med = medirRoiNaImagem(
          rois[rIdx]!,
          q.instancia,
          viewport,
          pixels,
          largura,
          altura,
          slope,
          intercept,
        );
        if (!med) continue;
        pontosPorRoi[rIdx]!.push({
          indice: i,
          rotuloX,
          valorX,
          unidadeX,
          media: med.media,
          dp: med.dp,
          min: med.min,
          max: med.max,
          contagemPixels: med.contagem,
          instancia: q.instancia,
          pilha: q.pilha,
          indiceNaPilha: q.indiceNaPilha,
        });
      }
    } catch {
      /* ignora quadro que falhar na decodificação */
    }

    if (aoProgredir && (i === quadros.length - 1 || i % 4 === 0)) {
      aoProgredir(i + 1, quadros.length);
    }
  }

  return rois.map((roi, rIdx) => {
    const pts = pontosPorRoi[rIdx]!;
    let pico = -Infinity;
    let minMedia = Infinity;
    let indicePico = 0;
    let rotuloPico = '—';
    for (const p of pts) {
      if (p.media > pico) {
        pico = p.media;
        indicePico = p.indice;
        rotuloPico = p.rotuloX;
      }
      if (p.media < minMedia) {
        minMedia = p.media;
      }
    }
    if (!Number.isFinite(pico)) pico = 0;
    if (!Number.isFinite(minMedia)) minMedia = 0;
    return {
      id: roi.id,
      nome: roi.nome,
      cor: roi.cor,
      pontos: pts,
      pico,
      indicePico,
      rotuloPico,
      amplitude: pico - minMedia,
    };
  });
}

const PAD_ESQ_GRAFICO = 58;
const PAD_DIR_GRAFICO = 68;

function desenharGraficoCurvas(
  canvas: HTMLCanvasElement,
  series: SerieCurvaRoi[],
  indiceHover: number | null,
  unidadeY: string,
  roiDestaqueId: string | null = null,
): void {
  const rect = canvas.getBoundingClientRect();
  const largura = Math.max(300, Math.round(rect.width || 520));
  const altura = Math.max(200, Math.round(rect.height || 230));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(largura * dpr) || canvas.height !== Math.round(altura * dpr)) {
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);

  const padEsq = PAD_ESQ_GRAFICO;
  const padDir = PAD_DIR_GRAFICO;
  const padTopo = 20;
  const padBase = 36;
  const wUtil = Math.max(10, largura - padEsq - padDir);
  const hUtil = Math.max(10, altura - padTopo - padBase);

  const todosPontos = series.flatMap((s) => s.pontos);
  if (todosPontos.length === 0) {
    ctx.fillStyle = '#9aa4af';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nenhum ponto pôde ser medido para esta ROI.', largura / 2, altura / 2);
    return;
  }

  let yMin = Infinity;
  let yMax = -Infinity;
  let maxIndice = 0;
  for (const p of todosPontos) {
    if (p.media - p.dp < yMin) yMin = p.media - p.dp;
    if (p.media + p.dp > yMax) yMax = p.media + p.dp;
    if (p.indice > maxIndice) maxIndice = p.indice;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 100;
  }
  const margemY = Math.max(5, (yMax - yMin) * 0.12);
  yMin -= margemY;
  yMax += margemY;

  const xParaPx = (idx: number) =>
    maxIndice <= 0 ? padEsq + wUtil / 2 : padEsq + (idx / maxIndice) * wUtil;
  const yParaPx = (val: number) =>
    padTopo + hUtil - ((val - yMin) / Math.max(1e-6, yMax - yMin)) * hUtil;

  // Grade horizontal e rótulos Y
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillStyle = '#8b96a2';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const linhasGrade = 5;
  for (let i = 0; i <= linhasGrade; i++) {
    const v = yMin + ((yMax - yMin) * i) / linhasGrade;
    const py = yParaPx(v);
    ctx.beginPath();
    ctx.moveTo(padEsq, py);
    ctx.lineTo(padEsq + wUtil, py);
    ctx.stroke();
    ctx.fillText(v.toFixed(0), padEsq - 6, py);
  }

  // Rótulo unidade Y
  ctx.save();
  ctx.fillStyle = '#9aa4af';
  ctx.textAlign = 'left';
  ctx.fillText(unidadeY, 6, padTopo - 8);
  ctx.restore();

  // Rótulos X
  const refPts = series[0]?.pontos ?? [];
  ctx.fillStyle = '#8b96a2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const passoX = Math.max(1, Math.ceil(refPts.length / 8));
  for (let i = 0; i < refPts.length; i += passoX) {
    const p = refPts[i]!;
    const px = xParaPx(p.indice);
    ctx.fillText(p.unidadeX === 's' ? `${p.valorX}s` : `#${p.indice + 1}`, px, padTopo + hUtil + 8);
  }

  // Desenha cada série (faixa ±1 DP + curva + pontos + rótulo na extremidade)
  for (const s of series) {
    if (s.pontos.length === 0) continue;
    const destacada = roiDestaqueId !== null && s.id === roiDestaqueId;
    const atenuada = roiDestaqueId !== null && !destacada;

    // Faixa sombreada de ±1 DP
    if (s.pontos.length >= 2) {
      ctx.save();
      ctx.globalAlpha = atenuada ? 0.25 : 1;
      ctx.fillStyle = s.cor + '22';
      ctx.beginPath();
      for (let i = 0; i < s.pontos.length; i++) {
        const p = s.pontos[i]!;
        const px = xParaPx(p.indice);
        const py = yParaPx(p.media + p.dp);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      for (let i = s.pontos.length - 1; i >= 0; i--) {
        const p = s.pontos[i]!;
        const px = xParaPx(p.indice);
        const py = yParaPx(p.media - p.dp);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Linha principal
    ctx.save();
    ctx.globalAlpha = atenuada ? 0.25 : 1;
    ctx.strokeStyle = s.cor;
    ctx.lineWidth = destacada ? 3.5 : 2.2;
    ctx.beginPath();
    for (let i = 0; i < s.pontos.length; i++) {
      const p = s.pontos[i]!;
      const px = xParaPx(p.indice);
      const py = yParaPx(p.media);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Pontos
    for (const p of s.pontos) {
      const px = xParaPx(p.indice);
      const py = yParaPx(p.media);
      ctx.fillStyle = p.indice === s.indicePico ? '#ffffff' : s.cor;
      ctx.beginPath();
      ctx.arc(px, py, p.indice === indiceHover ? 4.5 : destacada ? 3.4 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Rótulo curto na ponta direita da curva para identificação imediata
    const ultimo = s.pontos[s.pontos.length - 1]!;
    const lx = Math.min(largura - 4, xParaPx(ultimo.indice) + 6);
    const ly = yParaPx(ultimo.media);
    ctx.font = destacada ? 'bold 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
    ctx.textAlign = lx > padEsq + wUtil ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.cor;
    ctx.fillText(s.nome.slice(0, 10), lx, ly);
    ctx.restore();
  }

  // Linha vertical de inspeção (hover)
  if (indiceHover !== null && indiceHover >= 0 && indiceHover <= maxIndice) {
    const px = xParaPx(indiceHover);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px, padTopo);
    ctx.lineTo(px, padTopo + hUtil);
    ctx.stroke();
    ctx.restore();
  }
}

function exportarCsv(series: SerieCurvaRoi[], unidadeY: string): void {
  const linhas: string[] = [
    `ROI;Quadro;Eixo_X;Media_${unidadeY};DP_${unidadeY};Min_${unidadeY};Max_${unidadeY};Pixels`,
  ];
  for (const s of series) {
    for (const p of s.pontos) {
      linhas.push(
        [
          s.nome,
          p.indice + 1,
          p.rotuloX,
          p.media.toFixed(2).replace('.', ','),
          p.dp.toFixed(2).replace('.', ','),
          p.min.toFixed(2).replace('.', ','),
          p.max.toFixed(2).replace('.', ','),
          p.contagemPixels,
        ].join(';'),
      );
    }
  }
  const blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'curva-tempo-intensidade.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let dialogoCurva: HTMLDialogElement | null = null;
let posicaoSalvaDialogo: { left: number; top: number } | null = null;
let limparArrastoAtivo: (() => void) | null = null;
let limparEscutaViewportAtiva: (() => void) | null = null;
let resizeObserverAtivo: ResizeObserver | null = null;

function habilitarArrastoDialogo(cabecalho: HTMLElement, dialogo: HTMLDialogElement): void {
  limparArrastoAtivo?.();
  let emArrasto = false;
  let offsetX = 0;
  let offsetY = 0;

  const aoMover = (ev: MouseEvent) => {
    if (!emArrasto) return;
    const maxLeft = Math.max(8, window.innerWidth - 120);
    const maxTop = Math.max(8, window.innerHeight - 60);
    const left = Math.round(Math.max(8, Math.min(maxLeft, ev.clientX - offsetX)));
    const top = Math.round(Math.max(8, Math.min(maxTop, ev.clientY - offsetY)));
    dialogo.style.left = `${left}px`;
    dialogo.style.top = `${top}px`;
    dialogo.style.right = 'auto';
    dialogo.style.bottom = 'auto';
    posicaoSalvaDialogo = { left, top };
  };

  const aoSoltar = () => {
    emArrasto = false;
  };

  const aoPressionar = (ev: MouseEvent) => {
    if (ev.button !== 0) return;
    const alvo = ev.target as HTMLElement | null;
    if (alvo?.closest('button, select, input, a')) return;
    ev.preventDefault();
    const rect = dialogo.getBoundingClientRect();
    emArrasto = true;
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;
  };

  cabecalho.addEventListener('mousedown', aoPressionar);
  window.addEventListener('mousemove', aoMover);
  window.addEventListener('mouseup', aoSoltar);

  limparArrastoAtivo = () => {
    cabecalho.removeEventListener('mousedown', aoPressionar);
    window.removeEventListener('mousemove', aoMover);
    window.removeEventListener('mouseup', aoSoltar);
    emArrasto = false;
  };
}

/**
 * Abre a janela flutuante (não-modal e arrastável) de **Curva Tempo-Intensidade (Perfusão)** para o viewport ativo.
 */
export async function abrirDialogoCurvaPerfusao(opcoes: {
  elementoViewport: HTMLDivElement | undefined;
  pilhaAtiva: StackNode | null;
  indiceCorteAtual: number;
  pontoMiraMundo?: Ponto3 | null;
  aoSelecionarQuadro?: (pilha: StackNode, indiceCorte: number) => void;
  obterImageIdDoQuadro?: ObterImageIdDoQuadroFn;
}): Promise<void> {
  const {
    elementoViewport,
    pilhaAtiva,
    indiceCorteAtual,
    pontoMiraMundo,
    aoSelecionarQuadro,
    obterImageIdDoQuadro,
  } = opcoes;
  const arquivos = estado.resultado?.arquivos;
  if (!elementoViewport || !pilhaAtiva || !arquivos) return;

  const enabled = getEnabledElement(elementoViewport);
  if (!enabled) return;
  const viewport = enabled.viewport as Types.IStackViewport | Types.IVolumeViewport;
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];

  let { rois, usouRoiAutomatica } = extrairRoisNormalizadas(
    elementoViewport,
    viewport,
    instRef,
    pontoMiraMundo,
  );

  const qtdFasesSeq = quantasFasesDaSequenciaAtiva(pilhaAtiva, indiceCorteAtual);
  const qtdFasesEstudo = quantasFasesNoEstudoNesteNivel(pilhaAtiva, indiceCorteAtual);
  let modoAtual: ModoCurvaPerfusao = 'serie-ativa';
  const unidadeY = instRef?.modality === 'CT' ? 'HU' : instRef?.modality === 'PT' ? 'Bq/mL' : 'Intensidade';

  if (!dialogoCurva) {
    dialogoCurva = document.createElement('dialog');
    dialogoCurva.id = 'dialogo-curva-perfusao';
    dialogoCurva.setAttribute('aria-label', 'Curva Tempo-Intensidade (Perfusão)');
    document.body.append(dialogoCurva);
  }

  const d = dialogoCurva;
  limparEscutaViewportAtiva?.();
  limparEscutaViewportAtiva = null;
  resizeObserverAtivo?.disconnect();
  resizeObserverAtivo = null;
  d.replaceChildren();

  const cabecalho = document.createElement('div');
  cabecalho.className = 'cabecalho-curva';
  cabecalho.title = 'Arraste para mover esta janela para o lado da imagem';
  const titulo = document.createElement('h2');
  titulo.textContent = 'Curva Tempo-Intensidade · Perfusão';

  const controlesTopo = document.createElement('div');
  controlesTopo.className = 'controles-curva';

  const seletorModo = document.createElement('select');
  seletorModo.setAttribute('aria-label', 'Modo de amostragem da curva');
  const opSerie = document.createElement('option');
  opSerie.value = 'serie-ativa';
  opSerie.textContent = `Fases da sequência (${qtdFasesSeq})`;
  const opFases = document.createElement('option');
  opFases.value = 'fases-estudo';
  opFases.textContent = `Fases do estudo (${qtdFasesEstudo})`;
  const opCortes = document.createElement('option');
  opCortes.value = 'cortes-pilha';
  opCortes.textContent = `Todos os cortes (${pilhaAtiva.instances.length})`;
  seletorModo.append(opSerie, opFases, opCortes);
  seletorModo.value = modoAtual;

  const btnAtualizar = document.createElement('button');
  btnAtualizar.type = 'button';
  btnAtualizar.textContent = '↻ Atualizar ROIs';
  btnAtualizar.title = 'Recalcula após desenhar, mover ou apagar ROIs na imagem';

  const btnCsv = document.createElement('button');
  btnCsv.type = 'button';
  btnCsv.textContent = 'CSV';
  btnCsv.title = 'Exportar tabela da curva para CSV';

  const btnFechar = document.createElement('button');
  btnFechar.type = 'button';
  btnFechar.textContent = 'Fechar';

  controlesTopo.append(seletorModo, btnAtualizar, btnCsv, btnFechar);
  cabecalho.append(titulo, controlesTopo);
  habilitarArrastoDialogo(cabecalho, d);

  const avisoRoi = document.createElement('div');
  avisoRoi.className = 'dica-curva';
  const atualizarTextoAviso = () => {
    avisoRoi.textContent = usouRoiAutomatica
      ? 'ROI 1 criada e replicada nas fases. Você pode arrastá-la na imagem ou desenhar novas ROIs (E ou M).'
      : `Medindo ${rois.length} ${rois.length === 1 ? 'ROI replicada' : 'ROIs replicadas'} em todas as fases. Passe o mouse na tabela para destacar; clique no ponto para ir à fase.`;
  };
  atualizarTextoAviso();

  const canvas = document.createElement('canvas');
  canvas.className = 'canvas-curva-perfusao';

  const statusHover = document.createElement('div');
  statusHover.className = 'status-hover-curva';
  statusHover.textContent = 'Calculando densidades…';

  const tabelaResumo = document.createElement('table');
  tabelaResumo.className = 'tabela-resumo-curva';

  d.append(cabecalho, avisoRoi, canvas, statusHover, tabelaResumo);
  if (posicaoSalvaDialogo) {
    const maxLeft = Math.max(8, window.innerWidth - 120);
    const maxTop = Math.max(8, window.innerHeight - 60);
    d.style.left = `${Math.max(8, Math.min(maxLeft, posicaoSalvaDialogo.left))}px`;
    d.style.top = `${Math.max(8, Math.min(maxTop, posicaoSalvaDialogo.top))}px`;
    d.style.right = 'auto';
    d.style.bottom = 'auto';
  }
  if (!d.open) d.show();

  let seriesAtuais: SerieCurvaRoi[] = [];
  let indiceHover: number | null = null;
  let roiHoverId: string | null = null;

  function destacarRoi(roiId: string | null): void {
    roiHoverId = roiId;
    const linhas = tabelaResumo.querySelectorAll('tbody tr');
    linhas.forEach((tr) => {
      const idLinha = (tr as HTMLElement).dataset.roiId ?? null;
      tr.classList.toggle('destacada', roiId !== null && idLinha === roiId);
    });
    let atualizouVp = false;
    for (const r of rois) {
      const emDestaque = roiId !== null && r.id === roiId;
      if (r.anotacaoRef) {
        aplicarEstiloRoiNoViewport(r.anotacaoRef, r.cor, emDestaque);
        atualizouVp = true;
      }
      if (r.replicasRef) {
        for (const rep of r.replicasRef) {
          aplicarEstiloRoiNoViewport(rep, r.cor, emDestaque);
          atualizouVp = true;
        }
      }
    }
    if (atualizouVp) {
      const vpIds = idsDosViewportsAtivos(viewport.id);
      if (vpIds.length > 0) {
        utilitariosTools.triggerAnnotationRenderForViewportIds(vpIds);
      }
    }
    desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY, roiHoverId);
  }

  btnFechar.addEventListener('click', () => {
    limparEscutaViewportAtiva?.();
    limparEscutaViewportAtiva = null;
    destacarRoi(null);
    d.close();
  });

  function renderizarResumo(): void {
    tabelaResumo.replaceChildren();
    const thead = document.createElement('thead');
    const trH = document.createElement('tr');
    for (const col of ['ROI (clique p/ renomear)', 'Pts', `Pico (${unidadeY})`, 'TTP', `Δ (${unidadeY})`]) {
      const th = document.createElement('th');
      th.textContent = col;
      trH.append(th);
    }
    thead.append(trH);
    const tbody = document.createElement('tbody');
    for (const s of seriesAtuais) {
      const tr = document.createElement('tr');
      tr.dataset.roiId = s.id;
      if (roiHoverId === s.id) tr.classList.add('destacada');
      tr.addEventListener('mouseenter', () => destacarRoi(s.id));
      tr.addEventListener('mouseleave', () => {
        if (roiHoverId === s.id) destacarRoi(null);
      });

      const tdNome = document.createElement('td');
      tdNome.className = 'celula-nome-roi';
      const bolinha = document.createElement('span');
      bolinha.className = 'cor-roi-curva';
      bolinha.style.background = s.cor;

      const inputNome = document.createElement('input');
      inputNome.type = 'text';
      inputNome.className = 'roi-nome-input';
      inputNome.value = s.nome;
      inputNome.setAttribute('aria-label', `Nome de ${s.nome}`);
      inputNome.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') inputNome.blur();
      });
      inputNome.addEventListener('input', () => {
        const novoNome = inputNome.value.trim() || 'ROI';
        s.nome = novoNome;
        const roiAlvo = rois.find((r) => r.id === s.id);
        if (roiAlvo) {
          roiAlvo.nome = novoNome;
          if (roiAlvo.anotacaoRef?.data) {
            roiAlvo.anotacaoRef.data.label = novoNome;
          }
          if (roiAlvo.replicasRef) {
            for (const rep of roiAlvo.replicasRef) {
              if (rep.data) rep.data.label = novoNome;
            }
          }
          const vpIds = idsDosViewportsAtivos(viewport.id);
          if (vpIds.length > 0) {
            utilitariosTools.triggerAnnotationRenderForViewportIds(vpIds);
          }
        }
        desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY, roiHoverId);
      });
      tdNome.append(bolinha, inputNome);

      const tdN = document.createElement('td');
      tdN.textContent = String(s.pontos.length);

      const tdPico = document.createElement('td');
      tdPico.textContent = s.pontos.length ? s.pico.toFixed(1) : '—';

      const tdTtp = document.createElement('td');
      tdTtp.textContent = s.rotuloPico;

      const tdAmp = document.createElement('td');
      tdAmp.textContent = s.pontos.length ? s.amplitude.toFixed(1) : '—';

      tr.append(tdNome, tdN, tdPico, tdTtp, tdAmp);
      tbody.append(tr);
    }
    tabelaResumo.append(thead, tbody);
  }

  let calculandoAgora = false;
  async function atualizarCalculo(): Promise<void> {
    if (calculandoAgora) return;
    calculandoAgora = true;
    try {
      statusHover.textContent = 'Lendo quadros e calculando densidades no ROI…';
      const quadros = coletarQuadrosAlvo(pilhaAtiva!, indiceCorteAtual, modoAtual);
      sincronizarReplicasRoisNasFases(
        elementoViewport!,
        viewport,
        rois,
        quadros,
        arquivos!,
        obterImageIdDoQuadro,
        roiHoverId,
      );
      seriesAtuais = await calcularCurvasRoi(
        rois,
        quadros,
        arquivos!,
        viewport,
        obterImageIdDoQuadro,
        (feitos, total) => {
          statusHover.textContent = `Medindo ROI: quadro ${feitos} de ${total}…`;
        },
      );
      indiceHover = null;
      desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY, roiHoverId);
      renderizarResumo();
      statusHover.textContent =
        'Passe o mouse sobre o gráfico para inspecionar · Clique num ponto para ir à fase.';
    } finally {
      calculandoAgora = false;
    }
  }

  const recarregarRoisEAtualizar = () => {
    const extracao = extrairRoisNormalizadas(elementoViewport, viewport, instRef, pontoMiraMundo);
    rois = extracao.rois;
    usouRoiAutomatica = extracao.usouRoiAutomatica;
    atualizarTextoAviso();
    void atualizarCalculo();
  };

  seletorModo.addEventListener('change', () => {
    modoAtual = seletorModo.value as ModoCurvaPerfusao;
    void atualizarCalculo();
  });

  btnAtualizar.addEventListener('click', () => {
    roiHoverId = null;
    recarregarRoisEAtualizar();
  });

  let timerAutoRecalculo: ReturnType<typeof setTimeout> | null = null;
  const aoTerminarInteracaoViewport = (ev: MouseEvent) => {
    if (ev.button !== 0 || !d.open) return;
    if (timerAutoRecalculo) clearTimeout(timerAutoRecalculo);
    timerAutoRecalculo = setTimeout(() => {
      if (!d.open) return;
      recarregarRoisEAtualizar();
    }, 180);
  };
  elementoViewport.addEventListener('mouseup', aoTerminarInteracaoViewport);
  limparEscutaViewportAtiva = () => {
    if (timerAutoRecalculo) clearTimeout(timerAutoRecalculo);
    elementoViewport.removeEventListener('mouseup', aoTerminarInteracaoViewport);
  };

  btnCsv.addEventListener('click', () => {
    if (seriesAtuais.length > 0) exportarCsv(seriesAtuais, unidadeY);
  });

  function obterIndiceQuadroPorMouse(ev: MouseEvent): number | null {
    const pts = seriesAtuais[0]?.pontos;
    if (!pts || pts.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const wUtil = Math.max(10, rect.width - PAD_ESQ_GRAFICO - PAD_DIR_GRAFICO);
    const xRel = ev.clientX - rect.left - PAD_ESQ_GRAFICO;
    const maxIndice = Math.max(...pts.map((p) => p.indice));
    if (maxIndice <= 0) return 0;
    const idx = Math.round(Math.max(0, Math.min(1, xRel / wUtil)) * maxIndice);
    return idx;
  }

  canvas.addEventListener('mousemove', (ev) => {
    const idx = obterIndiceQuadroPorMouse(ev);
    if (idx === null) return;
    indiceHover = idx;
    desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY, roiHoverId);
    const partes: string[] = [];
    for (const s of seriesAtuais) {
      const p = s.pontos.find((pt) => pt.indice === idx);
      if (p) {
        partes.push(
          `${s.nome} [${p.rotuloX}]: Média ${p.media.toFixed(1)} ± ${p.dp.toFixed(1)} ${unidadeY} (mín ${p.min.toFixed(0)}, máx ${p.max.toFixed(0)})`,
        );
      }
    }
    if (partes.length > 0) {
      statusHover.textContent = partes.join('  ·  ');
    }
  });

  canvas.addEventListener('mouseleave', () => {
    indiceHover = null;
    desenharGraficoCurvas(canvas, seriesAtuais, null, unidadeY, roiHoverId);
  });

  canvas.addEventListener('click', (ev) => {
    const idx = obterIndiceQuadroPorMouse(ev);
    if (idx === null || !aoSelecionarQuadro) return;
    const p = seriesAtuais[0]?.pontos.find((pt) => pt.indice === idx);
    if (p) {
      aoSelecionarQuadro(p.pilha, p.indiceNaPilha);
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserverAtivo = new ResizeObserver(() => {
      if (seriesAtuais.length > 0) {
        desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY, roiHoverId);
      }
    });
    resizeObserverAtivo.observe(canvas);
  }

  await atualizarCalculo();
}
