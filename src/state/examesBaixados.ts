/**
 * Pasta dos exames baixados do PACS (só no app empacotado): gravar, listar, ler, medir e apagar,
 * pelos comandos `exames_*` do Rust. O caminho da pasta é guardado nas preferências do app.
 */

interface TauriGlobal {
  core: { invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T> };
}

const CHAVE_PASTA = 'visualizador.pastaExames';

function tauri(): TauriGlobal {
  const t = (globalThis as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  if (!t) throw new Error('Disponível só no programa instalado (Tauri).');
  return t;
}

function paraBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
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
  await tauri().core.invoke('exames_gravar', { base, relativo, dados: paraBase64(bytes) });
}

export function listarExames(base: string, relativo: string): Promise<string[]> {
  return tauri().core.invoke<string[]>('exames_listar', { base, relativo });
}

export async function lerExame(base: string, relativo: string): Promise<Uint8Array> {
  return deBase64(await tauri().core.invoke<string>('exames_ler', { base, relativo }));
}

export function tamanhoDosExames(base: string): Promise<number> {
  return tauri().core.invoke<number>('exames_tamanho', { base });
}

export function apagarExames(base: string, relativo: string): Promise<void> {
  return tauri().core.invoke('exames_apagar', { base, relativo });
}
