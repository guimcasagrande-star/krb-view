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
import { CacheSuperficie3d, type MalhaSuperficie3d } from './superficie3d';
import {
  obterPresetTotalSegmentator,
  type EstadoTotalSegPuro,
  type PresetTotalSegId,
  type ResumoImportacaoTotalSeg,
} from './totalSegmentator';
import {
  PADRAO_DELTA_MAX_VASO,
  PADRAO_DELTA_MIN_VASO,
  podeReaproveitarPlaceholder,
  PRESETS_VASO,
  proximoNomeECorVaso,
  type ModoVaso,
  type ModoVasoInteligente,
  type UltimaSementeVaso,
} from './vaso';
import { type LinhaVolumetria, volumetriaDosSegmentos, volumetriaDosSegmentosPorFatias } from './volumetria';
import type { GeometriaSalva, SegmentoSalvo } from './arquivoSegmentacao';
import {
  calcularSuperficiesNoWorker,
  calcularVolumetriaNoWorker,
  descartarVolumeDoWorker,
  limparSuperficiesNoWorker,
  processarTotalSegmentatorNoWorker,
} from '../workers/computeClient';

const LABELMAP = EnumsTools.SegmentationRepresentations.Labelmap;

/** Disparado em `document` quando segmentos, segmento ativo, estilo ou faixa mudam. */
export const EVENTO_SEGMENTACAO = 'segmentacaoMudou';

/** Disparado em `document` quando as superfícies 3D (malha, cor, opacidade ou modo 3D) precisam atualizar. */
export const EVENTO_SUPERFICIE_3D = 'superficie3dMudou';

export type ModoExibicao3d = 'ambos' | 'superficies' | 'volume';

