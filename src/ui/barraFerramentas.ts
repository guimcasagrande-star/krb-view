/**
 * Barra de ferramentas agrupada estilo RadiAnt:
 * - Botões divididos (ação principal + seta `▾` com menu suspenso) para Abrir (Pasta, Arquivo, ZIP),
 *   Dividir tela (1x1, 1x2, 2x2), Sincronização/Comparar, Anotações (A), Navegação,
 *   Janela/Nível + Presets, Medidas (Distância, Desvio de linha média, Ângulo, Seta, ROIs,
 *   Polilinha e Curva Tempo-Intensidade / Perfusão), Transformações, Cine, MPR, MIP 3D e 3D.
 */

import {
  aplicarPredefinicao,
  apagarSelecionadas,
  botaoAtribuido,
  type Botao,
  definirBotao,
  emModoMprFerramentas,
  espelhar,
  escolherFerramentaPrimaria,
  EVENTO_BOTOES_MUDARAM,
  ferramentaPrimariaAtual,
  FERRAMENTAS_PRIMARIAS,
  type FerramentaPrimaria,
  girar90,
  inverter,
  limparMedidas,
  OPCOES_LATERAIS,
  OPCOES_RODA,
  OPCOES_SECUNDARIAS,
  type OpcaoBotao,
  predefinicoes,
  restaurar,
  teclaDaFerramenta,
} from '../tools/grupo';
import {
  adicionarLinkRapido,
  EVENTO_PREFERENCIAS,
  preferencias,
  removerLinkRapido,
  restaurarLinksRapidos,
  salvarPreferencias,
  telas,
} from '../state/preferencias';
import { abrirLinkExterno, LINKS_RAPIDOS_PADRAO } from '../state/linksRapidos';
import { autoJanelaCorteAtual, copiarMedidasSelecionadas } from '../tools/utilidadesJanelaEMedidas';
import type { AbaConfiguracoes } from './configuracoes';

function abrirConfiguracoes(aba?: AbaConfiguracoes): void {
  void import('./configuracoes').then((m) => m.abrirConfiguracoes(aba));
}
import { iconeFavoritoMenu } from './menuContexto';
import { alternarAjuda } from '../tools/atalhos';
import { EVENTO_RECENTES, limparRecentes, listarRecentes } from '../state/recentes';
import { pacsDisponivel } from '../pacs/transporteTauri.ts';
import {
  abrirSegundaJanela,
  alternarOpcaoSincroniaJanelas,
  alternarTelaCheiaJanelaAtual,
  aplicarExibicaoJanelaAtual,
  aplicarPresetVisualizacao,
  ehJanelaSecundaria,
  EVENTO_SINCRONIA_JANELAS,
  notificarPreferenciasParaOutraJanela,
  obterOpcoesSincroniaJanelas,
  segundaJanelaDisponivel,
} from '../viewer/segundaJanela';
import type { AbaPacs } from './buscarPacs';

async function exportarImagemAtiva(formato: 'png' | 'jpeg'): Promise<string | null> {
  const { exportarImagemAtiva: exportar } = await import('./exportarImagem');
  return exportar(formato);
}

function abrirExportarExame(): void {
  void import('./exportarExame').then((m) => m.abrirExportarExame());
}

function abrirBuscarPacs(aba: AbaPacs = 'buscar'): void {
  void import('./buscarPacs').then((m) => m.abrirBuscarPacs(aba));
}

function abrirExamesBaixadosPacs(): void {
  void import('./buscarPacs').then((m) => m.abrirExamesBaixadosPacs());
}

function abrirServidoresPacs(): void {
  void import('./servidoresPacs').then((m) => m.abrirServidoresPacs());
}
import {
  emModoSegmentacao,
  EVENTO_MODO_SEGMENTACAO,
  FERRAMENTAS_SEGMENTACAO,
} from '../segmentation/ferramentas';
import { alternarModoSegmentacaoBarra } from './painelSegmentos';
import {
  dispararAbrirArquivos,
  dispararAbrirPasta,
  dispararAbrirRecente,
  dispararAbrirZip,
  dispararLimparLista,
} from './abrirPasta';
import { VELOCIDADES_CINE } from '../viewer/cine';
import { alternarOverlay } from '../viewer/overlay';
import {
  abrirCurvaPerfusaoAtiva,
  alternarCadeadoRolagemComparar,
  alternarCine,
  alternarMipRotatorio,
  alternar3d,
  alternarModoComparar,
  compararPetCt,
  abrirLayoutComparacaoPetCt,
  alternarMpr,
  alternarSincronizacaoJanelaComparar,
  alternarSincronizacaoZoomPanComparar,
  definirFiltroImagemAtivo,
  definirLayout,
  definirModoSlabAtivo,
  definirPlanoSlotAtivo,
  definirSlabMpr,
  definirVelocidadeCine,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  GRADE_MAXIMA,
  geometriaLayout,
  idLayout,
  obterLayoutAtual,
  alternarMaximizado,
  alternarSincroniaEstudo,
  alternarLinhasReferencia,
  abrirLayoutPet,
  limparMirasLocalizador,
  type ModoSlab,
  type PlanoSlot,
  proximoLayout,
  zerarVinculoRolagemComparar,
} from '../viewer/viewport2d';
import {
  FILTRO_IMAGEM_MAX,
  FILTRO_IMAGEM_MIN,
  FILTRO_IMAGEM_PASSO,
  PRESETS_FILTRO_IMAGEM,
  rotuloBotaoFiltroImagem,
  rotuloFiltroImagem,
} from '../viewer/filtroImagem';

