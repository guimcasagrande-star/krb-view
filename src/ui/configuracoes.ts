/**
 * Janela de configurações (⚙): aparência e texto das medidas, mouse e zoom, atalhos de teclado
 * e janelas predefinidas. Tudo é guardado só neste computador (localStorage).
 */

import {
  interacao,
  JANELAS_PADRAO,
  MAX_JANELAS,
  medidas,
  preferencias,
  restaurarAtalhos,
  restaurarJanelas,
  restaurarMedidas,
  salvarPreferencias,
} from '../state/preferencias';
import { ACOES_ATALHO, teclaDaAcao } from '../tools/atalhos';
import { FERRAMENTAS_PRIMARIAS, teclaDaFerramenta } from '../tools/grupo';

let caixa: HTMLDialogElement | undefined;
let corpo: HTMLElement;
type Aba = 'medidas' | 'interacao' | 'atalhos' | 'janelas';
let abaAtual: Aba = 'medidas';

const ABAS: Array<{ id: Aba; rotulo: string }> = [
  { id: 'medidas', rotulo: 'Medidas' },
  { id: 'interacao', rotulo: 'Mouse e zoom' },
  { id: 'atalhos', rotulo: 'Atalhos' },
  { id: 'janelas', rotulo: 'Janelas' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...filhos: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const { class: classe, ...resto } = props as Record<string, unknown>;
  const e = Object.assign(document.createElement(tag), resto);
  if (classe) e.className = String(classe);
  e.append(...filhos);
  return e;
}

function linha(rotulo: string, controle: HTMLElement, dica?: string): HTMLElement {
  const l = el('label', { class: 'cfg-linha' }, el('span', {}, rotulo), controle);
  if (dica) l.title = dica;
  return l;
}

function campoNumero(valor: number, min: number, max: number, passo: number, aoMudar: (v: number) => void): HTMLInputElement {
  const i = el('input', { type: 'number', min: String(min), max: String(max), step: String(passo), value: String(valor) });
  i.addEventListener('change', () => {
    const v = Number(i.value.replace(',', '.'));
    if (!Number.isFinite(v)) {
      i.value = String(valor);
      return;
    }
    const lim = Math.min(max, Math.max(min, v));
    i.value = String(lim);
    aoMudar(lim);
  });
  return i;
}

function campoCor(valor: string, aoMudar: (v: string) => void): HTMLInputElement {
  const i = el('input', { type: 'color', value: valor });
  i.addEventListener('input', () => aoMudar(i.value));
  return i;
}

function campoCheck(valor: boolean, aoMudar: (v: boolean) => void): HTMLInputElement {
  const i = el('input', { type: 'checkbox', checked: valor });
  i.addEventListener('change', () => aoMudar(i.checked));
  return i;
}

function campoSelect<T extends string>(
  valor: T,
  opcoes: Array<[T, string]>,
  aoMudar: (v: T) => void,
): HTMLSelectElement {
  const s = el('select');
  for (const [v, r] of opcoes) s.append(el('option', { value: v, textContent: r, selected: v === valor }));
  s.addEventListener('change', () => aoMudar(s.value as T));
  return s;
}

function botaoTexto(texto: string, acao: () => void, classe = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: texto, class: classe });
  b.addEventListener('click', acao);
  return b;
}

// ---------------------------------------------------------------------------
// Aba Medidas
// ---------------------------------------------------------------------------

function abaMedidas(): HTMLElement {
  const m = medidas();
  const mudou = (): void => salvarPreferencias();
  const raiz = el('div', { class: 'cfg-aba' });

  raiz.append(
    el('h3', {}, 'Aparência'),
    linha('Cor das linhas', campoCor(m.cor, (v) => ((m.cor = v), mudou()))),
    linha('Cor do texto', campoCor(m.corTexto, (v) => ((m.corTexto = v), mudou()))),
    linha('Tamanho do texto (px)', campoNumero(m.tamanhoTexto, 8, 40, 1, (v) => ((m.tamanhoTexto = v), mudou()))),
    linha('Espessura das linhas (px)', campoNumero(m.espessura, 0.5, 8, 0.5, (v) => ((m.espessura = v), mudou()))),
    linha('Tracinhos nas extremidades', campoCheck(m.tracinhos, (v) => ((m.tracinhos = v), mudou()))),

    el('h3', {}, 'Texto das medidas'),
    linha(
      'Unidade de comprimento e área',
      campoSelect(m.unidade, [['mm', 'Milímetros (mm, mm²)'], ['cm', 'Centímetros (cm, cm²)']], (v) => ((m.unidade = v), mudou())),
    ),
    linha('Casas decimais (comprimento e área)', campoNumero(m.casas, 0, 4, 1, (v) => ((m.casas = v), mudou()))),
    linha('Casas decimais (HU, SUV, ângulo, %)', campoNumero(m.casasValores, 0, 4, 1, (v) => ((m.casasValores = v), mudou()))),

    el('h3', {}, 'Campos mostrados nas ROIs'),
  );
  const campos: Array<[keyof typeof m.roi, string]> = [
    ['area', 'Área'],
    ['media', 'Média'],
    ['desvio', 'Desvio padrão'],
    ['maximo', 'Máximo'],
    ['minimo', 'Mínimo'],
    ['perimetro', 'Perímetro (mão livre)'],
  ];
  for (const [k, r] of campos) raiz.append(linha(r, campoCheck(m.roi[k], (v) => ((m.roi[k] = v), mudou()))));

  raiz.append(
    el('h3', {}, 'Desenho e seleção'),
    linha(
      'Estilo de desenho (Cobb, razões, estenose, desvio, seta)',
      campoSelect(
        m.modoClique,
        [
          ['arrastar', 'Pressionar, arrastar e soltar (também aceita clicar)'],
          ['clicar', 'Só cliques (um clique por ponto)'],
        ],
        (v) => ((m.modoClique = v), mudou()),
      ),
    ),
    linha(
      'Alcance do clique para selecionar (px)',
      campoNumero(m.tolerancia, 4, 40, 1, (v) => ((m.tolerancia = v), mudou())),
      'Quanto maior, mais fácil selecionar uma medida clicando perto dela.',
    ),
    botaoTexto('Restaurar padrão das medidas', () => {
      restaurarMedidas();
      desenhar();
    }),
  );
  return raiz;
}

