/**
 * Preferências do usuário (aparência das medidas, interação, atalhos e janelas predefinidas).
 * Guardadas só neste computador, em localStorage. Nenhum dado de exame entra aqui.
 */

export interface PrefsMedidas {
  /** Cor das linhas das medidas. */
  cor: string;
  /** Cor do texto das medidas. */
  corTexto: string;
  /** Tamanho da letra do texto das medidas (px). */
  tamanhoTexto: number;
  /** Espessura das linhas (px). */
  espessura: number;
  /** Desenha um tracinho perpendicular nas extremidades das medidas lineares. */
  tracinhos: boolean;
  /** Unidade de comprimento e área mostrada. */
  unidade: 'mm' | 'cm';
  /** Casas decimais de comprimentos e áreas. */
  casas: number;
  /** Casas decimais de valores (HU, SUV, ângulos, razões). */
  casasValores: number;
  /**
   * Como as medidas de vários pontos (Cobb, razões, estenose, desvio, seta...) são desenhadas:
   * `arrastar` = pressionar no início, arrastar e soltar no fim (também aceita clicar e clicar);
   * `clicar` = só cliques: um clique por ponto.
   */
  modoClique: 'arrastar' | 'clicar';
  /** Campos mostrados nas ROIs. */
  roi: {
    area: boolean;
    media: boolean;
    maximo: boolean;
    minimo: boolean;
    desvio: boolean;
    perimetro: boolean;
  };
  /** Distância (px) em que um clique seleciona uma medida. */
  tolerancia: number;
}

export interface Janela {
  rotulo: string;
  /** Centro e largura, na convenção usual de TC. */
  centro: number;
  largura: number;
}

export interface PrefsInteracao {
  /** Zoom a partir do centro da imagem (padrão); desligado = a partir do ponto do mouse. */
  zoomNoCentro: boolean;
  /** Depois de concluir uma medida (linha, ângulo, ROI...), o botão esquerdo volta a passar cortes. */
  voltarAoScroll: boolean;
}

export type ModoTelaJanela = 'normal' | 'maximizada' | 'tela-cheia';

export interface PresetVisualizacao {
  id: string;
  rotulo: string;
  gradePrincipal: string;
  usarSegundaJanela: boolean;
  gradeSecundaria: string;
}

export interface PrefsTelas {
  /** Grade padrão ao iniciar na janela principal (ex.: '1x1', '1x2', '2x2'). */
  gradePrincipal: string;
  /** Grade padrão ao iniciar na 2ª janela (ex.: '1x2', '2x2', '1x1'). */
  gradeSecundaria: string;
  /** Como a janela principal abre ('maximizada' = ocupando a tela toda, 'tela-cheia' = sem bordas/F11, 'normal'). */
  modoTelaPrincipal: ModoTelaJanela;
  /** Como a 2ª janela abre ('maximizada' = ocupando a tela toda, 'tela-cheia' = sem bordas/F11, 'normal'). */
  modoTelaSecundaria: ModoTelaJanela;
  /** ID do monitor padrão para a janela principal ('auto' = monitor padrão do sistema). */
  monitorPrincipal: string;
  /** ID do monitor padrão para a 2ª janela ('auto' = sempre no segundo monitor automaticamente). */
  monitorSecundaria: string;
  /** Se verdadeiro, abre a 2ª janela automaticamente ao iniciar quando houver 2º monitor. */
  abrirSecundariaAoIniciar: boolean;
  /** Combinações de visualização salvas pelo usuário (1 ou 2 monitores). */
  presets: PresetVisualizacao[];
}

export interface PrefsGerais {
  medidas: PrefsMedidas;
  interacao: PrefsInteracao;
  telas: PrefsTelas;
  /** nome da ferramenta (ou id da ação) -> tecla (minúscula). Só o que difere do padrão. */
  atalhos: Record<string, string>;
  /** Janelas predefinidas, nas teclas 1 a 9 pela ordem. */
  janelas: Janela[];
  /** Ferramenta de cada botão do mouse escolhida pelo usuário ('' = nenhuma). Só o que difere do padrão. */
  mouse: Record<string, string>;
  /** 6 botões favoritos (esquemáticos) no topo do menu do botão direito. */
  favoritosMenu: string[];
}

