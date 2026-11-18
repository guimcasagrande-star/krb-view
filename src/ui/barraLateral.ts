/**
 * Controle acoplável e redimensionável da barra de séries (`#painel-lateral`):
 * - Pode ficar acoplada à esquerda (coluna vertical enxuta, ideal para modo retrato)
 *   ou no rodapé (faixa horizontal tipo filmstrip).
 * - Suporta arrastar pela alça superior ("⋮⋮ Séries") com prévia visual da área de encaixe,
 *   alternar com 1 clique (`◧ / ⬓`) e redimensionar pela borda interna.
 */

import {
  EVENTO_PREFERENCIAS,
  salvarPreferencias,
  telas,
  type PosicaoBarraSeries,
} from '../state/preferencias';

export const LARGURA_MIN_ESQUERDA = 136;
export const LARGURA_MAX_ESQUERDA = 380;
export const ALTURA_MIN_RODAPE = 84;
export const ALTURA_MAX_RODAPE = 360;

/**
 * Decide em qual borda acoplar a barra de séries com base na posição do ponteiro
 * dentro do retângulo da janela (`#app`).
 */
export function decidirPosicaoPorArraste(
  xRelativo: number,
  yRelativo: number,
  larguraJanela: number,
  alturaJanela: number,
  atual: PosicaoBarraSeries,
): PosicaoBarraSeries {
  if (larguraJanela <= 0 || alturaJanela <= 0) return atual;
  const fracX = xRelativo / larguraJanela;
  const fracY = yRelativo / alturaJanela;
  // Faixa inferior da tela (28% finais) e fora da margem extrema esquerda -> rodapé
  if (fracY >= 0.72 && fracX > 0.16) return 'rodape';
  // Faixa esquerda da tela (32% iniciais) e acima do terço final -> esquerda
  if (fracX <= 0.32 && fracY < 0.82) return 'esquerda';
  // No miolo da tela: escolhe pela distância normalizada à borda esquerda vs borda inferior
  const distEsquerda = Math.max(0, fracX);
  const distRodape = Math.max(0, 1 - fracY);
  return distRodape < distEsquerda * 0.85 ? 'rodape' : 'esquerda';
}

export function limitarTamanhoBarraLateral(
  posicao: PosicaoBarraSeries,
  valorPx: number,
  dimensaoJanelaPx?: number,
): number {
  const n = Math.round(valorPx);
  if (posicao === 'rodape') {
    const tetoDinamico =
      dimensaoJanelaPx && dimensaoJanelaPx > 240
        ? Math.min(ALTURA_MAX_RODAPE, Math.max(ALTURA_MIN_RODAPE, Math.floor(dimensaoJanelaPx * 0.52)))
        : ALTURA_MAX_RODAPE;
    return Math.min(tetoDinamico, Math.max(ALTURA_MIN_RODAPE, n));
  }
  const tetoLargura =
    dimensaoJanelaPx && dimensaoJanelaPx > 400
      ? Math.min(LARGURA_MAX_ESQUERDA, Math.max(LARGURA_MIN_ESQUERDA, Math.floor(dimensaoJanelaPx * 0.42)))
      : LARGURA_MAX_ESQUERDA;
  return Math.min(tetoLargura, Math.max(LARGURA_MIN_ESQUERDA, n));
}

export interface OpcoesBarraLateral {
  appEl: HTMLElement;
  painelEl: HTMLElement;
  listaEl: HTMLElement;
  secundaria: boolean;
  aoRecolher: () => void;
  aoMudarGeometria: () => void;
}

