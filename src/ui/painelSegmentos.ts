/**
 * Painel "Segmentação" da série ativa (fase 9.1), na barra lateral: ferramentas, raio do pincel,
 * faixa de valores (pincel com limiar e crescer região), aparência e a lista de segmentos
 * (nome, cor, mostrar, bloquear, apagar, novo). Aparece quando a série ativa tem segmentação.
 */

import { ToolGroupManager, utilities as utilitariosTools } from '@cornerstonejs/tools';
import {
  definirModoSegmentacao,
  definirRaioPincelMm,
  emModoSegmentacao,
  EVENTO_MENSAGEM_SEGMENTACAO,
  EVENTO_MODO_SEGMENTACAO,
  EVENTO_RAIO_PINCEL,
  FERRAMENTAS_SEGMENTACAO,
  NOME_PINCEL,
  obterRaioPincelMm,
  RAIO_MAX_MM,
  RAIO_MIN_MM,
  VasoTool,
} from '../segmentation/ferramentas';
import {
  apagarSegmentacao,
  apagarSegmento,
  aplicarPresetVaso,
  autoLigarCortesPincel,
  autoSegmentarTotalSegmentator,
  corrigirDefeitosSegmentoAtivo,
  definirAutoLigarCortesPincel,
  definirBloqueadoSegmento,
  definirConfigVaso,
  definirCorSegmento,
  definirEstilo,
  definirModoExibicao3d,
  definirOpacidade3dSegmento,
  definirSegmentoAtivo,
  definirVisivel3dSegmento,
  definirVisivel3dTodos,
  definirVisivelSegmento,
  desfazerUltimoVaso,
  estiloSegmentacao,
  EVENTO_SEGMENTACAO,
  importarArquivosTotalSegmentator,
  modoExibicao3d,
  type ModoExibicao3d,
  novoSegmento,
  recalcularUltimoVaso,
  renomearSegmento,
  type Segmento,
  segmentacaoDaPilha,
  ultimaSementeVasoDa,
  vasoConfig,
  volumetriaDa,
} from '../segmentation/segmentacao';
import { PRESETS_VASO, type ModoVasoInteligente } from '../segmentation/vaso';
import { PRESETS_TOTALSEGMENTATOR, type PresetTotalSegId } from '../segmentation/totalSegmentator';
import { csvVolumetria, type LinhaVolumetria } from '../segmentation/volumetria';
import { codificarSegmentacao, EXTENSAO_SEGMENTACAO, nomeSugerido } from '../segmentation/arquivoSegmentacao';
import { dadosParaSalvar } from '../segmentation/segmentacao';
import { estado } from '../state/store';
import { escolherFerramentaPrimaria, EVENTO_BOTOES_MUDARAM, ferramentaPrimariaAtual, ID_GRUPO } from '../tools/grupo';
import {
  abrir3dParaPilhaAtiva,
  abrirSegmentacaoSalva,
  definirVistaAmbienteSegmentacao,
  emModoMpr,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  garantirSegmentacaoAtiva,
  ligarCortesProximosNoViewportAtivo,
  sairModoSegmentacaoUI,
} from '../viewer/viewport2d';
import {
  abrirConfigTotalSegmentator,
  consultarDiagnosticoTotalSeg,
  EVENTO_DIAGNOSTICO_TOTALSEG,
  obterDiagnosticoCacheTotalSeg,
  resumoCurtoTotalSeg,
  tauriTotalSegDisponivel,
} from './configTotalSegmentator';

/** Leva o raio atual do painel às instâncias do pincel/corretor no grupo de ferramentas. */
function aplicarAjustesDoPincel(): void {
  if (!ToolGroupManager.getToolGroup(ID_GRUPO)) return;
  utilitariosTools.segmentation.setBrushSizeForToolGroup(ID_GRUPO, obterRaioPincelMm());
}

/**
 * Alterna o ambiente dedicado de segmentação pelo botão principal da barra superior:
 * se já estiver segmentando, sai de forma limpa restaurando o exame; caso contrário,
 * abre o ambiente de segmentação com a sequência selecionada em MPR.
 */
export function alternarModoSegmentacaoBarra(ferramenta = NOME_PINCEL): void {
  if (emModoSegmentacao()) {
    sairModoSegmentacaoUI();
    return;
  }
  definirModoSegmentacao(true);
  escolherFerramentaPrimaria(ferramenta);
  void garantirSegmentacaoAtiva();
}

/** Apaga a segmentação da série ativa, com confirmação. */
export function apagarSegmentacaoAtiva(): void {
  const id = estado.pilhaAtiva?.id;
  if (!id || !segmentacaoDaPilha(id)) return;
  if (!window.confirm('Apagar a segmentação desta série (todos os segmentos)? Não dá para desfazer.')) return;
  apagarSegmentacao(id);
  sairModoSegmentacaoUI();
}

/** Novo segmento na série ativa (cria a segmentação se ainda não houver). */
export async function novoSegmentoAtivo(): Promise<void> {
  const id = estado.pilhaAtiva?.id;
  if (!id) return;
  definirModoSegmentacao(true);
  if (!segmentacaoDaPilha(id)) {
    await garantirSegmentacaoAtiva();
    return;
  }
  novoSegmento(id);
}

/**
 * Abre a reconstrução 3D diretamente a partir da segmentação, ativando a exibição de superfícies
 * (Vol+Seg) e garantindo que os segmentos da série apareçam no viewport 3D.
 */
