/**
 * Abertura de pasta: seletor nativo, <input webkitdirectory> e arrastar e soltar.
 * Lê só os cabeçalhos (readHeaderFromBlob) e monta o índice (buildIndex).
 * Nada sai da máquina; os arquivos ficam em memória como referências `File`.
 */

import { buildIndex, type DicomIndex } from '../io/organize';
import { readHeaderFromBlob } from '../io/readHeader';
import type { InstanceMeta } from '../io/types';

export const LEITURAS_SIMULTANEAS = 8;

export interface ArquivoIgnorado {
  fileId: string;
  reason: string;
}

export interface ResultadoAbertura {
  index: DicomIndex;
  /** fileId (caminho relativo) -> File, para carregar os pixels depois. */
  arquivos: Map<string, File>;
  /** Arquivos encontrados na pasta. */
  total: number;
  /** Arquivos que entraram no índice. */
  lidos: number;
  ignorados: ArquivoIgnorado[];
}

/** Arquivo encontrado na varredura, ainda não aberto. */
interface Candidato {
  path: string;
  obter(): Promise<File>;
}

// ---------- varredura ----------

interface HandleArquivo {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface HandlePasta {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<HandleArquivo | HandlePasta>;
}
type SeletorPasta = () => Promise<HandlePasta>;

function seletorNativo(): SeletorPasta | undefined {
  const f = (window as unknown as { showDirectoryPicker?: SeletorPasta }).showDirectoryPicker;
  return typeof f === 'function' ? f.bind(window) : undefined;
}

async function varrerHandle(pasta: HandlePasta, prefixo: string, saida: Candidato[]): Promise<void> {
  for await (const h of pasta.values()) {
    const caminho = prefixo ? `${prefixo}/${h.name}` : h.name;
    if (h.kind === 'file') saida.push({ path: caminho, obter: () => h.getFile() });
    else await varrerHandle(h, caminho, saida);
  }
}

function lerLote(leitor: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => leitor.readEntries(resolve, reject));
}

async function varrerEntrada(entrada: FileSystemEntry, saida: Candidato[]): Promise<void> {
  const caminho = entrada.fullPath.replace(/^\/+/, '');
  if (entrada.isFile) {
    const e = entrada as FileSystemFileEntry;
    saida.push({ path: caminho, obter: () => new Promise<File>((ok, erro) => e.file(ok, erro)) });
    return;
  }
  if (entrada.isDirectory) {
    const leitor = (entrada as FileSystemDirectoryEntry).createReader();
    // readEntries devolve em lotes (~100); repetir até vir um lote vazio.
    for (;;) {
      const lote = await lerLote(leitor);
      if (lote.length === 0) break;
      for (const filho of lote) await varrerEntrada(filho, saida);
    }
  }
}

// ---------- indexação ----------

function mensagemDeErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/** Lê o cabeçalho de todos os candidatos, com no máximo `LEITURAS_SIMULTANEAS` ao mesmo tempo. */
export async function indexarCandidatos(
  candidatos: Candidato[],
  aoProgredir: (feitos: number, total: number) => void = () => {},
): Promise<ResultadoAbertura> {
  const total = candidatos.length;
  const metas: (InstanceMeta | undefined)[] = new Array(total);
  const arquivos = new Map<string, File>();
  const ignorados: ArquivoIgnorado[] = [];
  let proximo = 0;
  let feitos = 0;

  async function trabalhador(): Promise<void> {
    for (;;) {
      const i = proximo++;
      if (i >= total) return;
      const c = candidatos[i]!;
      try {
        const nome = c.path.split('/').pop() ?? c.path;
        if (nome.toUpperCase() === 'DICOMDIR') {
          ignorados.push({ fileId: c.path, reason: 'DICOMDIR (índice de mídia), não é uma imagem.' });
        } else {
          const arquivo = await c.obter();
          const r = await readHeaderFromBlob(arquivo, c.path);
          if (r.ok) {
            metas[i] = r.meta;
            arquivos.set(c.path, arquivo);
          } else {
            ignorados.push({ fileId: c.path, reason: r.reason });
          }
        }
      } catch (e) {
        ignorados.push({ fileId: c.path, reason: `Erro ao ler o arquivo: ${mensagemDeErro(e)}` });
      }
      feitos++;
      if (feitos === total || feitos % 16 === 0) aoProgredir(feitos, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(LEITURAS_SIMULTANEAS, total) }, trabalhador));

  const lidasOk = metas.filter((m): m is InstanceMeta => m !== undefined);
  const index = buildIndex(lidasOk);
  for (const s of index.skipped) {
    ignorados.push({ fileId: s.fileId, reason: s.reason });
    arquivos.delete(s.fileId);
  }
  return { index, arquivos, total, lidos: total - ignorados.length, ignorados };
}

// ---------- interface ----------

export interface ElementosAbrirPasta {
  botao: HTMLButtonElement;
  botaoAlternativo: HTMLButtonElement;
  entradaPasta: HTMLInputElement;
  /** Área que aceita arrastar e soltar (a janela inteira). */
  zonaDrop: HTMLElement;
  progresso: HTMLProgressElement;
  resumo: HTMLElement;
}