// ---------------------------------------------------------------------------
// Aba Mouse e zoom
// ---------------------------------------------------------------------------

function abaInteracao(): HTMLElement {
  const it = interacao();
  const mudou = (): void => salvarPreferencias();
  const raiz = el('div', { class: 'cfg-aba' });
  raiz.append(
    el('h3', {}, 'Zoom'),
    linha(
      'Zoom a partir do centro da imagem',
      campoCheck(it.zoomNoCentro, (v) => ((it.zoomNoCentro = v), mudou())),
      'Ligado: a imagem cresce a partir do centro do quadro. Desligado: a partir do ponto onde está o mouse.',
    ),
    el('h3', {}, 'Medidas'),
    linha(
      'Voltar a passar cortes depois de cada medida',
      campoCheck(it.voltarAoScroll, (v) => ((it.voltarAoScroll = v), mudou())),
      'Ligado: ao terminar uma medida (linha, ângulo, ROI, sonda...), o botão esquerdo volta a passar cortes (crosshairs no MPR). Desligado: a ferramenta de medida continua ativa.',
    ),
    el(
      'p',
      { class: 'cfg-dica' },
      'A ferramenta de cada botão do mouse é escolhida no menu 🖱 da barra. Clique com o botão direito, sem arrastar, abre o menu rápido.',
    ),
  );
  return raiz;
}

// ---------------------------------------------------------------------------
// Aba Atalhos
// ---------------------------------------------------------------------------

interface ItemAtalho {
  chave: string;
  rotulo: string;
  padrao: string;
  atual: () => string;
}

function itensAtalho(): ItemAtalho[] {
  const ferramentas = FERRAMENTAS_PRIMARIAS.map<ItemAtalho>((f) => ({
    chave: f.nome,
    rotulo: f.rotulo,
    padrao: f.tecla,
    atual: () => teclaDaFerramenta(f),
  }));
  const acoes = ACOES_ATALHO.map<ItemAtalho>((a) => ({
    chave: `acao:${a.id}`,
    rotulo: a.rotulo,
    padrao: a.tecla,
    atual: () => teclaDaAcao(a.id),
  }));
  return [...ferramentas, ...acoes];
}

let mensagemAtalho = '';

function abaAtalhos(): HTMLElement {
  const raiz = el('div', { class: 'cfg-aba' });
  raiz.append(
    el(
      'p',
      { class: 'cfg-dica' },
      'Clique numa tecla e pressione a nova. Delete/Backspace volta ao padrão. As teclas 1 a 9 são das janelas; Esc, Delete, Espaço, setas e ? são fixas.',
    ),
  );
  if (mensagemAtalho) raiz.append(el('p', { class: 'cfg-aviso' }, mensagemAtalho));

  const itens = itensAtalho();
  const tabela = el('table', { class: 'cfg-tabela' });
  for (const item of itens) {
    const b = el('button', { type: 'button', class: 'cfg-tecla', textContent: item.atual().toUpperCase() || '—' });
    b.addEventListener('click', () => capturarTecla(b, item, itens));
    tabela.append(el('tr', {}, el('td', {}, item.rotulo), el('td', {}, b)));
  }
  raiz.append(
    tabela,
    botaoTexto('Restaurar atalhos padrão', () => {
      mensagemAtalho = '';
      restaurarAtalhos();
      desenhar();
    }),
  );
  return raiz;
}

