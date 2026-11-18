/**
 * Cache de arrays de voxels e espera orientada a eventos para volumes em streaming.
 */

import { Enums, eventTarget, type Types } from '@cornerstonejs/core';
import { gridFromVolumeProps, worldToVoxel } from '../io/geometry';
import type { StackNode } from '../io/organize';
import { adquirirVolume, liberarVolume } from '../volume/montarVolume';

export interface Voxels {
  data: ArrayLike<number>;
  grid: ReturnType<typeof gridFromVolumeProps>;
}

interface StatusVolume {
  loaded?: boolean;
  cancelled?: boolean;
}

const TIMEOUT_VOLUME_MS = 180_000;
const INTERVALO_VERIFICACAO_SEGURANCA_MS = 1_000;

/** Extrai uma mensagem legível a partir de erros do navegador, workers ou Cornerstone. */
export function textoDoErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (o.error !== undefined) return textoDoErro(o.error);
  }
  return 'erro desconhecido';
}

/** Espera o streaming do volume terminar via eventos do Cornerstone (sem polling contínuo). */
export function aguardarVolumeCompleto(
  vol: Pick<Types.IImageVolume, 'volumeId' | 'loadStatus'>,
  timeoutMs = TIMEOUT_VOLUME_MS,
  alvo: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = eventTarget,
): Promise<void> {
  const lerStatus = (): StatusVolume | undefined =>
    vol.loadStatus as StatusVolume | undefined;
  const inicio = lerStatus();
  if (inicio?.loaded === true) return Promise.resolve();
  if (inicio?.cancelled === true) {
    return Promise.reject(new Error('Carregamento do volume cancelado.'));
  }

  return new Promise<void>((resolve, reject) => {
    let encerrado = false;
    let timerTimeout: ReturnType<typeof setTimeout> | undefined;
    let timerFallback: ReturnType<typeof setInterval> | undefined;

    const limpar = (): void => {
      if (encerrado) return;
      encerrado = true;
      alvo.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, aoCompletar);
      alvo.removeEventListener(Enums.Events.IMAGE_VOLUME_LOADING_CANCELLED, aoCancelar);
      if (timerTimeout !== undefined) clearTimeout(timerTimeout);
      if (timerFallback !== undefined) clearInterval(timerFallback);
    };

    const concluir = (): void => {
      limpar();
      resolve();
    };

    const falhar = (msg: string): void => {
      limpar();
      reject(new Error(msg));
    };

    const verificarStatus = (): boolean => {
      const s = lerStatus();
      if (s?.loaded === true) {
        concluir();
        return true;
      }
      if (s?.cancelled === true) {
        falhar('Carregamento do volume cancelado.');
        return true;
      }
      return false;
    };

    const aoCompletar = (ev: Event): void => {
      const id = (ev as CustomEvent<{ volumeId?: string }>).detail?.volumeId;
      if ((id && id === vol.volumeId) || lerStatus()?.loaded === true) {
        concluir();
      }
    };

    const aoCancelar = (ev: Event): void => {
      const id = (ev as CustomEvent<{ volumeId?: string }>).detail?.volumeId;
      if ((id && id === vol.volumeId && lerStatus()?.loaded !== true) || lerStatus()?.cancelled === true) {
        falhar('Carregamento do volume cancelado.');
      }
    };

    alvo.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, aoCompletar);
    alvo.addEventListener(Enums.Events.IMAGE_VOLUME_LOADING_CANCELLED, aoCancelar);

    timerFallback = setInterval(() => {
      verificarStatus();
    }, INTERVALO_VERIFICACAO_SEGURANCA_MS);

    timerTimeout = setTimeout(() => {
      if (!verificarStatus()) {
        falhar('Tempo esgotado carregando o volume.');
      }
    }, timeoutMs);

    verificarStatus();
  });
}

/** Voxels já obtidos por pilha (evita remontar o volume a cada medida). Invalidado ao recalcular o SUV. */
const cacheVoxels = new Map<string, Voxels>();

/** Remove uma pilha específica do cache local de voxels. */
export function invalidarCacheVoxels(stackId: string): void {
  cacheVoxels.delete(stackId);
}

/** Limpa todo o cache local de voxels. */
export function limparCacheVoxels(): void {
  cacheVoxels.clear();
}

/**
 * Copia os voxels e a grade do volume da pilha (monta o volume se preciso e solta a referência
 * ao terminar).
 */
export async function carregarVoxels(stack: StackNode, ids: string[]): Promise<Voxels | { erro: string }> {
  const guardado = cacheVoxels.get(stack.id);
  if (guardado) return guardado;
  const res = adquirirVolume(stack, ids);
  if (!res.ok) return { erro: `Medida volumétrica indisponível: ${res.mensagens.join(' · ')}` };
  try {
    const vol = (await res.promessa) as Types.IImageVolume;
    await aguardarVolumeCompleto(vol);
    const dados = vol.voxelManager?.getCompleteScalarDataArray?.();
    if (!dados) return { erro: 'Não foi possível ler os voxels do volume.' };
    const v: Voxels = {
      data: dados,
      grid: gridFromVolumeProps({
        dimensions: vol.dimensions,
        spacing: vol.spacing,
        origin: vol.origin,
        direction: vol.direction,
      }),
    };
    cacheVoxels.set(stack.id, v);
    return v;
  } catch (e) {
    return { erro: textoDoErro(e) };
  } finally {
    liberarVolume(stack.id);
  }
}

/** Lê o valor escalar do volume no ponto 3D em coordenadas de mundo LPS. */
export function valorNoPonto(v: Voxels, mundo: [number, number, number]): number | undefined {
  const ijk = worldToVoxel(v.grid, mundo);
  if (!ijk) return undefined;
  const [i, j, k] = [Math.round(ijk[0]), Math.round(ijk[1]), Math.round(ijk[2])];
  const [nx, ny, nz] = v.grid.dims;
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return undefined;
  return v.data[i + j * nx + k * nx * ny];
}
