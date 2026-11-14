/**
 * Viewport 3D (fase 8.1): renderização volumétrica do volume já carregado da série.
 * - Grupo de ferramentas próprio: esquerdo gira (trackball), direito e roda dão zoom, meio move.
 *   O giro já reduz a qualidade (distância de amostragem maior) enquanto o botão está apertado
 *   e volta à qualidade normal ao soltar (configuração `rotateSampleDistanceFactor`).
 * - Controles flutuantes: predefinição, opacidade, brilho e as seis vistas padrão.
 * - Fase 8.2: caixa de recorte (VolumeCroppingTool) com botão de restaurar, e clique num ponto
 *   do 3D leva os cortes 2D ao primeiro tecido visível na linha do clique (no MIP, ao mais intenso).
 */

import { CONSTANTS, Enums, type Types, utilities } from '@cornerstonejs/core';
import {
  Enums as EnumsTools,
  PanTool,
  ToolGroupManager,
  TrackballRotateTool,
  VolumeCroppingTool,
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

export { TrackballRotateTool, VolumeCroppingTool };

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
  // Recorte: a caixa começa no volume inteiro (0 vira o padrão de 10% na ferramenta).
  grupo.addTool(VolumeCroppingTool.toolName, {
    initialCropFactor: 0.0001,
    sphereRadius: 6,
    grabSpherePixelDistance: 14,
    rotateSampleDistanceFactor: FATOR_QUALIDADE_GIRANDO,
  });
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

// ---------- recorte (fase 8.2) ----------

/** Partes internas da VolumeCroppingTool usadas para restaurar (sem API pública para isso). */
interface EstadoRecorte {
  sphereStates: Array<{ uid: string }>;
  edgeLines: Record<string, unknown>;
  originalClippingPlanes: unknown[];
  setHandlesVisible(v: boolean): void;
  _getViewportsInfo(): unknown[];
  _initialize3DViewports(info: unknown[]): void;
}

let recorteLigado = false;

function ferramentaRecorte(): EstadoRecorte | undefined {
  return ToolGroupManager.getToolGroup(ID_GRUPO_3D)?.getToolInstance(VolumeCroppingTool.toolName) as unknown as
    | EstadoRecorte
    | undefined;
}

function mapperDo(vp: Types.IVolumeViewport): { removeAllClippingPlanes?: () => void } | undefined {
  const ator = vp.getDefaultActor()?.actor as { getMapper?: () => { removeAllClippingPlanes?: () => void } } | undefined;
  return ator?.getMapper?.();
}

/**
 * Liga o modo de recorte: o botão esquerdo passa a ser da caixa (arrastar as esferas corta;
 * arrastar fora delas gira; Shift + arrastar inclina os planos). Desligar mantém o recorte.
 */
export function definirModoRecorte(ligado: boolean): void {
  const grupo = ToolGroupManager.getToolGroup(ID_GRUPO_3D);
  if (!grupo || ligado === recorteLigado) return;
  recorteLigado = ligado;
  const primario = [{ mouseButton: EnumsTools.MouseBindings.Primary }];
  if (ligado) {
    grupo.setToolPassive(TrackballRotateTool.toolName, { removeAllBindings: true });
    grupo.setToolActive(VolumeCroppingTool.toolName, { bindings: primario });
    ferramentaRecorte()?.setHandlesVisible(true);
  } else {
    try {
      ferramentaRecorte()?.setHandlesVisible(false);
    } catch {
      /* viewport já desligado */
    }
    grupo.setToolPassive(VolumeCroppingTool.toolName, { removeAllBindings: true });
    grupo.setToolActive(TrackballRotateTool.toolName, { bindings: primario });
  }
}

export function modoRecorteLigado(): boolean {
  return recorteLigado;
}

/** Tira o recorte: volume inteiro de novo (e caixa no volume inteiro, se o modo estiver ligado). */
export function restaurarRecorte(vp: Types.IVolumeViewport): void {
  const f = ferramentaRecorte();
  if (f) {
    const uids = [...f.sphereStates.map((x) => x.uid), ...Object.keys(f.edgeLines)];
    if (uids.length) vp.removeActors(uids);
    f.sphereStates = [];
    f.edgeLines = {};
    f.originalClippingPlanes = [];
  }
  mapperDo(vp)?.removeAllClippingPlanes?.();
  if (f && recorteLigado) {
    f._initialize3DViewports(f._getViewportsInfo());
    f.setHandlesVisible(true);
  }
  vp.render();
}

/** Ao fechar o 3D: volta o botão esquerdo a girar e esquece a caixa (o próximo 3D começa limpo). */
function encerrarRecorte(): void {
  definirModoRecorte(false);
  const f = ferramentaRecorte();
  if (f) {
    f.sphereStates = [];
    f.edgeLines = {};
    f.originalClippingPlanes = [];
  }
}

// ---------- clique leva os cortes ao ponto (fase 8.2) ----------

/** Opacidade (da predefinição) a partir da qual o tecido conta como "visível" no clique. */
const LIMIAR_VISIVEL = 0.05;

interface AtorVolume {
  getBounds(): number[];
  getProperty(): { getScalarOpacity(i: number): { getValue(x: number): number } };
  getMapper(): {
    getBlendMode?: () => number;
    getSampleDistance?: () => number;
    getClippingPlanes?: () => Array<{ getNormal(): number[]; getOrigin(): number[] }>;
  };
}

/**
 * Ponto do volume sob o clique: anda pela linha de visão (da frente para trás) e devolve o
 * primeiro ponto cujo valor tem opacidade visível na predefinição atual; no MIP, o mais intenso.
 * Respeita o recorte. `amostrar` dá o valor (HU ou SUV) num ponto do mundo.
 */
export function pontoVisivelNoClique(
  vp: Types.IVolumeViewport,
  canvas: [number, number],
  amostrar: (p: Types.Point3) => number | undefined,
): Types.Point3 | undefined {
  const ator = vp.getDefaultActor()?.actor as unknown as AtorVolume | undefined;
  if (!ator?.getBounds) return undefined;
  const b = ator.getBounds();
  const ofun = ator.getProperty().getScalarOpacity(0);
  const mapper = ator.getMapper();
  const mip = mapper.getBlendMode?.() === Enums.BlendModes.MAXIMUM_INTENSITY_BLEND;
  const planos = (mapper.getClippingPlanes?.() ?? []).map((pl) => ({ n: pl.getNormal(), o: pl.getOrigin() }));
  const cam = vp.getCamera();
  const p0 = vp.canvasToWorld(canvas);
  let dir: number[];
  if (cam.parallelProjection === false && cam.position) {
    dir = [p0[0] - cam.position[0], p0[1] - cam.position[1], p0[2] - cam.position[2]];
  } else {
    const n = cam.viewPlaneNormal ?? [0, -1, 0];
    dir = [-n[0], -n[1], -n[2]];
  }
  const tam = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1;
  dir = dir.map((x) => x / tam);
  // Trecho da linha dentro da caixa do volume (método das placas).
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const lo = b[2 * i]!;
    const hi = b[2 * i + 1]!;
    if (Math.abs(dir[i]!) < 1e-9) {
      if (p0[i]! < lo || p0[i]! > hi) return undefined;
      continue;
    }
    const a = (lo - p0[i]!) / dir[i]!;
    const c = (hi - p0[i]!) / dir[i]!;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  }
  if (!(t0 <= t1)) return undefined;
  const passo = Math.max(0.25, (mapper.getSampleDistance?.() ?? 1) / 2);
  let melhor: Types.Point3 | undefined;
  let maior = -Infinity;
  for (let t = t0; t <= t1; t += passo) {
    const p: Types.Point3 = [p0[0] + t * dir[0]!, p0[1] + t * dir[1]!, p0[2] + t * dir[2]!];
    if (planos.some(({ n, o }) => (p[0] - o[0]!) * n[0]! + (p[1] - o[1]!) * n[1]! + (p[2] - o[2]!) * n[2]! < 0)) continue;
    const v = amostrar(p);
    if (v === undefined) continue;
    if (mip) {
      if (v > maior) {
        maior = v;
        melhor = p;
      }
    } else if (ofun.getValue(v) >= LIMIAR_VISIVEL) {
      return p;
    }
  }
  return melhor;
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
  /** Clique simples (sem arrastar) no 3D, fora do modo de recorte: posição no canvas. */
  aoClicar?(canvas: [number, number]): void;
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

  const botaoRecorte = document.createElement('button');
  botaoRecorte.type = 'button';
  botaoRecorte.textContent = '✂ Recortar';
  botaoRecorte.title =
    'Caixa de recorte: arraste as esferas para cortar; arrastar fora delas gira; Shift + arrastar inclina. Clique de novo para concluir';
  const atualizarBotaoRecorte = (): void => {
    botaoRecorte.setAttribute('aria-pressed', String(recorteLigado));
    botaoRecorte.textContent = recorteLigado ? '✂ Concluir' : '✂ Recortar';
  };
  botaoRecorte.addEventListener('click', () => {
    definirModoRecorte(!recorteLigado);
    atualizarBotaoRecorte();
  });
  const botaoRestaurar = document.createElement('button');
  botaoRestaurar.type = 'button';
  botaoRestaurar.textContent = '↺';
  botaoRestaurar.title = 'Restaurar o recorte (volume inteiro)';
  botaoRestaurar.setAttribute('aria-label', 'Restaurar o recorte');
  botaoRestaurar.addEventListener('click', () => {
    const v = opcoes.obterViewport();
    if (v) restaurarRecorte(v);
  });
  const recorte = document.createElement('div');
  recorte.className = 'vistas-3d';
  recorte.append(botaoRecorte, botaoRestaurar);
  atualizarBotaoRecorte();

  painel.append(
    seletor,
    deslizante('Opacidade', 'opacidade', 10, 200),
    deslizante('Brilho', 'brilho', 30, 200),
    vistas,
    recorte,
  );
  opcoes.contentor.append(painel);

  // Clique simples (sem arrastar) leva os cortes 2D ao ponto; arrastar continua girando.
  let inicio: { x: number; y: number; t: number } | null = null;
  const elemento = vp?.element;
  const aoApertar = (e: PointerEvent): void => {
    inicio = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
  };
  const aoSoltar = (e: PointerEvent): void => {
    const i = inicio;
    inicio = null;
    if (!i || e.button !== 0 || recorteLigado || !opcoes.aoClicar || !elemento) return;
    if (Math.hypot(e.clientX - i.x, e.clientY - i.y) > 4 || performance.now() - i.t > 500) return;
    const r = elemento.getBoundingClientRect();
    opcoes.aoClicar([e.clientX - r.left, e.clientY - r.top]);
  };
  elemento?.addEventListener('pointerdown', aoApertar, true);
  elemento?.addEventListener('pointerup', aoSoltar, true);

  aplicar();
  if (vp) aplicarVista3d(vp, 'A');

  return {
    destruir() {
      painel.remove();
      elemento?.removeEventListener('pointerdown', aoApertar, true);
      elemento?.removeEventListener('pointerup', aoSoltar, true);
      encerrarRecorte();
    },
  };
}
