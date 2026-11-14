/**
 * Segmentação em labelmap (fase 9.1): uma segmentação por série (pilha), com vários segmentos.
 * A máscara é um volume derivado do volume da série (mesma grade, 1 byte por voxel) e só é
 * criada quando o usuário pede. Ela aparece em todos os viewports que mostram a série
 * (corte original, MPR e fusão), pois o Cornerstone liga a máscara às imagens de origem.
 *
 * Este módulo não conhece os slots da grade: `viewport2d` informa quais viewports mostram qual
 * série (`mostrarNosViewports`) e entrega o volume de referência na criação.
 */

import { cache, eventTarget, type Types, volumeLoader } from '@cornerstonejs/core';
import { Enums as EnumsTools, segmentation } from '@cornerstonejs/tools';
import { gridFromVolumeProps, worldToVoxel } from '../io/geometry';
import type { ScalarVolume } from '../volume/voxelStats';
import { buracosFechados, interpolarCortes } from './mascaras';
import { type LinhaVolumetria, volumetriaDosSegmentos } from './volumetria';
import type { GeometriaSalva, SegmentoSalvo } from './arquivoSegmentacao';

const LABELMAP = EnumsTools.SegmentationRepresentations.Labelmap;

/** Disparado em `document` quando segmentos, segmento ativo, estilo ou faixa mudam. */
export const EVENTO_SEGMENTACAO = 'segmentacaoMudou';

export interface Segmento {
  indice: number;
  nome: string;
  cor: [number, number, number];
  visivel: boolean;
  bloqueado: boolean;
}

interface SegmentacaoDaPilha {
  pilhaId: string;
  segmentationId: string;
  /** Id do volume da máscara (labelmap) no cache do Cornerstone. */
  labelmapId: string;
  segmentos: Segmento[];
  ativo: number;
  /** Tabela de cores própria desta segmentação (índice no estado do Cornerstone). */
  indiceLut: number;
  lut: Types.ColorLUT;
  /** Solta a referência ao volume da série, guardada enquanto a segmentação existe. */
  liberar: () => void;
  /** Volumetria (fase 9.2): última calculada, e o estado do cálculo. */
  volumetria?: Volumetria;
  calculando?: boolean;
  recalcularDepois?: boolean;
  temporizador?: ReturnType<typeof setTimeout>;
}

export interface Volumetria {
  linhas: LinhaVolumetria[];
  unidade: string;
  ehPet: boolean;
  /** Mensagem quando não foi possível calcular. */
  erro?: string;
}

/** Valores da série (HU ou SUV) na grade da máscara; fornecido por `viewport2d`. */
export type ResolvedorValores = (
  pilhaId: string,
) => Promise<{ volume: ScalarVolume; unidade: string; ehPet: boolean } | { erro: string }>;

let resolvedorValores: ResolvedorValores | null = null;

export function definirResolvedorValores(fn: ResolvedorValores): void {
  resolvedorValores = fn;
}

/** Espera depois da última edição antes de recalcular (não recalcula a cada pincelada). */
const ATRASO_VOLUMETRIA_MS = 600;

/** Cores dos segmentos, na ordem em que são criados (repete depois do último). */
const PALETA: Array<[number, number, number]> = [
  [230, 60, 60],
  [60, 180, 90],
  [60, 130, 230],
  [240, 200, 40],
  [200, 80, 220],
  [40, 200, 210],
  [245, 130, 40],
  [150, 110, 60],
];

const porPilha = new Map<string, SegmentacaoDaPilha>();
let contador = 0;

/** Aparência do preenchimento, igual para todas as segmentações. */
const estilo = { opacidade: 0.5, soContorno: false };

/** Faixa de valores (HU ou SUV) do pincel com limiar e do crescer região; null = não definido. */
const faixa: { min: number | null; max: number | null } = { min: null, max: null };

function avisar(): void {
  document.dispatchEvent(new CustomEvent(EVENTO_SEGMENTACAO));
}

export function segmentacaoDaPilha(pilhaId: string | null | undefined): SegmentacaoDaPilha | undefined {
  return pilhaId ? porPilha.get(pilhaId) : undefined;
}