export const MEDIDAS_PADRAO: PrefsMedidas = {
  cor: '#38bdf8',
  corTexto: '#ffffff',
  tamanhoTexto: 14,
  espessura: 1.5,
  tracinhos: true,
  unidade: 'mm',
  casas: 1,
  casasValores: 1,
  modoClique: 'arrastar',
  roi: { area: true, media: true, maximo: true, minimo: false, desvio: true, perimetro: false },
  tolerancia: 12,
};

export const INTERACAO_PADRAO: PrefsInteracao = { zoomNoCentro: true, voltarAoScroll: true };

export const PRESETS_VISUALIZACAO_PADRAO: PresetVisualizacao[] = [
  {
    id: '2m-2x2-1x2',
    rotulo: '2 monitores: 2x2 principal + 1x2 na 2ª janela',
    gradePrincipal: '2x2',
    usarSegundaJanela: true,
    gradeSecundaria: '1x2',
  },
  {
    id: '2m-1x2-1x2',
    rotulo: '2 monitores: 1x2 principal + 1x2 na 2ª janela',
    gradePrincipal: '1x2',
    usarSegundaJanela: true,
    gradeSecundaria: '1x2',
  },
  {
    id: '2m-1x1-2x2',
    rotulo: '2 monitores: 1x1 principal + 2x2 na 2ª janela',
    gradePrincipal: '1x1',
    usarSegundaJanela: true,
    gradeSecundaria: '2x2',
  },
  {
    id: '1m-2x2',
    rotulo: '1 monitor: Grade 2x2',
    gradePrincipal: '2x2',
    usarSegundaJanela: false,
    gradeSecundaria: '1x2',
  },
];

export const TELAS_PADRAO: PrefsTelas = {
  gradePrincipal: '1x1',
  gradeSecundaria: '1x2',
  modoTelaPrincipal: 'maximizada',
  modoTelaSecundaria: 'maximizada',
  monitorPrincipal: 'auto',
  monitorSecundaria: 'auto',
  abrirSecundariaAoIniciar: false,
  presets: PRESETS_VISUALIZACAO_PADRAO.map((p) => ({ ...p })),
};

export const JANELAS_PADRAO: Janela[] = [
  { rotulo: 'Partes moles', centro: 40, largura: 400 },
  { rotulo: 'Pulmão', centro: -600, largura: 1500 },
  { rotulo: 'Osso', centro: 300, largura: 1500 },
  { rotulo: 'Fígado', centro: 60, largura: 160 },
  { rotulo: 'Cérebro', centro: 40, largura: 80 },
  { rotulo: 'Mediastino', centro: 50, largura: 350 },
];

export const MAX_JANELAS = 9;

export const TOTAL_FAVORITOS_MENU = 6;

export const FAVORITOS_MENU_PADRAO: string[] = [
  'WindowLevel',
  'Zoom',
  'Localizador3D',
  'Length',
  'EllipticalROI',
  'ProbeHuSuv',
];

const CHAVE = 'visualizador.preferencias.v1';
export const EVENTO_PREFERENCIAS = 'preferenciasMudaram';

function gradeValida(v: unknown, padrao: string): string {
  if (typeof v !== 'string') return padrao;
  const m = /^([1-5])x([1-5])$/.exec(v.trim());
  return m ? `${m[1]}x${m[2]}` : padrao;
}

function modoTelaValido(v: unknown, padrao: ModoTelaJanela): ModoTelaJanela {
  return v === 'normal' || v === 'maximizada' || v === 'tela-cheia' ? v : padrao;
}