function mostrarResumo(resumo: HTMLElement, r: ResultadoAbertura): void {
  resumo.replaceChildren();
  const linha = document.createElement('div');
  linha.textContent = `${r.lidos} ${r.lidos === 1 ? 'arquivo lido' : 'arquivos lidos'} · ${r.ignorados.length} ${
    r.ignorados.length === 1 ? 'ignorado' : 'ignorados'
  }`;
  resumo.append(linha);
  if (r.ignorados.length === 0) return;

  // Agrupa por motivo; cada grupo abre a lista dos arquivos.
  const porMotivo = new Map<string, string[]>();
  for (const ig of r.ignorados) {
    const lista = porMotivo.get(ig.reason);
    if (lista) lista.push(ig.fileId);
    else porMotivo.set(ig.reason, [ig.fileId]);
  }
  const detalhes = document.createElement('details');
  const titulo = document.createElement('summary');
  titulo.textContent = 'Ver motivos';
  detalhes.append(titulo);
  const maximo = 200;
  for (const [motivo, arquivos] of porMotivo) {
    const grupo = document.createElement('details');
    const t = document.createElement('summary');
    t.textContent = `${arquivos.length} × ${motivo}`;
    const ul = document.createElement('ul');
    for (const f of arquivos.slice(0, maximo)) {
      const li = document.createElement('li');
      li.textContent = f;
      ul.append(li);
    }
    if (arquivos.length > maximo) {
      const li = document.createElement('li');
      li.textContent = `… e mais ${arquivos.length - maximo}`;
      ul.append(li);
    }
    grupo.append(t, ul);
    detalhes.append(grupo);
  }
  resumo.append(detalhes);
}

/** Liga os controles e chama `aoConcluir` com o índice pronto. */
export function iniciarAbrirPasta(
  el: ElementosAbrirPasta,
  aoConcluir: (resultado: ResultadoAbertura) => void,
): void {
  let ocupado = false;

  async function processar(coletar: () => Promise<Candidato[]>): Promise<void> {
    if (ocupado) return;
    ocupado = true;
    el.botao.disabled = true;
    el.botaoAlternativo.disabled = true;
    el.resumo.textContent = 'Procurando arquivos…';
    el.progresso.hidden = false;
    el.progresso.max = 1;
    el.progresso.value = 0;
    try {
      const candidatos = await coletar();
      el.resumo.textContent = `Lendo ${candidatos.length} arquivos…`;
      const resultado = await indexarCandidatos(candidatos, (feitos, total) => {
        el.progresso.max = Math.max(total, 1);
        el.progresso.value = feitos;
        el.resumo.textContent = `Lendo cabeçalhos: ${feitos} de ${total}`;
      });
      mostrarResumo(el.resumo, resultado);
      aoConcluir(resultado);
    } catch (e) {
      el.resumo.replaceChildren();
      const div = document.createElement('div');
      div.className = 'erro';
      div.textContent = `Não foi possível abrir a pasta: ${mensagemDeErro(e)}`;
      el.resumo.append(div);
    } finally {
      el.progresso.hidden = true;
      el.botao.disabled = false;
      el.botaoAlternativo.disabled = false;
      ocupado = false;
    }
  }

  function abrirPorEntrada(): void {
    el.entradaPasta.value = '';
    el.entradaPasta.click();
  }

  el.botao.addEventListener('click', () => {
    const seletor = seletorNativo();
    if (!seletor) {
      abrirPorEntrada();
      return;
    }
    void (async () => {
      let pasta: HandlePasta;
      try {
        pasta = await seletor();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // usuário cancelou
        // Seletor indisponível (ex.: navegador embutido): cai para o <input webkitdirectory>.
        el.resumo.textContent = `Seletor nativo indisponível (${mensagemDeErro(e)}). Usando o seletor alternativo.`;
        abrirPorEntrada();
        return;
      }
      await processar(async () => {
        const saida: Candidato[] = [];
        await varrerHandle(pasta, pasta.name, saida);
        return saida;
      });
    })();
  });

  el.botaoAlternativo.addEventListener('click', abrirPorEntrada);

  el.entradaPasta.addEventListener('change', () => {
    const arquivos = Array.from(el.entradaPasta.files ?? []);
    if (arquivos.length === 0) return;
    void processar(async () =>
      arquivos.map((f) => ({ path: f.webkitRelativePath || f.name, obter: async () => f })),
    );
  });

  // Arrastar e soltar. Os dois eventos precisam de preventDefault para o navegador
  // não abrir o arquivo solto.
  el.zonaDrop.addEventListener('dragover', (ev) => {
    if (!ev.dataTransfer?.types.includes('Files')) return;
    ev.preventDefault();
    document.body.classList.add('arrastando');
  });
  el.zonaDrop.addEventListener('dragleave', (ev) => {
    if (ev.relatedTarget === null) document.body.classList.remove('arrastando');
  });
  el.zonaDrop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    document.body.classList.remove('arrastando');
    // webkitGetAsEntry precisa ser chamado agora, antes de qualquer await:
    // depois disso o DataTransfer fica vazio.
    const entradas: FileSystemEntry[] = [];
    for (const item of Array.from(ev.dataTransfer?.items ?? [])) {
      if (item.kind !== 'file') continue;
      const e = item.webkitGetAsEntry();
      if (e) entradas.push(e);
    }
    if (entradas.length === 0) return;
    void processar(async () => {
      const saida: Candidato[] = [];
      for (const e of entradas) await varrerEntrada(e, saida);
      return saida;
    });
  });
}
