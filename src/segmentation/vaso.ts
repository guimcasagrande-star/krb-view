/**
 * Crescimento de região contíguo para vasos (fase 10.2):
 * parte de um clique no vaso contrastado e usa `regionGrow` de `src/volume/voxelStats.ts`
 * na faixa `[huReferencia + deltaMin, huReferencia + deltaMax]` (padrão -80 a +300 HU).
 */

import { voxelVolumeMl } from '../io/geometry';
import type { Vec3 } from '../io/types';
import { regionGrowIndices, type ScalarVolume } from '../volume/voxelStats';

export const PADRAO_DELTA_MIN_VASO = -80;
export const PADRAO_DELTA_MAX_VASO = 300;

export type ModoVaso = 'arterial' | 'venoso';
export type ModoVasoInteligente = 'auto' | ModoVaso;

export interface PresetVaso {
  modo: ModoVaso;
  rotulo: string;
  deltaMin: number;
  deltaMax: number;
  cor: [number, number, number];
}

export const PRESETS_VASO: Record<ModoVaso, PresetVaso> = {
  arterial: {
    modo: 'arterial',
    rotulo: 'Arterial',
    deltaMin: -80,
    deltaMax: 300,
    cor: [220, 48, 48],
  },
  venoso: {
    modo: 'venoso',
    rotulo: 'Venoso / Porta',
    deltaMin: -35,
    deltaMax: 150,
    cor: [50, 115, 220],
  },
};

/**
 * Calcula limites otimizados para segmentação vascular 3D em TC/RM sem vazar para o parênquima
 * hepático/muscular (~40–95 HU) nem para cortical óssea densa (> 640 HU).
 * `alcancePct` (50..160, padrão 100) abre ou fecha a tolerância para ramos finos em tempo real.
 */
export function calcularFaixaInteligenteVaso(
  huReferencia: number,
  modo: ModoVasoInteligente = 'auto',
  alcancePct = 100,
  ehTc = true,
): {
  modoEfetivo: ModoVaso;
  deltaMin: number;
  deltaMax: number;
  pisoMin?: number;
  tetoMax?: number;
} {
  const fator = Math.min(1.8, Math.max(0.4, alcancePct / 100));
  if (!ehTc) {
    const base = Math.max(15, Math.abs(huReferencia) * 0.24 * fator);
    return {
      modoEfetivo: modo === 'venoso' ? 'venoso' : 'arterial',
      deltaMin: -Math.round(base),
      deltaMax: Math.round(base * 2.2),
    };
  }

  const modoEfetivo: ModoVaso =
    modo === 'auto' ? (huReferencia >= 200 ? 'arterial' : 'venoso') : modo;

  if (modoEfetivo === 'arterial') {
    const margemInf = Math.round(Math.min(110, Math.max(35, (huReferencia - 120) * 0.48)) * fator);
    const pisoMin = huReferencia >= 170 ? Math.max(115, Math.round(145 - (fator - 1) * 35)) : 95;
    const tetoMax = Math.max(Math.round(huReferencia + 190 * fator), 620);
    return {
      modoEfetivo: 'arterial',
      deltaMin: -margemInf,
      deltaMax: Math.round(280 * fator),
      pisoMin,
      tetoMax,
    };
  }

  // Fase portal / venosa (tipicamente 110–195 HU): evita cair na faixa do parênquima hepático (60–95 HU)
  const margemInfVenosa = Math.round(Math.min(55, Math.max(18, (huReferencia - 85) * 0.46)) * fator);
  const pisoMinVenoso = huReferencia >= 115 ? Math.max(88, Math.round(102 - (fator - 1) * 20)) : undefined;
  const tetoMaxVenoso = Math.max(Math.round(huReferencia + 150 * fator), 460);
  return {
    modoEfetivo: 'venoso',
    deltaMin: -margemInfVenosa,
    deltaMax: Math.round(150 * fator),
    ...(pisoMinVenoso !== undefined ? { pisoMin: pisoMinVenoso } : {}),
    tetoMax: tetoMaxVenoso,
  };
}

/** Tons arteriais/vasculares para novos segmentos de vaso. */
export const CORES_VASO: Array<[number, number, number]> = [
  [220, 48, 48],
  [239, 68, 68],
  [244, 63, 94],
  [225, 29, 72],
  [249, 115, 22],
];

export const CORES_VENA: Array<[number, number, number]> = [
  [50, 115, 220],
  [56, 189, 248],
  [99, 102, 241],
  [14, 165, 233],
];

