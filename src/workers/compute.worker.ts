/**
 * Web Worker de computação pesada (Fase B):
 * Executa fora da thread principal (sem bloquear interface, rolagem ou giro 3D):
 * - Volumetria em passada única (inclusive SUVpico no PET) com volume cacheado por série;
 * - Extração de malhas 3D Surface Nets + suavização Taubin + normais por lote;
 * - Filtros volumétricos 3D ("Sem mesa" e "Sem osso") preservando `Int16Array`/`Float32Array`;
 * - Descompressão, parse NIfTI-1 e realinhamento de lotes do TotalSegmentator.
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
  gerarSuperficieSegmento,
  inspecionarSegmentosLote,
  type MalhaSuperficie3d,
  type OpcoesSuperficie3d,
} from '../segmentation/superficie3d';
import {
  aplicarArquivosNiftiEmEstado,
  type EstadoTotalSegPuro,
  type ResumoImportacaoTotalSeg,
} from '../segmentation/totalSegmentator';
import {
  type EstatisticaSegmentoUnificada,
  type LinhaVolumetria,
  volumetriaDosSegmentos,
  volumetriaPassadaUnica,
} from '../segmentation/volumetria';
import type { ScalarVolume } from '../volume/voxelStats';

export type TipoArrayVolume = 'int16' | 'float32' | 'uint16' | 'uint8';

export type RequisicaoWorkerPayload =
  | {
      tipo: 'definir_volume';
      pilhaId: string;
      buffer: ArrayBuffer;
      tipoArray: TipoArrayVolume;
      grid: VolumeGrid;
      ehPet: boolean;
    }
  | {
      tipo: 'descartar_volume';
      pilhaId?: string;
    }
  | {
      tipo: 'volumetria';
      pilhaId: string;
      rotulos: Uint8Array;
      segmentos: Array<{ indice: number; nome: string }>;
      volumeFallback?: {
        buffer: ArrayBuffer;
        tipoArray: TipoArrayVolume;
        grid: VolumeGrid;
        ehPet: boolean;
      };
    }
  | {
      tipo: 'volumetria_unica';
      rotulos: Uint8Array;
      valoresEscalares?: Float32Array | Int16Array;
      segmentos: Array<{ indice: number; nome: string }>;
      espacamento: readonly [number, number, number] | VolumeGrid;
      fatorSpv?: number;
    }
  | {
      tipo: 'superficies_lote';
      pilhaId: string;
      rotulos: Uint8Array;
      grid: VolumeGrid;
      indices: number[];
      opcoes?: OpcoesSuperficie3d;
      assinaturasLocais?: Array<[number, string]>;
    }
  | {
      tipo: 'limpar_superficies';
      pilhaId?: string;
      segmentIndex?: number;
    }
  | {
      tipo: 'filtrar_mascara3d';
      buffer: ArrayBuffer;
      tipoArray: 'int16' | 'float32';
      dims: readonly [number, number, number];
      semMesa: boolean;
      semOsso: boolean;
    }
  | {
      tipo: 'recortar_tesoura3d';
      buffer: ArrayBuffer;
      tipoArray: 'int16' | 'float32';
      grid: VolumeGrid;
      projeccao: ProjeccaoCamera3d;
      poligono: Array<[number, number]>;
      modo: 'dentro' | 'fora';
      valorVazio: number;
    }
  | {
      tipo: 'processar_totalsegmentator';
      estado: EstadoTotalSegPuro;
      grid: VolumeGrid;
      arquivos: Array<{ nome: string; bytes: Uint8Array }>;
    };

export type RequisicaoWorker = RequisicaoWorkerPayload & { id: number };

export interface ItemSuperficieWorker {
  indice: number;
  assinatura: string;
  reutilizarLocal?: boolean;
  malha?: MalhaSuperficie3d;
}

export type RespostaWorkerDado =
  | { ok: true }
  | { linhas: LinhaVolumetria[] }
  | { estatisticas: EstatisticaSegmentoUnificada[] }
  | { itens: ItemSuperficieWorker[] }
  | {
      buffer: ArrayBuffer;
      tipoArray: 'int16' | 'float32';
      removidosMesa: number;
      removidosOsso: number;
    }
  | {
      buffer: ArrayBuffer;
      tipoArray: 'int16' | 'float32';
      diff: DiffMascara3d;
    }
  | {
      estado: EstadoTotalSegPuro;
      resumo: ResumoImportacaoTotalSeg;
    };

export type RespostaWorker =
  | { id: number; sucesso: true; dado: RespostaWorkerDado }
  | { id: number; sucesso: false; erro: string };

/** Reconstrói a view tipada correta sobre um `ArrayBuffer` transferido. */
export function viewPorTipoArray(
  buffer: ArrayBuffer,
  tipoArray: TipoArrayVolume,
): Int16Array | Float32Array | Uint16Array | Uint8Array {
  switch (tipoArray) {
    case 'int16':
      return new Int16Array(buffer);
    case 'float32':
      return new Float32Array(buffer);
    case 'uint16':
      return new Uint16Array(buffer);
    case 'uint8':
      return new Uint8Array(buffer);
  }
}

