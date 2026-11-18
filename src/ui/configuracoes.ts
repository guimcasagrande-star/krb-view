/**
 * Janela de configurações (⚙): aparência e texto das medidas, mouse e zoom, atalhos de teclado
 * e janelas predefinidas. Tudo é guardado só neste computador (localStorage).
 */

import {
  favoritosMenu,
  interacao,
  ITENS_PERSONALIZAVEIS_BARRA,
  JANELAS_PADRAO,
  MAX_JANELAS,
  medidas,
  type ModoTelaJanela,
  type PosicaoBarraSeries,
  preferencias,
  type PreferenciaGpu,
  type Qualidade3d,
  restaurarAtalhos,
  restaurarFavoritosMenu,
  restaurarJanelas,
  restaurarMedidas,
  restaurarTelas,
  salvarPreferencias,
  telas,
  TOTAL_FAVORITOS_MENU,
} from '../state/preferencias';
import { sincronizarPreferenciaGpuNativa } from '../viewer/iniciar';
import { ACOES_ATALHO, teclaDaAcao } from '../tools/atalhos';
import { FERRAMENTAS_PRIMARIAS, teclaDaFerramenta } from '../tools/grupo';
import { iconeFavoritoMenu, listarOpcoesFavoritosMenu } from './menuContexto';
import {
  aplicarExibicaoJanelaAtual,
  aplicarGradesPadraoAtuais,
  aplicarPresetVisualizacao,
  type InfoMonitor,
  listarMonitoresDisponiveis,
  notificarPreferenciasParaOutraJanela,
  segundaJanelaDisponivel,
} from '../viewer/segundaJanela';
import {
  abrirConfigTotalSegmentator,
  consultarDiagnosticoTotalSeg,
  EVENTO_DIAGNOSTICO_TOTALSEG,
  formatarEspacoGb,
  obterDiagnosticoCacheTotalSeg,
  origemLegivelTotalSeg,
  resumoCurtoTotalSeg,
  tauriTotalSegDisponivel,
} from './configTotalSegmentator';

let caixa: HTMLDialogElement | undefined;
let corpo: HTMLElement;
let statusSalvoEl: HTMLElement | undefined;
let timerStatusSalvo: number | undefined;
export type AbaConfiguracoes =
  | 'medidas'
  | 'interacao'
  | 'barra3d'
  | 'telas'
  | 'atalhos'
  | 'janelas'
  | 'totalseg'
  | 'atualizacoes';
let abaAtual: AbaConfiguracoes = 'medidas';

function confirmarSalvamento(mensagem = '✓ Configurações salvas neste computador'): void {
  salvarPreferencias();
  notificarPreferenciasParaOutraJanela();
  if (!statusSalvoEl) return;
  statusSalvoEl.textContent = mensagem;
  statusSalvoEl.classList.add('visivel');
  if (timerStatusSalvo !== undefined) window.clearTimeout(timerStatusSalvo);
  timerStatusSalvo = window.setTimeout(() => {
    statusSalvoEl?.classList.remove('visivel');
  }, 2600);
}

const ABAS: Array<{ id: AbaConfiguracoes; rotulo: string; apenasTauri?: boolean }> = [
  { id: 'medidas', rotulo: 'Medidas' },
  { id: 'interacao', rotulo: 'Mouse e zoom' },
  { id: 'barra3d', rotulo: 'Barra e 3D' },
  { id: 'telas', rotulo: 'Telas e monitores' },
  { id: 'atalhos', rotulo: 'Atalhos' },
  { id: 'janelas', rotulo: 'Janelas' },
  { id: 'totalseg', rotulo: 'TotalSegmentator (IA)', apenasTauri: true },
  { id: 'atualizacoes', rotulo: 'Atualizações', apenasTauri: true },
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
  i.addEventListener('input', () => {
    const v = Number(i.value.replace(',', '.'));
    if (!Number.isFinite(v)) return;
    const lim = Math.min(max, Math.max(min, v));
    aoMudar(lim);
  });
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
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto('💾 Salvar medidas', () => confirmarSalvamento('✓ Aparência e medidas salvas'), 'primario'),
      botaoTexto('Restaurar padrão das medidas', () => {
        restaurarMedidas();
        confirmarSalvamento('✓ Padrão das medidas restaurado');
        desenhar();
      }),
    ),
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
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto('💾 Salvar mouse e favoritos', () => confirmarSalvamento('✓ Mouse, zoom e favoritos salvos'), 'primario'),
      botaoTexto('Restaurar os 6 favoritos padrão', () => {
        restaurarFavoritosMenu();
        confirmarSalvamento('✓ 6 favoritos padrão restaurados');
        desenhar();
      }),
    ),
    el(
      'p',
      { class: 'cfg-dica' },
      'A ferramenta de cada botão do mouse é escolhida no menu Mouse da barra. Clique com o botão direito, sem arrastar, abre o menu rápido.',
    ),
  );
  return raiz;
}

