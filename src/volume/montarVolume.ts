/**
 * Gerenciador de volumes em streaming do Cornerstone3D.
 *
 * Regras:
 * - Só monta se `stack.geometry.volumeOk` e a memória estimada (`estimateVolumeBytes`)
 *   couber no limite configurado.
 * - Registra um provedor de metadados de fallback a partir de `stack.instances` (`InstanceMeta`)
 *   para que `createAndCacheVolume` tenha todos os metadados de todos os cortes antes mesmo
 *   de os pixels terminarem de decodificar nos workers.
 * - Um volume montado é guardado por `stack.id` e reutilizado por todos os viewports.
 * - Ao fechar a série (último viewport a usá-la), cancela o streaming se ainda
 *   estiver em andamento e remove o volume do cache.
 */

import { cache, Enums, metaData, volumeLoader, type Types } from '@cornerstonejs/core';
import type { StackNode } from '../io/organize';
import type { InstanceMeta } from '../io/types';
import {
  avaliarVolume,
  LIMITE_MEMORIA_PADRAO_BYTES,
  type MotivoRecusaVolume,
} from './validarVolume';

export type VolumeCarregado = Types.IImageVolume | Types.IStreamingImageVolume;

export type ResultadoAdquirirVolume =
  | {
      ok: true;
      volumeId: string;
      promessa: Promise<VolumeCarregado>;
    }
  | {
      ok: false;
      motivo: MotivoRecusaVolume;
      mensagens: string[];
    };

interface EntradaVolume {
  stackId: string;
  volumeId: string;
  imageIds: string[];
  refs: number;
  geracao: number;
  volume?: VolumeCarregado;
  promessa: Promise<VolumeCarregado>;
}

const ESQUEMA_VOLUME = 'cornerstoneStreamingImageVolume';
const volumes = new Map<string, EntradaVolume>();
const metaPorImageId = new Map<string, InstanceMeta>();
let provedorRegistrado = false;
let limiteMemoriaBytes = LIMITE_MEMORIA_PADRAO_BYTES;
let proximaGeracao = 0;

/**
 * Provedor de metadados de fallback (prioridade baixa) para `dicomfile:*`.
 * O `@cornerstonejs/dicom-image-loader` só popula seu cache de metadados depois
 * que cada arquivo é lido; como já lemos todos os cabeçalhos em `InstanceMeta`,
 * respondemos imediatamente para qualquer corte ainda não decodificado.
 */
