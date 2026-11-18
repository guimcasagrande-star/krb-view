/**
 * Cliente assíncrono do `compute.worker.ts` (Fase B):
 * - Mantém uma instância única do Worker fora da thread principal;
 * - Envia buffers grandes com transferência zero-copy quando possível;
 * - Inclui fallback transparente in-process quando `Worker` não está disponível (ex.: Vitest).
 */

import type { VolumeGrid } from '../io/geometry';
import {
  recortarPoligono3d,
  removerMesa3d,
  removerOsso3d,
  type BufferVolumeEditavel,
  type DiffMascara3d,
  type ProjeccaoCamera3d,
} from '../render3d/mascara3d';
import {
  CacheSuperficie3d,
  type MalhaSuperficie3d,
  type OpcoesSuperficie3d,
} from '../segmentation/superficie3d';
import {
  aplicarArquivosNiftiEmEstado,
  type EstadoTotalSegPuro,
  type ResumoImportacaoTotalSeg,
} from '../segmentation/totalSegmentator';
import { type LinhaVolumetria, volumetriaDosSegmentos } from '../segmentation/volumetria';
import type { ScalarVolume } from '../volume/voxelStats';
import type {
  ItemSuperficieWorker,
  RequisicaoWorker,
  RequisicaoWorkerPayload,
  RespostaWorker,
  RespostaWorkerDado,
  TipoArrayVolume,
} from './compute.worker';

interface Pendencia {
  resolve: (dado: RespostaWorkerDado) => void;
  reject: (erro: Error) => void;
}

let workerInstancia: Worker | null = null;
let proximoId = 1;
const pendencias = new Map<number, Pendencia>();
const volumesEnviados = new Set<string>();
const fallbackVolumes = new Map<string, { volume: ScalarVolume; ehPet: boolean }>();
const fallbackCacheSuperficie = new CacheSuperficie3d();

function detectarTipoArray(arr: ArrayLike<number>): TipoArrayVolume | undefined {
  if (arr instanceof Int16Array) return 'int16';
  if (arr instanceof Float32Array) return 'float32';
  if (arr instanceof Uint16Array) return 'uint16';
  if (arr instanceof Uint8Array) return 'uint8';
  return undefined;
}

function clonarComoTypedArray(
  arr: ArrayLike<number>,
): { view: Int16Array | Float32Array | Uint16Array | Uint8Array; tipoArray: TipoArrayVolume } {
  if (arr instanceof Int16Array) return { view: arr.slice(), tipoArray: 'int16' };
  if (arr instanceof Float32Array) return { view: arr.slice(), tipoArray: 'float32' };
  if (arr instanceof Uint16Array) return { view: arr.slice(), tipoArray: 'uint16' };
  if (arr instanceof Uint8Array) return { view: arr.slice(), tipoArray: 'uint8' };
  return { view: Float32Array.from(arr), tipoArray: 'float32' };
}

function obterWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (workerInstancia) return workerInstancia;
  try {
    const w = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<RespostaWorker>) => {
      const msg = ev.data;
      const p = pendencias.get(msg.id);
      if (!p) return;
      pendencias.delete(msg.id);
      if (msg.sucesso) p.resolve(msg.dado);
      else p.reject(new Error(msg.erro));
    };
    w.onerror = (ev: ErrorEvent) => {
      const erro = new Error(ev.message || 'Falha no compute worker.');
      for (const p of pendencias.values()) p.reject(erro);
      pendencias.clear();
      volumesEnviados.clear();
      try {
        w.terminate();
      } catch {
        /* worker já encerrado */
      }
      workerInstancia = null;
    };
    workerInstancia = w;
    return w;
  } catch {
    return null;
  }
}