/** Coleta apenas `ArrayBuffer`s únicos e não vazios para transferência zero-copy (evita `MALHA_VAZIA`). */
export function coletarBuffersTransferiveis(buffers: Array<ArrayBufferLike | undefined>): Transferable[] {
  const unicos = new Set<ArrayBuffer>();
  for (const buf of buffers) {
    if (buf instanceof ArrayBuffer && buf.byteLength > 0) unicos.add(buf);
  }
  return Array.from(unicos);
}

const volumesCache = new Map<string, { volume: ScalarVolume; ehPet: boolean }>();
const assinaturasSuperficie = new Map<string, Map<number, string>>();

const workerScope =
  typeof self !== 'undefined'
    ? (self as unknown as {
        onmessage: ((ev: MessageEvent<RequisicaoWorker>) => void) | null;
        postMessage(msg: RespostaWorker, transfer?: Transferable[]): void;
      })
    : undefined;

async function processarMensagem(req: RequisicaoWorker): Promise<{ dado: RespostaWorkerDado; transfer: Transferable[] }> {
  switch (req.tipo) {
    case 'definir_volume': {
      const data = viewPorTipoArray(req.buffer, req.tipoArray);
      volumesCache.set(req.pilhaId, {
        volume: { data, grid: req.grid },
        ehPet: req.ehPet,
      });
      return { dado: { ok: true }, transfer: [] };
    }

    case 'descartar_volume': {
      if (req.pilhaId) {
        volumesCache.delete(req.pilhaId);
        assinaturasSuperficie.delete(req.pilhaId);
      } else {
        volumesCache.clear();
        assinaturasSuperficie.clear();
      }
      return { dado: { ok: true }, transfer: [] };
    }

    case 'volumetria': {
      if (req.volumeFallback) {
        volumesCache.set(req.pilhaId, {
          volume: {
            data: viewPorTipoArray(req.volumeFallback.buffer, req.volumeFallback.tipoArray),
            grid: req.volumeFallback.grid,
          },
          ehPet: req.volumeFallback.ehPet,
        });
      }
      const entrada = volumesCache.get(req.pilhaId);
      if (!entrada) {
        throw new Error('Volume da série não está carregado no worker para volumetria.');
      }
      const linhas = volumetriaDosSegmentos(req.rotulos, entrada.volume, req.segmentos, entrada.ehPet);
      return { dado: { linhas }, transfer: [] };
    }

    case 'volumetria_unica': {
      const estatisticas = volumetriaPassadaUnica(
        req.rotulos,
        req.valoresEscalares,
        req.segmentos,
        req.espacamento,
        req.fatorSpv,
      );
      return { dado: { estatisticas }, transfer: [] };
    }

    case 'superficies_lote': {
      const opcoes = req.opcoes ?? {};
      let mapa = assinaturasSuperficie.get(req.pilhaId);
      if (!mapa) {
        mapa = new Map<number, string>();
        assinaturasSuperficie.set(req.pilhaId, mapa);
      }
      const conhecidas = req.assinaturasLocais ? new Map(req.assinaturasLocais) : mapa;
      const resumos = inspecionarSegmentosLote(req.rotulos, req.grid, req.indices, opcoes);
      const itens: ItemSuperficieWorker[] = [];
      const buffers: Array<ArrayBufferLike | undefined> = [];

      for (const segIdx of req.indices) {
        const resumo = resumos.get(segIdx);
        if (!resumo) {
          itens.push({
            indice: segIdx,
            assinatura: '',
            malha: {
              positions: new Float32Array(0),
              triangles: new Uint32Array(0),
              normals: new Float32Array(0),
              vertexCount: 0,
              triangleCount: 0,
              bounds: null,
            },
          });
          continue;
        }
        const sigAnterior = conhecidas.get(segIdx);
        if (sigAnterior !== undefined && sigAnterior === resumo.assinatura) {
          mapa.set(segIdx, resumo.assinatura);
          itens.push({ indice: segIdx, assinatura: resumo.assinatura, reutilizarLocal: true });
          continue;
        }
        const malha: MalhaSuperficie3d =
          resumo.count === 0
            ? {
                positions: new Float32Array(0),
                triangles: new Uint32Array(0),
                normals: new Float32Array(0),
                vertexCount: 0,
                triangleCount: 0,
                bounds: null,
              }
            : gerarSuperficieSegmento(req.rotulos, req.grid, segIdx, { ...opcoes, boundsIjk: resumo.boundsIjk });

        mapa.set(segIdx, resumo.assinatura);
        itens.push({ indice: segIdx, assinatura: resumo.assinatura, malha });
        if (malha.triangleCount > 0) {
          buffers.push(malha.positions.buffer, malha.triangles.buffer, malha.normals.buffer);
        }
      }

      return { dado: { itens }, transfer: coletarBuffersTransferiveis(buffers) };
    }

    case 'limpar_superficies': {
      if (!req.pilhaId) {
        assinaturasSuperficie.clear();
      } else if (req.segmentIndex !== undefined) {
        assinaturasSuperficie.get(req.pilhaId)?.delete(req.segmentIndex);
      } else {
        assinaturasSuperficie.delete(req.pilhaId);
      }
      return { dado: { ok: true }, transfer: [] };
    }

    case 'filtrar_mascara3d': {
      const dataView = viewPorTipoArray(req.buffer, req.tipoArray);
      let removidosMesa = 0;
      let removidosOsso = 0;
      if (req.semMesa) {
        removidosMesa = removerMesa3d(dataView as unknown as BufferVolumeEditavel, req.dims).indices.length;
      }
      if (req.semOsso) {
        removidosOsso = removerOsso3d(dataView as unknown as BufferVolumeEditavel, req.dims).indices.length;
      }
      return {
        dado: {
          buffer: dataView.buffer as ArrayBuffer,
          tipoArray: req.tipoArray,
          removidosMesa,
          removidosOsso,
        },
        transfer: coletarBuffersTransferiveis([dataView.buffer as ArrayBuffer]),
      };
    }

    case 'recortar_tesoura3d': {
      const dataView = viewPorTipoArray(req.buffer, req.tipoArray);
      const diff = recortarPoligono3d(
        dataView as unknown as BufferVolumeEditavel,
        req.grid,
        req.projeccao,
        req.poligono,
        req.modo,
        req.valorVazio,
      );
      return {
        dado: {
          buffer: dataView.buffer as ArrayBuffer,
          tipoArray: req.tipoArray,
          diff,
        },
        transfer: coletarBuffersTransferiveis([
          dataView.buffer as ArrayBuffer,
          diff.indices.buffer as ArrayBuffer,
          diff.valoresOriginais.buffer as ArrayBuffer,
        ]),
      };
    }

    case 'processar_totalsegmentator': {
      const resumo = await aplicarArquivosNiftiEmEstado(req.estado, req.grid, req.arquivos);
      return {
        dado: { estado: req.estado, resumo },
        transfer: coletarBuffersTransferiveis([req.estado.rotulos.buffer as ArrayBuffer]),
      };
    }
  }
}

if (typeof workerScope !== 'undefined' && typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = (e: MessageEvent<RequisicaoWorker>) => {
    const req = e.data;
    void processarMensagem(req)
      .then(({ dado, transfer }) => {
        workerScope.postMessage({ id: req.id, sucesso: true, dado }, transfer);
      })
      .catch((err: unknown) => {
        workerScope.postMessage({
          id: req.id,
          sucesso: false,
          erro: err instanceof Error ? err.message : 'Erro desconhecido no compute worker.',
        });
      });
  };
}
