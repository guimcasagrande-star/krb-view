/**
 * Painel "Segmentação" da série ativa (fase 9.1), na barra lateral: ferramentas, raio do pincel,
 * faixa de valores (pincel com limiar e crescer região), aparência e a lista de segmentos
 * (nome, cor, mostrar, bloquear, apagar, novo). Aparece quando a série ativa tem segmentação.
 */

import { ToolGroupManager, utilities as utilitariosTools } from '@cornerstonejs/tools';
import {
  EVENTO_MENSAGEM_SEGMENTACAO,
  FERRAMENTAS_SEGMENTACAO,
  RAIO_PADRAO_MM,
} from '../segmentation/ferramentas';
import {
  apagarSegmentacao,
  apagarSegmento,
  definirBloqueadoSegmento,
  definirCorSegmento,
  definirEstilo,
  definirFaixa,
  definirSegmentoAtivo,
  definirVisivelSegmento,
  estiloSegmentacao,
  EVENTO_SEGMENTACAO,
  faixaSegmentacao,
  novoSegmento,
  renomearSegmento,
  segmentacaoDaPilha,
  volumetriaDa,
} from '../segmentation/segmentacao';
import { csvVolumetria, type LinhaVolumetria } from '../segmentation/volumetria';
import { codificarSegmentacao, EXTENSAO_SEGMENTACAO, nomeSugerido } from '../segmentation/arquivoSegmentacao';
import { dadosParaSalvar } from '../segmentation/segmentacao';
import { estado } from '../state/store';
import { escolherFerramentaPrimaria, EVENTO_BOTOES_MUDARAM, ferramentaPrimariaAtual, ID_GRUPO } from '../tools/grupo';
import { abrirSegmentacaoSalva, EVENTO_ESTADO_VIEWPORTS, garantirSegmentacaoAtiva } from '../viewer/viewport2d';

let raioMm = RAIO_PADRAO_MM;

/** Leva o raio e a faixa do painel às instâncias do pincel no grupo de ferramentas. */
function aplicarAjustesDoPincel(): void {
  if (!ToolGroupManager.getToolGroup(ID_GRUPO)) return;
  utilitariosTools.segmentation.setBrushSizeForToolGroup(ID_GRUPO, raioMm);
  const f = faixaSegmentacao();
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (!grupo?.hasTool('SegPincelLimiar')) return;
  const range = f.min !== null || f.max !== null ? [f.min ?? -1e9, f.max ?? 1e9] : [];
  grupo.setToolConfiguration('SegPincelLimiar', { threshold: { range } });
}

/** Apaga a segmentação da série ativa, com confirmação. */
export function apagarSegmentacaoAtiva(): void {
  const id = estado.pilhaAtiva?.id;
  if (!id || !segmentacaoDaPilha(id)) return;
  if (!window.confirm('Apagar a segmentação desta série (todos os segmentos)? Não dá para desfazer.')) return;
  apagarSegmentacao(id);
}

/** Novo segmento na série ativa (cria a segmentação se ainda não houver). */
export async function novoSegmentoAtivo(): Promise<void> {
  const id = estado.pilhaAtiva?.id;
  if (!id) return;
  if (!segmentacaoDaPilha(id)) {
    await garantirSegmentacaoAtiva();
    return;
  }
  novoSegmento(id);
}

const fmt = (n: number | undefined, casas: number): string =>
  n === undefined || !Number.isFinite(n)
    ? '—'
    : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Texto curto da volumetria de um segmento (abaixo do nome, no painel). */
function textoVolumetria(l: LinhaVolumetria | undefined, unidade: string, ehPet: boolean): string {
  if (!l) return '';
  if (l.voxels === 0) return 'vazio';
  if (ehPet) {
    return (
      `MTV ${fmt(l.volumeMl, 2)} mL · máx ${fmt(l.max, 2)} · médio ${fmt(l.media, 2)}` +
      `${l.pico !== undefined ? ` · pico ${fmt(l.pico, 2)}` : ''} · TLG ${fmt(l.tlg, 1)}`
    );
  }
  const u = unidade ? ` ${unidade}` : '';
  return `${fmt(l.volumeMl, 2)} mL · ${fmt(l.media, 0)} ± ${fmt(l.dp, 0)}${u} · ${fmt(l.min, 0)} a ${fmt(l.max, 0)}`;
}