function svgBarra(conteudo: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${conteudo}</svg>`;
}

const ICONES_BARRA = {
  lateral: svgBarra('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  abrir: svgBarra(
    '<path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z"/>',
  ),
  pacs: svgBarra(
    '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="17" r="1" fill="currentColor"/><path d="M12 7h6M12 17h6"/>',
  ),
  grade: svgBarra('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>'),
  petct: svgBarra(
    '<circle cx="12" cy="12" r="3"/><path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M7 7L5.5 5.5M18.5 18.5L17 17M17 7l1.5-1.5M5.5 18.5L7 17"/><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>',
  ),
  linhas: svgBarra(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18" stroke-dasharray="3 2"/><path d="M12 4v16"/>',
  ),
  comparar: svgBarra(
    '<rect x="2" y="5" width="8" height="14" rx="1.5"/><rect x="14" y="5" width="8" height="14" rx="1.5"/><path d="M10 10h4M10 14h4"/>',
  ),
  cadeadoFechado: svgBarra(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  ),
  cadeadoAberto: svgBarra(
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.4-2"/>',
  ),
  zerar: svgBarra('<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5"/>'),
  segundaTela: svgBarra(
    '<rect x="2" y="4" width="11" height="8" rx="1"/><rect x="11" y="10" width="11" height="8" rx="1"/><path d="M6 15h3M15 20.5h5"/>',
  ),
  texto: svgBarra(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 8h4M6 11h3M15 8h3M6 16h4M15 16h3"/>',
  ),
  mouse: svgBarra('<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7M6 10h12"/>'),
  cinePlay: svgBarra('<polygon points="7,5 19,12 7,19" fill="currentColor"/>'),
  cinePause: svgBarra(
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
  ),
  mip3d: svgBarra('<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="3.5" ry="8"/>'),
  cubo3d: svgBarra(
    '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  ),
  config: svgBarra(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.05 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  ),
  ajuda: svgBarra(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/>',
  ),
};

const ICONES_MENU = {
  pasta: svgBarra(
    '<path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z"/>',
  ),
  arquivo: svgBarra(
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  ),
  zip: svgBarra(
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 3v18M10 7h4M10 11h4M10 15h4"/>',
  ),
  limpar: svgBarra(
    '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  ),
  historico: svgBarra('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  imagem: svgBarra(
    '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor"/><path d="M21 16l-5-5-6 6-2.5-2.5L3 19"/>',
  ),
  baixados: svgBarra(
    '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  ),
  buscar: svgBarra('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
  servidor: svgBarra(
    '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="17" r="1" fill="currentColor"/>',
  ),
  maximizarVp: svgBarra(
    '<path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6"/>',
  ),
  salvar: svgBarra(
    '<path d="M5 20V4h11l3 3v13z"/><path d="M8 4v5h7V4"/>',
  ),
  adicionar: svgBarra('<path d="M12 5v14M5 12h14"/>'),
  config: ICONES_BARRA.config,
  petCt: ICONES_BARRA.petct,
  comparar: ICONES_BARRA.comparar,
  rolagem: svgBarra('<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>'),
  linhas: svgBarra('<path d="M3 12h18M12 3v18" stroke-dasharray="3 2.5"/>'),
  janelaNivel: svgBarra(
    '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  ),
  zoomPan: svgBarra('<circle cx="10.5" cy="10.5" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  zerar: ICONES_BARRA.zerar,
  estudo: svgBarra('<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>'),
  segundaJanela: svgBarra(
    '<rect x="2.5" y="5" width="12" height="14" rx="1.5"/><rect x="16.5" y="7" width="5" height="10" rx="1"/>',
  ),
  localizador: svgBarra(
    '<circle cx="12" cy="12" r="5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  ),
  padraoRapido: svgBarra(
    '<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>',
  ),
  maximizada: svgBarra('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 8h18"/>'),
  autoAbrir: svgBarra(
    '<path d="M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10M8 20h8"/>',
  ),
  telaCheia: svgBarra(
    '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  ),
  perfusao: svgBarra('<path d="M3 19h18M4 16l4-5 4 2 4-7 4 4"/>'),
  velocidade: svgBarra('<circle cx="12" cy="12" r="8"/><path d="M12 12l4-4M12 7v1"/>'),
};

const ICONES_BOTAO_MOUSE: Record<Botao, string> = {
  esquerdo: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7H6A6 6 0 0 1 12 3z" fill="#00E5FF"/>',
  ),
  direito: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7h6A6 6 0 0 0 12 3z" fill="#00E5FF"/>',
  ),
  meio: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="10.6" y="4.5" width="2.8" height="5.2" rx="1" fill="#00E5FF"/>',
  ),
  roda: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 4.2v5.8" stroke="#00E5FF" stroke-width="2.6"/>',
  ),
  voltar: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="3.5" y="11.2" width="2.6" height="4.2" rx="1" fill="#00E5FF"/>',
  ),
  avancar: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="3.5" y="6.4" width="2.6" height="4.2" rx="1" fill="#00E5FF"/>',
  ),
};

const LEGENDAS_CURTAS_FERRAMENTA: Record<string, string> = {
  StackScroll: 'Cortes',
  WindowLevel: 'Janela',
  Pan: 'Mover',
  Zoom: 'Zoom',
  Localizador3D: 'Localizar',
  GirarPlano: 'Inclinar',
  Crosshairs: 'Eixos',
  Length: 'Distância',
  OrthogonalLengths: 'Ortogonal',
  EllipsoidVolume: 'Vol. Elips.',
  MidlineShift: 'Desvio',
  LinearRatio: 'Proporção',
  StenosisRatio: 'Estenose',
  Angle: 'Ângulo',
  CobbAngleCustom: 'Cobb',
  ReferenceAngle: 'Âng. Eixo',
  ArrowCustom: 'Seta',
  SphereVOI: 'Esfera 3D',
  PetLesionVOI: 'Lesão PET',
  EllipticalROI: 'Elipse',
  PlanarFreehandROI: 'Mão livre',
  Polyline: 'Polilinha',
  SegPincel: 'Pincel',
  SegBorracha: 'Corrigir',
  SegVaso: 'Vasos',
};

function definirConteudoBotaoBarra(b: HTMLButtonElement, svg: string, legenda: string): void {
  b.classList.add('btn-barra-esquematico');
  b.innerHTML = `<span class="icone-barra">${svg}</span><span class="legenda-barra">${legenda}</span>`;
}

function botao(legenda: string, dica: string, acao: () => void, svg?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (svg) {
    definirConteudoBotaoBarra(b, svg, legenda);
  } else {
    b.textContent = legenda;
  }
  b.title = dica;
  b.addEventListener('click', acao);
  return b;
}

function separador(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'separador';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function formatarMm(mm: number): string {
  return `${mm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
}

function formatarDeslocamentoMm(mm: number): string {
  const sinal = mm > 0 ? '+' : '';
  return `Δ ${sinal}${mm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
}

const OPCOES_PLANO: Array<{ valor: PlanoSlot; rotulo: string }> = [
  { valor: 'original', rotulo: 'Original' },
  { valor: 'axial', rotulo: 'Axial' },
  { valor: 'coronal', rotulo: 'Coronal' },
  { valor: 'sagital', rotulo: 'Sagital' },
  { valor: 'mip-rotatorio', rotulo: 'MIP rotatório' },
  { valor: '3d', rotulo: '3D' },
];

const OPCOES_MODO_SLAB: Array<{ valor: ModoSlab; rotulo: string }> = [
  { valor: 'normal', rotulo: 'Normal' },
  { valor: 'mip', rotulo: 'MIP' },
  { valor: 'minip', rotulo: 'MinIP' },
  { valor: 'media', rotulo: 'Média' },
];

const todosMenusAbertos = new Set<HTMLElement>();

function fecharTodosMenus(exceto?: HTMLElement): void {
  for (const m of todosMenusAbertos) {
    if (m !== exceto) m.hidden = true;
  }
}

/**
 * Cria um controle com menu suspenso (`▾`):
 * - Se `acaoPrincipal` for passada, renderiza um botão dividido (`[Botão principal][▾]`).
 * - Caso contrário, clicar no próprio botão abre/fecha o menu.
 */
function criarMenuSuspenso(opcoes: {
  rotulo: string;
  svg?: string;
  dica: string;
  acaoPrincipal?: () => void;
}): {
  contentor: HTMLDivElement;
  botaoPrincipal: HTMLButtonElement;
  botaoSeta: HTMLButtonElement;
  painel: HTMLDivElement;
  fechar: () => void;
} {
  const contentor = document.createElement('div');
  contentor.className = 'menu-suspenso';

  const botaoPrincipal = document.createElement('button');
  botaoPrincipal.type = 'button';
  botaoPrincipal.className = 'btn-menu-principal';
  botaoPrincipal.title = opcoes.dica;

  const botaoSeta = document.createElement('button');
  botaoSeta.type = 'button';
  botaoSeta.className = 'btn-menu-seta';
  botaoSeta.textContent = '▾';
  botaoSeta.title = `Mais opções de ${opcoes.rotulo}`;

  const painel = document.createElement('div');
  painel.className = 'painel-menu-suspenso';
  painel.hidden = true;
  todosMenusAbertos.add(painel);

  const alternarPainel = (e: MouseEvent) => {
    e.stopPropagation();
    const abrir = painel.hidden;
    fecharTodosMenus(painel);
    painel.hidden = !abrir;
    if (abrir) {
      painel.classList.remove('alinhar-direita');
      painel.style.left = '';
      painel.style.right = '';
      const rect = painel.getBoundingClientRect();
      if (rect.right > window.innerWidth - 8) {
        painel.classList.add('alinhar-direita');
      }
      const rectAjustado = painel.getBoundingClientRect();
      if (rectAjustado.left < 8) {
        painel.classList.remove('alinhar-direita');
        const cRect = contentor.getBoundingClientRect();
        painel.style.left = `${8 - cRect.left}px`;
      }
    }
  };

  if (opcoes.acaoPrincipal) {
    if (opcoes.svg) {
      definirConteudoBotaoBarra(botaoPrincipal, opcoes.svg, opcoes.rotulo);
    } else {
      botaoPrincipal.textContent = opcoes.rotulo;
    }
    botaoPrincipal.addEventListener('click', () => {
      fecharTodosMenus();
      opcoes.acaoPrincipal!();
    });
    botaoSeta.addEventListener('click', alternarPainel);
    contentor.append(botaoPrincipal, botaoSeta, painel);
  } else {
    if (opcoes.svg) {
      definirConteudoBotaoBarra(botaoPrincipal, opcoes.svg, `${opcoes.rotulo} ▾`);
    } else {
      botaoPrincipal.textContent = `${opcoes.rotulo} ▾`;
    }
    botaoPrincipal.addEventListener('click', alternarPainel);
    contentor.append(botaoPrincipal, painel);
  }

  painel.addEventListener('click', (e) => e.stopPropagation());

  return {
    contentor,
    botaoPrincipal,
    botaoSeta,
    painel,
    fechar: () => {
      painel.hidden = true;
    },
  };
}

interface OpcoesItemMenu {
  svg?: string;
  badge?: string;
  badgeAzul?: boolean;
  switchPill?: boolean;
  check?: boolean;
  destaque?: boolean;
}

function secaoMenu(texto: string, destaque = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = destaque ? 'secao-menu secao-destaque' : 'secao-menu';
  div.textContent = texto;
  return div;
}

function itemMenu(
  rotulo: string,
  atalho: string | undefined,
  acao: () => void,
  fecharMenu: () => void,
  extra?: string | OpcoesItemMenu,
): HTMLButtonElement {
  const opcoes: OpcoesItemMenu = typeof extra === 'string' ? { svg: extra } : (extra ?? {});
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-menu-suspenso';
  if (opcoes.destaque) b.classList.add('item-menu-destaque');
  if (opcoes.switchPill) {
    b.classList.add('item-menu-switch');
    b.setAttribute('aria-pressed', 'false');
  }
  if (opcoes.check) b.classList.add('item-menu-check');

  const spanEsquerda = document.createElement('span');
  spanEsquerda.className = 'item-menu-rotulo';
  if (opcoes.svg) {
    const ic = document.createElement('span');
    ic.className = 'icone-item-menu';
    ic.innerHTML = opcoes.svg;
    spanEsquerda.append(ic);
  }
  const spanTexto = document.createElement('span');
  spanTexto.textContent = rotulo;
  spanEsquerda.append(spanTexto);
  b.append(spanEsquerda);

  const temBadge = Boolean(opcoes.badge);
  const temAtalho = Boolean(atalho);
  if (temBadge || temAtalho || opcoes.switchPill || opcoes.check) {
    const direito = document.createElement('span');
    direito.className = 'item-menu-direito';
    if (opcoes.badge) {
      const badge = document.createElement('span');
      badge.className = opcoes.badgeAzul ? 'badge-menu badge-azul' : 'badge-menu';
      badge.textContent = opcoes.badge;
      direito.append(badge);
    }
    if (atalho) {
      const kbd = document.createElement('kbd');
      kbd.textContent = atalho;
      direito.append(kbd);
    }
    if (opcoes.switchPill) {
      const sw = document.createElement('span');
      sw.className = 'switch-pill';
      sw.setAttribute('aria-hidden', 'true');
      direito.append(sw);
    }
    if (opcoes.check) {
      const chk = document.createElement('span');
      chk.className = 'check-menu';
      chk.setAttribute('aria-hidden', 'true');
      chk.textContent = '✓';
      direito.append(chk);
    }
    b.append(direito);
  }

  b.addEventListener('click', () => {
    fecharMenu();
    acao();
  });
  return b;
}

function divisorMenu(): HTMLHRElement {
  const hr = document.createElement('hr');
  hr.className = 'divisor-menu';
  return hr;
}

/** Monta a barra dentro de `contentor` (o #ferramentas do index.html). */
export function iniciarBarraFerramentas(contentor: HTMLElement): void {
  contentor.replaceChildren();

  const btnLateral = document.getElementById('btn-lateral') as HTMLButtonElement | null;
  if (btnLateral) {
    definirConteudoBotaoBarra(btnLateral, ICONES_BARRA.lateral, 'Exames');
  }

  document.addEventListener('click', () => fecharTodosMenus());

  // 1. Menu Abrir (Pasta, Arquivos DICOM, Arquivo ZIP, Limpar lista)
  const menuAbrir = criarMenuSuspenso({
    rotulo: 'Abrir',
    svg: ICONES_BARRA.abrir,
    dica: 'Abrir pasta DICOM (Ctrl+Shift+O) ou escolher arquivo/ZIP na seta ao lado',
    acaoPrincipal: () => dispararAbrirPasta(),
  });
  menuAbrir.contentor.classList.add('menu-abrir-primario');
  menuAbrir.painel.append(
    itemMenu('Abrir pasta DICOM…', 'Ctrl+Shift+O', () => dispararAbrirPasta(), menuAbrir.fechar, ICONES_MENU.pasta),
    itemMenu('Abrir arquivos DICOM…', 'Ctrl+O', () => dispararAbrirArquivos(), menuAbrir.fechar, ICONES_MENU.arquivo),
    itemMenu('Abrir arquivo ZIP…', undefined, () => dispararAbrirZip(), menuAbrir.fechar, ICONES_MENU.zip),
    divisorMenu(),
    itemMenu('Limpar lista de exames', undefined, () => dispararLimparLista(), menuAbrir.fechar, ICONES_MENU.limpar),
  );
  // Pastas recentes (só a referência da pasta) e exportação da imagem.
  const secaoRecentes = document.createElement('div');
  menuAbrir.painel.append(secaoRecentes);
  const montarRecentes = async (): Promise<void> => {
    const lista = await listarRecentes();
    secaoRecentes.replaceChildren();
    if (lista.length === 0) return;
    secaoRecentes.append(divisorMenu(), secaoMenu('Pastas recentes'));
    for (const r of lista) {
      secaoRecentes.append(
        itemMenu(r.nome, undefined, () => dispararAbrirRecente(r.handle), menuAbrir.fechar, ICONES_MENU.historico),
      );
    }
    secaoRecentes.append(
      itemMenu('Limpar pastas recentes', undefined, () => void limparRecentes(), menuAbrir.fechar, ICONES_MENU.limpar),
    );
  };
  void montarRecentes();
  document.addEventListener(EVENTO_RECENTES, () => void montarRecentes());
  const exportar = async (formato: 'png' | 'jpeg'): Promise<void> => {
    const erro = await exportarImagemAtiva(formato);
    if (erro) window.alert(erro);
  };
  let menuPacs: ReturnType<typeof criarMenuSuspenso> | null = null;
  if (pacsDisponivel()) {
    menuPacs = criarMenuSuspenso({
      rotulo: 'PACS',
      svg: ICONES_BARRA.pacs,
      dica: 'Abrir lista de exames já baixados do PACS ou buscar novos exames no servidor PACS',
      acaoPrincipal: () => abrirExamesBaixadosPacs(),
    });
    menuPacs.painel.append(
      itemMenu('Exames já baixados…', undefined, () => abrirExamesBaixadosPacs(), menuPacs.fechar, {
        svg: ICONES_MENU.baixados,
        destaque: true,
      }),
      itemMenu('Buscar novos exames no PACS…', 'Ctrl+F', () => abrirBuscarPacs('buscar'), menuPacs.fechar, ICONES_MENU.buscar),
      divisorMenu(),
      itemMenu('Configurar servidores PACS…', undefined, () => abrirServidoresPacs(), menuPacs.fechar, ICONES_MENU.servidor),
    );
  }
  menuAbrir.painel.append(
    divisorMenu(),
    secaoMenu('Exportar'),
    itemMenu('Exportar exame (DICOMDIR / JPEG)…', undefined, () => abrirExportarExame(), menuAbrir.fechar, {
      svg: ICONES_MENU.pasta,
      destaque: true,
    }),
    itemMenu('Exportar viewport em PNG', undefined, () => void exportar('png'), menuAbrir.fechar, {
      svg: ICONES_MENU.imagem,
      badge: 'PNG',
    }),
    itemMenu('Exportar viewport em JPEG', undefined, () => void exportar('jpeg'), menuAbrir.fechar, {
      svg: ICONES_MENU.imagem,
      badge: 'JPEG',
    }),
  );


  // 2. Dividir tela (Split screen: 1x1, 1x2, 2x2) + Anotações (A) + Comparar (🔗)
  const grupoTela = document.createElement('div');
  grupoTela.className = 'grupo-botoes';

  const menuLayout = criarMenuSuspenso({
    rotulo: '1x1',
    svg: ICONES_BARRA.grade,
    dica: 'Alternar divisão de tela (F4)',
    acaoPrincipal: () => void proximoLayout(),
  });
  // Seletor de grade: passe o mouse sobre os quadradinhos e clique para escolher linhas x colunas.
  const seletorGrade = document.createElement('div');
  seletorGrade.className = 'seletor-grade';
  const gradeInfo = document.createElement('div');
  gradeInfo.className = 'grade-info-menu';
  const gradeTitulo = document.createElement('strong');
  const gradeSub = document.createElement('small');
  gradeInfo.append(gradeTitulo, gradeSub);

  const quadrados: HTMLButtonElement[] = [];
  const mostrarInfoGrade = (linhas: number, colunas: number): void => {
    const g = linhas > 0 ? { linhas, colunas } : geometriaLayout(obterLayoutAtual());
    const total = g.linhas * g.colunas;
    gradeTitulo.textContent = `${g.linhas} × ${g.colunas}`;
    gradeSub.textContent = total === 1 ? '1 viewport' : `${total} viewports`;
  };
  const marcarGrade = (linhas: number, colunas: number): void => {
    for (const q of quadrados) {
      q.classList.toggle('marcado', Number(q.dataset.l) <= linhas && Number(q.dataset.c) <= colunas);
    }
    mostrarInfoGrade(linhas, colunas);
  };
  const areaQuadrados = document.createElement('div');
  areaQuadrados.className = 'quadrados-grade';
  for (let l = 1; l <= GRADE_MAXIMA; l++) {
    for (let c = 1; c <= GRADE_MAXIMA; c++) {
      const q = document.createElement('button');
      q.type = 'button';
      q.dataset.l = String(l);
      q.dataset.c = String(c);
      q.title = `${l}×${c}`;
      q.setAttribute('aria-label', `Grade ${l} por ${c}`);
      q.addEventListener('mouseenter', () => marcarGrade(l, c));
      q.addEventListener('focus', () => marcarGrade(l, c));
      q.addEventListener('click', () => {
        void definirLayout(idLayout(l, c));
        menuLayout.fechar();
      });
      quadrados.push(q);
      areaQuadrados.append(q);
    }
  }
  areaQuadrados.addEventListener('mouseleave', () => {
    const atual = geometriaLayout(obterLayoutAtual());
    marcarGrade(atual.linhas, atual.colunas);
  });
  {
    const atual = geometriaLayout(obterLayoutAtual());
    marcarGrade(atual.linhas, atual.colunas);
  }
  seletorGrade.append(areaQuadrados, gradeInfo);
  const botaoLinhasRef = botao(
    'Linhas',
    'Linhas de referência: mostra nos outros viewports onde o corte do viewport ativo cruza (quando há planos diferentes)',
    () => alternarLinhasReferencia(),
    ICONES_BARRA.linhas,
  );
  const blocoPresetsGrade = document.createElement('div');
  blocoPresetsGrade.className = 'chips-preset-menu';
  const nadaMenuLayout = (): void => {};
  const itemFixarGradeAtual = itemMenu(
    'Definir como padrão ao iniciar',
    undefined,
    () => {
      const atual = obterLayoutAtual();
      const tl = telas();
      if (ehJanelaSecundaria()) {
        tl.gradeSecundaria = atual;
      } else {
        tl.gradePrincipal = atual;
      }
      salvarPreferencias();
      notificarPreferenciasParaOutraJanela();
      atualizarMenuPresetsGrade();
    },
    nadaMenuLayout,
    { svg: ICONES_MENU.salvar, check: true },
  );
  const itemSalvarPresetNoMenu = itemMenu(
    'Salvar disposição atual…',
    undefined,
    () => {
      const atual = obterLayoutAtual();
      const tl = telas();
      if (ehJanelaSecundaria()) {
        tl.gradeSecundaria = atual;
      } else {
        tl.gradePrincipal = atual;
      }
      const rotuloNovo = segundaJanelaDisponivel()
        ? `${tl.gradePrincipal} + ${tl.gradeSecundaria}`
        : `Grade ${atual}`;
      const jaExiste = tl.presets.find(
        (p) =>
          p.gradePrincipal === tl.gradePrincipal &&
          p.gradeSecundaria === tl.gradeSecundaria &&
          p.usarSegundaJanela === segundaJanelaDisponivel(),
      );
      if (!jaExiste && tl.presets.length < 12) {
        tl.presets.unshift({
          id: `preset-${Date.now()}`,
          rotulo: rotuloNovo,
          gradePrincipal: tl.gradePrincipal,
          usarSegundaJanela: segundaJanelaDisponivel(),
          gradeSecundaria: tl.gradeSecundaria,
        });
      }
      salvarPreferencias();
      notificarPreferenciasParaOutraJanela();
      atualizarMenuPresetsGrade();
    },
    nadaMenuLayout,
    ICONES_MENU.adicionar,
  );
  const atualizarMenuPresetsGrade = (): void => {
    blocoPresetsGrade.replaceChildren();
    const tl = telas();
    const sec = ehJanelaSecundaria();
    const atual = obterLayoutAtual();
    const padraoDesta = sec ? tl.gradeSecundaria : tl.gradePrincipal;
    const jaSalva = atual === padraoDesta;
    itemFixarGradeAtual.setAttribute('aria-pressed', String(jaSalva));
    const spanFixar = itemFixarGradeAtual.querySelector('.item-menu-rotulo > span:last-child');
    if (spanFixar) {
      const atualBonito = atual.replace('x', '×');
      spanFixar.textContent = jaSalva
        ? `Padrão ${atualBonito} ativo`
        : `Definir ${atualBonito} como padrão`;
    }
    const atualGeom = geometriaLayout(atual);
    marcarGrade(atualGeom.linhas, atualGeom.colunas);

    for (const p of tl.presets) {
      if (p.usarSegundaJanela && !segundaJanelaDisponivel()) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip-preset';
      const gp = p.gradePrincipal.replace('x', '×');
      const gs = p.gradeSecundaria.replace('x', '×');
      const ehPresetPadrao =
        p.gradePrincipal === tl.gradePrincipal &&
        (!p.usarSegundaJanela || p.gradeSecundaria === tl.gradeSecundaria);
      chip.textContent = `${p.usarSegundaJanela ? `${gp} + ${gs}` : gp}${ehPresetPadrao ? ' ★' : ''}`;
      chip.title = p.rotulo;
      chip.setAttribute('aria-pressed', String(ehPresetPadrao));
      chip.addEventListener('click', () => {
        void aplicarPresetVisualizacao(p);
        menuLayout.fechar();
      });
      blocoPresetsGrade.append(chip);
    }
  };
  atualizarMenuPresetsGrade();
  document.addEventListener(EVENTO_PREFERENCIAS, atualizarMenuPresetsGrade);

  menuLayout.painel.append(
    seletorGrade,
    itemMenu('Maximizar viewport', 'F', () => alternarMaximizado(), menuLayout.fechar, ICONES_MENU.maximizarVp),
    divisorMenu(),
    secaoMenu('Grades salvas'),
    blocoPresetsGrade,
    itemFixarGradeAtual,
    itemSalvarPresetNoMenu,
    divisorMenu(),
    itemMenu(
      'Monitores e grades…',
      undefined,
      () => abrirConfiguracoes('telas'),
      menuLayout.fechar,
      ICONES_MENU.config,
    ),
  );

  // Menu próprio dos layouts de PET/CT (separado da escolha de grade).
  const menuPetCt = criarMenuSuspenso({
    rotulo: 'PET/CT',
    svg: ICONES_BARRA.petct,
    dica: 'Layouts de PET/CT: PET, TC e fusão (o par vem da série aberta)',
    acaoPrincipal: () => void abrirLayoutPet(4),
  });
  menuPetCt.painel.append(
    secaoMenu('Layouts PET/CT'),
    itemMenu('MIP 3D, PET, TC e Fusão', undefined, () => void abrirLayoutPet(4), menuPetCt.fechar, {
      svg: ICONES_MENU.petCt,
      badge: '4 campos',
    }),
    itemMenu('PET, TC e Fusão', undefined, () => void abrirLayoutPet(3), menuPetCt.fechar, {
      svg: ICONES_MENU.petCt,
      badge: '3 campos',
    }),
    divisorMenu(),
    itemMenu('Comparação atual × anterior', undefined, () => void abrirLayoutComparacaoPetCt(), menuPetCt.fechar, {
      svg: ICONES_MENU.comparar,
      badge: '6 campos',
    }),
    itemMenu('Comparar fusões lado a lado', undefined, () => void compararPetCt(), menuPetCt.fechar, ICONES_MENU.comparar),
  );

  const nadaComparar = (): void => {};
  const menuComparar = criarMenuSuspenso({
    rotulo: 'Comparar',
    svg: ICONES_BARRA.comparar,
    dica: 'Modo Comparar: dois exames lado a lado (ATUAL × ANTERIOR) com rolagem sincronizada',
    acaoPrincipal: () => void alternarModoComparar(),
  });
  const itemCadeadoMenu = itemMenu(
    'Rolagem por posição',
    undefined,
    () => alternarCadeadoRolagemComparar(),
    nadaComparar,
    { svg: ICONES_MENU.rolagem, switchPill: true },
  );
  const itemJanelaMenu = itemMenu(
    'Janela e nível',
    undefined,
    () => alternarSincronizacaoJanelaComparar(),
    nadaComparar,
    { svg: ICONES_MENU.janelaNivel, switchPill: true },
  );
  const itemZoomMenu = itemMenu(
    'Zoom e pan',
    undefined,
    () => alternarSincronizacaoZoomPanComparar(),
    nadaComparar,
    { svg: ICONES_MENU.zoomPan, switchPill: true },
  );
  const itemZerarMenu = itemMenu(
    'Zerar deslocamento entre exames',
    undefined,
    () => zerarVinculoRolagemComparar(),
    menuComparar.fechar,
    ICONES_MENU.zerar,
  );
  const itemSincEstudo = itemMenu(
    'Sincronizar séries do estudo',
    undefined,
    () => alternarSincroniaEstudo(),
    nadaComparar,
    { svg: ICONES_MENU.estudo, switchPill: true },
  );
  menuComparar.painel.append(
    itemMenu('Ativar ou sair do Comparar', undefined, () => void alternarModoComparar(), menuComparar.fechar, {
      svg: ICONES_MENU.comparar,
      destaque: true,
    }),
    itemSincEstudo,
    divisorMenu(),
    secaoMenu('Sincronia'),
    itemCadeadoMenu,
    itemJanelaMenu,
    itemZoomMenu,
    divisorMenu(),
    itemZerarMenu,
  );

  // Controles rápidos visíveis quando o modo Comparar está ativo:
  const grupoCompararInline = document.createElement('div');
  grupoCompararInline.className = 'grupo-botoes controles-comparar';
  grupoCompararInline.hidden = true;
  const botaoCadeadoRolagem = botao(
    'Rolagem',
    'Ligar ou desligar o vínculo de rolagem por posição (ao religar, recalcula o deslocamento pelos cortes atuais)',
    () => alternarCadeadoRolagemComparar(),
    ICONES_BARRA.cadeadoFechado,
  );
  const rotuloOffsetComparar = document.createElement('span');
  rotuloOffsetComparar.className = 'offset-comparar';
  rotuloOffsetComparar.title = 'Deslocamento atual entre os referenciais dos dois exames';
  const botaoZerarOffset = botao(
    'Zerar',
    'Restaurar o alinhamento inicial automático entre os dois exames',
    () => zerarVinculoRolagemComparar(),
    ICONES_BARRA.zerar,
  );
  grupoCompararInline.append(botaoCadeadoRolagem, rotuloOffsetComparar, botaoZerarOffset);

  const botaoOverlay = botao(
    'Texto',
    'Mostrar ou esconder textos e informações nos cantos da imagem (tecla O)',
    () => alternarOverlay(),
    ICONES_BARRA.texto,
  );

  const secundaria = ehJanelaSecundaria();
  let menuSegundaJanela: ReturnType<typeof criarMenuSuspenso> | null = null;
  if (segundaJanelaDisponivel()) {
    const mSeg = criarMenuSuspenso({
      rotulo: '2ª Tela',
      svg: ICONES_BARRA.segundaTela,
      dica: secundaria
        ? 'Opções de sincronia com a janela principal'
        : 'Abrir a segunda janela para outro monitor; a seta ao lado liga/desliga cada sincronia entre as janelas',
      acaoPrincipal: () => {
        if (!secundaria) {
          void abrirSegundaJanela();
        }
      },
    });
    menuSegundaJanela = mSeg;
    if (!secundaria) {
      mSeg.painel.append(
        itemMenu(
          'Abrir ou focar 2ª janela',
          undefined,
          () => void abrirSegundaJanela(),
          mSeg.fechar,
          { svg: ICONES_MENU.segundaJanela, badge: '2º monitor', badgeAzul: true, destaque: true },
        ),
      );
    }
    const nada = (): void => {};
    const itemSincRolagemJanela = itemMenu(
      'Rolagem por posição',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('rolagem');
      },
      nada,
      { svg: ICONES_MENU.rolagem, switchPill: true },
    );
    const itemSincLinhasJanela = itemMenu(
      'Linhas de referência',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('linhas');
      },
      nada,
      { svg: ICONES_MENU.linhas, switchPill: true },
    );
    const itemSincVoiJanela = itemMenu(
      'Janela e nível',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('janela');
      },
      nada,
      { svg: ICONES_MENU.janelaNivel, switchPill: true },
    );
    const itemSincLocJanela = itemMenu(
      'Localizador 3D',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('localizador');
      },
      nada,
      { svg: ICONES_MENU.localizador, switchPill: true },
    );
    const itemSempreTelaToda = itemMenu(
      'Sempre abrir maximizada',
      undefined,
      () => {
        const tl = telas();
        if (secundaria) {
          tl.modoTelaSecundaria = tl.modoTelaSecundaria === 'maximizada' ? 'normal' : 'maximizada';
        } else {
          tl.modoTelaPrincipal = tl.modoTelaPrincipal === 'maximizada' ? 'normal' : 'maximizada';
        }
        salvarPreferencias();
        notificarPreferenciasParaOutraJanela();
        void aplicarExibicaoJanelaAtual();
      },
      nada,
      { svg: ICONES_MENU.maximizada, switchPill: true },
    );
    const itemAlternarTelaCheia = itemMenu(
      'Tela cheia sem bordas',
      'Shift+F11',
      () => void alternarTelaCheiaJanelaAtual(),
      mSeg.fechar,
      ICONES_MENU.telaCheia,
    );
    const itemAutoAbrirSecundaria = itemMenu(
      'Autoabrir no 2º monitor',
      undefined,
      () => {
        const tl = telas();
        tl.abrirSecundariaAoIniciar = !tl.abrirSecundariaAoIniciar;
        salvarPreferencias();
        notificarPreferenciasParaOutraJanela();
      },
      nada,
      { svg: ICONES_MENU.autoAbrir, switchPill: true },
    );
    const itemPadrao2x2e1x2 = itemMenu(
      'Aplicar padrão rápido',
      undefined,
      () => {
        const tl = telas();
        tl.gradePrincipal = '2x2';
        tl.gradeSecundaria = '1x2';
        salvarPreferencias();
        notificarPreferenciasParaOutraJanela();
        void aplicarPresetVisualizacao({
          id: 'rapido-2x2-1x2',
          rotulo: '2x2 + 1x2',
          gradePrincipal: '2x2',
          usarSegundaJanela: true,
          gradeSecundaria: '1x2',
        });
      },
      mSeg.fechar,
      { svg: ICONES_MENU.padraoRapido, badge: '2×2 + 1×2' },
    );
    const itemConfigMonitores = itemMenu(
      'Monitores e grades…',
      undefined,
      () => abrirConfiguracoes('telas'),
      mSeg.fechar,
      ICONES_MENU.config,
    );

    const atualizarMenuSegundaJanela = (): void => {
      const op = obterOpcoesSincroniaJanelas();
      itemSincRolagemJanela.setAttribute('aria-pressed', String(op.rolagem));
      itemSincLinhasJanela.setAttribute('aria-pressed', String(op.linhas));
      itemSincVoiJanela.setAttribute('aria-pressed', String(op.janela));
      itemSincLocJanela.setAttribute('aria-pressed', String(op.localizador));
      const tl = telas();
      const modoAtual = secundaria ? tl.modoTelaSecundaria : tl.modoTelaPrincipal;
      itemSempreTelaToda.setAttribute('aria-pressed', String(modoAtual === 'maximizada' || modoAtual === 'tela-cheia'));
      itemAutoAbrirSecundaria.setAttribute('aria-pressed', String(tl.abrirSecundariaAoIniciar));
    };
    atualizarMenuSegundaJanela();
    document.addEventListener(EVENTO_SINCRONIA_JANELAS, atualizarMenuSegundaJanela);
    document.addEventListener(EVENTO_PREFERENCIAS, atualizarMenuSegundaJanela);
    mSeg.painel.append(
      secaoMenu('Sincronia entre janelas'),
      itemSincRolagemJanela,
      itemSincLinhasJanela,
      itemSincVoiJanela,
      itemSincLocJanela,
      divisorMenu(),
      secaoMenu('Janela e disposição'),
      itemPadrao2x2e1x2,
      itemSempreTelaToda,
      itemAutoAbrirSecundaria,
      itemAlternarTelaCheia,
      divisorMenu(),
      itemConfigMonitores,
    );
  }

  if (menuPacs) menuPacs.contentor.dataset.itemBarra = 'pacs';
  menuPetCt.contentor.dataset.itemBarra = 'petct';
  botaoLinhasRef.dataset.itemBarra = 'linhas';
  menuComparar.contentor.dataset.itemBarra = 'comparar';
  if (menuSegundaJanela) menuSegundaJanela.contentor.dataset.itemBarra = 'segundaTela';
  botaoOverlay.dataset.itemBarra = 'texto';

  const elementosTela: HTMLElement[] = [
    ...(!secundaria ? [menuAbrir.contentor] : []),
    ...(!secundaria && menuPacs ? [menuPacs.contentor] : []),
    menuLayout.contentor,
    menuPetCt.contentor,
    botaoLinhasRef,
    menuComparar.contentor,
    grupoCompararInline,
    ...(menuSegundaJanela ? [menuSegundaJanela.contentor] : []),
    botaoOverlay,
  ];
  grupoTela.append(...elementosTela);

  // 3. Ferramentas de Navegação (Cortes, Janela/Nível + Presets, Pan, Zoom, ┼ Localizar, Crosshairs)
  const grupoNavegacao = document.createElement('div');
  grupoNavegacao.className = 'grupo-botoes';
  grupoNavegacao.setAttribute('role', 'group');
  grupoNavegacao.setAttribute('aria-label', 'Navegação e janela');

  const ferramentasNav = FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'navegacao');
  const botoesFerramenta: HTMLButtonElement[] = [];

  for (const f of ferramentasNav) {
    const legendaCurta = LEGENDAS_CURTAS_FERRAMENTA[f.nome] ?? f.rotulo;
    const svgIcone = iconeFavoritoMenu(f.nome);
    if (f.nome === 'WindowLevel') {
      // Janela/nível como botão dividido com todos os presets de janela no menu suspenso:
      const menuJanela = criarMenuSuspenso({
        rotulo: legendaCurta,
        svg: svgIcone,
        dica: `Usar ${f.rotulo.toLowerCase()} com o botão esquerdo (tecla ${teclaDaFerramenta(f).toUpperCase()})`,
        acaoPrincipal: () => escolherFerramentaPrimaria(f.nome),
      });
      menuJanela.botaoPrincipal.dataset.ferramenta = f.nome;
      botoesFerramenta.push(menuJanela.botaoPrincipal);

      const montarJanelas = (): void => {
        menuJanela.painel.replaceChildren();
        menuJanela.painel.append(
          itemMenu(
            'Auto-janela neste corte',
            '0',
            () => void autoJanelaCorteAtual(),
            menuJanela.fechar,
            { svg: ICONES_MENU.janelaNivel, destaque: true },
          ),
          divisorMenu(),
          secaoMenu('Predefinições'),
        );
        predefinicoes().forEach((p, i) => {
          menuJanela.painel.append(
            itemMenu(
              p.rotulo,
              String(i + 1),
              () => void aplicarPredefinicao(i),
              menuJanela.fechar,
              {
                svg: iconeFavoritoMenu(`janela:${Math.min(i, 5)}`),
                badge: `WL ${p.centro} · WW ${p.largura}`,
              },
            ),
          );
        });
        menuJanela.painel.append(
          divisorMenu(),
          itemMenu(
            'Inverter preto e branco',
            undefined,
            () => void inverter(),
            menuJanela.fechar,
            iconeFavoritoMenu('acao:inverter'),
          ),
          itemMenu(
            'Editar janelas…',
            undefined,
            () => abrirConfiguracoes('janelas'),
            menuJanela.fechar,
            ICONES_MENU.config,
          ),
        );
      };
      montarJanelas();
      document.addEventListener(EVENTO_PREFERENCIAS, montarJanelas);
      grupoNavegacao.append(menuJanela.contentor);
    } else {
      const b = botao(
        legendaCurta,
        `Usar ${f.rotulo.toLowerCase()} com o botão esquerdo (tecla ${teclaDaFerramenta(f).toUpperCase()})`,
        () => escolherFerramentaPrimaria(f.nome),
        svgIcone,
      );
      b.dataset.ferramenta = f.nome;
      if (f.apenasMpr) b.dataset.apenasMpr = 'true';
      if (f.nome === 'Pan') b.dataset.itemBarra = 'pan';
      else if (f.nome === 'Zoom') b.dataset.itemBarra = 'zoom';
      else if (f.nome === 'Localizador3D') b.dataset.itemBarra = 'localizar';
      else if (f.nome === 'GirarPlano') b.dataset.itemBarra = 'inclinar';
      botoesFerramenta.push(b);
      grupoNavegacao.append(b);
    }
  }

  // 4. Menu agrupado de Medidas e Ferramentas Avançadas em 2 colunas + rodapé horizontal
  const ferramentasMedida = FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'medida');
  let ultimaMedidaEscolhida: FerramentaPrimaria = ferramentasMedida[0]!;

  const menuMedidas = criarMenuSuspenso({
    rotulo: LEGENDAS_CURTAS_FERRAMENTA[ultimaMedidaEscolhida.nome] ?? ultimaMedidaEscolhida.rotulo,
    svg: iconeFavoritoMenu(ultimaMedidaEscolhida.nome),
    dica: 'Ativar a ferramenta de medida atual; a seta ao lado abre a lista de medidas e a curva de ROI',
    acaoPrincipal: () => escolherFerramentaPrimaria(ultimaMedidaEscolhida.nome),
  });
  menuMedidas.painel.classList.add('painel-medidas');

  const ORDEM_MEDIDAS_BASICAS = [
    'Length',
    'OrthogonalLengths',
    'EllipsoidVolume',
    'Angle',
    'ArrowCustom',
    'EllipticalROI',
    'PlanarFreehandROI',
    'Polyline',
  ];
  const ORDEM_MEDIDAS_AVANCADAS = [
    'MidlineShift',
    'LinearRatio',
    'StenosisRatio',
    'CobbAngleCustom',
    'ReferenceAngle',
  ];
  const ORDEM_MEDIDAS_PET = ['SphereVOI', 'PetLesionVOI'];

  const mapaMedidas = new Map(ferramentasMedida.map((f) => [f.nome, f]));
  const usadasMedidas = new Set<string>();
  const pegarMedidasOrdenadas = (nomes: string[]): FerramentaPrimaria[] => {
    const lista: FerramentaPrimaria[] = [];
    for (const nome of nomes) {
      const f = mapaMedidas.get(nome);
      if (f) {
        lista.push(f);
        usadasMedidas.add(nome);
      }
    }
    return lista;
  };
  const medidasBasicas = pegarMedidasOrdenadas(ORDEM_MEDIDAS_BASICAS);
  const medidasAvancadas = pegarMedidasOrdenadas(ORDEM_MEDIDAS_AVANCADAS);
  const medidasPet = pegarMedidasOrdenadas(ORDEM_MEDIDAS_PET);
  for (const f of ferramentasMedida) {
    if (!usadasMedidas.has(f.nome)) medidasBasicas.push(f);
  }

  const criarItemMedida = (f: FerramentaPrimaria): HTMLButtonElement => {
    const item = itemMenu(
      f.rotulo,
      teclaDaFerramenta(f).toUpperCase(),
      () => {
        ultimaMedidaEscolhida = f;
        escolherFerramentaPrimaria(f.nome);
      },
      menuMedidas.fechar,
      iconeFavoritoMenu(f.nome),
    );
    item.dataset.ferramenta = f.nome;
    botoesFerramenta.push(item);
    return item;
  };

  const colBasicas = document.createElement('div');
  colBasicas.className = 'medidas-col';
  colBasicas.append(secaoMenu('Básicas'), ...medidasBasicas.map(criarItemMedida));

  const divisorVerticalMedidas = document.createElement('div');
  divisorVerticalMedidas.className = 'medidas-divisor-v';

  const colDireitaMedidas = document.createElement('div');
  colDireitaMedidas.className = 'medidas-col';
  colDireitaMedidas.append(
    secaoMenu('Avançadas'),
    ...medidasAvancadas.map(criarItemMedida),
    divisorMenu(),
    secaoMenu('PET e Perfusão', true),
    ...medidasPet.map(criarItemMedida),
    itemMenu(
      'Curva tempo-intensidade',
      'Ctrl+Shift+E',
      () => void abrirCurvaPerfusaoAtiva(),
      menuMedidas.fechar,
      ICONES_MENU.perfusao,
    ),
  );

  const gradeMedidas = document.createElement('div');
  gradeMedidas.className = 'medidas-colunas';
  gradeMedidas.append(colBasicas, divisorVerticalMedidas, colDireitaMedidas);

  const botaoRodapeMedida = (
    rotulo: string,
    atalho: string | undefined,
    acao: () => void,
    perigo = false,
  ): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = perigo ? 'btn-rodape-medida perigo' : 'btn-rodape-medida';
    const span = document.createElement('span');
    span.textContent = rotulo;
    b.append(span);
    if (atalho) {
      const kbd = document.createElement('kbd');
      kbd.textContent = atalho;
      b.append(kbd);
    }
    b.addEventListener('click', () => {
      menuMedidas.fechar();
      acao();
    });
    return b;
  };

  const rodapeMedidas = document.createElement('div');
  rodapeMedidas.className = 'medidas-rodape';
  rodapeMedidas.append(
    botaoRodapeMedida('Copiar selecionada', 'Ctrl+C', () => void copiarMedidasSelecionadas()),
    botaoRodapeMedida('Apagar selecionada', 'Del', () => void apagarSelecionadas()),
    botaoRodapeMedida('Aparência e texto…', undefined, () => abrirConfiguracoes('medidas')),
    botaoRodapeMedida('Apagar todas', undefined, () => void limparMedidas(), true),
  );

  menuMedidas.painel.append(gradeMedidas, rodapeMedidas);

  // 4b. Segmentação: botão direto que abre o ambiente dedicado de segmentação da sequência ativa.
  let ultimaSegmentacao = FERRAMENTAS_SEGMENTACAO[0]!;
  const botaoSegmentar = botao(
    'Segmentar',
    'Abrir o ambiente dedicado de segmentação da sequência selecionada (Esc para sair)',
    () => alternarModoSegmentacaoBarra(ultimaSegmentacao.nome),
    iconeFavoritoMenu(ultimaSegmentacao.nome),
  );
  botaoSegmentar.dataset.itemBarra = 'segmentar';
  grupoNavegacao.append(menuMedidas.contentor, botaoSegmentar);

  // 5. Menu de Filtro de Imagem (Suave <-> Nítido), Transformações (Girar, Espelhar, Inverter, Restaurar) + Mouse
  const iconeFiltroImagem = svgBarra(
    '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="17" r="2" fill="currentColor"/>',
  );
  const menuFiltroImagem = criarMenuSuspenso({
    rotulo: 'Filtro',
    svg: iconeFiltroImagem,
    dica: 'Ajustar filtro visual do viewport ativo entre Suave e Nítido (não altera HU/SUV)',
  });
  menuFiltroImagem.contentor.dataset.itemBarra = 'filtroImagem';

  const caixaFiltro = document.createElement('div');
  caixaFiltro.className = 'painel-filtro-imagem';

  const cabecalhoFiltro = document.createElement('div');
  cabecalhoFiltro.className = 'filtro-imagem-cabecalho';
  const tituloFiltro = document.createElement('span');
  tituloFiltro.textContent = 'Filtro (viewport ativo)';
  const valorFiltroEl = document.createElement('strong');
  valorFiltroEl.className = 'filtro-imagem-valor';
  valorFiltroEl.textContent = 'Original';
  cabecalhoFiltro.append(tituloFiltro, valorFiltroEl);

  const sliderFiltro = document.createElement('input');
  sliderFiltro.type = 'range';
  sliderFiltro.className = 'filtro-imagem-slider';
  sliderFiltro.min = String(FILTRO_IMAGEM_MIN);
  sliderFiltro.max = String(FILTRO_IMAGEM_MAX);
  sliderFiltro.step = String(FILTRO_IMAGEM_PASSO);
  sliderFiltro.value = '0';
  sliderFiltro.setAttribute('aria-label', 'Filtro de imagem entre Suave e Nítido');
  sliderFiltro.addEventListener('input', () => {
    definirFiltroImagemAtivo(Number(sliderFiltro.value));
  });

  const escalaFiltro = document.createElement('div');
  escalaFiltro.className = 'filtro-imagem-escala';
  escalaFiltro.innerHTML = '<span>Suave</span><span>Original</span><span>Nítido</span>';

  const notaFiltro = document.createElement('div');
  notaFiltro.className = 'filtro-imagem-nota';
  notaFiltro.textContent = 'Só altera a exibição na tela (não altera HU/SUV).';

  caixaFiltro.append(cabecalhoFiltro, sliderFiltro, escalaFiltro);
  menuFiltroImagem.painel.append(caixaFiltro, secaoMenu('Predefinições'));

  const botoesPresetFiltro: Array<{ valor: number; botao: HTMLButtonElement }> = [];
  for (const preset of PRESETS_FILTRO_IMAGEM) {
    const item = itemMenu(
      preset.rotulo,
      preset.valor === 0 ? '0' : preset.valor > 0 ? `+${String(preset.valor).replace('.', ',')}` : String(preset.valor).replace('.', ','),
      () => definirFiltroImagemAtivo(preset.valor),
      menuFiltroImagem.fechar,
    );
    item.title = preset.descricao;
    botoesPresetFiltro.push({ valor: preset.valor, botao: item });
    menuFiltroImagem.painel.append(item);
  }
  menuFiltroImagem.painel.append(notaFiltro);

  // Transformações da Imagem (Girar, Espelhar, Inverter, Restaurar)
  const grupoImagem = document.createElement('div');
  grupoImagem.className = 'grupo-botoes';

  const menuTransformar = criarMenuSuspenso({
    rotulo: 'Girar',
    svg: iconeFavoritoMenu('acao:girar90'),
    dica: 'Girar 90° no sentido horário (Ctrl+]) ou abrir mais opções (espelhar, inverter, restaurar)',
    acaoPrincipal: () => void girar90(1),
  });
  menuTransformar.painel.append(
    itemMenu(
      'Girar 90° horário',
      'Ctrl+]',
      () => void girar90(1),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:girar90'),
    ),
    itemMenu(
      'Girar 90° anti-horário',
      'Ctrl+[',
      () => void girar90(-1),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:girar90'),
    ),
    itemMenu(
      'Espelhar horizontalmente',
      'Ctrl+Shift+[',
      () => void espelhar(false),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:espelhar'),
    ),
    itemMenu(
      'Espelhar verticalmente',
      'Ctrl+Shift+]',
      () => void espelhar(true),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:espelhar'),
    ),
    itemMenu(
      'Inverter preto e branco',
      'F11',
      () => void inverter(),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:inverter'),
    ),
    divisorMenu(),
    itemMenu(
      'Restaurar visualização inicial',
      'Ctrl+R',
      () => {
        limparMirasLocalizador();
        void restaurar();
      },
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:restaurar'),
    ),
  );

  const botaoRestaurarRapido = botao(
    'Restaurar',
    'Restaurar janela, zoom, rotação, espelhamento e limpar cruzinha (Ctrl+R)',
    () => {
      limparMirasLocalizador();
      void restaurar();
    },
    iconeFavoritoMenu('acao:restaurar'),
  );

  // Menu suspenso para configurar os botões Direito, Meio e Roda do mouse:
  const menuMouse = criarMenuSuspenso({
    rotulo: 'Mouse',
    svg: ICONES_BARRA.mouse,
    dica: 'Escolher a função dos botões Direito, Meio, laterais (voltar/avançar) e Roda do mouse',
  });
  const camposMouse: Array<[Botao, HTMLSelectElement]> = [];
  const seletores: Array<[Botao, string, OpcaoBotao[]]> = [
    ['direito', 'Botão direito', OPCOES_SECUNDARIAS],
    ['meio', 'Botão do meio', OPCOES_SECUNDARIAS],
    ['roda', 'Roda do mouse', OPCOES_RODA],
    ['voltar', 'Lateral: voltar', OPCOES_LATERAIS],
    ['avancar', 'Lateral: avançar', OPCOES_LATERAIS],
  ];
  for (const [botaoMouse, rotulo, opcoes] of seletores) {
    const linha = document.createElement('label');
    linha.className = 'linha-config-mouse';
    const rotuloComIcone = document.createElement('span');
    rotuloComIcone.className = 'rotulo-config-mouse';
    const ic = document.createElement('span');
    ic.className = 'icone-item-menu';
    ic.innerHTML = ICONES_BOTAO_MOUSE[botaoMouse];
    const span = document.createElement('span');
    span.textContent = rotulo;
    rotuloComIcone.append(ic, span);
    const seletor = document.createElement('select');
    seletor.setAttribute('aria-label', `Ferramenta do ${rotulo.toLowerCase()}`);
    for (const opcao of opcoes) {
      const o = document.createElement('option');
      o.value = opcao.nome;
      o.textContent = opcao.rotulo;
      seletor.append(o);
    }
    seletor.value = botaoAtribuido(botaoMouse);
    camposMouse.push([botaoMouse, seletor]);
    seletor.addEventListener('change', () => definirBotao(botaoMouse, seletor.value));
    linha.append(rotuloComIcone, seletor);
    menuMouse.painel.append(linha);
  }

  menuTransformar.contentor.dataset.itemBarra = 'girar';
  botaoRestaurarRapido.dataset.itemBarra = 'restaurar';
  menuMouse.contentor.dataset.itemBarra = 'mouse';
  grupoImagem.append(menuFiltroImagem.contentor, menuTransformar.contentor, botaoRestaurarRapido, menuMouse.contentor);

  // 6. Cine (Tocar/Pausar + Velocidade em q/s)
  const menuCine = criarMenuSuspenso({
    rotulo: 'Cine',
    svg: ICONES_BARRA.cinePlay,
    dica: 'Tocar ou pausar o cine / rotação MIP 3D (barra de espaço)',
    acaoPrincipal: () => alternarCine(),
  });
  menuCine.contentor.dataset.itemBarra = 'cine';
  menuCine.painel.append(secaoMenu('Velocidade'));
  const botoesFps: HTMLButtonElement[] = [];
  for (const fps of VELOCIDADES_CINE) {
    const item = itemMenu(
      `${fps} quadros/s`,
      undefined,
      () => definirVelocidadeCine(fps),
      menuCine.fechar,
      ICONES_MENU.velocidade,
    );
    item.dataset.fps = String(fps);
    botoesFps.push(item);
    menuCine.painel.append(item);
  }

  // 7. MPR, MIP 3D, Plano individual, Modo de projeção e Slab (mm)
  const grupoMpr3d = document.createElement('div');
  grupoMpr3d.className = 'grupo-botoes';

  const rotuloPlano = document.createElement('label');
  rotuloPlano.className = 'seletor-botao';
  rotuloPlano.title = 'Mudar apenas o plano da sequência no viewport ativo, sem sair da grade';
  rotuloPlano.textContent = 'Plano ';
  const seletorPlano = document.createElement('select');
  seletorPlano.setAttribute('aria-label', 'Plano do viewport ativo');
  for (const op of OPCOES_PLANO) {
    const o = document.createElement('option');
    o.value = op.valor;
    o.textContent = op.rotulo;
    seletorPlano.append(o);
  }
  seletorPlano.addEventListener('change', () => {
    void definirPlanoSlotAtivo(seletorPlano.value as PlanoSlot);
  });
  rotuloPlano.append(seletorPlano);

  const rotuloModo = document.createElement('label');
  rotuloModo.className = 'seletor-botao';
  rotuloModo.title = 'Modo de projeção de slab (Normal, MIP, MinIP ou Média) no viewport ativo ou no MPR';
  rotuloModo.textContent = 'Modo ';
  const seletorModo = document.createElement('select');
  seletorModo.setAttribute('aria-label', 'Modo de projeção do slab');
  for (const op of OPCOES_MODO_SLAB) {
    const o = document.createElement('option');
    o.value = op.valor;
    o.textContent = op.rotulo;
    seletorModo.append(o);
  }
  seletorModo.addEventListener('change', () => {
    void definirModoSlabAtivo(seletorModo.value as ModoSlab);
  });
  rotuloModo.append(seletorModo);

  const controleSlab = document.createElement('label');
  controleSlab.className = 'seletor-botao controle-slab';
  controleSlab.title = 'Espessura de slab em milímetros (ou Ctrl + roda do mouse sobre a imagem)';
  const textoSlab = document.createElement('span');
  textoSlab.textContent = 'Slab ';
  const sliderSlab = document.createElement('input');
  sliderSlab.type = 'range';
  sliderSlab.min = '0.5';
  sliderSlab.max = '50';
  sliderSlab.step = '0.5';
  sliderSlab.value = '1';
  sliderSlab.setAttribute('aria-label', 'Espessura de slab em milímetros');
  const valorSlab = document.createElement('span');
  valorSlab.className = 'valor-slab';
  valorSlab.textContent = formatarMm(1);
  sliderSlab.addEventListener('input', () => {
    const mm = Number(sliderSlab.value);
    valorSlab.textContent = formatarMm(mm);
    definirSlabMpr(mm);
  });
  controleSlab.append(textoSlab, sliderSlab, valorSlab);

  const botaoMpr = botao(
    'MPR',
    'Modo MPR completo: axial, coronal e sagital lado a lado (F2 ou R)',
    () => void alternarMpr(),
    iconeFavoritoMenu('acao:mpr'),
  );
  const botaoMip3d = botao(
    'MIP 3D',
    'Abrir MIP rotatório 3D ao lado do corte 2D (clique num ponto intenso para ir ao corte correspondente)',
    () => void alternarMipRotatorio(),
    ICONES_BARRA.mip3d,
  );

  const botao3d = botao(
    '3D',
    'Abrir a reconstrução 3D (renderização volumétrica) ao lado do corte 2D (F3). No 3D: esquerdo gira, direito ou roda dão zoom, meio move',
    () => void alternar3d(),
    ICONES_BARRA.cubo3d,
  );

  rotuloPlano.dataset.itemBarra = 'planoSelect';
  rotuloModo.dataset.itemBarra = 'modoSlab';
  controleSlab.dataset.itemBarra = 'modoSlab';
  botaoMpr.dataset.itemBarra = 'mpr';
  botaoMip3d.dataset.itemBarra = 'mip3d';
  botao3d.dataset.itemBarra = '3d';
  grupoMpr3d.append(rotuloPlano, rotuloModo, controleSlab, botaoMpr, botaoMip3d, botao3d);

  const config = botao('Ajustes', 'Configurações: medidas, barra, 3D/GPU, atalhos e janelas', () => abrirConfiguracoes(), ICONES_BARRA.config);
  config.setAttribute('aria-label', 'Configurações');

  // Menu suspenso "Links" (sites de apoio ao laudo, com exclusão de qualquer item e adição de novos)
  const iconeLinksBarra = svgBarra(
    '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.2 4.72"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.62-1.62"/>',
  );
  const iconeAbrirExterno = svgBarra(
    '<path d="M14 4h6v6"/><path d="M10 14L20 4"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/>',
  );
  const menuLinks = criarMenuSuspenso({
    rotulo: 'Links',
    svg: iconeLinksBarra,
    dica: 'Links rápidos de radiologia, calculadoras, periódicos e IA (abre no navegador)',
  });
  menuLinks.contentor.dataset.itemBarra = 'links';
  menuLinks.painel.classList.add('painel-links-rapidos');

  const listaLinksEl = document.createElement('div');
  listaLinksEl.className = 'lista-links-rapidos';

  const rodapeLinksEl = document.createElement('div');
  rodapeLinksEl.className = 'rodape-links-rapidos';

  const btnAbrirFormLink = itemMenu(
    '+ Adicionar link…',
    undefined,
    () => {
      formNovoLink.hidden = false;
      btnAbrirFormLink.hidden = true;
      erroFormLink.hidden = true;
      campoNomeLink.value = '';
      campoUrlLink.value = '';
      campoNomeLink.focus();
    },
    () => undefined,
  );
  btnAbrirFormLink.classList.add('item-menu-destaque');

  const btnRestaurarLinks = itemMenu(
    'Restaurar links padrão',
    undefined,
    () => {
      restaurarLinksRapidos();
      notificarPreferenciasParaOutraJanela();
    },
    () => undefined,
  );

  const formNovoLink = document.createElement('form');
  formNovoLink.className = 'form-novo-link';
  formNovoLink.hidden = true;

  const campoNomeLink = document.createElement('input');
  campoNomeLink.type = 'text';
  campoNomeLink.className = 'campo-novo-link';
  campoNomeLink.placeholder = 'Nome (ex.: ChatGPT)';
  campoNomeLink.maxLength = 60;
  campoNomeLink.setAttribute('aria-label', 'Nome do link');

  const campoUrlLink = document.createElement('input');
  campoUrlLink.type = 'text';
  campoUrlLink.className = 'campo-novo-link';
  campoUrlLink.placeholder = 'Endereço (ex.: https://site.com)';
  campoUrlLink.setAttribute('aria-label', 'Endereço URL do link');

  const erroFormLink = document.createElement('div');
  erroFormLink.className = 'erro-novo-link';
  erroFormLink.hidden = true;

  const acoesFormLink = document.createElement('div');
  acoesFormLink.className = 'acoes-novo-link';

  const btnSalvarLink = document.createElement('button');
  btnSalvarLink.type = 'submit';
  btnSalvarLink.className = 'btn-acao-link primario';
  btnSalvarLink.textContent = 'Adicionar';

  const btnCancelarLink = document.createElement('button');
  btnCancelarLink.type = 'button';
  btnCancelarLink.className = 'btn-acao-link';
  btnCancelarLink.textContent = 'Cancelar';

  const fecharFormNovoLink = (): void => {
    formNovoLink.hidden = true;
    btnAbrirFormLink.hidden = false;
    erroFormLink.hidden = true;
  };

  btnCancelarLink.addEventListener('click', (ev) => {
    ev.stopPropagation();
    fecharFormNovoLink();
  });

  for (const inp of [campoNomeLink, campoUrlLink]) {
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        ev.preventDefault();
        fecharFormNovoLink();
      }
    });
  }

  formNovoLink.addEventListener('submit', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const res = adicionarLinkRapido(campoNomeLink.value, campoUrlLink.value);
    if (!res.ok) {
      erroFormLink.textContent = res.erro;
      erroFormLink.hidden = false;
      campoUrlLink.focus();
      return;
    }
    fecharFormNovoLink();
    notificarPreferenciasParaOutraJanela();
  });

  acoesFormLink.append(btnSalvarLink, btnCancelarLink);
  formNovoLink.append(campoNomeLink, campoUrlLink, erroFormLink, acoesFormLink);
  rodapeLinksEl.append(btnAbrirFormLink, formNovoLink, btnRestaurarLinks);
  menuLinks.painel.append(listaLinksEl, divisorMenu(), rodapeLinksEl);

  function renderizarMenuLinks(): void {
    listaLinksEl.replaceChildren();
    const links = preferencias().linksRapidos;
    if (links.length === 0) {
      const vazio = document.createElement('div');
      vazio.className = 'links-rapidos-vazio';
      vazio.textContent = 'Nenhum link na lista.';
      listaLinksEl.append(vazio);
    } else {
      let grupoAtual: string | undefined;
      for (const link of links) {
        const grp = link.grupo || 'Links';
        if (grp !== grupoAtual) {
          grupoAtual = grp;
          listaLinksEl.append(secaoMenu(grp));
        }
        const linhaEl = document.createElement('div');
        linhaEl.className = 'linha-link-rapido';

        const btnAbrir = document.createElement('button');
        btnAbrir.type = 'button';
        btnAbrir.className = 'item-menu-suspenso btn-abrir-link-rapido';
        btnAbrir.title = `${link.rotulo} — ${link.url}`;
        const conteudo = document.createElement('span');
        conteudo.className = 'rotulo-com-icone';
        const ic = document.createElement('span');
        ic.className = 'icone-item-menu';
        ic.innerHTML = iconeAbrirExterno;
        const txt = document.createElement('span');
        txt.className = 'texto-link-rapido';
        txt.textContent = link.rotulo;
        conteudo.append(ic, txt);
        btnAbrir.append(conteudo);
        btnAbrir.addEventListener('click', () => {
          menuLinks.fechar();
          abrirLinkExterno(link.url);
        });

        const btnApagar = document.createElement('button');
        btnApagar.type = 'button';
        btnApagar.className = 'btn-apagar-link';
        btnApagar.textContent = '×';
        btnApagar.title = `Remover "${link.rotulo}"`;
        btnApagar.setAttribute('aria-label', `Remover link ${link.rotulo}`);
        btnApagar.addEventListener('click', (ev) => {
          ev.stopPropagation();
          removerLinkRapido(link.id);
          notificarPreferenciasParaOutraJanela();
        });

        linhaEl.append(btnAbrir, btnApagar);
        listaLinksEl.append(linhaEl);
      }
    }

    const idsAtuais = new Set(links.map((l) => l.id));
    const faltaAlgumPadrao = LINKS_RAPIDOS_PADRAO.some((p) => !idsAtuais.has(p.id));
    btnRestaurarLinks.hidden = !faltaAlgumPadrao;
  }

  renderizarMenuLinks();
  document.addEventListener(EVENTO_PREFERENCIAS, renderizarMenuLinks);

  const ajuda = botao('Atalhos', 'Atalhos de teclado (tecla ?)', () => alternarAjuda(), ICONES_BARRA.ajuda);
  ajuda.setAttribute('aria-label', 'Atalhos de teclado');
  ajuda.dataset.itemBarra = 'atalhos';

  contentor.append(
    grupoTela,
    separador(),
    grupoNavegacao,
    separador(),
    grupoImagem,
    separador(),
    menuCine.contentor,
    separador(),
    grupoMpr3d,
    separador(),
    menuLinks.contentor,
    config,
    ajuda,
  );

  function aplicarPersonalizacaoBarra(): void {
    const ocultos = new Set(preferencias().barraSuperiorOcultos);
    for (const elItem of contentor.querySelectorAll<HTMLElement>('[data-item-barra]')) {
      const id = elItem.dataset.itemBarra ?? '';
      elItem.classList.toggle('oculto-barra', ocultos.has(id));
    }
    for (const grp of contentor.querySelectorAll<HTMLElement>(':scope > .grupo-botoes')) {
      const algumVisivel = Array.from(grp.children).some(
        (f) => f instanceof HTMLElement && !f.hidden && !f.classList.contains('oculto-barra'),
      );
      grp.classList.toggle('oculto-barra', !algumVisivel);
    }
    // Esconde separadores órfãos nas pontas ou duplicados
    const filhos = Array.from(contentor.children) as HTMLElement[];
    let houveItemVisivelAntes = false;
    let ultimoSeparadorVisivel: HTMLElement | null = null;
    for (const f of filhos) {
      if (f.classList.contains('separador')) {
        if (!houveItemVisivelAntes || ultimoSeparadorVisivel) {
          f.classList.add('oculto-barra');
        } else {
          f.classList.remove('oculto-barra');
          ultimoSeparadorVisivel = f;
        }
      } else if (!f.hidden && !f.classList.contains('oculto-barra')) {
        houveItemVisivelAntes = true;
        ultimoSeparadorVisivel = null;
      }
    }
    if (ultimoSeparadorVisivel) ultimoSeparadorVisivel.classList.add('oculto-barra');
  }
  aplicarPersonalizacaoBarra();
  document.addEventListener(EVENTO_PREFERENCIAS, aplicarPersonalizacaoBarra);

  /** Reflete na barra a ferramenta ativa do botão esquerdo e as atribuições do mouse. */
  function atualizarEstado(): void {
    const atual = ferramentaPrimariaAtual();
    const mpr = emModoMprFerramentas();
    for (const b of botoesFerramenta) {
      if (b.dataset.apenasMpr === 'true') {
        b.hidden = !mpr;
      }
      b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    }

    const medidaAtiva = ferramentasMedida.find((f) => f.nome === atual);
    if (medidaAtiva) {
      ultimaMedidaEscolhida = medidaAtiva;
    }
    definirConteudoBotaoBarra(
      menuMedidas.botaoPrincipal,
      iconeFavoritoMenu(ultimaMedidaEscolhida.nome),
      LEGENDAS_CURTAS_FERRAMENTA[ultimaMedidaEscolhida.nome] ?? ultimaMedidaEscolhida.rotulo,
    );
    menuMedidas.botaoPrincipal.setAttribute('aria-pressed', String(Boolean(medidaAtiva)));

    const segAtiva = FERRAMENTAS_SEGMENTACAO.find((f) => f.nome === atual);
    if (segAtiva) {
      ultimaSegmentacao = segAtiva;
    }
    const modoSeg = emModoSegmentacao();
    definirConteudoBotaoBarra(
      botaoSegmentar,
      iconeFavoritoMenu(ultimaSegmentacao.nome),
      modoSeg ? 'Segmentando' : 'Segmentar',
    );
    botaoSegmentar.setAttribute('aria-pressed', String(Boolean(segAtiva || modoSeg)));

    for (const [botaoMouse, seletor] of camposMouse) {
      seletor.value = botaoAtribuido(botaoMouse);
    }
  }
  atualizarEstado();
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarEstado);
  document.addEventListener(EVENTO_MODO_SEGMENTACAO, atualizarEstado);

  function atualizarViewports(e: EstadoViewports): void {
    definirConteudoBotaoBarra(
      menuLayout.botaoPrincipal,
      ICONES_BARRA.grade,
      e.maximizado ? '1x1 máx' : geometriaLayout(e.layout).rotulo,
    );
    atualizarMenuPresetsGrade();
    menuLayout.botaoPrincipal.disabled = e.mprAtivo;
    menuLayout.botaoSeta.disabled = e.mprAtivo;
    menuPetCt.botaoPrincipal.disabled = e.mprAtivo;
    menuPetCt.botaoSeta.disabled = e.mprAtivo;

    seletorPlano.value = e.planoAtivo;
    seletorPlano.disabled = e.mprAtivo || (!e.mprDisponivel && e.planoAtivo === 'original');
    rotuloPlano.hidden = e.mprAtivo;

    const emMipRotatorio = !e.mprAtivo && (e.planoAtivo === 'mip-rotatorio' || e.planoAtivo === '3d');
    seletorModo.value = e.modoSlabAtivo;
    seletorModo.disabled = emMipRotatorio || (!e.mprAtivo && !e.mprDisponivel && e.modoSlabAtivo === 'normal');
    rotuloModo.hidden = emMipRotatorio;

    sliderSlab.value = String(e.slabMm);
    valorSlab.textContent = formatarMm(e.slabMm);
    sliderSlab.disabled = emMipRotatorio || (!e.mprAtivo && !e.mprDisponivel);
    controleSlab.hidden = emMipRotatorio;

    botaoMpr.setAttribute('aria-pressed', String(e.mprAtivo));
    botaoMpr.disabled = !e.mprAtivo && !e.mprDisponivel;

    botaoMip3d.setAttribute('aria-pressed', String(e.mipRotatorioVisivel));
    botaoMip3d.disabled = !e.mipRotatorioVisivel && !e.mprDisponivel;
    botao3d.setAttribute('aria-pressed', String(e.visao3dVisivel));
    botao3d.disabled = !e.visao3dVisivel && !e.mprDisponivel;

    itemSincEstudo.setAttribute('aria-pressed', String(e.sincroniaEstudo));
    botaoLinhasRef.setAttribute('aria-pressed', String(e.linhasReferencia));

    // Estado do modo Comparar:
    const comp = e.comparacao;
    menuComparar.botaoPrincipal.setAttribute('aria-pressed', String(comp.ativo));
    grupoCompararInline.hidden = !comp.ativo;
    if (comp.ativo) {
      definirConteudoBotaoBarra(
        botaoCadeadoRolagem,
        comp.rolagemLigada ? ICONES_BARRA.cadeadoFechado : ICONES_BARRA.cadeadoAberto,
        'Rolagem',
      );
      botaoCadeadoRolagem.setAttribute('aria-pressed', String(comp.rolagemLigada));
      if (comp.erroVinculo) {
        rotuloOffsetComparar.textContent = '⚠ Sem vínculo';
        rotuloOffsetComparar.title = comp.erroVinculo;
      } else {
        rotuloOffsetComparar.textContent = formatarDeslocamentoMm(comp.deslocamentoMm ?? 0);
        rotuloOffsetComparar.title = 'Deslocamento atual entre os referenciais dos dois exames';
      }
    }
    itemCadeadoMenu.setAttribute('aria-pressed', String(comp.rolagemLigada));
    itemJanelaMenu.setAttribute('aria-pressed', String(comp.janelaLigada));
    itemZoomMenu.setAttribute('aria-pressed', String(comp.zoomPanLigado));

    const temPilha = e.pilhaId !== null;
    const nivelFiltro = e.filtroImagemAtivo;
    menuFiltroImagem.botaoPrincipal.disabled = !e.suportaFiltroImagemAtivo;
    menuFiltroImagem.botaoSeta.disabled = !e.suportaFiltroImagemAtivo;
    menuFiltroImagem.botaoPrincipal.setAttribute('aria-pressed', String(nivelFiltro !== 0));
    definirConteudoBotaoBarra(
      menuFiltroImagem.botaoPrincipal,
      iconeFiltroImagem,
      `${rotuloBotaoFiltroImagem(nivelFiltro)} ▾`,
    );
    sliderFiltro.value = String(nivelFiltro);
    sliderFiltro.disabled = !e.suportaFiltroImagemAtivo;
    valorFiltroEl.textContent = rotuloFiltroImagem(nivelFiltro);
    for (const p of botoesPresetFiltro) {
      p.botao.setAttribute('aria-pressed', String(p.valor === nivelFiltro));
    }

    menuCine.botaoPrincipal.disabled = !temPilha || e.mprAtivo;
    menuCine.botaoSeta.disabled = !temPilha || e.mprAtivo || emMipRotatorio;
    definirConteudoBotaoBarra(
      menuCine.botaoPrincipal,
      e.cineTocando ? ICONES_BARRA.cinePause : ICONES_BARRA.cinePlay,
      'Cine',
    );
    menuCine.botaoPrincipal.setAttribute('aria-pressed', String(e.cineTocando));
    for (const item of botoesFps) {
      item.setAttribute('aria-pressed', String(Number(item.dataset.fps) === e.fps));
    }
  }
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => {
    atualizarViewports((ev as CustomEvent<EstadoViewports>).detail);
  });
}