function provedorMetadadosCabecalho(type: string, query: unknown): unknown {
  if (typeof query !== 'string') return undefined;
  const inst = metaPorImageId.get(query);
  if (!inst) return undefined;

  const { MetadataModules } = Enums;

  if (type === MetadataModules.IMAGE_PIXEL) {
    const bitsAllocated = inst.bitsAllocated ?? 16;
    const bitsStored = inst.bitsStored ?? bitsAllocated;
    return {
      samplesPerPixel: inst.samplesPerPixel ?? 1,
      photometricInterpretation: inst.photometricInterpretation ?? 'MONOCHROME2',
      rows: inst.rows,
      columns: inst.columns,
      bitsAllocated,
      bitsStored,
      highBit: bitsStored - 1,
      pixelRepresentation: inst.pixelRepresentation ?? 0,
    };
  }

  if (type === MetadataModules.IMAGE_PLANE) {
    const iop = inst.imageOrientationPatient;
    const ps = inst.pixelSpacing;
    return {
      frameOfReferenceUID: inst.frameOfReferenceUid ?? inst.seriesInstanceUid ?? 'for-padrao',
      rows: inst.rows,
      columns: inst.columns,
      imageOrientationPatient: iop ? [...iop] : undefined,
      rowCosines: iop ? [iop[0], iop[1], iop[2]] : null,
      columnCosines: iop ? [iop[3], iop[4], iop[5]] : null,
      imagePositionPatient: inst.imagePositionPatient ? [...inst.imagePositionPatient] : undefined,
      sliceThickness: inst.sliceThickness,
      spacingBetweenSlices: inst.spacingBetweenSlices,
      sliceLocation: inst.sliceLocation,
      pixelSpacing: ps ? [...ps] : undefined,
      rowPixelSpacing: ps ? ps[0] : 1,
      columnPixelSpacing: ps ? ps[1] : 1,
      usingDefaultValues: !ps,
    };
  }

  if (type === MetadataModules.GENERAL_SERIES) {
    return {
      modality: inst.modality,
      seriesInstanceUID: inst.seriesInstanceUid,
      seriesDescription: inst.seriesDescription,
      seriesNumber: inst.seriesNumber,
      studyInstanceUID: inst.studyInstanceUid,
    };
  }

  if (type === MetadataModules.VOI_LUT) {
    if (inst.windowCenter.length === 0 || inst.windowWidth.length === 0) return undefined;
    return {
      windowCenter: [...inst.windowCenter],
      windowWidth: [...inst.windowWidth],
    };
  }

  if (type === MetadataModules.MODALITY_LUT) {
    return {
      rescaleIntercept: inst.rescaleIntercept,
      rescaleSlope: inst.rescaleSlope,
    };
  }

  if (type === MetadataModules.TRANSFER_SYNTAX || type === 'transferSyntax') {
    return {
      transferSyntaxUID: inst.transferSyntaxUid,
    };
  }

  if (type === MetadataModules.SOP_COMMON) {
    return {
      sopClassUID: inst.sopClassUid,
      sopInstanceUID: inst.sopInstanceUid,
    };
  }

  if (type === MetadataModules.GENERAL_IMAGE) {
    return {
      sopInstanceUID: inst.sopInstanceUid,
      instanceNumber: inst.instanceNumber,
    };
  }

  return undefined;
}

function garantirProvedorMetadados(): void {
  if (provedorRegistrado) return;
  metaData.addProvider(provedorMetadadosCabecalho, -10);
  provedorRegistrado = true;
}

function registrarMetadadosPilha(stack: StackNode, imageIds: string[]): void {
  garantirProvedorMetadados();
  const n = Math.min(stack.instances.length, imageIds.length);
  for (let i = 0; i < n; i++) {
    metaPorImageId.set(imageIds[i]!, stack.instances[i]!);
  }
}

function removerMetadadosPilha(imageIds: string[]): void {
  for (const id of imageIds) {
    metaPorImageId.delete(id);
  }
}

export function configurarLimiteMemoria(bytes: number): void {
  if (Number.isFinite(bytes) && bytes > 0) {
    limiteMemoriaBytes = bytes;
  }
}

export function obterLimiteMemoria(): number {
  return limiteMemoriaBytes;
}

export function idVolumeParaPilha(stackId: string): string {
  return `${ESQUEMA_VOLUME}:${stackId}`;
}

function iniciarStreaming(volume: VolumeCarregado): void {
  if ('load' in volume && typeof volume.load === 'function') {
    volume.load(() => {
      /* callbacks opcionais; o volume atualiza seu loadStatus internamente */
    });
  }
}

function descartarDoCache(volumeId: string, volume?: VolumeCarregado): void {
  if (volume && 'cancelLoading' in volume && typeof volume.cancelLoading === 'function') {
    try {
      volume.cancelLoading();
    } catch {
      /* carregamento já encerrado */
    }
  }
  if (cache.getVolumeLoadObject(volumeId)) {
    try {
      cache.removeVolumeLoadObject(volumeId);
    } catch {
      /* já removido do cache */
    }
  }
}

/**
 * Monta (ou reutiliza) o volume em streaming para `stack`, usando os mesmos `imageIds`
 * já ordenados pela pilha. Incrementa a contagem de referências quando `ok: true`.
 */