export function iniciarBarraLateral(opcoes: OpcoesBarraLateral): {
  aplicarPreferencias: () => void;
} {
  const { appEl, painelEl, listaEl, secundaria, aoRecolher, aoMudarGeometria } = opcoes;

  function obterPosicao(): PosicaoBarraSeries {
    const t = telas();
    return secundaria ? t.posicaoBarraSeriesSecundaria : t.posicaoBarraSeriesPrincipal;
  }

  function gravarPosicao(nova: PosicaoBarraSeries): void {
    const t = telas();
    if (secundaria) t.posicaoBarraSeriesSecundaria = nova;
    else t.posicaoBarraSeriesPrincipal = nova;
    salvarPreferencias();
  }

  // Cabeçalho compacto com alça de arraste e botões rápidos
  const cabecalho = document.createElement('div');
  cabecalho.className = 'cabecalho-lateral';

  const alca = document.createElement('div');
  alca.className = 'alca-lateral';
  alca.title = 'Arraste para acoplar a barra de séries à esquerda ou no rodapé';
  const iconeGrip = document.createElement('span');
  iconeGrip.className = 'icone-grip-lateral';
  iconeGrip.textContent = '⋮⋮';
  const rotuloAlca = document.createElement('span');
  rotuloAlca.className = 'titulo-alca-lateral';
  rotuloAlca.textContent = 'Séries';
  alca.append(iconeGrip, rotuloAlca);

  const acoesCab = document.createElement('div');
  acoesCab.className = 'acoes-cabecalho-lateral';

  const btnAlternarPosicao = document.createElement('button');
  btnAlternarPosicao.type = 'button';
  btnAlternarPosicao.className = 'btn-cab-lateral';
  btnAlternarPosicao.addEventListener('click', () => {
    const prox: PosicaoBarraSeries = obterPosicao() === 'esquerda' ? 'rodape' : 'esquerda';
    gravarPosicao(prox);
    aplicarPreferencias();
    aoMudarGeometria();
  });

  const btnOcultar = document.createElement('button');
  btnOcultar.type = 'button';
  btnOcultar.className = 'btn-cab-lateral';
  btnOcultar.textContent = '×';
  btnOcultar.title = 'Esconder barra de séries (Ctrl+B)';
  btnOcultar.setAttribute('aria-label', 'Esconder barra de séries');
  btnOcultar.addEventListener('click', aoRecolher);

  acoesCab.append(btnAlternarPosicao, btnOcultar);
  cabecalho.append(alca, acoesCab);
  painelEl.prepend(cabecalho);

  // Divisor de redimensionamento (borda direita na esquerda; borda superior no rodapé)
  const divisor = document.createElement('div');
  divisor.className = 'divisor-lateral';
  divisor.title = 'Arraste para ajustar o tamanho da barra de séries';
  painelEl.append(divisor);

  // Prévia visual ao arrastar para acoplar
  const previa = document.createElement('div');
  previa.className = 'previa-acoplamento';
  previa.hidden = true;
  appEl.append(previa);

  function atualizarSubpaineisAbertos(): void {
    const pos = obterPosicao();
    const segEl = document.getElementById('painel-segmentos');
    const suvEl = document.getElementById('painel-suv');
    const gavetaEl = document.getElementById('gaveta-subpaineis');
    const segAtivo = Boolean(segEl && !segEl.hidden);
    const suvAtivo = Boolean(suvEl && !suvEl.hidden);
    const temSubpainel = segAtivo || suvAtivo;

    if (segAtivo && segEl && segEl.parentElement !== painelEl) {
      painelEl.insertBefore(segEl, listaEl);
    }

    if (gavetaEl) {
      if (pos === 'rodape' && !segAtivo) {
        for (const sub of [suvEl, segEl]) {
          if (sub && sub.parentElement !== gavetaEl) {
            gavetaEl.append(sub);
          }
        }
        gavetaEl.hidden = !temSubpainel;
      } else {
        for (const sub of [suvEl, segEl]) {
          if (sub && sub.parentElement !== painelEl) {
            painelEl.insertBefore(sub, listaEl);
          }
        }
        gavetaEl.hidden = true;
      }
    }
    appEl.classList.toggle('ambiente-segmentacao', segAtivo);
    appEl.classList.toggle('lateral-com-subpainel', temSubpainel);
  }

  function aplicarPreferencias(): void {
    const pos = obterPosicao();
    const t = telas();
    const retApp = appEl.getBoundingClientRect();
    const larg = limitarTamanhoBarraLateral('esquerda', t.larguraBarraEsquerda, retApp.width || undefined);
    const alt = limitarTamanhoBarraLateral('rodape', t.alturaBarraRodape, retApp.height || undefined);
    appEl.classList.toggle('barra-rodape', pos === 'rodape');
    appEl.classList.toggle('barra-esquerda', pos === 'esquerda');
    appEl.style.setProperty('--largura-lateral', `${larg}px`);
    appEl.style.setProperty('--altura-lateral-rodape', `${alt}px`);
    btnAlternarPosicao.textContent = pos === 'esquerda' ? '⬓' : '◧';
    btnAlternarPosicao.title =
      pos === 'esquerda'
        ? 'Mover barra de séries para o rodapé (também pode arrastar “⋮⋮ Séries”)'
        : 'Mover barra de séries para a esquerda (também pode arrastar “⋮⋮ Séries”)';
    btnAlternarPosicao.setAttribute('aria-label', btnAlternarPosicao.title);
    atualizarSubpaineisAbertos();
  }

  // Observa abertura/fechamento de #painel-segmentos e #painel-suv para garantir largura/gaveta legível
  const obsSubpainel = new MutationObserver(() => {
    const antesSub = appEl.classList.contains('lateral-com-subpainel');
    const antesAmb = appEl.classList.contains('ambiente-segmentacao');
    atualizarSubpaineisAbertos();
    if (
      antesSub !== appEl.classList.contains('lateral-com-subpainel') ||
      antesAmb !== appEl.classList.contains('ambiente-segmentacao')
    ) {
      aoMudarGeometria();
    }
  });
  for (const id of ['painel-segmentos', 'painel-suv']) {
    const elSub = document.getElementById(id);
    if (elSub) obsSubpainel.observe(elSub, { attributes: true, attributeFilter: ['hidden'] });
  }

  // Arrastar pela alça para acoplar à esquerda ou no rodapé
  alca.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    alca.setPointerCapture(ev.pointerId);
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    let arrastando = false;
    let destino: PosicaoBarraSeries = obterPosicao();

    const aoMover = (m: PointerEvent): void => {
      if (!arrastando && Math.hypot(m.clientX - x0, m.clientY - y0) < 8) return;
      arrastando = true;
      const ret = appEl.getBoundingClientRect();
      destino = decidirPosicaoPorArraste(
        m.clientX - ret.left,
        m.clientY - ret.top,
        ret.width,
        ret.height,
        obterPosicao(),
      );
      previa.hidden = false;
      previa.dataset.posicao = destino;
    };

    const encerrar = (cancelado: boolean): void => {
      alca.removeEventListener('pointermove', aoMover);
      alca.removeEventListener('pointerup', aoSoltar);
      alca.removeEventListener('pointercancel', aoCancelar);
      previa.hidden = true;
      delete previa.dataset.posicao;
      if (!cancelado && arrastando && destino !== obterPosicao()) {
        gravarPosicao(destino);
        aplicarPreferencias();
        aoMudarGeometria();
      }
    };

    const aoSoltar = (): void => encerrar(false);
    const aoCancelar = (): void => encerrar(true);

    alca.addEventListener('pointermove', aoMover);
    alca.addEventListener('pointerup', aoSoltar);
    alca.addEventListener('pointercancel', aoCancelar);
  });

  // Arrastar o divisor para redimensionar largura (esquerda) ou altura (rodapé)
  let rafGeometria = 0;
  const agendarGeometria = (): void => {
    if (rafGeometria) return;
    rafGeometria = requestAnimationFrame(() => {
      rafGeometria = 0;
      aoMudarGeometria();
    });
  };

  divisor.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    divisor.setPointerCapture(ev.pointerId);
    divisor.classList.add('ativo');
    const pos = obterPosicao();

    const aoMover = (m: PointerEvent): void => {
      const retApp = appEl.getBoundingClientRect();
      if (pos === 'esquerda') {
        const larg = limitarTamanhoBarraLateral('esquerda', m.clientX - retApp.left, retApp.width);
        telas().larguraBarraEsquerda = larg;
        appEl.style.setProperty('--largura-lateral', `${larg}px`);
      } else {
        const rodapeEl = document.getElementById('rodape');
        const altRodapeAviso = rodapeEl ? rodapeEl.getBoundingClientRect().height : 24;
        const alt = limitarTamanhoBarraLateral(
          'rodape',
          retApp.bottom - altRodapeAviso - m.clientY,
          retApp.height,
        );
        telas().alturaBarraRodape = alt;
        appEl.style.setProperty('--altura-lateral-rodape', `${alt}px`);
      }
      agendarGeometria();
    };

    const encerrar = (): void => {
      divisor.classList.remove('ativo');
      divisor.removeEventListener('pointermove', aoMover);
      divisor.removeEventListener('pointerup', encerrar);
      divisor.removeEventListener('pointercancel', encerrar);
      if (rafGeometria) {
        cancelAnimationFrame(rafGeometria);
        rafGeometria = 0;
      }
      salvarPreferencias();
      aoMudarGeometria();
    };

    divisor.addEventListener('pointermove', aoMover);
    divisor.addEventListener('pointerup', encerrar);
    divisor.addEventListener('pointercancel', encerrar);
  });

  // Rolagem horizontal com a roda do mouse quando acoplada no rodapé
  listaEl.addEventListener(
    'wheel',
    (ev) => {
      if (obterPosicao() !== 'rodape') return;
      if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && listaEl.scrollWidth > listaEl.clientWidth) {
        ev.preventDefault();
        listaEl.scrollLeft += ev.deltaY;
      }
    },
    { passive: false },
  );

  document.addEventListener(EVENTO_PREFERENCIAS, () => {
    aplicarPreferencias();
    aoMudarGeometria();
  });

  window.addEventListener('resize', () => {
    aplicarPreferencias();
  });

  aplicarPreferencias();
  return { aplicarPreferencias };
}
