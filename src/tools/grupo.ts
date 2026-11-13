/**
 * Grupo de ferramentas do viewport (2D e MPR): mouse fixo (zoom, pan, rolagem), ferramenta
 * do botão esquerdo e ações sobre a imagem (inverter, girar, espelhar, presets, medidas).
 */

import type { Types } from '@cornerstonejs/core';
import {
  AngleTool,
  annotation,
  cancelActiveManipulations,
  CrosshairsTool,
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
import { preferencias, salvarPreferencias, type Janela } from '../state/preferencias';
import { estado } from '../state/store';
import { petEmSuv, TETOS_SUV } from '../viewer/exibicaoInicial';
import { textoAngulo, textoDistancia, textoRoi } from './estiloMedidas';
import { DesvioLinhaMediaTool } from './desvioLinhaMedia';
import { FERRAMENTA_LOCALIZADOR_3D } from './localizador3d';
import {
  AnguloCobbTool,
  AnguloReferenciaTool,
  EstenoseTool,
  ProporcaoLinearTool,
} from './medidasAvancadas';
import { PolilinhaTool } from './polilinha';
import { SetaTool } from './seta';
import { VoiEsferaTool } from './voiEsfera';
import { ID_MOTOR, iniciarCornerstone } from '../viewer/iniciar';

export const ID_GRUPO = 'grupo-principal';

/** Cores das linhas de referência de cada plano no MPR (Axial, Coronal, Sagital). */
export const CORES_MPR: Record<string, string> = {
  'vp-0': '#38bdf8',
  'vp-1': '#4ade80',
  'vp-2': '#fbbf24',
};

export interface FerramentaPrimaria {
  nome: string;
  rotulo: string;
  /** Tecla de atalho (minúscula) que escolhe esta ferramenta para o botão esquerdo. */
  tecla: string;
  /** Quando verdadeiro, só fica disponível no modo MPR. */
  apenasMpr?: boolean;
  /** Categoria para agrupar na barra superior estilo RadiAnt. */
  categoria: 'navegacao' | 'medida';
}

export const FERRAMENTAS_PRIMARIAS: FerramentaPrimaria[] = [
  { nome: StackScrollTool.toolName, rotulo: 'Passar cortes', tecla: 's', categoria: 'navegacao' },
  { nome: WindowLevelTool.toolName, rotulo: 'Janela/nível', tecla: 'w', categoria: 'navegacao' },
  { nome: PanTool.toolName, rotulo: 'Pan', tecla: 'h', categoria: 'navegacao' },
  { nome: ZoomTool.toolName, rotulo: 'Zoom', tecla: 'z', categoria: 'navegacao' },
  { nome: FERRAMENTA_LOCALIZADOR_3D, rotulo: '┼ Localizar', tecla: 'x', categoria: 'navegacao' },
  { nome: CrosshairsTool.toolName, rotulo: 'Crosshairs', tecla: 'c', apenasMpr: true, categoria: 'navegacao' },
  { nome: LengthTool.toolName, rotulo: 'Distância', tecla: 'd', categoria: 'medida' },
  { nome: DesvioLinhaMediaTool.toolName, rotulo: 'Desvio linha média', tecla: 'b', categoria: 'medida' },
  { nome: ProporcaoLinearTool.toolName, rotulo: 'Proporção (razão L1/L2)', tecla: 'q', categoria: 'medida' },
  { nome: EstenoseTool.toolName, rotulo: 'Relação de estenose (%)', tecla: 'n', categoria: 'medida' },
  { nome: AngleTool.toolName, rotulo: 'Ângulo (3 pontos)', tecla: 'a', categoria: 'medida' },
  { nome: AnguloCobbTool.toolName, rotulo: 'Ângulo de Cobb (4 pontos)', tecla: 'k', categoria: 'medida' },
  { nome: AnguloReferenciaTool.toolName, rotulo: 'Ângulo c/ eixo horiz./vert.', tecla: 'v', categoria: 'medida' },
  { nome: SetaTool.toolName, rotulo: 'Seta', tecla: 't', categoria: 'medida' },
  { nome: VoiEsferaTool.toolName, rotulo: 'ROI volumétrica (esfera)', tecla: 'u', categoria: 'medida' },
  { nome: EllipticalROITool.toolName, rotulo: 'ROI elíptica', tecla: 'e', categoria: 'medida' },
  { nome: PlanarFreehandROITool.toolName, rotulo: 'ROI à mão livre', tecla: 'm', categoria: 'medida' },
  { nome: PolilinhaTool.toolName, rotulo: 'Polilinha', tecla: 'p', categoria: 'medida' },
];

/** Todas as ferramentas nativas do grupo Cornerstone, sem repetição. */
const TODAS_AS_FERRAMENTAS = [
  ...new Set<string>([
    StackScrollTool.toolName,
    WindowLevelTool.toolName,
    ZoomTool.toolName,
    PanTool.toolName,
    ...FERRAMENTAS_PRIMARIAS.map((f) => f.nome).filter((n) => n !== FERRAMENTA_LOCALIZADOR_3D),
  ]),
];

export type Botao = 'esquerdo' | 'direito' | 'meio' | 'roda' | 'voltar' | 'avancar';

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
  { nome: FERRAMENTA_LOCALIZADOR_3D, rotulo: '┼ Localizar' },
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
  voltar: EnumsTools.MouseBindings.Fourth_Button,
  avancar: EnumsTools.MouseBindings.Fifth_Button,
};

