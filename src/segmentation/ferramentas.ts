/**
 * Ferramentas de segmentação (fase 9.1). Pincel, pincel com limiar, esfera e borracha são
 * instâncias da `BrushTool` do Cornerstone com estratégias diferentes; preencher é a
 * `PaintFillTool` (no corte). "Crescer região" é própria: um clique chama o `regionGrow` de
 * `src/volume/voxelStats.ts` (em 3D, pela faixa de valores) através de um resolvedor registrado
 * por `viewport2d`, que conhece os volumes. As ferramentas prontas de crescimento do Cornerstone
 * dependem de WebGPU e por isso não são usadas.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { BaseTool, BrushTool, PaintFillTool, type Types } from '@cornerstonejs/tools';

export { BrushTool, PaintFillTool };

/** Resultado do crescer região, para o painel (texto pronto) ou um erro em português. */
export type ResolvedorCrescer = (idViewport: string, mundo: [number, number, number]) => Promise<string>;

let resolvedorCrescer: ResolvedorCrescer | null = null;

export function definirResolvedorCrescer(fn: ResolvedorCrescer): void {
  resolvedorCrescer = fn;
}

/** Disparado em `document` com `detail` = texto a mostrar no painel de segmentos. */
export const EVENTO_MENSAGEM_SEGMENTACAO = 'mensagemSegmentacao';

function mensagem(texto: string): void {
  document.dispatchEvent(new CustomEvent(EVENTO_MENSAGEM_SEGMENTACAO, { detail: texto }));
}

export class CrescerRegiaoTool extends BaseTool {
  static override toolName = 'CrescerRegiao';
  private ocupado = false;

  constructor(
    toolProps: Record<string, unknown> = {},
    defaultToolProps: Record<string, unknown> = { supportedInteractionTypes: ['Mouse'], configuration: {} },
  ) {
    super(toolProps, defaultToolProps as never);
  }

  preMouseDownCallback = (evt: Types.EventTypes.MouseDownActivateEventType): boolean => {
    const { element, currentPoints } = evt.detail;
    const vp = getEnabledElement(element)?.viewport;
    if (!vp || !resolvedorCrescer || this.ocupado) return true;
    const mundo = [...currentPoints.world] as [number, number, number];
    this.ocupado = true;
    mensagem('Crescendo a região…');
    void resolvedorCrescer(vp.id, mundo)
      .then(mensagem)
      .catch((e: unknown) => mensagem(e instanceof Error ? e.message : 'Falha ao crescer a região.'))
      .finally(() => {
        this.ocupado = false;
      });
    return true;
  };
}

export interface FerramentaSegmentacao {
  nome: string;
  rotulo: string;
  icone: string;
  /** Instância da BrushTool com esta estratégia (ausente nas ferramentas próprias). */
  estrategia?: string;
  dica: string;
}

export const FERRAMENTAS_SEGMENTACAO: FerramentaSegmentacao[] = [
  {
    nome: 'SegPincel',
    rotulo: 'Pincel',
    icone: '🖌',
    estrategia: 'FILL_INSIDE_CIRCLE',
    dica: 'Pinta um círculo no corte, no segmento ativo',
  },
  {
    nome: 'SegPincelLimiar',
    rotulo: 'Pincel com limiar',
    icone: '🎚',
    estrategia: 'THRESHOLD_INSIDE_CIRCLE',
    dica: 'Pinta só os voxels dentro da faixa (HU ou SUV) do painel',
  },
  {
    nome: 'SegEsfera',
    rotulo: 'Esfera',
    icone: '⚪',
    estrategia: 'FILL_INSIDE_SPHERE',
    dica: 'Pinta uma esfera (3D) com o raio do painel',
  },
  {
    nome: PaintFillTool.toolName,
    rotulo: 'Preencher',
    icone: '🪣',
    dica: 'Preenche a região fechada clicada, no corte',
  },
  {
    nome: 'SegBorracha',
    rotulo: 'Borracha',
    icone: '🧽',
    estrategia: 'ERASE_INSIDE_CIRCLE',
    dica: 'Apaga a segmentação num círculo do corte',
  },
  {
    nome: CrescerRegiaoTool.toolName,
    rotulo: 'Crescer região',
    icone: '✳',
    dica: 'Clique numa estrutura: cresce em 3D pelos voxels vizinhos dentro da faixa do painel',
  },
];

export function ehFerramentaSegmentacao(nome: string): boolean {
  return FERRAMENTAS_SEGMENTACAO.some((f) => f.nome === nome);
}

/** Raio padrão do pincel e da esfera, em mm. */
export const RAIO_PADRAO_MM = 5;

/** Configuração de cada instância da BrushTool no grupo. */
export function configuracaoDoPincel(f: FerramentaSegmentacao): Record<string, unknown> {
  return { activeStrategy: f.estrategia, defaultStrategy: f.estrategia, brushSize: RAIO_PADRAO_MM };
}
