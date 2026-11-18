/**
 * Volumetria por segmento (fase 9.2). Funções puras: recebem os rótulos da máscara (um valor
 * por voxel, 0 = fora) e os valores da série (HU ou SUV) na mesma grade, calculando tudo em
 * uma única passada (sem alocar máscaras por segmento) e usando `peakInMask` no PET para o SUVpico.
 */

import { voxelVolumeMl, type VolumeGrid } from '../io/geometry';
import { type Mask, peakInMask, type ScalarVolume } from '../volume/voxelStats';

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

export interface EstatisticaSegmentoUnificada {
  indice: number;
  nome: string;
  voxelCount: number;
  volumeMl: number;
  min: number;
  max: number;
  media: number;
  dp: number;
}

interface AcumuladoresVolumetria {
  segmentos: Array<{ indice: number; nome: string }>;
  slotPorPosicao: Int32Array;
  counts: Int32Array;
  mins: Float64Array;
  maxs: Float64Array;
  refs: Float64Array;
  temRef: Uint8Array;
  sumDs: Float64Array;
  sumD2s: Float64Array;
  tabelaDireta: Int32Array | null;
  mapaFallback: Map<number, number> | null;
}

function criarAcumuladores(segmentos: Array<{ indice: number; nome: string }>): AcumuladoresVolumetria {
  const n = segmentos.length;
  const slotPorPosicao = new Int32Array(n);
  const mapaUnico = new Map<number, number>();
  let minIdx = Infinity;
  let maxIdx = -Infinity;
  for (let i = 0; i < n; i++) {
    const idx = segmentos[i]!.indice;
    if (idx === 0) {
      slotPorPosicao[i] = -1;
      continue;
    }
    let slot = mapaUnico.get(idx);
    if (slot === undefined) {
      slot = mapaUnico.size;
      mapaUnico.set(idx, slot);
      if (idx < minIdx) minIdx = idx;
      if (idx > maxIdx) maxIdx = idx;
    }
    slotPorPosicao[i] = slot;
  }

  const qtdSlots = mapaUnico.size;
  const usaTabelaDireta = qtdSlots > 0 && minIdx >= 1 && maxIdx <= 4095;
  let tabelaDireta: Int32Array | null = null;
  let mapaFallback: Map<number, number> | null = null;
  if (usaTabelaDireta) {
    tabelaDireta = new Int32Array(maxIdx + 1).fill(-1);
    for (const [idx, slot] of mapaUnico) tabelaDireta[idx] = slot;
  } else {
    mapaFallback = mapaUnico;
  }

  return {
    segmentos,
    slotPorPosicao,
    counts: new Int32Array(qtdSlots),
    mins: new Float64Array(qtdSlots).fill(Infinity),
    maxs: new Float64Array(qtdSlots).fill(-Infinity),
    refs: new Float64Array(qtdSlots),
    temRef: new Uint8Array(qtdSlots),
    sumDs: new Float64Array(qtdSlots),
    sumD2s: new Float64Array(qtdSlots),
    tabelaDireta,
    mapaFallback,
  };
}

function acumularFatia(
  acc: AcumuladoresVolumetria,
  rotulos: ArrayLike<number>,
  valoresEscalares: ArrayLike<number> | undefined,
  offsetValores: number,
  fatorSpv: number,
): void {
  const { counts, mins, maxs, refs, temRef, sumDs, sumD2s, tabelaDireta, mapaFallback } = acc;
  const limiteTabela = tabelaDireta ? tabelaDireta.length : 0;
  const n = rotulos.length;

  for (let i = 0; i < n; i++) {
    const idxSeg = rotulos[i]!;
    if (idxSeg === 0) continue;
    const slot = tabelaDireta
      ? idxSeg > 0 && idxSeg < limiteTabela
        ? tabelaDireta[idxSeg]!
        : -1
      : (mapaFallback!.get(idxSeg) ?? -1);
    if (slot < 0) continue;

    counts[slot] = counts[slot]! + 1;
    if (valoresEscalares) {
      const val = valoresEscalares[offsetValores + i]! * fatorSpv;
      if (temRef[slot] === 0) {
        temRef[slot] = 1;
        refs[slot] = val;
        mins[slot] = val;
        maxs[slot] = val;
      } else {
        const d = val - refs[slot]!;
        sumDs[slot] = sumDs[slot]! + d;
        sumD2s[slot] = sumD2s[slot]! + d * d;
        if (val < mins[slot]!) mins[slot] = val;
        if (val > maxs[slot]!) maxs[slot] = val;
      }
    }
  }
}

