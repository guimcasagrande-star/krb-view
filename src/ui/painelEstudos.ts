/**
 * Painel lateral: paciente > estudo > série > pilha, a partir do DicomIndex.
 * Clicar numa pilha dispara o evento "abrirPilha" (detail = StackNode).
 */

import { pilhasExibicaoDaSerie } from '../compare/segundaJanelaLogica';
import { formatDatePtBr } from '../io/dicomTime';
import type { DicomIndex, SeriesNode, StackNode, StudyNode } from '../io/organize';
import { criarObservadorMiniaturas, type ObservadorMiniaturas } from './miniaturas';
import { abrirMenuFlutuante } from './menuFlutuante';
import {
  ehJanelaSecundaria,
  enviarPilhaParaOutraJanela,
  segundaJanelaDisponivel,
} from '../viewer/segundaJanela';

export const EVENTO_ABRIR_PILHA = 'abrirPilha';
export type AbrirPilhaEvento = CustomEvent<StackNode>;

export const MIME_ARRASTAR_PILHA = 'application/x-visualizador-pilha';
export const PREFIXO_TEXTO_PILHA = 'visualizador-pilha:';

export interface DadosPilhaArrastada {
  pilhaId: string;
  seriesInstanceUid: string;
  studyInstanceUid?: string;
  sopInicial?: string;
}

export function temPilhaEmArraste(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const tipos = Array.from(dt.types ?? []);
  if (tipos.includes(MIME_ARRASTAR_PILHA)) return true;
  if (tipos.includes('Files')) return false;
  return tipos.includes('text/plain');
}