export function estiloSegmentacao(): Readonly<typeof estilo> {
  return estilo;
}

export function faixaSegmentacao(): Readonly<typeof faixa> {
  return faixa;
}

export function definirFaixa(min: number | null, max: number | null): void {
  faixa.min = min;
  faixa.max = max;
  avisar();
}

function viewportsCom(seg: SegmentacaoDaPilha): string[] {
  return segmentation.state.getViewportIdsWithSegmentation(seg.segmentationId) ?? [];
}

function corRgba(c: [number, number, number]): Types.Color {
  return [c[0], c[1], c[2], 255];
}

/**
 * Cria a segmentação da pilha a partir do volume dela (que precisa estar no cache) e o
 * primeiro segmento. Se já existir, devolve a existente.
 */
export function criarSegmentacao(
  pilhaId: string,
  volumeReferenciaId: string,
  liberar: () => void,
): SegmentacaoDaPilha {
  const existente = porPilha.get(pilhaId);
  if (existente) return existente;
  if (!cache.getVolume(volumeReferenciaId)) throw new Error('O volume da série ainda não está pronto.');
  const n = ++contador;
  const segmentationId = `segmentacao-${n}`;
  const labelmapId = `mascara-${n}`;
  const mascara = volumeLoader.createAndCacheDerivedLabelmapVolume(volumeReferenciaId, { volumeId: labelmapId });
  // As listas de imagens ligam cada fatia da máscara à imagem de origem: sem elas, os cortes
  // originais (viewport de pilha) não acham a fatia da máscara e não mostram nem pintam nada.
  const imageIds = [...mascara.imageIds];
  const referencedImageIds = [...(cache.getVolume(volumeReferenciaId)?.imageIds ?? [])];

  const lut: Types.ColorLUT = [[0, 0, 0, 0]];
  for (let i = 1; i < 256; i++) lut.push(corRgba(PALETA[(i - 1) % PALETA.length]!));
  const indiceLut = segmentation.config.color.addColorLUT(lut);

  segmentation.addSegmentations([
    {
      segmentationId,
      representation: {
        type: LABELMAP,
        data: { volumeId: labelmapId, referencedVolumeId: volumeReferenciaId, imageIds, referencedImageIds },
      },
      config: { label: 'Segmentação', segments: { 1: { label: 'Segmento 1' } } },
    },
  ]);
  const seg: SegmentacaoDaPilha = {
    pilhaId,
    segmentationId,
    labelmapId,
    segmentos: [{ indice: 1, nome: 'Segmento 1', cor: PALETA[0]!, visivel: true, bloqueado: false }],
    ativo: 1,
    indiceLut,
    lut,
    liberar,
  };
  porPilha.set(pilhaId, seg);
  segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);
  aplicarEstilo();
  avisar();
  return seg;
}

/** Apaga a segmentação inteira da pilha (máscara e segmentos). */
export function apagarSegmentacao(pilhaId: string): void {
  const seg = porPilha.get(pilhaId);
  if (!seg) return;
  porPilha.delete(pilhaId);
  if (seg.temporizador) clearTimeout(seg.temporizador);
  seg.liberar();
  try {
    segmentation.removeSegmentation(seg.segmentationId);
  } catch {
    /* já removida */
  }
  try {
    cache.removeVolumeLoadObject(seg.labelmapId);
  } catch {
    /* fora do cache */
  }
  avisar();
}

/** Apaga todas (ao abrir outra pasta ou limpar a lista). */
export function apagarTodasSegmentacoes(): void {
  for (const id of [...porPilha.keys()]) apagarSegmentacao(id);
}

// ---------- volumetria (fase 9.2) ----------

export function volumetriaDa(pilhaId: string | null | undefined): { volumetria?: Volumetria; calculando: boolean } {
  const seg = segmentacaoDaPilha(pilhaId);
  return { volumetria: seg?.volumetria, calculando: !!seg?.calculando || !!seg?.temporizador };
}