/** Baixa a tabela de volumes da série ativa em CSV (só números e nomes de segmentos). */
export function exportarCsvSegmentos(): void {
  const pilha = estado.pilhaAtiva;
  const { volumetria } = volumetriaDa(pilha?.id);
  if (!pilha || !volumetria || volumetria.erro || volumetria.linhas.length === 0) return;
  const p = pilha.instances[0];
  const serie = [p?.modality, p?.seriesDescription].filter(Boolean).join(' · ');
  const csv = csvVolumetria(volumetria.linhas, volumetria.unidade, volumetria.ehPet, serie);
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'volumetria-segmentos.csv';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function avisoSegmentacao(texto: string): void {
  document.dispatchEvent(new CustomEvent(EVENTO_MENSAGEM_SEGMENTACAO, { detail: texto }));
}

/** Seletor de arquivo do sistema (Chrome, Edge e o programa instalado). */
interface JanelaComArquivos {
  showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>;
  showOpenFilePicker?: (o: unknown) => Promise<Array<{ getFile(): Promise<File> }>>;
}

const TIPOS_VSEG = [{ description: 'Segmentação (.vseg)', accept: { 'application/octet-stream': [EXTENSAO_SEGMENTACAO] } }];

const cancelado = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

/**
 * Salva a segmentação da série ativa num arquivo .vseg, na pasta que o usuário escolher.
 * Sem o seletor do sistema, o navegador baixa o arquivo (pasta de downloads).
 */
export async function salvarSegmentacaoAtiva(): Promise<void> {
  const pilha = estado.pilhaAtiva;
  const dados = dadosParaSalvar(pilha?.id ?? '');
  const p = pilha?.instances[0];
  if (!pilha || !dados) {
    avisoSegmentacao('Não há segmentação nesta série para salvar.');
    return;
  }
  if (!p?.seriesInstanceUid) {
    avisoSegmentacao('A série não tem identificador (Series Instance UID); não dá para salvar com segurança.');
    return;
  }
  const serie = [p.modality, p.seriesDescription].filter(Boolean).join(' · ');
  const bytes = await codificarSegmentacao(
    {
      serieUid: p.seriesInstanceUid,
      ...(p.frameOfReferenceUid ? { referencialUid: p.frameOfReferenceUid } : {}),
      serie,
      geometria: dados.geometria,
      segmentos: dados.segmentos,
      ativo: dados.ativo,
      salvoEm: new Date().toISOString(),
    },
    dados.rotulos,
  );
  const nome = nomeSugerido(serie);
  const janela = window as unknown as JanelaComArquivos;
  try {
    if (janela.showSaveFilePicker) {
      const arquivo = await janela.showSaveFilePicker({ suggestedName: nome, types: TIPOS_VSEG });
      const escrita = await arquivo.createWritable();
      await escrita.write(bytes as BlobPart);
      await escrita.close();
      avisoSegmentacao(`Segmentação salva em "${arquivo.name}".`);
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    avisoSegmentacao(`Segmentação baixada como "${nome}".`);
  } catch (e) {
    if (!cancelado(e)) avisoSegmentacao(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function escolherArquivoVseg(): Promise<File | null> {
  const janela = window as unknown as JanelaComArquivos;
  if (janela.showOpenFilePicker) {
    const [h] = await janela.showOpenFilePicker({ types: TIPOS_VSEG, multiple: false });
    return h ? h.getFile() : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = EXTENSAO_SEGMENTACAO;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

/** Reabre uma segmentação .vseg na série aberta correspondente. */
export async function abrirSegmentacaoDeArquivo(): Promise<void> {
  let msg: string;
  try {
    const arquivo = await escolherArquivoVseg();
    if (!arquivo) return;
    msg = await abrirSegmentacaoSalva(new Uint8Array(await arquivo.arrayBuffer()));
  } catch (e) {
    if (cancelado(e)) return;
    msg = e instanceof Error ? e.message : 'Não foi possível abrir a segmentação.';
  }
  avisoSegmentacao(msg);
  // Sem o painel visível (a série não tem segmentação), a mensagem precisa aparecer de outro jeito.
  if (document.getElementById('painel-segmentos')?.hidden) window.alert(msg);
}

function numeroOuNulo(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function rgbParaHex(c: [number, number, number]): string {
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function hexParaRgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function botao(texto: string, dica: string, acao: () => void, classe = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texto;
  b.title = dica;
  if (classe) b.className = classe;
  b.addEventListener('click', acao);
  return b;
}

export function iniciarPainelSegmentos(painel: HTMLElement): void {
  // --- parte fixa (montada uma vez) ---
  const titulo = document.createElement('h3');
  titulo.textContent = 'Segmentação';

  const linhaFerramentas = document.createElement('div');
  linhaFerramentas.className = 'seg-ferramentas';
  const botoesFerramenta = FERRAMENTAS_SEGMENTACAO.map((f) => {
    const b = botao(f.icone, `${f.rotulo}: ${f.dica}`, () => escolherFerramentaPrimaria(f.nome));
    b.dataset.ferramenta = f.nome;
    b.setAttribute('aria-label', f.rotulo);
    return b;
  });
  linhaFerramentas.append(...botoesFerramenta);

  const linhaRaio = document.createElement('label');
  linhaRaio.className = 'seg-linha';
  linhaRaio.title = 'Raio do pincel, da borracha e da esfera';
  const campoRaio = document.createElement('input');
  campoRaio.type = 'range';
  campoRaio.min = '1';
  campoRaio.max = '50';
  campoRaio.step = '1';
  campoRaio.value = String(raioMm);
  const valorRaio = document.createElement('span');
  valorRaio.className = 'seg-valor';
  valorRaio.textContent = `${raioMm} mm`;
  campoRaio.addEventListener('input', () => {
    raioMm = Number(campoRaio.value);
    valorRaio.textContent = `${raioMm} mm`;
    aplicarAjustesDoPincel();
  });
  linhaRaio.append('Raio ', campoRaio, valorRaio);

  const linhaFaixa = document.createElement('div');
  linhaFaixa.className = 'seg-linha';
  linhaFaixa.title =
    'Faixa do pincel com limiar e do crescer região, em HU (TC) ou SUV (PET). ' +
    'Vazia no crescer região: valor do clique ± 50 (TC/RM) ou a partir de 50% do clique (PET).';
  const campoMin = document.createElement('input');
  const campoMax = document.createElement('input');
  for (const [c, rotulo] of [
    [campoMin, 'Faixa: mínimo'],
    [campoMax, 'Faixa: máximo'],
  ] as const) {
    c.type = 'text';
    c.inputMode = 'decimal';
    c.size = 6;
    c.placeholder = 'auto';
    c.setAttribute('aria-label', rotulo);
    c.addEventListener('change', () => {
      definirFaixa(numeroOuNulo(campoMin.value), numeroOuNulo(campoMax.value));
      aplicarAjustesDoPincel();
    });
  }
  linhaFaixa.append('Faixa ', campoMin, ' a ', campoMax);

  const linhaEstilo = document.createElement('div');
  linhaEstilo.className = 'seg-linha';
  const opacidade = document.createElement('input');
  opacidade.type = 'range';
  opacidade.min = '0';
  opacidade.max = '100';
  opacidade.step = '5';
  opacidade.value = String(Math.round(estiloSegmentacao().opacidade * 100));
  opacidade.setAttribute('aria-label', 'Opacidade do preenchimento');
  opacidade.title = 'Opacidade do preenchimento';
  const contorno = document.createElement('input');
  contorno.type = 'checkbox';
  contorno.checked = estiloSegmentacao().soContorno;
  const rotContorno = document.createElement('label');
  rotContorno.append(contorno, ' só contorno');
  const aplicarEstiloDoPainel = (): void => definirEstilo(Number(opacidade.value) / 100, contorno.checked);
  opacidade.addEventListener('input', aplicarEstiloDoPainel);
  contorno.addEventListener('change', aplicarEstiloDoPainel);
  linhaEstilo.append('Opacidade ', opacidade, rotContorno);

  const lista = document.createElement('ul');
  lista.className = 'seg-lista';

  const rodape = document.createElement('div');
  rodape.className = 'seg-rodape';
  const botaoCsv = botao('Exportar CSV', 'Baixar a tabela de volumes e valores dos segmentos (CSV)', exportarCsvSegmentos);
  rodape.append(
    botao('+ Novo segmento', 'Criar outro segmento (passa a ser o ativo)', () => void novoSegmentoAtivo()),
    botao('Salvar…', 'Salvar a segmentação num arquivo .vseg, na pasta que você escolher', () => void salvarSegmentacaoAtiva()),
    botao('Abrir…', 'Reabrir uma segmentação salva (.vseg) na série aberta', () => void abrirSegmentacaoDeArquivo()),
    botaoCsv,
    botao('Apagar segmentação', 'Apagar todos os segmentos desta série', apagarSegmentacaoAtiva, 'link'),
  );

  const estadoCalculo = document.createElement('div');
  estadoCalculo.className = 'seg-calculo';

  const mensagem = document.createElement('div');
  mensagem.className = 'seg-mensagem';
  mensagem.setAttribute('role', 'status');

  painel.append(titulo, linhaFerramentas, linhaRaio, linhaFaixa, linhaEstilo, lista, estadoCalculo, rodape, mensagem);

  // --- parte que muda: lista de segmentos e destaque da ferramenta ---
  function atualizar(): void {
    const pilhaId = estado.pilhaAtiva?.id;
    const seg = segmentacaoDaPilha(pilhaId);
    painel.hidden = !seg;
    const atual = ferramentaPrimariaAtual();
    for (const b of botoesFerramenta) b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    if (!seg || !pilhaId) return;
    const f = faixaSegmentacao();
    if (document.activeElement !== campoMin) campoMin.value = f.min === null ? '' : String(f.min);
    if (document.activeElement !== campoMax) campoMax.value = f.max === null ? '' : String(f.max);

    const { volumetria, calculando } = volumetriaDa(pilhaId);
    estadoCalculo.textContent = calculando
      ? 'Calculando volumes…'
      : volumetria?.erro
        ? `Volumetria indisponível: ${volumetria.erro}`
        : '';
    botaoCsv.disabled = !volumetria || !!volumetria.erro || volumetria.linhas.every((l) => l.voxels === 0);
    // Não refaz a lista enquanto o usuário edita um nome (perderia o foco).
    if (lista.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;

    lista.replaceChildren(
      ...seg.segmentos.map((s) => {
        const li = document.createElement('li');
        li.className = s.indice === seg.ativo ? 'ativo' : '';
        li.title = 'Clique para pintar neste segmento';
        li.addEventListener('click', (e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
          definirSegmentoAtivo(pilhaId, s.indice);
        });
        const cor = document.createElement('input');
        cor.type = 'color';
        cor.value = rgbParaHex(s.cor);
        cor.title = 'Cor do segmento';
        cor.addEventListener('change', () => definirCorSegmento(pilhaId, s.indice, hexParaRgb(cor.value)));
        const nome = document.createElement('input');
        nome.type = 'text';
        nome.value = s.nome;
        nome.className = 'seg-nome';
        nome.setAttribute('aria-label', 'Nome do segmento');
        nome.addEventListener('focus', () => definirSegmentoAtivo(pilhaId, s.indice));
        nome.addEventListener('change', () => renomearSegmento(pilhaId, s.indice, nome.value));
        const ver = botao(s.visivel ? '👁' : '◌', s.visivel ? 'Esconder' : 'Mostrar', () =>
          definirVisivelSegmento(pilhaId, s.indice, !s.visivel),
        );
        ver.setAttribute('aria-pressed', String(s.visivel));
        const travar = botao(s.bloqueado ? '🔒' : '🔓', s.bloqueado ? 'Desbloquear' : 'Bloquear (não é pintado nem apagado)', () =>
          definirBloqueadoSegmento(pilhaId, s.indice, !s.bloqueado),
        );
        travar.setAttribute('aria-pressed', String(s.bloqueado));
        const apagar = botao('🗑', 'Apagar este segmento', () => {
          if (window.confirm(`Apagar "${s.nome}"?`)) apagarSegmento(pilhaId, s.indice);
        });
        const cabeca = document.createElement('div');
        cabeca.className = 'seg-cabeca';
        cabeca.append(cor, nome, ver, travar, apagar);
        const medidas = document.createElement('div');
        medidas.className = 'seg-medidas';
        medidas.textContent = textoVolumetria(
          volumetria?.linhas.find((l) => l.indice === s.indice),
          volumetria?.unidade ?? '',
          volumetria?.ehPet ?? false,
        );
        li.append(cabeca, medidas);
        return li;
      }),
    );
  }

  document.addEventListener(EVENTO_SEGMENTACAO, atualizar);
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, atualizar);
  document.addEventListener(EVENTO_BOTOES_MUDARAM, () => {
    aplicarAjustesDoPincel();
    atualizar();
  });
  document.addEventListener(EVENTO_MENSAGEM_SEGMENTACAO, (e) => {
    mensagem.textContent = String((e as CustomEvent<string>).detail ?? '');
  });
  atualizar();
}
