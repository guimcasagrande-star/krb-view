/**
 * Painel lateral: paciente > estudo > série > pilha, a partir do DicomIndex.
 * Clicar numa pilha dispara o evento "abrirPilha" (detail = StackNode).
 */

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
  const linha = el('span', 'linha');
  // Miniatura: só é gerada quando a linha aparece na área visível do painel.
  const mini = el('span', 'mini');
  miniaturas?.observar(mini, pilha);
  linha.append(mini, el('span', 'num', numero), el('span', 'titulo', titulo));
  const aviso = iconeAviso(pilha);
  if (aviso) linha.append(aviso);
  linha.append(el('span', 'quant', plural(quantidade, 'img', 'imgs')));
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
    linha.append(enviar);
    botao.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      abrirMenuFlutuante(ev.clientX, ev.clientY, [
        { rotulo: 'Enviar para a outra janela', acao: () => void enviarPilhaParaOutraJanela(pilha) },
      ]);
    });
  }
  botao.append(linha);
  botao.draggable = true;
  botao.title = 'Clique para abrir no quadro selecionado ou arraste para qualquer quadro da grade';
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

/** Destaca no painel a série que o viewport ativo mostra (null = nenhuma). */
export function marcarPilhaAtiva(container: HTMLElement, pilhaId: string | null): void {
  for (const b of container.querySelectorAll<HTMLButtonElement>('button.serie')) {
    b.classList.toggle('ativa', pilhaId !== null && b.dataset.pilhaId === pilhaId);
  }
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
