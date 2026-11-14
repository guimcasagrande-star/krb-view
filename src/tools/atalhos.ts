/**
 * Atalhos de teclado do viewport (2D e MPR) e a tela de ajuda (tecla ?).
 */

import { preferencias } from '../state/preferencias';
import {
  aplicarPredefinicao,
  apagarSelecionadas,
  cancelar,
  escolherFerramentaPorTecla,
  irParaCorte,
  rolarCortes,
} from './grupo';
import { dispararAbrirArquivos, dispararAbrirPasta } from '../ui/abrirPasta';
import { alternarOverlay } from '../viewer/overlay';
import {
  abrirCurvaPerfusaoAtiva,
  alternarCine,
  alternarMaximizado,
  alternarMpr,
  limparMirasLocalizador,
  proximoLayout,
} from '../viewer/viewport2d';

/** Ações com tecla própria, configuráveis (as ferramentas ficam em FERRAMENTAS_PRIMARIAS). */
export const ACOES_ATALHO: Array<{ id: string; rotulo: string; tecla: string }> = [
  { id: 'overlay', rotulo: 'Mostrar/esconder texto nos cantos', tecla: 'o' },
  { id: 'layout', rotulo: 'Alternar layout (1x1, 1x2, 2x2)', tecla: 'l' },
  { id: 'mpr', rotulo: 'Entrar/sair do MPR', tecla: 'r' },
  { id: 'maximizar', rotulo: 'Maximizar/restaurar viewport ativo', tecla: 'f' },
];

export function teclaDaAcao(id: string): string {
  return preferencias().atalhos[`acao:${id}`] ?? ACOES_ATALHO.find((a) => a.id === id)?.tecla ?? '';
}

const LINHAS_AJUDA: Array<[string, string]> = [
  ['Ctrl+Shift+O / Ctrl+O', 'Abrir pasta DICOM / Abrir arquivo(s) DICOM'],
  ['Botão esquerdo', 'Ferramenta escolhida na barra (padrão: passar cortes no 2D, crosshairs no MPR)'],
  ['Botões direito, meio, laterais e roda', 'Escolhidos no menu 🖱 da barra (padrão: zoom, pan, avançar = distância, voltar = nenhum, roda = cortes)'],
  ['S W H Z X C', 'Navegação: passar cortes, janela/nível, pan, zoom, ┼ localizar ponto, crosshairs (MPR)'],
  ['I', 'Girar plano: arrastar inclina o plano em torno do ponto marcado (┼ Localizar, ou o centro do crosshair no MPR); com Shift gira dentro do plano. Vale nas reconstruções'],
  ['Clique direito (sem arrastar)', 'Menu rápido: ferramentas, medidas, janelas, plano e apagar medida'],
  ['Cubo no canto inferior direito', 'Mostra a orientação e o plano; clique nele para trocar de plano (axial, coronal, sagital)'],
  ['D B Q N', 'Medidas lineares: distância, desvio linha média, proporção L1/L2 (razão), relação de estenose (%)'],
  ['A K V T E M P', 'Ângulos e ROIs: ângulo (3 pts), ângulo de Cobb (4 pts), ângulo c/ eixo horiz./vert., seta, ROI elíptica, ROI mão livre, polilinha'],
  ['Ctrl+Shift+E', 'Gerar curva tempo-intensidade / perfusão para as ROIs do corte'],
  ['R', 'Entra ou sai do modo MPR (axial, coronal e sagital)'],
  ['Ctrl + roda', 'Ajusta a espessura do slab (mm) no viewport sob o cursor'],
  ['↑ ↓ (ou PgUp PgDn)', 'Corte anterior / próximo no viewport ativo'],
  ['Home / End', 'Primeiro / último corte'],
  ['Espaço', 'Toca ou pausa o cine (ou a rotação do MIP 3D, que abre parado em AP)'],
  ['L', 'Alterna o layout 2D: 1x1, 1x2, 2x2 (outras grades: menu ⊞)'],
  ['F / 2 cliques', 'Maximiza o viewport (tela cheia da grade) e volta; com medida ativa, Shift+2 cliques'],
  ['1 a 9', 'Janelas predefinidas, na ordem da lista (editável em ⚙ Configurações)'],
  ['⚙', 'Configurações: aparência das medidas, mouse e zoom, atalhos e janelas'],
  ['O', 'Mostra ou esconde o texto nos cantos (paciente, estudo, corte, janela, zoom)'],
  ['Esc', 'Cancela a medida em andamento, limpa a cruzinha (┼) e volta à ferramenta padrão'],
  ['Clique na medida', 'Seleciona (Shift soma). Onde o cursor vira mãozinha, arrastar move a medida'],
  ['Delete / Backspace', 'Apaga a medida selecionada'],
  ['?', 'Mostra ou esconde esta ajuda'],
];

