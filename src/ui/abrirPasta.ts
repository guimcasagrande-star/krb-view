/**
 * Abertura de pasta: seletor nativo, <input webkitdirectory> e arrastar e soltar.
 * Lê só os cabeçalhos (readHeaderFromBlob) e monta o índice (buildIndex).
 * Nada sai da máquina; os arquivos ficam em memória como referências `File`.
 */

import { buildIndex, type DicomIndex } from '../io/organize';
import { readHeaderFromBlob } from '../io/readHeader';
import { registrarRecente } from '../state/recentes';
import type { InstanceMeta } from '../io/types';
import { extrairArquivosDoZip } from './leitorZip';

export const LEITURAS_SIMULTANEAS = 8;

export interface ArquivoIgnorado {
  fileId: string;
  reason: string;
}

export interface ResultadoAbertura {
  index: DicomIndex;
  /** Metadados válidos acumulados (para mesclar novas pastas abertas depois). */
  metas: InstanceMeta[];
  /** fileId (caminho relativo) -> File, para carregar os pixels depois. */
  arquivos: Map<string, File>;
  /** Arquivos encontrados no total. */
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

let contadorLotes = 0;

function gerarFileIdUnico(caminho: string, arquivos: Map<string, File>, lote: number): string {
  if (!arquivos.has(caminho)) return caminho;
  let tentativa = `pasta-${lote}/${caminho}`;
  let sufixo = 2;
  while (arquivos.has(tentativa)) {
    tentativa = `pasta-${lote}-${sufixo++}/${caminho}`;
  }
  return tentativa;
}

/**
 * Lê o cabeçalho de todos os candidatos, com no máximo `LEITURAS_SIMULTANEAS` ao mesmo tempo.
 * Se `anterior` for passado, acumula os novos arquivos junto com os estudos já carregados.
 */
export async function indexarCandidatos(
  candidatos: Candidato[],
  aoProgredir: (feitos: number, total: number) => void = () => {},
  anterior?: ResultadoAbertura | null,
): Promise<ResultadoAbertura> {
  const lote = ++contadorLotes;
  const totalLote = candidatos.length;
  const metasLote: (InstanceMeta | undefined)[] = new Array(totalLote);
  const arquivos = new Map<string, File>(anterior?.arquivos);
  const ignorados: ArquivoIgnorado[] = anterior ? [...anterior.ignorados] : [];
  let proximo = 0;
  let feitos = 0;

  async function trabalhador(): Promise<void> {
    for (;;) {
      const i = proximo++;
      if (i >= totalLote) return;
      const c = candidatos[i]!;
      try {
        const nome = c.path.split('/').pop() ?? c.path;
        if (nome.toUpperCase() === 'DICOMDIR') {
          ignorados.push({ fileId: c.path, reason: 'DICOMDIR (índice de mídia), não é uma imagem.' });
        } else {
          const arquivo = await c.obter();
          const fileId = gerarFileIdUnico(c.path, arquivos, lote);
          const r = await readHeaderFromBlob(arquivo, fileId);
          if (r.ok) {
            metasLote[i] = r.meta;
            arquivos.set(fileId, arquivo);
          } else {
            ignorados.push({ fileId, reason: r.reason });
          }
        }
      } catch (e) {
        ignorados.push({ fileId: c.path, reason: `Erro ao ler o arquivo: ${mensagemDeErro(e)}` });
      }
      feitos++;
      if (feitos === totalLote || feitos % 16 === 0) aoProgredir(feitos, totalLote);
    }
  }

  await Promise.all(Array.from({ length: Math.min(LEITURAS_SIMULTANEAS, totalLote) }, trabalhador));

  const lidasNovas = metasLote.filter((m): m is InstanceMeta => m !== undefined);
  const todasMetas = anterior ? [...anterior.metas, ...lidasNovas] : lidasNovas;
  const index = buildIndex(todasMetas);
  const idsDescartados = new Set(index.skipped.map((s) => s.fileId));
  for (const s of index.skipped) {
    ignorados.push({ fileId: s.fileId, reason: s.reason });
    arquivos.delete(s.fileId);
  }
  const metasValidas = todasMetas.filter((m) => !idsDescartados.has(m.fileId));
  const total = (anterior?.total ?? 0) + totalLote;
  return {
    index,
    metas: metasValidas,
    arquivos,
    total,
    lidos: metasValidas.length,
    ignorados,
  };
}

// ---------- interface ----------

export interface ElementosAbrirPasta {
  botao: HTMLButtonElement;
  botaoAlternativo: HTMLButtonElement;
  botaoLimpar?: HTMLButtonElement;
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

async function expandirCandidatosZip(candidatos: Candidato[]): Promise<Candidato[]> {
  const saida: Candidato[] = [];
  for (const c of candidatos) {
    if (c.path.toLowerCase().endsWith('.zip')) {
      const arqZip = await c.obter();
      const prefixo = c.path.replace(/\.zip$/i, '');
      const extraidos = await extrairArquivosDoZip(arqZip, prefixo);
      for (const ex of extraidos) {
        saida.push({ path: ex.caminho, obter: async () => ex.arquivo });
      }
    } else {
      saida.push(c);
    }
  }
  return saida;
}

let acaoAbrirPastaGlobal: (() => void) | null = null;
let acaoAbrirArquivosGlobal: (() => void) | null = null;
let acaoAbrirZipGlobal: (() => void) | null = null;
let acaoLimparListaGlobal: (() => void) | null = null;
let acaoAbrirRecenteGlobal: ((handle: unknown) => void) | null = null;
let acaoAbrirCandidatosGlobal: ((c: Array<{ path: string; obter(): Promise<File> }>) => void) | null = null;

export function dispararAbrirPasta(): void {
  acaoAbrirPastaGlobal?.();
}

export function dispararAbrirArquivos(): void {
  acaoAbrirArquivosGlobal?.();
}

export function dispararAbrirZip(): void {
  acaoAbrirZipGlobal?.();
}

/** Abre arquivos já localizados (ex.: o estudo baixado do PACS), pelo mesmo fluxo de "Abrir pasta". */
export function dispararAbrirCandidatos(candidatos: Array<{ path: string; obter(): Promise<File> }>): void {
  acaoAbrirCandidatosGlobal?.(candidatos);
}

/** Reabre uma pasta recente (o navegador pede de novo a permissão de leitura, se preciso). */
export function dispararAbrirRecente(handle: unknown): void {
  acaoAbrirRecenteGlobal?.(handle);
}

export function dispararLimparLista(): void {
  acaoLimparListaGlobal?.();
}

/** Liga os controles, acumula pastas/arquivos/ZIPs abertos e chama `aoConcluir` com o índice unificado. */
export function iniciarAbrirPasta(
  el: ElementosAbrirPasta,
  aoConcluir: (resultado: ResultadoAbertura) => void,
  aoLimpar?: () => void,
  aoIniciar?: () => void,
): void {
  let ocupado = false;
  let acumulado: ResultadoAbertura | null = null;
  const filaColetas: Array<() => Promise<Candidato[]>> = [];

  const entradaArquivos = document.createElement('input');
  entradaArquivos.type = 'file';
  entradaArquivos.multiple = true;
  entradaArquivos.hidden = true;
  document.body.append(entradaArquivos);

  const entradaZip = document.createElement('input');
  entradaZip.type = 'file';
  entradaZip.accept = '.zip,application/zip';
  entradaZip.multiple = true;
  entradaZip.hidden = true;
  document.body.append(entradaZip);

  function atualizarBotaoLimpar(): void {
    if (el.botaoLimpar) {
      el.botaoLimpar.hidden = !acumulado || acumulado.lidos === 0;
    }
  }

  async function processar(coletar: () => Promise<Candidato[]>): Promise<void> {
    if (ocupado) {
      filaColetas.push(coletar);
      return;
    }
    ocupado = true;
    aoIniciar?.();
    el.botao.disabled = true;
    el.botaoAlternativo.disabled = true;
    if (el.botaoLimpar) el.botaoLimpar.disabled = true;
    el.resumo.textContent = 'Procurando arquivos…';
    el.progresso.hidden = false;
    el.progresso.max = 1;
    el.progresso.value = 0;
    try {
      const brutos = await coletar();
      const temZip = brutos.some((c) => c.path.toLowerCase().endsWith('.zip'));
      if (temZip) {
        el.resumo.textContent = 'Descompactando arquivo(s) ZIP…';
      }
      const candidatos = await expandirCandidatosZip(brutos);
      el.resumo.textContent = `Lendo ${candidatos.length} arquivos…`;
      const resultado = await indexarCandidatos(
        candidatos,
        (feitos, total) => {
          el.progresso.max = Math.max(total, 1);
          el.progresso.value = feitos;
          el.resumo.textContent = `Lendo cabeçalhos: ${feitos} de ${total}`;
        },
        acumulado,
      );
      acumulado = resultado;
      mostrarResumo(el.resumo, resultado);
      atualizarBotaoLimpar();
      aoConcluir(resultado);
    } catch (e) {
      el.resumo.replaceChildren();
      const div = document.createElement('div');
      div.className = 'erro';
      div.textContent = `Não foi possível abrir os arquivos: ${mensagemDeErro(e)}`;
      el.resumo.append(div);
    } finally {
      el.progresso.hidden = true;
      el.botao.disabled = false;
      el.botaoAlternativo.disabled = false;
      if (el.botaoLimpar) el.botaoLimpar.disabled = false;
      ocupado = false;
      const proxima = filaColetas.shift();
      if (proxima) void processar(proxima);
    }
  }

  function limparLista(): void {
    if (ocupado || filaColetas.length > 0) return;
    acumulado = null;
    el.resumo.replaceChildren();
    atualizarBotaoLimpar();
    aoLimpar?.();
  }

  el.botaoLimpar?.addEventListener('click', limparLista);

  function abrirPorEntradaPasta(): void {
    el.entradaPasta.value = '';
    el.entradaPasta.click();
  }

  function abrirPastaNativaOuAlternativa(): void {
    const seletor = seletorNativo();
    if (!seletor) {
      abrirPorEntradaPasta();
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
        abrirPorEntradaPasta();
        return;
      }
      void registrarRecente(pasta);
      await processar(async () => {
        const saida: Candidato[] = [];
        await varrerHandle(pasta, pasta.name, saida);
        return saida;
      });
    })();
  }

