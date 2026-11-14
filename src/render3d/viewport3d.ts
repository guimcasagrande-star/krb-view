/**
 * Viewport 3D (fase 8.1): renderização volumétrica do volume já carregado da série.
 * - Grupo de ferramentas próprio: esquerdo gira (trackball), direito e roda dão zoom, meio move.
 *   O giro já reduz a qualidade (distância de amostragem maior) enquanto o botão está apertado
 *   e volta à qualidade normal ao soltar (configuração `rotateSampleDistanceFactor`).
 * - Controles flutuantes: predefinição, opacidade, brilho e as seis vistas padrão.
 */

import { CONSTANTS, Enums, type Types, utilities } from '@cornerstonejs/core';
import {
  Enums as EnumsTools,
  PanTool,
  ToolGroupManager,
  TrackballRotateTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { ID_MOTOR } from '../viewer/iniciar';
import {
  ajustarPreset,
  type Modalidade3d,
  type Preset3d,
  predefinicaoPadrao,
  predefinicoesDa,
  PRESETS_PROPRIOS,
  VISTAS_3D,
  type Vista3d,
} from './predefinicoes3d';

export { TrackballRotateTool };

export const ID_GRUPO_3D = 'grupo-3d';

/** Quanto a distância de amostragem cresce enquanto gira (2 = metade das amostras por raio). */
const FATOR_QUALIDADE_GIRANDO = 2;

let grupoCriado = false;

function criarGrupo3d(): void {
  if (grupoCriado) return;
  const grupo = ToolGroupManager.createToolGroup(ID_GRUPO_3D);
  if (!grupo) throw new Error('Não foi possível criar o grupo de ferramentas do 3D.');
  grupo.addTool(TrackballRotateTool.toolName, { rotateSampleDistanceFactor: FATOR_QUALIDADE_GIRANDO });
  grupo.addTool(ZoomTool.toolName);
  grupo.addTool(PanTool.toolName);
  grupo.setToolActive(TrackballRotateTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Primary }],
  });
  grupo.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Secondary }, { mouseButton: EnumsTools.MouseBindings.Wheel }],
  });
  grupo.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: EnumsTools.MouseBindings.Auxiliary }],
  });
  grupoCriado = true;
}

export function adicionarAoGrupo3d(idViewport: string): void {
  criarGrupo3d();
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO_3D);
  if (grupo && !grupo.getViewportIds().includes(idViewport)) grupo.addViewport(idViewport, ID_MOTOR);
}

export function removerDoGrupo3d(idViewport: string): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO_3D);
  if (grupo?.getViewportIds().includes(idViewport)) grupo.removeViewports(ID_MOTOR, idViewport);
}

function presetPeloNome(nome: string): Preset3d | undefined {
  return [...PRESETS_PROPRIOS, ...(CONSTANTS.VIEWPORT_PRESETS as Preset3d[])].find((p) => p.name === nome);
}

/** Centro do volume em coordenadas do paciente (pelos limites do ator). */
function centroDoVolume(vp: Types.IVolumeViewport): Types.Point3 {
  const ator = vp.getDefaultActor()?.actor as { getBounds?: () => number[] } | undefined;
  const limites = ator?.getBounds?.();
  if (limites && limites.length === 6 && limites.every(Number.isFinite)) {
    return [(limites[0]! + limites[1]!) / 2, (limites[2]! + limites[3]!) / 2, (limites[4]! + limites[5]!) / 2];
  }
  const cam = vp.getCamera();
  return cam.focalPoint ? [...cam.focalPoint] : [0, 0, 0];
}

/** Põe a câmera numa das seis vistas padrão, centrada no volume e com o zoom de enquadrar. */
export function aplicarVista3d(vp: Types.IVolumeViewport, vista: Vista3d): void {
  const { normal, cima } = VISTAS_3D[vista];
  const centro = centroDoVolume(vp);
  const cam = vp.getCamera();
  const fp = cam.focalPoint ?? centro;
  const pos = cam.position ?? [fp[0], fp[1] - 500, fp[2]];
  const dist = Math.hypot(pos[0] - fp[0], pos[1] - fp[1], pos[2] - fp[2]) || 500;
  vp.setCamera({
    focalPoint: centro,
    position: [centro[0] + dist * normal[0], centro[1] + dist * normal[1], centro[2] + dist * normal[2]],
    viewPlaneNormal: normal,
    viewUp: cima,
  });
  vp.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
  vp.render();
}

export interface Controlador3d {
  destruir(): void;
}

export interface Opcoes3d {
  /** Onde ficam os controles flutuantes (a célula do viewport). */
  contentor: HTMLElement;
  modalidade: Modalidade3d;
  obterViewport(): Types.IVolumeViewport | undefined;
  /** Chamado quando a predefinição muda (para o overlay mostrar o nome). */
  aoMudar?(rotulo: string): void;
}