/**
 * Botões laterais (voltar e avançar): ferramentas nativas do Cornerstone, que funcionam com
 * qualquer botão. As de vários cliques desta aplicação respondem só ao botão esquerdo.
 */
export const OPCOES_LATERAIS: OpcaoBotao[] = [
  ...OPCOES_SECUNDARIAS,
  { nome: LengthTool.toolName, rotulo: 'Distância (medida simples)' },
  { nome: AngleTool.toolName, rotulo: 'Ângulo (3 pontos)' },
  { nome: EllipticalROITool.toolName, rotulo: 'ROI elíptica' },
  { nome: PlanarFreehandROITool.toolName, rotulo: 'ROI à mão livre' },
];

/**
 * Padrão: esquerdo = passar cortes, direito = zoom, meio = pan, roda = passar cortes,
 * avançar (botão lateral) = distância. As escolhas do usuário (menu 🖱) vêm das preferências.
 */
const atribuicao: Record<Botao, string | null> = {
  esquerdo: StackScrollTool.toolName,
  direito: ZoomTool.toolName,
  meio: PanTool.toolName,
  roda: StackScrollTool.toolName,
  voltar: null,
  avancar: LengthTool.toolName,
};

for (const botao of ['direito', 'meio', 'roda', 'voltar', 'avancar'] as const) {
  const salvo = preferencias().mouse[botao];
  if (salvo !== undefined) atribuicao[botao] = salvo || null;
}

export type Predefinicao = Janela;

/** Janelas predefinidas (teclas 1 a 9 pela ordem); editáveis nas configurações. */
export function predefinicoes(): Predefinicao[] {
  return preferencias().janelas;
}

/** Tecla atual da ferramenta (a escolhida pelo usuário ou a padrão). */
export function teclaDaFerramenta(f: FerramentaPrimaria): string {
  return preferencias().atalhos[f.nome] ?? f.tecla;
}

let grupoCriado = false;
let modoMprAtivo = false;

