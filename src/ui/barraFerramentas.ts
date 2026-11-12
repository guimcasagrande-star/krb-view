/**
 * Barra de ferramentas no topo: escolha da ferramenta do botão esquerdo, ações sobre
 * a imagem e presets de janela. Os mesmos comandos têm atalho de teclado (ver tools/atalhos).
 */

import {
  aplicarPredefinicao,
  apagarSelecionadas,
  espelhar,
  ferramentaPrimariaAtual,
  escolherFerramentaPrimaria,
  FERRAMENTAS_PRIMARIAS,
  girar90,
  inverter,
  limparMedidas,
  PREDEFINICOES,
  restaurar,
} from '../tools/grupo';
import { alternarAjuda } from '../tools/atalhos';

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
    const b = botao(f.rotulo, `Usar ${f.rotulo.toLowerCase()} com o botão esquerdo`, () => {
      escolherFerramentaPrimaria(f.nome);
      atualizarEstado();
    });
    b.dataset.ferramenta = f.nome;
    return b;
  });
  grupoFerramentas.append(...botoesFerramenta);

  const grupoImagem = document.createElement('div');
  grupoImagem.className = 'grupo-botoes';
  grupoImagem.append(
    botao('Inverter', 'Inverter preto e branco', () => void inverter()),
    botao('Girar 90°', 'Girar a imagem 90° no sentido horário', () => void girar90()),
    botao('Espelhar', 'Espelhar na horizontal', () => void espelhar()),
    botao('Restaurar', 'Restaurar janela, zoom, rotação e espelhamento', () => void restaurar()),
  );

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

  contentor.append(grupoFerramentas, separador(), grupoImagem, separador(), grupoPresets, separador(), grupoMedidas, ajuda);

  function atualizarEstado(): void {
    const atual = ferramentaPrimariaAtual();
    for (const b of botoesFerramenta) {
      b.setAttribute('aria-pressed', String(b.dataset.ferramenta === atual));
    }
  }
  atualizarEstado();
}
