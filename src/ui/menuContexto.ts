/**
 * Menu rápido do botão direito: clicar com o botão direito sobre a imagem, sem arrastar, abre
 * na posição do mouse as ferramentas, as medidas, as janelas, o plano e as ações da imagem.
 * Arrastar com o botão direito continua sendo a ferramenta dele (zoom, por padrão).
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { annotation as anotacoes, utilities } from '@cornerstonejs/tools';
import { favoritosMenu, TOTAL_FAVORITOS_MENU } from '../state/preferencias';
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
import { autoJanelaCorteAtual, copiarMedidasSelecionadas } from '../tools/utilidadesJanelaEMedidas';
import { petEmSuv, TETOS_SUV } from '../viewer/exibicaoInicial';
import { alternarMaximizado, alternarMpr, itensMenuPlano } from '../viewer/viewport2d';
import type { AbaConfiguracoes } from './configuracoes';

function abrirConfiguracoes(aba?: AbaConfiguracoes): void {
  void import('./configuracoes').then((m) => m.abrirConfiguracoes(aba));
}
import {
  abrirMenuFlutuante,
  type BarraIconesMenuFlutuante,
  type BotaoIconeMenuFlutuante,
  type EntradaMenuFlutuante,
} from './menuFlutuante';
import {
  ehJanelaSecundaria,
  enviarPilhaParaOutraJanela,
  segundaJanelaDisponivel,
} from '../viewer/segundaJanela';

/** Acima disso (px) o botão direito foi um arrasto (zoom), não um clique. */
const MOVIMENTO_MAXIMO_PX = 4;

