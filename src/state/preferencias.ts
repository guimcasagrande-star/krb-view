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

export interface PrefsGerais {
  medidas: PrefsMedidas;
  interacao: PrefsInteracao;
  /** nome da ferramenta (ou id da ação) -> tecla (minúscula). Só o que difere do padrão. */
  atalhos: Record<string, string>;
  /** Janelas predefinidas, nas teclas 1 a 9 pela ordem. */
  janelas: Janela[];
  /** Ferramenta de cada botão do mouse escolhida pelo usuário ('' = nenhuma). Só o que difere do padrão. */
  mouse: Record<string, string>;
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

export const JANELAS_PADRAO: Janela[] = [
  { rotulo: 'Partes moles', centro: 40, largura: 400 },
  { rotulo: 'Pulmão', centro: -600, largura: 1500 },
  { rotulo: 'Osso', centro: 300, largura: 1500 },
  { rotulo: 'Fígado', centro: 60, largura: 160 },
  { rotulo: 'Cérebro', centro: 40, largura: 80 },
  { rotulo: 'Mediastino', centro: 50, largura: 350 },
];

export const MAX_JANELAS = 9;

const CHAVE = 'visualizador.preferencias.v1';
export const EVENTO_PREFERENCIAS = 'preferenciasMudaram';

function copiaPadrao(): PrefsGerais {
  return {
    medidas: { ...MEDIDAS_PADRAO, roi: { ...MEDIDAS_PADRAO.roi } },
    interacao: { ...INTERACAO_PADRAO },
    atalhos: {},
    janelas: JANELAS_PADRAO.map((j) => ({ ...j })),
    mouse: {},
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

export function medidas(): PrefsMedidas {
  return atuais.medidas;
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
