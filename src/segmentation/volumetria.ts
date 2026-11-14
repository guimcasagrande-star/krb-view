/**
 * Volumetria por segmento (fase 9.2). Função pura: recebe os rótulos da máscara (um valor por
 * voxel, 0 = fora) e os valores da série (HU ou SUV) na mesma grade, e devolve uma linha por
 * segmento calculada com `maskVolumeMl`, `maskStats` e, no PET, `lesionMetrics`
 * (src/volume/voxelStats.ts). Também monta o CSV.
 */

import { lesionMetrics, type Mask, maskStats, maskVolumeMl, type ScalarVolume } from '../volume/voxelStats';

export interface LinhaVolumetria {
  indice: number;
  nome: string;
  voxels: number;
  volumeMl: number;
  media?: number;
  dp?: number;
  min?: number;
  max?: number;
  /** PET: SUVpico (média da esfera de 1 cm³ mais quente). */
  pico?: number;
  /** PET: TLG = SUVmédio × MTV. */
  tlg?: number;
}

/**
 * Uma linha por segmento, na ordem recebida. Segmento sem voxels: volume 0 e sem estatísticas.
 * `rotulos` e `volume.data` precisam ter o mesmo tamanho e a mesma ordem de voxels.
 */
export function volumetriaDosSegmentos(
  rotulos: ArrayLike<number>,
  volume: ScalarVolume,
  segmentos: Array<{ indice: number; nome: string }>,
  ehPet: boolean,
): LinhaVolumetria[] {
  if (rotulos.length !== volume.data.length) throw new Error('A máscara e o volume têm tamanhos diferentes.');
  // Uma passada para saber quais rótulos existem (evita varrer o volume para segmentos vazios).
  const presentes = new Set<number>();
  for (let i = 0; i < rotulos.length; i++) {
    const r = rotulos[i]!;
    if (r !== 0) presentes.add(r);
  }
  const mascara: Mask = new Uint8Array(rotulos.length);
  return segmentos.map(({ indice, nome }) => {
    if (!presentes.has(indice)) return { indice, nome, voxels: 0, volumeMl: 0 };
    for (let i = 0; i < rotulos.length; i++) mascara[i] = rotulos[i] === indice ? 1 : 0;
    const volumeMl = maskVolumeMl(mascara, volume.grid);
    const st = maskStats(volume, mascara);
    if (!st) return { indice, nome, voxels: 0, volumeMl: 0 };
    const linha: LinhaVolumetria = {
      indice,
      nome,
      voxels: st.count,
      volumeMl,
      media: st.mean,
      dp: st.std,
      min: st.min,
      max: st.max,
    };
    if (ehPet) {
      const lm = lesionMetrics(volume, mascara);
      if (lm) {
        if (lm.peak !== undefined) linha.pico = lm.peak;
        linha.tlg = lm.totalActivity;
      }
    }
    return linha;
  });
}

const dec = (n: number | undefined, casas: number): string =>
  n === undefined || !Number.isFinite(n) ? '' : n.toFixed(casas).replace('.', ',');

/** Tira ";" e quebras de linha de um texto livre (nome do segmento) para não quebrar o CSV. */
const textoCsv = (t: string): string => t.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * CSV separado por ";" com vírgula decimal (abre direto no Excel em português).
 * Sem dados do paciente: só série, segmentos e números.
 */
export function csvVolumetria(linhas: LinhaVolumetria[], unidade: string, ehPet: boolean, serie: string): string {
  const u = unidade || 'valor';
  const casas = ehPet ? 2 : 1;
  const cab = ['Série', 'Segmento', 'Voxels', ehPet ? 'MTV_mL' : 'Volume_mL', `Media_${u}`, `DP_${u}`, `Min_${u}`, `Max_${u}`];
  if (ehPet) cab.push(`Pico_${u}`, 'TLG');
  const saida = [cab.join(';')];
  for (const l of linhas) {
    const campos = [
      textoCsv(serie),
      textoCsv(l.nome),
      String(l.voxels),
      dec(l.volumeMl, 2),
      dec(l.media, casas),
      dec(l.dp, casas),
      dec(l.min, casas),
      dec(l.max, casas),
    ];
    if (ehPet) campos.push(dec(l.pico, 2), dec(l.tlg, 2));
    saida.push(campos.join(';'));
  }
  return saida.join('\r\n');
}