export interface OpcoesCrescimentoVaso {
  /** Limite inferior relativo ao valor de referência (padrão -80). */
  deltaMin?: number;
  /** Limite superior relativo ao valor de referência (padrão +300). */
  deltaMax?: number;
  /** Piso absoluto opcional (ex.: ~115 HU na fase arterial para não invadir parênquima). */
  pisoMin?: number;
  /** Teto absoluto opcional (ex.: ~620 HU para não vazar da aorta para cortical vertebral). */
  tetoMax?: number;
  /** Conectividade 6 (faces) ou 26 (arestas e cantos). Padrão 6. */
  connectivity?: 6 | 26;
  /** Usa a média 3×3 no corte ao redor do clique para reduzir ruído de pixel isolado (padrão true). */
  suavizarSemente?: boolean;
}

export interface ResultadoVaso {
  indices: Int32Array;
  huClicado: number;
  huReferencia: number;
  min: number;
  max: number;
  semente: Vec3;
  volumeMl: number;
}

export interface SegmentoVaso {
  indice: number;
  nome: string;
  cor: [number, number, number];
  bloqueado?: boolean;
}

/** Média da vizinhança 3×3 no corte (`k` fixo) ao redor da semente, respeitando as bordas. */
export function media3x3NoCorte(volume: ScalarVolume, semente: Vec3): number {
  const { data, grid } = volume;
  const [nx, ny, nz] = grid.dims;
  const [si, sj, sk] = semente;
  if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) return 0;
  let soma = 0;
  let n = 0;
  const baseK = sk * nx * ny;
  for (let j = Math.max(0, sj - 1); j <= Math.min(ny - 1, sj + 1); j++) {
    const baseJ = baseK + j * nx;
    for (let i = Math.max(0, si - 1); i <= Math.min(nx - 1, si + 1); i++) {
      soma += data[baseJ + i]!;
      n++;
    }
  }
  return n > 0 ? soma / n : data[baseK + sj * nx + si]!;
}

/**
 * Calcula o valor de referência para o crescimento do vaso.
 * Usa a média 3×3 para suavizar ruído de pixel isolado, voltando ao voxel clicado caso a média
 * com pixels externos exclua a própria semente (ex.: vaso fino de 1 pixel cercado por ar).
 */
export function intensidadeReferenciaVaso(
  volume: ScalarVolume,
  semente: Vec3,
  deltaMin = PADRAO_DELTA_MIN_VASO,
  deltaMax = PADRAO_DELTA_MAX_VASO,
  suavizar = true,
): number {
  const { data, grid } = volume;
  const [nx, ny] = grid.dims;
  const [si, sj, sk] = semente;
  const centro = data[si + sj * nx + sk * nx * ny]!;
  if (!suavizar) return centro;
  const media = media3x3NoCorte(volume, semente);
  const dMin = Math.min(deltaMin, deltaMax);
  const dMax = Math.max(deltaMin, deltaMax);
  if (centro >= media + dMin && centro <= media + dMax) return media;
  return centro;
}

/**
 * Cresce de forma contígua em 3D por todo o vaso conectado ao ponto clicado dentro de
 * `[huReferencia + deltaMin, huReferencia + deltaMax]`.
 */
