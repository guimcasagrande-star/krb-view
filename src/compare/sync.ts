/**
 * Sincronização da rolagem entre dois exames (comparação atual × anterior).
 *
 * A rolagem é ligada pela POSIÇÃO em mm ao longo da normal dos cortes, nunca
 * pelo índice do corte. Assim, exames com espessuras diferentes continuam
 * alinhados.
 *
 *   posição no destino = sinal × posição na origem + deslocamento
 *
 * Exames de datas diferentes não compartilham o mesmo referencial, então o
 * deslocamento começa com um palpite e o usuário corrige alinhando os dois
 * num ponto anatômico (`relink`).
 */

import { angleDeg, sub, type StackGeometry } from '../io/geometry';
import type { Issue, Vec3 } from '../io/types';

export interface ScrollLink {
  /** +1 se as normais apontam para o mesmo lado, -1 se são opostas. */
  sign: 1 | -1;
  /** Deslocamento em mm aplicado à posição da origem. */
  offsetMm: number;
}

export type InitialAlignment =
  /** Mesmo referencial (mesma aquisição): deslocamento zero. */
  | 'mesmo-referencial'
  /** Alinha os centros das duas pilhas. */
  | 'centro'
  /** Em séries axiais, alinha os cortes mais superiores. Nas demais, os centros. */
  | 'superior';

export interface LinkOptions {
  alignment?: InitialAlignment;
  /** Maior ângulo aceito entre os planos dos dois exames. Padrão 20 graus. */
  maxAngleDeg?: number;
}

function isIssue(value: unknown): value is Issue {
  return typeof value === 'object' && value !== null && 'code' in value;
}

export { isIssue };

/**
 * Cria a ligação entre duas pilhas. Devolve um `Issue` quando não dá para
 * sincronizar por posição (planos diferentes ou série sem geometria).
 */
export function createLink(
  source: StackGeometry,
  target: StackGeometry,
  options: LinkOptions = {},
): ScrollLink | Issue {
  if (!source.normal || !target.normal || source.positions.length === 0 || target.positions.length === 0) {
    return {
      code: 'SEM_GEOMETRIA',
      message: 'Uma das séries não tem posição dos cortes; a rolagem só pode ser ligada por número do corte.',
    };
  }
  const angle = angleDeg(source.normal, target.normal);
  const maxAngle = options.maxAngleDeg ?? 20;
  let sign: 1 | -1;
  if (angle <= maxAngle) sign = 1;
  else if (angle >= 180 - maxAngle) sign = -1;
  else {
    return {
      code: 'PLANOS_DIFERENTES',
      message: 'As séries estão em planos diferentes; não dá para ligar a rolagem.',
    };
  }

  const alignment = options.alignment ?? 'superior';
  if (alignment === 'mesmo-referencial') return { sign, offsetMm: 0 };

  const range = (positions: number[]) => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of positions) {
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return { min, max, center: (min + max) / 2 };
  };
  const s = range(source.positions);
  const t = range(target.positions);

  const axial = source.plane?.plane === 'axial';
  if (alignment === 'superior' && axial) {
    // Extremidade superior = maior z do paciente. A posição é medida ao longo
    // da normal, então depende de a normal apontar para cima ou para baixo.
    const sourceTop = source.normal[2] > 0 ? s.max : s.min;
    const targetTop = target.normal[2] > 0 ? t.max : t.min;
    return { sign, offsetMm: targetTop - sign * sourceTop };
  }
  return { sign, offsetMm: t.center - sign * s.center };
}

/** Posição da origem -> posição equivalente no destino. */
export function mapPosition(link: ScrollLink, sourcePosition: number): number {
  return link.sign * sourcePosition + link.offsetMm;
}

/** Ligação no sentido contrário (destino -> origem). */
export function invertLink(link: ScrollLink): ScrollLink {
  // t = s·p + o  =>  p = s·t − s·o   (s = ±1)
  // O `|| 0` evita o zero negativo quando sinal −1 multiplica deslocamento 0.
  return { sign: link.sign, offsetMm: -link.sign * link.offsetMm || 0 };
}

/**
 * Recalcula o deslocamento depois do ajuste manual: o usuário rolou os dois
 * exames separadamente até o mesmo ponto anatômico e religou.
 */
export function relink(link: ScrollLink, sourcePosition: number, targetPosition: number): ScrollLink {
  return { sign: link.sign, offsetMm: targetPosition - link.sign * sourcePosition };
}

/** Índice do corte mais próximo de `position`. Aceita posições crescentes ou decrescentes. */
export function nearestIndex(positions: number[], position: number): number {
  const n = positions.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  const ascending = positions[n - 1]! >= positions[0]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const before = ascending ? positions[mid]! <= position : positions[mid]! >= position;
    if (before) lo = mid;
    else hi = mid;
  }
  return Math.abs(positions[lo]! - position) <= Math.abs(positions[hi]! - position) ? lo : hi;
}

export interface SyncedSlice {
  /** Corte do destino a mostrar. */
  index: number;
  /** Posição desejada no destino (mm). */
  position: number;
  /** Distância entre a posição desejada e o corte escolhido (mm). */
  distanceMm: number;
  /** Verdadeiro se a posição desejada cai fora da cobertura do destino. */
  outOfRange: boolean;
}

/**
 * Dado o corte atual da origem, diz qual corte do destino mostrar.
 * Fora da cobertura, devolve o corte da extremidade e marca `outOfRange`.
 */
export function syncedSlice(
  link: ScrollLink,
  sourcePosition: number,
  target: StackGeometry,
): SyncedSlice | undefined {
  if (target.positions.length === 0) return undefined;
  const position = mapPosition(link, sourcePosition);
  const index = nearestIndex(target.positions, position);
  const distanceMm = Math.abs(target.positions[index]! - position);
  const margin = (target.sliceSpacing ?? 0) / 2 + 1e-6;
  return { index, position, distanceMm, outOfRange: distanceMm > margin };
}

// ---------------------------------------------------------------------------
// Ligação em 3D (MPR comparado e ajuste manual do registro da fusão)
// ---------------------------------------------------------------------------

/** Translação que leva um ponto do exame de origem ao ponto equivalente no destino. */
export function translationFromPoints(sourcePoint: Vec3, targetPoint: Vec3): Vec3 {
  return sub(targetPoint, sourcePoint);
}

export function applyTranslation(point: Vec3, translation: Vec3): Vec3 {
  return [point[0] + translation[0], point[1] + translation[1], point[2] + translation[2]];
}