function agendarVolumetria(seg: SegmentacaoDaPilha, atrasoMs = ATRASO_VOLUMETRIA_MS): void {
  if (seg.temporizador) clearTimeout(seg.temporizador);
  seg.temporizador = setTimeout(() => {
    seg.temporizador = undefined;
    void calcularVolumetria(seg);
  }, atrasoMs);
  avisar();
}

async function calcularVolumetria(seg: SegmentacaoDaPilha): Promise<void> {
  if (seg.calculando) {
    seg.recalcularDepois = true;
    return;
  }
  if (!resolvedorValores || porPilha.get(seg.pilhaId) !== seg) return;
  seg.calculando = true;
  avisar();
  try {
    const valores = await resolvedorValores(seg.pilhaId);
    if (porPilha.get(seg.pilhaId) !== seg) return;
    if ('erro' in valores) {
      seg.volumetria = { linhas: [], unidade: '', ehPet: false, erro: valores.erro };
      return;
    }
    const rotulos = cache.getVolume(seg.labelmapId)?.voxelManager?.getCompleteScalarDataArray?.();
    if (!rotulos) {
      seg.volumetria = { linhas: [], unidade: valores.unidade, ehPet: valores.ehPet, erro: 'Máscara indisponível.' };
      return;
    }
    const linhas = volumetriaDosSegmentos(
      rotulos as ArrayLike<number>,
      valores.volume,
      seg.segmentos.map((s) => ({ indice: s.indice, nome: s.nome })),
      valores.ehPet,
    );
    seg.volumetria = { linhas, unidade: valores.unidade, ehPet: valores.ehPet };
  } catch (e) {
    seg.volumetria = {
      linhas: [],
      unidade: '',
      ehPet: false,
      erro: e instanceof Error ? e.message : 'Falha ao calcular a volumetria.',
    };
  } finally {
    seg.calculando = false;
    if (seg.recalcularDepois) {
      seg.recalcularDepois = false;
      agendarVolumetria(seg, 0);
    } else {
      avisar();
    }
  }
}

// Qualquer edição da máscara (pincel, esfera, borracha, preencher, crescer região, apagar
// segmento) dispara este evento do Cornerstone: recalcula a volumetria daquela segmentação.
eventTarget.addEventListener(EnumsTools.Events.SEGMENTATION_DATA_MODIFIED, (e: Event) => {
  const id = (e as CustomEvent<{ segmentationId?: string }>).detail?.segmentationId;
  for (const seg of porPilha.values()) {
    if (seg.segmentationId === id) agendarVolumetria(seg);
  }
});

export function novoSegmento(pilhaId: string): Segmento | undefined {
  const seg = porPilha.get(pilhaId);
  if (!seg) return undefined;
  const indice = Math.max(0, ...seg.segmentos.map((s) => s.indice)) + 1;
  if (indice > 255) return undefined;
  const cor = PALETA[(indice - 1) % PALETA.length]!;
  const novo: Segmento = { indice, nome: `Segmento ${indice}`, cor, visivel: true, bloqueado: false };
  seg.segmentos.push(novo);
  seg.lut[indice] = corRgba(cor);
  const atual = segmentation.state.getSegmentation(seg.segmentationId);
  if (atual) {
    segmentation.updateSegmentations([
      {
        segmentationId: seg.segmentationId,
        payload: {
          segments: {
            ...atual.segments,
            [indice]: { segmentIndex: indice, label: novo.nome, locked: false, cachedStats: {}, active: false },
          },
        },
      },
    ]);
  }
  definirSegmentoAtivo(pilhaId, indice);
  agendarVolumetria(seg);
  return novo;
}

export function definirSegmentoAtivo(pilhaId: string, indice: number): void {
  const seg = porPilha.get(pilhaId);
  if (!seg || !seg.segmentos.some((s) => s.indice === indice)) return;
  seg.ativo = indice;
  segmentation.segmentIndex.setActiveSegmentIndex(seg.segmentationId, indice);
  avisar();
}