export function crescerVaso(
  volume: ScalarVolume,
  semente: Vec3,
  opcoes: OpcoesCrescimentoVaso = {},
): ResultadoVaso {
  const [nx, ny, nz] = volume.grid.dims;
  const sementeInt: Vec3 = [Math.round(semente[0]), Math.round(semente[1]), Math.round(semente[2])];
  const [si, sj, sk] = sementeInt;
  const deltaMin = opcoes.deltaMin ?? PADRAO_DELTA_MIN_VASO;
  const deltaMax = opcoes.deltaMax ?? PADRAO_DELTA_MAX_VASO;
  const dMin = Math.min(deltaMin, deltaMax);
  const dMax = Math.max(deltaMin, deltaMax);

  if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) {
    return { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente: sementeInt, volumeMl: 0 };
  }

  const huClicado = volume.data[si + sj * nx + sk * nx * ny]!;
  let huReferencia: number;
  if (
    (opcoes.suavizarSemente ?? true) &&
    (opcoes.pisoMin !== undefined || opcoes.tetoMax !== undefined)
  ) {
    // Suaviza apenas entre vizinhos 3×3 que pertençam à faixa luminal válida (ignora parênquima e placa calcificada/osso adjacente)
    const pMin = opcoes.pisoMin ?? -Infinity;
    const pMax = opcoes.tetoMax ?? Infinity;
    let soma = 0;
    let cont = 0;
    const baseK = sk * nx * ny;
    for (let j = Math.max(0, sj - 1); j <= Math.min(ny - 1, sj + 1); j++) {
      const baseJ = baseK + j * nx;
      for (let i = Math.max(0, si - 1); i <= Math.min(nx - 1, si + 1); i++) {
        const val = volume.data[baseJ + i]!;
        if (val >= pMin && val <= pMax) {
          soma += val;
          cont++;
        }
      }
    }
    huReferencia = cont > 0 ? soma / cont : huClicado;
  } else {
    huReferencia = intensidadeReferenciaVaso(
      volume,
      sementeInt,
      dMin,
      dMax,
      opcoes.suavizarSemente ?? true,
    );
  }
  let min = huReferencia + dMin;
  let max = huReferencia + dMax;
  if (opcoes.pisoMin !== undefined && Number.isFinite(opcoes.pisoMin) && opcoes.pisoMin <= huReferencia) {
    min = Math.max(min, opcoes.pisoMin);
  }
  if (opcoes.tetoMax !== undefined && Number.isFinite(opcoes.tetoMax) && opcoes.tetoMax >= huReferencia) {
    max = Math.min(max, opcoes.tetoMax);
  }

  const indices = regionGrowIndices(volume, sementeInt, {
    min,
    max,
    connectivity: opcoes.connectivity ?? 6,
  });
  const volumeMl = indices.length > 0 ? indices.length * voxelVolumeMl(volume.grid) : 0;

  return { indices, huClicado, huReferencia, min, max, semente: sementeInt, volumeMl };
}

/** Próximo nome sugerido ("Vaso 1", "Vaso 2"…) e cor arterial ou venosa sem repetir nomes já usados. */
export function proximoNomeECorVaso(
  segmentos: ReadonlyArray<{ nome: string }>,
  modo: ModoVaso = 'arterial',
): {
  nome: string;
  cor: [number, number, number];
} {
  const usados = new Set(segmentos.map((s) => s.nome.trim().toLowerCase()));
  let n = 1;
  while (usados.has(`vaso ${n}`)) n++;
  const paleta = modo === 'venoso' ? CORES_VENA : CORES_VASO;
  return {
    nome: `Vaso ${n}`,
    cor: [...paleta[(n - 1) % paleta.length]!] as [number, number, number],
  };
}

/** Quando só existe o "Segmento 1" vazio recém-criado, ele pode virar o primeiro "Vaso 1". */
export function podeReaproveitarPlaceholder(
  segmentos: ReadonlyArray<{ nome: string }>,
  temVoxelsPintados: boolean,
): boolean {
  return !temVoxelsPintados && segmentos.length === 1 && segmentos[0]!.nome === 'Segmento 1';
}

export interface UltimaSementeVaso {
  seedIjk: Vec3;
  segmentoIndice: number;
  indicesPintados: Int32Array;
}

export interface EstadoVasoPuro {
  segmentos: SegmentoVaso[];
  ativo: number;
  rotulos: Uint8Array;
  ultimaSementeVaso?: UltimaSementeVaso;
}

export interface AplicacaoVaso {
  criado: boolean;
  segmento?: SegmentoVaso;
  resultado: ResultadoVaso;
  pintados: number;
  erro?: string;
}

/**
 * Executa o crescimento do vaso e aplica o resultado em memória sobre a lista de segmentos e o
 * buffer de rótulos (`Uint8Array`), criando um novo segmento ("Vaso N") ou pintando no ativo.
 */