function copiaPadrao(): PrefsGerais {
  return {
    medidas: { ...MEDIDAS_PADRAO, roi: { ...MEDIDAS_PADRAO.roi } },
    interacao: { ...INTERACAO_PADRAO },
    telas: {
      ...TELAS_PADRAO,
      presets: PRESETS_VISUALIZACAO_PADRAO.map((p) => ({ ...p })),
    },
    atalhos: {},
    janelas: JANELAS_PADRAO.map((j) => ({ ...j })),
    mouse: {},
    favoritosMenu: [...FAVORITOS_MENU_PADRAO],
  };
}

function numero(v: unknown, padrao: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao;
}

function corValida(v: unknown, padrao: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : padrao;
}

/** Aceita qualquer coisa vinda do disco e devolve preferências válidas. */
export function sanear(bruto: unknown): PrefsGerais {
  const p = copiaPadrao();
  if (!bruto || typeof bruto !== 'object') return p;
  const b = bruto as Partial<Record<keyof PrefsGerais, unknown>>;

  const m = (b.medidas ?? {}) as Record<string, unknown>;
  const pm = p.medidas;
  pm.cor = corValida(m.cor, pm.cor);
  pm.corTexto = corValida(m.corTexto, pm.corTexto);
  pm.tamanhoTexto = numero(m.tamanhoTexto, pm.tamanhoTexto, 8, 40);
  pm.espessura = numero(m.espessura, pm.espessura, 0.5, 8);
  pm.tracinhos = typeof m.tracinhos === 'boolean' ? m.tracinhos : pm.tracinhos;
  pm.unidade = m.unidade === 'cm' ? 'cm' : 'mm';
  pm.casas = Math.round(numero(m.casas, pm.casas, 0, 4));
  pm.casasValores = Math.round(numero(m.casasValores, pm.casasValores, 0, 4));
  pm.modoClique = m.modoClique === 'clicar' ? 'clicar' : 'arrastar';
  pm.tolerancia = numero(m.tolerancia, pm.tolerancia, 4, 40);
  const roi = (m.roi ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(pm.roi) as Array<keyof PrefsMedidas['roi']>) {
    if (typeof roi[k] === 'boolean') pm.roi[k] = roi[k] as boolean;
  }

  const it = (b.interacao ?? {}) as Record<string, unknown>;
  if (typeof it.zoomNoCentro === 'boolean') p.interacao.zoomNoCentro = it.zoomNoCentro;
  if (typeof it.voltarAoScroll === 'boolean') p.interacao.voltarAoScroll = it.voltarAoScroll;

  const tl = (b.telas ?? {}) as Record<string, unknown>;
  p.telas.gradePrincipal = gradeValida(tl.gradePrincipal, p.telas.gradePrincipal);
  p.telas.gradeSecundaria = gradeValida(tl.gradeSecundaria, p.telas.gradeSecundaria);
  p.telas.modoTelaPrincipal = modoTelaValido(tl.modoTelaPrincipal, p.telas.modoTelaPrincipal);
  p.telas.modoTelaSecundaria = modoTelaValido(tl.modoTelaSecundaria, p.telas.modoTelaSecundaria);
  if (typeof tl.monitorPrincipal === 'string' && tl.monitorPrincipal.trim()) {
    p.telas.monitorPrincipal = tl.monitorPrincipal.trim().slice(0, 120);
  }
  if (typeof tl.monitorSecundaria === 'string' && tl.monitorSecundaria.trim()) {
    p.telas.monitorSecundaria = tl.monitorSecundaria.trim().slice(0, 120);
  }
  if (typeof tl.abrirSecundariaAoIniciar === 'boolean') {
    p.telas.abrirSecundariaAoIniciar = tl.abrirSecundariaAoIniciar;
  }
  if (Array.isArray(tl.presets)) {
    const listaPresets: PresetVisualizacao[] = [];
    for (const item of tl.presets as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue;
      const rotulo =
        typeof item.rotulo === 'string' && item.rotulo.trim()
          ? item.rotulo.trim().slice(0, 60)
          : 'Visualização';
      const id =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim().slice(0, 60)
          : `preset-${listaPresets.length + 1}`;
      listaPresets.push({
        id,
        rotulo,
        gradePrincipal: gradeValida(item.gradePrincipal, '2x2'),
        usarSegundaJanela: Boolean(item.usarSegundaJanela),
        gradeSecundaria: gradeValida(item.gradeSecundaria, '1x2'),
      });
      if (listaPresets.length >= 12) break;
    }
    if (listaPresets.length > 0) p.telas.presets = listaPresets;
  }

  if (b.atalhos && typeof b.atalhos === 'object') {
    for (const [nome, tecla] of Object.entries(b.atalhos as Record<string, unknown>)) {
      if (typeof tecla === 'string' && tecla.length >= 1 && tecla.length <= 12) p.atalhos[nome] = tecla.toLowerCase();
    }
  }

  if (b.mouse && typeof b.mouse === 'object') {
    for (const [botao, nome] of Object.entries(b.mouse as Record<string, unknown>)) {
      if (typeof nome === 'string' && nome.length <= 40) p.mouse[botao] = nome;
    }
  }

  if (Array.isArray(b.favoritosMenu)) {
    for (let i = 0; i < TOTAL_FAVORITOS_MENU; i += 1) {
      const item = b.favoritosMenu[i];
      if (typeof item === 'string' && item.trim().length > 0 && item.trim().length <= 60) {
        p.favoritosMenu[i] = item.trim();
      }
    }
  }

  if (Array.isArray(b.janelas)) {
    const lista: Janela[] = [];
    for (const j of b.janelas as Array<Record<string, unknown>>) {
      if (!j || typeof j.centro !== 'number' || typeof j.largura !== 'number') continue;
      if (!Number.isFinite(j.centro) || !Number.isFinite(j.largura) || j.largura < 1) continue;
      lista.push({
        rotulo: typeof j.rotulo === 'string' && j.rotulo.trim() ? j.rotulo.trim().slice(0, 40) : 'Janela',
        centro: j.centro,
        largura: j.largura,
      });
      if (lista.length >= MAX_JANELAS) break;
    }
    if (lista.length > 0) p.janelas = lista;
  }
  return p;
}

