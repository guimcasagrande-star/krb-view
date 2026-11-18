/**
 * Ferramentas de segmentação enxutas e diretas para rotina radiológica:
 * - `SegPincel`: pincel fino (padrão 2,5 mm) com preenchimento automático de contornos fechados
 *   e interpolação automática entre cortes próximos; segurar Shift apaga temporariamente.
 * - `SegBorracha`: corrigir/apagar excessos e vazamentos da máscara no corte.
 * - `SegVaso`: clique único em vaso contrastado para crescimento 3D inteligente por todo o vaso.
 */

import { getEnabledElement } from '@cornerstonejs/core';
import { BaseTool, BrushTool, type Types } from '@cornerstonejs/tools';

export { BrushTool };

/** Executa o crescimento de região contíguo para vasos no ponto clicado e devolve a mensagem de status. */
export type ResolvedorVaso = (idViewport: string, mundo: [number, number, number]) => Promise<string>;

let resolvedorVaso: ResolvedorVaso | null = null;

export function definirResolvedorVaso(fn: ResolvedorVaso): void {
  resolvedorVaso = fn;
}

/** Disparado em `document` com `detail` = texto a mostrar no painel de segmentos. */
export const EVENTO_MENSAGEM_SEGMENTACAO = 'mensagemSegmentacao';

function mensagem(texto: string): void {
  document.dispatchEvent(new CustomEvent(EVENTO_MENSAGEM_SEGMENTACAO, { detail: texto }));
}

/** Segmentação de vasos (fase 10.2): clique único no vaso cresce em 3D por todo o trajeto conectado. */
export class VasoTool extends BaseTool {
  static override toolName = 'SegVaso';
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
    if (!vp || !resolvedorVaso || this.ocupado) return true;
    const mundo = [...currentPoints.world] as [number, number, number];
    this.ocupado = true;
    mensagem('Segmentando vaso…');

    void resolvedorVaso(vp.id, mundo)
      .then((texto) => mensagem(texto))
      .catch((e: unknown) => mensagem(e instanceof Error ? e.message : 'Falha ao segmentar o vaso.'))
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

export const NOME_PINCEL = 'SegPincel';
export const NOME_BORRACHA = 'SegBorracha';

export const FERRAMENTAS_SEGMENTACAO: FerramentaSegmentacao[] = [
  {
    nome: NOME_PINCEL,
    rotulo: 'Pincel',
    icone: '🖌',
    estrategia: 'FILL_INSIDE_CIRCLE',
    dica: 'Contorna e pinta no corte. Fecha automaticamente o centro ao soltar e liga os cortes próximos (segure Shift ao arrastar para apagar)',
  },
  {
    nome: NOME_BORRACHA,
    rotulo: 'Corrigir',
    icone: '🧽',
    estrategia: 'ERASE_INSIDE_CIRCLE',
    dica: 'Apaga vazamentos, excessos e imperfeições da segmentação no corte (teclas [ e ] ajustam o tamanho)',
  },
  {
    nome: VasoTool.toolName,
    rotulo: 'Vasos',
    icone: '🩸',
    dica: 'Clique num vaso contrastado: detecta automaticamente a densidade luminal e seleciona todo o trajeto 3D sem invadir parênquima ou osso denso',
  },
];

export function ehFerramentaSegmentacao(nome: string): boolean {
  return FERRAMENTAS_SEGMENTACAO.some((f) => f.nome === nome);
}

/** Raio padrão do pincel e do corretor, em mm (2,5 mm = traço fino de 5 mm de diâmetro). */
export const RAIO_PADRAO_MM = 2.5;
export const RAIO_MIN_MM = 0.5;
export const RAIO_MAX_MM = 40;

export const EVENTO_MODO_SEGMENTACAO = 'modoSegmentacaoMudou';
export const EVENTO_RAIO_PINCEL = 'raioPincelMudou';

let modoSegmentacaoAtivoFlag = false;
let raioAtualMm = RAIO_PADRAO_MM;

export function emModoSegmentacao(): boolean {
  return modoSegmentacaoAtivoFlag;
}

export function definirModoSegmentacao(ativo: boolean): void {
  if (modoSegmentacaoAtivoFlag === ativo) return;
  modoSegmentacaoAtivoFlag = ativo;
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent<boolean>(EVENTO_MODO_SEGMENTACAO, { detail: ativo }));
  }
}

export function obterRaioPincelMm(): number {
  return raioAtualMm;
}

export function definirRaioPincelMm(novoMm: number): number {
  const limpo = Math.round(Math.min(RAIO_MAX_MM, Math.max(RAIO_MIN_MM, novoMm)) * 2) / 2;
  if (raioAtualMm !== limpo) {
    raioAtualMm = limpo;
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent<number>(EVENTO_RAIO_PINCEL, { detail: raioAtualMm }));
    }
  }
  return raioAtualMm;
}

export function ajustarRaioPincelDelta(direcao: -1 | 1): number {
  const passo = raioAtualMm < 5 ? 0.5 : raioAtualMm < 15 ? 1 : 2;
  return definirRaioPincelMm(raioAtualMm + direcao * passo);
}

/** Configuração de cada instância da BrushTool no grupo. */
export function configuracaoDoPincel(f: FerramentaSegmentacao): Record<string, unknown> {
  return { activeStrategy: f.estrategia, defaultStrategy: f.estrategia, brushSize: raioAtualMm };
}