// ---------------------------------------------------------------------------
// Aba Atalhos
// ---------------------------------------------------------------------------

type CategoriaAtalho = 'todos' | 'navegacao' | 'medida' | 'segmentacao' | 'geral';

interface ItemAtalho {
  chave: string;
  rotulo: string;
  padrao: string;
  categoria: Exclude<CategoriaAtalho, 'todos'>;
  atual: () => string;
}

const ROTULOS_CAT_ATALHO: ReadonlyArray<readonly [CategoriaAtalho, string]> = [
  ['todos', 'Todos'],
  ['navegacao', 'Navegação'],
  ['medida', 'Medidas'],
  ['segmentacao', 'Segmentação'],
  ['geral', 'Geral e layout'],
];

function itensAtalho(): ItemAtalho[] {
  const ferramentas = FERRAMENTAS_PRIMARIAS.map<ItemAtalho>((f) => ({
    chave: f.nome,
    rotulo: f.categoria === 'segmentacao' ? f.rotulo.replace(/^Segmentação:\s*/i, '') : f.rotulo,
    padrao: f.tecla,
    categoria: f.categoria,
    atual: () => teclaDaFerramenta(f),
  }));
  const acoes = ACOES_ATALHO.map<ItemAtalho>((a) => ({
    chave: `acao:${a.id}`,
    rotulo: a.rotulo,
    padrao: a.tecla,
    categoria: 'geral',
    atual: () => teclaDaAcao(a.id),
  }));
  return [...ferramentas, ...acoes];
}

let mensagemAtalho = '';
let catAtalhoAtiva: CategoriaAtalho = 'navegacao';

function abaAtalhos(): HTMLElement {
  const raiz = el('div', { class: 'cfg-aba' });
  raiz.append(
    el(
      'p',
      { class: 'cfg-dica' },
      'Clique numa tecla para alterar · Delete restaura · 1–9, Esc, Espaço, setas e ? são fixos.',
    ),
  );
  if (mensagemAtalho) raiz.append(el('p', { class: 'cfg-aviso' }, mensagemAtalho));

  const todosItens = itensAtalho();
  const subAbas = el('div', { class: 'cfg-subabas' });
  for (const [cat, rotulo] of ROTULOS_CAT_ATALHO) {
    const count = cat === 'todos' ? todosItens.length : todosItens.filter((x) => x.categoria === cat).length;
    const b = el('button', {
      type: 'button',
      class: catAtalhoAtiva === cat ? 'ativa' : '',
      textContent: `${rotulo} (${count})`,
    });
    b.addEventListener('click', () => {
      catAtalhoAtiva = cat;
      desenhar();
    });
    subAbas.append(b);
  }
  raiz.append(subAbas);

  const grupos: Array<Exclude<CategoriaAtalho, 'todos'>> =
    catAtalhoAtiva === 'todos' ? ['navegacao', 'medida', 'segmentacao', 'geral'] : [catAtalhoAtiva];

  for (const grupo of grupos) {
    const lista = todosItens.filter((x) => x.categoria === grupo);
    if (lista.length === 0) continue;
    if (catAtalhoAtiva === 'todos') {
      const titulo = ROTULOS_CAT_ATALHO.find(([c]) => c === grupo)?.[1] ?? grupo;
      raiz.append(el('h3', {}, titulo));
    }
    const tabela = el('table', { class: 'cfg-tabela' });
    for (const item of lista) {
      const b = el('button', { type: 'button', class: 'cfg-tecla', textContent: item.atual().toUpperCase() || '—' });
      b.addEventListener('click', () => capturarTecla(b, item, todosItens));
      tabela.append(el('tr', {}, el('td', {}, item.rotulo), el('td', {}, b)));
    }
    raiz.append(tabela);
  }

  raiz.append(
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto('💾 Salvar atalhos', () => confirmarSalvamento('✓ Atalhos salvos'), 'primario'),
      botaoTexto('Restaurar padrão', () => {
        mensagemAtalho = '';
        restaurarAtalhos();
        confirmarSalvamento('✓ Atalhos padrão restaurados');
        desenhar();
      }),
    ),
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
    nome.addEventListener('input', () => {
      j.rotulo = nome.value.trim() || 'Janela';
      salvarPreferencias();
    });
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
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto('💾 Salvar janelas', () => confirmarSalvamento('✓ Janelas de TC salvas'), 'primario'),
      adicionar,
      botaoTexto(`Restaurar as ${JANELAS_PADRAO.length} janelas padrão`, () => {
        restaurarJanelas();
        confirmarSalvamento('✓ Janelas padrão restauradas');
        desenhar();
      }),
    ),
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
  ['maximizada', 'Maximizada'],
  ['tela-cheia', 'Tela cheia (F11)'],
  ['normal', 'Normal'],
];

