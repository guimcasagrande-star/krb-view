/**
 * Ferramentas de segmentação (fase 9.1). Pincel, pincel com limiar, esfera e borracha são
 * instâncias da `BrushTool` do Cornerstone com estratégias diferentes; preencher é a
 * `PaintFillTool` (no corte). "Crescer região" é própria: clicar e arrastar chama o
 * `crescerNaEsfera` de `mascaras.ts` (em 3D, pela faixa de valores, limitado ao raio arrastado)
 * através de um resolvedor registrado por `viewport2d`, que conhece os volumes. As ferramentas prontas de crescimento do Cornerstone
 * dependem de WebGPU e por isso não são usadas.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { BaseTool, BrushTool, PaintFillTool, type Types } from '@cornerstonejs/tools';

export { BrushTool, PaintFillTool };

/**
 * Crescimento em andamento: começa no clique e é refeito a cada raio (a distância arrastada).
 * `crescer` devolve o texto para o painel.
 */
export interface SessaoCrescer {
  crescer(raioMm: number): string;
}

/** Abre a sessão no ponto clicado, ou devolve o motivo (texto pronto) de não poder. */
export type ResolvedorCrescer = (idViewport: string, mundo: [number, number, number]) => Promise<SessaoCrescer | string>;

let resolvedorCrescer: ResolvedorCrescer | null = null;

export function definirResolvedorCrescer(fn: ResolvedorCrescer): void {
  resolvedorCrescer = fn;
}

/** Raio de um clique sem arrastar e raio máximo do arrasto, em mm. */
export const RAIO_CRESCER_CLIQUE_MM = 5;
export const RAIO_CRESCER_MAXIMO_MM = 80;

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

    // O raio é a distância arrastada a partir do clique (no plano da imagem).
    let raio = RAIO_CRESCER_CLIQUE_MM;
    let sessao: SessaoCrescer | null = null;
    let solto = false;
    let agendado = false;
    const refazer = (): void => {
      agendado = false;
      if (sessao) mensagem(sessao.crescer(raio));
    };
    const aoMover = (ev: MouseEvent): void => {
      const rect = element.getBoundingClientRect();
      const p = vp.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]);
      const d = Math.hypot(p[0] - mundo[0], p[1] - mundo[1], p[2] - mundo[2]);
      const novo = Math.min(RAIO_CRESCER_MAXIMO_MM, Math.max(RAIO_CRESCER_CLIQUE_MM, Math.round(d)));
      if (novo === raio) return;
      raio = novo;
      if (sessao && !agendado) {
        agendado = true;
        requestAnimationFrame(refazer);
      }
    };
    const aoSoltar = (): void => {
      solto = true;
      window.removeEventListener('mousemove', aoMover, true);
      window.removeEventListener('mouseup', aoSoltar, true);
      if (sessao) {
        refazer();
        this.ocupado = false;
      }
    };
    window.addEventListener('mousemove', aoMover, true);
    window.addEventListener('mouseup', aoSoltar, true);

    void resolvedorCrescer(vp.id, mundo)
      .then((r) => {
        if (typeof r === 'string') {
          mensagem(r);
          return;
        }
        sessao = r;
        refazer();
      })
      .catch((e: unknown) => mensagem(e instanceof Error ? e.message : 'Falha ao crescer a região.'))
      .finally(() => {
        // Sem sessão (erro) ou botão já solto: a ferramenta fica livre para o próximo clique.
        if (!sessao || solto) this.ocupado = false;
        if (!sessao) {
          window.removeEventListener('mousemove', aoMover, true);
          window.removeEventListener('mouseup', aoSoltar, true);
        }
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
    dica: 'Pinta no corte, no segmento ativo. Ao soltar o botão: preenche o contorno fechado e liga aos cortes pintados a até 20 mm, preenchendo os vazios entre eles',
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
    dica: 'Clique numa estrutura e arraste: cresce em 3D pelos vizinhos de valor parecido, só até a distância arrastada',
  },
];

/** Nome do pincel simples (o que preenche o miolo do contorno ao soltar). */
export const NOME_PINCEL = 'SegPincel';

export function ehFerramentaSegmentacao(nome: string): boolean {
  return FERRAMENTAS_SEGMENTACAO.some((f) => f.nome === nome);
}

/** Raio padrão do pincel e da esfera, em mm. */
export const RAIO_PADRAO_MM = 5;

/** Configuração de cada instância da BrushTool no grupo. */
export function configuracaoDoPincel(f: FerramentaSegmentacao): Record<string, unknown> {
  return { activeStrategy: f.estrategia, defaultStrategy: f.estrategia, brushSize: RAIO_PADRAO_MM };
}