/** Envolve traços vetoriais num SVG esquemático 24×24 sem texto. */
function svgEsquematico(conteudo: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${conteudo}</svg>`;
}

/** Ícones esquemáticos (apenas desenho geométrico, sem letras/palavras) para cada ferramenta ou ação. */
const ICONES_ESQUEMATICOS: Record<string, string> = {
  // Navegação
  StackScroll: svgEsquematico(
    '<path d="M4 7h10M4 12h10M4 17h10"/><path d="M18 4v16M15.5 6.5L18 4l2.5 2.5M15.5 17.5L18 20l2.5-2.5"/>',
  ),
  WindowLevel: svgEsquematico(
    '<circle cx="12" cy="12" r="7"/><path d="M12 5a7 7 0 0 1 0 14z" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  ),
  Pan: svgEsquematico(
    '<path d="M12 3v18M3 12h18M9.5 5.5L12 3l2.5 2.5M9.5 18.5L12 21l2.5-2.5M5.5 9.5L3 12l2.5 2.5M18.5 9.5L21 12l-2.5 2.5"/>',
  ),
  Zoom: svgEsquematico(
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>',
  ),
  Localizador3D: svgEsquematico(
    '<circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  ),
  GirarPlano: svgEsquematico(
    '<rect x="7" y="7" width="10" height="10" rx="1.5" transform="rotate(18 12 12)"/><path d="M4.5 10A8.5 8.5 0 0 1 18 6.5M18 3.5v3h-3"/>',
  ),
  Crosshairs: svgEsquematico(
    '<path d="M12 2v7.5M12 14.5V22M2 12h7.5M14.5 12H22"/><circle cx="12" cy="12" r="2.2"/>',
  ),

  // Medidas
  Length: svgEsquematico(
    '<path d="M5 19L19 5M3.5 16.5l4 4M16.5 3.5l4 4"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/>',
  ),
  OrthogonalLengths: svgEsquematico(
    '<path d="M3 12h18M3 9.5v5M21 9.5v5"/><path d="M12 4v16M9.5 4h5M9.5 20h5"/><path d="M12 8.5h3.5V12"/>',
  ),
  MidlineShift: svgEsquematico(
    '<path d="M10 3v18" stroke-dasharray="2.5 2.5"/><path d="M10 12h8M15.5 9.5L18 12l-2.5 2.5"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor"/>',
  ),
  LinearRatio: svgEsquematico(
    '<path d="M4 8h16M4 6v4M20 6v4"/><path d="M4 16h10M4 14v4M14 14v4"/>',
  ),
  StenosisRatio: svgEsquematico(
    '<path d="M3 6c4 0 5 3.5 9 3.5S17 6 21 6"/><path d="M3 18c4 0 5-3.5 9-3.5s5 3.5 9 3.5"/><path d="M12 9.5v5M6 6v12"/>',
  ),
  Angle: svgEsquematico(
    '<path d="M19 19H5L16 5"/><path d="M13 19a8 8 0 0 0-3.2-6.4"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/>',
  ),
  CobbAngleCustom: svgEsquematico(
    '<path d="M4 6l16 3M4 18l16-3"/><path d="M10 7.2l-1.5 9.6M13.5 10.5a4.5 4.5 0 0 1 0 3"/>',
  ),
  ReferenceAngle: svgEsquematico(
    '<path d="M3 18h18" stroke-dasharray="2.5 2.5"/><path d="M5 18L17 6"/><path d="M12.5 18a7.5 7.5 0 0 0-2.2-5.3"/>',
  ),
  ArrowCustom: svgEsquematico(
    '<path d="M19 5L7 17M7 10v7h7"/><circle cx="5" cy="19" r="1.5" fill="currentColor"/>',
  ),
  SphereVOI: svgEsquematico(
    '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3.2"/><ellipse cx="12" cy="12" rx="3.2" ry="8"/>',
  ),
  PetLesionVOI: svgEsquematico(
    '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.5 2.5"/><path d="M9 8.5c2-1.5 5.5-.8 6.2 1.8.8 2.5-1.2 5.2-3.7 5.5-2.6.3-4.8-1.8-4.3-4.3.2-1.3.8-2.2 1.8-3z" fill="currentColor" fill-opacity="0.35"/>',
  ),
  EllipticalROI: svgEsquematico(
    '<ellipse cx="12" cy="12" rx="8.5" ry="5.5"/><circle cx="12" cy="6.5" r="1.3" fill="currentColor"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/><circle cx="3.5" cy="12" r="1.3" fill="currentColor"/><circle cx="20.5" cy="12" r="1.3" fill="currentColor"/>',
  ),
  PlanarFreehandROI: svgEsquematico(
    '<path d="M6 9c1.5-3.5 6.5-4.5 10-2s4.5 7 1.5 10-8.5 3-11 0S4.5 12.5 6 9z"/>',
  ),
  Polyline: svgEsquematico(
    '<path d="M4 17l5-9 6 5 5-8"/><circle cx="4" cy="17" r="1.6" fill="currentColor"/><circle cx="9" cy="8" r="1.6" fill="currentColor"/><circle cx="15" cy="13" r="1.6" fill="currentColor"/><circle cx="20" cy="5" r="1.6" fill="currentColor"/>',
  ),

  // Segmentação
  SegPincel: svgEsquematico(
    '<path d="M18.5 3.5a2.1 2.1 0 0 1 3 3L11 17l-4 1 1-4 10.5-10.5z"/><path d="M4 20c1.5 0 3-1 3-2.5S5.8 15 4.5 15 2 16.2 2 18c0 1.1.9 2 2 2z"/>',
  ),
  SegPincelLimiar: svgEsquematico(
    '<path d="M4 7h16M8 4v6M4 16h16M15 13v6"/>',
  ),
  SegEsfera: svgEsquematico(
    '<circle cx="12" cy="12" r="8"/><path d="M6.5 9.5A6.5 6.5 0 0 1 15 6.5" stroke-dasharray="2 2"/><circle cx="9.5" cy="9.5" r="1.5" fill="currentColor"/>',
  ),
  PaintFill: svgEsquematico(
    '<path d="M11 4L4 11l7 7 7-7-7-7z"/><path d="M19.5 14.5c1.2 1.6 2 2.8 2 3.8a2 2 0 1 1-4 0c0-1 .8-2.2 2-3.8z" fill="currentColor"/>',
  ),
  SegBorracha: svgEsquematico(
    '<path d="M16 4l4 4-9 9H6l-3-3 13-10z"/><path d="M11 17h9"/>',
  ),
  CrescerRegiao: svgEsquematico(
    '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  ),
  SegVaso: svgEsquematico(
    '<path d="M5 19c4-4 5-8 7-14M12 13c2-2 4-3 7-3M10 15c-2-2-3-3-6-3"/><circle cx="12" cy="11" r="1.5" fill="currentColor"/>',
  ),

  // Ações
  'acao:mpr': svgEsquematico(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M12 12h9"/>',
  ),
  'acao:maximizar': svgEsquematico(
    '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ),
  'acao:inverter': svgEsquematico(
    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 20L20 4v14a2 2 0 0 1-2 2H4z" fill="currentColor"/>',
  ),
  'acao:girar90': svgEsquematico(
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 6v5h-5"/>',
  ),
  'acao:espelhar': svgEsquematico(
    '<path d="M12 3v18" stroke-dasharray="2.5 2.5"/><path d="M9 7l-6 5 6 5V7zM15 7l6 5-6 5V7z"/>',
  ),
  'acao:restaurar': svgEsquematico(
    '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  ),
  'acao:outraJanela': svgEsquematico(
    '<rect x="2.5" y="5" width="9" height="7" rx="1"/><rect x="12.5" y="11" width="9" height="7" rx="1"/><path d="M7 15c0 2 2 2.5 4.5 2.5M9.5 15.5l2 2-2 2"/>',
  ),
  'acao:limparMedidas': svgEsquematico(
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  ),

  // Janelas 1 a 6
  'janela:0': svgEsquematico(
    '<circle cx="12" cy="11" r="6"/><path d="M12 5a6 6 0 0 1 0 12z" fill="currentColor"/><circle cx="12" cy="20.5" r="1.3" fill="currentColor"/>',
  ),
  'janela:1': svgEsquematico(
    '<path d="M12 4v6M9 7c-3.5 0-5.5 3.5-5.5 8 0 2.5 1.5 4 3.5 4 1.8 0 3-1.2 3-3V8M15 7c3.5 0 5.5 3.5 5.5 8 0 2.5-1.5 4-3.5 4-1.8 0-3-1.2-3-3V8"/>',
  ),
  'janela:2': svgEsquematico(
    '<path d="M7 5a2.5 2.5 0 0 0-2 4l5 5a2.5 2.5 0 0 0 4 2 2.5 2.5 0 0 0 2-4l-5-5a2.5 2.5 0 0 0-4-2z"/>',
  ),
  'janela:3': svgEsquematico(
    '<circle cx="12" cy="11" r="6"/><path d="M12 5a6 6 0 0 1 0 12z" fill="currentColor"/><circle cx="8" cy="20.5" r="1.2" fill="currentColor"/><circle cx="12" cy="20.5" r="1.2" fill="currentColor"/><circle cx="16" cy="20.5" r="1.2" fill="currentColor"/>',
  ),
  'janela:4': svgEsquematico(
    '<ellipse cx="12" cy="12" rx="7.5" ry="6"/><path d="M12 6v12M7 9.5c2 .5 3 2 5 2s3-1.5 5-2"/>',
  ),
  'janela:5': svgEsquematico(
    '<path d="M12 19s-6.5-4.2-6.5-9A3.8 3.8 0 0 1 12 7.3 3.8 3.8 0 0 1 18.5 10c0 4.8-6.5 9-6.5 9z"/>',
  ),
};

export interface OpcaoFavoritoMenu {
  id: string;
  rotulo: string;
  grupo: string;
  svg: string;
  atalho?: string;
  marcado?: () => boolean;
  desabilitado?: () => boolean;
  acao: () => void;
}

export function iconeFavoritoMenu(id: string): string {
  return (
    ICONES_ESQUEMATICOS[id] ??
    svgEsquematico('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/>')
  );
}

/** Catálogo completo de funções que podem ocupar os 6 botões favoritos no topo do menu do botão direito. */
export function listarOpcoesFavoritosMenu(): OpcaoFavoritoMenu[] {
  const mpr = emModoMprFerramentas();
  const opcoes: OpcaoFavoritoMenu[] = [];

  for (const f of FERRAMENTAS_PRIMARIAS) {
    const tecla = teclaDaFerramenta(f).toUpperCase();
    const grupo =
      f.categoria === 'navegacao'
        ? 'Navegação'
        : f.categoria === 'medida'
          ? 'Medidas e ROIs'
          : 'Segmentação';
    opcoes.push({
      id: f.nome,
      rotulo: f.rotulo,
      grupo,
      svg: iconeFavoritoMenu(f.nome),
      ...(tecla ? { atalho: tecla } : {}),
      marcado: () => ferramentaPrimariaAtual() === f.nome,
      desabilitado: () => Boolean(f.apenasMpr && !emModoMprFerramentas()),
      acao: () => escolherFerramentaPrimaria(f.nome),
    });
  }

  opcoes.push(
    {
      id: 'acao:mpr',
      rotulo: mpr ? 'Sair do MPR (3 planos)' : 'MPR (3 planos)',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:mpr'),
      atalho: 'R',
      marcado: () => emModoMprFerramentas(),
      acao: () => void alternarMpr(),
    },
    {
      id: 'acao:maximizar',
      rotulo: 'Maximizar / restaurar quadro',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:maximizar'),
      atalho: 'F',
      acao: () => alternarMaximizado(),
    },
    {
      id: 'acao:inverter',
      rotulo: 'Inverter preto e branco',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:inverter'),
      atalho: 'I',
      acao: () => void inverter(),
    },
    {
      id: 'acao:girar90',
      rotulo: 'Girar 90°',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:girar90'),
      acao: () => void girar90(),
    },
    {
      id: 'acao:espelhar',
      rotulo: 'Espelhar horizontalmente',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:espelhar'),
      acao: () => void espelhar(),
    },
    {
      id: 'acao:restaurar',
      rotulo: 'Restaurar imagem',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:restaurar'),
      acao: () => void restaurar(),
    },
    {
      id: 'acao:outraJanela',
      rotulo: 'Enviar série para a 2ª janela',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:outraJanela'),
      desabilitado: () => !segundaJanelaDisponivel() || ehJanelaSecundaria() || !estado.pilhaAtiva,
      acao: () => {
        if (estado.pilhaAtiva) void enviarPilhaParaOutraJanela(estado.pilhaAtiva);
      },
    },
    {
      id: 'acao:limparMedidas',
      rotulo: 'Apagar todas as medidas',
      grupo: 'Visualização e imagem',
      svg: iconeFavoritoMenu('acao:limparMedidas'),
      acao: () => void limparMedidas(),
    },
  );

  const ehPet = petEmSuv(estado.pilhaAtiva);
  const janelas = predefinicoes();
  for (let i = 0; i < 6; i += 1) {
    const j = janelas[i];
    const tetoSuv = TETOS_SUV[i];
    const rotuloJanela = ehPet && tetoSuv !== undefined
      ? `Janela ${i + 1}: SUV 0 – ${tetoSuv}`
      : j
        ? `Janela ${i + 1}: ${j.rotulo} (${j.centro}/${j.largura})`
        : `Janela predefinida ${i + 1}`;
    opcoes.push({
      id: `janela:${i}`,
      rotulo: rotuloJanela,
      grupo: 'Janelas predefinidas',
      svg: iconeFavoritoMenu(`janela:${i}`),
      atalho: String(i + 1),
      acao: () => void aplicarPredefinicao(i),
    });
  }

  return opcoes;
}

function montarBarraFavoritos(): BarraIconesMenuFlutuante {
  const catalogo = listarOpcoesFavoritosMenu();
  const mapa = new Map(catalogo.map((o) => [o.id, o]));
  const ids = favoritosMenu();
  const botoes: BotaoIconeMenuFlutuante[] = [];
  for (let i = 0; i < TOTAL_FAVORITOS_MENU; i += 1) {
    const id = ids[i] ?? '';
    const op = mapa.get(id) ?? catalogo[i] ?? catalogo[0]!;
    const dica = op.atalho ? `${op.rotulo} (${op.atalho})` : op.rotulo;
    botoes.push({
      id: op.id,
      svg: op.svg,
      dica,
      marcado: Boolean(op.marcado?.()),
      desabilitado: Boolean(op.desabilitado?.()),
      acao: op.acao,
    });
  }
  return { tipo: 'barra-icones', botoes };
}

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
    {
      rotulo: 'Auto-janela neste corte',
      atalho: '0',
      acao: () => void autoJanelaCorteAtual(),
    },
    'divisor',
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
  const itens: EntradaMenuFlutuante[] = [montarBarraFavoritos(), 'divisor'];
  const selecionadas = anotacoes.selection
    .getAnnotationsSelected()
    .filter((uid) => anotacoes.state.getAnnotation(uid)?.metadata?.toolName !== 'Crosshairs').length;
  if (sobreMedida || selecionadas > 0) {
    itens.push(
      {
        rotulo: selecionadas > 1 ? `Copiar ${selecionadas} medidas` : 'Copiar medida',
        atalho: 'Ctrl+C',
        acao: () => void copiarMedidasSelecionadas(),
      },
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
    ...(segundaJanelaDisponivel() && !ehJanelaSecundaria() && estado.pilhaAtiva
      ? [
          {
            rotulo: 'Enviar para a outra janela',
            acao: () => {
              if (estado.pilhaAtiva) void enviarPilhaParaOutraJanela(estado.pilhaAtiva);
            },
          } satisfies EntradaMenuFlutuante,
        ]
      : []),
    'divisor',
    { rotulo: 'Apagar todas as medidas', acao: () => void limparMedidas() },
    { rotulo: 'Personalizar favoritos do topo…', acao: () => abrirConfiguracoes('interacao') },
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
