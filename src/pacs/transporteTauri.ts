/**
 * Transporte do cliente de PACS sobre a ponte TCP do Tauri (comandos `pacs_*` em Rust).
 * Implementa `Connect` de `client.ts`. Nenhuma regra do protocolo DICOM fica aqui nem no Rust.
 * Usa o objeto global `window.__TAURI__` (tauri.conf.json: `withGlobalTauri`), sem dependência npm.
 */

import type { Connect, PacsServer, Transport } from './client.ts';

interface TauriGlobal {
  core: { invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(evento: string, aoReceber: (e: { payload: T }) => void): Promise<() => void>;
  };
}

function tauri(): TauriGlobal | undefined {
  return (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** Verdadeiro dentro do app empacotado (a busca em PACS só existe lá). */
export function pacsDisponivel(): boolean {
  return tauri() !== undefined;
}

function paraBase64(bytes: Uint8Array): string {
  let s = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    s += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(s);
}

function deBase64(texto: string): Uint8Array {
  const bin = atob(texto);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Conexao {
  aoReceber: ((chunk: Uint8Array) => void)[];
  aoFechar: ((erro?: Error) => void)[];
  /** Dados que chegaram antes de alguém ouvir (a conexão é criada antes de `onData`). */
  pendentes: Uint8Array[];
  fechou?: { erro?: Error };
}

const conexoes = new Map<number, Conexao>();
let ouvindo: Promise<void> | undefined;

/** Registra uma vez os ouvintes dos eventos globais da ponte. */
function garantirOuvintes(t: TauriGlobal): Promise<void> {
  ouvindo ??= (async () => {
    await t.event.listen<{ id: number; dados: string }>('pacs-dados', (e) => {
      const c = conexoes.get(e.payload.id);
      if (!c) return;
      const bytes = deBase64(e.payload.dados);
      if (c.aoReceber.length === 0) c.pendentes.push(bytes);
      else for (const f of c.aoReceber) f(bytes);
    });
    await t.event.listen<{ id: number; erro?: string | null }>('pacs-fechou', (e) => {
      const c = conexoes.get(e.payload.id);
      if (!c) return;
      const erro = e.payload.erro ? new Error(e.payload.erro) : undefined;
      c.fechou = { erro };
      for (const f of c.aoFechar) f(erro);
      conexoes.delete(e.payload.id);
    });
  })();
  return ouvindo;
}

/** Informa ao Rust quais servidores podem ser acessados (só os cadastrados). */
export async function definirServidoresPermitidos(servidores: PacsServer[]): Promise<void> {
  const t = tauri();
  if (!t) return;
  await t.core.invoke('pacs_definir_servidores', {
    servidores: servidores.map((s) => [s.host, s.port]),
  });
}

/** `Connect` para `client.ts`: abre a conexão TCP pela ponte do Tauri. */
export const connectTauri: Connect = async (host, port) => {
  const t = tauri();
  if (!t) throw new Error('a busca em PACS só funciona no programa instalado (Tauri).');
  try {
    await garantirOuvintes(t);
  } catch (e) {
    ouvindo = undefined;
    throw new Error(`falha ao ouvir a ponte (${String(e)})`);
  }
  let id: number;
  try {
    id = await t.core.invoke<number>('pacs_conectar', { host, porta: port });
  } catch (e) {
    // `client.ts` envolve este erro em PacsError('SEM_CONEXAO', ...) com o nome do servidor.
    throw new Error(String(e));
  }
  const c: Conexao = { aoReceber: [], aoFechar: [], pendentes: [] };
  conexoes.set(id, c);

  const transporte: Transport = {
    send(data) {
      void t.core.invoke('pacs_enviar', { id, dados: paraBase64(data) }).catch(() => undefined);
    },
    close() {
      void t.core.invoke('pacs_fechar', { id }).catch(() => undefined);
    },
    onData(cb) {
      c.aoReceber.push(cb);
      for (const p of c.pendentes.splice(0)) cb(p);
    },
    onClose(cb) {
      if (c.fechou) cb(c.fechou.erro);
      else c.aoFechar.push(cb);
    },
  };
  return transporte;
};
