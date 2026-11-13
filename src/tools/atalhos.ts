/**
 * Atalhos de teclado do viewport (2D e MPR) e a tela de ajuda (tecla ?).
 */

import {
  aplicarPredefinicao,
  apagarSelecionadas,
  cancelar,
  escolherFerramentaPorTecla,
  irParaCorte,
  rolarCortes,
} from './grupo';
import { alternarOverlay } from '../viewer/overlay';
import { alternarCine, alternarMpr, proximoLayout } from '../viewer/viewport2d';

const LINHAS_AJUDA: Array<[string, string]> = [
  ['Botão esquerdo', 'Ferramenta escolhida na barra (janela/nível no 2D, crosshairs no MPR)'],
  ['Botões direito, meio e roda', 'Escolhidos nos seletores da barra (padrão: zoom, pan e cortes)'],
  ['W S C D A E M P', 'Botão esquerdo: janela/nível, passar cortes, crosshairs (MPR), distância, ângulo, ROI elíptica, ROI à mão livre, polilinha'],
  ['R', 'Entra ou sai do modo MPR (axial, coronal e sagital)'],
  ['Ctrl + roda', 'Ajusta a espessura do slab (mm) no viewport sob o cursor'],
  ['↑ ↓ (ou PgUp PgDn)', 'Corte anterior / próximo no viewport ativo'],
  ['Home / End', 'Primeiro / último corte'],
  ['Espaço', 'Toca ou pausa o cine (modo 2D)'],
  ['L', 'Alterna o layout 2D: 1x1, 1x2, 2x2'],
  ['1 a 6', 'Janela: partes moles, pulmão, osso, fígado, cérebro, mediastino'],
  ['O', 'Mostra ou esconde o texto nos cantos (paciente, estudo, corte, janela, zoom)'],
  ['Esc', 'Cancela a medida em andamento e volta à ferramenta padrão'],
  ['Delete', 'Apaga a medida selecionada'],
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
  document.addEventListener('keydown', (e) => {
    if (digitandoEmCampo(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      if (caixa?.open) {
        caixa.close();
        return;
      }
      void cancelar();
      return;
    }
    if (e.key === 'Delete') {
      void apagarSelecionadas();
      return;
    }
    if (e.key === '?') {
      alternarAjuda();
      return;
    }
    const tecla = e.key.toLowerCase();
    if (tecla === 'o') {
      alternarOverlay();
      return;
    }
    if (tecla === 'l') {
      void proximoLayout();
      return;
    }
    if (tecla === 'r') {
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
    if (/^[1-6]$/.test(e.key)) {
      void aplicarPredefinicao(Number(e.key) - 1);
    }
  });
}