function resumirAcumuladores(
  acc: AcumuladoresVolumetria,
  volumeVoxelMl: number,
  comValores: boolean,
): EstatisticaSegmentoUnificada[] {
  const { segmentos, slotPorPosicao, counts, mins, maxs, refs, sumDs, sumD2s } = acc;
  const resultado: EstatisticaSegmentoUnificada[] = new Array(segmentos.length);
  for (let k = 0; k < segmentos.length; k++) {
    const s = segmentos[k]!;
    const slot = slotPorPosicao[k]!;
    const voxelCount = slot >= 0 ? counts[slot]! : 0;
    const volumeMl = voxelCount * volumeVoxelMl;
    if (voxelCount === 0 || !comValores) {
      resultado[k] = {
        indice: s.indice,
        nome: s.nome,
        voxelCount,
        volumeMl,
        min: 0,
        max: 0,
        media: 0,
        dp: 0,
      };
      continue;
    }
    const meanShift = sumDs[slot]! / voxelCount;
    const media = refs[slot]! + meanShift;
    const variance = Math.max(0, sumD2s[slot]! / voxelCount - meanShift * meanShift);
    resultado[k] = {
      indice: s.indice,
      nome: s.nome,
      voxelCount,
      volumeMl,
      min: mins[slot]!,
      max: maxs[slot]!,
      media,
      dp: Math.sqrt(variance),
    };
  }
  return resultado;
}

/**
 * Calcula estatísticas e volumetria de todos os segmentos em uma única passada
 * pelo array de rótulos e opcionalmente pelo array de valores escalares (HU/SUV).
 */
export function volumetriaPassadaUnica(
  rotulos: ArrayLike<number>,
  valoresEscalares: ArrayLike<number> | undefined,
  segmentos: Array<{ indice: number; nome: string }>,
  espacamento: readonly [number, number, number] | VolumeGrid,
  fatorSpv = 1.0,
): EstatisticaSegmentoUnificada[] {
  if (valoresEscalares && valoresEscalares.length !== rotulos.length) {
    throw new Error('A máscara e o volume têm tamanhos diferentes.');
  }
  const volumeVoxelMl = Array.isArray(espacamento)
    ? (espacamento[0]! * espacamento[1]! * espacamento[2]!) / 1000.0
    : voxelVolumeMl(espacamento as VolumeGrid);
  const acc = criarAcumuladores(segmentos);
  if (segmentos.length > 0 && rotulos.length > 0) {
    acumularFatia(acc, rotulos, valoresEscalares, 0, fatorSpv);
  }
  return resumirAcumuladores(acc, volumeVoxelMl, valoresEscalares !== undefined);
}

function volumetriaInternaPorFatias(
  fatiasRotulos: ReadonlyArray<ArrayLike<number>>,
  volume: ScalarVolume,
  segmentos: Array<{ indice: number; nome: string }>,
  ehPet: boolean,
): LinhaVolumetria[] {
  let totalRotulos = 0;
  for (let k = 0; k < fatiasRotulos.length; k++) totalRotulos += fatiasRotulos[k]!.length;
  if (totalRotulos !== volume.data.length) throw new Error('A máscara e o volume têm tamanhos diferentes.');

  const acc = criarAcumuladores(segmentos);
  if (segmentos.length > 0 && totalRotulos > 0) {
    let offset = 0;
    for (let k = 0; k < fatiasRotulos.length; k++) {
      const fatia = fatiasRotulos[k]!;
      acumularFatia(acc, fatia, volume.data, offset, 1.0);
      offset += fatia.length;
    }
  }

  const unificadas = resumirAcumuladores(acc, voxelVolumeMl(volume.grid), true);
  let algumPresente = false;
  const linhas: LinhaVolumetria[] = unificadas.map((u) => {
    if (u.voxelCount === 0) return { indice: u.indice, nome: u.nome, voxels: 0, volumeMl: 0 };
    algumPresente = true;
    const linha: LinhaVolumetria = {
      indice: u.indice,
      nome: u.nome,
      voxels: u.voxelCount,
      volumeMl: u.volumeMl,
      media: u.media,
      dp: u.dp,
      min: u.min,
      max: u.max,
    };
    if (ehPet) linha.tlg = u.media * u.volumeMl;
    return linha;
  });

  if (ehPet && algumPresente) {
    const mascara: Mask = new Uint8Array(volume.data.length);
    for (const linha of linhas) {
      if (linha.voxels === 0) continue;
      let offset = 0;
      const idxAlvo = linha.indice;
      for (let k = 0; k < fatiasRotulos.length; k++) {
        const fatia = fatiasRotulos[k]!;
        for (let i = 0; i < fatia.length; i++) mascara[offset + i] = fatia[i] === idxAlvo ? 1 : 0;
        offset += fatia.length;
      }
      const peak = peakInMask(volume, mascara);
      if (peak) linha.pico = peak.value;
    }
  }

  return linhas;
}

/**
 * Uma linha por segmento, na ordem recebida, calculada sobre fatias avulsas do labelmap
 * (sem precisar copiar o volume inteiro de rótulos para um único buffer contíguo).
 */
export function volumetriaDosSegmentosPorFatias(
  fatiasRotulos: ReadonlyArray<ArrayLike<number>>,
  volume: ScalarVolume,
  segmentos: Array<{ indice: number; nome: string }>,
  ehPet: boolean,
): LinhaVolumetria[] {
  return volumetriaInternaPorFatias(fatiasRotulos, volume, segmentos, ehPet);
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
  return volumetriaInternaPorFatias([rotulos], volume, segmentos, ehPet);
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