export function adquirirVolume(stack: StackNode, imageIds: string[]): ResultadoAdquirirVolume {
  const existente = volumes.get(stack.id);
  if (existente) {
    existente.refs++;
    return { ok: true, volumeId: existente.volumeId, promessa: existente.promessa };
  }

  const avaliacao = avaliarVolume(stack, limiteMemoriaBytes);
  if (!avaliacao.ok) {
    return {
      ok: false,
      motivo: avaliacao.motivo,
      mensagens: avaliacao.mensagens,
    };
  }

  registrarMetadadosPilha(stack, imageIds);

  const volumeId = idVolumeParaPilha(stack.id);
  const geracao = ++proximaGeracao;
  const copiaIds = [...imageIds];
  const entrada: EntradaVolume = {
    stackId: stack.id,
    volumeId,
    imageIds: copiaIds,
    refs: 1,
    geracao,
    promessa: undefined as unknown as Promise<VolumeCarregado>,
  };

  entrada.promessa = volumeLoader
    .createAndCacheVolume(volumeId, { imageIds: copiaIds })
    .then((volume) => {
      const atual = volumes.get(stack.id);
      if (!atual || atual.geracao !== geracao) {
        descartarDoCache(volumeId, volume);
        throw new Error('Volume liberado antes de concluir a montagem.');
      }
      atual.volume = volume;
      iniciarStreaming(volume);
      return volume;
    })
    .catch((erro) => {
      const atual = volumes.get(stack.id);
      if (atual && atual.geracao === geracao) {
        volumes.delete(stack.id);
        removerMetadadosPilha(copiaIds);
        descartarDoCache(volumeId, atual.volume);
      }
      throw erro;
    });

  volumes.set(stack.id, entrada);
  return { ok: true, volumeId, promessa: entrada.promessa };
}

/**
 * Libera um uso do volume da pilha. Quando o último viewport solta a série,
 * cancela o streaming (se ativo) e remove o volume do cache.
 */
export function liberarVolume(stackId: string | undefined): void {
  if (!stackId) return;
  const entrada = volumes.get(stackId);
  if (!entrada) return;
  entrada.refs--;
  if (entrada.refs > 0) return;

  volumes.delete(stackId);
  removerMetadadosPilha(entrada.imageIds);
  const volume = entrada.volume ?? cache.getVolume(entrada.volumeId);
  descartarDoCache(entrada.volumeId, volume);
}

/**
 * Descarta o volume da pilha de uma vez, sem contar referências (ex.: os voxels ficaram
 * desatualizados porque o SUV foi recalculado). Quem o usava deve pedir outro com `adquirirVolume`.
 */
export function descartarVolume(stackId: string): void {
  const entrada = volumes.get(stackId);
  if (!entrada) return;
  volumes.delete(stackId);
  removerMetadadosPilha(entrada.imageIds);
  const volume = entrada.volume ?? cache.getVolume(entrada.volumeId);
  descartarDoCache(entrada.volumeId, volume);
}

/** Libera todos os volumes ativos (ex.: ao abrir outra pasta). */
export function limparVolumes(): void {
  for (const entrada of volumes.values()) {
    removerMetadadosPilha(entrada.imageIds);
    const volume = entrada.volume ?? cache.getVolume(entrada.volumeId);
    descartarDoCache(entrada.volumeId, volume);
  }
  volumes.clear();
  metaPorImageId.clear();
}

/** Devolve o volume já montado no cache (ou `undefined` se ainda não pronto/inexistente). */
export function obterVolume(stackId: string): VolumeCarregado | undefined {
  const entrada = volumes.get(stackId);
  if (!entrada) return undefined;
  return entrada.volume ?? cache.getVolume(entrada.volumeId);
}

/** Devolve o `volumeId` registrado para a pilha, se houver. */
export function obterIdVolume(stackId: string): string | undefined {
  return volumes.get(stackId)?.volumeId;
}
