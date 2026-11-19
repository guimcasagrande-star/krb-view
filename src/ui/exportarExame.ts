/**
 * Modal "Exportar exame…": exporta o estudo inteiro ou séries selecionadas para uma pasta
 * escolhida pelo usuário, em formato DICOM + DICOMDIR ou JPEG, com anonimização opcional.
 *
 * Nunca altera os arquivos originais do exame — grava sempre cópias na pasta de destino.
 */

import { cache, getRenderingEngine, imageLoader, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { anonimizarDicom, garantirPart10 } from '../export/anonimizarDicom';
import {
  caminhoDicomdir,
  gerarDicomdir,
  type EntradaEstudoDicomdir,
  type EntradaImagemDicomdir,
  type EntradaPacienteDicomdir,
  type EntradaSerieDicomdir,
} from '../export/dicomdir';
import { formatDatePtBr } from '../io/dicomTime';
import type { PatientNode, SeriesNode, StudyNode } from '../io/organize';
import type { InstanceMeta } from '../io/types';
import { escolherPastaDestino, gravarExame, tauriDisponivel } from '../state/examesBaixados';
import { estado } from '../state/store';
import { ID_MOTOR, iniciarCornerstone } from '../viewer/iniciar';

interface EstudoComPaciente {
  paciente: PatientNode;
  estudo: StudyNode;
}

interface JanelaViewport {
  lower: number;
  upper: number;
  invert?: boolean;
}

interface DestinoGravacao {
  rotuloDestino: string;
  gravar(relativo: string, bytes: Uint8Array): Promise<void>;
}

interface HandleArquivoEscrita {
  createWritable(): Promise<{ write(dados: BlobPart): Promise<void>; close(): Promise<void> }>;
}
interface HandlePastaEscrita {
  name: string;
  getDirectoryHandle(nome: string, opcoes?: { create?: boolean }): Promise<HandlePastaEscrita>;
  getFileHandle(nome: string, opcoes?: { create?: boolean }): Promise<HandleArquivoEscrita>;
}
type SeletorPastaEscrita = (opcoes?: { mode?: 'read' | 'readwrite' }) => Promise<HandlePastaEscrita>;

let caixa: HTMLDialogElement | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...filhos: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const { class: classe, ...resto } = props as Record<string, unknown>;
  const e = Object.assign(document.createElement(tag), resto);
  if (classe) e.className = String(classe);
  e.append(...filhos);
  return e;
}

function sanitizarSegmento(texto: string, fallback: string, maxLen = 40): string {
  const limpo = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLen);
  return limpo || fallback;
}

