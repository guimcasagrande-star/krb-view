/**
 * Atalhos de teclado do viewport (2D, MPR e 3D) alinhados com o RadiAnt DICOM Viewer
 * e tela de ajuda (tecla ?).
 */

import { pacsDisponivel } from '../pacs/transporteTauri';
import {
  ajustarRaioPincelDelta,
  definirModoSegmentacao,
  ehFerramentaSegmentacao,
  emModoSegmentacao,
} from '../segmentation/ferramentas';
import { preferencias } from '../state/preferencias';
import {
  aplicarPredefinicao,
  aplicarZoomFator,
  apagarSelecionadas,
  cancelar,
  escolherFerramentaPorTecla,
  espelhar,
  ferramentaPrimariaAtual,
  girar90,
  inverter,
  irParaCorte,
  restaurar,
  rolarCortes,
} from './grupo';
import { autoJanelaCorteAtual, copiarMedidasSelecionadas } from './utilidadesJanelaEMedidas';
import { dispararAbrirArquivos, dispararAbrirPasta } from '../ui/abrirPasta';
import { selecionarSerieAdjacente } from '../ui/painelEstudos';
import { alternarOverlay } from '../viewer/overlay';
import {
  abrirCurvaPerfusaoAtiva,
  alternar3d,
  alternarCine,
  alternarLinhasReferencia,
  alternarMaximizado,
  alternarMpr,
  alternarSincroniaEstudo,
  limparMirasLocalizador,
  proximoLayout,
  selecionarPlanoOrtogonalAtivo,
} from '../viewer/viewport2d';

/** Ações com tecla própria, configuráveis (as ferramentas ficam em FERRAMENTAS_PRIMARIAS). */
export const ACOES_ATALHO: Array<{ id: string; rotulo: string; tecla: string }> = [
  { id: 'overlay', rotulo: 'Mostrar/esconder texto nos cantos (também F12)', tecla: 'o' },
  { id: 'layout', rotulo: 'Alternar layout (1x1, 1x2, 2x2)', tecla: 'f4' },
  { id: 'mpr', rotulo: 'Entrar/sair do MPR (também F2)', tecla: 'r' },
  { id: 'maximizar', rotulo: 'Maximizar/restaurar viewport ativo', tecla: 'f' },
];

export function teclaDaAcao(id: string): string {
  return preferencias().atalhos[`acao:${id}`] ?? ACOES_ATALHO.find((a) => a.id === id)?.tecla ?? '';
}

const LINHAS_AJUDA: Array<[string, string]> = [
  ['Ctrl+O / Ctrl+Shift+O', 'Abrir arquivo(s) DICOM / Abrir pasta DICOM (padrão RadiAnt)'],
  ['Ctrl+F', 'Buscar e baixar exames no PACS'],
  ['B (ou S) · W · M (ou H) · Z', 'Passar cortes · Janela/nível · Pan (mover) · Zoom (padrão RadiAnt)'],
  ['Ctrl++ / Ctrl+-', 'Aproximar / afastar o zoom do quadro ativo'],
  ['L (ou D) · E · P · A · C · Y', 'Distância · ROI elíptica · ROI mão livre · Ângulo · Cobb · Seta (padrão RadiAnt)'],
  ['G · Q · N · K · V · T · U · J', 'Ortogonal · Proporção · Estenose · Desvio · Âng. eixo · Polilinha · VOI 3D · Lesão PET'],
  ['X · I', '┼ Localizar ponto sincronizado · ⟲ Girar plano oblíquo'],
  ['F2 (ou R) · F3', 'Entrar/sair do MPR 3D · Abrir/fechar Reconstrução 3D (padrão RadiAnt)'],
  ['Ctrl+Alt+1 / 2 / 3', 'Mudar para plano Coronal (1), Sagital (2) ou Axial (3) (padrão RadiAnt)'],
  ['F4 · F5', 'Alternar grade (1x1, 1x2, 2x2) · Ligar/desligar sincronização entre séries (padrão RadiAnt)'],
  ['F11 (ou Ctrl+I)', 'Inverter preto e branco / negativo (padrão RadiAnt)'],
  ['F12 (ou O) · Ctrl+F12', 'Mostrar/esconder texto nos cantos · Mostrar/esconder linhas de referência'],
  ['Ctrl+[ / Ctrl+]', 'Girar 90° anti-horário / horário (padrão RadiAnt)'],
  ['Ctrl+Shift+[ / Ctrl+Shift+]', 'Espelhar horizontalmente / verticalmente (padrão RadiAnt)'],
  ['Ctrl+R', 'Restaurar visualização inicial (janela, zoom, rotação e espelhamento)'],
  ['↑ ↓ (ou PgUp/PgDn) · Home/End', 'Corte anterior / próximo · Primeiro / último corte'],
  ['← / →', 'Série anterior / próxima na barra de séries (padrão RadiAnt)'],
  ['1 a 9 · 0', 'Janelas predefinidas (1–9) · Auto-janela no corte atual (0)'],
  ['Ctrl + roda', 'Ajustar espessura do slab (mm) no viewport sob o cursor'],
  ['[ e ] (ou Alt + roda)', 'Diminuir / aumentar raio do pincel na segmentação (Shift+arrastar apaga)'],
  ['Espaço', 'Tocar ou pausar o cine / rotação do MIP 3D'],
  ['F / 2 cliques · Shift+F11', 'Maximizar viewport na grade · Tela cheia sem bordas da janela'],
  ['Ctrl+B', 'Mostrar ou esconder a barra de séries (acoplável à esquerda ou rodapé)'],
  ['Ctrl+C · Delete / Backspace', 'Copiar valor da medida selecionada · Apagar medida selecionada'],
  ['Esc', 'Cancelar medida, sair do modo de segmentação e voltar à ferramenta padrão'],
  ['?', 'Mostrar ou esconder esta ajuda'],
];

