/**
 * Menu rápido do botão direito: clicar com o botão direito sobre a imagem, sem arrastar, abre
 * na posição do mouse as ferramentas, as medidas, as janelas, o plano e as ações da imagem.
 * Arrastar com o botão direito continua sendo a ferramenta dele (zoom, por padrão).
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { annotation as anotacoes, utilities } from '@cornerstonejs/tools';
import { estado } from '../state/store';
import {
  apagarSelecionadas,
  aplicarPredefinicao,
  botaoAtribuido,
  emModoMprFerramentas,
  escolherFerramentaPrimaria,
  espelhar,
  ferramentaPrimariaAtual,
  FERRAMENTAS_PRIMARIAS,
  girar90,
  inverter,
  limparMedidas,
  predefinicoes,
  restaurar,
  teclaDaFerramenta,
  type FerramentaPrimaria,
} from '../tools/grupo';
import { FERRAMENTA_LOCALIZADOR_3D } from '../tools/localizador3d';
import { medidaNoPonto } from '../tools/selecao';
import { petEmSuv, TETOS_SUV } from '../viewer/exibicaoInicial';
import { alternarMaximizado, alternarMpr, itensMenuPlano } from '../viewer/viewport2d';
import { abrirConfiguracoes } from './configuracoes';
import { abrirMenuFlutuante, type EntradaMenuFlutuante } from './menuFlutuante';

/** Acima disso (px) o botão direito foi um arrasto (zoom), não um clique. */
const MOVIMENTO_MAXIMO_PX = 4;

function itemFerramenta(f: FerramentaPrimaria): EntradaMenuFlutuante {
  const tecla = teclaDaFerramenta(f).toUpperCase();
  return {
    rotulo: f.rotulo,
    marcado: ferramentaPrimariaAtual() === f.nome,
    acao: () => escolherFerramentaPrimaria(f.nome),
    ...(tecla ? { atalho: tecla } : {}),
  };
}

function itensJanela(): EntradaMenuFlutuante[] {
  if (petEmSuv(estado.pilhaAtiva)) {
    return TETOS_SUV.map<EntradaMenuFlutuante>((teto, i) => ({
      rotulo: `SUV 0 – ${teto}`,
      atalho: String(i + 1),
      acao: () => void aplicarPredefinicao(i),
    }));
  }
  return [
    ...predefinicoes().map<EntradaMenuFlutuante>((p, i) => ({
      rotulo: `${p.rotulo} (${p.centro} / ${p.largura})`,
      atalho: String(i + 1),
      acao: () => void aplicarPredefinicao(i),
    })),
    'divisor',
    { rotulo: 'Editar janelas…', acao: () => abrirConfiguracoes('janelas') },
  ];
}

function montarItens(sobreMedida: boolean): EntradaMenuFlutuante[] {
  const itens: EntradaMenuFlutuante[] = [];
  const selecionadas = anotacoes.selection
    .getAnnotationsSelected()
    .filter((uid) => anotacoes.state.getAnnotation(uid)?.metadata?.toolName !== 'Crosshairs').length;
  if (sobreMedida || selecionadas > 0) {
    itens.push(
      {
        rotulo: selecionadas > 1 ? `Apagar ${selecionadas} medidas selecionadas` : 'Apagar esta medida',
        atalho: 'Del',
        acao: () => void apagarSelecionadas(),
      },
      'divisor',
    );
  }
  const mpr = emModoMprFerramentas();
  for (const f of FERRAMENTAS_PRIMARIAS) {
    if (f.categoria === 'navegacao' && (!f.apenasMpr || mpr)) itens.push(itemFerramenta(f));
  }
  itens.push(
    'divisor',
    { rotulo: 'Medidas', filhos: FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'medida').map(itemFerramenta) },
    { rotulo: 'Janela', filhos: itensJanela() },
  );
  const planos = itensMenuPlano();
  if (planos.length > 0) itens.push({ rotulo: 'Plano', filhos: planos });
  itens.push(
    {
      rotulo: 'Imagem',
      filhos: [
        { rotulo: 'Inverter preto e branco', acao: () => void inverter() },
        { rotulo: 'Girar 90°', acao: () => void girar90() },
        { rotulo: 'Espelhar', acao: () => void espelhar() },
        'divisor',
        { rotulo: 'Restaurar imagem', acao: () => void restaurar() },
      ],
    },
    'divisor',
    { rotulo: mpr ? 'Sair do MPR' : 'MPR (3 planos)', atalho: 'R', acao: () => void alternarMpr() },
    { rotulo: 'Maximizar / restaurar quadro', atalho: 'F', acao: () => alternarMaximizado() },
    'divisor',
    { rotulo: 'Apagar todas as medidas', acao: () => void limparMedidas() },
  );
  return itens;
}

export function iniciarMenuContexto(area: HTMLElement): void {
  let inicio: { x: number; y: number; elemento: HTMLDivElement } | null = null;

  // O menu do navegador nunca aparece sobre as imagens.
  area.addEventListener('contextmenu', (e) => e.preventDefault());

  area.addEventListener(
    'mousedown',
    (ev) => {
      inicio = null;
      if (ev.button !== 2 || !(ev.target instanceof Element)) return;
      // Controles sobre a imagem (botões, fusão, 3D, cubo) têm o próprio clique.
      if (ev.target.closest('button, input, select, a, .controles-3d, .controles-fusao, .cubo-orientacao')) return;
      // ┼ Localizar no botão direito: o clique já é a ação dele.
      if (botaoAtribuido('direito') === FERRAMENTA_LOCALIZADOR_3D) return;
      const elemento = ev.target.closest<HTMLDivElement>('[data-viewport-uid]');
      if (elemento) inicio = { x: ev.clientX, y: ev.clientY, elemento };
    },
    true,
  );

  window.addEventListener(
    'mouseup',
    (ev) => {
      const origem = inicio;
      inicio = null;
      if (!origem || ev.button !== 2) return;
      if (Math.hypot(ev.clientX - origem.x, ev.clientY - origem.y) > MOVIMENTO_MAXIMO_PX) return;
      const viewport = getEnabledElement(origem.elemento)?.viewport;
      if (!viewport) return;
      // Sobre uma medida: ela fica selecionada, e o menu começa por "Apagar esta medida".
      const rect = origem.elemento.getBoundingClientRect();
      let uid: string | null = null;
      try {
        uid = medidaNoPonto(origem.elemento, [ev.clientX - rect.left, ev.clientY - rect.top]);
      } catch {
        uid = null;
      }
      if (uid && !anotacoes.selection.isAnnotationSelected(uid)) {
        anotacoes.selection.setAnnotationSelected(uid, true, false);
        utilities.triggerAnnotationRenderForViewportIds([viewport.id]);
      }
      abrirMenuFlutuante(ev.clientX, ev.clientY, montarItens(uid !== null));
    },
    true,
  );
}