export function extrairDadosPilhaArrastada(dt: DataTransfer | null): DadosPilhaArrastada | null {
  if (!dt) return null;
  let bruto = dt.getData(MIME_ARRASTAR_PILHA);
  if (!bruto) {
    const txt = dt.getData('text/plain');
    if (txt && txt.startsWith(PREFIXO_TEXTO_PILHA)) {
      bruto = txt.slice(PREFIXO_TEXTO_PILHA.length);
    }
  }
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto) as Partial<DadosPilhaArrastada>;
    if (typeof parsed.pilhaId !== 'string') return null;
    return {
      pilhaId: parsed.pilhaId,
      seriesInstanceUid: typeof parsed.seriesInstanceUid === 'string' ? parsed.seriesInstanceUid : '',
      ...(typeof parsed.studyInstanceUid === 'string' ? { studyInstanceUid: parsed.studyInstanceUid } : {}),
      ...(typeof parsed.sopInicial === 'string' ? { sopInicial: parsed.sopInicial } : {}),
    };
  } catch {
    return null;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classe?: string,
  texto?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/** Observador das miniaturas do painel atual (recriado a cada pasta aberta). */
let miniaturas: ObservadorMiniaturas | undefined;

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n} ${n === 1 ? singular : pluralTxt}`;
}

function iconeAviso(pilha: StackNode): HTMLElement | undefined {
  const mensagens = pilha.geometry.issues.map((i) => i.message);
  if (mensagens.length === 0) return undefined;
  const icone = el('span', 'aviso-pilha', '⚠');
  const texto = mensagens.join('\n');
  icone.title = texto;
  icone.setAttribute('role', 'img');
  icone.setAttribute('aria-label', `Aviso: ${texto}`);
  return icone;
}

function descricaoSerie(serie: SeriesNode): string {
  return serie.description || '(sem descrição)';
}

function criarLinha(
  pilha: StackNode,
  nivelPilha: boolean,
  numero: string,
  titulo: string,
  quantidade: number,
  aoEscolher: (botao: HTMLButtonElement, pilha: StackNode) => void,
): HTMLButtonElement {
  const botao = el('button', nivelPilha ? 'serie pilha' : 'serie');
  botao.type = 'button';
  botao.dataset.pilhaId = pilha.id;

  const cartao = el('span', 'cartao-serie');
  const envoltorioMini = el('span', 'mini-envoltorio');
  // Miniatura: só é gerada quando o cartão aparece na área visível do painel.
  const mini = el('span', 'mini');
  miniaturas?.observar(mini, pilha);
  envoltorioMini.append(mini);

  if (numero) {
    envoltorioMini.append(el('span', 'selo-serie selo-num', numero));
  }
  const aviso = iconeAviso(pilha);
  if (aviso) {
    aviso.classList.add('selo-serie', 'selo-aviso');
    envoltorioMini.append(aviso);
  }
  // Quantidade de imagens escrita dentro da miniatura (canto inferior direito).
  const seloQuant = el('span', 'selo-serie selo-quant', String(quantidade));
  seloQuant.title = plural(quantidade, 'imagem', 'imagens');
  envoltorioMini.append(seloQuant);

  const podeEnviarOutraJanela = segundaJanelaDisponivel() && !ehJanelaSecundaria();
  if (podeEnviarOutraJanela) {
    const enviar = el('span', 'enviar-outra-janela', '↗');
    enviar.setAttribute('role', 'button');
    enviar.tabIndex = 0;
    enviar.title = 'Enviar para a outra janela';
    enviar.setAttribute('aria-label', 'Enviar para a outra janela');
    enviar.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      void enviarPilhaParaOutraJanela(pilha);
    });
    enviar.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        ev.stopPropagation();
        void enviarPilhaParaOutraJanela(pilha);
      }
    });
    envoltorioMini.append(enviar);
    botao.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      abrirMenuFlutuante(ev.clientX, ev.clientY, [
        { rotulo: 'Enviar para a outra janela', acao: () => void enviarPilhaParaOutraJanela(pilha) },
      ]);
    });
  }

  const legenda = el('span', 'titulo', titulo);
  cartao.append(envoltorioMini, legenda);
  botao.append(cartao);
  botao.draggable = true;
  const resumoPilha = `${numero ? `${numero} · ` : ''}${titulo} (${plural(quantidade, 'imagem', 'imagens')})`;
  botao.title = `${resumoPilha}\nClique para abrir no quadro selecionado ou arraste para qualquer quadro da grade`;
  botao.addEventListener('dragstart', (ev) => {
    if (!ev.dataTransfer) return;
    const primeira = pilha.instances[0];
    const carga = JSON.stringify({
      pilhaId: pilha.id,
      seriesInstanceUid: primeira?.seriesInstanceUid ?? '',
      studyInstanceUid: primeira?.studyInstanceUid ?? '',
      ...(primeira?.sopInstanceUid ? { sopInicial: primeira.sopInstanceUid } : {}),
    } satisfies DadosPilhaArrastada);
    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData(MIME_ARRASTAR_PILHA, carga);
    ev.dataTransfer.setData('text/plain', `${PREFIXO_TEXTO_PILHA}${carga}`);
    botao.classList.add('arrastando-serie');
  });
  botao.addEventListener('dragend', () => {
    botao.classList.remove('arrastando-serie');
  });
  botao.addEventListener('click', () => aoEscolher(botao, pilha));
  return botao;
}

function criarSerie(
  serie: SeriesNode,
  aoEscolher: (botao: HTMLButtonElement, pilha: StackNode) => void,
): HTMLElement[] {
  const rotulo = `${serie.modality ? `${serie.modality} · ` : ''}${descricaoSerie(serie)}`;
  const numero = serie.seriesNumber !== undefined ? `#${serie.seriesNumber}` : '';

  const pilhas = pilhasExibicaoDaSerie(serie);

  // Série sem pilhas (SEG, RTSTRUCT, laudo, documento): só informativa.
  if (pilhas.length === 0) {
    const botao = el('button', 'serie sem-imagem');
    botao.type = 'button';
    botao.disabled = true;
    const linha = el('span', 'linha');
    if (numero) linha.append(el('span', 'num', numero));
    linha.append(
      el('span', 'titulo', rotulo),
      el('span', 'quant', serie.kind === 'segmentacao' ? 'SEG' : 'doc'),
    );
    botao.title = `${numero ? `${numero} ` : ''}${rotulo} (${serie.kind === 'segmentacao' ? 'segmentação' : 'sem imagens'})`;
    botao.append(linha);
    return [botao];
  }

  // Uma pilha unificada (toda a sequência no mesmo plano): o próprio cartão da série abre tudo junto.
  if (pilhas.length === 1) {
    const unica = pilhas[0]!;
    return [criarLinha(unica, false, numero, rotulo, unica.instances.length, aoEscolher)];
  }

  return pilhas.map((pilha, n) => {
    const subRotulo = `${rotulo} · ${pilha.label ?? `Pilha ${n + 1}`}`;
    return criarLinha(pilha, true, numero, subRotulo, pilha.instances.length, aoEscolher);
  });
}

