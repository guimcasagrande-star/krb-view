/**
 * Validação pura e estimativa de memória antes de montar um volume 3D/MPR.
 * Sem dependências de navegador ou Cornerstone3D.
 */

import { estimateVolumeBytes } from '../io/geometry';
import type { StackNode } from '../io/organize';

/** Limite padrão de memória por volume (1 GiB). Configurável em tempo de execução. */
export const LIMITE_MEMORIA_PADRAO_BYTES = 1024 * 1024 * 1024;

export type MotivoRecusaVolume = 'geometria' | 'memoria' | 'dimensoes';

export type AvaliacaoVolume =
  | {
      ok: true;
      bytesEstimados: number;
    }
  | {
      ok: false;
      motivo: MotivoRecusaVolume;
      mensagens: string[];
      bytesEstimados?: number;
    };

/**
 * Estima quantos bytes por voxel o Cornerstone3D alocará para a pilha,
 * espelhando a lógica de `generateVolumePropsFromImageIds`:
 * - RGB (`samplesPerPixel > 1`): `ceil(bitsAllocated / 8) * samplesPerPixel`
 * - 16 bits com rescale fracionário ou PET: 4 bytes (`Float32Array`)
 * - Caso contrário: `ceil(bitsAllocated / 8)` (padrão 2 bytes).
 */
export function estimarBytesPorVoxel(stack: StackNode): number {
  const primeira = stack.instances[0];
  if (!primeira) return 2;
  const bits = primeira.bitsAllocated ?? 16;
  const amostras = primeira.samplesPerPixel ?? 1;
  if (amostras > 1) {
    return Math.max(1, Math.ceil(bits / 8)) * amostras;
  }
  if (bits === 16) {
    const temEscalaFracionaria = stack.instances.some((inst) => {
      const slope = inst.rescaleSlope;
      const intercept = inst.rescaleIntercept;
      return (
        (slope !== undefined && !Number.isInteger(slope)) ||
        (intercept !== undefined && !Number.isInteger(intercept))
      );
    });
    if (temEscalaFracionaria || primeira.modality === 'PT') {
      return 4;
    }
  }
  return Math.max(1, Math.ceil(bits / 8));
}

/** Estima o tamanho do volume em bytes usando `estimateVolumeBytes`. */
export function estimarBytesVolume(stack: StackNode): number | undefined {
  const primeira = stack.instances[0];
  if (!primeira) return undefined;
  const { columns, rows } = primeira;
  if (!columns || !rows || stack.instances.length === 0) return undefined;
  return estimateVolumeBytes(columns, rows, stack.instances.length, estimarBytesPorVoxel(stack));
}

export function formatarMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/**
 * Decide se a pilha pode ser montada como volume:
 * 1. `stack.geometry.volumeOk` deve ser verdadeiro (senão devolve `stack.geometry.issues`).
 * 2. Dimensões válidas (`rows`, `columns` e pelo menos 2 cortes).
 * 3. Memória estimada dentro de `limiteBytes`.
 */
export function avaliarVolume(
  stack: StackNode,
  limiteBytes: number = LIMITE_MEMORIA_PADRAO_BYTES,
): AvaliacaoVolume {
  const bytesEstimados = estimarBytesVolume(stack);

  if (!stack.geometry.volumeOk) {
    const mensagens = stack.geometry.issues.map((i) => i.message);
    return {
      ok: false,
      motivo: 'geometria',
      mensagens: mensagens.length > 0 ? mensagens : ['Geometria incompatível com reconstrução volumétrica.'],
      bytesEstimados,
    };
  }

  if (bytesEstimados === undefined) {
    return {
      ok: false,
      motivo: 'dimensoes',
      mensagens: ['Dimensões da imagem ausentes para montar o volume.'],
    };
  }

  if (bytesEstimados > limiteBytes) {
    return {
      ok: false,
      motivo: 'memoria',
      mensagens: [
        `Volume estimado em ${formatarMegabytes(bytesEstimados)} excede o limite de ${formatarMegabytes(limiteBytes)}; mantendo apenas modo 2D.`,
      ],
      bytesEstimados,
    };
  }

  return { ok: true, bytesEstimados };
}
