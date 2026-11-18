import { describe, expect, it } from 'vitest';
import { Enums } from '@cornerstonejs/core';
import { gridFromVolumeProps } from '../src/io/geometry';
import { aguardarVolumeCompleto, textoDoErro, valorNoPonto, type Voxels } from '../src/viewer/voxelsCache';

describe('voxelsCache', () => {
  it('resolve imediatamente quando o volume já está carregado', async () => {
    await expect(
      aguardarVolumeCompleto(
        { volumeId: 'vol-1', loadStatus: { loaded: true } as never },
        50,
        new EventTarget(),
      ),
    ).resolves.toBeUndefined();
  });

  it('resolve assim que o evento IMAGE_VOLUME_LOADING_COMPLETED do volume é disparado', async () => {
    const alvo = new EventTarget();
    let resolveu = false;
    const p = aguardarVolumeCompleto(
      { volumeId: 'vol-alvo', loadStatus: { loading: true, loaded: false } as never },
      5_000,
      alvo,
    ).then(() => {
      resolveu = true;
    });

    // Evento de outro volume não resolve este.
    alvo.dispatchEvent(
      new CustomEvent(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, {
        detail: { volumeId: 'vol-outro' },
      }),
    );
    await Promise.resolve();
    expect(resolveu).toBe(false);

    alvo.dispatchEvent(
      new CustomEvent(Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED, {
        detail: { volumeId: 'vol-alvo' },
      }),
    );
    await expect(p).resolves.toBeUndefined();
    expect(resolveu).toBe(true);
  });

  it('rejeita imediatamente quando o carregamento é cancelado', async () => {
    const alvo = new EventTarget();
    const p = aguardarVolumeCompleto(
      { volumeId: 'vol-cancelado', loadStatus: { loading: true, loaded: false } as never },
      5_000,
      alvo,
    );

    alvo.dispatchEvent(
      new CustomEvent(Enums.Events.IMAGE_VOLUME_LOADING_CANCELLED, {
        detail: { volumeId: 'vol-cancelado' },
      }),
    );

    await expect(p).rejects.toThrow(/cancelado/i);
  });

  it('rejeita quando excede o tempo limite', async () => {
    await expect(
      aguardarVolumeCompleto(
        { volumeId: 'vol-lento', loadStatus: { loading: true, loaded: false } as never },
        25,
        new EventTarget(),
      ),
    ).rejects.toThrow(/Tempo esgotado/);
  });

  it('lê corretamente o voxel na grade pelo ponto em mundo e retorna undefined fora dos limites', () => {
    const grid = gridFromVolumeProps({
      dimensions: [2, 2, 2],
      spacing: [1, 2, 3],
      origin: [10, 20, 30],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const voxels: Voxels = {
      data: [100, 101, 102, 103, 104, 105, 106, 107],
      grid,
    };

    expect(valorNoPonto(voxels, [10, 20, 30])).toBe(100);
    expect(valorNoPonto(voxels, [11, 22, 33])).toBe(107);
    expect(valorNoPonto(voxels, [9, 20, 30])).toBeUndefined();
    expect(valorNoPonto(voxels, [12, 20, 30])).toBeUndefined();
  });

  it('extrai mensagem de erro aninhada com textoDoErro', () => {
    expect(textoDoErro(new Error('falha direta'))).toBe('falha direta');
    expect(textoDoErro({ error: { message: 'erro interno' } })).toBe('erro interno');
    expect(textoDoErro(undefined)).toBe('erro desconhecido');
  });
});