export function aplicarVasoEmEstado(
  estado: EstadoVasoPuro,
  volume: ScalarVolume,
  semente: Vec3,
  opcoes: OpcoesCrescimentoVaso & { criarNovoSegmento?: boolean; modo?: ModoVaso } = {},
): AplicacaoVaso {
  const criarNovo = opcoes.criarNovoSegmento ?? true;
  if (!criarNovo) {
    const ativo = estado.segmentos.find((s) => s.indice === estado.ativo);
    if (!ativo) {
      return {
        criado: false,
        resultado: { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente, volumeMl: 0 },
        pintados: 0,
        erro: 'Nenhum segmento ativo.',
      };
    }
    if (ativo.bloqueado) {
      return {
        criado: false,
        resultado: { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente, volumeMl: 0 },
        pintados: 0,
        erro: 'O segmento ativo está bloqueado.',
      };
    }
  }

  const resultado = crescerVaso(volume, semente, opcoes);
  if (resultado.indices.length === 0) {
    return {
      criado: false,
      resultado,
      pintados: 0,
      erro: 'Nenhum voxel conectado encontrado na faixa do vaso.',
    };
  }

  let alvo: SegmentoVaso;
  let criado = false;
  if (criarNovo) {
    const jaTemVoxels = estado.rotulos.some((v) => v !== 0);
    const { nome, cor } = proximoNomeECorVaso(estado.segmentos, opcoes.modo ?? 'arterial');
    if (podeReaproveitarPlaceholder(estado.segmentos, jaTemVoxels)) {
      alvo = estado.segmentos[0]!;
      alvo.nome = nome;
      alvo.cor = cor;
      estado.ativo = alvo.indice;
      criado = true;
    } else {
      const indice = Math.max(0, ...estado.segmentos.map((s) => s.indice)) + 1;
      if (indice > 255) {
        return { criado: false, resultado, pintados: 0, erro: 'Limite de 255 segmentos atingido.' };
      }
      alvo = { indice, nome, cor, bloqueado: false };
      estado.segmentos.push(alvo);
      estado.ativo = indice;
      criado = true;
    }
  } else {
    alvo = estado.segmentos.find((s) => s.indice === estado.ativo)!;
  }

  const bloqueados = new Set(estado.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  const efetivos: number[] = [];
  for (let i = 0; i < resultado.indices.length; i++) {
    const idx = resultado.indices[i]!;
    const atual = estado.rotulos[idx]!;
    if (atual === alvo.indice || (atual !== 0 && bloqueados.has(atual))) continue;
    estado.rotulos[idx] = alvo.indice;
    efetivos.push(idx);
  }
  estado.ultimaSementeVaso = {
    seedIjk: resultado.semente,
    segmentoIndice: alvo.indice,
    indicesPintados: Int32Array.from(efetivos),
  };

  return { criado, segmento: alvo, resultado, pintados: efetivos.length };
}

/**
 * Recalcula em tempo real a última segmentação da ferramenta Vaso ao ajustar `deltaMin`/`deltaMax`
 * ou alternar preset (Arterial / Venoso), substituindo apenas os voxels da última semente.
 */
export function recalcularVasoEmEstado(
  estado: EstadoVasoPuro,
  volume: ScalarVolume,
  opcoes: OpcoesCrescimentoVaso & { cor?: [number, number, number] } = {},
): AplicacaoVaso {
  const ultima = estado.ultimaSementeVaso;
  if (!ultima) {
    return {
      criado: false,
      resultado: { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente: [0, 0, 0], volumeMl: 0 },
      pintados: 0,
      erro: 'Nenhuma semente recente da ferramenta Vaso.',
    };
  }
  const alvo = estado.segmentos.find((s) => s.indice === ultima.segmentoIndice);
  if (!alvo) {
    return {
      criado: false,
      resultado: { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente: ultima.seedIjk, volumeMl: 0 },
      pintados: 0,
      erro: 'Segmento da última semente não existe mais.',
    };
  }
  if (alvo.bloqueado) {
    return {
      criado: false,
      resultado: { indices: new Int32Array(0), huClicado: 0, huReferencia: 0, min: 0, max: 0, semente: ultima.seedIjk, volumeMl: 0 },
      pintados: 0,
      erro: 'O segmento está bloqueado.',
    };
  }

  for (let i = 0; i < ultima.indicesPintados.length; i++) {
    const idx = ultima.indicesPintados[i]!;
    if (estado.rotulos[idx] === alvo.indice) estado.rotulos[idx] = 0;
  }

  if (opcoes.cor) alvo.cor = [...opcoes.cor] as [number, number, number];

  const resultado = crescerVaso(volume, ultima.seedIjk, opcoes);
  const bloqueados = new Set(estado.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  const efetivos: number[] = [];
  for (let i = 0; i < resultado.indices.length; i++) {
    const idx = resultado.indices[i]!;
    const atual = estado.rotulos[idx]!;
    if (atual !== 0 && atual !== alvo.indice && bloqueados.has(atual)) continue;
    estado.rotulos[idx] = alvo.indice;
    efetivos.push(idx);
  }
  ultima.indicesPintados = Int32Array.from(efetivos);

  return { criado: false, segmento: alvo, resultado, pintados: efetivos.length };
}