let caixa: HTMLDialogElement | undefined;

function caixaAjuda(): HTMLDialogElement {
  if (caixa) return caixa;
  const d = document.createElement('dialog');
  d.id = 'ajuda';
  d.setAttribute('aria-label', 'Atalhos de teclado');

  const titulo = document.createElement('h2');
  titulo.textContent = 'Atalhos de teclado (padrão RadiAnt)';
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

    // Ctrl + Alt + 1/2/3: planos ortogonais no padrão RadiAnt (1 Coronal, 2 Sagital, 3 Axial)
    if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
      if (e.key === '1' || e.code === 'Digit1') {
        e.preventDefault();
        void selecionarPlanoOrtogonalAtivo('coronal');
        return;
      }
      if (e.key === '2' || e.code === 'Digit2') {
        e.preventDefault();
        void selecionarPlanoOrtogonalAtivo('sagital');
        return;
      }
      if (e.key === '3' || e.code === 'Digit3') {
        e.preventDefault();
        void selecionarPlanoOrtogonalAtivo('axial');
        return;
      }
      return;
    }

    // Combinações com Ctrl / Cmd (sem Alt):
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
      if (k === 'f' && !e.shiftKey && pacsDisponivel()) {
        e.preventDefault();
        void import('../ui/buscarPacs').then((m) => m.abrirBuscarPacs('buscar'));
        return;
      }
      if (k === 'r' && !e.shiftKey) {
        e.preventDefault();
        limparMirasLocalizador();
        void restaurar();
        return;
      }
      if (k === 'i' && !e.shiftKey) {
        e.preventDefault();
        void inverter();
        return;
      }
      if (e.key === 'F12' && !e.shiftKey) {
        e.preventDefault();
        alternarLinhasReferencia();
        return;
      }
      // Girar 90° e Espelhar no padrão RadiAnt (Ctrl+[ / Ctrl+] e Ctrl+Shift+[ / Ctrl+Shift+])
      if (e.code === 'BracketLeft' || e.key === '[' || e.key === '{') {
        e.preventDefault();
        if (e.shiftKey) void espelhar(false);
        else void girar90(-1);
        return;
      }
      if (e.code === 'BracketRight' || e.key === ']' || e.key === '}') {
        e.preventDefault();
        if (e.shiftKey) void espelhar(true);
        else void girar90(1);
        return;
      }
      // Zoom in / out no padrão RadiAnt (Ctrl++ / Ctrl+-)
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        void aplicarZoomFator(1.18);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        void aplicarZoomFator(1 / 1.18);
        return;
      }
      if (k === 'e' && e.shiftKey) {
        e.preventDefault();
        void abrirCurvaPerfusaoAtiva();
        return;
      }
      if (k === 'c' && !e.shiftKey) {
        const selecaoTexto = window.getSelection()?.toString() ?? '';
        if (!selecaoTexto) {
          void copiarMedidasSelecionadas().then((copiou) => {
            if (copiou) e.preventDefault();
          });
        }
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
      if (emModoSegmentacao()) {
        definirModoSegmentacao(false);
      }
      limparMirasLocalizador();
      void cancelar();
      return;
    }

    // Teclas de função estilo RadiAnt (F2 MPR, F3 3D, F4 Grade, F5 Sincronia, F11 Inverter, F12 Overlay)
    if (e.key === 'F2') {
      e.preventDefault();
      void alternarMpr();
      return;
    }
    if (e.key === 'F3') {
      e.preventDefault();
      void alternar3d();
      return;
    }
    if (e.key === 'F4' && !e.shiftKey) {
      e.preventDefault();
      void proximoLayout();
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      alternarSincroniaEstudo();
      return;
    }
    if (e.key === 'F11' && !e.shiftKey) {
      e.preventDefault();
      void inverter();
      return;
    }
    if (e.key === 'F12' && !e.shiftKey) {
      e.preventDefault();
      alternarOverlay();
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

    // Ajuste rápido do raio do pincel/corretor com [ e ] quando estiver segmentando
    if ((e.key === '[' || e.key === ']') && (emModoSegmentacao() || ehFerramentaSegmentacao(ferramentaPrimariaAtual()))) {
      e.preventDefault();
      ajustarRaioPincelDelta(e.key === ']' ? 1 : -1);
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
    if (e.key === 'ArrowLeft') {
      if (selecionarSerieAdjacente(-1)) e.preventDefault();
      return;
    }
    if (e.key === 'ArrowRight') {
      if (selecionarSerieAdjacente(1)) e.preventDefault();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      void irParaCorte(e.key === 'Home' ? 'primeiro' : 'ultimo');
      return;
    }
    if (escolherFerramentaPorTecla(tecla)) return;
    if (e.key === '0') {
      void autoJanelaCorteAtual();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      void aplicarPredefinicao(Number(e.key) - 1);
    }
  });
}
