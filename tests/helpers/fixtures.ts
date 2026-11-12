import type { InstanceMeta, Orientation, Vec3 } from '../../src/io/types';

export const AXIAL: Orientation = [1, 0, 0, 0, 1, 0];
export const CORONAL: Orientation = [1, 0, 0, 0, 0, -1];
export const SAGITTAL: Orientation = [0, 1, 0, 0, 0, -1];

export interface SeriesOptions {
  count: number;
  spacing?: number;
  origin?: Vec3;
  orientation?: Orientation;
  /** Direção em que os cortes avançam; padrão = normal do corte. */
  step?: Vec3;
  rows?: number;
  columns?: number;
  pixelSpacing?: [number, number];
  seriesUid?: string;
  studyUid?: string;
  modality?: string;
  /** Numeração: 'asc' acompanha a posição, 'desc' é invertida, 'none' sem número. */
  numbering?: 'asc' | 'desc' | 'none';
  extra?: Partial<InstanceMeta>;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Série sintética com geometria regular. */
export function makeSeries(options: SeriesOptions): InstanceMeta[] {
  const orientation = options.orientation ?? AXIAL;
  const normal = cross(
    [orientation[0], orientation[1], orientation[2]],
    [orientation[3], orientation[4], orientation[5]],
  );
  const spacing = options.spacing ?? 2.5;
  const step = options.step ?? ([normal[0] * spacing, normal[1] * spacing, normal[2] * spacing] as Vec3);
  const origin = options.origin ?? [-200, -200, 0];
  const seriesUid = options.seriesUid ?? '1.2.3.100';
  const numbering = options.numbering ?? 'asc';

  const out: InstanceMeta[] = [];
  for (let k = 0; k < options.count; k++) {
    const instance: InstanceMeta = {
      fileId: `${seriesUid}/IM${String(k).padStart(4, '0')}`,
      sopInstanceUid: `${seriesUid}.${k + 1}`,
      studyInstanceUid: options.studyUid ?? '1.2.3',
      seriesInstanceUid: seriesUid,
      modality: options.modality ?? 'CT',
      patientId: 'TESTE001',
      patientName: 'PHANTOM^TESTE',
      rows: options.rows ?? 512,
      columns: options.columns ?? 512,
      pixelSpacing: options.pixelSpacing ?? [0.8, 0.8],
      imagePositionPatient: [origin[0] + k * step[0], origin[1] + k * step[1], origin[2] + k * step[2]],
      imageOrientationPatient: [...orientation] as Orientation,
      frameOfReferenceUid: '1.2.3.999',
      imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
      windowCenter: [40],
      windowWidth: [400],
      ...options.extra,
    };
    if (numbering === 'asc') instance.instanceNumber = k + 1;
    if (numbering === 'desc') instance.instanceNumber = options.count - k;
    out.push(instance);
  }
  return out;
}

/** Embaralha de forma determinística (para testar ordenação). */
export function shuffle<T>(items: T[], seed = 7): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
