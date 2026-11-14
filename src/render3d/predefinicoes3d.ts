/**
 * Predefinições da renderização volumétrica 3D (fase 8.1): nomes em português para as
 * predefinições prontas do Cornerstone (`CONSTANTS.VIEWPORT_PRESETS`) e o ajuste de opacidade
 * e brilho sobre elas. Funções puras: não dependem do navegador.
 */

/** Mesmo formato de `Types.ViewportPreset` do Cornerstone (só os campos de texto). */
export interface Preset3d {
  name: string;
  gradientOpacity: string;
  specularPower: string;
  scalarOpacity: string;
  specular: string;
  shade: string;
  ambient: string;
  colorTransfer: string;
  diffuse: string;
  interpolation: string;
}

export type Modalidade3d = 'CT' | 'MR';

export interface Predefinicao3d {
  id: string;
  rotulo: string;
  /** Nome da predefinição em `CONSTANTS.VIEWPORT_PRESETS` ou em `PRESETS_PROPRIOS`. */
  preset: string;
  modalidade: Modalidade3d;
  /** Projeção de intensidade máxima em vez de composição (opacidade acumulada). */
  mip?: true;
}

/**
 * Predefinições que não existem prontas no Cornerstone.
 * Osso: só o osso. A opacidade começa em 180 HU (acima de músculo, gordura e órgãos sem contraste)
 * e chega ao máximo perto de 400 HU; cor de marfim. A "CT-Bone" do Cornerstone começa em −16 HU
 * e por isso mostra também os músculos (aqui ela se chama "Músculos e ossos").
 *
 * Pulmão: parênquima de −950 a −400 HU (o ar das vias aéreas, −1000, fica de fora). Toda borda
 * entre ar e partes moles (pele, pleura, diafragma) também passa por essa faixa na transição e,
 * na "CT-Lung" do Cornerstone, aparece como uma casca de parte mole. Aqui a opacidade pelo
 * gradiente cai de 1 (variação 0) a 0 (150 HU/mm ou mais): bordas abruptas somem e o
 * parênquima, homogêneo, fica. Sem sombreamento (o parênquima não tem superfície e ficaria
 * granulado com a luz).
 */
export const PRESETS_PROPRIOS: Preset3d[] = [
  {
    name: 'Visualizador-Osso',
    gradientOpacity: '4 0 1 255 1',
    specularPower: '10',
    scalarOpacity: '8 -3024 0 180 0 400 0.75 3071 0.8',
    specular: '0.2',
    shade: '1',
    ambient: '0.15',
    colorTransfer: '16 -3024 0 0 0 180 0.8 0.68 0.5 600 0.95 0.9 0.78 3071 1 1 1',
    diffuse: '0.9',
    interpolation: '1',
  },
  {
    name: 'Visualizador-Pulmao',
    // 4 números: gradiente mínimo, opacidade nele, gradiente máximo, opacidade nele (HU/mm).
    // 150 → 0 e 0 → 1: fator = 1 − gradiente/150, limitado a 0–1.
    gradientOpacity: '4 150 0 0 1',
    specularPower: '1',
    scalarOpacity: '12 -3024 0 -950 0 -850 0.1 -500 0.1 -400 0 3071 0',
    specular: '0',
    shade: '0',
    ambient: '0.3',
    colorTransfer: '16 -3024 0 0 0 -950 0.85 0.62 0.58 -400 1 0.86 0.8 3071 1 1 1',
    diffuse: '1',
    interpolation: '1',
  },
];

export const PREDEFINICOES_3D: Predefinicao3d[] = [
  { id: 'osso', rotulo: 'Osso', preset: 'Visualizador-Osso', modalidade: 'CT' },
  { id: 'musculos-ossos', rotulo: 'Músculos e ossos', preset: 'CT-Bone', modalidade: 'CT' },
  { id: 'vasos', rotulo: 'Vasos com contraste', preset: 'CT-AAA', modalidade: 'CT' },
  { id: 'torax', rotulo: 'Tórax com contraste', preset: 'CT-Chest-Contrast-Enhanced', modalidade: 'CT' },
  { id: 'pulmao', rotulo: 'Pulmão', preset: 'Visualizador-Pulmao', modalidade: 'CT' },
  { id: 'mip', rotulo: 'MIP', preset: 'CT-MIP', modalidade: 'CT', mip: true },
  { id: 'rm-padrao', rotulo: 'RM padrão', preset: 'MR-Default', modalidade: 'MR' },
  { id: 'angio-rm', rotulo: 'Angio-RM', preset: 'MR-Angio', modalidade: 'MR' },
];

