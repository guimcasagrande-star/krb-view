/**
 * ROI volumétrica esférica (VOI): estatísticas dos voxels dentro de uma esfera.
 * Função pura sobre `ScalarVolume` (sem Cornerstone), usando `voxelStats`.
 */

import { worldToVoxel } from '../io/geometry';
import type { Vec3 } from '../io/types';
import { maskStats, peakInMask, type ScalarVolume, sphereMask } from './voxelStats';

export interface ResultadoVoi {
  ok: true;
  raioMm: number;
  /** Volume da esfera medido em voxels, em mL (aproxima 4/3·π·r³). */
  volumeMl: number;
  voxels: number;
  media: number;
  desvio: number;
  min: number;
  max: number;
  /** Maior média numa esfera de 1 mL dentro da região (SUVpico, no PET). */
  pico?: number;
}

export type RespostaVoi = ResultadoVoi | { ok: false; motivo: string };

/**
 * Estatísticas da esfera de raio `raioMm` centrada em `centroMundo` (mm, coordenadas do paciente).
 * Os valores são usados como estão no volume: o carregador já entrega HU e SUV (sem novo fator).
 */
export function calcularVoiEsfera(
  volume: ScalarVolume,
  centroMundo: Vec3,
  raioMm: number,
  comPico: boolean,
): RespostaVoi {
  if (!(raioMm > 0)) return { ok: false, motivo: 'Raio inválido.' };
  const ijk = worldToVoxel(volume.grid, centroMundo);
  if (!ijk) return { ok: false, motivo: 'Geometria do volume inválida.' };
  const [nx, ny, nz] = volume.grid.dims;
  if (ijk[0] < -0.5 || ijk[1] < -0.5 || ijk[2] < -0.5 || ijk[0] > nx - 0.5 || ijk[1] > ny - 0.5 || ijk[2] > nz - 0.5) {
    return { ok: false, motivo: 'O centro está fora do volume.' };
  }
  const mascara = sphereMask(volume.grid, ijk, raioMm);
  const s = maskStats(volume, mascara);
  if (!s) return { ok: false, motivo: 'Nenhum voxel dentro da esfera (raio menor que o voxel).' };
  const r: ResultadoVoi = {
    ok: true,
    raioMm,
    volumeMl: s.volumeMl,
    voxels: s.count,
    media: s.mean,
    desvio: s.std,
    min: s.min,
    max: s.max,
  };
  if (comPico) {
    const p = peakInMask(volume, mascara);
    if (p) r.pico = p.value;
  }
  return r;
}