let monitoresCache: InfoMonitor[] = [];

function formatarMonitor(m: InfoMonitor): string {
  const esc = Math.round(m.escala * 100);
  return `${m.nome} (${m.largura}×${m.altura}, ${esc}%)`;
}

function abaTelas(): HTMLElement {
  const tl = telas();
  const salvarENotificar = (): void => {
    salvarPreferencias();
    notificarPreferenciasParaOutraJanela();
  };
  const raiz = el('div', { class: 'cfg-aba' });

  raiz.append(
    el('h3', {}, 'Grades padrão'),
    linha(
      '1ª janela',
      campoSelect(tl.gradePrincipal, OPCOES_GRADE_PADRAO, (v) => {
        tl.gradePrincipal = v;
        salvarENotificar();
        void aplicarGradesPadraoAtuais();
      }),
    ),
    linha(
      '2ª janela',
      campoSelect(tl.gradeSecundaria, OPCOES_GRADE_PADRAO, (v) => {
        tl.gradeSecundaria = v;
        salvarENotificar();
        void aplicarGradesPadraoAtuais();
      }),
    ),
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto(
        'Aplicar agora',
        () => {
          confirmarSalvamento('✓ Grades aplicadas');
          void aplicarGradesPadraoAtuais();
        },
        'primario',
      ),
      botaoTexto('Padrão 2×2 + 1×2', () => {
        tl.gradePrincipal = '2x2';
        tl.gradeSecundaria = '1x2';
        confirmarSalvamento('✓ Padrão 2×2 + 1×2 salvo');
        desenhar();
        void aplicarPresetVisualizacao({
          id: 'rapido-2x2-1x2',
          rotulo: '2x2 + 1x2',
          gradePrincipal: '2x2',
          usarSegundaJanela: segundaJanelaDisponivel(),
          gradeSecundaria: '1x2',
        });
      }),
    ),
  );

  if (segundaJanelaDisponivel()) {
    const opcoesMonPrincipal: Array<[string, string]> = [
      ['auto', 'Automático (sistema)'],
      ...monitoresCache.map<[string, string]>((m) => [m.id, formatarMonitor(m)]),
    ];
    if (tl.monitorPrincipal !== 'auto' && !opcoesMonPrincipal.some(([id]) => id === tl.monitorPrincipal)) {
      opcoesMonPrincipal.push([tl.monitorPrincipal, `Salvo: ${tl.monitorPrincipal}`]);
    }

    const opcoesMonSecundaria: Array<[string, string]> = [
      ['auto', 'Automático (2º monitor)'],
      ...monitoresCache.map<[string, string]>((m) => [m.id, formatarMonitor(m)]),
    ];
    if (tl.monitorSecundaria !== 'auto' && !opcoesMonSecundaria.some(([id]) => id === tl.monitorSecundaria)) {
      opcoesMonSecundaria.push([tl.monitorSecundaria, `Salvo: ${tl.monitorSecundaria}`]);
    }

    const btnAtualizarMon = botaoTexto('🔄 Atualizar monitores', () => {
      void listarMonitoresDisponiveis().then((lista) => {
        monitoresCache = lista;
        void aplicarExibicaoJanelaAtual();
        if (abaAtual === 'telas') desenhar();
      });
    });
    btnAtualizarMon.title =
      monitoresCache.length > 0
        ? `Detectados (${monitoresCache.length}): ${monitoresCache.map((m) => formatarMonitor(m)).join(' · ')}`
        : 'Atualizar lista de monitores conectados';

    raiz.append(
      el('h3', {}, 'Monitores e tela'),
      linha(
        'Monitor 1ª janela',
        campoSelect(tl.monitorPrincipal, opcoesMonPrincipal, (v) => {
          tl.monitorPrincipal = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Monitor 2ª janela',
        campoSelect(tl.monitorSecundaria, opcoesMonSecundaria, (v) => {
          tl.monitorSecundaria = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
        'Em Automático, usa sempre o outro monitor.',
      ),
      linha(
        'Tela 1ª janela',
        campoSelect(tl.modoTelaPrincipal, OPCOES_MODO_TELA, (v) => {
          tl.modoTelaPrincipal = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Tela 2ª janela',
        campoSelect(tl.modoTelaSecundaria, OPCOES_MODO_TELA, (v) => {
          tl.modoTelaSecundaria = v;
          salvarENotificar();
          void aplicarExibicaoJanelaAtual();
        }),
      ),
      linha(
        'Abrir 2ª janela ao iniciar',
        campoCheck(tl.abrirSecundariaAoIniciar, (v) => {
          tl.abrirSecundariaAoIniciar = v;
          salvarENotificar();
        }),
      ),
      el(
        'div',
        { class: 'cfg-acoes-aba' },
        btnAtualizarMon,
        el(
          'span',
          { class: 'cfg-dica' },
          monitoresCache.length > 0 ? `${monitoresCache.length} monitor(es) detectado(s)` : 'Detectando monitores…',
        ),
      ),
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

  raiz.append(el('h3', {}, 'Predefinições rápidas'));

  const tabela = el('table', { class: 'cfg-tabela cfg-tabela-telas' });
  tabela.append(
    el(
      'tr',
      {},
      el('th', {}, 'Nome'),
      el('th', {}, '1ª jan.'),
      el('th', {}, '2ª'),
      el('th', {}, '2ª jan.'),
      el('th', {}),
      el('th', {}),
    ),
  );

  tl.presets.forEach((p, idx) => {
    const inpNome = el('input', { type: 'text', value: p.rotulo, maxLength: 60 });
    inpNome.addEventListener('input', () => {
      p.rotulo = inpNome.value.trim() || 'Visualização';
      salvarENotificar();
    });
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
      confirmarSalvamento(`✓ "${p.rotulo}" aplicado`);
      void aplicarPresetVisualizacao(p);
      desenhar();
    });
    btnAplicar.title = 'Aplicar e definir como padrão';
    const btnApagar = botaoTexto('✕', () => {
      tl.presets.splice(idx, 1);
      salvarENotificar();
      desenhar();
    });
    btnApagar.title = 'Remover';
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

  const btnAdicionar = botaoTexto('+ Nova predefinição', () => {
    tl.presets.push({
      id: `preset-${Date.now()}`,
      rotulo: `${tl.gradePrincipal} + ${tl.gradeSecundaria}`,
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
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto('💾 Salvar', () => {
        confirmarSalvamento('✓ Configurações salvas');
        void aplicarGradesPadraoAtuais();
      }, 'primario'),
      btnAdicionar,
      botaoTexto('Restaurar padrão', () => {
        restaurarTelas();
        confirmarSalvamento('✓ Padrão restaurado');
        void aplicarGradesPadraoAtuais();
        desenhar();
      }),
    ),
  );

  return raiz;
}

// ---------------------------------------------------------------------------
// Aba TotalSegmentator (IA)
// ---------------------------------------------------------------------------

function abaTotalSeg(): HTMLElement {
  const raiz = el('div', { class: 'cfg-aba' });
  const diag = obterDiagnosticoCacheTotalSeg();
  const resumo = resumoCurtoTotalSeg(diag);

  raiz.append(
    el('h3', {}, 'Auto-Segmentação local (TotalSegmentator)'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Instale sob demanda em ambiente isolado (%LOCALAPPDATA%\\VisuTS) com GPU NVIDIA ou CPU, ou aponte uma instalação offline já existente.',
    ),
    el('div', { class: 'cfg-linha' }, el('span', {}, 'Status'), el('strong', { class: `ts-badge ts-badge-${resumo.classe}` }, resumo.texto)),
  );

  if (diag) {
    const grade = el('dl', { class: 'ts-diag-grid' });
    const item = (k: string, v: string): void => {
      grade.append(el('dt', {}, k), el('dd', { title: v }, v));
    };
    item('Origem', origemLegivelTotalSeg(diag.origem));
    item('Executável', diag.executavelCaminho ?? 'Não encontrado');
    item('Pasta de pesos (TOTALSEG_HOME_DIR)', diag.pastaPesos);
    item(
      'GPU NVIDIA (nvidia-smi)',
      diag.gpuNvidia ? `${diag.gpuNvidia.nome} (${Math.max(1, Math.round(diag.gpuNvidia.memoriaMb / 1024))} GB)` : 'Não detectada',
    );
    item(
      'PyTorch / CUDA',
      diag.versaoTorch
        ? `torch ${diag.versaoTorch} · CUDA ${diag.cudaDisponivel ? `True (${diag.versaoCudaTorch ?? '?'})` : 'False'}`
        : '—',
    );
    item(
      'Pesos baixados',
      diag.tarefasBaixadas
        .filter((t) => t.baixado)
        .map((t) => t.id)
        .join(', ') || 'Nenhum completo',
    );
    item('Espaço livre em disco', formatarEspacoGb(diag.espacoLivreBytes));
    raiz.append(grade);
  } else {
    raiz.append(el('p', { class: 'cfg-dica' }, 'Consultando diagnóstico do TotalSegmentator…'));
    void consultarDiagnosticoTotalSeg(true);
  }

  const btnConfig = botaoTexto(
    '⚙ Instalar / Configurar TotalSegmentator…',
    () => abrirConfigTotalSegmentator(),
    'primario',
  );
  const btnAtualizar = botaoTexto('🔄 Atualizar diagnóstico', () => {
    void consultarDiagnosticoTotalSeg(true).then(() => {
      if (caixa?.open && abaAtual === 'totalseg') desenhar();
    });
  });

  raiz.append(el('div', { class: 'cfg-acoes-aba' }, btnConfig, btnAtualizar));
  return raiz;
}

// ---------------------------------------------------------------------------
// Aba Barra superior, Barra de séries e Desempenho 3D / GPU
// ---------------------------------------------------------------------------

const OPCOES_POSICAO_BARRA: Array<[PosicaoBarraSeries, string]> = [
  ['esquerda', 'À esquerda (coluna vertical enxuta)'],
  ['rodape', 'No rodapé (faixa horizontal)'],
];

const OPCOES_QUALIDADE_3D: Array<[Qualidade3d, string]> = [
  ['desempenho', '⚡ Máximo desempenho (mais fluido, ideal para notebooks)'],
  ['equilibrado', 'Equilibrado (fluido ao girar, nítido ao soltar)'],
  ['alta', 'Alta resolução (máxima nitidez volumétrica)'],
];

const OPCOES_GPU: Array<[PreferenciaGpu, string]> = [
  ['alto-desempenho', 'Placa de vídeo dedicada (Alto desempenho — recomendado)'],
  ['economia', 'Placa integrada / CPU (Economia de bateria)'],
  ['auto', 'Automático do sistema (Windows)'],
];

function abaBarraE3d(): HTMLElement {
  const p = preferencias();
  const tl = telas();
  const salvarENotificar = (): void => {
    salvarPreferencias();
    notificarPreferenciasParaOutraJanela();
  };

  const raiz = el('div', { class: 'cfg-aba' });

  raiz.append(
    el('h3', {}, 'Desempenho 3D e Placa de Vídeo (Notebooks)'),
    linha(
      'Perfil de fluidez / resolução do 3D',
      campoSelect(p.qualidade3d, OPCOES_QUALIDADE_3D, (v) => {
        p.qualidade3d = v;
        salvarENotificar();
      }),
      'Controla a densidade de raios e sombreamento durante o giro do 3D (também ajustável direto no quadro 3D).',
    ),
    linha(
      'Preferência de adaptador gráfico (GPU)',
      campoSelect(p.preferenciaGpu, OPCOES_GPU, (v) => {
        p.preferenciaGpu = v;
        sincronizarPreferenciaGpuNativa(v);
        salvarENotificar();
      }),
      'Em notebooks com GPU integrada + dedicada (NVIDIA/AMD), solicita a GPU escolhida ao WebGL e ao WebView2.',
    ),
    el(
      'p',
      { class: 'cfg-dica' },
      'Em notebooks híbridos, o WebGL aplica a preferência aos novos contextos e o motor nativo WebView2 fixa a placa escolhida ao reiniciar o programa.',
    ),

    el('h3', {}, 'Posição da barra de séries'),
    linha(
      'Posição na 1ª janela',
      campoSelect(tl.posicaoBarraSeriesPrincipal, OPCOES_POSICAO_BARRA, (v) => {
        tl.posicaoBarraSeriesPrincipal = v;
        salvarENotificar();
      }),
      'Também é possível arrastar pela alça “⋮⋮ Séries” ou clicar em ⬓ / ◧ no topo da barra lateral.',
    ),
    ...(segundaJanelaDisponivel()
      ? [
          linha(
            'Posição na 2ª janela',
            campoSelect(tl.posicaoBarraSeriesSecundaria, OPCOES_POSICAO_BARRA, (v) => {
              tl.posicaoBarraSeriesSecundaria = v;
              salvarENotificar();
            }),
          ),
        ]
      : []),

    el('h3', {}, 'Itens visíveis no menu superior'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Desmarque os botões que não usa com frequência para deixar a barra superior mais limpa (especialmente em monitores retrato). Os atalhos de teclado e o menu do botão direito continuam funcionando.',
    ),
  );

  const gradeChecks = el('div', { class: 'cfg-grade-barra-topo' });
  const ocultos = new Set(p.barraSuperiorOcultos);
  for (const item of ITENS_PERSONALIZAVEIS_BARRA) {
    const chk = campoCheck(!ocultos.has(item.id), (visivel) => {
      if (visivel) ocultos.delete(item.id);
      else ocultos.add(item.id);
      p.barraSuperiorOcultos = Array.from(ocultos);
      salvarENotificar();
    });
    const lbl = el('label', { class: 'cfg-item-barra-check' }, chk, el('span', {}, item.rotulo));
    gradeChecks.append(lbl);
  }

  raiz.append(
    gradeChecks,
    el(
      'div',
      { class: 'cfg-acoes-aba' },
      botaoTexto(
        '📱 Barra enxuta (modo retrato)',
        () => {
          p.barraSuperiorOcultos = ITENS_PERSONALIZAVEIS_BARRA.filter((i) => i.retratoOcultar).map((i) => i.id);
          confirmarSalvamento('✓ Barra enxuta aplicada');
          desenhar();
        },
        'primario',
      ),
      botaoTexto('Mostrar todos os botões', () => {
        p.barraSuperiorOcultos = [];
        confirmarSalvamento('✓ Todos os botões exibidos');
        desenhar();
      }),
    ),
  );
  return raiz;
}

// ---------------------------------------------------------------------------
// Aba Atualizações (GitHub Releases)
// ---------------------------------------------------------------------------

interface EstadoAtualizador {
  versaoAtual: string;
  repositorio: string;
  verificarAoIniciar: boolean;
}

interface ResultadoVerificacaoAtualizacao {
  versaoAtual: string;
  versaoRemota: string;
  atualizacaoDisponivel: boolean;
  titulo: string;
  notas: string;
  publicadoEm: string | null;
  nomeInstalador: string | null;
  urlInstalador: string | null;
  tamanhoBytes: number | null;
  sha256Esperado: string | null;
  urlRelease: string | null;
}

let estadoAtualizadorCache: EstadoAtualizador | null = null;
let rascunhoRepoAtualizador = '';
let rascunhoRepoIniciado = false;
let verificandoAtualizacao = false;
let baixandoAtualizacao = false;
let resultadoAtualizacao: ResultadoVerificacaoAtualizacao | null = null;
let msgAtualizador: { texto: string; tipo: 'ok' | 'aviso' | 'erro' } | null = null;

function invokeTauriAtualizador<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  const inv = (
    globalThis as unknown as {
      __TAURI__?: { core?: { invoke<R>(c: string, a?: Record<string, unknown>): Promise<R> } };
    }
  ).__TAURI__?.core?.invoke;
  return inv ? inv<T>(cmd, args) : null;
}

async function carregarConfigAtualizador(): Promise<void> {
  const prom = invokeTauriAtualizador<EstadoAtualizador>('atualizador_obter_config');
  if (!prom) return;
  try {
    const est = await prom;
    estadoAtualizadorCache = est;
    if (!rascunhoRepoIniciado) {
      rascunhoRepoAtualizador = est.repositorio;
      rascunhoRepoIniciado = true;
    }
    if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
  } catch {
    /* ignora */
  }
}

async function salvarConfigAtualizador(repo: string, verificarAoIniciar: boolean): Promise<void> {
  const prom = invokeTauriAtualizador<EstadoAtualizador>('atualizador_salvar_config', {
    repositorio: repo,
    verificarAoIniciar,
  });
  if (!prom) return;
  try {
    const est = await prom;
    estadoAtualizadorCache = est;
    rascunhoRepoAtualizador = est.repositorio;
    msgAtualizador = { texto: '✓ Configuração de atualizações salva.', tipo: 'ok' };
    confirmarSalvamento('✓ Configuração de atualizações salva');
  } catch (e) {
    msgAtualizador = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
  }
  if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
}

async function verificarAtualizacaoAgora(): Promise<void> {
  if (verificandoAtualizacao || baixandoAtualizacao) return;
  const prom = invokeTauriAtualizador<ResultadoVerificacaoAtualizacao>('atualizador_verificar', {
    repositorio: rascunhoRepoAtualizador.trim() || null,
  });
  if (!prom) return;
  verificandoAtualizacao = true;
  msgAtualizador = null;
  if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
  try {
    const res = await prom;
    resultadoAtualizacao = res;
    if (estadoAtualizadorCache && rascunhoRepoAtualizador.trim()) {
      estadoAtualizadorCache.repositorio = rascunhoRepoAtualizador.trim();
    }
    msgAtualizador = res.atualizacaoDisponivel
      ? {
          texto: `🎉 Nova versão disponível: v${res.versaoRemota} (você está na v${res.versaoAtual}).`,
          tipo: 'ok',
        }
      : {
          texto: `✓ O KRB View já está na versão mais recente (v${res.versaoAtual}).`,
          tipo: 'ok',
        };
  } catch (e) {
    resultadoAtualizacao = null;
    msgAtualizador = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
  } finally {
    verificandoAtualizacao = false;
    if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
  }
}

async function baixarEInstalarAtualizacao(): Promise<void> {
  if (baixandoAtualizacao || !resultadoAtualizacao?.urlInstalador || !resultadoAtualizacao.nomeInstalador) return;
  const prom = invokeTauriAtualizador<void>('atualizador_baixar_e_instalar', {
    urlInstalador: resultadoAtualizacao.urlInstalador,
    nomeInstalador: resultadoAtualizacao.nomeInstalador,
    sha256Esperado: resultadoAtualizacao.sha256Esperado,
  });
  if (!prom) return;
  baixandoAtualizacao = true;
  msgAtualizador = {
    texto: `Baixando ${resultadoAtualizacao.nomeInstalador} e verificando integridade… O aplicativo será reiniciado automaticamente.`,
    tipo: 'aviso',
  };
  if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
  try {
    await prom;
  } catch (e) {
    baixandoAtualizacao = false;
    msgAtualizador = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
    if (caixa?.open && abaAtual === 'atualizacoes') desenhar();
  }
}

function abaAtualizacoes(): HTMLElement {
  const raiz = el('div', { class: 'cfg-aba' });
  if (!estadoAtualizadorCache) {
    void carregarConfigAtualizador();
  }

  const versao = estadoAtualizadorCache?.versaoAtual ?? '0.1.0';
  raiz.append(
    el('h3', {}, 'Atualizações do KRB View (GitHub Releases)'),
    el(
      'p',
      { class: 'cfg-dica' },
      'Verifica o último Release publicado no seu repositório do GitHub, compara a versão e baixa/executa o instalador assinado (.exe / .msi) com conferência de SHA-256. Nenhum dado do computador ou exame é enviado.',
    ),
    el('div', { class: 'cfg-linha' }, el('span', {}, 'Versão instalada'), el('strong', {}, `v${versao}`)),
  );

  const inpRepo = el('input', {
    type: 'text',
    value: rascunhoRepoAtualizador,
    placeholder: 'Ex.: usuario/repositorio ou https://github.com/usuario/repositorio',
    disabled: verificandoAtualizacao || baixandoAtualizacao,
  });
  inpRepo.style.minWidth = '300px';
  inpRepo.addEventListener('input', () => {
    rascunhoRepoAtualizador = inpRepo.value;
  });

  const btnSalvarRepo = botaoTexto('Salvar repositório', () => {
    void salvarConfigAtualizador(rascunhoRepoAtualizador, Boolean(estadoAtualizadorCache?.verificarAoIniciar));
  });
  btnSalvarRepo.disabled = verificandoAtualizacao || baixandoAtualizacao;

  const linhaRepo = el(
    'div',
    { class: 'ts-campo-manual' },
    el('label', {}, 'Repositório GitHub das Releases'),
    el('div', { class: 'ts-campo-linha' }, inpRepo, btnSalvarRepo),
  );

  const chkAoIniciar = campoCheck(Boolean(estadoAtualizadorCache?.verificarAoIniciar), (ativo) => {
    void salvarConfigAtualizador(rascunhoRepoAtualizador, ativo);
  });
  chkAoIniciar.disabled = verificandoAtualizacao || baixandoAtualizacao;

  const btnVerificar = botaoTexto(
    verificandoAtualizacao ? '⏳ Consultando GitHub…' : '🔄 Verificar se há atualização agora',
    () => void verificarAtualizacaoAgora(),
    'primario',
  );
  btnVerificar.disabled = verificandoAtualizacao || baixandoAtualizacao;

  raiz.append(
    linhaRepo,
    linha(
      'Verificar automaticamente ao abrir o programa',
      chkAoIniciar,
      'Desligado por padrão para não fazer conexões sem você pedir. Quando ligado, avisa discretamente se sair versão nova.',
    ),
    el('div', { class: 'cfg-acoes-aba' }, btnVerificar),
  );

  if (msgAtualizador) {
    raiz.append(
      el('p', {
        class: `ts-msg-status ${msgAtualizador.tipo}`,
        textContent: msgAtualizador.texto,
      }),
    );
  }

  if (resultadoAtualizacao) {
    const r = resultadoAtualizacao;
    const cardRes = el('div', { class: 'ts-diag-card' });
    cardRes.style.marginTop = '10px';
    const mb =
      r.tamanhoBytes && r.tamanhoBytes > 0
        ? ` (${(r.tamanhoBytes / (1024 * 1024)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB)`
        : '';
    cardRes.append(
      el(
        'div',
        { class: 'ts-diag-topo' },
        el('strong', {}, `${r.titulo} (v${r.versaoRemota})`),
        el(
          'span',
          { class: `ts-badge ${r.atualizacaoDisponivel ? 'ts-badge-aviso' : 'ts-badge-ok'}` },
          r.atualizacaoDisponivel ? 'Nova versão disponível' : 'Já atualizado',
        ),
      ),
    );
    if (r.notas) {
      cardRes.append(el('pre', { class: 'ts-log', textContent: r.notas }));
    }
    if (r.atualizacaoDisponivel && r.urlInstalador && r.nomeInstalador) {
      const btnBaixar = botaoTexto(
        baixandoAtualizacao
          ? '⏳ Baixando e iniciando instalador…'
          : `⬇ Baixar e atualizar agora: ${r.nomeInstalador}${mb}`,
        () => void baixarEInstalarAtualizacao(),
        'primario',
      );
      btnBaixar.disabled = baixandoAtualizacao;
      cardRes.append(el('div', { class: 'cfg-acoes-aba' }, btnBaixar));
    } else if (r.atualizacaoDisponivel && !r.urlInstalador) {
      cardRes.append(
        el(
          'p',
          { class: 'cfg-aviso' },
          'Release encontrada, mas ainda não há um arquivo .exe ou .msi anexado nos Assets dessa Release no GitHub.',
        ),
      );
    }
    raiz.append(cardRes);
  }

  return raiz;
}

/**
 * Chamado uma vez na janela principal ao iniciar: só consulta o GitHub se o usuário tiver
 * ativado explicitamente `verificarAoIniciar` e configurado um repositório.
 */
export async function verificarAtualizacaoAoIniciarSeAtivo(): Promise<void> {
  const promCfg = invokeTauriAtualizador<EstadoAtualizador>('atualizador_obter_config');
  if (!promCfg) return;
  try {
    const cfg = await promCfg;
    estadoAtualizadorCache = cfg;
    if (!cfg.verificarAoIniciar || !cfg.repositorio.trim()) return;
    const res = await invokeTauriAtualizador<ResultadoVerificacaoAtualizacao>('atualizador_verificar', {
      repositorio: cfg.repositorio,
    });
    if (res?.atualizacaoDisponivel) {
      resultadoAtualizacao = res;
      msgAtualizador = {
        texto: `🎉 Nova versão disponível: v${res.versaoRemota} (atual: v${res.versaoAtual}).`,
        tipo: 'ok',
      };
      if (
        window.confirm(
          `Uma nova versão do KRB View (v${res.versaoRemota}) está disponível!\n\nDeseja abrir a tela de Atualizações para baixar e instalar?`,
        )
      ) {
        abrirConfiguracoes('atualizacoes');
      }
    }
  } catch {
    /* falha silenciosa na checagem em segundo plano */
  }
}

// ---------------------------------------------------------------------------

function desenhar(): void {
  const abas: Record<AbaConfiguracoes, () => HTMLElement> = {
    medidas: abaMedidas,
    interacao: abaInteracao,
    barra3d: abaBarraE3d,
    telas: abaTelas,
    atalhos: abaAtalhos,
    janelas: abaJanelas,
    totalseg: abaTotalSeg,
    atualizacoes: abaAtualizacoes,
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
  const emTauri = tauriTotalSegDisponivel();
  for (const a of ABAS) {
    if (a.apenasTauri && !emTauri) continue;
    const b = botaoTexto(a.rotulo, () => {
      abaAtual = a.id;
      mensagemAtalho = '';
      desenhar();
    });
    b.dataset.aba = a.id;
    abas.append(b);
  }
  corpo = el('div', { class: 'cfg-corpo' });
  statusSalvoEl = el('span', { class: 'cfg-status-salvo', textContent: '✓ Salvo neste computador' });
  const rodape = el(
    'div',
    { class: 'cfg-rodape' },
    statusSalvoEl,
    el(
      'div',
      { class: 'cfg-rodape-botoes' },
      botaoTexto(
        '💾 Salvar',
        () => {
          confirmarSalvamento('✓ Todas as configurações foram salvas');
          if (abaAtual === 'telas') void aplicarGradesPadraoAtuais();
        },
        'primario',
      ),
      botaoTexto(
        '💾 Salvar e fechar',
        () => {
          confirmarSalvamento('✓ Todas as configurações foram salvas');
          if (abaAtual === 'telas') void aplicarGradesPadraoAtuais();
          d.close();
        },
        'primario',
      ),
      botaoTexto('Fechar', () => d.close(), 'cfg-fechar'),
    ),
  );
  d.append(
    el('h2', {}, '⚙ Configurações'),
    abas,
    corpo,
    rodape,
  );
  // Teclas digitadas aqui não podem disparar atalhos do visualizador (ex.: Delete apagar medida).
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.addEventListener(EVENTO_DIAGNOSTICO_TOTALSEG, () => {
    if (d.open && abaAtual === 'totalseg') desenhar();
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
