/**
 * Grupo de ferramentas do viewport 2D: mouse fixo (zoom, pan, rolagem), ferramenta
 * do botão esquerdo e ações sobre a imagem (inverter, girar, espelhar, presets, medidas).
 */

import type { Types } from '@cornerstonejs/core';
import {
  AngleTool,
  annotation,
  cancelActiveManipulations,
  EllipticalROITool,
  Enums as EnumsTools,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
  StackScrollTool,
  ToolGroupManager,
  utilities,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { estado } from '../state/store';
import { PolilinhaTool } from './polilinha';
import { ID_MOTOR, ID_VIEWPORT_2D, iniciarCornerstone } from '../viewer/iniciar';

export const ID_GRUPO = 'grupo-principal';
export const ID_ELEMENTO_2D = 'viewport-2d';

export interface FerramentaPrimaria {
  nome: string;
  rotulo: string;
}

export const FERRAMENTAS_PRIMARIAS: FerramentaPrimaria[] = [
  { nome: WindowLevelTool.toolName, rotulo: 'Janela/nível' },
  { nome: LengthTool.toolName, rotulo: 'Distância' },
  { nome: AngleTool.toolName, rotulo: 'Ângulo' },
  { nome: EllipticalROITool.toolName, rotulo: 'ROI elíptica' },
  { nome: PlanarFreehandROITool.toolName, rotulo: 'ROI à mão livre' },
  { nome: PolilinhaTool.toolName, rotulo: 'Polilinha' },
];

export type Botao = 'esquerdo' | 'direito' | 'meio' | 'roda';

export interface OpcaoBotao {
  nome: string;
  rotulo: string;
}

/** Opções para os botões direito, meio e roda. Nome vazio = nenhuma ferramenta. */
export const OPCOES_SECUNDARIAS: OpcaoBotao[] = [
  { nome: '', rotulo: 'Nenhuma' },
  { nome: ZoomTool.toolName, rotulo: 'Zoom' },
  { nome: WindowLevelTool.toolName, rotulo: 'Janela/nível' },
  { nome: PanTool.toolName, rotulo: 'Pan' },
  { nome: StackScrollTool.toolName, rotulo: 'Passar cortes' },
];

/** A roda só responde a cortes e zoom (testado: janela/nível e pan não reagem a ela). */
export const OPCOES_RODA: OpcaoBotao[] = OPCOES_SECUNDARIAS.filter((o) =>
  ['', ZoomTool.toolName, StackScrollTool.toolName].includes(o.nome),
);

/** Opções do botão esquerdo: as ferramentas de medida e a janela. */
export const OPCOES_ESQUERDO: OpcaoBotao[] = FERRAMENTAS_PRIMARIAS.map((f) => ({ nome: f.nome, rotulo: f.rotulo }));

const BOTAO_DO_MOUSE: Record<Botao, EnumsTools.MouseBindings> = {
  esquerdo: EnumsTools.MouseBindings.Primary,
  direito: EnumsTools.MouseBindings.Secondary,
  meio: EnumsTools.MouseBindings.Auxiliary,
  roda: EnumsTools.MouseBindings.Wheel,
};

/** Padrão: esquerdo = janela/nível, direito = zoom, meio = pan, roda = passar cortes. */
const atribuicao: Record<Botao, string | null> = {
  esquerdo: WindowLevelTool.toolName,
  direito: ZoomTool.toolName,
  meio: PanTool.toolName,
  roda: StackScrollTool.toolName,
};

export interface Predefinicao {
  rotulo: string;
  /** Centro e largura, na convenção usual de TC. */
  centro: number;
  largura: number;
}

/** Ordem das teclas 1 a 6. */
export const PREDEFINICOES: Predefinicao[] = [
  { rotulo: 'Partes moles', centro: 40, largura: 400 },
  { rotulo: 'Pulmão', centro: -600, largura: 1500 },
  { rotulo: 'Osso', centro: 300, largura: 1500 },
  { rotulo: 'Fígado', centro: 60, largura: 160 },
  { rotulo: 'Cérebro', centro: 40, largura: 80 },
  { rotulo: 'Mediastino', centro: 50, largura: 350 },
];

let grupoCriado = false;

/** Cria o grupo uma vez, com o viewport 2D já habilitado no motor. */
export function criarGrupoFerramentas(): void {
  if (grupoCriado) return;
  const grupo = ToolGroupManager.createToolGroup(ID_GRUPO);
  if (!grupo) throw new Error('Não foi possível criar o grupo de ferramentas.');
  for (const nome of [
    StackScrollTool.toolName,
    WindowLevelTool.toolName,
    ZoomTool.toolName,
    PanTool.toolName,
    ...FERRAMENTAS_PRIMARIAS.map((f) => f.nome),
  ]) {
    grupo.addTool(nome);
  }
  grupo.addViewport(ID_VIEWPORT_2D, ID_MOTOR);
  grupoCriado = true;
  aplicarAtribuicoes();
}

/**
 * Liga cada ferramenta aos botões que a escolheram. setToolActive não desativa as
 * outras ferramentas do mesmo botão, então cada uma é ajustada aqui.
 */
function aplicarAtribuicoes(): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (!grupo) return;
  const nomes = new Set<string>([
    StackScrollTool.toolName,
    WindowLevelTool.toolName,
    ZoomTool.toolName,
    PanTool.toolName,
    ...FERRAMENTAS_PRIMARIAS.map((f) => f.nome),
  ]);
  for (const nome of nomes) {
    const bindings = (Object.keys(atribuicao) as Botao[])
      .filter((b) => atribuicao[b] === nome)
      .map((b) => ({ mouseButton: BOTAO_DO_MOUSE[b] }));
    if (bindings.length > 0) grupo.setToolActive(nome, { bindings });
    else grupo.setToolPassive(nome, { removeAllBindings: true });
  }
}

