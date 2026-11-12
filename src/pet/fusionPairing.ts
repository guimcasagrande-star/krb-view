/**
 * Escolha do par PET + TC (ou RM) para fusão.
 *
 * A fusão automática só é confiável quando as duas séries têm o mesmo
 * FrameOfReferenceUID (mesma sessão, mesmo posicionamento). Fora disso, o par
 * é oferecido como "manual" e o usuário precisa alinhar.
 */

import { angleDeg } from '../io/geometry';
import type { SeriesNode, StackNode, StudyNode } from '../io/organize';

export interface FusionCandidate {
  petSeries: SeriesNode;
  pet: StackNode;
  anatomicSeries: SeriesNode;
  anatomic: StackNode;
  /** Mesmo FrameOfReferenceUID: a fusão não precisa de ajuste. */
  sameFrame: boolean;
  /** Fração da extensão do PET coberta pela série anatômica (0 a 1). Só vale com `sameFrame`. */
  overlap: number;
  /** PET com correção de atenuação. */
  attenuationCorrected: boolean;
}

function frameOf(stack: StackNode): string | undefined {
  return stack.instances[0]?.frameOfReferenceUid;
}

function isCorrected(stack: StackNode): boolean {
  return (stack.instances[0]?.pet?.correctedImage ?? []).some((c) => c.toUpperCase() === 'ATTN');
}

/** Fração da extensão de `a` (ao longo da normal de `a`) coberta por `b`. */
function overlapFraction(a: StackNode, b: StackNode): number {
  const normal = a.geometry.normal;
  if (!normal || !b.geometry.normal) return 0;
  const angle = angleDeg(normal, b.geometry.normal);
  if (angle > 5 && angle < 175) return 0;

  const project = (stack: StackNode) => {
    let min = Infinity;
    let max = -Infinity;
    for (const instance of stack.instances) {
      const p = instance.imagePositionPatient!;
      const v = p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max };
  };
  const ra = project(a);
  const rb = project(b);
  const extent = ra.max - ra.min;
  if (extent <= 0) return 0;
  const shared = Math.min(ra.max, rb.max) - Math.max(ra.min, rb.min);
  return Math.max(0, Math.min(1, shared / extent));
}

/**
 * Lista os pares possíveis de um estudo, do melhor para o pior:
 * PET corrigido antes do não corrigido; mesmo referencial antes do manual;
 * maior cobertura; cortes mais finos.
 */
export function findFusionCandidates(study: StudyNode): FusionCandidate[] {
  const pets: [SeriesNode, StackNode][] = [];
  const anatomics: [SeriesNode, StackNode][] = [];
  for (const series of study.series) {
    if (series.kind !== 'imagem') continue;
    for (const stack of series.stacks) {
      if (!stack.geometry.volumeOk) continue;
      if (series.modality === 'PT') pets.push([series, stack]);
      else if (series.modality === 'CT' || series.modality === 'MR') anatomics.push([series, stack]);
    }
  }

  const candidates: FusionCandidate[] = [];
  for (const [petSeries, pet] of pets) {
    for (const [anatomicSeries, anatomic] of anatomics) {
      const petFrame = frameOf(pet);
      const sameFrame = petFrame !== undefined && petFrame === frameOf(anatomic);
      const overlap = sameFrame ? overlapFraction(pet, anatomic) : 0;
      if (sameFrame && overlap === 0) continue;
      candidates.push({
        petSeries,
        pet,
        anatomicSeries,
        anatomic,
        sameFrame,
        overlap,
        attenuationCorrected: isCorrected(pet),
      });
    }
  }

  candidates.sort(
    (a, b) =>
      Number(b.attenuationCorrected) - Number(a.attenuationCorrected) ||
      Number(b.sameFrame) - Number(a.sameFrame) ||
      b.overlap - a.overlap ||
      (a.anatomic.geometry.sliceSpacing ?? Infinity) - (b.anatomic.geometry.sliceSpacing ?? Infinity),
  );
  return candidates;
}