/** Cria o grupo uma vez. Os viewports entram depois, cada um que for habilitado. */
function criarGrupoFerramentas(): void {
  if (grupoCriado) return;
  const grupo = ToolGroupManager.createToolGroup(ID_GRUPO);
  if (!grupo) throw new Error('Não foi possível criar o grupo de ferramentas.');
  for (const nome of TODAS_AS_FERRAMENTAS) {
    if (nome === CrosshairsTool.toolName) {
      grupo.addTool(nome, {
        getReferenceLineColor: (viewportId: string) => CORES_MPR[viewportId] ?? '#38bdf8',
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => true,
        referenceLinesCenterGapRadius: 6,
        centerPoint: {
          enabled: true,
          color: 'rgba(255, 255, 255, 0.9)',
          size: 3.5,
        },
        viewportIndicators: true,
      });
    } else if (nome === LengthTool.toolName) {
      grupo.addTool(nome, { getTextLines: textoDistancia });
    } else if (nome === AngleTool.toolName) {
      grupo.addTool(nome, { getTextLines: textoAngulo });
    } else if (nome === EllipticalROITool.toolName || nome === PlanarFreehandROITool.toolName) {
      grupo.addTool(nome, { getTextLines: textoRoi });
    } else {
      grupo.addTool(nome);
    }
  }
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
    if (nome === CrosshairsTool.toolName && !modoMprAtivo) {
      grupo.setToolDisabled(nome);
      continue;
    }
    const bindings = (Object.keys(atribuicao) as Botao[])
      .filter((b) => atribuicao[b] === nome)
      .map((b) => ({ mouseButton: BOTAO_DO_MOUSE[b] }));
    // setToolActive soma os botões novos aos antigos; sem limpar antes, uma ferramenta
    // que mudou de botão continuaria presa no anterior.
    grupo.setToolPassive(nome, { removeAllBindings: true });
    if (bindings.length > 0) grupo.setToolActive(nome, { bindings });
  }
}

/**
 * Liga ou desliga o CrosshairsTool ao entrar/sair do MPR.
 * No MPR as linhas ficam sempre visíveis (Active quando selecionada ou Passive durante medidas).
 */
export function definirModoMprFerramentas(ativo: boolean): void {
  modoMprAtivo = ativo;
  if (ativo) {
    atribuicao.esquerdo = CrosshairsTool.toolName;
    aplicarAtribuicoes();
    const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
    const inst = grupo?.getToolInstance(CrosshairsTool.toolName) as
      | { computeToolCenter?: () => void }
      | undefined;
    inst?.computeToolCenter?.();
  } else {
    if (atribuicao.esquerdo === CrosshairsTool.toolName) {
      atribuicao.esquerdo = StackScrollTool.toolName;
    }
    aplicarAtribuicoes();
  }
  document.dispatchEvent(new CustomEvent(EVENTO_BOTOES_MUDARAM));
}

export function emModoMprFerramentas(): boolean {
  return modoMprAtivo;
}

/** Disparado em `document` quando a ferramenta de algum botão do mouse muda (barra e atalhos). */
export const EVENTO_BOTOES_MUDARAM = 'botoesMudaram';

/** Escolhe a ferramenta de um botão. Vale mesmo antes do grupo existir. */
export function definirBotao(botao: Botao, nome: string): void {
  if (nome === CrosshairsTool.toolName && !modoMprAtivo) return;
  atribuicao[botao] = nome || null;
  if (botao !== 'esquerdo') {
    preferencias().mouse[botao] = nome;
    salvarPreferencias();
  }
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

export type Viewport2dOuVolume = Types.IStackViewport | Types.IVolumeViewport;

/** Viewport ativo da grade, se ele mostra alguma série. */
export async function viewportAtivo(): Promise<Viewport2dOuVolume | undefined> {
  if (!estado.pilhaAtiva || !estado.idViewportAtivo) return undefined;
  const motor = await iniciarCornerstone();
  return motor.getViewport(estado.idViewportAtivo) as Viewport2dOuVolume | undefined;
}

/** Todos os viewports habilitados no motor. */
async function obterViewportsHabilitados(): Promise<Viewport2dOuVolume[]> {
  const motor = await iniciarCornerstone();
  return motor.getViewports() as Viewport2dOuVolume[];
}

/** Ids de todos os viewports habilitados (os visíveis na grade). */
async function viewportsHabilitados(): Promise<string[]> {
  const vps = await obterViewportsHabilitados();
  return vps.map((v) => v.id);
}

/** Aplica uma ação ao viewport ativo (ou aos 3 planos quando `todosNoMpr` é verdadeiro). */
async function comViewport(
  acao: (v: Viewport2dOuVolume) => void,
  todosNoMpr = false,
): Promise<void> {
  if (modoMprAtivo && todosNoMpr) {
    const vps = await obterViewportsHabilitados();
    for (const v of vps) {
      acao(v);
      v.render();
    }
    return;
  }
  const v = await viewportAtivo();
  if (!v) return;
  acao(v);
  v.render();
}

export function inverter(): Promise<void> {
  return comViewport((v) => {
    const atual = v.getProperties()?.invert ?? false;
    v.setProperties({ invert: !atual });
  }, true);
}

// Rotação e espelhamento passam por setViewPresentation.
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

/** Volta janela, zoom, pan, rotação, espelhamento e crosshairs ao estado inicial. */
export async function restaurar(): Promise<void> {
  if (modoMprAtivo) {
    const grupo = ToolGroupManager.getToolGroup(ID_GRUPO);
    const inst = grupo?.getToolInstance(CrosshairsTool.toolName) as
      | { resetCrosshairs?: () => void }
      | undefined;
    inst?.resetCrosshairs?.();
  }
  await comViewport((v) => {
    v.resetProperties();
    v.resetCamera();
  }, true);
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
    if ('setImageIdIndex' in v) {
      void v.setImageIdIndex(posicao === 'primeiro' ? 0 : v.getImageIds().length - 1);
    } else {
      const total = v.getNumberOfSlices();
      const atual = v.getSliceIndex();
      const alvo = posicao === 'primeiro' ? 0 : Math.max(0, total - 1);
      if (alvo !== atual) v.scroll(alvo - atual);
    }
  });
}

