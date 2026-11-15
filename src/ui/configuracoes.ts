/**
 * Janela de configurações (⚙): aparência e texto das medidas, mouse e zoom, atalhos de teclado
 * e janelas predefinidas. Tudo é guardado só neste computador (localStorage).
 */

import {
  favoritosMenu,
  interacao,
  JANELAS_PADRAO,
  MAX_JANELAS,
  medidas,
  type ModoTelaJanela,
  preferencias,
  restaurarAtalhos,
  restaurarFavoritosMenu,
  restaurarJanelas,
  restaurarMedidas,
  restaurarTelas,
  salvarPreferencias,
  telas,
  TOTAL_FAVORITOS_MENU,
} from '../state/preferencias';
import { ACOES_ATALHO, teclaDaAcao } from '../tools/atalhos';
import { FERRAMENTAS_PRIMARIAS, teclaDaFerramenta } from '../tools/grupo';
import { iconeFavoritoMenu, listarOpcoesFavoritosMenu } from './menuContexto';
import {
  aplicarExibicaoJanelaAtual,
  aplicarPresetVisualizacao,
  type InfoMonitor,
  listarMonitoresDisponiveis,
  notificarPreferenciasParaOutraJanela,
  segundaJanelaDisponivel,
} from '../viewer/segundaJanela';

let caixa: HTMLDialogElement | undefined;
let corpo: HTMLElement;
export type AbaConfiguracoes = 'medidas' | 'interacao' | 'telas' | 'atalhos' | 'janelas';
let abaAtual: AbaConfiguracoes = 'medidas';