export function apagarSegmento(pilhaId: string, indice: number): void {
  const seg = porPilha.get(pilhaId);
  if (!seg) return;
  segmentation.removeSegment(seg.segmentationId, indice, { setNextSegmentAsActive: false });
  seg.segmentos = seg.segmentos.filter((s) => s.indice !== indice);
  agendarVolumetria(seg);
  if (seg.segmentos.length === 0) {
    // Mantém sempre um segmento para pintar.
    novoSegmento(pilhaId);
    return;
  }
  if (seg.ativo === indice) definirSegmentoAtivo(pilhaId, seg.segmentos[0]!.indice);
  else avisar();
}

export function renomearSegmento(pilhaId: string, indice: number, nome: string): void {
  const s = porPilha.get(pilhaId)?.segmentos.find((x) => x.indice === indice);
  if (!s || !nome.trim()) return;
  s.nome = nome.trim();
  const linha = porPilha.get(pilhaId)?.volumetria?.linhas.find((l) => l.indice === indice);
  if (linha) linha.nome = s.nome;
  avisar();
}

export function definirCorSegmento(pilhaId: string, indice: number, cor: [number, number, number]): void {
  const seg = porPilha.get(pilhaId);
  const s = seg?.segmentos.find((x) => x.indice === indice);
  if (!seg || !s) return;
  s.cor = cor;
  seg.lut[indice] = corRgba(cor);
  for (const vp of viewportsCom(seg)) {
    segmentation.config.color.setSegmentIndexColor(vp, seg.segmentationId, indice, corRgba(cor));
  }
  avisar();
}

export function definirVisivelSegmento(pilhaId: string, indice: number, visivel: boolean): void {
  const seg = porPilha.get(pilhaId);
  const s = seg?.segmentos.find((x) => x.indice === indice);
  if (!seg || !s) return;
  s.visivel = visivel;
  for (const vp of viewportsCom(seg)) {
    segmentation.config.visibility.setSegmentIndexVisibility(
      vp,
      { segmentationId: seg.segmentationId, type: LABELMAP },
      indice,
      visivel,
    );
  }
  avisar();
}

export function definirBloqueadoSegmento(pilhaId: string, indice: number, bloqueado: boolean): void {
  const seg = porPilha.get(pilhaId);
  const s = seg?.segmentos.find((x) => x.indice === indice);
  if (!seg || !s) return;
  s.bloqueado = bloqueado;
  segmentation.segmentLocking.setSegmentIndexLocked(seg.segmentationId, indice, bloqueado);
  avisar();
}

function aplicarEstilo(): void {
  segmentation.config.style.setStyle(
    { type: LABELMAP },
    {
      renderFill: !estilo.soContorno,
      renderFillInactive: !estilo.soContorno,
      fillAlpha: estilo.opacidade,
      fillAlphaInactive: estilo.opacidade * 0.6,
      renderOutline: true,
      outlineWidth: 1,
      outlineOpacity: 1,
    },
  );
  for (const seg of porPilha.values()) {
    for (const vp of viewportsCom(seg)) segmentation.triggerSegmentationEvents.triggerSegmentationRepresentationModified(vp, seg.segmentationId, LABELMAP);
  }
}

export function definirEstilo(opacidade: number, soContorno: boolean): void {
  estilo.opacidade = Math.min(1, Math.max(0, opacidade));
  estilo.soContorno = soContorno;
  aplicarEstilo();
  avisar();
}

/**
 * Põe (ou tira) a representação da máscara em cada viewport conforme a série que ele mostra.
 * `lista`: viewports prontos para receber a máscara e a pilha de cada um.
 */
export function mostrarNosViewports(lista: Array<{ idViewport: string; pilhaId: string | null }>): void {
  for (const { idViewport, pilhaId } of lista) {
    const desejada = segmentacaoDaPilha(pilhaId)?.segmentationId;
    const atuais = (segmentation.state.getSegmentationRepresentations(idViewport) ?? []).map((r) => r.segmentationId);
    for (const id of atuais) {
      if (id !== desejada) segmentation.removeSegmentationRepresentations(idViewport, { segmentationId: id });
    }
    if (!desejada) continue;
    const seg = segmentacaoDaPilha(pilhaId)!;
    if (!atuais.includes(desejada)) {
      segmentation.addLabelmapRepresentationToViewport(idViewport, [
        { segmentationId: desejada, config: { colorLUTOrIndex: seg.indiceLut } },
      ]);
      segmentation.activeSegmentation.setActiveSegmentation(idViewport, desejada);
    }
    sincronizarVisibilidade(seg, idViewport);
  }
}

