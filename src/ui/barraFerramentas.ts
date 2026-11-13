/**
 * Barra de ferramentas no topo: escolha da ferramenta do botão esquerdo, ações sobre
 * a imagem e presets de janela. Os mesmos comandos têm atalho de teclado (ver tools/atalhos).
 */

import {
  aplicarPredefinicao,
  apagarSelecionadas,
  botaoAtribuido,
  type Botao,
  definirBotao,
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
  definirLayout,
  definirVelocidadeCine,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  LAYOUTS,
  ORDEM_LAYOUTS,
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
    botao('Restaurar', 'Restaurar janela, zoom, rotação e espelhamento', () => void restaurar()),
  );

  // Layout da grade e cine.
  const grupoLayout = document.createElement('div');
  grupoLayout.className = 'grupo-botoes';
  grupoLayout.setAttribute('role', 'group');
  grupoLayout.setAttribute('aria-label', 'Layout dos viewports');
  const botoesLayout = ORDEM_LAYOUTS.map((id) => {
    const b = botao(LAYOUTS[id].rotulo, `Layout ${LAYOUTS[id].rotulo} (tecla L alterna)`, () => void definirLayout(id));
    b.dataset.layout = id;
    return b;
  });
  grupoLayout.append(...botoesLayout);

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
    for (const b of botoesFerramenta) {
      b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    }
    for (const [botaoMouse, seletor] of campos) seletor.value = botaoAtribuido(botaoMouse);
  }
  atualizarEstado();
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarEstado);

  function atualizarViewports(e: EstadoViewports): void {
    for (const b of botoesLayout) b.setAttribute('aria-pressed', String(b.dataset.layout === e.layout));
    botaoCine.textContent = e.cineTocando ? '⏸ Cine' : '▶ Cine';
    botaoCine.setAttribute('aria-pressed', String(e.cineTocando));
    seletorFps.value = String(e.fps);
  }
  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => atualizarViewports((ev as CustomEvent<EstadoViewports>).detail));
  atualizarViewports({ layout: '1x1', pilhaId: null, cineTocando: false, fps: 10 });
}