export interface Segmento {
  indice: number;
  nome: string;
  cor: [number, number, number];
  visivel: boolean;
  bloqueado: boolean;
  visivel3d: boolean;
  opacidade3d: number;
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
  temporizadorSuperficie?: ReturnType<typeof setTimeout>;
  temporizadorEdicao?: ReturnType<typeof setTimeout>;
  pendentesMascara?: { todos: boolean; indices: Set<number> };
  ultimaSementeVaso?: UltimaSementeVaso;
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

/** Garante a criação da segmentação da pilha antes de importar máscaras; fornecido por `viewport2d`. */
export type ResolvedorCriacaoSegmentacao = (pilhaId: string) => Promise<void>;

let resolvedorCriacao: ResolvedorCriacaoSegmentacao | null = null;

export function definirResolvedorCriacaoSegmentacao(fn: ResolvedorCriacaoSegmentacao): void {
  resolvedorCriacao = fn;
}

/** Espera depois da última edição antes de recalcular (não recalcula a cada pincelada). */
const ATRASO_VOLUMETRIA_MS = 600;
const ATRASO_EDICAO_MASCARA_MS = 450;

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
const cacheSuperficies = new CacheSuperficie3d();
const cacheSuperficiesAsync = new Map<string, Map<number, { assinatura: string; malha: MalhaSuperficie3d; sujo: boolean }>>();

function marcarSuperficiesSujas(pilhaId: string, segmentIndex?: number): void {
  cacheSuperficies.marcarSujo(pilhaId, segmentIndex);
  const mapa = cacheSuperficiesAsync.get(pilhaId);
  if (!mapa) return;
  if (segmentIndex !== undefined) {
    const e = mapa.get(segmentIndex);
    if (e) e.sujo = true;
    return;
  }
  for (const e of mapa.values()) e.sujo = true;
}

function removerSegmentoSuperficieCache(pilhaId: string, segmentIndex: number): void {
  cacheSuperficies.removerSegmento(pilhaId, segmentIndex);
  cacheSuperficiesAsync.get(pilhaId)?.delete(segmentIndex);
  limparSuperficiesNoWorker(pilhaId, segmentIndex);
}

function removerPilhaSuperficieCache(pilhaId: string): void {
  cacheSuperficies.removerPilha(pilhaId);
  cacheSuperficiesAsync.delete(pilhaId);
  limparSuperficiesNoWorker(pilhaId);
}

let modo3d: ModoExibicao3d = 'ambos';
let atualizandoInternamente = false;
let autoLigarCortes = true;
let verificadorViewport3d: ((pilhaId: string) => boolean) | null = null;

export function autoLigarCortesPincel(): boolean {
  return autoLigarCortes;
}

export function definirAutoLigarCortesPincel(ligado: boolean): void {
  if (autoLigarCortes === ligado) return;
  autoLigarCortes = ligado;
  avisar();
}

function lerFatiasLabelmap(vol: Types.IImageVolume | undefined): Uint8Array[] | undefined {
  if (!vol?.imageIds?.length) return undefined;
  const [nx, ny, nz] = vol.dimensions;
  const sliceLen = nx * ny;
  if (sliceLen <= 0 || vol.imageIds.length !== nz) return undefined;
  const fatias: Uint8Array[] = new Array(nz);
  for (let k = 0; k < nz; k++) {
    const img = cache.getImage(vol.imageIds[k]!);
    const px = img?.getPixelData?.() as Uint8Array | undefined;
    if (!px || px.length !== sliceLen) return undefined;
    fatias[k] = px;
  }
  return fatias;
}

function lerCorteAxialSemCopia(vol: Types.IImageVolume, corte: CorteDaMascara): Uint8Array | undefined {
  if (corte.eixo !== 2) return undefined;
  const id = vol.imageIds?.[corte.posicao];
  if (!id) return undefined;
  const px = cache.getImage(id)?.getPixelData?.() as Uint8Array | undefined;
  const esperado = vol.dimensions[0] * vol.dimensions[1];
  return px && px.length === esperado ? px : undefined;
}

function materializarRotulosLabelmap(vol: Types.IImageVolume | undefined): Uint8Array | undefined {
  if (!vol) return undefined;
  const fatias = lerFatiasLabelmap(vol);
  if (fatias) {
    const [nx, ny, nz] = vol.dimensions;
    const sliceLen = nx * ny;
    const saida = new Uint8Array(sliceLen * nz);
    for (let k = 0; k < nz; k++) saida.set(fatias[k]!, k * sliceLen);
    return saida;
  }
  const dados = vol.voxelManager?.getCompleteScalarDataArray?.();
  if (!dados) return undefined;
  return dados instanceof Uint8Array ? dados : Uint8Array.from(dados as ArrayLike<number>);
}

export function definirVerificadorViewport3d(fn: (pilhaId: string) => boolean): void {
  verificadorViewport3d = fn;
}

export function temEdicaoMascaraPendente(pilhaId: string | undefined): boolean {
  const seg = pilhaId ? porPilha.get(pilhaId) : undefined;
  return !!seg?.temporizadorEdicao || !!seg?.temporizadorSuperficie;
}

/** Aparência do preenchimento, igual para todas as segmentações. */
const estilo = { opacidade: 0.5, soContorno: false };

/** Faixa de valores (HU ou SUV) do pincel com limiar e do crescer região; null = não definido. */
const faixa: { min: number | null; max: number | null } = { min: null, max: null };

function avisar(): void {
  document.dispatchEvent(new CustomEvent(EVENTO_SEGMENTACAO));
}

function avisarSuperficies(pilhaId?: string): void {
  document.dispatchEvent(new CustomEvent(EVENTO_SUPERFICIE_3D, { detail: { pilhaId } }));
}

function agendarSuperficies(seg: SegmentacaoDaPilha, atrasoMs = 120): void {
  if (seg.temporizadorSuperficie) clearTimeout(seg.temporizadorSuperficie);
  seg.temporizadorSuperficie = setTimeout(() => {
    seg.temporizadorSuperficie = undefined;
    avisarSuperficies(seg.pilhaId);
  }, atrasoMs);
}

export function modoExibicao3d(): ModoExibicao3d {
  return modo3d;
}

export function definirModoExibicao3d(modo: ModoExibicao3d): void {
  if (modo3d === modo) return;
  modo3d = modo;
  avisar();
  avisarSuperficies();
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

/** Configuração da ferramenta Vaso (modo automático/arterial/venoso, alcance e criação de segmento). */
const configVaso = {
  modo: 'auto' as ModoVasoInteligente,
  alcancePct: 100,
  deltaMin: PADRAO_DELTA_MIN_VASO,
  deltaMax: PADRAO_DELTA_MAX_VASO,
  novoSegmento: true,
};

export function vasoConfig(): Readonly<typeof configVaso> {
  return configVaso;
}

export function definirConfigVaso(parcial: Partial<typeof configVaso>): void {
  if (parcial.modo !== undefined) {
    configVaso.modo = parcial.modo;
  }
  if (parcial.alcancePct !== undefined && Number.isFinite(parcial.alcancePct)) {
    configVaso.alcancePct = Math.min(160, Math.max(50, Math.round(parcial.alcancePct)));
  }
  if (parcial.deltaMin !== undefined && Number.isFinite(parcial.deltaMin)) {
    configVaso.deltaMin = parcial.deltaMin;
  }
  if (parcial.deltaMax !== undefined && Number.isFinite(parcial.deltaMax)) {
    configVaso.deltaMax = parcial.deltaMax;
  }
  if (parcial.novoSegmento !== undefined) {
    configVaso.novoSegmento = parcial.novoSegmento;
  }
  avisar();
}

export function aplicarPresetVaso(modo: ModoVasoInteligente): void {
  configVaso.modo = modo;
  if (modo === 'arterial' || modo === 'venoso') {
    const p = PRESETS_VASO[modo];
    configVaso.deltaMin = p.deltaMin;
    configVaso.deltaMax = p.deltaMax;
  }
  avisar();
}

export function desfazerUltimoVaso(pilhaId: string): boolean {
  const seg = porPilha.get(pilhaId);
  const ultima = seg?.ultimaSementeVaso;
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  if (!seg || !ultima || !vol) return false;
  const porCorte = vol.dimensions[0] * vol.dimensions[1];
  reaplicarIndicesNoSegmento(pilhaId, ultima.segmentoIndice, ultima.indicesPintados, new Int32Array(0), porCorte);
  seg.ultimaSementeVaso = undefined;
  avisar();
  return true;
}

export function registrarUltimaSementeVaso(pilhaId: string, semente: UltimaSementeVaso | undefined): void {
  const seg = porPilha.get(pilhaId);
  if (seg) seg.ultimaSementeVaso = semente;
}

export function ultimaSementeVasoDa(pilhaId: string | null | undefined): UltimaSementeVaso | undefined {
  return pilhaId ? porPilha.get(pilhaId)?.ultimaSementeVaso : undefined;
}

export type ResolvedorRecalculoVaso = (pilhaId: string, cor?: [number, number, number]) => Promise<string | undefined>;

let resolvedorRecalculoVaso: ResolvedorRecalculoVaso | null = null;

export function definirResolvedorRecalculoVaso(fn: ResolvedorRecalculoVaso): void {
  resolvedorRecalculoVaso = fn;
}

export async function recalcularUltimoVaso(
  pilhaId: string,
  cor?: [number, number, number],
): Promise<string | undefined> {
  if (!resolvedorRecalculoVaso || !porPilha.get(pilhaId)?.ultimaSementeVaso) return undefined;
  return resolvedorRecalculoVaso(pilhaId, cor);
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
    segmentos: [
      {
        indice: 1,
        nome: 'Segmento 1',
        cor: PALETA[0]!,
        visivel: true,
        bloqueado: false,
        visivel3d: true,
        opacidade3d: 0.9,
      },
    ],
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
  if (seg.temporizadorSuperficie) clearTimeout(seg.temporizadorSuperficie);
  if (seg.temporizadorEdicao) clearTimeout(seg.temporizadorEdicao);
  removerPilhaSuperficieCache(pilhaId);
  descartarVolumeDoWorker(pilhaId);
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
  avisarSuperficies(pilhaId);
}

/** Apaga todas (ao abrir outra pasta ou limpar a lista). */
export function apagarTodasSegmentacoes(): void {
  for (const id of [...porPilha.keys()]) apagarSegmentacao(id);
  descartarVolumeDoWorker();
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
  try {
    const valores = await resolvedorValores(seg.pilhaId);
    if (porPilha.get(seg.pilhaId) !== seg) return;
    if ('erro' in valores) {
      seg.volumetria = { linhas: [], unidade: '', ehPet: false, erro: valores.erro };
      return;
    }
    const vol = cache.getVolume(seg.labelmapId);
    const segLista = seg.segmentos.map((s) => ({ indice: s.indice, nome: s.nome }));
    let linhas: LinhaVolumetria[];
    if (typeof Worker !== 'undefined') {
      const rotulos = materializarRotulosLabelmap(vol);
      if (!rotulos) {
        seg.volumetria = { linhas: [], unidade: valores.unidade, ehPet: valores.ehPet, erro: 'Máscara indisponível.' };
        return;
      }
      linhas = await calcularVolumetriaNoWorker(seg.pilhaId, rotulos, valores.volume, segLista, valores.ehPet);
      if (porPilha.get(seg.pilhaId) !== seg) return;
    } else {
      const fatias = lerFatiasLabelmap(vol);
      if (fatias) {
        linhas = volumetriaDosSegmentosPorFatias(fatias, valores.volume, segLista, valores.ehPet);
      } else {
        const rotulos = vol?.voxelManager?.getCompleteScalarDataArray?.();
        if (!rotulos) {
          seg.volumetria = { linhas: [], unidade: valores.unidade, ehPet: valores.ehPet, erro: 'Máscara indisponível.' };
          return;
        }
        linhas = volumetriaDosSegmentos(rotulos as ArrayLike<number>, valores.volume, segLista, valores.ehPet);
      }
    }
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

function agendarEdicaoMascara(seg: SegmentacaoDaPilha, segmentIndex?: number): void {
  const p = (seg.pendentesMascara ??= { todos: false, indices: new Set<number>() });
  if (segmentIndex === undefined) p.todos = true;
  else p.indices.add(segmentIndex);

  if (seg.temporizadorEdicao) clearTimeout(seg.temporizadorEdicao);
  seg.temporizadorEdicao = setTimeout(() => {
    seg.temporizadorEdicao = undefined;
    const pend = seg.pendentesMascara;
    seg.pendentesMascara = undefined;
    if (pend) {
      if (pend.todos) marcarSuperficiesSujas(seg.pilhaId);
      else for (const idx of pend.indices) marcarSuperficiesSujas(seg.pilhaId, idx);
    }
    if (!verificadorViewport3d || verificadorViewport3d(seg.pilhaId)) {
      avisarSuperficies(seg.pilhaId);
    }
    void calcularVolumetria(seg);
  }, ATRASO_EDICAO_MASCARA_MS);
}

// Qualquer edição da máscara (pincel, esfera, borracha, preencher, crescer região, apagar
// segmento) dispara este evento do Cornerstone: aguarda o fim do arrasto (450 ms) antes de
// invalidar malha 3D e recalcular volumetria, sem disparar `avisar()` sincronicamente.
eventTarget.addEventListener(EnumsTools.Events.SEGMENTATION_DATA_MODIFIED, (e: Event) => {
  const detalhe = (e as CustomEvent<{ segmentationId?: string; segmentIndex?: number }>).detail;
  const id = detalhe?.segmentationId;
  for (const seg of porPilha.values()) {
    if (seg.segmentationId !== id) continue;
    if (atualizandoInternamente) {
      agendarVolumetria(seg);
    } else {
      agendarEdicaoMascara(seg, detalhe?.segmentIndex);
    }
  }
});

export interface OpcoesNovoSegmento {
  nome?: string;
  cor?: [number, number, number];
}

export function novoSegmento(pilhaId: string, opcoes?: OpcoesNovoSegmento): Segmento | undefined {
  const seg = porPilha.get(pilhaId);
  if (!seg) return undefined;
  const indice = Math.max(0, ...seg.segmentos.map((s) => s.indice)) + 1;
  if (indice > 255) return undefined;
  const cor = opcoes?.cor ?? PALETA[(indice - 1) % PALETA.length]!;
  const nome = opcoes?.nome?.trim() || `Segmento ${indice}`;
  const novo: Segmento = {
    indice,
    nome,
    cor,
    visivel: true,
    bloqueado: false,
    visivel3d: true,
    opacidade3d: 0.9,
  };
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
  for (const vp of viewportsCom(seg)) {
    segmentation.config.color.setSegmentIndexColor(vp, seg.segmentationId, indice, corRgba(cor));
  }
  definirSegmentoAtivo(pilhaId, indice);
  agendarVolumetria(seg);
  return novo;
}

/**
 * Cria (ou reaproveita o "Segmento 1" vazio recém-criado) um segmento arterial "Vaso N" e o
 * define como ativo para receber os voxels crescidos.
 */
export function prepararSegmentoVaso(pilhaId: string, modoEfetivo?: ModoVaso): Segmento | undefined {
  const seg = porPilha.get(pilhaId);
  if (!seg) return undefined;
  const modoCor: ModoVaso =
    modoEfetivo ?? (configVaso.modo === 'venoso' ? 'venoso' : 'arterial');
  const { nome, cor } = proximoNomeECorVaso(seg.segmentos, modoCor);
  if (podeReaproveitarPlaceholder(seg.segmentos, temVoxelsPintados(pilhaId))) {
    const alvo = seg.segmentos[0]!;
    renomearSegmento(pilhaId, alvo.indice, nome);
    definirCorSegmento(pilhaId, alvo.indice, cor);
    definirSegmentoAtivo(pilhaId, alvo.indice);
    return alvo;
  }
  return novoSegmento(pilhaId, { nome, cor });
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
  atualizandoInternamente = true;
  try {
    segmentation.removeSegment(seg.segmentationId, indice, { setNextSegmentAsActive: false });
  } finally {
    atualizandoInternamente = false;
  }
  removerSegmentoSuperficieCache(pilhaId, indice);
  if (seg.ultimaSementeVaso?.segmentoIndice === indice) seg.ultimaSementeVaso = undefined;
  seg.segmentos = seg.segmentos.filter((s) => s.indice !== indice);
  agendarVolumetria(seg);
  if (seg.segmentos.length === 0) {
    // Mantém sempre um segmento para pintar.
    novoSegmento(pilhaId);
    avisarSuperficies(pilhaId);
    return;
  }
  if (seg.ativo === indice) definirSegmentoAtivo(pilhaId, seg.segmentos[0]!.indice);
  else avisar();
  avisarSuperficies(pilhaId);
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
  avisarSuperficies(pilhaId);
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
  avisarSuperficies(pilhaId);
}

export function definirVisivel3dSegmento(pilhaId: string, indice: number, visivel3d: boolean): void {
  const seg = porPilha.get(pilhaId);
  const s = seg?.segmentos.find((x) => x.indice === indice);
  if (!seg || !s || s.visivel3d === visivel3d) return;
  s.visivel3d = visivel3d;
  avisar();
  avisarSuperficies(pilhaId);
}

export function definirVisivel3dTodos(pilhaId: string, visivel3d: boolean): void {
  const seg = porPilha.get(pilhaId);
  if (!seg) return;
  let mudou = false;
  for (const s of seg.segmentos) {
    if (s.visivel3d !== visivel3d) {
      s.visivel3d = visivel3d;
      mudou = true;
    }
  }
  if (!mudou) return;
  avisar();
  avisarSuperficies(pilhaId);
}

export function definirOpacidade3dSegmento(pilhaId: string, indice: number, opacidade3d: number): void {
  const seg = porPilha.get(pilhaId);
  const s = seg?.segmentos.find((x) => x.indice === indice);
  if (!seg || !s) return;
  s.opacidade3d = Math.min(1, Math.max(0, opacidade3d));
  avisar();
  avisarSuperficies(pilhaId);
}

/** Obtém (ou gera e coloca em cache) a malha poligonal 3D do segmento no espaço físico da série. */
export function superficieDoSegmento(
  pilhaId: string,
  indice: number,
): { malha: MalhaSuperficie3d; doCache: boolean } | undefined {
  if (verificadorViewport3d && !verificadorViewport3d(pilhaId)) return undefined;
  const limpo = cacheSuperficies.obterSeLimpo(pilhaId, indice);
  if (limpo) return limpo;
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const dados = materializarRotulosLabelmap(vol);
  if (!seg || !vol || !dados) return undefined;
  const grid = gridFromVolumeProps({
    dimensions: vol.dimensions,
    spacing: vol.spacing,
    origin: vol.origin,
    direction: vol.direction,
  });
  return cacheSuperficies.obter(pilhaId, dados, grid, indice);
}

/**
 * Resolve em lote as malhas 3D de todos os segmentos solicitados, lendo o labelmap no máximo
 * uma única vez se houver algum segmento sujo ou ausente do cache.
 */
export function superficiesDosSegmentos(
  pilhaId: string,
  indices: readonly number[],
): Map<number, { malha: MalhaSuperficie3d; doCache: boolean }> {
  const resultado = new Map<number, { malha: MalhaSuperficie3d; doCache: boolean }>();
  if (indices.length === 0) return resultado;
  if (verificadorViewport3d && !verificadorViewport3d(pilhaId)) return resultado;

  const sujos: number[] = [];
  for (const indice of indices) {
    const limpo = cacheSuperficies.obterSeLimpo(pilhaId, indice);
    if (limpo) resultado.set(indice, limpo);
    else sujos.push(indice);
  }
  if (sujos.length === 0) return resultado;

  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const dados = materializarRotulosLabelmap(vol);
  if (!seg || !vol || !dados) return resultado;

  const grid = gridFromVolumeProps({
    dimensions: vol.dimensions,
    spacing: vol.spacing,
    origin: vol.origin,
    direction: vol.direction,
  });
  const calculadas = cacheSuperficies.obterLote(pilhaId, dados, grid, sujos);
  for (const [idx, val] of calculadas) resultado.set(idx, val);
  return resultado;
}

/**
 * Consulta síncrona do cache assíncrono: separa malhas já limpas das que precisam rodar no Worker.
 */
export function obterSuperficiesEmCache(
  pilhaId: string,
  indices: readonly number[],
): { prontas: Map<number, MalhaSuperficie3d>; pendentes: number[] } {
  const prontas = new Map<number, MalhaSuperficie3d>();
  const pendentes: number[] = [];
  if (verificadorViewport3d && !verificadorViewport3d(pilhaId)) return { prontas, pendentes };

  const mapa = cacheSuperficiesAsync.get(pilhaId);
  for (const indice of indices) {
    const entrada = mapa?.get(indice);
    if (entrada && !entrada.sujo) prontas.set(indice, entrada.malha);
    else pendentes.push(indice);
  }
  return { prontas, pendentes };
}

/**
 * Resolve em lote as malhas 3D fora da thread principal (via `compute.worker.ts`),
 * reaproveitando malhas locais cuja assinatura de voxels não tenha mudado.
 */
export async function superficiesDosSegmentosAsync(
  pilhaId: string,
  indices: readonly number[],
): Promise<Map<number, MalhaSuperficie3d>> {
  const { prontas, pendentes } = obterSuperficiesEmCache(pilhaId, indices);
  if (pendentes.length === 0) return prontas;

  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const dados = materializarRotulosLabelmap(vol);
  if (!seg || !vol || !dados) return prontas;

  const grid = gridFromVolumeProps({
    dimensions: vol.dimensions,
    spacing: vol.spacing,
    origin: vol.origin,
    direction: vol.direction,
  });

  let mapa = cacheSuperficiesAsync.get(pilhaId);
  if (!mapa) {
    mapa = new Map();
    cacheSuperficiesAsync.set(pilhaId, mapa);
  }
  const assinaturasLocais: Array<[number, string]> = [];
  for (const idx of pendentes) {
    const e = mapa.get(idx);
    if (e) assinaturasLocais.push([idx, e.assinatura]);
  }

  const itens = await calcularSuperficiesNoWorker(pilhaId, dados, grid, pendentes, assinaturasLocais);
  if (porPilha.get(pilhaId) !== seg) return prontas;

  for (const item of itens) {
    const atual = mapa.get(item.indice);
    if (item.reutilizarLocal && atual) {
      atual.sujo = false;
      prontas.set(item.indice, atual.malha);
    } else if (item.malha) {
      mapa.set(item.indice, { assinatura: item.assinatura, malha: item.malha, sujo: false });
      prontas.set(item.indice, item.malha);
    }
  }
  return prontas;
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
  const tocados = new Set<number>([seg.ativo]);
  let pintados = 0;
  for (let i = 0; i < mascara.length; i++) {
    if (mascara[i] !== 1) continue;
    const atual = vm.getAtIndex(i) as number;
    if (atual === seg.ativo || (atual !== 0 && bloqueados.has(atual))) continue;
    if (atual !== 0) tocados.add(atual);
    vm.setAtIndex(i, seg.ativo);
    cortes.add(Math.floor(i / porCorte));
    pintados++;
  }
  if (pintados > 0) {
    for (const t of tocados) marcarSuperficiesSujas(pilhaId, t);
    atualizandoInternamente = true;
    try {
      segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
    } finally {
      atualizandoInternamente = false;
    }
    agendarSuperficies(seg);
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
  const tocados = new Set<number>([seg.ativo]);
  for (let n = 0; n < indices.length; n++) {
    const i = indices[n]!;
    const atual = vm.getAtIndex(i) as number;
    if (atual === seg.ativo || (atual !== 0 && bloqueados.has(atual))) continue;
    if (atual !== 0) tocados.add(atual);
    vm.setAtIndex(i, seg.ativo);
    mudados.push(i);
    antes.push(atual);
    cortes.add(Math.floor(i / porCorte));
  }
  if (mudados.length > 0) {
    for (const t of tocados) marcarSuperficiesSujas(pilhaId, t);
    atualizandoInternamente = true;
    try {
      segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
    } finally {
      atualizandoInternamente = false;
    }
    agendarSuperficies(seg);
  }
  return { indices: Int32Array.from(mudados), anteriores: Uint8Array.from(antes) };
}

/** Devolve aos voxels o que havia antes de `pintarIndices`. */
export function desfazerPintura(pilhaId: string, pintura: PinturaDesfazivel, porCorte: number): void {
  const seg = porPilha.get(pilhaId);
  const vm = seg ? cache.getVolume(seg.labelmapId)?.voxelManager : undefined;
  if (!seg || !vm || pintura.indices.length === 0) return;
  const cortes = new Set<number>();
  const tocados = new Set<number>([seg.ativo]);
  for (let n = 0; n < pintura.indices.length; n++) {
    const idx = pintura.indices[n]!;
    const estava = vm.getAtIndex(idx) as number;
    const antigo = pintura.anteriores[n]!;
    if (estava !== 0) tocados.add(estava);
    if (antigo !== 0) tocados.add(antigo);
    vm.setAtIndex(idx, antigo);
    cortes.add(Math.floor(idx / porCorte));
  }
  for (const t of tocados) marcarSuperficiesSujas(pilhaId, t);
  atualizandoInternamente = true;
  try {
    segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], seg.ativo);
  } finally {
    atualizandoInternamente = false;
  }
  agendarSuperficies(seg);
}

/**
 * Atualiza em tempo real os voxels de um segmento (usado no ajuste fino da ferramenta Vaso):
 * apaga apenas `indicesAntigos` daquele segmento, grava `indicesNovos` e invalida só esse segmento.
 */
export function reaplicarIndicesNoSegmento(
  pilhaId: string,
  segmentoIndice: number,
  indicesAntigos: ArrayLike<number>,
  indicesNovos: ArrayLike<number>,
  porCorte: number,
): Int32Array {
  const seg = porPilha.get(pilhaId);
  const vm = seg ? cache.getVolume(seg.labelmapId)?.voxelManager : undefined;
  if (!seg || !vm) return new Int32Array(0);
  const bloqueados = new Set(seg.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  if (bloqueados.has(segmentoIndice)) return new Int32Array(0);

  const cortes = new Set<number>();
  const tocados = new Set<number>([segmentoIndice]);

  for (let n = 0; n < indicesAntigos.length; n++) {
    const i = indicesAntigos[n]!;
    if ((vm.getAtIndex(i) as number) === segmentoIndice) {
      vm.setAtIndex(i, 0);
      cortes.add(Math.floor(i / porCorte));
    }
  }

  const efetivos: number[] = [];
  for (let n = 0; n < indicesNovos.length; n++) {
    const i = indicesNovos[n]!;
    const atual = vm.getAtIndex(i) as number;
    if (atual !== 0 && atual !== segmentoIndice && bloqueados.has(atual)) continue;
    if (atual !== 0 && atual !== segmentoIndice) tocados.add(atual);
    vm.setAtIndex(i, segmentoIndice);
    efetivos.push(i);
    cortes.add(Math.floor(i / porCorte));
  }

  for (const t of tocados) marcarSuperficiesSujas(pilhaId, t);
  atualizandoInternamente = true;
  try {
    segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(seg.segmentationId, [...cortes], segmentoIndice);
  } finally {
    atualizandoInternamente = false;
  }
  agendarSuperficies(seg);
  return Int32Array.from(efetivos);
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
  const sliceDirect = lerCorteAxialSemCopia(vol, corte);
  let algum = false;
  if (sliceDirect) {
    for (let p = 0; p < sliceDirect.length; p++) {
      if (sliceDirect[p] === seg.ativo) {
        dentro[p] = 1;
        algum = true;
      }
    }
  } else {
    for (let p = 0; p < indices.length; p++) {
      if ((vm.getAtIndex(indices[p]!) as number) === seg.ativo) {
        dentro[p] = 1;
        algum = true;
      }
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
  vol: Types.IImageVolume,
  vm: { getAtIndex(i: number): unknown },
  corte: CorteDaMascara,
  indices: Int32Array,
  ativo: number,
): Uint8Array | undefined {
  const forma = new Uint8Array(indices.length);
  const sliceDirect = lerCorteAxialSemCopia(vol, corte);
  let algum = false;
  if (sliceDirect) {
    for (let p = 0; p < sliceDirect.length; p++) {
      if (sliceDirect[p] === ativo) {
        forma[p] = 1;
        algum = true;
      }
    }
  } else {
    for (let p = 0; p < indices.length; p++) {
      if ((vm.getAtIndex(indices[p]!) as number) === ativo) {
        forma[p] = 1;
        algum = true;
      }
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
  const aqui = formaDoCorte(vol, vm, corte, indicesAqui, seg.ativo);
  if (!aqui) return 0;
  const porCorte = vol.dimensions[0] * vol.dimensions[1];
  let cortesPintados = 0;
  for (const sentido of [-1, 1]) {
    // Primeiro corte com o segmento neste sentido, dentro do alcance.
    let vizinho: { posicao: number; forma: Uint8Array } | undefined;
    for (let d = 1; d <= alcance; d++) {
      const posicao = corte.posicao + sentido * d;
      if (posicao < 0 || posicao >= total) break;
      const corteVizinho: CorteDaMascara = { eixo: corte.eixo, posicao };
      const forma = formaDoCorte(vol, vm, corteVizinho, indicesDoCorte(vol.dimensions, corteVizinho).indices, seg.ativo);
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

/**
 * Limpa defeitos comuns de um segmento num volume de rótulos (função pura):
 * 1) Fecha buracos internos cercados pelo segmento em cada corte axial (`buracosFechados`),
 *    pintando apenas voxels vazios (`0`);
 * 2) Remove respingos/ilhotas 3D desconexas minúsculas (< 64 voxels e < 3% da maior componente).
 */
export function limparDefeitosMascaraPuro(
  rotulos: Uint8Array,
  dims: [number, number, number],
  indiceAlvo: number,
): { buracosPreenchidos: number; ilhasRemovidas: number; cortesTocados: number[] } {
  const [nx, ny, nz] = dims;
  const porCorte = nx * ny;
  const total = porCorte * nz;
  if (total === 0 || rotulos.length < total || indiceAlvo <= 0) {
    return { buracosPreenchidos: 0, ilhasRemovidas: 0, cortesTocados: [] };
  }

  let buracosPreenchidos = 0;
  const cortesSet = new Set<number>();
  const dentroCorte = new Uint8Array(porCorte);

  // 1. Fechar buracos internos 2D em cada corte axial
  for (let k = 0; k < nz; k++) {
    const base = k * porCorte;
    let temNoCorte = false;
    dentroCorte.fill(0);
    for (let p = 0; p < porCorte; p++) {
      if (rotulos[base + p] === indiceAlvo) {
        dentroCorte[p] = 1;
        temNoCorte = true;
      }
    }
    if (!temNoCorte) continue;
    const buracos = buracosFechados(dentroCorte, nx, ny);
    let preencheuAqui = false;
    for (let p = 0; p < porCorte; p++) {
      if (buracos[p] === 1 && rotulos[base + p] === 0) {
        rotulos[base + p] = indiceAlvo;
        buracosPreenchidos++;
        preencheuAqui = true;
      }
    }
    if (preencheuAqui) cortesSet.add(k);
  }

  // 2. Remover ilhotas 3D soltas minúsculas (conectividade-6)
  const visitado = new Uint8Array(total);
  const fila = new Int32Array(total);
  const componentes: Int32Array[] = [];
  let maiorTam = 0;

  for (let inicio = 0; inicio < total; inicio++) {
    if (rotulos[inicio] !== indiceAlvo || visitado[inicio] === 1) continue;
    visitado[inicio] = 1;
    let ini = 0;
    let fim = 0;
    fila[fim++] = inicio;
    while (ini < fim) {
      const idx = fila[ini++]!;
      const k = Math.floor(idx / porCorte);
      const resto = idx - k * porCorte;
      const j = Math.floor(resto / nx);
      const i = resto - j * nx;

      if (i > 0) {
        const v = idx - 1;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
      if (i + 1 < nx) {
        const v = idx + 1;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
      if (j > 0) {
        const v = idx - nx;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
      if (j + 1 < ny) {
        const v = idx + nx;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
      if (k > 0) {
        const v = idx - porCorte;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
      if (k + 1 < nz) {
        const v = idx + porCorte;
        if (visitado[v] === 0 && rotulos[v] === indiceAlvo) { visitado[v] = 1; fila[fim++] = v; }
      }
    }
    const comp = fila.slice(0, fim);
    componentes.push(comp);
    if (comp.length > maiorTam) maiorTam = comp.length;
  }

  let ilhasRemovidas = 0;
  if (componentes.length > 1 && maiorTam >= 20) {
    const limiarIlha = Math.max(4, Math.min(64, Math.floor(maiorTam * 0.03)));
    for (const comp of componentes) {
      if (comp.length <= limiarIlha) {
        for (let m = 0; m < comp.length; m++) {
          const idx = comp[m]!;
          rotulos[idx] = 0;
          ilhasRemovidas++;
          cortesSet.add(Math.floor(idx / porCorte));
        }
      }
    }
  }

  return {
    buracosPreenchidos,
    ilhasRemovidas,
    cortesTocados: [...cortesSet].sort((a, b) => a - b),
  };
}

/** Aplica `limparDefeitosMascaraPuro` ao segmento ativo da série e atualiza o viewport e a volumetria. */
export function corrigirDefeitosSegmentoAtivo(
  pilhaId: string,
): { buracosPreenchidos: number; ilhasRemovidas: number } | string {
  const seg = porPilha.get(pilhaId);
  if (!seg) return 'Nenhuma segmentação ativa nesta série.';
  const s = seg.segmentos.find((x) => x.indice === seg.ativo);
  if (!s) return 'Nenhum segmento selecionado.';
  if (s.bloqueado) return 'O segmento ativo está bloqueado.';
  const vol = cache.getVolume(seg.labelmapId);
  const vm = vol?.voxelManager;
  const dados = materializarRotulosLabelmap(vol);
  if (!vol || !vm || !dados) return 'Máscara indisponível.';

  const dims: [number, number, number] = [vol.dimensions[0], vol.dimensions[1], vol.dimensions[2]];
  const res = limparDefeitosMascaraPuro(dados, dims, seg.ativo);
  if (res.cortesTocados.length > 0) {
    const porCorte = dims[0] * dims[1];
    const fatias = lerFatiasLabelmap(vol);
    for (const k of res.cortesTocados) {
      const base = k * porCorte;
      if (fatias?.[k]) {
        fatias[k]!.set(dados.subarray(base, base + porCorte));
      } else {
        for (let p = 0; p < porCorte; p++) {
          vm.setAtIndex(base + p, dados[base + p]!);
        }
      }
    }
    marcarSuperficiesSujas(pilhaId, seg.ativo);
    atualizandoInternamente = true;
    try {
      segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
        seg.segmentationId,
        res.cortesTocados,
        seg.ativo,
      );
    } finally {
      atualizandoInternamente = false;
    }
    agendarVolumetria(seg);
    agendarSuperficies(seg);
  }
  return { buracosPreenchidos: res.buracosPreenchidos, ilhasRemovidas: res.ilhasRemovidas };
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
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const dados = materializarRotulosLabelmap(vol);
  if (!seg || !geometria || !dados) return undefined;
  return {
    segmentos: seg.segmentos.map((s) => ({ ...s, cor: [...s.cor] as [number, number, number] })),
    ativo: seg.ativo,
    rotulos: dados,
    geometria,
  };
}

/** Há algum voxel pintado na segmentação da pilha? */
export function temVoxelsPintados(pilhaId: string): boolean {
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  if (!vol) return false;
  const fatias = lerFatiasLabelmap(vol);
  if (fatias) {
    for (const fatia of fatias) {
      for (let i = 0; i < fatia.length; i++) if (fatia[i] !== 0) return true;
    }
    return false;
  }
  const dados = vol.voxelManager?.getCompleteScalarDataArray?.();
  if (!dados) return false;
  for (let i = 0; i < dados.length; i++) if (dados[i] !== 0) return true;
  return false;
}

function aplicarListaERotulos(
  seg: SegmentacaoDaPilha,
  lista: Segmento[],
  ativo: number,
  rotulos: Uint8Array,
): void {
  const vol = cache.getVolume(seg.labelmapId);
  const vm = vol?.voxelManager;
  if (!vm) throw new Error('Segmentação indisponível.');
  if (vm.setCompleteScalarDataArray) {
    vm.setCompleteScalarDataArray(rotulos);
  } else {
    for (let i = 0; i < rotulos.length; i++) vm.setAtIndex(i, rotulos[i]!);
  }
  seg.segmentos = lista;
  marcarSuperficiesSujas(seg.pilhaId);
  const segmentosCs: Record<
    number,
    { segmentIndex: number; label: string; locked: boolean; cachedStats: Record<string, unknown>; active: boolean }
  > = {};
  for (const s of seg.segmentos) {
    seg.lut[s.indice] = corRgba(s.cor);
    segmentosCs[s.indice] = { segmentIndex: s.indice, label: s.nome, locked: s.bloqueado, cachedStats: {}, active: false };
  }
  segmentation.updateSegmentations([{ segmentationId: seg.segmentationId, payload: { segments: segmentosCs } }]);
  const vps = viewportsCom(seg);
  for (const vp of vps) {
    segmentation.config.color.setColorLUT(vp, seg.segmentationId, seg.indiceLut);
  }
  const espec = { segmentationId: seg.segmentationId, type: LABELMAP };
  for (const s of seg.segmentos) {
    if (segmentation.segmentLocking.isSegmentIndexLocked(seg.segmentationId, s.indice) !== s.bloqueado) {
      segmentation.segmentLocking.setSegmentIndexLocked(seg.segmentationId, s.indice, s.bloqueado);
    }
    for (const vp of vps) {
      if (segmentation.config.visibility.getSegmentIndexVisibility(vp, espec, s.indice) !== s.visivel) {
        segmentation.config.visibility.setSegmentIndexVisibility(vp, espec, s.indice, s.visivel);
      }
    }
  }
  const ativoValido = seg.segmentos.some((s) => s.indice === ativo) ? ativo : seg.segmentos[0]!.indice;
  const nz = vol.dimensions[2] ?? 0;
  atualizandoInternamente = true;
  try {
    seg.ativo = ativoValido;
    segmentation.segmentIndex.setActiveSegmentIndex(seg.segmentationId, ativoValido);
    segmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
      seg.segmentationId,
      Array.from({ length: nz }, (_, k) => k),
    );
  } finally {
    atualizandoInternamente = false;
  }
  // A troca da lista de segmentos pode voltar todos a visíveis logo depois: reaplica o painel.
  setTimeout(() => {
    for (const vp of viewportsCom(seg)) sincronizarVisibilidade(seg, vp);
  }, 50);
  avisar();
  if (!verificadorViewport3d || verificadorViewport3d(seg.pilhaId)) {
    avisarSuperficies(seg.pilhaId);
  }
}

/**
 * Substitui a máscara e os segmentos da pilha pelos de um arquivo (a geometria já foi conferida).
 * A segmentação da pilha precisa existir.
 */
export function aplicarSegmentacaoSalva(pilhaId: string, segmentos: SegmentoSalvo[], ativo: number, rotulos: Uint8Array): void {
  const seg = porPilha.get(pilhaId);
  if (!seg) throw new Error('Segmentação indisponível.');
  const base = segmentos.length
    ? segmentos
    : [{ indice: 1, nome: 'Segmento 1', cor: PALETA[0]!, visivel: true, bloqueado: false, visivel3d: true, opacidade3d: 0.9 }];
  const lista: Segmento[] = base.map((s) => ({
    ...s,
    visivel3d: s.visivel3d ?? true,
    opacidade3d: s.opacidade3d ?? 0.9,
    cor: [...s.cor] as [number, number, number],
  }));
  aplicarListaERotulos(seg, lista, ativo, rotulos);
}

export type ResumoImportacaoTotalSegCom3d = ResumoImportacaoTotalSeg & {
  superficies3dOcultas?: boolean;
};

/**
 * Importa um arquivo multilabel ou múltiplos arquivos binários (`.nii` / `.nii.gz`) do
 * TotalSegmentator na pilha `pilhaId`, criando os segmentos traduzidos com cores anatômicas
 * e atualizando o labelmap 2D/3D e a volumetria.
 * Quando vários órgãos (> 2 novos) são importados de uma vez, as superfícies 3D iniciam
 * ocultas (`visivel3d: false`) para evitar congelamento da thread principal; o usuário liga
 * sob demanda os órgãos desejados no botão "3D".
 */
export async function importarArquivosTotalSegmentator(
  pilhaId: string,
  arquivos: Array<{ nome: string; bytes: Uint8Array }>,
): Promise<ResumoImportacaoTotalSegCom3d> {
  if (arquivos.length === 0) return { importados: 0, nomes: [], ignorados: [] };
  if (!porPilha.get(pilhaId) && resolvedorCriacao) {
    await resolvedorCriacao(pilhaId);
  }
  const seg = porPilha.get(pilhaId);
  const vol = seg ? cache.getVolume(seg.labelmapId) : undefined;
  const rotulosAtuais = materializarRotulosLabelmap(vol);
  if (!seg || !vol || !rotulosAtuais) {
    throw new Error('Abra a série num quadro de cortes antes de importar o TotalSegmentator.');
  }

  const grid = gridFromVolumeProps({
    dimensions: vol.dimensions,
    spacing: vol.spacing,
    origin: vol.origin,
    direction: vol.direction,
  });

  const anteriores = new Map(seg.segmentos.map((s) => [s.indice, s]));
  const estadoInicial: EstadoTotalSegPuro = {
    segmentos: seg.segmentos.map((s) => ({
      indice: s.indice,
      nome: s.nome,
      cor: [...s.cor] as [number, number, number],
      bloqueado: s.bloqueado,
    })),
    ativo: seg.ativo,
    rotulos: rotulosAtuais,
  };

  const { estado: estadoPuro, resumo } = await processarTotalSegmentatorNoWorker(estadoInicial, grid, arquivos);
  if (resumo.importados === 0 || porPilha.get(pilhaId) !== seg) return resumo;

  const novosCriados = estadoPuro.segmentos.filter((s) => !anteriores.has(s.indice)).length;
  const ocultar3dInicial = novosCriados > 2;

  const lista: Segmento[] = estadoPuro.segmentos.map((s) => {
    const ant = anteriores.get(s.indice);
    return {
      indice: s.indice,
      nome: s.nome,
      cor: [...s.cor] as [number, number, number],
      visivel: ant?.visivel ?? true,
      bloqueado: !!s.bloqueado,
      visivel3d: ant ? ant.visivel3d : !ocultar3dInicial,
      opacidade3d: ant?.opacidade3d ?? 0.9,
    };
  });

  aplicarListaERotulos(seg, lista, estadoPuro.ativo, estadoPuro.rotulos);
  return { ...resumo, superficies3dOcultas: ocultar3dInicial };
}

interface TauriCoreGlobal {
  __TAURI__?: {
    core?: {
      invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T>;
    };
  };
}

/**
 * Executa o TotalSegmentator localmente via comando Tauri `exames_rodar_totalsegmentator`,
 * lê os NIfTIs em binário bruto (sem JSON gigante no IPC) e processa tudo em Web Worker.
 */
export async function autoSegmentarTotalSegmentator(
  pilhaId: string,
  pastaSerie: string,
  presetId: PresetTotalSegId | string,
): Promise<ResumoImportacaoTotalSegCom3d> {
  const invoke = (globalThis as unknown as TauriCoreGlobal).__TAURI__?.core?.invoke;
  if (!invoke) {
    throw new Error('Auto-Segmentar (IA) está disponível apenas no aplicativo instalado (Tauri).');
  }
  const preset = obterPresetTotalSegmentator(presetId);
  const saida = await invoke<{ sessaoSaida: string; nomes: string[] }>('exames_rodar_totalsegmentator', {
    pastaSerie,
    tarefa: preset.tarefa,
    orgaos: preset.orgaos,
    modoRapido: preset.modoRapido,
  });

  try {
    if (!saida.nomes.length) {
      return { importados: 0, nomes: [], ignorados: [] };
    }
    const arquivos: Array<{ nome: string; bytes: Uint8Array }> = new Array(saida.nomes.length);
    let proximo = 0;
    const workers = Array.from({ length: Math.min(4, saida.nomes.length) }, async () => {
      while (proximo < saida.nomes.length) {
        const idx = proximo++;
        const nome = saida.nomes[idx];
        if (!nome) break;
        const bruto = await invoke<ArrayBuffer | Uint8Array | number[]>('exames_ler_saida_ts', {
          sessao: saida.sessaoSaida,
          nome,
        });
        const bytes =
          bruto instanceof Uint8Array
            ? bruto
            : bruto instanceof ArrayBuffer
              ? new Uint8Array(bruto)
              : Uint8Array.from(bruto);
        arquivos[idx] = { nome, bytes };
      }
    });
    await Promise.all(workers);
    return await importarArquivosTotalSegmentator(pilhaId, arquivos);
  } finally {
    void invoke('exames_limpar_saida_ts', { sessao: saida.sessaoSaida }).catch(() => undefined);
  }
}