/**
 * Leva ao viewport o mostrar/esconder do painel (a fonte da verdade). Algumas operações do
 * Cornerstone (ex.: trocar a lista de segmentos ao reabrir um arquivo) voltam todos a visíveis.
 */
function sincronizarVisibilidade(seg: SegmentacaoDaPilha, idViewport: string): void {
  const espec = { segmentationId: seg.segmentationId, type: LABELMAP };
  for (const s of seg.segmentos) {
    if (segmentation.config.visibility.getSegmentIndexVisibility(idViewport, espec, s.indice) !== s.visivel) {
      segmentation.config.visibility.setSegmentIndexVisibility(idViewport, espec, s.indice, s.visivel);
    }
  }
}

/**
 * Escreve uma máscara (1 = dentro, na grade do volume da série) no segmento ativo.
 * Voxels de segmentos bloqueados não são sobrescritos. Devolve quantos voxels foram pintados.
 */
export function pintarMascara(pilhaId: string, mascara: Uint8Array, nx: number, ny: number): number {
  const seg = porPilha.get(pilhaId);
  if (!seg) return 0;
  const vol = cache.getVolume(seg.labelmapId);
  const vm = vol?.voxelManager;
  if (!vm) return 0;
  const bloqueados = new Set(seg.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  if (bloqueados.has(seg.ativo)) return 0;
  const porCorte = nx * ny;
  const cortes = new Set<number>();
  let pintados = 0;
  for (let i = 0; i < mascara.length; i++) {
    if (mascara[i] !== 1) continue;
    const atual = vm.getAtIndex(i) as number;
    if (atual === seg.ativo || (atual !== 0 && bloqueados.has(atual))) continue;
    vm.setAtIndex(i, seg.ativo);
    cortes.add(Math.floor(i / porCorte));
    pintados++;
  }
  if (pintados > 0) {
    segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
  }
  return pintados;
}

/** Valores que estavam nos voxels antes de uma pintura, para desfazê-la. */
export interface PinturaDesfazivel {
  indices: Int32Array;
  anteriores: Uint8Array;
}

/**
 * Pinta os voxels `indices` (lineares, na grade do volume) no segmento ativo, sem sobrescrever
 * segmentos bloqueados. Devolve o que havia nos voxels mudados, para `desfazerPintura`.
 */
export function pintarIndices(pilhaId: string, indices: ArrayLike<number>, porCorte: number): PinturaDesfazivel {
  const vazio: PinturaDesfazivel = { indices: new Int32Array(0), anteriores: new Uint8Array(0) };
  const seg = porPilha.get(pilhaId);
  const vm = seg ? cache.getVolume(seg.labelmapId)?.voxelManager : undefined;
  if (!seg || !vm) return vazio;
  const bloqueados = new Set(seg.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  if (bloqueados.has(seg.ativo)) return vazio;
  const mudados: number[] = [];
  const antes: number[] = [];
  const cortes = new Set<number>();
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n]!;
    const atual = vm.getAtIndex(i) as number;
    if (atual === seg.ativo || (atual !== 0 && bloqueados.has(atual))) continue;
    vm.setAtIndex(i, seg.ativo);
    mudados.push(i);
    antes.push(atual);
    cortes.add(Math.floor(i / porCorte));
  }
  if (mudados.length > 0) {
    segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
  }
  return { indices: Int32Array.from(mudados), anteriores: Uint8Array.from(antes) };
}

/** Devolve aos voxels o que havia antes de `pintarIndices`. */
export function desfazerPintura(pilhaId: string, pintura: PinturaDesfazivel, porCorte: number): void {
  const seg = porPilha.get(pilhaId);
  const vm = seg ? cache.getVolume(seg.labelmapId)?.voxelManager : undefined;
  if (!seg || !vm || pintura.indices.length === 0) return;
  const cortes = new Set<number>();
  for (let n = 0; n < pintura.indices.length; n++) {
    vm.setAtIndex(pintura.indices[n]!, pintura.anteriores[n]!);
    cortes.add(Math.floor(pintura.indices[n]! / porCorte));
  }
  segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
}

