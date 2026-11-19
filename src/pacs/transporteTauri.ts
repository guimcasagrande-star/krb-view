/**
 * Transporte do cliente de PACS sobre a ponte TCP do Tauri (comandos `pacs_*` em Rust).
 * Implementa `Connect` de `client.ts`. Nenhuma regra do protocolo DICOM fica aqui nem no Rust.
 * Usa o objeto global `window.__TAURI__` (tauri.conf.json: `withGlobalTauri`), sem dependência npm.
 */

import type { Connect, IncomingServer, Listen, PacsServer, Transport } from './client.ts';

interface TauriChannel<T> {
  onmessage: ((message: T) => void) | null;
}

interface TauriGlobal {
  core: {
    invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T>;
    Channel: new <T = unknown>() => TauriChannel<T>;
  };
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

function paraUint8Array(dado: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (dado instanceof ArrayBuffer) return new Uint8Array(dado);
  return new Uint8Array(dado.buffer, dado.byteOffset, dado.byteLength);
}

interface Conexao {
  aoReceber: ((chunk: Uint8Array) => void)[];
  aoFechar: ((erro?: Error) => void)[];
  /** Dados que chegaram antes de alguém ouvir (a conexão é criada antes de `onData`). */
  pendentes: Uint8Array[];
  fechou?: { erro?: Error };
}

const conexoes = new Map<number, Conexao>();
const escutas = new Map<number, (connId: number) => void>();
let ouvindo: Promise<void> | undefined;

/** Registra uma vez os ouvintes globais da ponte TCP (fechamento e conexões de entrada). */
function garantirOuvintes(t: TauriGlobal): Promise<void> {
  ouvindo ??= (async () => {
    await t.event.listen<{ id: number; erro?: string | null }>('pacs-fechou', (e) => {
      const c = conexoes.get(e.payload.id);
      if (!c) return;
      const erro = e.payload.erro ? new Error(e.payload.erro) : undefined;
      c.fechou = { erro };
      for (const f of c.aoFechar) f(erro);
      conexoes.delete(e.payload.id);
    });
    await t.event.listen<{ escutaId: number; connId: number }>('pacs-entrada', (e) => {
      escutas.get(e.payload.escutaId)?.(e.payload.connId);
    });
  })();
  return ouvindo;
}

function criarTransporte(t: TauriGlobal, id: number, c: Conexao): Transport {
  return {
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
}

/** Informa ao Rust quais servidores podem ser acessados (só os cadastrados). */
export async function definirServidoresPermitidos(servidores: PacsServer[]): Promise<void> {
  const t = tauri();
  if (!t) return;
  await t.core.invoke('pacs_definir_servidores', {
    servidores: servidores.map((s) => ({
      host: s.host,
      porta: s.port,
      tls: s.tls === true,
      certificado: s.certificateSha256 ?? null,
    })),
  });
}

/**
 * Conexão segura: impressão digital SHA-256 (64 dígitos hexadecimais) do certificado que o
 * servidor apresenta, para o usuário confirmar. O servidor precisa estar entre os permitidos.
 */
export async function obterCertificadoTauri(host: string, port: number): Promise<string> {
  const t = tauri();
  if (!t) throw new Error('a busca em PACS só funciona no programa instalado (Tauri).');
  try {
    return await t.core.invoke<string>('pacs_certificado', { host, porta: port });
  } catch (e) {
    throw new Error(String(e));
  }
}

/**
 * `Connect` para `client.ts`: abre a conexão pela ponte do Tauri (TCP, ou TLS nos servidores
 * cadastrados com conexão segura; quem decide é o Rust, pela lista de servidores permitidos).
 */
export const connectTauri: Connect = async (host, port) => {
  const t = tauri();
  if (!t) throw new Error('a busca em PACS só funciona no programa instalado (Tauri).');
  try {
    await garantirOuvintes(t);
  } catch (e) {
    ouvindo = undefined;
    throw new Error(`falha ao ouvir a ponte (${String(e)})`);
  }
  const c: Conexao = { aoReceber: [], aoFechar: [], pendentes: [] };
  const canal = new t.core.Channel<ArrayBuffer | ArrayBufferView>();
  canal.onmessage = (dado) => {
    const bytes = paraUint8Array(dado);
    if (c.aoReceber.length === 0) c.pendentes.push(bytes);
    else for (const f of c.aoReceber) f(bytes);
  };

  let id: number;
  try {
    id = await t.core.invoke<number>('pacs_conectar', { host, porta: port, canal });
  } catch (e) {
    // `client.ts` envolve este erro em PacsError('SEM_CONEXAO', ...) com o nome do servidor.
    throw new Error(String(e));
  }
  conexoes.set(id, c);
  return criarTransporte(t, id, c);
};

/**
 * `Listen` para `client.ts`: abre uma porta TCP local via ponte do Tauri para receber
 * conexões C-STORE do PACS durante um download C-MOVE.
 */
export const listenTauri: Listen = async (port) => {
  const t = tauri();
  if (!t) throw new Error('a busca em PACS só funciona no programa instalado (Tauri).');
  try {
    await garantirOuvintes(t);
  } catch (e) {
    ouvindo = undefined;
    throw new Error(`falha ao ouvir a ponte (${String(e)})`);
  }

  let escutaId: number;
  try {
    escutaId = await t.core.invoke<number>('pacs_escutar', { porta: port });
  } catch (e) {
    throw new Error(String(e));
  }

  const callbacks: ((transport: Transport) => void)[] = [];
  const pendentes: Transport[] = [];

  escutas.set(escutaId, (connId) => {
    const c: Conexao = { aoReceber: [], aoFechar: [], pendentes: [] };
    const canal = new t.core.Channel<ArrayBuffer | ArrayBufferView>();
    canal.onmessage = (dado) => {
      const bytes = paraUint8Array(dado);
      if (c.aoReceber.length === 0) c.pendentes.push(bytes);
      else for (const f of c.aoReceber) f(bytes);
    };
    conexoes.set(connId, c);
    const transporte = criarTransporte(t, connId, c);
    if (callbacks.length === 0) pendentes.push(transporte);
    else for (const cb of callbacks) cb(transporte);
    void t.core.invoke('pacs_aceitar_canal', { id: connId, canal }).catch(() => {
      conexoes.delete(connId);
    });
  });

  const server: IncomingServer = {
    onConnection(cb) {
      callbacks.push(cb);
      for (const p of pendentes.splice(0)) cb(p);
    },
    async close() {
      escutas.delete(escutaId);
      await t.core.invoke('pacs_parar_escuta', { id: escutaId }).catch(() => undefined);
    },
  };
  return server;
};
