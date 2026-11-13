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
import { ID_MOTOR, iniciarCornerstone } from '../viewer/iniciar';

export const ID_GRUPO = 'grupo-principal';

export interface FerramentaPrimaria {
  nome: string;
  rotulo: string;
  /** Tecla de atalho (minúscula) que escolhe esta ferramenta para o botão esquerdo. */
  tecla: string;
}

export const FERRAMENTAS_PRIMARIAS: FerramentaPrimaria[] = [
  { nome: WindowLevelTool.toolName, rotulo: 'Janela/nível', tecla: 'w' },
  { nome: StackScrollTool.toolName, rotulo: 'Passar cortes', tecla: 's' },
  { nome: LengthTool.toolName, rotulo: 'Distância', tecla: 'd' },
  { nome: AngleTool.toolName, rotulo: 'Ângulo', tecla: 'a' },
  { nome: EllipticalROITool.toolName, rotulo: 'ROI elíptica', tecla: 'e' },
  { nome: PlanarFreehandROITool.toolName, rotulo: 'ROI à mão livre', tecla: 'm' },
  { nome: PolilinhaTool.toolName, rotulo: 'Polilinha', tecla: 'p' },
];

/** Todas as ferramentas do grupo, sem repetição. */
const TODAS_AS_FERRAMENTAS = [
  ...new Set<string>([
    StackScrollTool.toolName,
    WindowLevelTool.toolName,
    ZoomTool.toolName,
    PanTool.toolName,
    ...FERRAMENTAS_PRIMARIAS.map((f) => f.nome),
  ]),
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

/** Cria o grupo uma vez. Os viewports entram depois, cada um que for habilitado. */
function criarGrupoFerramentas(): void {
  if (grupoCriado) return;
  const grupo = ToolGroupManager.createToolGroup(ID_GRUPO);
  if (!grupo) throw new Error('Não foi possível criar o grupo de ferramentas.');
  for (const nome of TODAS_AS_FERRAMENTAS) grupo.addTool(nome);
  grupoCriado = true;
  aplicarAtribuicoes();
}

/** Coloca um viewport já habilitado no grupo (cria o grupo na primeira vez). */
export function adicionarViewportAoGrupo(idViewport: string): void {
  criarGrupoFerramentas();
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (grupo && !grupo.getViewportIds().includes(idViewport)) grupo.addViewport(idViewport, ID_MOTOR);
}

/** Tira um viewport do grupo (antes de desabilitá-lo). */
export function removerViewportDoGrupo(idViewport: string): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (grupo?.getViewportIds().includes(idViewport)) grupo.removeViewports(ID_MOTOR, idViewport);
}

/**
 * Liga cada ferramenta aos botões que a escolheram. setToolActive não desativa as
 * outras ferramentas do mesmo botão, então cada uma é ajustada aqui.
 */
function aplicarAtribuicoes(): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
  if (!grupo) return;
  for (const nome of TODAS_AS_FERRAMENTAS) {
    const bindings = (Object.keys(atribuicao) as Botao[])
      .filter((b) => atribuicao[b] === nome)
      .map((b) => ({ mouseButton: BOTAO_DO_MOUSE[b] }));
    // setToolActive soma os botões novos aos antigos; sem limpar antes, uma ferramenta
    // que mudou de botão continuaria presa no anterior.
    grupo.setToolPassive(nome, { removeAllBindings: true });
    if (bindings.length > 0) grupo.setToolActive(nome, { bindings });
  }
}

/** Disparado em `document` quando a ferramenta de algum botão do mouse muda (barra e atalhos). */
export const EVENTO_BOTOES_MUDARAM = 'botoesMudaram';

/** Escolhe a ferramenta de um botão. Vale mesmo antes do grupo existir. */
export function definirBotao(botao: Botao, nome: string): void {
  atribuicao[botao] = nome || null;
  aplicarAtribuicoes();
  document.dispatchEvent(new CustomEvent(EVENTO_BOTOES_MUDARAM));
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

/** Viewport ativo da grade, se ele mostra alguma série. */
export async function viewportAtivo(): Promise<Types.IStackViewport | undefined> {
  if (!estado.pilhaAtiva || !estado.idViewportAtivo) return undefined;
  const motor = await iniciarCornerstone();
  return motor.getViewport<Types.IStackViewport>(estado.idViewportAtivo);
}

/** Ids de todos os viewports habilitados (os visíveis na grade). */
async function viewportsHabilitados(): Promise<string[]> {
  const motor = await iniciarCornerstone();
  return motor.getViewports().map((v) => v.id);
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

/** Teclado: avança (delta > 0) ou volta (delta < 0) cortes no viewport ativo. */
export function rolarCortes(delta: number): Promise<void> {
  return comViewport((v) => {
    v.scroll(delta);
  });
}

/** Teclado: vai ao primeiro ou ao último corte do viewport ativo. */
export function irParaCorte(posicao: 'primeiro' | 'ultimo'): Promise<void> {
  return comViewport((v) => {
    void v.setImageIdIndex(posicao === 'primeiro' ? 0 : v.getImageIds().length - 1);
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
  const motor = await iniciarCornerstone();
  for (const v of motor.getViewports()) {
    if (v.element instanceof HTMLDivElement) cancelActiveManipulations(v.element);
  }
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
  const ids = await viewportsHabilitados();
  if (ids.length > 0) utilities.triggerAnnotationRenderForViewportIds(ids);
}

/** Escolhe a ferramenta do botão esquerdo pela tecla de atalho. Devolve se achou. */
export function escolherFerramentaPorTecla(tecla: string): boolean {
  const f = FERRAMENTAS_PRIMARIAS.find((p) => p.tecla === tecla);
  if (!f) return false;
  escolherFerramentaPrimaria(f.nome);
  return true;
}