/** Um corte da máscara num dos três eixos da grade: eixo (0 = i, 1 = j, 2 = k) e posição. */
export interface CorteDaMascara {
  eixo: 0 | 1 | 2;
  posicao: number;
}

/**
 * Corte da máscara que o viewport mostra: `normal` é a normal da câmera e `ponto` um ponto do
 * plano (mm). Plano oblíquo à grade devolve undefined (não há um corte só).
 */
export function corteDaMascara(
  pilhaId: string,
  normal: ArrayLike<number>,
  ponto: [number, number, number],
): CorteDaMascara | undefined {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  if (!vol) return undefined;
  const grid = gridFromVolumeProps({
    dimensions: vol.dimensions,
    spacing: vol.spacing,
    origin: vol.origin,
    direction: vol.direction,
  });
  const passos = [grid.stepI, grid.stepJ, grid.stepK];
  const norma = Math.hypot(normal[0]!, normal[1]!, normal[2]!) || 1;
  let eixo: 0 | 1 | 2 | undefined;
  for (const e of [0, 1, 2] as const) {
    const p = passos[e]!;
    const cos = Math.abs(p[0] * normal[0]! + p[1] * normal[1]! + p[2] * normal[2]!) / (Math.hypot(p[0], p[1], p[2]) * norma);
    if (cos > 0.999) eixo = e;
  }
  if (eixo === undefined) return undefined;
  const ijk = worldToVoxel(grid, ponto);
  if (!ijk) return undefined;
  const posicao = Math.round(ijk[eixo]!);
  if (posicao < 0 || posicao >= grid.dims[eixo]) return undefined;
  return { eixo, posicao };
}

/** Índices lineares dos voxels do corte, linha a linha, e o tamanho dele. */
function indicesDoCorte(dims: ArrayLike<number>, corte: CorteDaMascara): { indices: Int32Array; nu: number; nv: number } {
  const nx = dims[0]!;
  const ny = dims[1]!;
  const nz = dims[2]!;
  const eixoU = corte.eixo === 0 ? 1 : 0;
  const eixoV = corte.eixo === 2 ? 1 : 2;
  const tamanhos = [nx, ny, nz];
  const nu = tamanhos[eixoU]!;
  const nv = tamanhos[eixoV]!;
  const passo = [1, nx, nx * ny];
  const indices = new Int32Array(nu * nv);
  const base = corte.posicao * passo[corte.eixo]!;
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) indices[u + v * nu] = base + u * passo[eixoU]! + v * passo[eixoV]!;
  }
  return { indices, nu, nv };
}

/** Voxels do corte cercados pelo segmento ativo (o miolo de contornos fechados). */
export function buracosDoCorte(pilhaId: string, corte: CorteDaMascara): Set<number> {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const vm = vol?.voxelManager;
  const achados = new Set<number>();
  if (!seg || !vol || !vm) return achados;
  const { indices, nu, nv } = indicesDoCorte(vol.dimensions, corte);
  const dentro = new Uint8Array(indices.length);
  let algum = false;
  for (let p = 0; p < indices.length; p++) {
    if ((vm.getAtIndex(indices[p]!) as number) === seg.ativo) {
      dentro[p] = 1;
      algum = true;
    }
  }
  if (!algum) return achados;
  const buracos = buracosFechados(dentro, nu, nv);
  for (let p = 0; p < indices.length; p++) if (buracos[p] === 1) achados.add(indices[p]!);
  return achados;
}

/**
 * Pincel: preenche o miolo dos contornos que a pincelada fechou. `antes` são os buracos que já
 * existiam no corte (feitos de propósito, com a borracha, por exemplo): esses ficam como estão.
 * Só voxels sem segmento são pintados. Devolve quantos foram.
 */