/** Modalidade com 3D (TC ou RM); `null` para as demais (PET usa o MIP rotatório). */
export function modalidade3d(modalidade: string | undefined): Modalidade3d | null {
  if (modalidade === 'CT') return 'CT';
  if (modalidade === 'MR') return 'MR';
  return null;
}

export function predefinicoesDa(modalidade: Modalidade3d): Predefinicao3d[] {
  return PREDEFINICOES_3D.filter((p) => p.modalidade === modalidade);
}

/** A primeira da modalidade: Osso na TC, RM padrão na RM. */
export function predefinicaoPadrao(modalidade: Modalidade3d): Predefinicao3d {
  return predefinicoesDa(modalidade)[0]!;
}

const limitar01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Arredonda sem lixo de ponto flutuante na string. */
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/**
 * Lê a lista "N v1 a1 b1 … " do formato de predefinição do VTK, aplica `f` a cada grupo de
 * `largura` números (o 1º é o valor em HU) e devolve no mesmo formato.
 */
function mapearPontos(texto: string, largura: number, f: (grupo: number[]) => number[]): string {
  const partes = texto.trim().split(/\s+/).map(Number);
  const n = partes[0] ?? 0;
  const valores = partes.slice(1, 1 + n);
  const saida: number[] = [];
  for (let i = 0; i + largura <= valores.length; i += largura) {
    saida.push(...f(valores.slice(i, i + largura)));
  }
  return [saida.length, ...saida].map(num).join(' ');
}

/**
 * Predefinição com a opacidade e o brilho ajustados (1 = sem mudança).
 * Opacidade multiplica a curva de opacidade; brilho multiplica as cores. Ambos limitados a 0–1.
 */
export function ajustarPreset(base: Preset3d, opacidade: number, brilho: number): Preset3d {
  if (opacidade === 1 && brilho === 1) return base;
  return {
    ...base,
    name: `${base.name} (ajustada)`,
    scalarOpacity: mapearPontos(base.scalarOpacity, 2, ([v, a]) => [v!, limitar01(a! * opacidade)]),
    colorTransfer: mapearPontos(base.colorTransfer, 4, ([v, r, g, b]) => [
      v!,
      limitar01(r! * brilho),
      limitar01(g! * brilho),
      limitar01(b! * brilho),
    ]),
  };
}

export type Vista3d = 'A' | 'P' | 'D' | 'E' | 'S' | 'I';

/**
 * As seis vistas padrão, em coordenadas do paciente (LPS: x para a esquerda do paciente,
 * y para trás, z para a cabeça). `normal` aponta do centro do volume para a câmera,
 * como o `viewPlaneNormal` do Cornerstone. A vista anterior é a do coronal: direita do
 * paciente à esquerda da tela.
 */
export const VISTAS_3D: Record<Vista3d, { rotulo: string; normal: [number, number, number]; cima: [number, number, number] }> = {
  A: { rotulo: 'Anterior', normal: [0, -1, 0], cima: [0, 0, 1] },
  P: { rotulo: 'Posterior', normal: [0, 1, 0], cima: [0, 0, 1] },
  D: { rotulo: 'Direita', normal: [-1, 0, 0], cima: [0, 0, 1] },
  E: { rotulo: 'Esquerda', normal: [1, 0, 0], cima: [0, 0, 1] },
  S: { rotulo: 'Superior', normal: [0, 0, 1], cima: [0, -1, 0] },
  I: { rotulo: 'Inferior', normal: [0, 0, -1], cima: [0, -1, 0] },
};