export function aplicarPredefinicao(indice: number): Promise<void> {
  // PET com SUV: teclas 1 a 3 = janelas 0–5, 0–7 e 0–10 (em SUV).
  if (petEmSuv(estado.pilhaAtiva)) {
    const teto = TETOS_SUV[indice];
    if (teto === undefined) return Promise.resolve();
    return comViewport((v) => {
      v.setProperties({ voiRange: { lower: 0, upper: teto } });
    }, true);
  }
  const p = predefinicoes()[indice];
  if (!p) return Promise.resolve();
  return comViewport((v) => {
    v.setProperties({
      voiRange: { lower: p.centro - p.largura / 2, upper: p.centro + p.largura / 2 },
    });
  }, true);
}

/** Esc: cancela a medida em andamento, tira a seleção e volta à ferramenta padrão. */
export async function cancelar(): Promise<void> {
  const motor = await iniciarCornerstone();
  for (const v of motor.getViewports()) {
    if (v.element instanceof HTMLDivElement) cancelActiveManipulations(v.element);
  }
  annotation.selection.deselectAnnotation();
  escolherFerramentaPrimaria(modoMprAtivo ? CrosshairsTool.toolName : StackScrollTool.toolName);
  await redesenhar();
}

/** Delete: apaga as medidas selecionadas (exceto o crosshair do MPR). */
export async function apagarSelecionadas(): Promise<void> {
  const uids = annotation.selection.getAnnotationsSelected();
  if (uids.length === 0) return;
  for (const uid of uids) {
    const anot = annotation.state.getAnnotation(uid);
    if (anot?.metadata?.toolName === CrosshairsTool.toolName) continue;
    annotation.state.removeAnnotation(uid);
  }
  await redesenhar();
}

export async function limparMedidas(): Promise<void> {
  // Remove todas as anotações de ferramentas de medida, em qualquer corte, série ou viewport,
  // preservando os crosshairs do MPR.
  const nomes = new Set(FERRAMENTAS_PRIMARIAS.filter((f) => f.categoria === 'medida').map((f) => f.nome));
  annotation.selection.deselectAnnotation();
  for (const anot of annotation.state.getAllAnnotations()) {
    const nome = anot.metadata?.toolName;
    if (nome && nomes.has(nome) && anot.annotationUID) annotation.state.removeAnnotation(anot.annotationUID);
  }
  await redesenhar();
}

async function redesenhar(): Promise<void> {
  const ids = await viewportsHabilitados();
  if (ids.length > 0) utilities.triggerAnnotationRenderForViewportIds(ids);
}

/** Escolhe a ferramenta do botão esquerdo pela tecla de atalho. Devolve se achou. */
export function escolherFerramentaPorTecla(tecla: string): boolean {
  const f = FERRAMENTAS_PRIMARIAS.find((p) => teclaDaFerramenta(p) === tecla);
  if (!f) return false;
  if (f.apenasMpr && !modoMprAtivo) return false;
  escolherFerramentaPrimaria(f.nome);
  return true;
}