export function preencherBuracosNovos(pilhaId: string, corte: CorteDaMascara, antes: Set<number>): number {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const vm = vol?.voxelManager;
  if (!seg || !vol || !vm) return 0;
  const novos: number[] = [];
  for (const i of buracosDoCorte(pilhaId, corte)) {
    if (!antes.has(i) && (vm.getAtIndex(i) as number) === 0) novos.push(i);
  }
  if (novos.length === 0) return 0;
  return pintarIndices(pilhaId, novos, vol.dimensions[0] * vol.dimensions[1]).indices.length;
}

/** Forma do segmento ativo num corte (1 = dentro), ou undefined se o corte não tem o segmento. */
function formaDoCorte(
  vm: { getAtIndex(i: number): unknown },
  indices: Int32Array,
  ativo: number,
): Uint8Array | undefined {
  const forma = new Uint8Array(indices.length);
  let algum = false;
  for (let p = 0; p < indices.length; p++) {
    if ((vm.getAtIndex(indices[p]!) as number) === ativo) {
      forma[p] = 1;
      algum = true;
    }
  }
  return algum ? forma : undefined;
}

/**
 * Pincel: liga o corte recém-pintado aos cortes pintados mais próximos (para cada lado), pintando
 * os cortes vazios entre eles com formas intermediárias. Só liga se a distância entre os dois
 * cortes pintados for de até `limiteMm` e não houver nada do segmento no meio. Só voxels sem
 * segmento são pintados. Devolve quantos cortes foram preenchidos.
 */
export function ligarCortesProximos(pilhaId: string, corte: CorteDaMascara, limiteMm: number): number {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const vm = vol?.voxelManager;
  if (!seg || !vol || !vm) return 0;
  const total = vol.dimensions[corte.eixo]!;
  const passoMm = vol.spacing[corte.eixo]!;
  const alcance = Math.floor(limiteMm / passoMm);
  if (alcance < 2) return 0;
  const { indices: indicesAqui, nu, nv } = indicesDoCorte(vol.dimensions, corte);
  const aqui = formaDoCorte(vm, indicesAqui, seg.ativo);
  if (!aqui) return 0;
  const porCorte = vol.dimensions[0] * vol.dimensions[1];
  let cortesPintados = 0;
  for (const sentido of [-1, 1]) {
    // Primeiro corte com o segmento neste sentido, dentro do alcance.
    let vizinho: { posicao: number; forma: Uint8Array } | undefined;
    for (let d = 1; d <= alcance; d++) {
      const posicao = corte.posicao + sentido * d;
      if (posicao < 0 || posicao >= total) break;
      const forma = formaDoCorte(vm, indicesDoCorte(vol.dimensions, { eixo: corte.eixo, posicao }).indices, seg.ativo);
      if (forma) {
        vizinho = { posicao, forma };
        break;
      }
    }
    const vazios = vizinho ? Math.abs(vizinho.posicao - corte.posicao) - 1 : 0;
    if (!vizinho || vazios < 1) continue;
    const formas = interpolarCortes(aqui, vizinho.forma, nu, nv, vazios);
    const novos: number[] = [];
    formas.forEach((forma, m) => {
      const posicao = corte.posicao + sentido * (m + 1);
      const destino = indicesDoCorte(vol.dimensions, { eixo: corte.eixo, posicao }).indices;
      for (let p = 0; p < forma.length; p++) {
        if (forma[p] === 1 && (vm.getAtIndex(destino[p]!) as number) === 0) novos.push(destino[p]!);
      }
    });
    if (novos.length > 0 && pintarIndices(pilhaId, novos, porCorte).indices.length > 0) cortesPintados += vazios;
  }
  return cortesPintados;
}

// ---------- salvar e reabrir (fase 9.3) ----------

/** Grade da máscara da pilha (a mesma do volume da série). */
export function geometriaDaSegmentacao(pilhaId: string): GeometriaSalva | undefined {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  if (!vol) return undefined;
  return {
    dims: [vol.dimensions[0], vol.dimensions[1], vol.dimensions[2]],
    spacing: [vol.spacing[0], vol.spacing[1], vol.spacing[2]],
    origin: [vol.origin[0], vol.origin[1], vol.origin[2]],
    direction: Array.from(vol.direction as ArrayLike<number>),
  };
}

