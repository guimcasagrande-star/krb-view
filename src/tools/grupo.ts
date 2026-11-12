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
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  utilities,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { estado } from '../state/store';
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
  { nome: RectangleROITool.toolName, rotulo: 'ROI retangular' },
  { nome: ProbeTool.toolName, rotulo: 'Sonda' },
];

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

let ferramentaPrimaria = WindowLevelTool.toolName;
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

  // Botões fixos: roda do mouse = cortes, direito = zoom, meio = pan.
  grupo.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Wheel }],
  });
  grupo.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Secondary }],
  });
  grupo.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Auxiliary }],
  });
  grupoCriado = true;
  aplicarPrimaria();
}

function aplicarPrimaria(): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (!grupo) return;
  grupo.setToolActive(ferramentaPrimaria, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Primary }],
  });
}

/** Escolhe a ferramenta do botão esquerdo. Vale mesmo antes do grupo existir. */
export function escolherFerramentaPrimaria(nome: string): void {
  ferramentaPrimaria = nome;
  aplicarPrimaria();
}

export function ferramentaPrimariaAtual(): string {
  return ferramentaPrimaria;
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

export function girar90(): Promise<void> {
  return comViewport((v) => {
    const camera = v.getCamera();
    v.setCamera({ ...camera, rotation: ((camera.rotation ?? 0) + 90) % 360 });
  });
}

export function espelhar(): Promise<void> {
  return comViewport((v) => {
    const camera = v.getCamera();
    v.setCamera({ ...camera, flipHorizontal: !(camera.flipHorizontal ?? false) });
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
