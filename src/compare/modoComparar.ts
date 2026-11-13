/**
 * Modo Comparar (Fase 4: 4.1, 4.2 e 4.3):
 * - 4.1: Rótulos "ATUAL" / "ANTERIOR" (em cores diferentes) + data do estudo nos dois lados.
 * - 4.2: Rolagem ligada por posição ao longo da normal usando `src/compare/sync.ts`
 *   (`createLink`, `syncedSlice`, `invertLink` e `relink`), aviso de "Fora da cobertura",
 *   botão de cadeado (ao religar chama `relink` com as posições atuais) e botão "Zerar"
 *   que refaz `createLink`.
 * - 4.3: Sincronização de janela/nível (`createVOISynchronizer`) e zoom/pan
 *   (`createZoomPanSynchronizer`) do `@cornerstonejs/tools`, desligáveis separadamente.
 */

import type { Types } from '@cornerstonejs/core';
import { SynchronizerManager, synchronizers } from '@cornerstonejs/tools';
import {
  createLink,
  invertLink,
  isIssue,
  mapPosition,
  nearestIndex,
  relink,
  syncedSlice,
  type ScrollLink,
} from './sync';
import { formatDatePtBr } from '../io/dicomTime';
import { formatPersonName, type DicomIndex, type StackNode } from '../io/organize';
import type { Issue, Vec3 } from '../io/types';

export const ID_SYNC_VOI_COMPARAR = 'sync-comparar-voi';
export const ID_SYNC_ZOOM_PAN_COMPARAR = 'sync-comparar-zoom-pan';

export type PapelComparacao = 'ATUAL' | 'ANTERIOR';

export interface RotuloTemporalSlot {
  papel: PapelComparacao;
  dataFormatada: string;
  avisoPaciente?: string;
}

export interface EstadoComparacao {
  ativo: boolean;
  rolagemLigada: boolean;
  deslocamentoMm: number | null;
  erroVinculo: string | null;
  janelaLigada: boolean;
  zoomPanLigado: boolean;
}

function chaveDataHora(stack: StackNode): string {
  const inst = stack.instances[0];
  const data = inst?.studyDate ?? inst?.seriesDate ?? '';
  const hora = (inst?.studyTime ?? inst?.seriesTime ?? '').padEnd(6, '0');
  return `${data}${hora}`;
}

function chaveEstudoOuData(stack: StackNode): string {
  const inst = stack.instances[0];
  return inst?.studyInstanceUid ?? inst?.studyDate ?? inst?.seriesDate ?? stack.id;
}

export function dataEstudoFormatada(stack: StackNode | null): string {
  if (!stack) return '';
  const inst = stack.instances[0];
  return formatDatePtBr(inst?.studyDate ?? inst?.seriesDate) || 'sem data';
}

/** Hora do estudo (HH:MM), ou '' se não houver. */
export function horaEstudoFormatada(stack: StackNode | null): string {
  const inst = stack?.instances[0];
  const t = (inst?.studyTime ?? inst?.seriesTime ?? '').replace(/\D/g, '');
  return t.length >= 4 ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : '';
}

/** Verdadeiro se as duas pilhas são do mesmo estudo (mesmo StudyInstanceUID). */
export function mesmoEstudo(a: StackNode | null, b: StackNode | null): boolean {
  const ua = a?.instances[0]?.studyInstanceUid;
  const ub = b?.instances[0]?.studyInstanceUid;
  return !!ua && ua === ub;
}

/** Verdadeiro se as duas pilhas são da mesma modalidade (janela só faz sentido entre iguais). */
export function mesmaModalidade(a: StackNode | null, b: StackNode | null): boolean {
  const ma = a?.instances[0]?.modality;
  return !!ma && ma === b?.instances[0]?.modality;
}

