/**
 * Geometria de séries DICOM: ordenação de cortes, separação de séries com
 * várias fases/orientações e validação antes de montar um volume (MPR/MIP/3D).
 *
 * Sistema de coordenadas do paciente (LPS): +x = esquerda, +y = posterior,
 * +z = superior. Tudo em milímetros.
 */

import type { InstanceMeta, Issue, Orientation, Vec3 } from './types';

// ---------------------------------------------------------------------------
// Vetores
// ---------------------------------------------------------------------------

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const n = length(a);
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n];
}

/** Ângulo em graus entre dois vetores (0 a 180). */
export function angleDeg(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Orientação
// ---------------------------------------------------------------------------

export function rowDirection(iop: Orientation): Vec3 {
  return [iop[0], iop[1], iop[2]];
}

export function columnDirection(iop: Orientation): Vec3 {
  return [iop[3], iop[4], iop[5]];
}

/** Normal do corte: produto vetorial da direção da linha pela da coluna. */
export function sliceNormal(iop: Orientation): Vec3 {
  return normalize(cross(rowDirection(iop), columnDirection(iop)));
}

export type PlaneName = 'axial' | 'coronal' | 'sagital';

export interface PlaneInfo {
  plane: PlaneName;
  /** Verdadeiro se o corte está inclinado mais que `obliqueToleranceDeg` em relação ao plano ortogonal. */
  oblique: boolean;
  /** Inclinação em graus em relação ao plano ortogonal mais próximo. */
  angleFromOrthogonalDeg: number;
}

export function classifyPlane(iop: Orientation, obliqueToleranceDeg = 10): PlaneInfo {
  const n = sliceNormal(iop);
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  let plane: PlaneName;
  let dominant: number;
  if (az >= ax && az >= ay) {
    plane = 'axial';
    dominant = az;
  } else if (ay >= ax) {
    plane = 'coronal';
    dominant = ay;
  } else {
    plane = 'sagital';
    dominant = ax;
  }
  const angle = (Math.acos(Math.min(1, dominant)) * 180) / Math.PI;
  return { plane, oblique: angle > obliqueToleranceDeg, angleFromOrthogonalDeg: angle };
}

const SAME_ORIENTATION_COS = Math.cos((0.5 * Math.PI) / 180);

/** Dois cortes têm a mesma orientação (tolerância de 0,5 grau)? */
export function sameOrientation(a: Orientation, b: Orientation): boolean {
  return (
    dot(normalize(rowDirection(a)), normalize(rowDirection(b))) >= SAME_ORIENTATION_COS &&
    dot(normalize(columnDirection(a)), normalize(columnDirection(b))) >= SAME_ORIENTATION_COS
  );
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

export type SortMethod = 'geometria' | 'numero' | 'arquivo';

export interface SortResult {
  sorted: InstanceMeta[];
  method: SortMethod;
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function hasGeometry(i: InstanceMeta): boolean {
  return i.imagePositionPatient !== undefined && i.imageOrientationPatient !== undefined;
}

/**
 * Ordena os cortes de UMA pilha (já separada por `splitIntoStacks`).
 *
 * 1. Pela posição ao longo da normal do corte, quando todos têm
 *    ImagePositionPatient/ImageOrientationPatient com a mesma orientação.
 * 2. Senão, por InstanceNumber.
 * 3. Senão, pelo nome do arquivo.
 *
 * Na ordenação por geometria, o sentido segue o InstanceNumber quando ele
 * existe (o primeiro corte mostrado é o mesmo do equipamento). Sem
 * InstanceNumber, cortes axiais começam pelo mais superior.
 */
export function sortSlices(instances: InstanceMeta[]): SortResult {
  if (instances.length <= 1) {
    return { sorted: [...instances], method: 'geometria' };
  }

  const first = instances[0]!;
  const geometric =
    instances.every(hasGeometry) &&
    instances.every((i) =>
      sameOrientation(i.imageOrientationPatient!, first.imageOrientationPatient!),
    );

  if (geometric) {
    const normal = sliceNormal(first.imageOrientationPatient!);
    const keyed = instances.map((instance) => ({
      instance,
      pos: dot(instance.imagePositionPatient!, normal),
    }));
    keyed.sort(
      (a, b) =>
        a.pos - b.pos ||
        (a.instance.instanceNumber ?? 0) - (b.instance.instanceNumber ?? 0) ||
        collator.compare(a.instance.fileId, b.instance.fileId),
    );

    let votes = 0;
    let voters = 0;
    for (let k = 1; k < keyed.length; k++) {
      const prev = keyed[k - 1]!.instance.instanceNumber;
      const cur = keyed[k]!.instance.instanceNumber;
      if (prev === undefined || cur === undefined || prev === cur) continue;
      votes += cur > prev ? 1 : -1;
      voters++;
    }

    let reverse: boolean;
    if (voters > 0) {
      reverse = votes < 0;
    } else {
      // Sem InstanceNumber: axial começa pelo corte mais superior (+z).
      const axial = classifyPlane(first.imageOrientationPatient!).plane === 'axial';
      reverse = axial && normal[2] > 0;
    }
    if (reverse) keyed.reverse();
    return { sorted: keyed.map((k) => k.instance), method: 'geometria' };
  }

  if (instances.every((i) => i.instanceNumber !== undefined)) {
    const sorted = [...instances].sort(
      (a, b) => a.instanceNumber! - b.instanceNumber! || collator.compare(a.fileId, b.fileId),
    );
    return { sorted, method: 'numero' };
  }

  return {
    sorted: [...instances].sort((a, b) => collator.compare(a.fileId, b.fileId)),
    method: 'arquivo',
  };
}

// ---------------------------------------------------------------------------
// Separação de uma série em pilhas
// ---------------------------------------------------------------------------

export interface Stack {
  instances: InstanceMeta[];
  /** Rótulo quando a série foi dividida, ex.: 'b=800', 'fase 2'. */
  label?: string;
}

type SplitKey = {
  name: string;
  value: (i: InstanceMeta) => string | number | undefined;
  label: (v: string | number) => string;
};

const SPLIT_KEYS: SplitKey[] = [
  {
    name: 'temporalPositionIdentifier',
    value: (i) => i.temporalPositionIdentifier,
    label: (v) => `fase ${v}`,
  },
  { name: 'diffusionBValue', value: (i) => i.diffusionBValue, label: (v) => `b=${v}` },
  { name: 'echoTime', value: (i) => i.echoTime, label: (v) => `TE ${v}` },
  { name: 'acquisitionNumber', value: (i) => i.acquisitionNumber, label: (v) => `aquisição ${v}` },
  { name: 'triggerTime', value: (i) => i.triggerTime, label: (v) => `trigger ${v}` },
  { name: 'imageType', value: (i) => i.imageType.join('\\'), label: (v) => String(v) },
];

/** Posições mais próximas que isto (mm) são consideradas o mesmo corte. */
const DUPLICATE_TOLERANCE_MM = 0.01;

function positionKey(instance: InstanceMeta, normal: Vec3): number {
  return Math.round(dot(instance.imagePositionPatient!, normal) / DUPLICATE_TOLERANCE_MM);
}

/** Maior número de cortes que caem na mesma posição. */
function maxMultiplicity(instances: InstanceMeta[], normal: Vec3): number {
  const counts = new Map<number, number>();
  let max = 0;
  for (const i of instances) {
    const key = positionKey(i, normal);
    const c = (counts.get(key) ?? 0) + 1;
    counts.set(key, c);
    if (c > max) max = c;
  }
  return max;
}

function splitDuplicates(instances: InstanceMeta[], normal: Vec3, keys: SplitKey[]): Stack[] {
  const multiplicity = maxMultiplicity(instances, normal);
  if (multiplicity <= 1) return [{ instances }];

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k]!;
    const parts = new Map<string | number, InstanceMeta[]>();
    let missing = false;
    for (const i of instances) {
      const v = key.value(i);
      if (v === undefined || v === '') {
        missing = true;
        break;
      }
      const list = parts.get(v);
      if (list) list.push(i);
      else parts.set(v, [i]);
    }
    // Uma chave só serve se separa em no máximo `multiplicity` grupos e cada
    // grupo fica com menos repetições. Isso evita picotar a série por uma tag
    // que muda a cada corte (AcquisitionNumber ou TriggerTime em alguns equipamentos).
    if (missing || parts.size < 2 || parts.size > multiplicity) continue;
    const improves = [...parts.values()].every((p) => maxMultiplicity(p, normal) < multiplicity);
    if (!improves) continue;

    const remaining = keys.filter((_, idx) => idx !== k);
    const result: Stack[] = [];
    const ordered = [...parts.entries()].sort((a, b) => collator.compare(String(a[0]), String(b[0])));
    for (const [value, part] of ordered) {
      for (const sub of splitDuplicates(part, normal, remaining)) {
        const own = key.label(value);
        result.push({
          instances: sub.instances,
          label: sub.label ? `${own}, ${sub.label}` : own,
        });
      }
    }
    return result;
  }

  // Nenhuma tag separa. Se cada posição tem o mesmo número de cortes, separa
  // pela ordem de ocorrência (1º de cada posição, 2º de cada posição...).
  const byPosition = new Map<number, InstanceMeta[]>();
  for (const i of instances) {
    const key = positionKey(i, normal);
    const list = byPosition.get(key);
    if (list) list.push(i);
    else byPosition.set(key, [i]);
  }
  const uniform = [...byPosition.values()].every((list) => list.length === multiplicity);
  if (!uniform) return [{ instances }];

  const stacks: Stack[] = Array.from({ length: multiplicity }, (_, n) => ({
    instances: [],
    label: `parte ${n + 1}`,
  }));
  for (const list of byPosition.values()) {
    list.sort(
      (a, b) =>
        (a.instanceNumber ?? 0) - (b.instanceNumber ?? 0) || collator.compare(a.fileId, b.fileId),
    );
    list.forEach((instance, n) => stacks[n]!.instances.push(instance));
  }
  return stacks;
}

/**
 * Divide os arquivos de uma série em pilhas coerentes:
 *
 * - orientações ou tamanhos de matriz diferentes viram pilhas separadas
 *   (localizadores com três planos, por exemplo);
 * - cortes repetidos na mesma posição são separados por fase, valor de b,
 *   eco etc. (dinâmico, difusão, multi-eco).
 *
 * Cada pilha devolvida já vem ordenada por `sortSlices`.
 */
export function splitIntoStacks(instances: InstanceMeta[]): Stack[] {
  const withGeometry = instances.filter(hasGeometry);
  const withoutGeometry = instances.filter((i) => !hasGeometry(i));

  const groups: InstanceMeta[][] = [];
  for (const instance of withGeometry) {
    const group = groups.find((g) => {
      const ref = g[0]!;
      return (
        ref.rows === instance.rows &&
        ref.columns === instance.columns &&
        sameOrientation(ref.imageOrientationPatient!, instance.imageOrientationPatient!)
      );
    });
    if (group) group.push(instance);
    else groups.push([instance]);
  }

  const stacks: Stack[] = [];
  for (const group of groups) {
    const normal = sliceNormal(group[0]!.imageOrientationPatient!);
    for (const stack of splitDuplicates(group, normal, SPLIT_KEYS)) {
      stacks.push({ ...stack, instances: sortSlices(stack.instances).sorted });
    }
  }
  if (withoutGeometry.length > 0) {
    stacks.push({ instances: sortSlices(withoutGeometry).sorted });
  }

  // Pilhas maiores primeiro, para a principal ser a primeira da lista.
  const order = new Map(stacks.map((s, idx) => [s, idx]));
  stacks.sort((a, b) => b.instances.length - a.instances.length || order.get(a)! - order.get(b)!);
  return stacks;
}

// ---------------------------------------------------------------------------
// Análise da pilha
// ---------------------------------------------------------------------------

export interface StackGeometry {
  count: number;
  rows?: number;
  columns?: number;
  /** [entre linhas, entre colunas] em mm */
  pixelSpacing?: [number, number];
  orientation?: Orientation;
  normal?: Vec3;
  plane?: PlaneInfo;
  /** Posição de cada corte ao longo da normal, na ordem recebida (mm). */
  positions: number[];
  /** Distância mediana entre cortes vizinhos (mm). */
  sliceSpacing?: number;
  /** +1 se a posição cresce com o índice, -1 se diminui. */
  direction: 1 | -1;
  /** Distância do primeiro ao último corte ao longo da normal (mm). */
  extentMm: number;
  /** Ângulo entre a direção de empilhamento e a normal (gantry tilt), em graus. */
  tiltDeg: number;
  /** Verdadeiro se a pilha pode virar volume (MPR, MIP, 3D, fusão). */
  volumeOk: boolean;
  issues: Issue[];
}

export interface AnalyzeOptions {
  /** Tolerância absoluta do espaçamento (mm). Padrão 0,02. */
  spacingToleranceMm?: number;
  /** Tolerância relativa do espaçamento. Padrão 1%. */
  spacingToleranceRatio?: number;
  /** Inclinação máxima aceita entre empilhamento e normal. Padrão 0,5 grau. */
  maxTiltDeg?: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Analisa uma pilha JÁ ORDENADA e diz se ela pode virar volume.
 *
 * Quando `volumeOk` é falso, a interface deve mostrar as mensagens de `issues`
 * e oferecer só a visualização 2D.
 */
export function analyzeStack(sorted: InstanceMeta[], options: AnalyzeOptions = {}): StackGeometry {
  const tolAbs = options.spacingToleranceMm ?? 0.02;
  const tolRatio = options.spacingToleranceRatio ?? 0.01;
  const maxTilt = options.maxTiltDeg ?? 0.5;

  const issues: Issue[] = [];
  const result: StackGeometry = {
    count: sorted.length,
    positions: [],
    direction: 1,
    extentMm: 0,
    tiltDeg: 0,
    volumeOk: false,
    issues,
  };
  if (sorted.length === 0) {
    issues.push({ code: 'VAZIA', message: 'A série não tem imagens.' });
    return result;
  }

  const first = sorted[0]!;
  result.rows = first.rows;
  result.columns = first.columns;
  result.pixelSpacing = first.pixelSpacing;

  if (sorted.some((i) => (i.numberOfFrames ?? 1) > 1)) {
    issues.push({
      code: 'MULTIFRAME',
      message: 'Série com imagens multiframe: a geometria por quadro ainda não é lida.',
    });
    return result;
  }

  if (!sorted.every(hasGeometry)) {
    issues.push({
      code: 'SEM_GEOMETRIA',
      message: 'Há imagens sem posição ou orientação no cabeçalho.',
    });
    return result;
  }

  const orientation = first.imageOrientationPatient!;
  result.orientation = orientation;
  const normal = sliceNormal(orientation);
  result.normal = normal;
  result.plane = classifyPlane(orientation);
  result.positions = sorted.map((i) => dot(i.imagePositionPatient!, normal));

  const orthogonality = Math.abs(
    dot(normalize(rowDirection(orientation)), normalize(columnDirection(orientation))),
  );
  if (orthogonality > 1e-3 || length(normal) === 0) {
    issues.push({
      code: 'ORIENTACAO_INVALIDA',
      message: 'A orientação da imagem no cabeçalho é inválida (linha e coluna não são perpendiculares).',
    });
  }

  if (!sorted.every((i) => sameOrientation(i.imageOrientationPatient!, orientation))) {
    issues.push({
      code: 'ORIENTACAO_VARIAVEL',
      message: 'Os cortes da série têm orientações diferentes.',
    });
  }

  const sameSize = sorted.every((i) => i.rows === first.rows && i.columns === first.columns);
  const sameSpacing = sorted.every((i) => {
    if (!first.pixelSpacing || !i.pixelSpacing) return first.pixelSpacing === i.pixelSpacing;
    return (
      Math.abs(i.pixelSpacing[0] - first.pixelSpacing[0]) < 1e-4 &&
      Math.abs(i.pixelSpacing[1] - first.pixelSpacing[1]) < 1e-4
    );
  });
  if (!sameSize || !sameSpacing) {
    issues.push({
      code: 'TAMANHO_VARIAVEL',
      message: 'Os cortes da série têm matriz ou tamanho de pixel diferentes.',
    });
  }
  if (!first.pixelSpacing) {
    issues.push({
      code: 'SEM_PIXEL_SPACING',
      message: 'A série não informa o tamanho do pixel; medidas em mm não são confiáveis.',
    });
  }

  if (sorted.length < 3) {
    issues.push({
      code: 'POUCOS_CORTES',
      message: 'A série tem menos de 3 cortes; não dá para montar volume.',
    });
    result.volumeOk = false;
    return result;
  }

  const last = sorted[sorted.length - 1]!;
  const stackVector = sub(last.imagePositionPatient!, first.imagePositionPatient!);
  const along = dot(stackVector, normal);
  result.direction = along >= 0 ? 1 : -1;
  result.extentMm = Math.abs(along);

  const gaps: number[] = [];
  for (let k = 1; k < result.positions.length; k++) {
    gaps.push((result.positions[k]! - result.positions[k - 1]!) * result.direction);
  }

  const duplicates = gaps.filter((g) => Math.abs(g) < DUPLICATE_TOLERANCE_MM).length;
  if (duplicates > 0) {
    issues.push({
      code: 'POSICAO_DUPLICADA',
      message: `Há ${duplicates} corte(s) na mesma posição de outro (série com várias fases ou imagens repetidas).`,
    });
  }
  if (gaps.some((g) => g <= -DUPLICATE_TOLERANCE_MM)) {
    issues.push({
      code: 'FORA_DE_ORDEM',
      message: 'Os cortes não estão ordenados pela posição.',
    });
  }

  const positiveGaps = gaps.filter((g) => g >= DUPLICATE_TOLERANCE_MM);
  if (positiveGaps.length > 0) {
    const spacing = median(positiveGaps);
    result.sliceSpacing = spacing;
    const tol = Math.max(tolAbs, tolRatio * spacing);

    let missing = 0;
    let irregular = 0;
    for (const g of positiveGaps) {
      if (Math.abs(g - spacing) <= tol) continue;
      const multiple = Math.round(g / spacing);
      if (multiple >= 2 && Math.abs(g - multiple * spacing) <= tol * multiple) {
        missing += multiple - 1;
      } else {
        irregular++;
      }
    }
    if (missing > 0) {
      issues.push({
        code: 'CORTES_FALTANDO',
        message: `Parecem faltar ${missing} corte(s) na série.`,
      });
    }
    if (irregular > 0) {
      issues.push({
        code: 'ESPACAMENTO_IRREGULAR',
        message: 'O espaçamento entre os cortes não é constante.',
      });
    }
  }

  // Gantry tilt: os cortes "escorregam" lateralmente em vez de empilhar na
  // direção da normal. Montar volume assim deforma a anatomia.
  const reference: Vec3 = result.direction === 1 ? normal : scale(normal, -1);
  result.tiltDeg = length(stackVector) === 0 ? 0 : angleDeg(stackVector, reference);
  if (result.tiltDeg > maxTilt) {
    issues.push({
      code: 'GANTRY_INCLINADO',
      message: `Aquisição com gantry inclinado (${result.tiltDeg.toFixed(1)}°): o volume ficaria deformado.`,
    });
  }

  const blocking = new Set([
    'ORIENTACAO_INVALIDA',
    'ORIENTACAO_VARIAVEL',
    'TAMANHO_VARIAVEL',
    'SEM_PIXEL_SPACING',
    'POSICAO_DUPLICADA',
    'FORA_DE_ORDEM',
    'CORTES_FALTANDO',
    'ESPACAMENTO_IRREGULAR',
    'GANTRY_INCLINADO',
  ]);
  result.volumeOk = !issues.some((i) => blocking.has(i.code));
  return result;
}

// ---------------------------------------------------------------------------
// Conversão voxel <-> mundo
// ---------------------------------------------------------------------------

/** Grade regular de um volume, pronta para converter índice de voxel em posição do paciente. */
export interface VolumeGrid {
  /** [colunas, linhas, cortes] */
  dims: [number, number, number];
  /** Posição (mm) do centro do voxel (0,0,0). */
  origin: Vec3;
  /** Deslocamento em mm ao andar 1 voxel em i (coluna), j (linha) e k (corte). */
  stepI: Vec3;
  stepJ: Vec3;
  stepK: Vec3;
  /** Tamanho do voxel em mm ao longo de i, j, k. */
  spacing: Vec3;
}

/** Monta a grade de uma pilha ordenada e aprovada por `analyzeStack`. */
export function gridFromStack(sorted: InstanceMeta[]): VolumeGrid | undefined {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last || sorted.length < 2) return undefined;
  if (!first.imagePositionPatient || !first.imageOrientationPatient || !first.pixelSpacing) {
    return undefined;
  }
  if (!last.imagePositionPatient || first.rows === undefined || first.columns === undefined) {
    return undefined;
  }
  const row = normalize(rowDirection(first.imageOrientationPatient));
  const col = normalize(columnDirection(first.imageOrientationPatient));
  // PixelSpacing = [entre linhas, entre colunas]. Andar uma coluna (i) desloca
  // na direção da linha pelo espaçamento entre colunas.
  const stepI = scale(row, first.pixelSpacing[1]);
  const stepJ = scale(col, first.pixelSpacing[0]);
  const stepK = scale(
    sub(last.imagePositionPatient, first.imagePositionPatient),
    1 / (sorted.length - 1),
  );
  return {
    dims: [first.columns, first.rows, sorted.length],
    origin: [...first.imagePositionPatient],
    stepI,
    stepJ,
    stepK,
    spacing: [length(stepI), length(stepJ), length(stepK)],
  };
}

/**
 * Monta a grade a partir das propriedades de um volume do Cornerstone3D
 * (`volume.dimensions`, `volume.spacing`, `volume.origin`, `volume.direction`).
 *
 * Use esta função, e não `gridFromStack`, sempre que os voxels vierem do volume
 * do Cornerstone: ele reordena os cortes ao longo da normal, e essa ordem pode
 * ser a inversa da ordem de exibição da pilha.
 *
 * `direction` são 9 números: direção da linha, direção da coluna e normal.
 */
export function gridFromVolumeProps(props: {
  dimensions: ArrayLike<number>;
  spacing: ArrayLike<number>;
  origin: ArrayLike<number>;
  direction: ArrayLike<number>;
}): VolumeGrid {
  const { dimensions, spacing, origin, direction } = props;
  const axis = (n: number): Vec3 => [
    direction[n * 3]! * spacing[n]!,
    direction[n * 3 + 1]! * spacing[n]!,
    direction[n * 3 + 2]! * spacing[n]!,
  ];
  return {
    dims: [dimensions[0]!, dimensions[1]!, dimensions[2]!],
    origin: [origin[0]!, origin[1]!, origin[2]!],
    stepI: axis(0),
    stepJ: axis(1),
    stepK: axis(2),
    spacing: [spacing[0]!, spacing[1]!, spacing[2]!],
  };
}

/** Índice de voxel (pode ser fracionário) -> posição no paciente (mm). */
export function voxelToWorld(grid: VolumeGrid, ijk: Vec3): Vec3 {
  return [
    grid.origin[0] + ijk[0] * grid.stepI[0] + ijk[1] * grid.stepJ[0] + ijk[2] * grid.stepK[0],
    grid.origin[1] + ijk[0] * grid.stepI[1] + ijk[1] * grid.stepJ[1] + ijk[2] * grid.stepK[1],
    grid.origin[2] + ijk[0] * grid.stepI[2] + ijk[1] * grid.stepJ[2] + ijk[2] * grid.stepK[2],
  ];
}

/** Posição no paciente (mm) -> índice de voxel fracionário. */
export function worldToVoxel(grid: VolumeGrid, world: Vec3): Vec3 | undefined {
  const a = grid.stepI;
  const b = grid.stepJ;
  const c = grid.stepK;
  const bc = cross(b, c);
  const det = dot(a, bc);
  if (Math.abs(det) < 1e-12) return undefined;
  const d = sub(world, grid.origin);
  return [dot(d, bc) / det, dot(d, cross(c, a)) / det, dot(d, cross(a, b)) / det];
}

/** Volume de um voxel em mL (vale também para grades inclinadas). */
export function voxelVolumeMl(grid: VolumeGrid): number {
  return Math.abs(dot(grid.stepI, cross(grid.stepJ, grid.stepK))) / 1000;
}

// ---------------------------------------------------------------------------
// Memória
// ---------------------------------------------------------------------------

/** Bytes necessários para manter o volume em memória. */
export function estimateVolumeBytes(
  columns: number,
  rows: number,
  slices: number,
  bytesPerVoxel: number,
): number {
  return columns * rows * slices * bytesPerVoxel;
}