function capturarTecla(botao: HTMLButtonElement, item: ItemAtalho, todos: ItemAtalho[]): void {
  botao.textContent = 'pressione…';
  botao.classList.add('capturando');
  const aoTecla = (ev: KeyboardEvent): void => {
    ev.preventDefault();
    ev.stopPropagation();
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(ev.key)) return;
    caixa?.removeEventListener('keydown', aoTecla, true);
    botao.classList.remove('capturando');
    const atalhos = preferencias().atalhos;
    mensagemAtalho = '';
    if (ev.key === 'Escape') {
      desenhar();
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      delete atalhos[item.chave];
    } else {
      const tecla = ev.key.toLowerCase();
      if (tecla.length !== 1 || /[0-9?\s]/.test(tecla)) {
        mensagemAtalho = 'Tecla não permitida: use uma letra ou símbolo (1 a 9, ?, Espaço e teclas especiais são fixos).';
      } else {
        const conflito = todos.find((o) => o.chave !== item.chave && o.atual() === tecla);
        if (conflito) {
          mensagemAtalho = `A tecla ${tecla.toUpperCase()} já é de “${conflito.rotulo}”. Troque aquela primeiro.`;
        } else if (tecla === item.padrao) {
          delete atalhos[item.chave];
        } else {
          atalhos[item.chave] = tecla;
        }
      }
    }
    salvarPreferencias();
    desenhar();
  };
  caixa?.addEventListener('keydown', aoTecla, true);
}

// ---------------------------------------------------------------------------
// Aba Janelas
// ---------------------------------------------------------------------------

function abaJanelas(): HTMLElement {
  const raiz = el('div', { class: 'cfg-aba' });
  const janelas = preferencias().janelas;
  raiz.append(
    el(
      'p',
      { class: 'cfg-dica' },
      `Centro e largura em HU (TC). As teclas 1 a ${MAX_JANELAS} aplicam as janelas na ordem da lista (máximo ${MAX_JANELAS}).`,
    ),
  );
  const tabela = el('table', { class: 'cfg-tabela' });
  tabela.append(
    el('tr', {}, el('th', {}, 'Tecla'), el('th', {}, 'Nome'), el('th', {}, 'Centro'), el('th', {}, 'Largura'), el('th', {})),
  );
  janelas.forEach((j, i) => {
    const nome = el('input', { type: 'text', value: j.rotulo, maxLength: 40 });
    nome.addEventListener('change', () => {
      j.rotulo = nome.value.trim() || 'Janela';
      salvarPreferencias();
    });
    const centro = campoNumero(j.centro, -5000, 10000, 1, (v) => ((j.centro = v), salvarPreferencias()));
    const largura = campoNumero(j.largura, 1, 20000, 1, (v) => ((j.largura = v), salvarPreferencias()));
    const apagar = botaoTexto('✕', () => {
      janelas.splice(i, 1);
      salvarPreferencias();
      desenhar();
    });
    apagar.title = 'Remover esta janela';
    tabela.append(
      el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, nome), el('td', {}, centro), el('td', {}, largura), el('td', {}, apagar)),
    );
  });
  const adicionar = botaoTexto('+ Adicionar janela', () => {
    janelas.push({ rotulo: 'Nova janela', centro: 40, largura: 400 });
    salvarPreferencias();
    desenhar();
  });
  adicionar.disabled = janelas.length >= MAX_JANELAS;
  raiz.append(
    tabela,
    adicionar,
    botaoTexto(`Restaurar as ${JANELAS_PADRAO.length} janelas padrão`, () => {
      restaurarJanelas();
      desenhar();
    }),
  );
  return raiz;
}

// ---------------------------------------------------------------------------

function desenhar(): void {
  const abas: Record<Aba, () => HTMLElement> = {
    medidas: abaMedidas,
    interacao: abaInteracao,
    atalhos: abaAtalhos,
    janelas: abaJanelas,
  };
  corpo.replaceChildren(abas[abaAtual]());
  for (const b of caixa!.querySelectorAll<HTMLButtonElement>('.cfg-abas button')) {
    b.classList.toggle('ativa', b.dataset.aba === abaAtual);
  }
}

function criarCaixa(): HTMLDialogElement {
  if (caixa) return caixa;
  const d = el('dialog', { id: 'configuracoes' });
  d.setAttribute('aria-label', 'Configurações');
  const abas = el('div', { class: 'cfg-abas' });
  for (const a of ABAS) {
    const b = botaoTexto(a.rotulo, () => {
      abaAtual = a.id;
      mensagemAtalho = '';
      desenhar();
    });
    b.dataset.aba = a.id;
    abas.append(b);
  }
  corpo = el('div', { class: 'cfg-corpo' });
  d.append(
    el('h2', {}, '⚙ Configurações'),
    abas,
    corpo,
    botaoTexto('Fechar', () => d.close(), 'cfg-fechar'),
  );
  // Teclas digitadas aqui não podem disparar atalhos do visualizador (ex.: Delete apagar medida).
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  caixa = d;
  return d;
}

export function abrirConfiguracoes(aba?: Aba): void {
  const d = criarCaixa();
  if (aba) abaAtual = aba;
  mensagemAtalho = '';
  desenhar();
  if (!d.open) d.showModal();
}