function carimboAgora(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listarEstudos(): EstudoComPaciente[] {
  const res = estado.resultado;
  if (!res) return [];
  const lista: EstudoComPaciente[] = [];
  for (const paciente of res.index.patients) {
    for (const estudo of paciente.studies) {
      lista.push({ paciente, estudo });
    }
  }
  return lista;
}

function instanciasDaSerie(serie: SeriesNode): InstanceMeta[] {
  const out: InstanceMeta[] = [];
  for (const pilha of serie.stacks) {
    for (const inst of pilha.instances) out.push(inst);
  }
  return out;
}

function obterJanelaViewportAtivo(): { serieUid: string; janela: JanelaViewport } | null {
  const idVp = estado.idViewportAtivo;
  const pilha = estado.pilhaAtiva;
  if (!idVp || !pilha) return null;
  const serieUid = pilha.instances[0]?.seriesInstanceUid;
  if (!serieUid) return null;
  const motor = getRenderingEngine(ID_MOTOR);
  const vp = motor?.getViewport(idVp) as
    | { getProperties?: () => { voiRange?: { lower: number; upper: number }; invert?: boolean } }
    | undefined;
  const props = vp?.getProperties?.();
  if (!props?.voiRange) return null;
  const { lower, upper } = props.voiRange;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;
  return { serieUid, janela: { lower, upper, invert: props.invert } };
}

async function escolherDestino(nomeSubpasta: string): Promise<DestinoGravacao | null> {
  if (tauriDisponivel()) {
    const pasta = await escolherPastaDestino('Escolher pasta onde salvar a exportação do exame');
    if (!pasta) return null;
    const separador = pasta.includes('\\') ? '\\' : '/';
    const destinoCompleto = `${pasta.replace(/[\\/]+$/, '')}${separador}${nomeSubpasta}`;
    return {
      rotuloDestino: destinoCompleto,
      async gravar(relativo: string, bytes: Uint8Array) {
        const rel = relativo.replace(/^\/+/, '');
        await gravarExame(pasta, `${nomeSubpasta}/${rel}`, bytes);
      },
    };
  }

  const picker = (window as unknown as { showDirectoryPicker?: SeletorPastaEscrita }).showDirectoryPicker;
  if (typeof picker !== 'function') {
    throw new Error('Seu navegador não permite gravar em pasta local. Use o programa instalado (Tauri) ou Chrome/Edge.');
  }
  let pastaRaiz: HandlePastaEscrita;
  try {
    pastaRaiz = await picker.call(window, { mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
  const sub = await pastaRaiz.getDirectoryHandle(nomeSubpasta, { create: true });
  return {
    rotuloDestino: `${pastaRaiz.name}/${nomeSubpasta}`,
    async gravar(relativo: string, bytes: Uint8Array) {
      const partes = relativo.split('/').filter(Boolean);
      const nomeArquivo = partes.pop();
      if (!nomeArquivo) return;
      let dir = sub;
      for (const parte of partes) {
        dir = await dir.getDirectoryHandle(parte, { create: true });
      }
      const fh = await dir.getFileHandle(nomeArquivo, { create: true });
      const w = await fh.createWritable();
      try {
        await w.write(bytes as BlobPart);
      } finally {
        await w.close();
      }
    },
  };
}

function primeiroNumero(v: number | number[] | undefined): number | undefined {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Converte uma imagem decodificada pelo Cornerstone em bytes JPEG limpos (sem overlay de texto).
 */
async function imagemParaJpeg(
  imagem: Types.IImage,
  qualidade: number,
  janelaOverride?: JanelaViewport,
  padraoInvertido = false,
): Promise<Uint8Array> {
  let tela: HTMLCanvasElement;
  if (imagem.color) {
    tela = imagem.getCanvas();
  } else {
    const { rows, columns } = imagem;
    const dados = imagem.getPixelData();
    const preEscalado = Boolean(imagem.isPreScaled || imagem.preScale?.scaled);
    const inclinacao = preEscalado ? 1 : (imagem.slope ?? 1);
    const intercepto = preEscalado ? 0 : (imagem.intercept ?? 0);

    let baixo: number;
    let largura: number;
    if (janelaOverride) {
      baixo = janelaOverride.lower;
      largura = Math.max(janelaOverride.upper - janelaOverride.lower, 1e-6);
    } else {
      const ww = primeiroNumero(imagem.windowWidth);
      const wc = primeiroNumero(imagem.windowCenter);
      if (ww !== undefined && wc !== undefined && ww > 0) {
        baixo = wc - ww / 2;
        largura = ww;
      } else {
        const minimo = imagem.minPixelValue * inclinacao + intercepto;
        const maximo = imagem.maxPixelValue * inclinacao + intercepto;
        baixo = minimo;
        largura = Math.max(maximo - minimo, 1e-6);
      }
    }

    const inverter = janelaOverride?.invert ?? (imagem.invert || padraoInvertido);
    tela = document.createElement('canvas');
    tela.width = columns;
    tela.height = rows;
    const ctx = tela.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponível para gerar JPEG.');
    const imgData = ctx.createImageData(columns, rows);
    const total = rows * columns;
    for (let i = 0; i < total; i++) {
      const val = dados[i]! * inclinacao + intercepto;
      let v = Math.round(Math.min(Math.max((val - baixo) / largura, 0), 1) * 255);
      if (inverter) v = 255 - v;
      const o = i * 4;
      imgData.data[o] = v;
      imgData.data[o + 1] = v;
      imgData.data[o + 2] = v;
      imgData.data[o + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const blob = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, 'image/jpeg', qualidade));
  if (!blob) throw new Error('Falha ao codificar JPEG.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportarDicomdir(
  alvo: EstudoComPaciente,
  series: SeriesNode[],
  opcoes: {
    anonimizar: boolean;
    rotuloPaciente: string;
    destino: DestinoGravacao;
    signal: AbortSignal;
    onProgresso: (feitos: number, total: number, texto: string) => void;
  },
): Promise<{ arquivos: number; series: number; cancelado: boolean }> {
  const mapaArquivos = estado.resultado?.arquivos;
  if (!mapaArquivos) throw new Error('Nenhum exame aberto.');

  const total = series.reduce((n, s) => n + instanciasDaSerie(s).length, 0);
  let feitos = 0;

  const mapaUids = new Map<string, string>();
  const seriesDir: EntradaSerieDicomdir[] = [];
  let nomePacFinal = alvo.paciente.name;
  let idPacFinal = alvo.paciente.patientId ?? '';
  let studyUidFinal = alvo.estudo.studyInstanceUid;

  for (let idxSerie = 0; idxSerie < series.length; idxSerie++) {
    const serie = series[idxSerie]!;
    const instancias = instanciasDaSerie(serie);
    const imagensDir: EntradaImagemDicomdir[] = [];
    let seriesUidFinal = serie.seriesInstanceUid;

    for (let idxImg = 0; idxImg < instancias.length; idxImg++) {
      if (opcoes.signal.aborted) {
        return { arquivos: feitos, series: idxSerie, cancelado: true };
      }
      const inst = instancias[idxImg]!;
      const arquivo = mapaArquivos.get(inst.fileId);
      if (!arquivo) continue;

      const bytesOriginais = new Uint8Array(await arquivo.arrayBuffer());
      let bytesFinal: Uint8Array;
      let sopClassUid = inst.sopClassUid ?? '1.2.840.10008.5.1.4.1.1.7';
      let sopInstanceUid = inst.sopInstanceUid ?? `${serie.seriesInstanceUid}.${idxImg + 1}`;
      let transferSyntaxUid = inst.transferSyntaxUid ?? '1.2.840.10008.1.2.1';

      if (opcoes.anonimizar) {
        const res = anonimizarDicom(bytesOriginais, {
          rotuloPaciente: opcoes.rotuloPaciente,
          mapaUids,
        });
        bytesFinal = res.bytes;
        nomePacFinal = res.patientName;
        idPacFinal = res.patientId;
        if (res.studyInstanceUid) studyUidFinal = res.studyInstanceUid;
        if (res.seriesInstanceUid) seriesUidFinal = res.seriesInstanceUid;
        if (res.sopInstanceUid) sopInstanceUid = res.sopInstanceUid;
        if (res.sopClassUid) sopClassUid = res.sopClassUid;
        transferSyntaxUid = res.transferSyntaxUid;
      } else {
        const garantido = garantirPart10(bytesOriginais, {
          sopClassUid,
          sopInstanceUid,
          transferSyntaxUid,
        });
        bytesFinal = garantido.bytes;
        transferSyntaxUid = garantido.transferSyntaxUid;
      }

      const caminho = caminhoDicomdir(0, idxSerie, idxImg);
      await opcoes.destino.gravar(caminho.join('/'), bytesFinal);

      imagensDir.push({
        caminhoRelativo: caminho,
        sopClassUid,
        sopInstanceUid,
        transferSyntaxUid,
        instanceNumber: inst.instanceNumber ?? idxImg + 1,
      });

      feitos++;
      opcoes.onProgresso(
        feitos,
        total,
        `Exportando DICOM (${feitos}/${total}) — série ${idxSerie + 1}/${series.length}…`,
      );
    }

    if (imagensDir.length > 0) {
      seriesDir.push({
        seriesInstanceUid: seriesUidFinal,
        modality: serie.modality,
        seriesNumber: serie.seriesNumber,
        description: serie.description,
        imagens: imagensDir,
      });
    }
  }

  if (opcoes.signal.aborted) {
    return { arquivos: feitos, series: seriesDir.length, cancelado: true };
  }

  opcoes.onProgresso(feitos, total, 'Gerando índice DICOMDIR…');

  const entradaEstudo: EntradaEstudoDicomdir = {
    studyInstanceUid: studyUidFinal,
    studyDate: alvo.estudo.date,
    studyTime: alvo.estudo.time,
    accessionNumber: opcoes.anonimizar ? '' : (alvo.estudo.accessionNumber ?? ''),
    description: alvo.estudo.description,
    series: seriesDir,
  };
  const entradaPaciente: EntradaPacienteDicomdir = {
    patientName: opcoes.anonimizar ? nomePacFinal : alvo.paciente.name,
    patientId: opcoes.anonimizar ? idPacFinal : (alvo.paciente.patientId ?? ''),
    birthDate: opcoes.anonimizar ? undefined : alvo.paciente.birthDate,
    sex: alvo.paciente.sex,
    estudos: [entradaEstudo],
  };

  const dicomdirBytes = gerarDicomdir([entradaPaciente]);
  await opcoes.destino.gravar('DICOMDIR', dicomdirBytes);

  return { arquivos: feitos, series: seriesDir.length, cancelado: false };
}

async function exportarJpeg(
  series: SeriesNode[],
  opcoes: {
    qualidade: number;
    janelaViewportAtivo: { serieUid: string; janela: JanelaViewport } | null;
    destino: DestinoGravacao;
    signal: AbortSignal;
    onProgresso: (feitos: number, total: number, texto: string) => void;
  },
): Promise<{ arquivos: number; series: number; ignorados: number; cancelado: boolean }> {
  const mapaArquivos = estado.resultado?.arquivos;
  if (!mapaArquivos) throw new Error('Nenhum exame aberto.');

  await iniciarCornerstone();

  const total = series.reduce((n, s) => n + instanciasDaSerie(s).length, 0);
  let feitos = 0;
  let ignorados = 0;
  let seriesExportadas = 0;

  for (let idxSerie = 0; idxSerie < series.length; idxSerie++) {
    const serie = series[idxSerie]!;
    const instancias = instanciasDaSerie(serie);
    const numSerie = String(serie.seriesNumber ?? idxSerie + 1).padStart(3, '0');
    const pastaSerie = `${numSerie}_${sanitizarSegmento(serie.modality || 'OT', 'OT', 8)}_${sanitizarSegmento(serie.description || 'serie', 'serie', 32)}`;
    const janelaOverride =
      opcoes.janelaViewportAtivo && opcoes.janelaViewportAtivo.serieUid === serie.seriesInstanceUid
        ? opcoes.janelaViewportAtivo.janela
        : undefined;
    const padraoInvertido = serie.modality === 'PT';

    let imgsNaSerie = 0;
    for (let idxImg = 0; idxImg < instancias.length; idxImg++) {
      if (opcoes.signal.aborted) {
        return { arquivos: feitos, series: seriesExportadas, ignorados, cancelado: true };
      }
      const inst = instancias[idxImg]!;
      const arquivo = mapaArquivos.get(inst.fileId);
      if (!arquivo) continue;

      const imageId = wadouri.fileManager.add(arquivo);
      try {
        const imagem = await imageLoader.loadAndCacheImage(imageId);
        const jpeg = await imagemParaJpeg(imagem, opcoes.qualidade, janelaOverride, padraoInvertido);
        const nomeArquivo = `${String(idxImg + 1).padStart(4, '0')}.jpg`;
        await opcoes.destino.gravar(`${pastaSerie}/${nomeArquivo}`, jpeg);
        imgsNaSerie++;
      } catch {
        // Instâncias sem pixels (ex.: SR, DICOM SEG, PR) são ignoradas na exportação JPEG
        ignorados++;
      } finally {
        try {
          cache.removeImageLoadObject(imageId);
        } catch {
          /* não chegou a entrar no cache */
        }
        const indice = Number(imageId.slice(imageId.indexOf(':') + 1));
        if (Number.isInteger(indice)) wadouri.fileManager.remove(indice);
      }

      feitos++;
      opcoes.onProgresso(
        feitos,
        total,
        `Exportando JPEG (${feitos}/${total}) — série ${idxSerie + 1}/${series.length}…`,
      );
    }

    if (imgsNaSerie > 0) seriesExportadas++;
  }

  return { arquivos: feitos - ignorados, series: seriesExportadas, ignorados, cancelado: false };
}

function desenhar(d: HTMLDialogElement): void {
  const corpo = d.querySelector<HTMLElement>('.exportar-corpo')!;
  corpo.replaceChildren();

  const estudos = listarEstudos();
  if (estudos.length === 0) {
    corpo.append(el('p', { class: 'cfg-aviso', textContent: 'Abra um exame antes de exportar.' }));
    return;
  }

  // Pré-seleciona o estudo da pilha ativa (ou o primeiro aberto)
  const studyUidAtivo = estado.pilhaAtiva?.instances[0]?.studyInstanceUid;
  let indiceEstudo = Math.max(
    0,
    estudos.findIndex((e) => e.estudo.studyInstanceUid === studyUidAtivo),
  );

  const selEstudo = el('select', {});
  estudos.forEach((item, idx) => {
    const data = item.estudo.date ? formatDatePtBr(item.estudo.date) : '';
    const desc = item.estudo.description || 'Estudo sem descrição';
    const rotulo = [item.paciente.name, data, desc].filter(Boolean).join(' · ');
    selEstudo.append(el('option', { value: String(idx), textContent: rotulo }));
  });
  selEstudo.value = String(indiceEstudo);
  const linhaEstudo = el('label', { class: 'cfg-linha' }, el('span', {}, 'Estudo'), selEstudo);

  // Lista de séries com checkboxes
  const cabSeries = el('div', { class: 'exportar-series-cab' });
  const resumoSel = el('span', { class: 'cfg-dica' });
  const btnTodas = el('button', { type: 'button', textContent: 'Marcar todas' });
  const btnNenhuma = el('button', { type: 'button', textContent: 'Desmarcar todas' });
  cabSeries.append(el('strong', {}, 'Séries para exportar'), resumoSel, el('div', { class: 'exportar-series-acoes' }, btnTodas, btnNenhuma));

  const listaSeries = el('div', { class: 'exportar-series-lista' });
  let checkboxesSeries: Array<{ serie: SeriesNode; cb: HTMLInputElement }> = [];

  const atualizarResumoSeries = (): void => {
    const marcadas = checkboxesSeries.filter((x) => x.cb.checked);
    const totalImgs = marcadas.reduce((n, x) => n + instanciasDaSerie(x.serie).length, 0);
    resumoSel.textContent = `${marcadas.length}/${checkboxesSeries.length} séries · ${totalImgs} imagens`;
    btnExportar.disabled = marcadas.length === 0;
  };

  const montarSeries = (): void => {
    listaSeries.replaceChildren();
    checkboxesSeries = [];
    const atual = estudos[indiceEstudo]!;
    for (const serie of atual.estudo.series) {
      const qtd = instanciasDaSerie(serie).length;
      if (qtd === 0) continue;
      const cb = el('input', { type: 'checkbox', checked: true });
      cb.addEventListener('change', atualizarResumoSeries);
      const num = serie.seriesNumber !== undefined ? `#${serie.seriesNumber}` : '';
      const mod = serie.modality || 'OT';
      const desc = serie.description || 'Sem descrição';
      const linha = el(
        'label',
        { class: 'exportar-serie-item' },
        cb,
        el('span', { class: 'exportar-serie-mod', textContent: mod }),
        el('span', { class: 'exportar-serie-desc', textContent: `${num ? `${num} ` : ''}${desc}` }),
        el('span', { class: 'exportar-serie-qtd', textContent: `${qtd} img` }),
      );
      listaSeries.append(linha);
      checkboxesSeries.push({ serie, cb });
    }
    atualizarResumoSeries();
  };

  btnTodas.addEventListener('click', () => {
    for (const x of checkboxesSeries) x.cb.checked = true;
    atualizarResumoSeries();
  });
  btnNenhuma.addEventListener('click', () => {
    for (const x of checkboxesSeries) x.cb.checked = false;
    atualizarResumoSeries();
  });

  // Formato
  const selFormato = el(
    'select',
    {},
    el('option', { value: 'dicomdir', textContent: 'DICOM + DICOMDIR (compatível com RadiAnt, Weasis, Horos)' }),
    el('option', { value: 'jpeg', textContent: 'JPEG (uma subpasta por série, sem texto de paciente)' }),
  );
  const linhaFormato = el('label', { class: 'cfg-linha' }, el('span', {}, 'Formato'), selFormato);

  // Opções específicas de JPEG
  const janelaAtiva = obterJanelaViewportAtivo();
  const cbJanelaAtiva = el('input', { type: 'checkbox', checked: Boolean(janelaAtiva) });
  const linhaJanelaAtiva = el(
    'label',
    {
      class: 'cfg-linha',
      title: 'Aplica a janela/nível que você ajustou no viewport ativo ao exportar a série aberta; as demais usam a janela padrão do DICOM.',
    },
    el('span', {}, 'Usar janela/nível atual do viewport na série aberta'),
    cbJanelaAtiva,
  );
  const selQualidade = el(
    'select',
    {},
    el('option', { value: '0.92', textContent: 'Alta (92% — recomendado)' }),
    el('option', { value: '0.98', textContent: 'Máxima (98%)' }),
    el('option', { value: '0.80', textContent: 'Compacta (80%)' }),
  );
  const linhaQualidade = el('label', { class: 'cfg-linha' }, el('span', {}, 'Qualidade JPEG'), selQualidade);
  const blocoJpeg = el('div', { class: 'exportar-bloco-jpeg' }, linhaJanelaAtiva, linhaQualidade);

  // Anonimização
  const cbAnonimizar = el('input', { type: 'checkbox', checked: false });
  const linhaAnonimizar = el('label', { class: 'cfg-linha' }, el('span', {}, 'Anonimizar exame'), cbAnonimizar);
  const inputRotulo = el('input', { type: 'text', value: 'ANONIMO', maxLength: 32 });
  const linhaRotulo = el(
    'label',
    { class: 'cfg-linha' },
    el('span', {}, 'Nome / ID substituto'),
    inputRotulo,
  );
  const notaAnon = el('p', {
    class: 'cfg-dica exportar-nota',
    textContent:
      'Remove nome, ID, data de nascimento, accession, médicos e instituição e gera novos UIDs coerentes. Mantém peso, altura, sexo e horários técnicos (HU e SUV preservados). Os arquivos originais não são alterados.',
  });

  const atualizarVisibilidade = (): void => {
    const ehJpeg = selFormato.value === 'jpeg';
    blocoJpeg.hidden = !ehJpeg;
    linhaJanelaAtiva.hidden = !ehJpeg || !janelaAtiva;
    linhaRotulo.hidden = !cbAnonimizar.checked;
    notaAnon.hidden = !cbAnonimizar.checked || ehJpeg;
  };
  selFormato.addEventListener('change', atualizarVisibilidade);
  cbAnonimizar.addEventListener('change', atualizarVisibilidade);

  // Progresso e botões
  const barra = el('progress', { class: 'exportar-progresso', value: 0, max: 100 });
  barra.hidden = true;
  const status = el('p', { class: 'exportar-status' });
  status.hidden = true;

  const btnExportar = el('button', { type: 'button', class: 'primario', textContent: 'Escolher pasta e exportar…' });
  const btnCancelar = el('button', { type: 'button', textContent: 'Cancelar' });
  btnCancelar.hidden = true;

  let controle: AbortController | null = null;
  btnCancelar.addEventListener('click', () => {
    controle?.abort();
    btnCancelar.disabled = true;
    status.textContent = 'Cancelando exportação…';
  });

  selEstudo.addEventListener('change', () => {
    indiceEstudo = Number(selEstudo.value);
    montarSeries();
  });

  btnExportar.addEventListener('click', async () => {
    const selecionadas = checkboxesSeries.filter((x) => x.cb.checked).map((x) => x.serie);
    if (selecionadas.length === 0) return;

    const atual = estudos[indiceEstudo]!;
    const anonimizar = cbAnonimizar.checked;
    const rotulo = inputRotulo.value.trim() || 'ANONIMO';
    const formato = selFormato.value as 'dicomdir' | 'jpeg';

    const prefixoPasta = anonimizar
      ? sanitizarSegmento(rotulo, 'ANONIMO', 28)
      : sanitizarSegmento(atual.paciente.name, 'EXAME', 28);
    const sufixoFormato = formato === 'dicomdir' ? 'DICOMDIR' : 'JPEG';
    const nomeSubpasta = `${prefixoPasta}_${sufixoFormato}_${carimboAgora()}`;

    let destino: DestinoGravacao | null;
    try {
      destino = await escolherDestino(nomeSubpasta);
    } catch (e) {
      status.hidden = false;
      status.className = 'exportar-status erro';
      status.textContent = e instanceof Error ? e.message : String(e);
      return;
    }
    if (!destino) return;

    controle = new AbortController();
    btnExportar.disabled = true;
    selEstudo.disabled = true;
    selFormato.disabled = true;
    cbAnonimizar.disabled = true;
    inputRotulo.disabled = true;
    btnTodas.disabled = true;
    btnNenhuma.disabled = true;
    for (const x of checkboxesSeries) x.cb.disabled = true;
    btnCancelar.hidden = false;
    btnCancelar.disabled = false;
    barra.hidden = false;
    barra.value = 0;
    status.hidden = false;
    status.className = 'exportar-status';
    status.textContent = 'Preparando exportação…';

    try {
      const onProgresso = (feitos: number, total: number, texto: string) => {
        barra.max = Math.max(1, total);
        barra.value = feitos;
        status.textContent = texto;
      };

      if (formato === 'dicomdir') {
        const res = await exportarDicomdir(atual, selecionadas, {
          anonimizar,
          rotuloPaciente: rotulo,
          destino,
          signal: controle.signal,
          onProgresso,
        });
        if (res.cancelado) {
          status.className = 'exportar-status aviso';
          status.textContent = `Exportação cancelada (${res.arquivos} arquivos já gravados em ${destino.rotuloDestino}).`;
        } else {
          status.className = 'exportar-status ok';
          status.textContent = `✓ Exportado com sucesso: ${res.arquivos} arquivos DICOM + DICOMDIR (${res.series} séries) em ${destino.rotuloDestino}`;
        }
      } else {
        const res = await exportarJpeg(selecionadas, {
          qualidade: Number(selQualidade.value) || 0.92,
          janelaViewportAtivo: cbJanelaAtiva.checked ? janelaAtiva : null,
          destino,
          signal: controle.signal,
          onProgresso,
        });
        if (res.cancelado) {
          status.className = 'exportar-status aviso';
          status.textContent = `Exportação cancelada (${res.arquivos} JPEGs já gravados em ${destino.rotuloDestino}).`;
        } else {
          const extra = res.ignorados > 0 ? ` (${res.ignorados} arquivos não-imagem ignorados)` : '';
          status.className = 'exportar-status ok';
          status.textContent = `✓ Exportado com sucesso: ${res.arquivos} imagens JPEG em ${res.series} séries${extra} — ${destino.rotuloDestino}`;
        }
      }
    } catch (e) {
      status.className = 'exportar-status erro';
      status.textContent = `Erro ao exportar: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      controle = null;
      btnCancelar.hidden = true;
      selEstudo.disabled = false;
      selFormato.disabled = false;
      cbAnonimizar.disabled = false;
      inputRotulo.disabled = false;
      btnTodas.disabled = false;
      btnNenhuma.disabled = false;
      for (const x of checkboxesSeries) x.cb.disabled = false;
      atualizarResumoSeries();
    }
  });

  montarSeries();
  atualizarVisibilidade();

  corpo.append(
    linhaEstudo,
    cabSeries,
    listaSeries,
    linhaFormato,
    blocoJpeg,
    linhaAnonimizar,
    linhaRotulo,
    notaAnon,
    barra,
    status,
    el('div', { class: 'pacs-botoes' }, btnExportar, btnCancelar),
  );
}

function criarCaixa(): HTMLDialogElement {
  const d = el('dialog', { id: 'exportar-exame' });
  d.setAttribute('aria-label', 'Exportar exame');
  const fechar = el('button', { type: 'button', textContent: 'Fechar', class: 'cfg-fechar' });
  fechar.addEventListener('click', () => d.close());
  d.append(el('h2', {}, 'Exportar exame'), el('div', { class: 'exportar-corpo' }), fechar);
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

export function abrirExportarExame(): void {
  caixa ??= criarCaixa();
  desenhar(caixa);
  if (!caixa.open) caixa.showModal();
}
