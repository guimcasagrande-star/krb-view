/**
 * Arquivo de segmentação próprio (fase 9.3), extensão `.vseg`. Funções puras (sem Cornerstone):
 *
 *   "VISUSEG1" (8 bytes ASCII) | tamanho do cabeçalho (uint32, little-endian) |
 *   cabeçalho JSON (UTF-8) | rótulos (1 byte por voxel, comprimidos em gzip)
 *
 * O cabeçalho guarda só identificadores técnicos da série (UID da série e do referencial),
 * a geometria da grade e os segmentos. Nada de nome ou ID do paciente.
 */

export const EXTENSAO_SEGMENTACAO = '.vseg';
const ASSINATURA = 'VISUSEG1';
const FORMATO = 'visualizador-segmentacao';
const VERSAO = 1;

export interface SegmentoSalvo {
  indice: number;
  nome: string;
  cor: [number, number, number];
  visivel: boolean;
  bloqueado: boolean;
  visivel3d?: boolean;
  opacidade3d?: number;
}

/** Grade da máscara (a mesma do volume da série). */
export interface GeometriaSalva {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  /** 9 números: linha, coluna e normal (como `volume.direction` do Cornerstone). */
  direction: number[];
}

export interface CabecalhoSegmentacao {
  formato: typeof FORMATO;
  versao: number;
  serieUid: string;
  referencialUid?: string;
  /** Descrição da série, só para mostrar nas mensagens (ex.: "CT · TÓRAX"). */
  serie?: string;
  geometria: GeometriaSalva;
  segmentos: SegmentoSalvo[];
  ativo: number;
  salvoEm: string;
}

async function transformar(bytes: Uint8Array, fluxo: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const resposta = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(fluxo));
  return new Uint8Array(await resposta.arrayBuffer());
}

/** Monta o arquivo. `rotulos` tem um byte por voxel (0 = fora), na ordem da grade. */
export async function codificarSegmentacao(
  cabecalho: Omit<CabecalhoSegmentacao, 'formato' | 'versao'>,
  rotulos: Uint8Array,
): Promise<Uint8Array> {
  const [nx, ny, nz] = cabecalho.geometria.dims;
  if (rotulos.length !== nx * ny * nz) throw new Error('A máscara não tem o tamanho da grade.');
  const json = new TextEncoder().encode(JSON.stringify({ formato: FORMATO, versao: VERSAO, ...cabecalho }));
  const comprimido = await transformar(rotulos, new CompressionStream('gzip'));
  const saida = new Uint8Array(8 + 4 + json.length + comprimido.length);
  saida.set(new TextEncoder().encode(ASSINATURA), 0);
  new DataView(saida.buffer).setUint32(8, json.length, true);
  saida.set(json, 12);
  saida.set(comprimido, 12 + json.length);
  return saida;
}

/** Lê o arquivo; lança erro em português se não for um `.vseg` válido. */
export async function lerSegmentacao(
  bytes: Uint8Array,
): Promise<{ cabecalho: CabecalhoSegmentacao; rotulos: Uint8Array }> {
  const invalido = (): Error => new Error('O arquivo não é uma segmentação deste visualizador (.vseg).');
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 8)) !== ASSINATURA) throw invalido();
  const tamanho = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (12 + tamanho > bytes.length) throw invalido();
  let cabecalho: CabecalhoSegmentacao;
  try {
    cabecalho = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + tamanho))) as CabecalhoSegmentacao;
  } catch {
    throw invalido();
  }
  if (cabecalho.formato !== FORMATO) throw invalido();
  if (cabecalho.versao > VERSAO) {
    throw new Error('A segmentação foi salva por uma versão mais nova do visualizador.');
  }
  let rotulos: Uint8Array;
  try {
    rotulos = await transformar(bytes.subarray(12 + tamanho), new DecompressionStream('gzip'));
  } catch {
    throw new Error('O arquivo de segmentação está corrompido.');
  }
  const [nx, ny, nz] = cabecalho.geometria.dims;
  if (rotulos.length !== nx * ny * nz) throw new Error('O arquivo de segmentação está corrompido (tamanho da máscara).');
  return { cabecalho, rotulos };
}

/** Tolerância da comparação de geometria (mm para posição e espaçamento; adimensional para direção). */
const TOLERANCIA = 1e-3;

/**
 * Confere se a máscara salva cabe na série aberta (mesma série e mesma grade).
 * Devolve `null` se estiver tudo certo, ou o motivo em português.
 */
export function conferirSegmentacao(
  cab: CabecalhoSegmentacao,
  alvo: { serieUid?: string; geometria: GeometriaSalva },
): string | null {
  if (!alvo.serieUid || alvo.serieUid !== cab.serieUid) {
    return 'A segmentação é de outra série.';
  }
  const g = cab.geometria;
  const a = alvo.geometria;
  if (g.dims.some((d, i) => d !== a.dims[i])) {
    return `A grade é diferente (salva ${g.dims.join('×')}, série aberta ${a.dims.join('×')}).`;
  }
  const perto = (x: number[], y: number[], tol: number): boolean =>
    x.length === y.length && x.every((v, i) => Math.abs(v - y[i]!) <= tol);
  if (!perto(g.spacing, a.spacing, TOLERANCIA)) return 'O tamanho do voxel é diferente.';
  if (!perto(g.origin, a.origin, TOLERANCIA * 10)) return 'A posição do volume é diferente.';
  if (!perto(g.direction, a.direction, TOLERANCIA)) return 'A orientação do volume é diferente.';
  return null;
}

/** Nome sugerido do arquivo, a partir da descrição da série (sem dados do paciente). */
export function nomeSugerido(serie: string): string {
  const base = serie
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `segmentacao-${base || 'serie'}${EXTENSAO_SEGMENTACAO}`;
}
