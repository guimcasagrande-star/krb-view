/**
 * Painel lateral: paciente > estudo > série > pilha, a partir do DicomIndex.
 * Clicar numa pilha dispara o evento "abrirPilha" (detail = StackNode).
 */

import { formatDatePtBr } from '../io/dicomTime';
import type { DicomIndex, SeriesNode, StackNode, StudyNode } from '../io/organize';

export const EVENTO_ABRIR_PILHA = 'abrirPilha';
export type AbrirPilhaEvento = CustomEvent<StackNode>;

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
  const linha = el('span', 'linha');
  linha.append(el('span', 'num', numero), el('span', 'titulo', titulo));
  const aviso = iconeAviso(pilha);
  if (aviso) linha.append(aviso);
  linha.append(el('span', 'quant', plural(quantidade, 'img', 'imgs')));
  botao.append(linha);
  botao.addEventListener('click', () => aoEscolher(botao, pilha));
  return botao;
}

function criarSerie(
  serie: SeriesNode,
  aoEscolher: (botao: HTMLButtonElement, pilha: StackNode) => void,
): HTMLElement[] {
  const rotulo = `${serie.modality ? `${serie.modality} · ` : ''}${descricaoSerie(serie)}`;
  const numero = serie.seriesNumber !== undefined ? `#${serie.seriesNumber}` : '';

  // Série sem pilhas (SEG, RTSTRUCT, laudo, documento): só informativa.
  if (serie.stacks.length === 0) {
    const botao = el('button', 'serie');
    botao.type = 'button';
    botao.disabled = true;
    const linha = el('span', 'linha');
    linha.append(
      el('span', 'num', numero),
      el('span', 'titulo', rotulo),
      el('span', 'quant', serie.kind === 'segmentacao' ? 'segmentação' : 'sem imagens'),
    );
    botao.append(linha);
    return [botao];
  }

  // Uma pilha só e sem rótulo: a própria linha da série abre a pilha.
  const unica = serie.stacks.length === 1 ? serie.stacks[0]! : undefined;
  if (unica && !unica.label) {
    return [criarLinha(unica, false, numero, rotulo, unica.instances.length, aoEscolher)];
  }

  const titulo = el('span', 'titulo-serie', `${numero} ${rotulo}`.trim());
  const linhas = serie.stacks.map((pilha, n) =>
    criarLinha(pilha, true, '', pilha.label ?? `Pilha ${n + 1}`, pilha.instances.length, aoEscolher),
  );
  return [titulo, ...linhas];
}

function criarEstudo(
  estudo: StudyNode,
  aoEscolher: (botao: HTMLButtonElement, pilha: StackNode) => void,
): HTMLElement {
  const detalhes = el('details', 'estudo');
  detalhes.open = true;
  const resumo = el('summary');
  resumo.append(el('span', 'data', formatDatePtBr(estudo.date) || 'sem data'));
  if (estudo.description) resumo.append(el('span', 'detalhe', ` · ${estudo.description}`));
  if (estudo.modalities.length > 0) resumo.append(el('span', 'mod', estudo.modalities.join(', ')));
  detalhes.append(resumo);
  for (const serie of estudo.series) detalhes.append(...criarSerie(serie, aoEscolher));
  return detalhes;
}

/** Desenha o índice em `container`, substituindo o conteúdo anterior. */
export function renderizarPainelEstudos(container: HTMLElement, index: DicomIndex): void {
  container.replaceChildren();
  if (index.patients.length === 0) {
    container.append(el('div', 'vazio', 'Nenhuma imagem DICOM encontrada.'));
    return;
  }

  let ativa: HTMLButtonElement | undefined;
  const aoEscolher = (botao: HTMLButtonElement, pilha: StackNode): void => {
    ativa?.classList.remove('ativa');
    botao.classList.add('ativa');
    ativa = botao;
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