function criarEstudo(
  estudo: StudyNode,
  aoEscolher: (botao: HTMLButtonElement, pilha: StackNode) => void,
): HTMLElement {
  const detalhes = el('details', 'estudo');
  detalhes.open = true;
  const resumo = el('summary');
  resumo.title = `${formatDatePtBr(estudo.date) || 'sem data'}${estudo.description ? ` · ${estudo.description}` : ''}`;
  resumo.append(el('span', 'data', formatDatePtBr(estudo.date) || 'sem data'));
  if (estudo.modalities.length > 0) resumo.append(el('span', 'mod', estudo.modalities.join('/')));
  if (estudo.description) resumo.append(el('span', 'detalhe', estudo.description));
  detalhes.append(resumo);
  const gradeSeries = el('div', 'grade-series-estudo');
  for (const serie of estudo.series) gradeSeries.append(...criarSerie(serie, aoEscolher));
  detalhes.append(gradeSeries);
  return detalhes;
}

/** Destaca no painel a série que o viewport ativo mostra (null = nenhuma). */
export function marcarPilhaAtiva(container: HTMLElement, pilhaId: string | null): void {
  for (const b of container.querySelectorAll<HTMLButtonElement>('button.serie')) {
    b.classList.toggle('ativa', pilhaId !== null && b.dataset.pilhaId === pilhaId);
  }
}

/**
 * Navega para a série anterior (`-1`) ou próxima (`+1`) na barra de séries (setas ← / → no estilo RadiAnt).
 */
export function selecionarSerieAdjacente(delta: -1 | 1): boolean {
  const container = document.getElementById('lista-estudos');
  if (!container) return false;
  const botoes = Array.from(container.querySelectorAll<HTMLButtonElement>('button.serie:not(:disabled)'));
  if (botoes.length === 0) return false;
  const idxAtual = botoes.findIndex((b) => b.classList.contains('ativa'));
  const proximoIdx =
    idxAtual < 0
      ? 0
      : Math.min(botoes.length - 1, Math.max(0, idxAtual + delta));
  if (proximoIdx === idxAtual) return false;
  const alvo = botoes[proximoIdx]!;
  alvo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  alvo.click();
  return true;
}

/** Desenha o índice em `container`, substituindo o conteúdo anterior. */
export function renderizarPainelEstudos(container: HTMLElement, index: DicomIndex): void {
  container.replaceChildren();
  if (index.patients.length === 0) {
    container.append(el('div', 'vazio', 'Nenhuma imagem DICOM encontrada.'));
    return;
  }

  miniaturas?.desconectar();
  miniaturas = criarObservadorMiniaturas(container);
  // O destaque da série ativa vem do viewport ativo (ver marcarPilhaAtiva).
  const aoEscolher = (_botao: HTMLButtonElement, pilha: StackNode): void => {
    container.dispatchEvent(
      new CustomEvent<StackNode>(EVENTO_ABRIR_PILHA, { detail: pilha, bubbles: true }),
    );
  };

  for (const paciente of index.patients) {
    const detalhes = el('details', 'paciente');
    detalhes.open = true;
    const resumo = el('summary');
    resumo.append(el('span', 'nome', paciente.name || '(sem nome)'));
    if (paciente.patientId) resumo.append(el('span', 'id', paciente.patientId));
    detalhes.append(resumo);
    for (const estudo of paciente.studies) detalhes.append(criarEstudo(estudo, aoEscolher));
    container.append(detalhes);
  }
}