let caixa: HTMLDialogElement | undefined;

function caixaAjuda(): HTMLDialogElement {
  if (caixa) return caixa;
  const d = document.createElement('dialog');
  d.id = 'ajuda';
  d.setAttribute('aria-label', 'Atalhos de teclado');

  const titulo = document.createElement('h2');
  titulo.textContent = 'Atalhos';
  d.append(titulo);

  const tabela = document.createElement('table');
  for (const [tecla, efeito] of LINHAS_AJUDA) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = tecla;
    const td2 = document.createElement('td');
    td2.textContent = efeito;
    tr.append(td1, td2);
    tabela.append(tr);
  }
  d.append(tabela);

  const fechar = document.createElement('button');
  fechar.type = 'button';
  fechar.textContent = 'Fechar';
  fechar.addEventListener('click', () => d.close());
  d.append(fechar);

  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  caixa = d;
  return d;
}

export function alternarAjuda(): void {
  const d = caixaAjuda();
  if (d.open) d.close();
  else d.showModal();
}

function digitandoEmCampo(alvo: EventTarget | null): boolean {
  return alvo instanceof HTMLElement && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName));
}

/** Instala os atalhos uma vez. Ignora teclas quando o foco está em campo de texto. */
export function iniciarAtalhos(): void {
  // Botões laterais do mouse (voltar/avançar) são ferramentas: não podem navegar o histórico.
  for (const tipo of ['mousedown', 'mouseup', 'auxclick'] as const) {
    document.addEventListener(
      tipo,
      (e) => {
        if (e.button === 3 || e.button === 4) e.preventDefault();
      },
      true,
    );
  }
  try {
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', () => history.pushState(null, '', location.href));
  } catch {
    /* sem histórico (ex.: contexto restrito) */
  }

  document.addEventListener('keydown', (e) => {
    if (digitandoEmCampo(e.target)) return;

    // Combinações com Ctrl / Cmd:
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'o' && e.shiftKey) {
        e.preventDefault();
        dispararAbrirPasta();
        return;
      }
      if (k === 'o' && !e.shiftKey) {
        e.preventDefault();
        dispararAbrirArquivos();
        return;
      }
      if (k === 'e' && e.shiftKey) {
        e.preventDefault();
        void abrirCurvaPerfusaoAtiva();
        return;
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (caixa?.open) {
        caixa.close();
        return;
      }
      limparMirasLocalizador();
      void cancelar();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      void apagarSelecionadas();
      return;
    }
    if (e.key === '?') {
      alternarAjuda();
      return;
    }
    const tecla = e.key.toLowerCase();
    if (tecla === teclaDaAcao('overlay')) {
      alternarOverlay();
      return;
    }
    if (tecla === teclaDaAcao('layout')) {
      void proximoLayout();
      return;
    }
    if (tecla === teclaDaAcao('maximizar')) {
      alternarMaximizado();
      return;
    }
    if (tecla === teclaDaAcao('mpr')) {
      void alternarMpr();
      return;
    }
    if (e.key === ' ') {
      // Num botão focado, a barra de espaço já o aciona; não tocar o cine por cima.
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      alternarCine();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      e.preventDefault();
      void rolarCortes(1);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      void rolarCortes(-1);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      void irParaCorte(e.key === 'Home' ? 'primeiro' : 'ultimo');
      return;
    }
    if (escolherFerramentaPorTecla(tecla)) return;
    if (/^[1-9]$/.test(e.key)) {
      void aplicarPredefinicao(Number(e.key) - 1);
    }
  });
}