let atuais: PrefsGerais = copiaPadrao();

try {
  const texto = localStorage.getItem(CHAVE);
  if (texto) atuais = sanear(JSON.parse(texto));
} catch {
  atuais = copiaPadrao();
}

export function preferencias(): PrefsGerais {
  return atuais;
}

export function interacao(): PrefsInteracao {
  return atuais.interacao;
}

export function telas(): PrefsTelas {
  return atuais.telas;
}

export function medidas(): PrefsMedidas {
  return atuais.medidas;
}

export function favoritosMenu(): string[] {
  return atuais.favoritosMenu;
}

/** Reler do localStorage (útil quando a outra janela salvou preferências). */
export function recarregarPreferenciasDoDisco(): void {
  try {
    const texto = localStorage.getItem(CHAVE);
    if (texto) atuais = sanear(JSON.parse(texto));
  } catch {
    /* mantém atuais */
  }
  document.dispatchEvent(new CustomEvent(EVENTO_PREFERENCIAS));
}

/** Grava e avisa quem escuta (estilo das medidas, atalhos, menus). */
export function salvarPreferencias(): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(atuais));
  } catch {
    /* armazenamento indisponível: vale só nesta sessão */
  }
  document.dispatchEvent(new CustomEvent(EVENTO_PREFERENCIAS));
}

export function restaurarMedidas(): void {
  atuais.medidas = copiaPadrao().medidas;
  salvarPreferencias();
}

export function restaurarJanelas(): void {
  atuais.janelas = JANELAS_PADRAO.map((j) => ({ ...j }));
  salvarPreferencias();
}

export function restaurarAtalhos(): void {
  atuais.atalhos = {};
  salvarPreferencias();
}

export function restaurarTelas(): void {
  atuais.telas = copiaPadrao().telas;
  salvarPreferencias();
}

export function restaurarFavoritosMenu(): void {
  atuais.favoritosMenu = [...FAVORITOS_MENU_PADRAO];
  salvarPreferencias();
}
