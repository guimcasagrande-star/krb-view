/**
 * Barra de ferramentas no topo: escolha da ferramenta do botão esquerdo, ações sobre
 * a imagem, layout/plano/MPR/slab e presets de janela. Os mesmos comandos têm atalho de teclado (ver tools/atalhos).
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
  girar90,
  inverter,
  limparMedidas,
  OPCOES_RODA,
  OPCOES_SECUNDARIAS,
  type OpcaoBotao,
  PREDEFINICOES,
  restaurar,
} from '../tools/grupo';
import { alternarAjuda } from '../tools/atalhos';
import { VELOCIDADES_CINE } from '../viewer/cine';
import {
  alternarCine,
  alternarMpr,
  definirLayout,
  definirModoSlabAtivo,
  definirPlanoSlotAtivo,
  definirSlabMpr,
  definirVelocidadeCine,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  LAYOUTS,
  type ModoSlab,
  ORDEM_LAYOUTS,
  type PlanoSlot,
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

const OPCOES_PLANO: Array<{ valor: PlanoSlot; rotulo: string }> = [
  { valor: 'original', rotulo: 'Original' },
  { valor: 'axial', rotulo: 'Axial' },
  { valor: 'coronal', rotulo: 'Coronal' },
  { valor: 'sagital', rotulo: 'Sagital' },
];

const OPCOES_MODO_SLAB: Array<{ valor: ModoSlab; rotulo: string }> = [
  { valor: 'normal', rotulo: 'Normal' },
  { valor: 'mip', rotulo: 'MIP' },
  { valor: 'minip', rotulo: 'MinIP' },
  { valor: 'media', rotulo: 'Média' },
];

/** Monta a barra dentro de `contentor` (o #ferramentas do index.html). */
export function iniciarBarraFerramentas(contentor: HTMLElement): void {
  contentor.replaceChildren();
  const grupoFerramentas = document.createElement('div');
  grupoFerramentas.className = 'grupo-botoes';
  grupoFerramentas.setAttribute('role', 'group');
  grupoFerramentas.setAttribute('aria-label', 'Ferramenta do botão esquerdo');

  const botoesFerramenta = FERRAMENTAS_PRIMARIAS.map((f) => {
    const b = botao(
      f.rotulo,
      `Usar ${f.rotulo.toLowerCase()} com o botão esquerdo (tecla ${f.tecla.toUpperCase()})`,
      () => escolherFerramentaPrimaria(f.nome),
    );
    b.dataset.ferramenta = f.nome;
    if (f.apenasMpr) b.dataset.apenasMpr = 'true';
    return b;
  });
  grupoFerramentas.append(...botoesFerramenta);

  // Botões direito, meio e roda: escolha de ferramenta por seletor.
  const grupoMouse = document.createElement('div');
  grupoMouse.className = 'grupo-botoes';
  const campos: Array<[Botao, HTMLSelectElement]> = [];
  const seletores: Array<[Botao, string, OpcaoBotao[]]> = [
    ['direito', 'Direito', OPCOES_SECUNDARIAS],
    ['meio', 'Meio', OPCOES_SECUNDARIAS],
    ['roda', 'Roda', OPCOES_RODA],
  ];
  for (const [botaoMouse, rotulo, opcoes] of seletores) {
    const rotuloCampo = document.createElement('label');
    rotuloCampo.className = 'seletor-botao';
    rotuloCampo.textContent = rotulo + ' ';
    const seletor = document.createElement('select');
    seletor.setAttribute('aria-label', `Ferramenta do botão ${rotulo.toLowerCase()}`);
    for (const opcao of opcoes) {
      const o = document.createElement('option');
      o.value = opcao.nome;
      o.textContent = opcao.rotulo;
      seletor.append(o);
    }
    seletor.value = botaoAtribuido(botaoMouse);
    campos.push([botaoMouse, seletor]);
    seletor.addEventListener('change', () => definirBotao(botaoMouse, seletor.value));
    rotuloCampo.append(seletor);
    grupoMouse.append(rotuloCampo);
  }

  const grupoImagem = document.createElement('div');
  grupoImagem.className = 'grupo-botoes';
  grupoImagem.append(
    botao('Inverter', 'Inverter preto e branco', () => void inverter()),
    botao('Girar 90°', 'Girar a imagem 90° no sentido horário', () => void girar90()),
    botao('Espelhar', 'Espelhar na horizontal', () => void espelhar()),
    botao('Restaurar', 'Restaurar janela, zoom, rotação, espelhamento e crosshairs', () => void restaurar()),
  );

  // Layout da grade, seletor de plano, modo de projeção (Normal/MIP/MinIP/Média), slab e MPR.
  const grupoLayout = document.createElement('div');
  grupoLayout.className = 'grupo-botoes';
  grupoLayout.setAttribute('role', 'group');
  grupoLayout.setAttribute('aria-label', 'Layout dos viewports, plano, projeção e MPR');
  const botoesLayout = ORDEM_LAYOUTS.map((id) => {
    const b = botao(LAYOUTS[id].rotulo, `Layout ${LAYOUTS[id].rotulo} (tecla L alterna)`, () => void definirLayout(id));
    b.dataset.layout = id;
    return b;
  });

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

  const botaoMpr = botao('MPR', 'Modo MPR completo: axial, coronal e sagital lado a lado (tecla R)', () => void alternarMpr());

  grupoLayout.append(...botoesLayout, rotuloPlano, rotuloModo, controleSlab, botaoMpr);

  const grupoCine = document.createElement('div');
  grupoCine.className = 'grupo-botoes';
  const botaoCine = botao('▶ Cine', 'Tocar ou pausar o cine (barra de espaço)', () => alternarCine());
  const rotuloFps = document.createElement('label');
  rotuloFps.className = 'seletor-botao';
  const seletorFps = document.createElement('select');
  seletorFps.setAttribute('aria-label', 'Velocidade do cine em quadros por segundo');
  for (const fps of VELOCIDADES_CINE) {
    const o = document.createElement('option');
    o.value = String(fps);
    o.textContent = `${fps} q/s`;
    seletorFps.append(o);
  }
  seletorFps.addEventListener('change', () => definirVelocidadeCine(Number(seletorFps.value)));
  rotuloFps.append(seletorFps);
  grupoCine.append(botaoCine, rotuloFps);

  const grupoPresets = document.createElement('div');
  grupoPresets.className = 'grupo-botoes';
  PREDEFINICOES.forEach((p, i) => {
    grupoPresets.append(
      botao(p.rotulo, `Janela ${p.rotulo.toLowerCase()} (tecla ${i + 1})`, () => void aplicarPredefinicao(i)),
    );
  });

  const grupoMedidas = document.createElement('div');
  grupoMedidas.className = 'grupo-botoes';
  grupoMedidas.append(
    botao('Apagar selecionada', 'Apagar a medida selecionada (Delete)', () => void apagarSelecionadas()),
    botao('Limpar medidas', 'Apagar todas as medidas da série', () => void limparMedidas()),
  );

  const ajuda = botao('?', 'Atalhos de teclado', () => alternarAjuda());
  ajuda.setAttribute('aria-label', 'Atalhos de teclado');

  contentor.append(
    grupoFerramentas,
    separador(),
    grupoMouse,
    separador(),
    grupoLayout,
    grupoCine,
    separador(),
    grupoImagem,
    separador(),
    grupoPresets,
    separador(),
    grupoMedidas,
    ajuda,
  );

  /** Reflete na barra a ferramenta de cada botão do mouse (também quando muda por atalho). */
  function atualizarEstado(): void {
    const atual = ferramentaPrimariaAtual();
    const mpr = emModoMprFerramentas();
    for (const b of botoesFerramenta) {
      if (b.dataset.apenasMpr === 'true') {
        b.hidden = !mpr;
      }
      b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    }
    for (const [botaoMouse, seletor] of campos) seletor.value = botaoAtribuido(botaoMouse);
  }
  atualizarEstado();
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarEstado);

  function atualizarViewports(e: EstadoViewports): void {
    for (const b of botoesLayout) {
      b.setAttribute('aria-pressed', String(!e.mprAtivo && b.dataset.layout === e.layout));
    }
    seletorPlano.value = e.planoAtivo;
    seletorPlano.disabled = e.mprAtivo || !e.mprDisponivel;

    const podeVolume = e.mprAtivo || e.mprDisponivel;
    seletorModo.value = e.modoSlabAtivo;
    seletorModo.disabled = !podeVolume;
    sliderSlab.disabled = !podeVolume;
    sliderSlab.value = String(e.slabMm);
    valorSlab.textContent = formatarMm(e.slabMm);

    botaoMpr.setAttribute('aria-pressed', String(e.mprAtivo));
    botaoMpr.disabled = !e.mprAtivo && !e.mprDisponivel;

    botaoCine.disabled = e.mprAtivo || e.pilhaId === null;
    botaoCine.textContent = e.cineTocando ? '⏸ Cine' : '▶ Cine';
    botaoCine.setAttribute('aria-pressed', String(e.cineTocando));
    seletorFps.value = String(e.fps);
    atualizarEstado();
  }
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) =>
    atualizarViewports((ev as CustomEvent<EstadoViewports>).detail),
  );
  atualizarViewports({
    layout: '1x1',
    pilhaId: null,
    cineTocando: false,
    fps: 10,
    mprAtivo: false,
    mprDisponivel: false,
    planoAtivo: 'original',
    modoSlabAtivo: 'normal',
    slabMm: 1,
  });
}
