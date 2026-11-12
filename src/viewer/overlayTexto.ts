/**
 * Texto do overlay nos quatro cantos do viewport 2D. Função pura: recebe os metadados
 * do corte atual e os valores do viewport, e devolve linhas de texto prontas para mostrar.
 * Campo ausente vira linha omitida, nunca um valor inventado.
 */

import { formatDatePtBr } from '../io/dicomTime';
import { formatPersonName } from '../io/organize';
import type { InstanceMeta } from '../io/types';

export interface DadosOverlay {
  /** Pilha ativa: primeiro corte (paciente, estudo, série). */
  primeira: InstanceMeta;
  /** Corte atual, na ordem de exibição. */
  atual: InstanceMeta;
  /** Índice do corte atual (0 a total - 1). */
  indice: number;
  total: number;
  /** Janela atual do viewport, em unidades do pixel. */
  voiRange?: { lower: number; upper: number };
  /** Zoom do viewport (1 = tamanho de ajuste). */
  zoom?: number;
}

export interface CantosOverlay {
  superiorEsquerdo: string[];
  superiorDireito: string[];
  inferiorEsquerdo: string[];
  inferiorDireito: string[];
}

/** Número com vírgula decimal, como no Brasil. */
function numero(valor: number, casas = 1): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

function naoVazias(linhas: Array<string | undefined>): string[] {
  return linhas.filter((l): l is string => !!l);
}

export function montarOverlay(d: DadosOverlay): CantosOverlay {
  const nome = formatPersonName(d.primeira.patientName);
  const data = formatDatePtBr(d.primeira.studyDate);
  const serie = [d.atual.modality, d.atual.seriesDescription].filter(Boolean).join(' · ');

  const posicao = d.atual.sliceLocation ?? d.atual.imagePositionPatient?.[2];
  const espessura = d.atual.sliceThickness;

  const janela = d.voiRange
    ? `Janela ${numero(d.voiRange.upper - d.voiRange.lower, 0)} · Nível ${numero((d.voiRange.upper + d.voiRange.lower) / 2, 0)}`
    : undefined;

  return {
    superiorEsquerdo: naoVazias([
      nome || undefined,
      d.primeira.patientId ? `ID ${d.primeira.patientId}` : undefined,
    ]),
    superiorDireito: naoVazias([
      data ? `Estudo ${data}` : undefined,
      serie || undefined,
      d.primeira.studyDescription || undefined,
    ]),
    inferiorEsquerdo: naoVazias([
      `Corte ${d.indice + 1} / ${d.total}`,
      espessura !== undefined ? `Espessura ${numero(espessura)} mm` : undefined,
      posicao !== undefined ? `Posição ${numero(posicao)} mm` : undefined,
    ]),
    inferiorDireito: naoVazias([
      janela,
      d.zoom !== undefined ? `Zoom ${numero(d.zoom * 100, 0)}%` : undefined,
    ]),
  };
}