  function abrirRecente(handle: unknown): void {
    const pasta = handle as HandlePasta & {
      requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
    };
    void (async () => {
      try {
        if (pasta.requestPermission && (await pasta.requestPermission({ mode: 'read' })) !== 'granted') {
          el.resumo.textContent = 'Sem permissão para ler a pasta recente.';
          return;
        }
        void registrarRecente(pasta);
        await processar(async () => {
          const saida: Candidato[] = [];
          await varrerHandle(pasta, pasta.name, saida);
          return saida;
        });
      } catch (e) {
        el.resumo.textContent = `Não foi possível reabrir a pasta recente: ${mensagemDeErro(e)}`;
      }
    })();
  }

  function abrirArquivosDicom(): void {
    entradaArquivos.value = '';
    entradaArquivos.click();
  }

  function abrirArquivosZip(): void {
    entradaZip.value = '';
    entradaZip.click();
  }

  acaoAbrirPastaGlobal = abrirPastaNativaOuAlternativa;
  acaoAbrirArquivosGlobal = abrirArquivosDicom;
  acaoAbrirZipGlobal = abrirArquivosZip;
  acaoLimparListaGlobal = limparLista;
  acaoAbrirRecenteGlobal = abrirRecente;
  acaoAbrirCandidatosGlobal = (c) => void processar(async () => c);

  el.botao.addEventListener('click', abrirPastaNativaOuAlternativa);
  el.botaoAlternativo.addEventListener('click', abrirPorEntradaPasta);

  el.entradaPasta.addEventListener('change', () => {
    const arquivos = Array.from(el.entradaPasta.files ?? []);
    if (arquivos.length === 0) return;
    void processar(async () =>
      arquivos.map((f) => ({ path: f.webkitRelativePath || f.name, obter: async () => f })),
    );
  });

  entradaArquivos.addEventListener('change', () => {
    const arquivos = Array.from(entradaArquivos.files ?? []);
    if (arquivos.length === 0) return;
    void processar(async () => arquivos.map((f) => ({ path: f.name, obter: async () => f })));
  });

  entradaZip.addEventListener('change', () => {
    const arquivos = Array.from(entradaZip.files ?? []);
    if (arquivos.length === 0) return;
    void processar(async () => arquivos.map((f) => ({ path: f.name, obter: async () => f })));
  });

  // Arrastar e soltar (pastas, arquivos DICOM soltos ou arquivos .zip):
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