const ABAS: Array<{ id: AbaConfiguracoes; rotulo: string }> = [
  { id: 'medidas', rotulo: 'Medidas' },
  { id: 'interacao', rotulo: 'Mouse e zoom' },
  { id: 'telas', rotulo: 'Telas e monitores' },
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
  const favs = favoritosMenu();
  const opcoesFav = listarOpcoesFavoritosMenu();
  const gruposFav = new Map<string, typeof opcoesFav>();
  for (const op of opcoesFav) {
    const lista = gruposFav.get(op.grupo) ?? [];
    lista.push(op);
    gruposFav.set(op.grupo, lista);
  }
  const mudou = (): void => {
    salvarPreferencias();
    notificarPreferenciasParaOutraJanela();
  };
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
    el('h3', {}, 'Favoritos do botão direito (6 botões esquemáticos no topo)'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Escolha a função de cada um dos 6 botões sem texto no topo do menu de clique direito sobre a imagem.',
    ),
  );

  const GradePrevia = el('div', { class: 'cfg-favoritos-previa' });
  const iconesPrevia: HTMLElement[] = [];
  for (let i = 0; i < TOTAL_FAVORITOS_MENU; i += 1) {
    const idAtual = favs[i] ?? opcoesFav[i]?.id ?? opcoesFav[0]!.id;
    const opAtual = opcoesFav.find((o) => o.id === idAtual) ?? opcoesFav[0]!;
    const caixaIcone = el('span', { class: 'menu-flutuante-fav', title: `${i + 1}. ${opAtual.rotulo}` });
    caixaIcone.innerHTML = iconeFavoritoMenu(opAtual.id);
    iconesPrevia.push(caixaIcone);
    GradePrevia.append(caixaIcone);
  }
  raiz.append(GradePrevia);

  for (let i = 0; i < TOTAL_FAVORITOS_MENU; i += 1) {
    const idAtual = favs[i] ?? opcoesFav[i]?.id ?? opcoesFav[0]!.id;
    const miniatura = el('span', { class: 'cfg-fav-icone' });
    miniatura.innerHTML = iconeFavoritoMenu(idAtual);

    const sel = el('select');
    for (const [nomeGrupo, itensGrupo] of gruposFav) {
      const optgroup = el('optgroup', { label: nomeGrupo });
      for (const op of itensGrupo) {
        const textoOp = op.atalho ? `${op.rotulo} (${op.atalho})` : op.rotulo;
        optgroup.append(el('option', { value: op.id, textContent: textoOp, selected: op.id === idAtual }));
      }
      sel.append(optgroup);
    }

    sel.addEventListener('change', () => {
      favs[i] = sel.value;
      miniatura.innerHTML = iconeFavoritoMenu(sel.value);
      const opNova = opcoesFav.find((o) => o.id === sel.value);
      if (iconesPrevia[i]) {
        iconesPrevia[i].innerHTML = iconeFavoritoMenu(sel.value);
        if (opNova) iconesPrevia[i].title = `${i + 1}. ${opNova.rotulo}`;
      }
      mudou();
    });

    const rotuloSlot = el('span', { class: 'cfg-fav-rotulo' }, miniatura, el('span', {}, `Botão favorito ${i + 1}`));
    raiz.append(el('label', { class: 'cfg-linha' }, rotuloSlot, sel));
  }

  raiz.append(
    botaoTexto('Restaurar os 6 favoritos padrão', () => {
      restaurarFavoritosMenu();
      notificarPreferenciasParaOutraJanela();
      desenhar();
    }),
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
// Aba Telas e monitores
// ---------------------------------------------------------------------------

const OPCOES_GRADE_PADRAO: Array<[string, string]> = [
  ['1x1', '1×1 (quadro único)'],
  ['1x2', '1×2 (2 lado a lado)'],
  ['2x1', '2×1 (2 empilhados)'],
  ['2x2', '2×2 (4 quadros)'],
  ['1x3', '1×3 (3 lado a lado)'],
  ['2x3', '2×3 (6 quadros)'],
  ['3x3', '3×3 (9 quadros)'],
  ['3x4', '3×4 (12 quadros)'],
  ['4x4', '4×4 (16 quadros)'],
  ['5x5', '5×5 (25 quadros)'],
];

const OPCOES_MODO_TELA: Array<[ModoTelaJanela, string]> = [
  ['maximizada', 'Sempre abrir ocupando a tela toda (maximizada)'],
  ['tela-cheia', 'Sempre abrir em tela cheia total (sem bordas / F11)'],
  ['normal', 'Janela normal (tamanho restaurado)'],
];

let monitoresCache: InfoMonitor[] = [];

function formatarMonitor(m: InfoMonitor): string {
  const esc = Math.round(m.escala * 100);
  return `${m.nome} (${m.largura}×${m.altura}, escala ${esc}%)`;
}

function abaTelas(): HTMLElement {
  const tl = telas();
  const salvarENotificar = (): void => {
    salvarPreferencias();
    notificarPreferenciasParaOutraJanela();
  };
  const raiz = el('div', { class: 'cfg-aba' });

  raiz.append(
    el('h3', {}, 'Grades padrão ao abrir o programa'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Ficam salvas neste computador. Exemplo: deixar 2×2 na janela principal e 1×2 na 2ª janela.',
    ),
    linha(
      'Grade inicial da 1ª janela (monitor principal)',
      campoSelect(tl.gradePrincipal, OPCOES_GRADE_PADRAO, (v) => {
        tl.gradePrincipal = v;
        salvarENotificar();
      }),
    ),
    linha(
      'Grade inicial da 2ª janela (outro monitor)',
      campoSelect(tl.gradeSecundaria, OPCOES_GRADE_PADRAO, (v) => {
        tl.gradeSecundaria = v;
        salvarENotificar();
      }),
    ),
    botaoTexto('Usar 2×2 na 1ª janela + 1×2 na 2ª janela como padrão e aplicar agora', () => {
      tl.gradePrincipal = '2x2';
      tl.gradeSecundaria = '1x2';
      salvarENotificar();
      desenhar();
      void aplicarPresetVisualizacao({
        id: 'rapido-2x2-1x2',
        rotulo: '2x2 + 1x2',
        gradePrincipal: '2x2',
        usarSegundaJanela: segundaJanelaDisponivel(),
        gradeSecundaria: '1x2',
      });
    }),
  );

  if (segundaJanelaDisponivel()) {
    const opcoesMonPrincipal: Array<[string, string]> = [
      ['auto', 'Automático (monitor padrão do sistema)'],
      ...monitoresCache.map<[string, string]>((m) => [m.id, formatarMonitor(m)]),
    ];
    if (tl.monitorPrincipal !== 'auto' && !opcoesMonPrincipal.some(([id]) => id === tl.monitorPrincipal)) {
      opcoesMonPrincipal.push([tl.monitorPrincipal, `Salvo: ${tl.monitorPrincipal}`]);
    }

    const opcoesMonSecundaria: Array<[string, string]> = [
      ['auto', 'Automático (sempre enviar para o 2º monitor)'],
      ...monitoresCache.map<[string, string]>((m) => [m.id, formatarMonitor(m)]),
    ];
    if (tl.monitorSecundaria !== 'auto' && !opcoesMonSecundaria.some(([id]) => id === tl.monitorSecundaria)) {
      opcoesMonSecundaria.push([tl.monitorSecundaria, `Salvo: ${tl.monitorSecundaria}`]);
    }

    const resumoMonitores = el(
      'p',
      { class: 'cfg-dica' },
      monitoresCache.length > 0
        ? `Monitores identificados neste PC (${monitoresCache.length}): ${monitoresCache.map((m) => formatarMonitor(m)).join(' · ')}`
        : 'Identificando monitores conectados…',
    );

    raiz.append(
      el('h3', {}, 'Monitores e tela cheia'),
      resumoMonitores,
      linha(
        'Monitor padrão da 1ª janela',
        campoSelect(tl.monitorPrincipal, opcoesMonPrincipal, (v) => {
          tl.monitorPrincipal = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Monitor padrão da 2ª janela',
        campoSelect(tl.monitorSecundaria, opcoesMonSecundaria, (v) => {
          tl.monitorSecundaria = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
        'Em "Automático", a 2ª janela vai sempre para o monitor diferente do da 1ª janela.',
      ),
      linha(
        'Tamanho ao abrir a 1ª janela',
        campoSelect(tl.modoTelaPrincipal, OPCOES_MODO_TELA, (v) => {
          tl.modoTelaPrincipal = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Tamanho ao abrir a 2ª janela',
        campoSelect(tl.modoTelaSecundaria, OPCOES_MODO_TELA, (v) => {
          tl.modoTelaSecundaria = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Abrir a 2ª janela automaticamente ao iniciar (quando houver 2º monitor)',
        campoCheck(tl.abrirSecundariaAoIniciar, (v) => {
          tl.abrirSecundariaAoIniciar = v;
          salvarENotificar();
        }),
      ),
      botaoTexto('🔄 Atualizar lista de monitores e posicionar janela agora', () => {
        void listarMonitoresDisponiveis().then((lista) => {
          monitoresCache = lista;
          void aplicarExibicaoJanelaAtual();
          if (abaAtual === 'telas') desenhar();
        });
      }),
    );

    if (monitoresCache.length === 0) {
      void listarMonitoresDisponiveis().then((lista) => {
        if (lista.length > 0 && monitoresCache.length === 0) {
          monitoresCache = lista;
          if (caixa?.open && abaAtual === 'telas') desenhar();
        }
      });
    }
  }

  raiz.append(
    el('h3', {}, 'Visualizações predefinidas (1 e 2 monitores)'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Combinações prontas que também aparecem no menu ⊞ da barra de ferramentas para aplicar com 1 clique.',
    ),
  );

  const tabela = el('table', { class: 'cfg-tabela' });
  tabela.append(
    el(
      'tr',
      {},
      el('th', {}, 'Nome'),
      el('th', {}, '1ª janela'),
      el('th', {}, 'Abrir 2ª'),
      el('th', {}, '2ª janela'),
      el('th', {}),
      el('th', {}),
    ),
  );

  tl.presets.forEach((p, idx) => {
    const inpNome = el('input', { type: 'text', value: p.rotulo, maxLength: 60 });
    inpNome.addEventListener('change', () => {
      p.rotulo = inpNome.value.trim() || 'Visualização';
      salvarENotificar();
    });
    const selG1 = campoSelect(p.gradePrincipal, OPCOES_GRADE_PADRAO, (v) => {
      p.gradePrincipal = v;
      salvarENotificar();
    });
    const chk2 = campoCheck(p.usarSegundaJanela, (v) => {
      p.usarSegundaJanela = v;
      salvarENotificar();
    });
    const selG2 = campoSelect(p.gradeSecundaria, OPCOES_GRADE_PADRAO, (v) => {
      p.gradeSecundaria = v;
      salvarENotificar();
    });
    const btnAplicar = botaoTexto('Aplicar', () => {
      void aplicarPresetVisualizacao(p);
    });
    const btnApagar = botaoTexto('✕', () => {
      tl.presets.splice(idx, 1);
      salvarENotificar();
      desenhar();
    });
    btnApagar.title = 'Remover esta visualização';
    tabela.append(
      el(
        'tr',
        {},
        el('td', {}, inpNome),
        el('td', {}, selG1),
        el('td', {}, chk2),
        el('td', {}, selG2),
        el('td', {}, btnAplicar),
        el('td', {}, btnApagar),
      ),
    );
  });

  const btnAdicionar = botaoTexto('+ Adicionar visualização de grade', () => {
    tl.presets.push({
      id: `preset-${Date.now()}`,
      rotulo: `2 monitores: ${tl.gradePrincipal} + ${tl.gradeSecundaria}`,
      gradePrincipal: tl.gradePrincipal,
      usarSegundaJanela: true,
      gradeSecundaria: tl.gradeSecundaria,
    });
    salvarENotificar();
    desenhar();
  });
  btnAdicionar.disabled = tl.presets.length >= 12;

  raiz.append(
    tabela,
    btnAdicionar,
    botaoTexto('Restaurar padrão de telas e monitores', () => {
      restaurarTelas();
      notificarPreferenciasParaOutraJanela();
      desenhar();
    }),
  );

  return raiz;
}

// ---------------------------------------------------------------------------

function desenhar(): void {
  const abas: Record<AbaConfiguracoes, () => HTMLElement> = {
    medidas: abaMedidas,
    interacao: abaInteracao,
    telas: abaTelas,
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

export function abrirConfiguracoes(aba?: AbaConfiguracoes): void {
  const d = criarCaixa();
  if (aba) abaAtual = aba;
  mensagemAtalho = '';
  desenhar();
  if (!d.open) d.showModal();
}
