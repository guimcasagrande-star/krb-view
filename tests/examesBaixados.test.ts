import { afterEach, describe, expect, it } from 'vitest';
import { gravarExame, lerExame, limparCacheExames } from '../src/state/examesBaixados';
import { carregarConfigPacs, salvarConfigPacs } from '../src/state/pacsConfig';

type InvokeMock = (
  comando: string,
  args?: unknown,
  opcoes?: { headers?: Record<string, string> },
) => Promise<unknown>;

function instalarTauriMock(invoke: InvokeMock): void {
  (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
  };
}

describe('examesBaixados (IPC binário sem Base64)', () => {
  afterEach(() => {
    delete (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('envia Uint8Array bruto em exames_gravar com headers em URI component UTF-8', async () => {
    let chamado: { comando: string; args: unknown; headers?: Record<string, string> } | undefined;
    instalarTauriMock(async (comando, args, opcoes) => {
      chamado = { comando, args, headers: opcoes?.headers };
      return undefined;
    });

    const bytes = new Uint8Array([10, 20, 30, 40]);
    const base = 'C:\\Users\\João Silva\\Visualizador DICOM\\exames';
    const rel = '1.2.3/1.2.3.4/1.2.3.4.5.dcm';

    await gravarExame(base, rel, bytes);

    expect(chamado?.comando).toBe('exames_gravar');
    expect(chamado?.args).toBeInstanceOf(Uint8Array);
    expect(Array.from(chamado?.args as Uint8Array)).toEqual([10, 20, 30, 40]);
    expect(chamado?.headers).toEqual({
      'X-Exame-Base': encodeURIComponent(base),
      'X-Exame-Relativo': encodeURIComponent(rel),
    });
    expect(decodeURIComponent(chamado!.headers!['X-Exame-Base']!)).toBe(base);
    expect(decodeURIComponent(chamado!.headers!['X-Exame-Relativo']!)).toBe(rel);
  });

  it('recorta subarray antes de enviar exames_gravar quando bytes é visão parcial', async () => {
    let enviado: Uint8Array | undefined;
    instalarTauriMock(async (_cmd, args) => {
      enviado = args as Uint8Array;
      return undefined;
    });

    const backing = new Uint8Array([99, 1, 2, 3, 88]);
    const slice = backing.subarray(1, 4);
    await gravarExame('C:\\exames', '1/2/3.dcm', slice);

    expect(Array.from(enviado!)).toEqual([1, 2, 3]);
    expect(enviado!.byteOffset).toBe(0);
    expect(enviado!.byteLength).toBe(enviado!.buffer.byteLength);
  });

  it('lerExame lê ArrayBuffer puro, Uint8Array e fallback Base64 legado', async () => {
    const ab = new Uint8Array([1, 2, 3, 4]).buffer;
    instalarTauriMock(async () => ab);
    expect(Array.from(await lerExame('C:\\exames', 'a/b.dcm'))).toEqual([1, 2, 3, 4]);

    const view = new Uint8Array([0, 5, 6, 7, 9]).subarray(1, 4);
    instalarTauriMock(async () => view);
    expect(Array.from(await lerExame('C:\\exames', 'a/b.dcm'))).toEqual([5, 6, 7]);

    instalarTauriMock(async () => btoa('DICM'));
    expect(Array.from(await lerExame('C:\\exames', 'a/b.dcm'))).toEqual([68, 73, 67, 77]);
  });

  it('limparCacheExames envia limiteBytes e protegerEstudoUid corretamente', async () => {
    let chamado: { comando: string; args: unknown } | undefined;
    instalarTauriMock(async (comando, args) => {
      chamado = { comando, args };
      return { removidos: 1, bytesLiberados: 500, totalRestante: 1500 };
    });

    const res = await limparCacheExames('C:\\exames', 10, '1.2.3.4');
    expect(chamado).toEqual({
      comando: 'exames_limpar_cache',
      args: {
        base: 'C:\\exames',
        limiteBytes: 10 * 1024 * 1024 * 1024,
        protegerEstudoUid: '1.2.3.4',
      },
    });
    expect(res).toEqual({ removidos: 1, bytesLiberados: 500, totalRestante: 1500 });

    await limparCacheExames('C:\\exames', 0);
    expect(chamado).toEqual({
      comando: 'exames_limpar_cache',
      args: {
        base: 'C:\\exames',
        limiteBytes: 0,
        protegerEstudoUid: null,
      },
    });
  });

  it('carregarConfigPacs usa limiteCacheGb padrão 10 e valida valores salvos', () => {
    const memoria = new Map<string, string>();
    (globalThis as unknown as { localStorage?: Storage }).localStorage = {
      get length() {
        return memoria.size;
      },
      clear: () => memoria.clear(),
      getItem: (k: string) => memoria.get(k) ?? null,
      key: (i: number) => [...memoria.keys()][i] ?? null,
      removeItem: (k: string) => {
        memoria.delete(k);
      },
      setItem: (k: string, v: string) => {
        memoria.set(k, v);
      },
    };

    try {
      expect(carregarConfigPacs().limiteCacheGb).toBe(10);

      salvarConfigPacs({ meuAeTitle: 'TESTE', servidores: [], limiteCacheGb: 25 });
      expect(carregarConfigPacs().limiteCacheGb).toBe(25);

      salvarConfigPacs({ meuAeTitle: 'TESTE', servidores: [], limiteCacheGb: 0 });
      expect(carregarConfigPacs().limiteCacheGb).toBe(0);

      memoria.set('visualizador.pacs.v1', JSON.stringify({ meuAeTitle: 'TESTE', servidores: [], limiteCacheGb: -5 }));
      expect(carregarConfigPacs().limiteCacheGb).toBe(10);
    } finally {
      delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    }
  });
});
