/**
 * Barra de ferramentas agrupada estilo RadiAnt:
 * - Botões divididos (ação principal + seta `▾` com menu suspenso) para Abrir (Pasta, Arquivo, ZIP),
 *   Dividir tela (1x1, 1x2, 2x2), Sincronização/Comparar, Anotações (A), Navegação,
 *   Janela/Nível + Presets, Medidas (Distância, Desvio de linha média, Ângulo, Seta, ROIs,
 *   Polilinha e Curva Tempo-Intensidade / Perfusão), Transformações, Cine, MPR e MIP 3D.
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
  OPCOES_RODA,
  OPCOES_SECUNDARIAS,
  type OpcaoBotao,
  predefinicoes,
  restaurar,
  teclaDaFerramenta,
} from '../tools/grupo';
import { EVENTO_PREFERENCIAS } from '../state/preferencias';
import { abrirConfiguracoes } from './configuracoes';
import { alternarAjuda } from '../tools/atalhos';
import {
  dispararAbrirArquivos,
  dispararAbrirPasta,
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
  alternarModoComparar,
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
  alternarMaximizado,
  abrirLayoutPet,
  limparMirasLocalizador,
  type ModoSlab,
  type PlanoSlot,
  proximoLayout,
  zerarVinculoRolagemComparar,
} from '../viewer/viewport2d';

function botao(texto: string, dica: string, acao: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texto;
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
  botaoPrincipal.textContent = opcoes.rotulo;
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
  };

  if (opcoes.acaoPrincipal) {
    botaoPrincipal.addEventListener('click', () => {
      fecharTodosMenus();
      opcoes.acaoPrincipal!();
    });
    botaoSeta.addEventListener('click', alternarPainel);
    contentor.append(botaoPrincipal, botaoSeta, painel);
  } else {
    botaoPrincipal.textContent = `${opcoes.rotulo} ▾`;
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
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-menu-suspenso';
  const spanTexto = document.createElement('span');
  spanTexto.textContent = rotulo;
  b.append(spanTexto);
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

  document.addEventListener('click', () => fecharTodosMenus());

  // 1. Menu Abrir (Pasta, Arquivos DICOM, Arquivo ZIP, Limpar lista)
  const menuAbrir = criarMenuSuspenso({
    rotulo: '📂 Abrir',
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

  // 2. Dividir tela (Split screen: 1x1, 1x2, 2x2) + Anotações (A) + Comparar (🔗)
  const grupoTela = document.createElement('div');
  grupoTela.className = 'grupo-botoes';

  const menuLayout = criarMenuSuspenso({
    rotulo: '⊞ 1x1',
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
  menuLayout.painel.append(
    seletorGrade,
    divisorMenu(),
    itemMenu('PET/CT 4 campos: MIP 3D, PET, TC, Fusão', undefined, () => void abrirLayoutPet(4), menuLayout.fechar),
    itemMenu('PET/CT 3 campos: PET, TC, Fusão', undefined, () => void abrirLayoutPet(3), menuLayout.fechar),
    divisorMenu(),
    itemMenu('Maximizar / restaurar viewport ativo', 'F ou 2 cliques', () => alternarMaximizado(), menuLayout.fechar),
  );

  const menuComparar = criarMenuSuspenso({
    rotulo: '🔗 Comparar',
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
  menuComparar.painel.append(
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
    '🔒 Rolagem',
    'Ligar ou desligar o vínculo de rolagem por posição (ao religar, recalcula o deslocamento pelos cortes atuais)',
    () => alternarCadeadoRolagemComparar(),
  );
  const rotuloOffsetComparar = document.createElement('span');
  rotuloOffsetComparar.className = 'offset-comparar';
  rotuloOffsetComparar.title = 'Deslocamento atual entre os referenciais dos dois exames';
  const botaoZerarOffset = botao(
    'Zerar',
    'Restaurar o alinhamento inicial automático entre os dois exames',
    () => zerarVinculoRolagemComparar(),
  );
  grupoCompararInline.append(botaoCadeadoRolagem, rotuloOffsetComparar, botaoZerarOffset);

  const botaoOverlay = botao(
    'A',
    'Mostrar ou esconder textos e informações nos cantos da imagem (tecla O)',
    () => alternarOverlay(),
  );

  grupoTela.append(
    menuAbrir.contentor,
    menuLayout.contentor,
    menuComparar.contentor,
    grupoCompararInline,
    botaoOverlay,
  );

  // 3. Ferramentas de Navegação (Cortes, Janela/Nível + Presets, Pan, Zoom, ┼ Localizar, Crosshairs)
  const grupoNavegacao = document.createElement('div');
  grupoNavegacao.className = 'grupo-botoes';
  grupoNavegacao.setAttribute('role', 'group');
  grupoNavegacao.setAttribute('aria-label', 'Navegação e janela');

  const ferramentasNav = FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'navegacao');
  const botoesFerramenta: HTMLButtonElement[] = [];

  for (const f of ferramentasNav) {
    if (f.nome === 'WindowLevel') {
      // Janela/nível como botão dividido com todos os presets de janela no menu suspenso:
      const menuJanela = criarMenuSuspenso({
        rotulo: f.rotulo,
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
            ),
          );
        });
        menuJanela.painel.append(
          divisorMenu(),
          itemMenu('Inverter preto e branco', undefined, () => void inverter(), menuJanela.fechar),
          itemMenu('Editar janelas…', undefined, () => abrirConfiguracoes('janelas'), menuJanela.fechar),
        );
      };
      montarJanelas();
      document.addEventListener(EVENTO_PREFERENCIAS, montarJanelas);
      grupoNavegacao.append(menuJanela.contentor);
    } else {
      const b = botao(
        f.rotulo,
        `Usar ${f.rotulo.toLowerCase()} com o botão esquerdo (tecla ${teclaDaFerramenta(f).toUpperCase()})`,
        () => escolherFerramentaPrimaria(f.nome),
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
    rotulo: `📏 ${ultimaMedidaEscolhida.rotulo}`,
    dica: 'Ativar ferramenta de medida atual ou abrir a lista de medidas e curva de perfusão na seta ao lado',
    acaoPrincipal: () => escolherFerramentaPrimaria(ultimaMedidaEscolhida.nome),
  });

  const iconesMedida: Record<string, string> = {
    Length: '📏',
    MidlineShift: '⊢',
    LinearRatio: '⚖',
    StenosisRatio: '٪',
    Angle: '📐',
    CobbAngleCustom: '⦜',
    ReferenceAngle: '∟',
    ArrowCustom: '↗',
    EllipticalROI: '⭕',
    PlanarFreehandROI: '✏',
    Polyline: '〰',
  };

  for (const f of ferramentasMedida) {
    const icone = iconesMedida[f.nome] ?? '📏';
    const item = itemMenu(
      `${icone} ${f.rotulo}`,
      teclaDaFerramenta(f).toUpperCase(),
      () => {
        ultimaMedidaEscolhida = f;
        escolherFerramentaPrimaria(f.nome);
      },
      menuMedidas.fechar,
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
    ),
  );

  // Botão rápido direto para Curva de Perfusão também acessível ao lado do menu de medidas:
  const botaoCurvaRapido = botao(
    '📈 Curva ROI',
    'Gerar curva tempo-intensidade / densidade por ROI ao longo dos cortes ou fases de perfusão (Ctrl+Shift+E)',
    () => void abrirCurvaPerfusaoAtiva(),
  );

  grupoNavegacao.append(menuMedidas.contentor, botaoCurvaRapido);

  // 5. Menu de Transformações da Imagem (Girar, Espelhar, Inverter, Restaurar) + Mouse
  const grupoImagem = document.createElement('div');
  grupoImagem.className = 'grupo-botoes';

  const menuTransformar = criarMenuSuspenso({
    rotulo: '🔄 Girar',
    dica: 'Girar 90° no sentido horário ou abrir mais opções (espelhar, inverter, restaurar)',
    acaoPrincipal: () => void girar90(),
  });
  menuTransformar.painel.append(
    itemMenu('Girar 90° no sentido horário', undefined, () => void girar90(), menuTransformar.fechar),
    itemMenu('Espelhar horizontalmente', undefined, () => void espelhar(), menuTransformar.fechar),
    itemMenu('Inverter preto e branco', undefined, () => void inverter(), menuTransformar.fechar),
    divisorMenu(),
    itemMenu(
      'Restaurar visualização inicial',
      'Esc',
      () => {
        limparMirasLocalizador();
        void restaurar();
      },
      menuTransformar.fechar,
    ),
  );

  const botaoRestaurarRapido = botao(
    'Restaurar',
    'Restaurar janela, zoom, rotação, espelhamento e limpar cruzinha',
    () => {
      limparMirasLocalizador();
      void restaurar();
    },
  );

  // Menu suspenso para configurar os botões Direito, Meio e Roda do mouse:
  const menuMouse = criarMenuSuspenso({
    rotulo: '🖱',
    dica: 'Escolher a função dos botões Direito, Meio e Roda do mouse',
  });
  const camposMouse: Array<[Botao, HTMLSelectElement]> = [];
  const seletores: Array<[Botao, string, OpcaoBotao[]]> = [
    ['direito', 'Botão direito', OPCOES_SECUNDARIAS],
    ['meio', 'Botão do meio', OPCOES_SECUNDARIAS],
    ['roda', 'Roda do mouse', OPCOES_RODA],
  ];
  for (const [botaoMouse, rotulo, opcoes] of seletores) {
    const linha = document.createElement('label');
    linha.className = 'linha-config-mouse';
    const span = document.createElement('span');
    span.textContent = rotulo;
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
    linha.append(span, seletor);
    menuMouse.painel.append(linha);
  }

  grupoImagem.append(menuTransformar.contentor, botaoRestaurarRapido, menuMouse.contentor);

  // 6. Cine (Tocar/Pausar + Velocidade em q/s)
  const menuCine = criarMenuSuspenso({
    rotulo: '▶ Cine',
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
  );
  const botaoMip3d = botao(
    'MIP 3D',
    'Abrir MIP rotatório 3D ao lado do corte 2D (clique num ponto intenso para ir ao corte correspondente)',
    () => void alternarMipRotatorio(),
  );

  grupoMpr3d.append(rotuloPlano, rotuloModo, controleSlab, botaoMpr, botaoMip3d);

  const config = botao('⚙', 'Configurações: medidas, atalhos e janelas', () => abrirConfiguracoes());
  config.setAttribute('aria-label', 'Configurações');
  const ajuda = botao('?', 'Atalhos de teclado (tecla ?)', () => alternarAjuda());
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
    const icone = iconesMedida[ultimaMedidaEscolhida.nome] ?? '📏';
    menuMedidas.botaoPrincipal.textContent = `${icone} ${ultimaMedidaEscolhida.rotulo}`;
    menuMedidas.botaoPrincipal.setAttribute('aria-pressed', String(Boolean(medidaAtiva)));

    for (const [botaoMouse, seletor] of camposMouse) {
      seletor.value = botaoAtribuido(botaoMouse);
    }
  }
  atualizarEstado();
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarEstado);

  function atualizarViewports(e: EstadoViewports): void {
    menuLayout.botaoPrincipal.textContent = `⊞ ${e.maximizado ? '1x1 (máx.)' : geometriaLayout(e.layout).rotulo}`;
    menuLayout.botaoPrincipal.disabled = e.mprAtivo;
    menuLayout.botaoSeta.disabled = e.mprAtivo;

    seletorPlano.value = e.planoAtivo;
    seletorPlano.disabled = e.mprAtivo || (!e.mprDisponivel && e.planoAtivo === 'original');
    rotuloPlano.hidden = e.mprAtivo;

    const emMipRotatorio = !e.mprAtivo && e.planoAtivo === 'mip-rotatorio';
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

    // Estado do modo Comparar:
    const comp = e.comparacao;
    menuComparar.botaoPrincipal.setAttribute('aria-pressed', String(comp.ativo));
    grupoCompararInline.hidden = !comp.ativo;
    if (comp.ativo) {
      botaoCadeadoRolagem.textContent = comp.rolagemLigada ? '🔒 Rolagem' : '🔓 Rolagem';
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
    menuCine.botaoPrincipal.textContent = e.cineTocando ? '⏸ Cine' : '▶ Cine';
    menuCine.botaoPrincipal.setAttribute('aria-pressed', String(e.cineTocando));
    for (const item of botoesFps) {
      item.setAttribute('aria-pressed', String(Number(item.dataset.fps) === e.fps));
    }
  }
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => {
    atualizarViewports((ev as CustomEvent<EstadoViewports>).detail);
  });
}