/** Escolhe a ferramenta de um botão. Vale mesmo antes do grupo existir. */
export function definirBotao(botao: Botao, nome: string): void {
  atribuicao[botao] = nome || null;
  aplicarAtribuicoes();
}

export function botaoAtribuido(botao: Botao): string {
  return atribuicao[botao] ?? '';
}

/** Ferramenta do botão esquerdo (atalho para definirBotao('esquerdo', ...)). */
export function escolherFerramentaPrimaria(nome: string): void {
  definirBotao('esquerdo', nome);
}

export function ferramentaPrimariaAtual(): string {
  return botaoAtribuido('esquerdo');
}

async function viewportAtivo(): Promise<Types.IStackViewport | undefined> {
  if (!estado.pilhaAtiva) return undefined;
  const motor = await iniciarCornerstone();
  return motor.getViewport<Types.IStackViewport>(ID_VIEWPORT_2D);
}

/** Aplica uma ação ao viewport ativo, se houver série aberta. */
async function comViewport(acao: (v: Types.IStackViewport) => void): Promise<void> {
  const v = await viewportAtivo();
  if (!v) return;
  acao(v);
  v.render();
}

export function inverter(): Promise<void> {
  return comViewport((v) => {
    v.setProperties({ invert: !v.getProperties().invert });
  });
}

// Rotação e espelhamento do stack viewport passam por setViewPresentation.
// setCamera ignora o campo rotation.
export function girar90(): Promise<void> {
  return comViewport((v) => {
    const atual = v.getViewPresentation();
    v.setViewPresentation({ rotation: ((atual.rotation ?? 0) + 90) % 360 });
  });
}

export function espelhar(): Promise<void> {
  return comViewport((v) => {
    const atual = v.getViewPresentation();
    v.setViewPresentation({ flipHorizontal: !(atual.flipHorizontal ?? false) });
  });
}

/** Volta janela, zoom, pan, rotação e espelhamento ao estado inicial da série. */
export function restaurar(): Promise<void> {
  return comViewport((v) => {
    v.resetProperties();
    v.resetCamera();
  });
}

export function aplicarPredefinicao(indice: number): Promise<void> {
  const p = PREDEFINICOES[indice];
  if (!p) return Promise.resolve();
  return comViewport((v) => {
    v.setProperties({
      voiRange: { lower: p.centro - p.largura / 2, upper: p.centro + p.largura / 2 },
    });
  });
}

/** Esc: cancela a medida em andamento, tira a seleção e volta à janela/nível. */
export async function cancelar(): Promise<void> {
  const elemento = document.getElementById(ID_ELEMENTO_2D);
  if (elemento instanceof HTMLDivElement) cancelActiveManipulations(elemento);
  annotation.selection.deselectAnnotation();
  escolherFerramentaPrimaria(WindowLevelTool.toolName);
  await redesenhar();
}

/** Delete: apaga as medidas selecionadas. */
export async function apagarSelecionadas(): Promise<void> {
  const uids = annotation.selection.getAnnotationsSelected();
  if (uids.length === 0) return;
  for (const uid of uids) annotation.state.removeAnnotation(uid);
  await redesenhar();
}

export async function limparMedidas(): Promise<void> {
  annotation.state.removeAllAnnotations();
  await redesenhar();
}

async function redesenhar(): Promise<void> {
  if (!estado.pilhaAtiva) return;
  utilities.triggerAnnotationRenderForViewportIds([ID_VIEWPORT_2D]);
}
