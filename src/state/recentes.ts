/**
 * Pastas abertas recentemente. Guarda só a REFERÊNCIA da pasta (o nome e o "handle" do
 * navegador, que é permissão de acesso e não contém dados do exame) no IndexedDB deste
 * computador. Nenhum arquivo, metadado ou imagem do exame é gravado aqui.
 * No app empacotado (Tauri) a referência será o caminho da pasta.
 */

export interface PastaRecente {
  id: string;
  nome: string;
  /** FileSystemDirectoryHandle (guardado como está; é só uma referência). */
  handle: unknown;
  quando: number;
}

export const EVENTO_RECENTES = 'recentesMudaram';
const BANCO = 'visualizador-recentes';
const LOJA = 'pastas';
const MAXIMO = 8;

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LOJA, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pedido<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listarRecentes(): Promise<PastaRecente[]> {
  try {
    const db = await abrirBanco();
    const todas = await pedido(db.transaction(LOJA).objectStore(LOJA).getAll() as IDBRequest<PastaRecente[]>);
    db.close();
    return todas.sort((a, b) => b.quando - a.quando);
  } catch {
    return [];
  }
}

/** Guarda a pasta (ou a move para o topo se já estava na lista). */
export async function registrarRecente(handle: { name: string; isSameEntry?: (o: unknown) => Promise<boolean> }): Promise<void> {
  try {
    const existentes = await listarRecentes();
    let id: string | undefined;
    for (const e of existentes) {
      const h = e.handle as { isSameEntry?: (o: unknown) => Promise<boolean> };
      if (h.isSameEntry && (await h.isSameEntry(handle).catch(() => false))) id = e.id;
    }
    const db = await abrirBanco();
    const tx = db.transaction(LOJA, 'readwrite');
    const loja = tx.objectStore(LOJA);
    loja.put({ id: id ?? crypto.randomUUID(), nome: handle.name, handle, quando: Date.now() } satisfies PastaRecente);
    // Mantém só as mais recentes.
    const aposta = [...existentes.filter((e) => e.id !== id)].slice(MAXIMO - 1);
    for (const velha of aposta) loja.delete(velha.id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    document.dispatchEvent(new CustomEvent(EVENTO_RECENTES));
  } catch {
    /* armazenamento indisponível: só não guarda */
  }
}

export async function limparRecentes(): Promise<void> {
  try {
    const db = await abrirBanco();
    await pedido(db.transaction(LOJA, 'readwrite').objectStore(LOJA).clear());
    db.close();
    document.dispatchEvent(new CustomEvent(EVENTO_RECENTES));
  } catch {
    /* ignora */
  }
}