/** Estado dos ajustes de cada viewport 3D, para mantê-los ao trocar de layout. */
const ajustes = new Map<string, { id: string; opacidade: number; brilho: number }>();

/** Rótulo da predefinição em uso num viewport 3D (para o overlay). */
export function rotuloPredefinicao3d(idViewport: string, modalidade: Modalidade3d): string {
  const id = ajustes.get(idViewport)?.id;
  return (predefinicoesDa(modalidade).find((p) => p.id === id) ?? predefinicaoPadrao(modalidade)).rotulo;
}

/** Aplica predefinição e ajustes ao viewport, cria os controles e põe na vista anterior. */
export function montar3d(opcoes: Opcoes3d): Controlador3d {
  const vp = opcoes.obterViewport();
  const lista = predefinicoesDa(opcoes.modalidade);
  const idVp = vp?.id ?? '';
  let estado = ajustes.get(idVp);
  if (!estado || !lista.some((p) => p.id === estado!.id)) {
    estado = { id: predefinicaoPadrao(opcoes.modalidade).id, opacidade: 1, brilho: 1 };
    ajustes.set(idVp, estado);
  }
  const e = estado;

  const aplicar = (): void => {
    const v = opcoes.obterViewport();
    const p = lista.find((x) => x.id === e.id);
    const base = p ? presetPeloNome(p.preset) : undefined;
    if (!v || !base || !p) return;
    const ator = v.getDefaultActor()?.actor;
    if (!ator) return;
    utilities.applyPreset(ator as Parameters<typeof utilities.applyPreset>[0], ajustarPreset(base, e.opacidade, e.brilho));
    // O setBlendMode do viewport 3D do Cornerstone não faz nada; o modo vai direto no mapper
    // (cada viewport tem o seu; só a textura do volume é compartilhada).
    const mapper = (ator as { getMapper?: () => { setBlendMode?: (m: number) => void } }).getMapper?.();
    mapper?.setBlendMode?.(p.mip ? Enums.BlendModes.MAXIMUM_INTENSITY_BLEND : Enums.BlendModes.COMPOSITE);
    v.render();
    opcoes.aoMudar?.(p.rotulo);
  };

  const painel = document.createElement('div');
  painel.className = 'controles-3d';
  // Os controles não devem girar o volume nem ativar ferramentas.
  for (const ev of ['mousedown', 'pointerdown', 'wheel', 'dblclick', 'contextmenu'] as const) {
    painel.addEventListener(ev, (x) => x.stopPropagation());
  }

  const seletor = document.createElement('select');
  seletor.setAttribute('aria-label', 'Predefinição do 3D');
  seletor.title = 'Predefinição da renderização 3D';
  for (const p of lista) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.rotulo;
    seletor.append(o);
  }
  seletor.value = e.id;
  seletor.addEventListener('change', () => {
    e.id = seletor.value;
    aplicar();
  });

  const deslizante = (rotulo: string, chave: 'opacidade' | 'brilho', min: number, max: number): HTMLLabelElement => {
    const l = document.createElement('label');
    l.className = 'ajuste-3d';
    l.title = `${rotulo} (duplo clique volta a 100%)`;
    const t = document.createElement('span');
    t.textContent = rotulo;
    const r = document.createElement('input');
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = '5';
    r.value = String(Math.round(e[chave] * 100));
    r.setAttribute('aria-label', rotulo);
    const v = document.createElement('span');
    v.className = 'valor-3d';
    const mostrar = (): void => {
      v.textContent = `${r.value}%`;
    };
    mostrar();
    r.addEventListener('input', () => {
      e[chave] = Number(r.value) / 100;
      mostrar();
      aplicar();
    });
    r.addEventListener('dblclick', () => {
      r.value = '100';
      e[chave] = 1;
      mostrar();
      aplicar();
    });
    l.append(t, r, v);
    return l;
  };

  const vistas = document.createElement('div');
  vistas.className = 'vistas-3d';
  for (const k of Object.keys(VISTAS_3D) as Vista3d[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k;
    b.title = `Vista ${VISTAS_3D[k].rotulo.toLowerCase()}`;
    b.addEventListener('click', () => {
      const v = opcoes.obterViewport();
      if (v) aplicarVista3d(v, k);
    });
    vistas.append(b);
  }

  painel.append(seletor, deslizante('Opacidade', 'opacidade', 10, 200), deslizante('Brilho', 'brilho', 30, 200), vistas);
  opcoes.contentor.append(painel);

  aplicar();
  if (vp) aplicarVista3d(vp, 'A');

  return {
    destruir() {
      painel.remove();
    },
  };
}