function normalizarTextoPaciente(v: string | undefined): string {
  if (!v) return '';
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\^+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function ResumoPaciente(stack: StackNode): {
  nomeNorm: string;
  idNorm: string;
  exibicao: string;
} {
  const inst = stack.instances[0];
  const nomeBonito = formatPersonName(inst?.patientName) || inst?.patientName?.trim() || 'Sem nome';
  const id = inst?.patientId?.trim() || '';
  return {
    nomeNorm: normalizarTextoPaciente(nomeBonito),
    idNorm: normalizarTextoPaciente(id),
    exibicao: id ? `${nomeBonito} (ID: ${id})` : nomeBonito,
  };
}

/**
 * Verifica se há divergência de paciente (considerando Nome e/ou ID) entre as pilhas
 * visíveis nos viewports. Devolve a mensagem de alerta ou `undefined` se forem do mesmo paciente.
 */
export function verificarDivergenciaPacientes(
  pilhasVisiveis: Array<StackNode | null>,
): string | undefined {
  const validas = pilhasVisiveis.filter((p): p is StackNode => p !== null);
  if (validas.length < 2) return undefined;

  const ref = ResumoPaciente(validas[0]!);
  for (let i = 1; i < validas.length; i++) {
    const outro = ResumoPaciente(validas[i]!);
    const idDiferente =
      Boolean(ref.idNorm && outro.idNorm) && ref.idNorm !== outro.idNorm;
    const nomeDiferente =
      Boolean(ref.nomeNorm && outro.nomeNorm) && ref.nomeNorm !== outro.nomeNorm;
    if (idDiferente || nomeDiferente) {
      return `Atenção: pacientes diferentes (${ref.exibicao} × ${outro.exibicao})`;
    }
  }
  return undefined;
}

/**
 * Calcula os rótulos temporais ("ATUAL" e "ANTERIOR") para todos os slots visíveis:
 * - Se `forcarExibicao` for verdadeiro (modo Comparar ativo) OU se houver 2+ pilhas
 *   visíveis de estudos/datas diferentes (ou pacientes diferentes), destaca em cada slot
 *   se ele é `ATUAL` ou `ANTERIOR` + a data do estudo + aviso se os pacientes divergirem.
 */
export function calcularRotulosParaSlots(
  pilhasVisiveis: Array<StackNode | null>,
  forcarExibicao: boolean,
): Array<RotuloTemporalSlot | null> {
  const validas = pilhasVisiveis.filter((p): p is StackNode => p !== null);
  if (validas.length === 0) return pilhasVisiveis.map(() => null);

  const avisoPaciente = verificarDivergenciaPacientes(pilhasVisiveis);
  const estudosDistintos = new Set(validas.map(chaveEstudoOuData));
  const datasDistintas = new Set(validas.map((p) => p.instances[0]?.studyDate ?? p.instances[0]?.seriesDate ?? ''));

  // Todas as pilhas visíveis do mesmo estudo (ex.: PET e TC do mesmo exame): não há "atual" nem
  // "anterior"; só aparece o aviso se o paciente divergir.
  const todasDoMesmoEstudo =
    validas.length >= 2 && validas.every((p) => mesmoEstudo(p, validas[0]!));
  if (todasDoMesmoEstudo && !avisoPaciente) {
    return pilhasVisiveis.map(() => null);
  }

  // Exames do mesmo dia: a hora distingue (ex.: 10:30 × 16:45).
  const datasVisiveis = validas.map((p) => dataEstudoFormatada(p));
  const mostrarHora = new Set(datasVisiveis).size < datasVisiveis.length;

  const deveMostrar =
    forcarExibicao ||
    (validas.length >= 2 && (estudosDistintos.size >= 2 || datasDistintas.size >= 2 || Boolean(avisoPaciente)));

  if (!deveMostrar) {
    return pilhasVisiveis.map(() => null);
  }

  // Maior chave de data/hora entre as pilhas visíveis é considerada ATUAL:
  let maiorChave = '';
  for (const p of validas) {
    const k = chaveDataHora(p);
    if (k > maiorChave) maiorChave = k;
  }

  // Se todas tiverem exatamente a mesma data/hora (ex.: mesmo dia no modo Comparar),
  // o primeiro slot preenchido recebe ATUAL e os demais ANTERIOR.
  const todasMesmaChave = validas.length >= 2 && validas.every((p) => chaveDataHora(p) === maiorChave);
  let primeiroMarcado = false;

  return pilhasVisiveis.map((p) => {
    if (!p) return null;
    let papel: PapelComparacao;
    if (todasMesmaChave) {
      papel = !primeiroMarcado ? 'ATUAL' : 'ANTERIOR';
      primeiroMarcado = true;
    } else {
      papel = chaveDataHora(p) === maiorChave ? 'ATUAL' : 'ANTERIOR';
    }
    return {
      papel,
      dataFormatada: mostrarHora
        ? `${dataEstudoFormatada(p)} ${horaEstudoFormatada(p)}`.trim()
        : dataEstudoFormatada(p),
      avisoPaciente,
    };
  });
}

/**
 * Escolhe automaticamente duas pilhas de estudos diferentes no índice para iniciar
 * o modo Comparar quando o usuário ainda não tem duas séries abertas lado a lado:
 * mantém a pilha atual no lado esquerdo e procura no outro estudo (do mesmo paciente
 * ou de outro paciente na lista) uma série da mesma modalidade.
 */
export function escolherParInicialComparacao(
  index: DicomIndex | undefined,
  pilhaBase: StackNode | null,
): [StackNode | null, StackNode | null] {
  if (!index) return [pilhaBase, null];

  const todasAsPilhas: Array<{ studyUid: string; modality: string; stack: StackNode }> = [];
  for (const pac of index.patients) {
    for (const est of pac.studies) {
      for (const ser of est.series) {
        if (ser.kind !== 'imagem') continue;
        for (const st of ser.stacks) {
          todasAsPilhas.push({
            studyUid: est.studyInstanceUid,
            modality: ser.modality,
            stack: st,
          });
        }
      }
    }
  }

  if (todasAsPilhas.length === 0) return [null, null];

  const primeira =
    (pilhaBase && todasAsPilhas.find((p) => p.stack.id === pilhaBase.id)) ??
    todasAsPilhas[0]!;

  // Procura primeiro outra pilha de estudo diferente e mesma modalidade:
  const mesmaModalidadeOutroEstudo = todasAsPilhas.find(
    (p) => p.studyUid !== primeira.studyUid && p.modality === primeira.modality,
  );
  if (mesmaModalidadeOutroEstudo) {
    return [primeira.stack, mesmaModalidadeOutroEstudo.stack];
  }

  // Senão, qualquer pilha de outro estudo:
  const outroEstudo = todasAsPilhas.find((p) => p.studyUid !== primeira.studyUid);
  if (outroEstudo) {
    return [primeira.stack, outroEstudo.stack];
  }

  // Senão, qualquer outra pilha diferente:
  const outraPilha = todasAsPilhas.find((p) => p.stack.id !== primeira.stack.id);
  return [primeira.stack, outraPilha?.stack ?? null];
}

/**
 * Obtém a posição em mm ao longo da normal da pilha para o corte atual do viewport
 * (funciona tanto para `StackViewport` quanto para `VolumeViewport`).
 */
export function obterPosicaoCorteAtual(
  stack: StackNode,
  vp: Types.IStackViewport | Types.IVolumeViewport | undefined,
): number | undefined {
  const posicoes = stack.geometry.positions;
  if (!vp || posicoes.length === 0) return undefined;

  if ('setImageIdIndex' in vp) {
    const idx = vp.getCurrentImageIdIndex();
    return posicoes[idx];
  }

  const normal = stack.geometry.normal;
  const fp = vp.getCamera()?.focalPoint;
  if (normal && fp) {
    return fp[0] * normal[0] + fp[1] * normal[1] + fp[2] * normal[2];
  }
  const idx = vp.getSliceIndex();
  return posicoes[Math.min(Math.max(idx, 0), posicoes.length - 1)];
}

export interface ResultadoVinculoRolagem {
  link: ScrollLink | null;
  erro: Issue | null;
}

export function criarVinculoComparacao(
  pilha0: StackNode | null,
  pilha1: StackNode | null,
): ResultadoVinculoRolagem {
  if (!pilha0 || !pilha1) return { link: null, erro: null };
  // Mesmo estudo e mesmo referencial (ex.: PET e TC do mesmo exame): as posições em mm já
  // coincidem, então o deslocamento é zero.
  const fa = pilha0.instances[0]?.frameOfReferenceUid;
  const mesmoReferencial = mesmoEstudo(pilha0, pilha1) && !!fa && fa === pilha1.instances[0]?.frameOfReferenceUid;
  const res = createLink(
    pilha0.geometry,
    pilha1.geometry,
    mesmoReferencial ? { alignment: 'mesmo-referencial' } : {},
  );
  if (isIssue(res)) {
    return { link: null, erro: res };
  }
  return { link: res, erro: null };
}

export function recalcularVinculoPorPosicoesAtuais(
  linkAnterior: ScrollLink | null,
  pilha0: StackNode | null,
  pilha1: StackNode | null,
  pos0: number | undefined,
  pos1: number | undefined,
): ResultadoVinculoRolagem {
  const base = linkAnterior
    ? { link: linkAnterior, erro: null }
    : criarVinculoComparacao(pilha0, pilha1);
  if (!base.link || pos0 === undefined || pos1 === undefined) return base;
  return {
    link: relink(base.link, pos0, pos1),
    erro: null,
  };
}

export function calcularCorteSincronizado(
  link0Para1: ScrollLink,
  origemIndice: 0 | 1,
  posicaoOrigem: number,
  pilhaDestino: StackNode,
) {
  const linkEfetivo = origemIndice === 0 ? link0Para1 : invertLink(link0Para1);
  return syncedSlice(linkEfetivo, posicaoOrigem, pilhaDestino.geometry);
}

/**
 * Transforma um ponto 3D `pontoOrigem` (clicado na `pilhaOrigem`) para o espaço 3D
 * equivalente na `pilhaDestino`:
 * - Se compartilharem o mesmo `FrameOfReferenceUID` ou mesmo `StudyInstanceUID`, devolve o próprio `pontoOrigem`.
 * - Se forem exames de estudos diferentes, usa o `ScrollLink` (o vínculo ativo da comparação
 *   ou um vínculo calculado com `createLink`) para ajustar a coordenada ao longo da normal
 *   do exame de destino (mantendo a posição no plano e compensando o deslocamento de mesa).
 */
export function transformarPontoEntrePilhas(
  pontoOrigem: Vec3,
  pilhaOrigem: StackNode,
  pilhaDestino: StackNode,
  linkPreferencial?: ScrollLink | null,
): Vec3 {
  if (pilhaOrigem.id === pilhaDestino.id) return [...pontoOrigem];
  const instO = pilhaOrigem.instances[0];
  const instD = pilhaDestino.instances[0];
  if (
    (instO?.frameOfReferenceUid && instO.frameOfReferenceUid === instD?.frameOfReferenceUid) ||
    (instO?.studyInstanceUid && instO.studyInstanceUid === instD?.studyInstanceUid)
  ) {
    return [...pontoOrigem];
  }

  let link = linkPreferencial ?? null;
  if (!link) {
    const res = createLink(pilhaOrigem.geometry, pilhaDestino.geometry);
    if (!isIssue(res)) link = res;
  }

  const normalO = pilhaOrigem.geometry.normal;
  const normalD = pilhaDestino.geometry.normal;
  if (!link || !normalO || !normalD) {
    return [...pontoOrigem];
  }

  const posO =
    pontoOrigem[0] * normalO[0] + pontoOrigem[1] * normalO[1] + pontoOrigem[2] * normalO[2];
  const posD = mapPosition(link, posO);
  const projAtualEmD =
    pontoOrigem[0] * normalD[0] + pontoOrigem[1] * normalD[1] + pontoOrigem[2] * normalD[2];
  const delta = posD - projAtualEmD;

  return [
    pontoOrigem[0] + delta * normalD[0],
    pontoOrigem[1] + delta * normalD[1],
    pontoOrigem[2] + delta * normalD[2],
  ];
}

export { nearestIndex };

// ---------- Sincronizadores de Janela/Nível e Zoom/Pan (4.3) ----------

export function sincronizarParCornerstone(
  idEngine: string,
  vpIds: [string, string],
  opcoes: { janela: boolean; zoomPan: boolean },
): void {
  SynchronizerManager.destroySynchronizer(ID_SYNC_VOI_COMPARAR);
  SynchronizerManager.destroySynchronizer(ID_SYNC_ZOOM_PAN_COMPARAR);

  const v0: Types.IViewportId = { renderingEngineId: idEngine, viewportId: vpIds[0] };
  const v1: Types.IViewportId = { renderingEngineId: idEngine, viewportId: vpIds[1] };

  if (opcoes.janela) {
    const syncVoi = synchronizers.createVOISynchronizer(ID_SYNC_VOI_COMPARAR, {
      syncInvertState: true,
      syncColormap: true,
    });
    syncVoi.add(v0);
    syncVoi.add(v1);
  }

  if (opcoes.zoomPan) {
    const syncZoomPan = synchronizers.createZoomPanSynchronizer(ID_SYNC_ZOOM_PAN_COMPARAR);
    syncZoomPan.add(v0);
    syncZoomPan.add(v1);
  }
}

export function destruirSincronizadoresComparacao(): void {
  SynchronizerManager.destroySynchronizer(ID_SYNC_VOI_COMPARAR);
  SynchronizerManager.destroySynchronizer(ID_SYNC_ZOOM_PAN_COMPARAR);
}