export async function reconstruir3dDaSegmentacao(): Promise<void> {
  const pilha = estado.pilhaAtiva;
  if (!pilha) return;
  if (!segmentacaoDaPilha(pilha.id)) {
    await garantirSegmentacaoAtiva();
  }
  const seg = segmentacaoDaPilha(pilha.id);
  if (seg) {
    if (modoExibicao3d() === 'volume') {
      definirModoExibicao3d('ambos');
    }
    if (!seg.segmentos.some((s) => s.visivel3d)) {
      if (seg.segmentos.length <= 16) {
        definirVisivel3dTodos(pilha.id, true);
      } else {
        definirVisivel3dSegmento(pilha.id, seg.ativo, true);
      }
    }
  }
  await abrir3dParaPilhaAtiva();
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

/** Abre um ou mais arquivos NIfTI (.nii / .nii.gz) gerados pelo TotalSegmentator na série ativa. */
export function importarTotalSegmentatorDeArquivos(): void {
  const pilhaId = estado.pilhaAtiva?.id;
  if (!pilhaId) {
    avisoSegmentacao('Abra uma série antes de importar o TotalSegmentator.');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.nii,.gz,.nii.gz';
  input.addEventListener('change', () => {
    const selecionados = input.files ? Array.from(input.files) : [];
    if (selecionados.length === 0) return;
    void (async () => {
      avisoSegmentacao('Importando TotalSegmentator…');
      try {
        const arquivos = await Promise.all(
          selecionados.map(async (f) => ({
            nome: f.name,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        definirModoSegmentacao(true);
        await garantirSegmentacaoAtiva();
        const res = await importarArquivosTotalSegmentator(pilhaId, arquivos);
        if (res.importados === 0) {
          avisoSegmentacao(
            `Nenhum órgão importado${res.ignorados.length ? ` (${res.ignorados.join('; ')})` : '.'}`,
          );
          return;
        }
        const preview = res.nomes.slice(0, 6).join(', ') + (res.nomes.length > 6 ? ` (+${res.nomes.length - 6})` : '');
        const extra = res.ignorados.length ? ` Ignorados: ${res.ignorados.length}.` : '';
        const aviso3d = res.superficies3dOcultas
          ? ' Superfícies 3D iniciam ocultas para fluidez; ative "3D" nos órgãos desejados.'
          : '';
        avisoSegmentacao(
          `${res.importados} ${res.importados === 1 ? 'órgão importado' : 'órgãos importados'}: ${preview}.${extra}${aviso3d}`,
        );
      } catch (e) {
        avisoSegmentacao(e instanceof Error ? e.message : 'Falha ao importar arquivos do TotalSegmentator.');
      }
    })();
  });
  input.click();
}

interface TauriTempApi {
  core: {
    invoke<T>(
      comando: string,
      args?: Record<string, unknown> | Uint8Array | ArrayBuffer,
      opcoes?: { headers?: Record<string, string> },
    ): Promise<T>;
  };
}

async function resolverPastaSerieOuTemp(
  t: TauriTempApi,
): Promise<{ pastaSerie: string; sessaoTemp?: string }> {
  const pilha = estado.pilhaAtiva;
  if (!pilha || pilha.instances.length === 0) {
    throw new Error('Abra uma série antes de rodar a Auto-Segmentação.');
  }

  // 1. Se a série já está salva na pasta local de exames do PACS, usa direto sem copiar.
  const primeira = pilha.instances[0]!;
  if (primeira.studyInstanceUid && primeira.seriesInstanceUid) {
    try {
      const base =
        localStorage.getItem('visualizador.pastaExames') ||
        (await t.core.invoke<string>('exames_pasta_padrao'));
      const rel = `${primeira.studyInstanceUid}/${primeira.seriesInstanceUid}`;
      const arquivos = await t.core.invoke<string[]>('exames_listar', { base, relativo: rel });
      if (arquivos.length >= pilha.instances.length) {
        const sep = base.includes('\\') ? '\\' : '/';
        return { pastaSerie: `${base.replace(/[/\\]+$/, '')}${sep}${primeira.studyInstanceUid}${sep}${primeira.seriesInstanceUid}` };
      }
    } catch {
      /* segue para materialização em pasta temporária */
    }
  }

  // 2. Caso contrário, grava os arquivos `File` da série em uma pasta temporária para o CLI ler.
  const mapaArquivos = estado.resultado?.arquivos;
  if (!mapaArquivos) {
    throw new Error('Os arquivos DICOM desta série não estão disponíveis para exportação temporária.');
  }
  const sessaoTemp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pendentes: Array<{ file: File; nome: string }> = [];
  for (let i = 0; i < pilha.instances.length; i++) {
    const inst = pilha.instances[i]!;
    const file = mapaArquivos.get(inst.fileId);
    if (!file) continue;
    pendentes.push({ file, nome: `${String(i + 1).padStart(5, '0')}.dcm` });
  }
  let pastaSerie = '';
  let proximo = 0;
  const workers = Array.from({ length: Math.min(8, Math.max(1, pendentes.length)) }, async () => {
    while (proximo < pendentes.length) {
      const atual = pendentes[proximo++];
      if (!atual) break;
      const bytes = new Uint8Array(await atual.file.arrayBuffer());
      pastaSerie = await t.core.invoke<string>('exames_gravar_temp', bytes, {
        headers: {
          'x-ts-sessao': encodeURIComponent(sessaoTemp),
          'x-ts-nome': encodeURIComponent(atual.nome),
        },
      });
    }
  });
  await Promise.all(workers);
  if (!pastaSerie) {
    throw new Error('Nenhum arquivo DICOM encontrado para enviar ao TotalSegmentator.');
  }
  return { pastaSerie, sessaoTemp };
}

function formatarRaio(mm: number): string {
  return `${mm.toLocaleString('pt-BR', { minimumFractionDigits: mm % 1 === 0 ? 0 : 1, maximumFractionDigits: 1 })} mm`;
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
  // --- barra superior dedicada do Ambiente de Segmentação (#barra-ambiente-seg) ---
  const barraAmbiente = document.createElement('div');
  barraAmbiente.id = 'barra-ambiente-seg';
  barraAmbiente.hidden = true;

  const seloAmbiente = document.createElement('div');
  seloAmbiente.className = 'seg-amb-identificacao';
  const tagAmbiente = document.createElement('span');
  tagAmbiente.className = 'seg-amb-badge';
  tagAmbiente.textContent = '🎯 Ambiente de Segmentação';
  const infoSerieAmbiente = document.createElement('span');
  infoSerieAmbiente.className = 'seg-amb-serie';
  seloAmbiente.append(tagAmbiente, infoSerieAmbiente);

  const grupoVistasAmbiente = document.createElement('div');
  grupoVistasAmbiente.className = 'seg-amb-grupo';
  const rotuloVistaAmb = document.createElement('span');
  rotuloVistaAmb.className = 'seg-amb-rotulo';
  rotuloVistaAmb.textContent = 'Disposição:';
  const btnVistaMpr = botao(
    '⊞ MPR (3 planos)',
    'Ver a sequência selecionada nos 3 planos sincronizados (Axial, Coronal e Sagital)',
    () => void definirVistaAmbienteSegmentacao('mpr'),
    'btn-vista-amb',
  );
  const btnVista2d = botao(
    '▢ Corte 2D',
    'Ver a sequência selecionada em um único quadro 2D grande',
    () => void definirVistaAmbienteSegmentacao('2d'),
    'btn-vista-amb',
  );
  const btnVista3d = botao(
    '🧊 Reconstruir 3D',
    'Abrir a reconstrução 3D com as superfícies segmentadas ao lado do corte 2D',
    () => void reconstruir3dDaSegmentacao(),
    'btn-vista-amb destaque-3d',
  );
  grupoVistasAmbiente.append(rotuloVistaAmb, btnVistaMpr, btnVista2d, btnVista3d);

  const grupoNavAmbiente = document.createElement('div');
  grupoNavAmbiente.className = 'seg-amb-grupo';
  const rotuloNavAmb = document.createElement('span');
  rotuloNavAmb.className = 'seg-amb-rotulo';
  rotuloNavAmb.textContent = 'Navegar:';
  const botoesNavAmbiente: Array<{ nome: string; botao: HTMLButtonElement; apenasMpr?: boolean }> = [];
  for (const [nome, rotulo, dica, apenasMpr] of [
    ['Crosshairs', '✢ Eixos', 'Mover linhas de referência entre Axial, Coronal e Sagital', true],
    ['StackScroll', '↕ Cortes', 'Rolar cortes com o botão esquerdo (a roda do mouse sempre rola cortes)', false],
    ['WindowLevel', '◐ Janela', 'Ajustar brilho/contraste (W/L) com o botão esquerdo', false],
    ['Zoom', '🔍 Zoom', 'Aproximar/afastar com o botão esquerdo (ou botão direito)', false],
    ['Pan', '✥ Mover', 'Arrastar a imagem com o botão esquerdo (ou botão do meio)', false],
  ] as const) {
    const b = botao(rotulo, dica, () => escolherFerramentaPrimaria(nome), 'btn-nav-amb');
    botoesNavAmbiente.push({ nome, botao: b, apenasMpr });
    grupoNavAmbiente.append(b);
  }

  const btnSairAmbienteTopo = botao(
    '← Concluir e voltar ao exame (Esc)',
    'Sair do ambiente de segmentação e restaurar o exame (os segmentos criados permanecem salvos)',
    () => sairModoSegmentacaoUI(),
    'btn-sair-ambiente-topo',
  );

  barraAmbiente.append(btnSairAmbienteTopo, seloAmbiente, grupoVistasAmbiente, grupoNavAmbiente);
  const headerPrincipal = document.getElementById('barra-ferramentas');
  if (headerPrincipal) {
    headerPrincipal.append(barraAmbiente);
  }

  // --- cabeçalho do painel lateral dedicado ---
  const cabecalhoPainel = document.createElement('div');
  cabecalhoPainel.className = 'seg-topo-painel';
  const blocoTituloPainel = document.createElement('div');
  blocoTituloPainel.className = 'seg-topo-textos';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Segmentação da Sequência';
  const subtituloSeriePainel = document.createElement('small');
  subtituloSeriePainel.className = 'seg-subtitulo-serie';
  blocoTituloPainel.append(titulo, subtituloSeriePainel);
  cabecalhoPainel.append(blocoTituloPainel);

  const linhaFerramentas = document.createElement('div');
  linhaFerramentas.className = 'seg-ferramentas';
  const botoesFerramenta = FERRAMENTAS_SEGMENTACAO.map((f) => {
    const b = botao(
      `${f.icone} ${f.rotulo}`,
      `${f.rotulo}: ${f.dica}`,
      () => escolherFerramentaPrimaria(f.nome),
      'btn-ferramenta-seg',
    );
    b.dataset.ferramenta = f.nome;
    b.setAttribute('aria-label', f.rotulo);
    return b;
  });
  linhaFerramentas.append(...botoesFerramenta);

  const linhaRaio = document.createElement('div');
  linhaRaio.className = 'seg-linha';
  const rotuloRaio = document.createElement('label');
  rotuloRaio.className = 'seg-sub-linha';
  rotuloRaio.title = 'Raio do pincel e do corretor (atalhos: teclas [ e ] ou Alt + roda do mouse)';
  const campoRaio = document.createElement('input');
  campoRaio.type = 'range';
  campoRaio.min = String(RAIO_MIN_MM);
  campoRaio.max = String(RAIO_MAX_MM);
  campoRaio.step = '0.5';
  campoRaio.value = String(obterRaioPincelMm());
  const valorRaio = document.createElement('span');
  valorRaio.className = 'seg-valor';
  valorRaio.textContent = formatarRaio(obterRaioPincelMm());
  campoRaio.addEventListener('input', () => {
    const novo = definirRaioPincelMm(Number(campoRaio.value));
    valorRaio.textContent = formatarRaio(novo);
    aplicarAjustesDoPincel();
  });
  rotuloRaio.append('Raio ', campoRaio, valorRaio);

  const botaoLimparDefeitos = botao(
    '✨ Limpar defeitos',
    'Fecha automaticamente buracos internos nos cortes e remove respingos/ilhotas soltas do segmento ativo',
    () => {
      const pilhaId = estado.pilhaAtiva?.id;
      if (!pilhaId) return;
      const res = corrigirDefeitosSegmentoAtivo(pilhaId);
      if (typeof res === 'string') {
        avisoSegmentacao(res);
        return;
      }
      if (res.buracosPreenchidos === 0 && res.ilhasRemovidas === 0) {
        avisoSegmentacao('Nenhum buraco interno ou respingo isolado encontrado neste segmento.');
        return;
      }
      const partes: string[] = [];
      if (res.buracosPreenchidos > 0) {
        partes.push(`${res.buracosPreenchidos.toLocaleString('pt-BR')} voxels de falhas fechados`);
      }
      if (res.ilhasRemovidas > 0) {
        partes.push(`${res.ilhasRemovidas.toLocaleString('pt-BR')} voxels de ilhas soltas removidos`);
      }
      avisoSegmentacao(`Defeitos corrigidos: ${partes.join(' · ')}.`);
    },
  );
  linhaRaio.append(rotuloRaio, botaoLimparDefeitos);

  const linhaVaso = document.createElement('div');
  linhaVaso.className = 'seg-linha seg-caixa-vaso';
  linhaVaso.title =
    'Clique num vaso contrastado: o modo Auto identifica fase arterial ou portal/venosa e evita vazar para fígado ou osso cortical.';

  let timerRecalculoVaso: ReturnType<typeof setTimeout> | undefined;
  const agendarRecalculoVaso = (cor?: [number, number, number]): void => {
    if (timerRecalculoVaso) clearTimeout(timerRecalculoVaso);
    timerRecalculoVaso = setTimeout(() => {
      timerRecalculoVaso = undefined;
      const pilhaId = estado.pilhaAtiva?.id;
      if (!pilhaId) return;
      void recalcularUltimoVaso(pilhaId, cor).then((texto) => {
        if (texto) avisoSegmentacao(texto);
      });
    }, 60);
  };

  const botoesPresetVaso: Array<{ modo: ModoVasoInteligente; botao: HTMLButtonElement }> = [];
  for (const [m, rotulo, dica, cor] of [
    ['auto', 'Auto', 'Detecta automaticamente vaso arterial vs portal/venoso pelo ponto clicado', undefined],
    ['arterial', 'Arterial', 'Forçar perfil arterial (aorta e ramos hiperdensos)', PRESETS_VASO.arterial.cor],
    ['venoso', 'Venoso / Porta', 'Forçar perfil venoso/portal (protege contra vazamento no fígado)', PRESETS_VASO.venoso.cor],
  ] as const) {
    const b = botao(rotulo, dica, () => {
      aplicarPresetVaso(m);
      agendarRecalculoVaso(cor);
    });
    botoesPresetVaso.push({ modo: m, botao: b });
  }

  const sliderAlcanceVaso = document.createElement('input');
  sliderAlcanceVaso.type = 'range';
  sliderAlcanceVaso.min = '50';
  sliderAlcanceVaso.max = '160';
  sliderAlcanceVaso.step = '5';
  sliderAlcanceVaso.value = String(vasoConfig().alcancePct);
  sliderAlcanceVaso.title = 'Alcance nos ramos vasculares: aumente para pegar ramos finos ou reduza se vazar';
  const valorAlcanceVaso = document.createElement('span');
  valorAlcanceVaso.className = 'seg-valor';
  valorAlcanceVaso.textContent = `${vasoConfig().alcancePct}%`;
  sliderAlcanceVaso.addEventListener('input', () => {
    const pct = Number(sliderAlcanceVaso.value);
    valorAlcanceVaso.textContent = `${pct}%`;
    definirConfigVaso({ alcancePct: pct });
    agendarRecalculoVaso();
  });

  const checkNovoVaso = document.createElement('input');
  checkNovoVaso.type = 'checkbox';
  checkNovoVaso.checked = vasoConfig().novoSegmento;
  checkNovoVaso.addEventListener('change', () => definirConfigVaso({ novoSegmento: checkNovoVaso.checked }));
  const rotNovoVaso = document.createElement('label');
  rotNovoVaso.append(checkNovoVaso, ' novo segmento');

  const botaoDesfazerVaso = botao(
    '↶ Desfazer vaso',
    'Desfazer o último clique da ferramenta Vasos',
    () => {
      const pilhaId = estado.pilhaAtiva?.id;
      if (pilhaId && desfazerUltimoVaso(pilhaId)) {
        avisoSegmentacao('Último vaso desfeito.');
      }
    },
  );

  const linhaModosVaso = document.createElement('div');
  linhaModosVaso.className = 'seg-sub-linha';
  linhaModosVaso.append('Fase: ', ...botoesPresetVaso.map((x) => x.botao), botaoDesfazerVaso);

  const linhaAlcanceVaso = document.createElement('div');
  linhaAlcanceVaso.className = 'seg-sub-linha';
  linhaAlcanceVaso.append('Alcance ', sliderAlcanceVaso, valorAlcanceVaso, rotNovoVaso);

  linhaVaso.append(linhaModosVaso, linhaAlcanceVaso);

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
  const checkAutoLigar = document.createElement('input');
  checkAutoLigar.type = 'checkbox';
  checkAutoLigar.checked = autoLigarCortesPincel();
  checkAutoLigar.addEventListener('change', () => definirAutoLigarCortesPincel(checkAutoLigar.checked));
  const rotAutoLigar = document.createElement('label');
  rotAutoLigar.title = 'Ao soltar o pincel, preencher automaticamente os cortes vazios entre cortes pintados (até 20 mm)';
  rotAutoLigar.append(checkAutoLigar, ' auto-ligar cortes');
  const botaoLigarCorte = botao(
    'Ligar corte',
    'Interpolar agora o corte visível com os cortes vizinhos pintados neste segmento (até 20 mm)',
    () => {
      const n = ligarCortesProximosNoViewportAtivo();
      avisoSegmentacao(
        n > 0
          ? `${n} ${n === 1 ? 'corte vazio preenchido' : 'cortes vazios preenchidos'} entre os cortes pintados.`
          : 'Nenhum corte vizinho em até 20 mm com intervalo vazio para ligar.',
      );
    },
  );
  linhaEstilo.append('Opacidade ', opacidade, rotContorno, rotAutoLigar, botaoLigarCorte);

  const linha3d = document.createElement('div');
  linha3d.className = 'seg-linha seg-modo-3d';
  linha3d.title = 'O que exibir no viewport 3D quando a série tiver segmentos';
  const botoesModo3d: Array<{ modo: ModoExibicao3d; botao: HTMLButtonElement }> = [];
  for (const [m, rotulo, dica] of [
    ['ambos', 'Vol+Seg', 'Mostrar Volume Rendering + superfícies 3D sobrepostas'],
    ['superficies', 'Só superfícies', 'Ocultar Volume Rendering e ver apenas as superfícies 3D'],
    ['volume', 'Só volume', 'Mostrar apenas o Volume Rendering sem as superfícies'],
  ] as const) {
    const b = botao(rotulo, dica, () => definirModoExibicao3d(m));
    botoesModo3d.push({ modo: m, botao: b });
  }
  const mostrarTodasEstruturasNo3d = (): void => {
    const pilhaId = estado.pilhaAtiva?.id;
    if (!pilhaId) return;
    if (modoExibicao3d() === 'volume') {
      definirModoExibicao3d('ambos');
    }
    definirVisivel3dTodos(pilhaId, true);
    void abrir3dParaPilhaAtiva();
  };

  const botaoReconstruir3d = botao(
    '🧊 Reconstruir 3D',
    'Abrir a janela de reconstrução 3D ao lado da imagem 2D com as superfícies segmentadas visíveis',
    () => void reconstruir3dDaSegmentacao(),
    'primario btn-reconstruir-3d-seg',
  );
  const botaoMostrarTodos3d = botao(
    'Mostrar todas 3D',
    'Ativar a superfície 3D de todas as estruturas desta série e abrir o 3D',
    mostrarTodasEstruturasNo3d,
  );
  const botaoOcultarTodos3d = botao('Ocultar 3D', 'Desativar a superfície 3D de todos os segmentos desta série', () => {
    const pilhaId = estado.pilhaAtiva?.id;
    if (pilhaId) definirVisivel3dTodos(pilhaId, false);
  });
  linha3d.append(botaoReconstruir3d, ...botoesModo3d.map((x) => x.botao), botaoMostrarTodos3d, botaoOcultarTodos3d);

  const lista = document.createElement('ul');
  lista.className = 'seg-lista';

  const rodape = document.createElement('div');
  rodape.className = 'seg-rodape';
  const botaoCsv = botao('Exportar CSV', 'Baixar a tabela de volumes e valores dos segmentos (CSV)', exportarCsvSegmentos);
  const seletorTotalSeg = document.createElement('select');
  seletorTotalSeg.setAttribute('aria-label', 'Tarefa ou preset do TotalSegmentator');
  seletorTotalSeg.title = 'Escolher tarefa ou grupo de órgãos para Auto-Segmentação (IA)';
  {
    const grupos = new Map<string, typeof PRESETS_TOTALSEGMENTATOR>();
    for (const p of PRESETS_TOTALSEGMENTATOR) {
      const arr = grupos.get(p.grupo) ?? [];
      arr.push(p);
      grupos.set(p.grupo, arr);
    }
    for (const [nomeGrupo, itens] of grupos) {
      const og = document.createElement('optgroup');
      og.label = nomeGrupo;
      for (const p of itens) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.rotulo;
        og.append(opt);
      }
      seletorTotalSeg.append(og);
    }
  }

  let rodandoAutoSeg = false;
  const statusTotalSeg = document.createElement('span');
  statusTotalSeg.className = 'seg-ts-status';

  const botaoConfigTotalSeg = botao(
    'Instalar / Configurar TotalSegmentator',
    'Instalar ambiente isolado (GPU/CPU) ou configurar caminho manual do TotalSegmentator',
    () => abrirConfigTotalSegmentator(),
  );
  botaoConfigTotalSeg.className = 'seg-ts-config';

  const atualizarControlesTotalSeg = (): void => {
    if (!tauriTotalSegDisponivel()) {
      botaoConfigTotalSeg.hidden = true;
      statusTotalSeg.hidden = true;
      seletorTotalSeg.hidden = false;
      botaoAutoSeg.hidden = false;
      return;
    }
    const diag = obterDiagnosticoCacheTotalSeg();
    const resumo = resumoCurtoTotalSeg(diag);
    statusTotalSeg.hidden = false;
    statusTotalSeg.textContent = resumo.texto;
    statusTotalSeg.className = `seg-ts-status ${resumo.classe}`;

    const pronto = Boolean(diag?.instalado);
    seletorTotalSeg.hidden = !pronto;
    botaoAutoSeg.hidden = !pronto;
    botaoConfigTotalSeg.hidden = false;
    if (pronto) {
      botaoConfigTotalSeg.textContent = '⚙ Configurar IA';
      botaoConfigTotalSeg.classList.remove('primario');
    } else {
      botaoConfigTotalSeg.textContent = 'Instalar / Configurar TotalSegmentator';
      botaoConfigTotalSeg.classList.add('primario');
    }
    botaoAutoSeg.disabled = rodandoAutoSeg;
    seletorTotalSeg.disabled = rodandoAutoSeg;
  };

  const botaoAutoSeg = botao(
    'Auto-Segmentar (IA)',
    'Executar o TotalSegmentator localmente na série aberta (Tauri)',
    () => {
      const pilhaId = estado.pilhaAtiva?.id;
      if (!pilhaId) {
        avisoSegmentacao('Abra uma série antes de rodar a Auto-Segmentação.');
        return;
      }
      const t = (globalThis as unknown as { __TAURI__?: TauriTempApi }).__TAURI__;
      if (!t?.core?.invoke) {
        avisoSegmentacao('Auto-Segmentar (IA) requer o aplicativo instalado (Tauri). No navegador, use Importar NIfTI.');
        return;
      }
      rodandoAutoSeg = true;
      atualizarControlesTotalSeg();
      avisoSegmentacao('Verificando TotalSegmentator…');
      void (async () => {
        let sessaoTemp: string | undefined;
        try {
          const diag = obterDiagnosticoCacheTotalSeg() ?? (await consultarDiagnosticoTotalSeg());
          if (!diag?.instalado) {
            avisoSegmentacao('TotalSegmentator ainda não está configurado. Use o assistente para instalar ou apontar o executável.');
            abrirConfigTotalSegmentator();
            return;
          }
          avisoSegmentacao('Rodando TotalSegmentator…');
          const prep = await resolverPastaSerieOuTemp(t);
          sessaoTemp = prep.sessaoTemp;
          const res = await autoSegmentarTotalSegmentator(
            pilhaId,
            prep.pastaSerie,
            seletorTotalSeg.value as PresetTotalSegId,
          );
          if (res.importados === 0) {
            avisoSegmentacao(
              `Nenhuma estrutura segmentada${res.ignorados.length ? ` (${res.ignorados.join('; ')})` : '.'}`,
            );
            return;
          }
          const preview =
            res.nomes.slice(0, 6).join(', ') + (res.nomes.length > 6 ? ` (+${res.nomes.length - 6})` : '');
          const aviso3d = res.superficies3dOcultas
            ? ' Superfícies 3D iniciam ocultas para fluidez; ative "3D" nos órgãos desejados.'
            : '';
          avisoSegmentacao(
            `TotalSegmentator concluiu (${res.importados} ${res.importados === 1 ? 'órgão' : 'órgãos'}): ${preview}.${aviso3d}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Falha ao executar TotalSegmentator.';
          avisoSegmentacao(msg);
          if (msg.toLowerCase().includes('não configurado') || msg.toLowerCase().includes('não encontrado')) {
            void consultarDiagnosticoTotalSeg(true);
          }
        } finally {
          if (sessaoTemp) {
            void t.core.invoke('exames_limpar_temp', { sessao: sessaoTemp }).catch(() => undefined);
          }
          rodandoAutoSeg = false;
          atualizarControlesTotalSeg();
        }
      })();
    },
  );

  const botaoImportarNifti = botao(
    '📥 Importar NIfTI',
    'Importar arquivo multilabel ou vários arquivos individuais (.nii / .nii.gz) gerados pelo TotalSegmentator',
    importarTotalSegmentatorDeArquivos,
  );

  const secaoIa = document.createElement('section');
  secaoIa.className = 'seg-secao-card seg-secao-ia';
  const topoSecaoIa = document.createElement('div');
  topoSecaoIa.className = 'seg-secao-topo';
  const tituloIa = document.createElement('strong');
  tituloIa.textContent = '🤖 Auto-Segmentação (IA)';
  topoSecaoIa.append(tituloIa, statusTotalSeg);
  const botoesAcaoIa = document.createElement('div');
  botoesAcaoIa.className = 'seg-acoes-ia';
  botoesAcaoIa.append(botaoAutoSeg, botaoConfigTotalSeg, botaoImportarNifti);
  secaoIa.append(topoSecaoIa, seletorTotalSeg, botoesAcaoIa);

  const secaoPintura = document.createElement('section');
  secaoPintura.className = 'seg-secao-card';
  const topoSecaoPintura = document.createElement('div');
  topoSecaoPintura.className = 'seg-secao-topo';
  const tituloPintura = document.createElement('strong');
  tituloPintura.textContent = '🖌 Pintura e Refinamento Manual';
  topoSecaoPintura.append(tituloPintura);
  secaoPintura.append(topoSecaoPintura, linhaFerramentas, linhaRaio, linhaVaso, linhaEstilo);

  const secao3d = document.createElement('section');
  secao3d.className = 'seg-secao-card';
  const topoSecao3d = document.createElement('div');
  topoSecao3d.className = 'seg-secao-topo';
  const titulo3d = document.createElement('strong');
  titulo3d.textContent = '🧊 Superfícies 3D';
  topoSecao3d.append(titulo3d);
  secao3d.append(topoSecao3d, linha3d);

  const secaoLista = document.createElement('section');
  secaoLista.className = 'seg-secao-card seg-secao-lista';
  const topoSecaoLista = document.createElement('div');
  topoSecaoLista.className = 'seg-secao-topo';
  const tituloLista = document.createElement('strong');
  tituloLista.textContent = '📋 Estruturas e Volumetria';
  const acoesTopoLista = document.createElement('div');
  acoesTopoLista.className = 'seg-acoes-topo-lista';
  const botaoTodas3dLista = botao(
    '🧊 Todas no 3D',
    'Colocar todas as estruturas no 3D de uma vez (ou ocultar todas se já estiverem todas no 3D)',
    () => {
      const pilhaId = estado.pilhaAtiva?.id;
      const seg = segmentacaoDaPilha(pilhaId);
      if (!pilhaId || !seg || seg.segmentos.length === 0) return;
      const todasVisiveis = seg.segmentos.every((s) => s.visivel3d);
      if (todasVisiveis) {
        definirVisivel3dTodos(pilhaId, false);
      } else {
        mostrarTodasEstruturasNo3d();
      }
    },
    'btn-todas-3d-lista',
  );
  const botaoNovoSeg = botao(
    '+ Novo segmento',
    'Criar outro segmento manual (passa a ser o ativo)',
    () => void novoSegmentoAtivo(),
    'btn-novo-seg-topo',
  );
  acoesTopoLista.append(botaoTodas3dLista, botaoNovoSeg);
  topoSecaoLista.append(tituloLista, acoesTopoLista);

  const campoFiltro = document.createElement('input');
  campoFiltro.type = 'search';
  campoFiltro.className = 'seg-filtro-orgaos';
  campoFiltro.placeholder = '🔍 Filtrar estrutura (ex.: fígado, aorta, rim)…';
  campoFiltro.hidden = true;

  const estadoCalculo = document.createElement('div');
  estadoCalculo.className = 'seg-calculo';

  secaoLista.append(topoSecaoLista, campoFiltro, estadoCalculo, lista);

  rodape.append(
    botao('💾 Salvar (.vseg)', 'Salvar a segmentação num arquivo .vseg, na pasta que você escolher', () => void salvarSegmentacaoAtiva()),
    botao('📂 Abrir (.vseg)', 'Reabrir uma segmentação salva (.vseg) na série aberta', () => void abrirSegmentacaoDeArquivo()),
    botaoCsv,
    botao('Apagar segmentação', 'Apagar todos os segmentos desta série', apagarSegmentacaoAtiva, 'link'),
  );

  const mensagem = document.createElement('div');
  mensagem.className = 'seg-mensagem';
  mensagem.setAttribute('role', 'status');

  painel.append(cabecalhoPainel, secaoIa, mensagem, secaoPintura, secao3d, secaoLista, rodape);

  interface LinhaDomSegmento {
    li: HTMLLIElement;
    cor: HTMLInputElement;
    nome: HTMLInputElement;
    ver: HTMLButtonElement;
    travar: HTMLButtonElement;
    apagar: HTMLButtonElement;
    ver3d: HTMLButtonElement;
    opacidade3d: HTMLInputElement;
    valorOpac3d: HTMLSpanElement;
    medidas: HTMLDivElement;
    estadoAtual: Segmento;
  }

  let pilhaListaAtual: string | null = null;
  const linhasDom = new Map<number, LinhaDomSegmento>();

  function aplicarFiltroNaLista(): void {
    const termo = campoFiltro.value.trim().toLowerCase();
    for (const reg of linhasDom.values()) {
      reg.li.hidden = termo.length > 0 && !reg.estadoAtual.nome.toLowerCase().includes(termo);
    }
  }
  campoFiltro.addEventListener('input', aplicarFiltroNaLista);

  function criarLinhaDom(pilhaId: string, s: Segmento): LinhaDomSegmento {
    const reg: LinhaDomSegmento = {
      li: document.createElement('li'),
      cor: document.createElement('input'),
      nome: document.createElement('input'),
      ver: botao('', '', () => definirVisivelSegmento(pilhaId, reg.estadoAtual.indice, !reg.estadoAtual.visivel)),
      travar: botao('', '', () => definirBloqueadoSegmento(pilhaId, reg.estadoAtual.indice, !reg.estadoAtual.bloqueado)),
      apagar: botao('🗑', 'Apagar este segmento', () => {
        if (window.confirm(`Apagar "${reg.estadoAtual.nome}"?`)) apagarSegmento(pilhaId, reg.estadoAtual.indice);
      }),
      ver3d: botao('3D', 'Mostrar ou ocultar a superfície 3D deste segmento', () =>
        definirVisivel3dSegmento(pilhaId, reg.estadoAtual.indice, !reg.estadoAtual.visivel3d),
      ),
      opacidade3d: document.createElement('input'),
      valorOpac3d: document.createElement('span'),
      medidas: document.createElement('div'),
      estadoAtual: s,
    };

    reg.li.title = 'Clique para pintar neste segmento';
    reg.li.addEventListener('click', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
      definirSegmentoAtivo(pilhaId, reg.estadoAtual.indice);
    });

    reg.cor.type = 'color';
    reg.cor.title = 'Cor do segmento';
    reg.cor.addEventListener('change', () => definirCorSegmento(pilhaId, reg.estadoAtual.indice, hexParaRgb(reg.cor.value)));

    reg.nome.type = 'text';
    reg.nome.className = 'seg-nome';
    reg.nome.setAttribute('aria-label', 'Nome do segmento');
    reg.nome.addEventListener('focus', () => definirSegmentoAtivo(pilhaId, reg.estadoAtual.indice));
    reg.nome.addEventListener('change', () => renomearSegmento(pilhaId, reg.estadoAtual.indice, reg.nome.value));

    const cabeca = document.createElement('div');
    cabeca.className = 'seg-cabeca';
    cabeca.append(reg.cor, reg.nome, reg.ver, reg.travar, reg.apagar);

    reg.ver3d.className = 'seg-btn-3d';
    reg.opacidade3d.type = 'range';
    reg.opacidade3d.min = '10';
    reg.opacidade3d.max = '100';
    reg.opacidade3d.step = '5';
    reg.opacidade3d.title = 'Opacidade da superfície 3D deste segmento';
    reg.valorOpac3d.className = 'seg-valor-3d';
    reg.opacidade3d.addEventListener('input', () => {
      reg.valorOpac3d.textContent = `${reg.opacidade3d.value}%`;
      definirOpacidade3dSegmento(pilhaId, reg.estadoAtual.indice, Number(reg.opacidade3d.value) / 100);
    });
    const controle3d = document.createElement('div');
    controle3d.className = 'seg-3d';
    controle3d.append(reg.ver3d, 'Opac.', reg.opacidade3d, reg.valorOpac3d);

    reg.medidas.className = 'seg-medidas';
    reg.li.append(cabeca, controle3d, reg.medidas);
    return reg;
  }

  function atualizarLinhaDom(
    reg: LinhaDomSegmento,
    s: Segmento,
    ativoIndice: number,
    linhaVol: LinhaVolumetria | undefined,
    unidade: string,
    ehPet: boolean,
  ): void {
    reg.estadoAtual = s;
    reg.li.classList.toggle('ativo', s.indice === ativoIndice);

    const corHex = rgbParaHex(s.cor);
    if (document.activeElement !== reg.cor && reg.cor.value !== corHex) reg.cor.value = corHex;
    if (document.activeElement !== reg.nome && reg.nome.value !== s.nome) reg.nome.value = s.nome;

    reg.ver.textContent = s.visivel ? '👁' : '◌';
    reg.ver.title = s.visivel ? 'Esconder' : 'Mostrar';
    reg.ver.setAttribute('aria-pressed', String(s.visivel));

    reg.travar.textContent = s.bloqueado ? '🔒' : '🔓';
    reg.travar.title = s.bloqueado ? 'Desbloquear' : 'Bloquear (não é pintado nem apagado)';
    reg.travar.setAttribute('aria-pressed', String(s.bloqueado));

    reg.ver3d.setAttribute('aria-pressed', String(s.visivel3d));
    const pct = Math.round((s.opacidade3d ?? 0.9) * 100);
    reg.opacidade3d.disabled = !s.visivel3d || !s.visivel;
    reg.opacidade3d.setAttribute('aria-label', `Opacidade 3D de ${s.nome}`);
    if (document.activeElement !== reg.opacidade3d) {
      reg.opacidade3d.value = String(pct);
      reg.valorOpac3d.textContent = `${pct}%`;
    }

    const txtMed = textoVolumetria(linhaVol, unidade, ehPet);
    if (reg.medidas.textContent !== txtMed) reg.medidas.textContent = txtMed;
  }

  let diagnosticoIniciado = false;
  let ultimoEstadoVp: EstadoViewports | null = null;

  // --- parte que muda: lista de segmentos, barra do ambiente e destaque da ferramenta ---
  function atualizar(): void {
    const pilha = estado.pilhaAtiva;
    const pilhaId = pilha?.id;
    const seg = segmentacaoDaPilha(pilhaId);
    const visivel = emModoSegmentacao() && Boolean(pilhaId);
    painel.hidden = !visivel;
    barraAmbiente.hidden = !visivel;

    if (pilha) {
      const p0 = pilha.instances[0];
      const resumoSerie = [
        p0?.modality,
        p0?.seriesDescription || (p0?.seriesNumber !== undefined ? `Série ${p0.seriesNumber}` : undefined),
        `${pilha.instances.length} ${pilha.instances.length === 1 ? 'corte' : 'cortes'}`,
      ]
        .filter(Boolean)
        .join(' · ');
      infoSerieAmbiente.textContent = resumoSerie;
      subtituloSeriePainel.textContent = resumoSerie;
    } else {
      infoSerieAmbiente.textContent = '';
      subtituloSeriePainel.textContent = '';
    }

    const emMpr = ultimoEstadoVp ? ultimoEstadoVp.mprAtivo : emModoMpr();
    const em3d = Boolean(ultimoEstadoVp?.visao3dVisivel);
    btnVistaMpr.setAttribute('aria-pressed', String(emMpr && !em3d));
    btnVista2d.setAttribute('aria-pressed', String(!emMpr && !em3d));
    btnVista3d.setAttribute('aria-pressed', String(em3d));

    if (visivel && tauriTotalSegDisponivel() && !diagnosticoIniciado) {
      diagnosticoIniciado = true;
      void consultarDiagnosticoTotalSeg();
    }
    atualizarControlesTotalSeg();
    const atual = ferramentaPrimariaAtual();
    for (const b of botoesFerramenta) b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    for (const item of botoesNavAmbiente) {
      item.botao.hidden = Boolean(item.apenasMpr && !emMpr);
      item.botao.setAttribute('aria-pressed', String(item.nome === atual));
    }
    linhaVaso.hidden = atual !== VasoTool.toolName;
    linhaRaio.hidden = atual === VasoTool.toolName;
    const rAtual = obterRaioPincelMm();
    if (document.activeElement !== campoRaio) campoRaio.value = String(rAtual);
    valorRaio.textContent = formatarRaio(rAtual);
    checkAutoLigar.checked = autoLigarCortesPincel();
    const modoAtual3d = modoExibicao3d();
    for (const item of botoesModo3d) item.botao.setAttribute('aria-pressed', String(item.modo === modoAtual3d));
    const cv = vasoConfig();
    if (document.activeElement !== sliderAlcanceVaso) sliderAlcanceVaso.value = String(cv.alcancePct);
    valorAlcanceVaso.textContent = `${cv.alcancePct}%`;
    for (const item of botoesPresetVaso) item.botao.setAttribute('aria-pressed', String(item.modo === cv.modo));
    checkNovoVaso.checked = cv.novoSegmento;
    botaoDesfazerVaso.disabled = !ultimaSementeVasoDa(pilhaId);

    if (!seg || !pilhaId) {
      pilhaListaAtual = null;
      linhasDom.clear();
      lista.replaceChildren();
      campoFiltro.hidden = true;
      tituloLista.textContent = '📋 Estruturas e Volumetria';
      botaoMostrarTodos3d.disabled = true;
      botaoOcultarTodos3d.disabled = true;
      botaoTodas3dLista.disabled = true;
      botaoTodas3dLista.setAttribute('aria-pressed', 'false');
      botaoTodas3dLista.textContent = '🧊 Todas no 3D';
      botaoCsv.disabled = true;
      estadoCalculo.textContent = visivel ? 'Preparando máscara da série…' : '';
      return;
    }
    tituloLista.textContent = `📋 Estruturas (${seg.segmentos.length})`;
    campoFiltro.hidden = seg.segmentos.length <= 5;
    const algumNo3d = seg.segmentos.some((s) => s.visivel3d);
    const todasNo3d = seg.segmentos.length > 0 && seg.segmentos.every((s) => s.visivel3d);
    botaoMostrarTodos3d.disabled = todasNo3d || seg.segmentos.length === 0;
    botaoOcultarTodos3d.disabled = !algumNo3d;
    botaoTodas3dLista.disabled = seg.segmentos.length === 0;
    botaoTodas3dLista.setAttribute('aria-pressed', String(todasNo3d));
    botaoTodas3dLista.textContent = todasNo3d ? '🧊 Ocultar todas 3D' : '🧊 Todas no 3D';
    botaoTodas3dLista.title = todasNo3d
      ? 'Ocultar a superfície 3D de todas as estruturas desta série'
      : 'Colocar todas as estruturas no 3D de uma vez';

    const { volumetria, calculando } = volumetriaDa(pilhaId);
    estadoCalculo.textContent = calculando
      ? 'Calculando volumes…'
      : volumetria?.erro
        ? `Volumetria indisponível: ${volumetria.erro}`
        : '';
    botaoCsv.disabled = !volumetria || !!volumetria.erro || volumetria.linhas.every((l) => l.voxels === 0);

    if (pilhaListaAtual !== pilhaId) {
      linhasDom.clear();
      lista.replaceChildren();
      pilhaListaAtual = pilhaId;
    }

    const linhasPorIdx = new Map<number, LinhaVolumetria>();
    if (volumetria?.linhas) {
      for (const l of volumetria.linhas) linhasPorIdx.set(l.indice, l);
    }

    const indicesAtuais = new Set(seg.segmentos.map((s) => s.indice));
    for (const [indice, reg] of linhasDom) {
      if (!indicesAtuais.has(indice)) {
        reg.li.remove();
        linhasDom.delete(indice);
      }
    }

    const unidade = volumetria?.unidade ?? '';
    const ehPet = volumetria?.ehPet ?? false;
    for (let i = 0; i < seg.segmentos.length; i++) {
      const s = seg.segmentos[i]!;
      let reg = linhasDom.get(s.indice);
      if (!reg) {
        reg = criarLinhaDom(pilhaId, s);
        linhasDom.set(s.indice, reg);
      }
      atualizarLinhaDom(reg, s, seg.ativo, linhasPorIdx.get(s.indice), unidade, ehPet);
      if (lista.children[i] !== reg.li) {
        lista.insertBefore(reg.li, lista.children[i] ?? null);
      }
    }
    aplicarFiltroNaLista();
  }

  document.addEventListener(EVENTO_SEGMENTACAO, atualizar);
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => {
    ultimoEstadoVp = (ev as CustomEvent<EstadoViewports>).detail ?? null;
    atualizar();
  });
  document.addEventListener(EVENTO_MODO_SEGMENTACAO, atualizar);
  document.addEventListener(EVENTO_RAIO_PINCEL, () => {
    aplicarAjustesDoPincel();
    atualizar();
  });
  document.addEventListener(EVENTO_BOTOES_MUDARAM, () => {
    aplicarAjustesDoPincel();
    atualizar();
  });
  document.addEventListener(EVENTO_MENSAGEM_SEGMENTACAO, (e) => {
    mensagem.textContent = String((e as CustomEvent<string>).detail ?? '');
  });
  document.addEventListener(EVENTO_DIAGNOSTICO_TOTALSEG, atualizarControlesTotalSeg);
  atualizar();
}
