/**
 * Predefinições da renderização volumétrica 3D (fase 8.1): nomes em português para as
 * predefinições prontas do Cornerstone (`CONSTANTS.VIEWPORT_PRESETS`) e o ajuste de opacidade
 * e brilho sobre elas. Funções puras: não dependem do navegador.
 */

/** Mesmo formato de `Types.ViewportPreset` do Cornerstone + distância ótica opcional. */
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
  scalarOpacityUnitDistance?: number;
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
 * Predefinições 3D médicas calibradas (padrão OsiriX / Horos / 3D Slicer / GE AW)
 * com curvas de opacidade, pontos RGB e iluminação especular física.
 */
export const PRESETS_PROPRIOS: Preset3d[] = [
  {
    name: 'Visualizador-Angio-VasosOsso',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '12 -1000 0 90 0 135 0.18 240 0.78 450 0.95 1200 1',
    colorTransfer:
      '24 -1000 0 0 0 90 0.55 0.12 0.08 160 0.88 0.2 0.14 280 0.98 0.72 0.32 460 0.95 0.93 0.87 1200 1 1 1',
    ambient: '0.15',
    diffuse: '0.75',
    specular: '0.45',
    specularPower: '25',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.0,
  },
  {
    name: 'Visualizador-Angio-Trapezio',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '14 -1000 0 95 0 140 0.3 230 0.88 370 0.88 480 0.08 650 0',
    colorTransfer:
      '20 -1000 0 0 0 95 0.55 0.1 0.08 170 0.9 0.22 0.16 300 1 0.82 0.4 480 0.9 0.85 0.8',
    ambient: '0.15',
    diffuse: '0.75',
    specular: '0.45',
    specularPower: '25',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.0,
  },
  {
    name: 'Visualizador-Osso',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '10 -1000 0 150 0 230 0.15 450 0.88 1200 1',
    colorTransfer:
      '20 -1000 0 0 0 150 0.65 0.35 0.2 300 0.9 0.83 0.7 650 0.97 0.95 0.9 1200 1 1 0.98',
    ambient: '0.18',
    diffuse: '0.72',
    specular: '0.35',
    specularPower: '20',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.0,
  },
  {
    name: 'Visualizador-Abdome',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '14 -1000 0 -30 0 35 0.04 90 0.16 160 0.55 300 0.88 800 0.95',
    colorTransfer:
      '24 -1000 0 0 0 -30 0.25 0.1 0.08 55 0.72 0.36 0.28 140 0.9 0.28 0.2 260 0.98 0.8 0.5 500 0.96 0.95 0.92',
    ambient: '0.16',
    diffuse: '0.75',
    specular: '0.3',
    specularPower: '18',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.0,
  },
  {
    name: 'Visualizador-Pulmao',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '12 -1000 0 -920 0 -820 0.08 -650 0.22 -400 0.04 -250 0',
    colorTransfer:
      '16 -1000 0 0 0 -900 0.2 0.55 0.85 -700 0.45 0.8 0.92 -450 0.9 0.55 0.45',
    ambient: '0.25',
    diffuse: '0.75',
    specular: '0.1',
    specularPower: '8',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.2,
  },
  {
    name: 'Visualizador-Pele',
    gradientOpacity: '4 0 1 255 1',
    scalarOpacity: '10 -1000 0 -550 0 -350 0.65 -100 0.95 1000 1',
    colorTransfer: '12 -1000 0 0 0 -500 0.86 0.68 0.56 -100 0.92 0.76 0.65',
    ambient: '0.18',
    diffuse: '0.78',
    specular: '0.25',
    specularPower: '15',
    shade: '1',
    interpolation: '1',
    scalarOpacityUnitDistance: 1.0,
  },
];

export const PREDEFINICOES_3D: Predefinicao3d[] = [
  { id: 'angio-vasos-osso', rotulo: 'Angio-TC (Vasos + Osso)', preset: 'Visualizador-Angio-VasosOsso', modalidade: 'CT' },
  { id: 'angio-vascular', rotulo: 'Angio-TC (Foco Vascular)', preset: 'Visualizador-Angio-Trapezio', modalidade: 'CT' },
  { id: 'osso', rotulo: 'Osso 3D (Esqueleto)', preset: 'Visualizador-Osso', modalidade: 'CT' },
  { id: 'abdome', rotulo: 'Abdome / Partes Moles', preset: 'Visualizador-Abdome', modalidade: 'CT' },
  { id: 'pulmao', rotulo: 'Pulmão / Vias Aéreas', preset: 'Visualizador-Pulmao', modalidade: 'CT' },
  { id: 'pele', rotulo: 'Pele / Superfície', preset: 'Visualizador-Pele', modalidade: 'CT' },
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