function enviarParaWorker<T extends RespostaWorkerDado>(
  payload: RequisicaoWorkerPayload,
  transfer: Transferable[] = [],
): Promise<T> {
  const w = obterWorker();
  if (!w) {
    return Promise.reject(new Error('Web Worker indisponível neste ambiente.'));
  }
  const id = proximoId++;
  return new Promise<T>((resolve, reject) => {
    pendencias.set(id, {
      resolve: (dado) => resolve(dado as T),
      reject,
    });
    try {
      w.postMessage({ ...payload, id } satisfies RequisicaoWorker, transfer);
    } catch (e) {
      pendencias.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function transferiveisUnicos(buffers: Array<ArrayBufferLike | undefined>): Transferable[] {
  const s = new Set<ArrayBuffer>();
  for (const b of buffers) {
    if (b instanceof ArrayBuffer && b.byteLength > 0) s.add(b);
  }
  return Array.from(s);
}

/** Garante que os escalares (CT/MR/PET) da série estejam em cache no Worker. */
export async function garantirVolumeNoWorker(
  pilhaId: string,
  volume: ScalarVolume,
  ehPet: boolean,
): Promise<void> {
  if (!obterWorker()) {
    fallbackVolumes.set(pilhaId, { volume, ehPet });
    return;
  }
  if (volumesEnviados.has(pilhaId)) return;
  const { view, tipoArray } = clonarComoTypedArray(volume.data);
  volumesEnviados.add(pilhaId);
  try {
    await enviarParaWorker(
      {
        tipo: 'definir_volume',
        pilhaId,
        buffer: view.buffer as ArrayBuffer,
        tipoArray,
        grid: volume.grid,
        ehPet,
      },
      transferiveisUnicos([view.buffer as ArrayBuffer]),
    );
  } catch (e) {
    volumesEnviados.delete(pilhaId);
    throw e;
  }
}

/** Libera da memória do Worker os volumes/assinaturas de uma série (ou de todas). */
export function descartarVolumeDoWorker(pilhaId?: string): void {
  if (pilhaId) {
    volumesEnviados.delete(pilhaId);
    fallbackVolumes.delete(pilhaId);
    fallbackCacheSuperficie.removerPilha(pilhaId);
  } else {
    volumesEnviados.clear();
    fallbackVolumes.clear();
    fallbackCacheSuperficie.limpar();
  }
  const w = obterWorker();
  if (!w) return;
  void enviarParaWorker({ tipo: 'descartar_volume', pilhaId }).catch(() => undefined);
}

/** Calcula volumetria de todos os segmentos no Worker (`rotulos` deve ser buffer próprio transferível). */
export async function calcularVolumetriaNoWorker(
  pilhaId: string,
  rotulos: Uint8Array,
  volume: ScalarVolume,
  segmentos: Array<{ indice: number; nome: string }>,
  ehPet: boolean,
): Promise<LinhaVolumetria[]> {
  if (!obterWorker()) {
    return volumetriaDosSegmentos(rotulos, volume, segmentos, ehPet);
  }
  try {
    await garantirVolumeNoWorker(pilhaId, volume, ehPet);
  } catch {
    return volumetriaDosSegmentos(rotulos, volume, segmentos, ehPet);
  }
  const res = await enviarParaWorker<{ linhas: LinhaVolumetria[] }>(
    {
      tipo: 'volumetria',
      pilhaId,
      rotulos,
      segmentos,
    },
    transferiveisUnicos([rotulos.buffer as ArrayBuffer]),
  );
  return res.linhas;
}

/**
 * Extrai em lote as malhas 3D no Worker (`rotulos` deve ser buffer próprio transferível),
 * retornando apenas os segmentos alterados e sinalizando quais permanecem válidos localmente.
 */
export async function calcularSuperficiesNoWorker(
  pilhaId: string,
  rotulos: Uint8Array,
  grid: VolumeGrid,
  indices: number[],
  assinaturasLocais: Array<[number, string]>,
  opcoes: OpcoesSuperficie3d = {},
): Promise<ItemSuperficieWorker[]> {
  if (!obterWorker()) {
    const mapa = fallbackCacheSuperficie.obterLote(pilhaId, rotulos, grid, indices, opcoes);
    return indices.map((indice) => {
      const r = mapa.get(indice);
      return {
        indice,
        assinatura: `${indice}-${r?.malha.vertexCount ?? 0}-${r?.malha.triangleCount ?? 0}`,
        reutilizarLocal: r?.doCache === true && assinaturasLocais.some(([i]) => i === indice),
        malha: r?.malha,
      };
    });
  }
  const res = await enviarParaWorker<{ itens: ItemSuperficieWorker[] }>(
    {
      tipo: 'superficies_lote',
      pilhaId,
      rotulos,
      grid,
      indices,
      opcoes,
      assinaturasLocais,
    },
    transferiveisUnicos([rotulos.buffer as ArrayBuffer]),
  );
  return res.itens;
}

export function limparSuperficiesNoWorker(pilhaId?: string, segmentIndex?: number): void {
  if (!pilhaId) fallbackCacheSuperficie.limpar();
  else if (segmentIndex !== undefined) fallbackCacheSuperficie.removerSegmento(pilhaId, segmentIndex);
  else fallbackCacheSuperficie.removerPilha(pilhaId);

  const w = obterWorker();
  if (!w) return;
  void enviarParaWorker({ tipo: 'limpar_superficies', pilhaId, segmentIndex }).catch(() => undefined);
}

/** Executa os filtros 3D "Sem mesa" / "Sem osso" no Worker preservando `Int16Array`/`Float32Array`. */
export async function filtrarMascara3dNoWorker(
  baseVoxels: Int16Array | Float32Array,
  dims: readonly [number, number, number],
  semMesa: boolean,
  semOsso: boolean,
): Promise<{
  trabalho: Int16Array | Float32Array;
  removidosMesa: number;
  removidosOsso: number;
}> {
  const tipoArray: 'int16' | 'float32' = baseVoxels instanceof Int16Array ? 'int16' : 'float32';
  const copia = tipoArray === 'int16' ? new Int16Array(baseVoxels) : new Float32Array(baseVoxels);

  if (!obterWorker()) {
    let removidosMesa = 0;
    let removidosOsso = 0;
    if (semMesa) removidosMesa = removerMesa3d(copia as unknown as BufferVolumeEditavel, dims).indices.length;
    if (semOsso) removidosOsso = removerOsso3d(copia as unknown as BufferVolumeEditavel, dims).indices.length;
    return { trabalho: copia, removidosMesa, removidosOsso };
  }

  const res = await enviarParaWorker<{
    buffer: ArrayBuffer;
    tipoArray: 'int16' | 'float32';
    removidosMesa: number;
    removidosOsso: number;
  }>(
    {
      tipo: 'filtrar_mascara3d',
      buffer: copia.buffer as ArrayBuffer,
      tipoArray,
      dims: [dims[0], dims[1], dims[2]],
      semMesa,
      semOsso,
    },
    transferiveisUnicos([copia.buffer as ArrayBuffer]),
  );

  const trabalho = res.tipoArray === 'int16' ? new Int16Array(res.buffer) : new Float32Array(res.buffer);
  return {
    trabalho,
    removidosMesa: res.removidosMesa,
    removidosOsso: res.removidosOsso,
  };
}

/**
 * Executa o recorte poligonal (Tesoura 3D) no Worker sobre uma cópia/buffer de trabalho,
 * devolvendo o buffer atualizado e o `DiffMascara3d` para desfazer.
 */
export async function recortarTesoura3dNoWorker(
  voxelsAtuais: Int16Array | Float32Array,
  grid: VolumeGrid,
  projeccao: ProjeccaoCamera3d,
  poligono: Array<[number, number]>,
  modo: 'dentro' | 'fora',
  valorVazio: number,
): Promise<{
  trabalho: Int16Array | Float32Array;
  diff: DiffMascara3d;
}> {
  const tipoArray: 'int16' | 'float32' = voxelsAtuais instanceof Int16Array ? 'int16' : 'float32';
  const copia = tipoArray === 'int16' ? new Int16Array(voxelsAtuais) : new Float32Array(voxelsAtuais);

  if (!obterWorker()) {
    const diff = recortarPoligono3d(
      copia as unknown as BufferVolumeEditavel,
      grid,
      projeccao,
      poligono,
      modo,
      valorVazio,
    );
    return { trabalho: copia, diff };
  }

  const res = await enviarParaWorker<{
    buffer: ArrayBuffer;
    tipoArray: 'int16' | 'float32';
    diff: DiffMascara3d;
  }>(
    {
      tipo: 'recortar_tesoura3d',
      buffer: copia.buffer as ArrayBuffer,
      tipoArray,
      grid,
      projeccao,
      poligono,
      modo,
      valorVazio,
    },
    transferiveisUnicos([copia.buffer as ArrayBuffer]),
  );

  const trabalho = res.tipoArray === 'int16' ? new Int16Array(res.buffer) : new Float32Array(res.buffer);
  return { trabalho, diff: res.diff };
}

/**
 * Descompacta NIfTIs, realinha à grade DICOM e aplica o estado do TotalSegmentator no Worker,
 * transferindo `estado.rotulos` e os arquivos para evitar cópias e travamento da UI.
 */
export async function processarTotalSegmentatorNoWorker(
  estado: EstadoTotalSegPuro,
  grid: VolumeGrid,
  arquivos: Array<{ nome: string; bytes: Uint8Array }>,
): Promise<{ estado: EstadoTotalSegPuro; resumo: ResumoImportacaoTotalSeg }> {
  if (!obterWorker()) {
    const resumo = await aplicarArquivosNiftiEmEstado(estado, grid, arquivos);
    return { estado, resumo };
  }

  const rotulosProprios =
    detectarTipoArray(estado.rotulos) === 'uint8' ? estado.rotulos : Uint8Array.from(estado.rotulos);
  const transferList: Array<ArrayBuffer | undefined> = [rotulosProprios.buffer as ArrayBuffer];
  const arquivosProprios = arquivos.map((a) => {
    // Garante slice próprio se o Uint8Array vier de view maior.
    const bytes = a.bytes.byteOffset === 0 && a.bytes.byteLength === a.bytes.buffer.byteLength ? a.bytes : a.bytes.slice();
    transferList.push(bytes.buffer as ArrayBuffer);
    return { nome: a.nome, bytes };
  });

  const estadoMsg: EstadoTotalSegPuro = { ...estado, rotulos: rotulosProprios };
  return enviarParaWorker<{ estado: EstadoTotalSegPuro; resumo: ResumoImportacaoTotalSeg }>(
    {
      tipo: 'processar_totalsegmentator',
      estado: estadoMsg,
      grid,
      arquivos: arquivosProprios,
    },
    transferiveisUnicos(transferList),
  );
}
export type { MalhaSuperficie3d };
