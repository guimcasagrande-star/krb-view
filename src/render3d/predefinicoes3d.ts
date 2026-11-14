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
  /** Nome da predefinição em `CONSTANTS.VIEWPORT_PRESETS`. */
  preset: string;
  modalidade: Modalidade3d;
  /** Projeção de intensidade máxima em vez de composição (opacidade acumulada). */
  mip?: true;
}

export const PREDEFINICOES_3D: Predefinicao3d[] = [
  { id: 'osso', rotulo: 'Osso', preset: 'CT-Bone', modalidade: 'CT' },
  { id: 'vasos', rotulo: 'Vasos com contraste', preset: 'CT-AAA', modalidade: 'CT' },
  { id: 'torax', rotulo: 'Tórax com contraste', preset: 'CT-Chest-Contrast-Enhanced', modalidade: 'CT' },
  { id: 'pulmao', rotulo: 'Pulmão', preset: 'CT-Lung', modalidade: 'CT' },
  { id: 'partes-moles', rotulo: 'Partes moles', preset: 'CT-Soft-Tissue', modalidade: 'CT' },
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