/** Segmentos, segmento ativo e uma cópia dos rótulos (1 byte por voxel) para salvar. */
export function dadosParaSalvar(
  pilhaId: string,
): { segmentos: SegmentoSalvo[]; ativo: number; rotulos: Uint8Array; geometria: GeometriaSalva } | undefined {
  const seg = porPilha.get(pilhaId);
  const geometria = geometriaDaSegmentacao(pilhaId);
  const dados = seg ? cache.getVolume(seg.labelmapId)?.voxelManager?.getCompleteScalarDataArray?.() : undefined;
  if (!seg || !geometria || !dados) return undefined;
  return {
    segmentos: seg.segmentos.map((s) => ({ ...s, cor: [...s.cor] as [number, number, number] })),
    ativo: seg.ativo,
    rotulos: Uint8Array.from(dados as ArrayLike<number>),
    geometria,
  };
}

/** Há algum voxel pintado na segmentação da pilha? */
export function temVoxelsPintados(pilhaId: string): boolean {
  const seg = porPilha.get(pilhaId);
  const dados = seg ? cache.getVolume(seg.labelmapId)?.voxelManager?.getCompleteScalarDataArray?.() : undefined;
  if (!dados) return false;
  for (let i = 0; i < dados.length; i++) if (dados[i] !== 0) return true;
  return false;
}

/**
 * Substitui a máscara e os segmentos da pilha pelos de um arquivo (a geometria já foi conferida).
 * A segmentação da pilha precisa existir.
 */
export function aplicarSegmentacaoSalva(pilhaId: string, segmentos: SegmentoSalvo[], ativo: number, rotulos: Uint8Array): void {
  const seg = porPilha.get(pilhaId);
  const vm = seg ? cache.getVolume(seg.labelmapId)?.voxelManager : undefined;
  if (!seg || !vm) throw new Error('Segmentação indisponível.');
  if (vm.setCompleteScalarDataArray) {
    vm.setCompleteScalarDataArray(rotulos);
  } else {
    for (let i = 0; i < rotulos.length; i++) vm.setAtIndex(i, rotulos[i]!);
  }
  const lista = segmentos.length
    ? segmentos
    : [{ indice: 1, nome: 'Segmento 1', cor: PALETA[0]!, visivel: true, bloqueado: false }];
  seg.segmentos = lista.map((s) => ({ ...s, cor: [...s.cor] as [number, number, number] }));
  const segmentosCs: Record<number, { segmentIndex: number; label: string; locked: boolean; cachedStats: Record<string, unknown>; active: boolean }> = {};
  for (const s of seg.segmentos) {
    seg.lut[s.indice] = corRgba(s.cor);
    segmentosCs[s.indice] = { segmentIndex: s.indice, label: s.nome, locked: s.bloqueado, cachedStats: {}, active: false };
  }
  segmentation.updateSegmentations([{ segmentationId: seg.segmentationId, payload: { segments: segmentosCs } }]);
  for (const s of seg.segmentos) {
    segmentation.segmentLocking.setSegmentIndexLocked(seg.segmentationId, s.indice, s.bloqueado);
    for (const vp of viewportsCom(seg)) {
      segmentation.config.color.setSegmentIndexColor(vp, seg.segmentationId, s.indice, corRgba(s.cor));
      segmentation.config.visibility.setSegmentIndexVisibility(
        vp,
        { segmentationId: seg.segmentationId, type: LABELMAP },
        s.indice,
        s.visivel,
      );
    }
  }
  const ativoValido = seg.segmentos.some((s) => s.indice === ativo) ? ativo : seg.segmentos[0]!.indice;
  definirSegmentoAtivo(pilhaId, ativoValido);
  const nz = cache.getVolume(seg.labelmapId)?.dimensions[2] ?? 0;
  segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
    seg.segmentationId,
    Array.from({ length: nz }, (_, k) => k),
  );
  // A troca da lista de segmentos pode voltar todos a visíveis logo depois: reaplica o painel.
  setTimeout(() => {
    for (const vp of viewportsCom(seg)) sincronizarVisibilidade(seg, vp);
  }, 50);
  avisar();
}
