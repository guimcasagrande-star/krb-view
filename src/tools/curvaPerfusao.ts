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
import { annotation, EllipticalROITool, PlanarFreehandROITool } from '@cornerstonejs/tools';
import { parseTM } from '../io/dicomTime';
import type { StackNode } from '../io/organize';
import type { InstanceMeta } from '../io/types';
import { estado } from '../state/store';

type Ponto2 = [number, number];
type Ponto3 = [number, number, number];

export type ModoCurvaPerfusao = 'serie-ativa' | 'fases-estudo';

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
  /** Centro e semi-eixos em coordenadas normalizadas [0..1] da imagem de referência. */
  centroNorm: Ponto2;
  eixoANorm: Ponto2;
  eixoBNorm: Ponto2;
  /** Polígono em coordenadas normalizadas [0..1] da imagem de referência. */
  poligonoNorm: Ponto2[];
}

const CORES_ROIS = ['#38bdf8', '#f87171', '#4ade80', '#fbbf24', '#c084fc', '#fb923c'];

const cacheImageIdsTemporarios = new Map<string, string>();

function obterImageIdParaInstancia(inst: InstanceMeta, arquivos: Map<string, File>): string | null {
  const jaRegistrado = cacheImageIdsTemporarios.get(inst.fileId);
  if (jaRegistrado) return jaRegistrado;
  const arq = arquivos.get(inst.fileId);
  if (!arq) return null;
  const id = wadouri.fileManager.add(arq);
  cacheImageIdsTemporarios.set(inst.fileId, id);
  return id;
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

/**
 * Extrai todas as ROIs desenhadas (`EllipticalROI` e `PlanarFreehandROI`) no elemento do viewport ativo.
 * Se não houver nenhuma, cria uma ROI circular padrão no ponto `pontoPadraoMundo` (ou no centro da fatia).
 */
function extrairRoisNormalizadas(
  elemento: HTMLDivElement,
  viewport: Types.IStackViewport | Types.IVolumeViewport,
  instRef: InstanceMeta | undefined,
  pontoPadraoMundo?: Ponto3 | null,
): { rois: RoiEmPixels[]; usouRoiAutomatica: boolean } {
  const rois: RoiEmPixels[] = [];
  let idxCor = 0;

  const annsElipse = annotation.state.getAnnotations(EllipticalROITool.toolName, elemento) ?? [];
  for (const ann of annsElipse) {
    const pts = ann.data?.handles?.points as Ponto3[] | undefined;
    if (!pts || pts.length < 4) continue;
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
    if (Math.hypot(eixoANorm[0], eixoANorm[1]) < 1e-4 || Math.hypot(eixoBNorm[0], eixoBNorm[1]) < 1e-4) {
      continue;
    }
    const cor = CORES_ROIS[idxCor % CORES_ROIS.length]!;
    idxCor++;
    rois.push({
      id: ann.annotationUID ?? `roi-${idxCor}`,
      nome: `ROI ${idxCor} (Elipse)`,
      cor,
      tipo: 'elipse',
      centroNorm,
      eixoANorm,
      eixoBNorm,
      poligonoNorm: [],
    });
  }

  const annsFreehand = annotation.state.getAnnotations(PlanarFreehandROITool.toolName, elemento) ?? [];
  for (const ann of annsFreehand) {
    const polyline =
      (ann.data as { contour?: { polyline?: Ponto3[] } })?.contour?.polyline ??
      (ann.data?.handles?.points as Ponto3[] | undefined);
    if (!polyline || polyline.length < 3) continue;
    // Subamostra se tiver muitos vértices para acelerar o teste ponto-no-polígono
    const passo = Math.max(1, Math.floor(polyline.length / 80));
    const poligonoNorm: Ponto2[] = [];
    for (let i = 0; i < polyline.length; i += passo) {
      poligonoNorm.push(mundoParaNormalizadoNaFatia(polyline[i]!, instRef, viewport));
    }
    if (poligonoNorm.length < 3) continue;
    const cor = CORES_ROIS[idxCor % CORES_ROIS.length]!;
    idxCor++;
    rois.push({
      id: ann.annotationUID ?? `roi-${idxCor}`,
      nome: `ROI ${idxCor} (Mão livre)`,
      cor,
      tipo: 'poligono',
      centroNorm: [0.5, 0.5],
      eixoANorm: [0.05, 0],
      eixoBNorm: [0, 0.05],
      poligonoNorm,
    });
  }

  if (rois.length > 0) {
    return { rois, usouRoiAutomatica: false };
  }

  // Fallback: cria uma ROI circular padrão (~5% da largura da imagem) no ponto do localizador `┼` ou no centro
  let centroNorm: Ponto2 = [0.5, 0.5];
  if (pontoPadraoMundo) {
    const n = mundoParaNormalizadoNaFatia(pontoPadraoMundo, instRef, viewport);
    if (n[0] >= 0.02 && n[0] <= 0.98 && n[1] >= 0.02 && n[1] <= 0.98) {
      centroNorm = n;
    }
  }
  return {
    rois: [
      {
        id: 'roi-padrao',
        nome: pontoPadraoMundo ? 'ROI no ponto ┼ (automática)' : 'ROI central (automática)',
        cor: CORES_ROIS[0]!,
        tipo: 'elipse',
        centroNorm,
        eixoANorm: [0.045, 0],
        eixoBNorm: [0, 0.045],
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
 * Mede Média, DP, Mín e Máx dos pixels dentro de `roi` numa imagem já carregada pelo Cornerstone.
 */
function medirRoiNaImagem(
  roi: RoiEmPixels,
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
    const cx = roi.centroNorm[0] * largura;
    const cy = roi.centroNorm[1] * altura;
    const ax = roi.eixoANorm[0] * largura;
    const ay = roi.eixoANorm[1] * altura;
    const bx = roi.eixoBNorm[0] * largura;
    const by = roi.eixoBNorm[1] * altura;
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
    const polyPx: Ponto2[] = roi.poligonoNorm.map((p) => [p[0] * largura, p[1] * altura]);
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
  const iop = inst.imageOrientationPatient;
  if (pos && iop && iop.length >= 6) {
    const nx = iop[1]! * iop[5]! - iop[2]! * iop[4]!;
    const ny = iop[2]! * iop[3]! - iop[0]! * iop[5]!;
    const nz = iop[0]! * iop[4]! - iop[1]! * iop[3]!;
    return pos[0] * nx + pos[1] * ny + pos[2] * nz;
  }
  if (pos) return pos[2];
  return inst.sliceLocation;
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
  rotuloCurto: string;
}

/**
 * Monta a lista de quadros a medir conforme o modo escolhido:
 * - `'serie-ativa'`: todos os cortes/quadros da pilha atual.
 * - `'fases-estudo'`: todas as pilhas do mesmo estudo que tenham uma fatia na mesma
 *   posição anatômica (dentro de 6 mm da fatia atual), ordenadas por horário/série.
 */
function coletarQuadrosAlvo(
  pilhaAtiva: StackNode,
  indiceCorteAtual: number,
  modo: ModoCurvaPerfusao,
): QuadroAlvo[] {
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];
  if (!instRef) return [];

  if (modo === 'serie-ativa') {
    const coordRefAtiva = coordenadaNormalDaInstancia(instRef);
    if (coordRefAtiva !== undefined && pilhaAtiva.instances.length >= 4) {
      const noMesmoNivel: QuadroAlvo[] = [];
      let emOutroNivel = 0;
      pilhaAtiva.instances.forEach((inst, idx) => {
        const c = coordenadaNormalDaInstancia(inst);
        if (c !== undefined && Math.abs(c - coordRefAtiva) <= 2.0) {
          noMesmoNivel.push({
            instancia: inst,
            pilha: pilhaAtiva,
            indiceNaPilha: idx,
            tempoSegundos: segundosDoHorarioDicom(inst),
            rotuloCurto: `#${noMesmoNivel.length + 1}`,
          });
        } else if (c !== undefined) {
          emOutroNivel++;
        }
      });
      // Se a pilha unificada tem várias fases na mesma posição anatômica atual (ex.: perfusão 4D),
      // mede a evolução temporal apenas nos cortes da mesma posição espacial da fatia ativa.
      if (noMesmoNivel.length >= 2 && emOutroNivel >= 1) {
        return noMesmoNivel;
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

  // Modo 'fases-estudo': procura em todo o estudo atual (ou em todos os estudos do mesmo paciente)
  const coordRef = coordenadaNormalDaInstancia(instRef);
  const index = estado.resultado?.index;
  if (!index || coordRef === undefined) {
    return coletarQuadrosAlvo(pilhaAtiva, indiceCorteAtual, 'serie-ativa');
  }

  const candidatos: Array<QuadroAlvo & { ordemSerie: number }> = [];
  for (const p of index.patients) {
    for (const est of p.studies) {
      if (est.studyInstanceUid !== instRef.studyInstanceUid) continue;
      for (const serie of est.series) {
        for (const stack of serie.stacks) {
          // Procura a fatia mais próxima de coordRef nesta pilha:
          let melhorIdx = -1;
          let menorDist = Infinity;
          for (let i = 0; i < stack.instances.length; i++) {
            const c = coordenadaNormalDaInstancia(stack.instances[i]!);
            if (c === undefined) continue;
            const d = Math.abs(c - coordRef);
            if (d < menorDist) {
              menorDist = d;
              melhorIdx = i;
            }
          }
          if (melhorIdx >= 0 && menorDist <= 6.0) {
            const inst = stack.instances[melhorIdx]!;
            candidatos.push({
              instancia: inst,
              pilha: stack,
              indiceNaPilha: melhorIdx,
              tempoSegundos: segundosDoHorarioDicom(inst),
              ordemSerie: serie.seriesNumber ?? 0,
              rotuloCurto: serie.description
                ? `${serie.description.slice(0, 14)}`
                : `Série ${serie.seriesNumber ?? candidatos.length + 1}`,
            });
          }
        }
      }
    }
  }

  if (candidatos.length <= 1) {
    return coletarQuadrosAlvo(pilhaAtiva, indiceCorteAtual, 'serie-ativa');
  }

  candidatos.sort((a, b) => {
    if (a.tempoSegundos !== undefined && b.tempoSegundos !== undefined && a.tempoSegundos !== b.tempoSegundos) {
      return a.tempoSegundos - b.tempoSegundos;
    }
    return a.ordemSerie - b.ordemSerie;
  });

  return candidatos;
}

function quantasFasesNoEstudoNesteNivel(pilhaAtiva: StackNode, indiceCorteAtual: number): number {
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];
  if (!instRef) return 1;
  const coordRef = coordenadaNormalDaInstancia(instRef);
  const index = estado.resultado?.index;
  if (!index || coordRef === undefined) return 1;
  let total = 0;
  for (const p of index.patients) {
    for (const est of p.studies) {
      if (est.studyInstanceUid !== instRef.studyInstanceUid) continue;
      for (const serie of est.series) {
        for (const stack of serie.stacks) {
          const temPerto = stack.instances.some((inst) => {
            const c = coordenadaNormalDaInstancia(inst);
            return c !== undefined && Math.abs(c - coordRef) <= 6.0;
          });
          if (temPerto) total++;
        }
      }
    }
  }
  return total;
}

async function calcularCurvasRoi(
  rois: RoiEmPixels[],
  quadros: QuadroAlvo[],
  arquivos: Map<string, File>,
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
    const imageId = obterImageIdParaInstancia(q.instancia, arquivos);
    if (!imageId) continue;

    try {
      const img = await imageLoader.loadAndCacheImage(imageId);
      const pixels = img.getPixelData();
      const largura = img.columns ?? img.width ?? q.instancia.columns ?? 0;
      const altura = img.rows ?? img.height ?? q.instancia.rows ?? 0;
      const slope = img.slope ?? q.instancia.rescaleSlope ?? 1;
      const intercept = img.intercept ?? q.instancia.rescaleIntercept ?? 0;

      const valorX = temVariacaoTempo ? Number(((q.tempoSegundos! - t0)).toFixed(1)) : i + 1;
      const unidadeX: 'quadro' | 's' = temVariacaoTempo ? 's' : 'quadro';
      const rotuloX = temVariacaoTempo ? `${valorX.toFixed(1)} s (${q.rotuloCurto})` : `${q.rotuloCurto}`;

      for (let rIdx = 0; rIdx < rois.length; rIdx++) {
        const med = medirRoiNaImagem(rois[rIdx]!, pixels, largura, altura, slope, intercept);
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

function desenharGraficoCurvas(
  canvas: HTMLCanvasElement,
  series: SerieCurvaRoi[],
  indiceHover: number | null,
  unidadeY: string,
): void {
  const rect = canvas.getBoundingClientRect();
  const largura = Math.max(480, Math.round(rect.width || 640));
  const altura = Math.max(240, Math.round(rect.height || 280));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(largura * dpr) || canvas.height !== Math.round(altura * dpr)) {
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);

  const padEsq = 58;
  const padDir = 20;
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

  // Desenha cada série (faixa ±1 DP + curva + pontos)
  for (const s of series) {
    if (s.pontos.length === 0) continue;

    // Faixa sombreada de ±1 DP
    if (s.pontos.length >= 2) {
      ctx.save();
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
    ctx.strokeStyle = s.cor;
    ctx.lineWidth = 2.2;
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
      ctx.arc(px, py, p.indice === indiceHover ? 4.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
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

/**
 * Abre a janela de **Curva Tempo-Intensidade (Perfusão)** para o viewport ativo.
 */
export async function abrirDialogoCurvaPerfusao(opcoes: {
  elementoViewport: HTMLDivElement | undefined;
  pilhaAtiva: StackNode | null;
  indiceCorteAtual: number;
  pontoMiraMundo?: Ponto3 | null;
  aoSelecionarQuadro?: (pilha: StackNode, indiceCorte: number) => void;
}): Promise<void> {
  const { elementoViewport, pilhaAtiva, indiceCorteAtual, pontoMiraMundo, aoSelecionarQuadro } = opcoes;
  const arquivos = estado.resultado?.arquivos;
  if (!elementoViewport || !pilhaAtiva || !arquivos) return;

  const enabled = getEnabledElement(elementoViewport);
  if (!enabled) return;
  const viewport = enabled.viewport as Types.IStackViewport | Types.IVolumeViewport;
  const instRef = pilhaAtiva.instances[indiceCorteAtual] ?? pilhaAtiva.instances[0];

  const { rois, usouRoiAutomatica } = extrairRoisNormalizadas(
    elementoViewport,
    viewport,
    instRef,
    pontoMiraMundo,
  );

  const qtdFasesEstudo = quantasFasesNoEstudoNesteNivel(pilhaAtiva, indiceCorteAtual);
  let modoAtual: ModoCurvaPerfusao = qtdFasesEstudo >= 3 ? 'fases-estudo' : 'serie-ativa';
  const unidadeY = instRef?.modality === 'CT' ? 'HU' : instRef?.modality === 'PT' ? 'Bq/mL' : 'Intensidade';

  if (!dialogoCurva) {
    dialogoCurva = document.createElement('dialog');
    dialogoCurva.id = 'dialogo-curva-perfusao';
    dialogoCurva.setAttribute('aria-label', 'Curva Tempo-Intensidade (Perfusão)');
    document.body.append(dialogoCurva);
    dialogoCurva.addEventListener('click', (e) => {
      if (e.target === dialogoCurva) dialogoCurva?.close();
    });
  }

  const d = dialogoCurva;
  d.replaceChildren();

  const cabecalho = document.createElement('div');
  cabecalho.className = 'cabecalho-curva';
  const titulo = document.createElement('h2');
  titulo.textContent = 'Curva Tempo-Intensidade / Densidade por ROI';

  const controlesTopo = document.createElement('div');
  controlesTopo.className = 'controles-curva';

  const seletorModo = document.createElement('select');
  seletorModo.setAttribute('aria-label', 'Modo de amostragem da curva');
  const opSerie = document.createElement('option');
  opSerie.value = 'serie-ativa';
  opSerie.textContent = `Quadros/cortes da série ativa (${pilhaAtiva.instances.length})`;
  const opFases = document.createElement('option');
  opFases.value = 'fases-estudo';
  opFases.textContent = `Fases/séries do estudo neste nível (${qtdFasesEstudo})`;
  seletorModo.append(opSerie, opFases);
  seletorModo.value = modoAtual;

  const btnCsv = document.createElement('button');
  btnCsv.type = 'button';
  btnCsv.textContent = 'Exportar CSV';

  const btnFechar = document.createElement('button');
  btnFechar.type = 'button';
  btnFechar.textContent = 'Fechar';
  btnFechar.addEventListener('click', () => d.close());

  controlesTopo.append(seletorModo, btnCsv, btnFechar);
  cabecalho.append(titulo, controlesTopo);

  const avisoRoi = document.createElement('div');
  avisoRoi.className = 'dica-curva';
  avisoRoi.textContent = usouRoiAutomatica
    ? 'Dica: nenhuma ROI desenhada encontrada no corte; medindo uma ROI circular automática. Você pode desenhar uma ou mais ROIs (teclas E ou M) para comparar curvas (ex.: Artéria × Lesão).'
    : `Medindo ${rois.length} ${rois.length === 1 ? 'ROI desenhada' : 'ROIs desenhadas'} na mesma posição em todos os quadros. Clique num ponto do gráfico para ir ao corte correspondente.`;

  const canvas = document.createElement('canvas');
  canvas.className = 'canvas-curva-perfusao';

  const statusHover = document.createElement('div');
  statusHover.className = 'status-hover-curva';
  statusHover.textContent = 'Calculando densidades…';

  const tabelaResumo = document.createElement('table');
  tabelaResumo.className = 'tabela-resumo-curva';

  d.append(cabecalho, avisoRoi, canvas, statusHover, tabelaResumo);
  if (!d.open) d.showModal();

  let seriesAtuais: SerieCurvaRoi[] = [];
  let indiceHover: number | null = null;

  function renderizarResumo(): void {
    tabelaResumo.replaceChildren();
    const thead = document.createElement('thead');
    const trH = document.createElement('tr');
    for (const col of ['ROI', 'Amostras', `Pico (${unidadeY})`, 'No quadro / tempo (TTP)', `Amplitude Δ (${unidadeY})`]) {
      const th = document.createElement('th');
      th.textContent = col;
      trH.append(th);
    }
    thead.append(trH);
    const tbody = document.createElement('tbody');
    for (const s of seriesAtuais) {
      const tr = document.createElement('tr');
      const tdNome = document.createElement('td');
      const bolinha = document.createElement('span');
      bolinha.className = 'cor-roi-curva';
      bolinha.style.background = s.cor;
      tdNome.append(bolinha, document.createTextNode(s.nome));

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

  async function atualizarCalculo(): Promise<void> {
    statusHover.textContent = 'Lendo quadros e calculando densidades no ROI…';
    const quadros = coletarQuadrosAlvo(pilhaAtiva!, indiceCorteAtual, modoAtual);
    seriesAtuais = await calcularCurvasRoi(rois, quadros, arquivos!, (feitos, total) => {
      statusHover.textContent = `Medindo ROI: quadro ${feitos} de ${total}…`;
    });
    indiceHover = null;
    desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY);
    renderizarResumo();
    statusHover.textContent =
      'Passe o mouse sobre o gráfico para inspecionar os valores · Clique num ponto para ir ao corte.';
  }

  seletorModo.addEventListener('change', () => {
    modoAtual = seletorModo.value as ModoCurvaPerfusao;
    void atualizarCalculo();
  });

  btnCsv.addEventListener('click', () => {
    if (seriesAtuais.length > 0) exportarCsv(seriesAtuais, unidadeY);
  });

  function obterIndiceQuadroPorMouse(ev: MouseEvent): number | null {
    const pts = seriesAtuais[0]?.pontos;
    if (!pts || pts.length === 0) return null;
    const rect = canvas.getBoundingClientRect();
    const padEsq = 58;
    const padDir = 20;
    const wUtil = Math.max(10, rect.width - padEsq - padDir);
    const xRel = ev.clientX - rect.left - padEsq;
    const maxIndice = Math.max(...pts.map((p) => p.indice));
    if (maxIndice <= 0) return 0;
    const idx = Math.round(Math.max(0, Math.min(1, xRel / wUtil)) * maxIndice);
    return idx;
  }

  canvas.addEventListener('mousemove', (ev) => {
    const idx = obterIndiceQuadroPorMouse(ev);
    if (idx === null) return;
    indiceHover = idx;
    desenharGraficoCurvas(canvas, seriesAtuais, indiceHover, unidadeY);
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
    desenharGraficoCurvas(canvas, seriesAtuais, null, unidadeY);
  });

  canvas.addEventListener('click', (ev) => {
    const idx = obterIndiceQuadroPorMouse(ev);
    if (idx === null || !aoSelecionarQuadro) return;
    const p = seriesAtuais[0]?.pontos.find((pt) => pt.indice === idx);
    if (p) {
      aoSelecionarQuadro(p.pilha, p.indiceNaPilha);
    }
  });

  await atualizarCalculo();
}
