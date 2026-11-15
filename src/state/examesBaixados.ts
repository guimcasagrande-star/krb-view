/**
 * Pasta dos exames baixados do PACS (só no app empacotado): gravar, listar, ler, medir e apagar,
 * pelos comandos `exames_*` do Rust. O caminho da pasta é guardado nas preferências do app.
 */

interface TauriInvokeOptions {
  headers?: Record<string, string>;
}

interface TauriGlobal {
  core: {
    invoke<T>(
      comando: string,
      args?: Record<string, unknown> | Uint8Array | ArrayBuffer,
      opcoes?: TauriInvokeOptions,
    ): Promise<T>;
  };
}

const CHAVE_PASTA = 'visualizador.pastaExames';

function tauri(): TauriGlobal {
  const t = (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (!t) throw new Error('Disponível só no programa instalado (Tauri).');
  return t;
}

function deBase64(texto: string): Uint8Array {
  const bin = atob(texto);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Pasta de exames em uso: a escolhida pelo usuário ou a padrão (dados locais do programa). */
export async function pastaDeExames(): Promise<string> {
  try {
    const salva = localStorage.getItem(CHAVE_PASTA);
    if (salva) return salva;
  } catch {
    /* sem armazenamento */
  }
  return tauri().core.invoke<string>('exames_pasta_padrao');
}

export function definirPastaDeExames(caminho: string): void {
  try {
    if (caminho.trim()) localStorage.setItem(CHAVE_PASTA, caminho.trim());
    else localStorage.removeItem(CHAVE_PASTA);
  } catch {
    /* ignora */
  }
}

export async function gravarExame(base: string, relativo: string, bytes: Uint8Array): Promise<void> {
  const payload =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
  await tauri().core.invoke('exames_gravar', payload, {
    headers: {
      'X-Exame-Base': encodeURIComponent(base),
      'X-Exame-Relativo': encodeURIComponent(relativo),
    },
  });
}

export function listarExames(base: string, relativo: string): Promise<string[]> {
  return tauri().core.invoke<string[]>('exames_listar', { base, relativo });
}

export async function lerExame(base: string, relativo: string): Promise<Uint8Array> {
  const resposta = await tauri().core.invoke<ArrayBuffer | Uint8Array | string>('exames_ler', {
    base,
    relativo,
  });
  if (resposta instanceof ArrayBuffer) return new Uint8Array(resposta);
  if (ArrayBuffer.isView(resposta)) {
    return new Uint8Array(resposta.buffer, resposta.byteOffset, resposta.byteLength);
  }
  if (typeof resposta === 'string') return deBase64(resposta);
  throw new Error('Resposta binária inválida ao ler exame.');
}

export function tamanhoDosExames(base: string): Promise<number> {
  return tauri().core.invoke<number>('exames_tamanho', { base });
}

export function apagarExames(base: string, relativo: string): Promise<void> {
  return tauri().core.invoke('exames_apagar', { base, relativo });
}
