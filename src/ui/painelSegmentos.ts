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
} from '../segmentation/segmentacao';
import { estado } from '../state/store';
import { escolherFerramentaPrimaria, EVENTO_BOTOES_MUDARAM, ferramentaPrimariaAtual, ID_GRUPO } from '../tools/grupo';
import { EVENTO_ESTADO_VIEWPORTS, garantirSegmentacaoAtiva } from '../viewer/viewport2d';

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
  rodape.append(
    botao('+ Novo segmento', 'Criar outro segmento (passa a ser o ativo)', () => void novoSegmentoAtivo()),
    botao('Apagar segmentação', 'Apagar todos os segmentos desta série', apagarSegmentacaoAtiva, 'link'),
  );

  const mensagem = document.createElement('div');
  mensagem.className = 'seg-mensagem';
  mensagem.setAttribute('role', 'status');

  painel.append(titulo, linhaFerramentas, linhaRaio, linhaFaixa, linhaEstilo, lista, rodape, mensagem);

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
        li.append(cor, nome, ver, travar, apagar);
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
