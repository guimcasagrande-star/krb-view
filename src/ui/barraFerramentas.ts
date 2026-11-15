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
import { EVENTO_PREFERENCIAS, salvarPreferencias, telas } from '../state/preferencias';
import { abrirConfiguracoes } from './configuracoes';
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
import { exportarImagemAtiva } from './exportarImagem';
import { abrirBuscarPacs } from './buscarPacs';
import { abrirServidoresPacs } from './servidoresPacs';
import { FERRAMENTAS_SEGMENTACAO } from '../segmentation/ferramentas';
import {
  abrirSegmentacaoDeArquivo,
  apagarSegmentacaoAtiva,
  novoSegmentoAtivo,
  salvarSegmentacaoAtiva,
} from './painelSegmentos';
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

function svgBarra(conteudo: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${conteudo}</svg>`;
}

const ICONES_BARRA = {
  lateral: svgBarra('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  abrir: svgBarra(
    '<path d="M3 7v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-7l-2-2H5a2 2 0 0 0-2 2z"/>',
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

const ICONES_BOTAO_MOUSE: Record<Botao, string> = {
  esquerdo: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7H6A6 6 0 0 1 12 3z" fill="#38bdf8"/>',
  ),
  direito: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7h6A6 6 0 0 0 12 3z" fill="#38bdf8"/>',
  ),
  meio: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="10.6" y="4.5" width="2.8" height="5.2" rx="1" fill="#38bdf8"/>',
  ),
  roda: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 4.2v5.8" stroke="#38bdf8" stroke-width="2.6"/>',
  ),
  voltar: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="3.5" y="11.2" width="2.6" height="4.2" rx="1" fill="#38bdf8"/>',
  ),
  avancar: svgBarra(
    '<rect x="6" y="3" width="12" height="18" rx="6"/><rect x="3.5" y="6.4" width="2.6" height="4.2" rx="1" fill="#38bdf8"/>',
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
  SegPincelLimiar: 'Limiar',
  SegEsfera: 'Esfera',
  PaintFill: 'Preencher',
  SegBorracha: 'Borracha',
  CrescerRegiao: 'Crescer',
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

function itemMenu(
  rotulo: string,
  atalho: string | undefined,
  acao: () => void,
  fecharMenu: () => void,
  svg?: string,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-menu-suspenso';
  const spanEsquerda = document.createElement('span');
  spanEsquerda.className = 'item-menu-rotulo';
  if (svg) {
    const ic = document.createElement('span');
    ic.className = 'icone-item-menu';
    ic.innerHTML = svg;
    spanEsquerda.append(ic);
  }
  const spanTexto = document.createElement('span');
  spanTexto.textContent = rotulo;
  spanEsquerda.append(spanTexto);
  b.append(spanEsquerda);
  if (atalho) {
    const kbd = document.createElement('kbd');
    kbd.textContent = atalho;
    b.append(kbd);
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
  menuAbrir.painel.append(
    itemMenu('Abrir pasta DICOM…', 'Ctrl+Shift+O', () => dispararAbrirPasta(), menuAbrir.fechar),
    itemMenu('Abrir arquivo(s) DICOM…', 'Ctrl+O', () => dispararAbrirArquivos(), menuAbrir.fechar),
    itemMenu('Abrir arquivo ZIP…', undefined, () => dispararAbrirZip(), menuAbrir.fechar),
    divisorMenu(),
    itemMenu('Limpar lista de exames', undefined, () => dispararLimparLista(), menuAbrir.fechar),
  );
  // Pastas recentes (só a referência da pasta) e exportação da imagem.
  const secaoRecentes = document.createElement('div');
  menuAbrir.painel.append(secaoRecentes);
  const montarRecentes = async (): Promise<void> => {
    const lista = await listarRecentes();
    secaoRecentes.replaceChildren();
    if (lista.length === 0) return;
    secaoRecentes.append(divisorMenu());
    for (const r of lista) {
      secaoRecentes.append(itemMenu(`🕘 ${r.nome}`, undefined, () => dispararAbrirRecente(r.handle), menuAbrir.fechar));
    }
    secaoRecentes.append(
      itemMenu('Limpar pastas recentes', undefined, () => void limparRecentes(), menuAbrir.fechar),
    );
  };
  void montarRecentes();
  document.addEventListener(EVENTO_RECENTES, () => void montarRecentes());
  const exportar = async (formato: 'png' | 'jpeg'): Promise<void> => {
    const erro = await exportarImagemAtiva(formato);
    if (erro) window.alert(erro);
  };
  if (pacsDisponivel()) {
    menuAbrir.painel.append(
      divisorMenu(),
      itemMenu('Buscar no PACS…', undefined, () => abrirBuscarPacs(), menuAbrir.fechar),
      itemMenu('Servidores PACS…', undefined, () => abrirServidoresPacs(), menuAbrir.fechar),
    );
  }
  menuAbrir.painel.append(
    divisorMenu(),
    itemMenu('Exportar imagem do viewport (PNG)', undefined, () => void exportar('png'), menuAbrir.fechar),
    itemMenu('Exportar imagem do viewport (JPEG)', undefined, () => void exportar('jpeg'), menuAbrir.fechar),
  );


  // 2. Dividir tela (Split screen: 1x1, 1x2, 2x2) + Anotações (A) + Comparar (🔗)
  const grupoTela = document.createElement('div');
  grupoTela.className = 'grupo-botoes';

  const menuLayout = criarMenuSuspenso({
    rotulo: '1x1',
    svg: ICONES_BARRA.grade,
    dica: 'Alternar divisão de tela (tecla L)',
    acaoPrincipal: () => void proximoLayout(),
  });
  // Seletor de grade: passe o mouse sobre os quadradinhos e clique para escolher linhas x colunas.
  const seletorGrade = document.createElement('div');
  seletorGrade.className = 'seletor-grade';
  const rotuloGrade = document.createElement('div');
  rotuloGrade.className = 'rotulo-grade';
  rotuloGrade.textContent = 'Escolha a grade';
  const quadrados: HTMLButtonElement[] = [];
  const marcarGrade = (linhas: number, colunas: number): void => {
    for (const q of quadrados) {
      q.classList.toggle('marcado', Number(q.dataset.l) <= linhas && Number(q.dataset.c) <= colunas);
    }
    rotuloGrade.textContent = linhas > 0 ? `${linhas} linha(s) × ${colunas} coluna(s)` : 'Escolha a grade';
  };
  const areaQuadrados = document.createElement('div');
  areaQuadrados.className = 'quadrados-grade';
  for (let l = 1; l <= GRADE_MAXIMA; l++) {
    for (let c = 1; c <= GRADE_MAXIMA; c++) {
      const q = document.createElement('button');
      q.type = 'button';
      q.dataset.l = String(l);
      q.dataset.c = String(c);
      q.title = `${l}x${c}`;
      q.setAttribute('aria-label', `Grade ${l} linha(s) por ${c} coluna(s)`);
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
  areaQuadrados.addEventListener('mouseleave', () => marcarGrade(0, 0));
  seletorGrade.append(areaQuadrados, rotuloGrade);
  const botaoLinhasRef = botao(
    'Linhas',
    'Linhas de referência: mostra nos outros viewports onde o corte do viewport ativo cruza (quando há planos diferentes)',
    () => alternarLinhasReferencia(),
    ICONES_BARRA.linhas,
  );
  const blocoPresetsGrade = document.createElement('div');
  const nadaMenuLayout = (): void => {};
  const itemFixarGradeAtual = itemMenu(
    '💾 Salvar grade atual como padrão ao iniciar',
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
  );
  const itemSalvarPresetNoMenu = itemMenu(
    '➕ Salvar disposição atual na lista abaixo',
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
        ? `Salvo: ${tl.gradePrincipal} (1ª) + ${tl.gradeSecundaria} (2ª)`
        : `Salvo: grade ${atual}`;
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
      spanFixar.textContent = jaSalva
        ? `✓ Grade ${atual} já é o padrão desta janela`
        : `💾 Salvar grade atual (${atual}) como padrão (salvo: ${padraoDesta})`;
    }
    for (const p of tl.presets) {
      if (p.usarSegundaJanela && !segundaJanelaDisponivel()) continue;
      const icone = p.usarSegundaJanela ? '🖥 ' : '⊞ ';
      const itemPreset = itemMenu(
        `${icone}${p.rotulo}`,
        undefined,
        () => void aplicarPresetVisualizacao(p),
        menuLayout.fechar,
      );
      const ehPresetPadrao =
        p.gradePrincipal === tl.gradePrincipal &&
        (!p.usarSegundaJanela || p.gradeSecundaria === tl.gradeSecundaria);
      itemPreset.setAttribute('aria-pressed', String(ehPresetPadrao));
      blocoPresetsGrade.append(itemPreset);
    }
  };
  atualizarMenuPresetsGrade();
  document.addEventListener(EVENTO_PREFERENCIAS, atualizarMenuPresetsGrade);

  menuLayout.painel.append(
    seletorGrade,
    divisorMenu(),
    itemMenu('Maximizar / restaurar viewport ativo', 'F ou 2 cliques', () => alternarMaximizado(), menuLayout.fechar),
    divisorMenu(),
    itemFixarGradeAtual,
    itemSalvarPresetNoMenu,
    divisorMenu(),
    blocoPresetsGrade,
    itemMenu(
      '⚙ Configurar grades e monitores padrão…',
      undefined,
      () => abrirConfiguracoes('telas'),
      menuLayout.fechar,
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
    itemMenu('4 campos: MIP 3D, PET, TC, Fusão', undefined, () => void abrirLayoutPet(4), menuPetCt.fechar),
    itemMenu('3 campos: PET, TC, Fusão', undefined, () => void abrirLayoutPet(3), menuPetCt.fechar),
    divisorMenu(),
    itemMenu('Comparação (6): atual em cima, anterior embaixo', undefined, () => void abrirLayoutComparacaoPetCt(), menuPetCt.fechar),
    itemMenu('Comparar fusões lado a lado (modo Comparar)', undefined, () => void compararPetCt(), menuPetCt.fechar),
  );

  const menuComparar = criarMenuSuspenso({
    rotulo: 'Comparar',
    svg: ICONES_BARRA.comparar,
    dica: 'Modo Comparar: dois exames lado a lado (ATUAL × ANTERIOR) com rolagem sincronizada',
    acaoPrincipal: () => void alternarModoComparar(),
  });
  const itemCadeadoMenu = itemMenu(
    '🔒 Rolagem sincronizada por posição',
    undefined,
    () => alternarCadeadoRolagemComparar(),
    menuComparar.fechar,
  );
  const itemJanelaMenu = itemMenu(
    '🔗 Sincronizar Janela / Nível',
    undefined,
    () => alternarSincronizacaoJanelaComparar(),
    menuComparar.fechar,
  );
  const itemZoomMenu = itemMenu(
    '🔗 Sincronizar Zoom / Pan',
    undefined,
    () => alternarSincronizacaoZoomPanComparar(),
    menuComparar.fechar,
  );
  const itemZerarMenu = itemMenu(
    'Zerar deslocamento entre exames',
    undefined,
    () => zerarVinculoRolagemComparar(),
    menuComparar.fechar,
  );
  const itemSincEstudo = itemMenu(
    '🔗 Sincronizar séries do mesmo estudo (automático)',
    undefined,
    () => alternarSincroniaEstudo(),
    menuComparar.fechar,
  );
  menuComparar.painel.append(
    itemSincEstudo,
    divisorMenu(),
    itemMenu('Ativar / sair do modo Comparar', undefined, () => void alternarModoComparar(), menuComparar.fechar),
    divisorMenu(),
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
          '🖥 Abrir ou focar a 2ª janela',
          undefined,
          () => void abrirSegundaJanela(),
          mSeg.fechar,
        ),
        divisorMenu(),
      );
    }
    const nada = (): void => {};
    const itemSincRolagemJanela = itemMenu(
      '🔒 Sincronizar rolagem por posição (mm)',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('rolagem');
      },
      nada,
    );
    const itemSincLinhasJanela = itemMenu(
      '✛ Linha de referência entre planos (Axial/Sagital/Coronal)',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('linhas');
      },
      nada,
    );
    const itemSincVoiJanela = itemMenu(
      '🔗 Sincronizar janela / nível (mesma modalidade)',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('janela');
      },
      nada,
    );
    const itemSincLocJanela = itemMenu(
      '┼ Sincronizar localizador (cruzinha 3D)',
      undefined,
      () => {
        alternarOpcaoSincroniaJanelas('localizador');
      },
      nada,
    );
    const itemSempreTelaToda = itemMenu(
      '🗖 Sempre abrir ocupando a tela toda (maximizada)',
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
    );
    const itemAlternarTelaCheia = itemMenu(
      '⛶ Tela cheia sem bordas',
      'F11',
      () => void alternarTelaCheiaJanelaAtual(),
      mSeg.fechar,
    );
    const itemAutoAbrirSecundaria = itemMenu(
      '🚀 Abrir 2ª janela automaticamente ao iniciar (com 2º monitor)',
      undefined,
      () => {
        const tl = telas();
        tl.abrirSecundariaAoIniciar = !tl.abrirSecundariaAoIniciar;
        salvarPreferencias();
        notificarPreferenciasParaOutraJanela();
      },
      nada,
    );
    const itemPadrao2x2e1x2 = itemMenu(
      '💾 Padrão 2×2 (1ª janela) + 1×2 (2ª janela) e aplicar',
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
    );
    const itemConfigMonitores = itemMenu(
      '⚙ Escolher monitor padrão e grades salvas…',
      undefined,
      () => abrirConfiguracoes('telas'),
      mSeg.fechar,
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
      itemSincRolagemJanela,
      itemSincLinhasJanela,
      itemSincVoiJanela,
      itemSincLocJanela,
      divisorMenu(),
      itemPadrao2x2e1x2,
      itemSempreTelaToda,
      itemAutoAbrirSecundaria,
      itemAlternarTelaCheia,
      divisorMenu(),
      itemConfigMonitores,
    );
  }

  const elementosTela: HTMLElement[] = [
    ...(!secundaria ? [menuAbrir.contentor] : []),
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
        predefinicoes().forEach((p, i) => {
          menuJanela.painel.append(
            itemMenu(
              `${p.rotulo} (WL ${p.centro} / WW ${p.largura})`,
              String(i + 1),
              () => void aplicarPredefinicao(i),
              menuJanela.fechar,
              iconeFavoritoMenu(`janela:${Math.min(i, 5)}`),
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
          itemMenu('Editar janelas…', undefined, () => abrirConfiguracoes('janelas'), menuJanela.fechar),
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
      botoesFerramenta.push(b);
      grupoNavegacao.append(b);
    }
  }

  // 4. Menu agrupado de Medidas e Ferramentas Avançadas (estilo RadiAnt)
  const ferramentasMedida = FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'medida');
  let ultimaMedidaEscolhida: FerramentaPrimaria = ferramentasMedida[0]!;

  const menuMedidas = criarMenuSuspenso({
    rotulo: LEGENDAS_CURTAS_FERRAMENTA[ultimaMedidaEscolhida.nome] ?? ultimaMedidaEscolhida.rotulo,
    svg: iconeFavoritoMenu(ultimaMedidaEscolhida.nome),
    dica: 'Ativar a ferramenta de medida atual; a seta ao lado abre a lista de medidas e a curva de ROI (perfusão)',
    acaoPrincipal: () => escolherFerramentaPrimaria(ultimaMedidaEscolhida.nome),
  });

  for (const f of ferramentasMedida) {
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
    menuMedidas.painel.append(item);
  }

  menuMedidas.painel.append(
    divisorMenu(),
    itemMenu(
      '📈 Gerar curva tempo-intensidade (Perfusão)',
      'Ctrl+Shift+E',
      () => void abrirCurvaPerfusaoAtiva(),
      menuMedidas.fechar,
    ),
    divisorMenu(),
    itemMenu('Apagar medida selecionada', 'Del', () => void apagarSelecionadas(), menuMedidas.fechar),
    itemMenu('Aparência e texto das medidas…', undefined, () => abrirConfiguracoes('medidas'), menuMedidas.fechar),
    itemMenu(
      'Apagar todas as medidas',
      undefined,
      () => {
        void limparMedidas();
      },
      menuMedidas.fechar,
      iconeFavoritoMenu('acao:limparMedidas'),
    ),
  );

  // 4b. Segmentação (fase 9.1): botão dividido com a última ferramenta e o menu das demais.
  let ultimaSegmentacao = FERRAMENTAS_SEGMENTACAO[0]!;
  const menuSegmentar = criarMenuSuspenso({
    rotulo: 'Segmentar',
    svg: iconeFavoritoMenu(ultimaSegmentacao.nome),
    dica: 'Segmentar a série do quadro ativo (cria a segmentação no 1º uso). Seta: ferramentas e segmentos',
    acaoPrincipal: () => escolherFerramentaPrimaria(ultimaSegmentacao.nome),
  });
  for (const f of FERRAMENTAS_SEGMENTACAO) {
    const item = itemMenu(
      f.rotulo,
      undefined,
      () => {
        ultimaSegmentacao = f;
        escolherFerramentaPrimaria(f.nome);
      },
      menuSegmentar.fechar,
      iconeFavoritoMenu(f.nome),
    );
    item.title = f.dica;
    item.dataset.ferramenta = f.nome;
    botoesFerramenta.push(item);
    menuSegmentar.painel.append(item);
  }
  menuSegmentar.painel.append(
    divisorMenu(),
    itemMenu('+ Novo segmento', undefined, () => void novoSegmentoAtivo(), menuSegmentar.fechar),
    itemMenu('Salvar segmentação…', undefined, () => void salvarSegmentacaoAtiva(), menuSegmentar.fechar),
    itemMenu('Abrir segmentação…', undefined, () => void abrirSegmentacaoDeArquivo(), menuSegmentar.fechar),
    itemMenu('Apagar segmentação da série…', undefined, apagarSegmentacaoAtiva, menuSegmentar.fechar),
  );

  grupoNavegacao.append(menuMedidas.contentor, menuSegmentar.contentor);

  // 5. Menu de Transformações da Imagem (Girar, Espelhar, Inverter, Restaurar) + Mouse
  const grupoImagem = document.createElement('div');
  grupoImagem.className = 'grupo-botoes';

  const menuTransformar = criarMenuSuspenso({
    rotulo: 'Girar',
    svg: iconeFavoritoMenu('acao:girar90'),
    dica: 'Girar 90° no sentido horário ou abrir mais opções (espelhar, inverter, restaurar)',
    acaoPrincipal: () => void girar90(),
  });
  menuTransformar.painel.append(
    itemMenu(
      'Girar 90° no sentido horário',
      undefined,
      () => void girar90(),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:girar90'),
    ),
    itemMenu(
      'Espelhar horizontalmente',
      undefined,
      () => void espelhar(),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:espelhar'),
    ),
    itemMenu(
      'Inverter preto e branco',
      undefined,
      () => void inverter(),
      menuTransformar.fechar,
      iconeFavoritoMenu('acao:inverter'),
    ),
    divisorMenu(),
    itemMenu(
      'Restaurar visualização inicial',
      'Esc',
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
    'Restaurar janela, zoom, rotação, espelhamento e limpar cruzinha',
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

  grupoImagem.append(menuTransformar.contentor, botaoRestaurarRapido, menuMouse.contentor);

  // 6. Cine (Tocar/Pausar + Velocidade em q/s)
  const menuCine = criarMenuSuspenso({
    rotulo: 'Cine',
    svg: ICONES_BARRA.cinePlay,
    dica: 'Tocar ou pausar o cine / rotação MIP 3D (barra de espaço)',
    acaoPrincipal: () => alternarCine(),
  });
  const botoesFps: HTMLButtonElement[] = [];
  for (const fps of VELOCIDADES_CINE) {
    const item = itemMenu(
      `Velocidade: ${fps} quadros/s`,
      undefined,
      () => definirVelocidadeCine(fps),
      menuCine.fechar,
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
    'Modo MPR completo: axial, coronal e sagital lado a lado (tecla R)',
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
    'Abrir a reconstrução 3D (renderização volumétrica) ao lado do corte 2D. No 3D: esquerdo gira, direito ou roda dão zoom, meio move',
    () => void alternar3d(),
    ICONES_BARRA.cubo3d,
  );

  grupoMpr3d.append(rotuloPlano, rotuloModo, controleSlab, botaoMpr, botaoMip3d, botao3d);

  const config = botao('Ajustes', 'Configurações: medidas, atalhos e janelas', () => abrirConfiguracoes(), ICONES_BARRA.config);
  config.setAttribute('aria-label', 'Configurações');
  const ajuda = botao('Atalhos', 'Atalhos de teclado (tecla ?)', () => alternarAjuda(), ICONES_BARRA.ajuda);
  ajuda.setAttribute('aria-label', 'Atalhos de teclado');

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
    config,
    ajuda,
  );

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
    definirConteudoBotaoBarra(
      menuSegmentar.botaoPrincipal,
      iconeFavoritoMenu(ultimaSegmentacao.nome),
      segAtiva ? (LEGENDAS_CURTAS_FERRAMENTA[segAtiva.nome] ?? 'Segmentar') : 'Segmentar',
    );
    menuSegmentar.botaoPrincipal.setAttribute('aria-pressed', String(Boolean(segAtiva)));

    for (const [botaoMouse, seletor] of camposMouse) {
      seletor.value = botaoAtribuido(botaoMouse);
    }
  }
  atualizarEstado();
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarEstado);

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
      itemCadeadoMenu.setAttribute('aria-pressed', String(comp.rolagemLigada));
      itemJanelaMenu.setAttribute('aria-pressed', String(comp.janelaLigada));
      itemZoomMenu.setAttribute('aria-pressed', String(comp.zoomPanLigado));
    }

    const temPilha = e.pilhaId !== null;
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
