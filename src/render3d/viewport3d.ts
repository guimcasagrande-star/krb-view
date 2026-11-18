/**
 * Viewport 3D (fase 8.1): renderização volumétrica do volume já carregado da série.
 * - Grupo de ferramentas próprio: esquerdo gira (trackball), direito e roda dão zoom, meio move.
 *   O giro já reduz a qualidade (distância de amostragem maior) enquanto o botão está apertado
 *   e volta à qualidade normal ao soltar (configuração `rotateSampleDistanceFactor`).
 * - Controles flutuantes: predefinição, opacidade, brilho e as seis vistas padrão.
 * - Fase 8.2: caixa de recorte (VolumeCroppingTool) com botão de restaurar, e clique num ponto
 *   do 3D leva os cortes 2D ao primeiro tecido visível na linha do clique (no MIP, ao mais intenso).
 */

import { cache, CONSTANTS, Enums, type Types, utilities } from '@cornerstonejs/core';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import {
  Enums as EnumsTools,
  PanTool,
  ToolGroupManager,
  TrackballRotateTool,
  VolumeCroppingTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import { gridFromVolumeProps } from '../io/geometry';
import {
  EVENTO_PREFERENCIAS,
  preferencias,
  salvarPreferencias,
  type Qualidade3d,
} from '../state/preferencias';
import { ID_MOTOR } from '../viewer/iniciar';
import {
  definirModoExibicao3d,
  definirVerificadorViewport3d,
  EVENTO_SEGMENTACAO,
  EVENTO_SUPERFICIE_3D,
  modoExibicao3d,
  temEdicaoMascaraPendente,
  type ModoExibicao3d,
} from '../segmentation/segmentacao';
import {
  restaurarMascara3d,
  type BufferVolumeEditavel,
  type DiffMascara3d,
  type ProjeccaoCamera3d,
} from './mascara3d';
import {
  limparSuperficiesViewport,
  sincronizarSuperficies3d,
  temViewport3dAtivo,
} from './superficies3d';
import { filtrarMascara3dNoWorker, recortarTesoura3dNoWorker } from '../workers/computeClient';
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

const PERFIS_QUALIDADE_3D: Record<
  Qualidade3d,
  {
    rotulo: string;
    dica: string;
    sampleDistanceMm: number;
    maxSamplesPerRay: number;
    fatorGiro: number;
    desligarGradienteNoGiro: boolean;
  }
> = {
  desempenho: {
    rotulo: '⚡ Desempenho',
    dica: 'Máxima fluidez (ideal para notebooks e placas integradas)',
    sampleDistanceMm: 1.9,
    maxSamplesPerRay: 1400,
    fatorGiro: 4.5,
    desligarGradienteNoGiro: true,
  },
  equilibrado: {
    rotulo: 'Equilibrado',
    dica: 'Equilíbrio entre nitidez parado e fluidez ao girar',
    sampleDistanceMm: 1.0,
    maxSamplesPerRay: 2600,
    fatorGiro: 3.2,
    desligarGradienteNoGiro: true,
  },
  alta: {
    rotulo: 'Alta resolução',
    dica: 'Máximo detalhe volumétrico (recomendado com GPU dedicada)',
    sampleDistanceMm: 0.5,
    maxSamplesPerRay: 4500,
    fatorGiro: 2.0,
    desligarGradienteNoGiro: false,
  },
};

function calibrarProjeccaoCamera(vp: Types.IVolumeViewport): ProjeccaoCamera3d | null {
  const cam = vp.getCamera();
  const fp = cam.focalPoint;
  if (!fp) return null;
  const c0 = vp.worldToCanvas([fp[0], fp[1], fp[2]]);
  const passo = 100;
  const cx = vp.worldToCanvas([fp[0] + passo, fp[1], fp[2]]);
  const cy = vp.worldToCanvas([fp[0], fp[1] + passo, fp[2]]);
  const cz = vp.worldToCanvas([fp[0], fp[1], fp[2] + passo]);
  const proj: ProjeccaoCamera3d = {
    focalPoint: [fp[0], fp[1], fp[2]],
    canvasFocal: [c0[0], c0[1]],
    eixoX: [(cx[0] - c0[0]) / passo, (cx[1] - c0[1]) / passo],
    eixoY: [(cy[0] - c0[0]) / passo, (cy[1] - c0[1]) / passo],
    eixoZ: [(cz[0] - c0[0]) / passo, (cz[1] - c0[1]) / passo],
  };
  if (cam.parallelProjection === false && cam.position && cam.viewPlaneNormal) {
    proj.perspectiva = {
      eye: [cam.position[0], cam.position[1], cam.position[2]],
      normal: [cam.viewPlaneNormal[0], cam.viewPlaneNormal[1], cam.viewPlaneNormal[2]],
    };
  }
  return proj;
}

let grupoCriado = false;

function criarGrupo3d(): void {
  if (grupoCriado) return;
  const grupo = ToolGroupManager.createToolGroup(ID_GRUPO_3D);
  if (!grupo) throw new Error('Não foi possível criar o grupo de ferramentas do 3D.');
  const fatorInicial = PERFIS_QUALIDADE_3D[preferencias().qualidade3d].fatorGiro;
  grupo.addTool(TrackballRotateTool.toolName, { rotateSampleDistanceFactor: fatorInicial });
  grupo.addTool(ZoomTool.toolName);
  grupo.addTool(PanTool.toolName);
  // Recorte: a caixa começa no volume inteiro (0 vira o padrão de 10% na ferramenta).
  grupo.addTool(VolumeCroppingTool.toolName, {
    initialCropFactor: 0.0001,
    sphereRadius: 6,
    grabSpherePixelDistance: 14,
    rotateSampleDistanceFactor: fatorInicial,
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
  getVisibility?(): boolean;
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
  if (!ator?.getBounds || ator.getVisibility?.() === false) return undefined;
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
  /** Série mostrada neste viewport 3D (para sobrepor superfícies dos segmentos). */
  obterPilhaId?: () => string | undefined;
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

  let girandoInterativo = false;
  let gradienteHabilitadoNoPreset = true;

  const aplicarQualidadeAtual = (v: Types.IVolumeViewport | undefined): void => {
    const perfil = PERFIS_QUALIDADE_3D[preferencias().qualidade3d];
    const grupo = ToolGroupManager.getToolGroup(ID_GRUPO_3D);
    if (grupo) {
      grupo.setToolConfiguration(TrackballRotateTool.toolName, {
        rotateSampleDistanceFactor: perfil.fatorGiro,
      });
      grupo.setToolConfiguration(VolumeCroppingTool.toolName, {
        rotateSampleDistanceFactor: perfil.fatorGiro,
      });
    }
    if (!v) return;
    const ator = v.getDefaultActor()?.actor as
      | {
          getMapper?: () => {
            setSampleDistance?: (d: number) => void;
            setMaximumSamplesPerRay?: (n: number) => void;
          };
          getProperty?: () => {
            setUseGradientOpacity?: (i: number, u: boolean) => void;
          };
        }
      | undefined;
    const mapper = ator?.getMapper?.();
    mapper?.setSampleDistance?.(perfil.sampleDistanceMm);
    mapper?.setMaximumSamplesPerRay?.(perfil.maxSamplesPerRay);
    if (mapperFiltradoCache) {
      mapperFiltradoCache.setSampleDistance(perfil.sampleDistanceMm);
      mapperFiltradoCache.setMaximumSamplesPerRay(perfil.maxSamplesPerRay);
    }
    const prop = ator?.getProperty?.();
    const usarGradiente =
      gradienteHabilitadoNoPreset &&
      preferencias().qualidade3d !== 'desempenho' &&
      !(girandoInterativo && perfil.desligarGradienteNoGiro);
    prop?.setUseGradientOpacity?.(0, usarGradiente);
  };

  const aplicar = (): void => {
    const v = opcoes.obterViewport();
    const p = lista.find((x) => x.id === e.id);
    const base = p ? presetPeloNome(p.preset) : undefined;
    if (!v || !base || !p) return;
    const ator = v.getDefaultActor()?.actor;
    if (!ator) return;
    utilities.applyPreset(ator as Parameters<typeof utilities.applyPreset>[0], ajustarPreset(base, e.opacidade, e.brilho));
    const prop = (
      ator as {
        getProperty?: () => {
          setScalarOpacityUnitDistance?: (i: number, d: number) => void;
          setUseGradientOpacity?: (i: number, u: boolean) => void;
        };
      }
    ).getProperty?.();
    prop?.setScalarOpacityUnitDistance?.(0, base.scalarOpacityUnitDistance ?? 1.0);
    gradienteHabilitadoNoPreset = base.gradientOpacity.trim() !== '4 0 1 255 1';
    if (!gradienteHabilitadoNoPreset) {
      prop?.setUseGradientOpacity?.(0, false);
    }
    // O setBlendMode do viewport 3D do Cornerstone não faz nada; o modo vai direto no mapper
    // (cada viewport tem o seu; só a textura do volume é compartilhada).
    const mapper = (ator as { getMapper?: () => { setBlendMode?: (m: number) => void } }).getMapper?.();
    mapper?.setBlendMode?.(p.mip ? Enums.BlendModes.MAXIMUM_INTENSITY_BLEND : Enums.BlendModes.COMPOSITE);
    aplicarQualidadeAtual(v);
    v.render();
    opcoes.aoMudar?.(p.rotulo);
  };

  let rafAplicar = 0;
  const agendarAplicar = (): void => {
    if (rafAplicar) return;
    rafAplicar = requestAnimationFrame(() => {
      rafAplicar = 0;
      aplicar();
    });
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
      agendarAplicar();
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

  const seletorQualidade = document.createElement('select');
  seletorQualidade.setAttribute('aria-label', 'Fluidez e resolução do 3D');
  seletorQualidade.title = 'Ajustar fluidez vs resolução do 3D (útil para notebooks sem placa dedicada)';
  for (const k of ['desempenho', 'equilibrado', 'alta'] as const) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = PERFIS_QUALIDADE_3D[k].rotulo;
    o.title = PERFIS_QUALIDADE_3D[k].dica;
    seletorQualidade.append(o);
  }
  seletorQualidade.value = preferencias().qualidade3d;
  seletorQualidade.addEventListener('change', () => {
    preferencias().qualidade3d = seletorQualidade.value as Qualidade3d;
    salvarPreferencias();
    const v = opcoes.obterViewport();
    aplicarQualidadeAtual(v);
    v?.render();
  });

  let tesouraLigada = false;
  const historicoTesoura: DiffMascara3d[] = [];
  let voxelsTrabalhoAtual: Int16Array | Float32Array | null = null;

  const canvasTesoura = document.createElement('canvas');
  canvasTesoura.className = 'canvas-tesoura-3d';
  canvasTesoura.hidden = true;

  const popupTesoura = document.createElement('div');
  popupTesoura.className = 'popup-tesoura-3d';
  popupTesoura.hidden = true;
  for (const ev of ['mousedown', 'pointerdown', 'wheel', 'dblclick', 'contextmenu'] as const) {
    popupTesoura.addEventListener(ev, (x) => x.stopPropagation());
  }

  let lacoPendente: Array<[number, number]> | null = null;

  const limparDesenhoTesoura = (): void => {
    lacoPendente = null;
    popupTesoura.hidden = true;
    const ctx = canvasTesoura.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvasTesoura.width, canvasTesoura.height);
  };

  const sincronizarBotaoEsquerdo3d = (): void => {
    const grupo = ToolGroupManager.getToolGroup(ID_GRUPO_3D);
    if (!grupo) return;
    const primario = [{ mouseButton: EnumsTools.MouseBindings.Primary }];
    if (tesouraLigada) {
      grupo.setToolPassive(TrackballRotateTool.toolName, { removeAllBindings: true });
      grupo.setToolPassive(VolumeCroppingTool.toolName, { removeAllBindings: true });
    } else if (recorteLigado) {
      grupo.setToolPassive(TrackballRotateTool.toolName, { removeAllBindings: true });
      grupo.setToolActive(VolumeCroppingTool.toolName, { bindings: primario });
    } else {
      grupo.setToolPassive(VolumeCroppingTool.toolName, { removeAllBindings: true });
      grupo.setToolActive(TrackballRotateTool.toolName, { bindings: primario });
    }
  };

  const botaoTesoura = document.createElement('button');
  botaoTesoura.type = 'button';
  botaoTesoura.textContent = '✂ Tesoura';
  botaoTesoura.title =
    'Tesoura 3D (laço livre): desenhe com o mouse ao redor da região e escolha Apagar dentro ou Apagar fora (botão direito continua dando zoom e botão do meio move)';

  const botaoRecorte = document.createElement('button');
  botaoRecorte.type = 'button';
  botaoRecorte.textContent = '☐ Caixa';
  botaoRecorte.title =
    'Caixa de recorte: arraste as esferas para cortar; arrastar fora delas gira; Shift + arrastar inclina. Clique de novo para concluir';

  const botaoDesfazerTesoura = document.createElement('button');
  botaoDesfazerTesoura.type = 'button';
  botaoDesfazerTesoura.textContent = '↶';
  botaoDesfazerTesoura.title = 'Desfazer último recorte da Tesoura 3D (Ctrl+Z)';
  botaoDesfazerTesoura.disabled = true;

  const atualizarBotoesRecorte = (): void => {
    botaoTesoura.setAttribute('aria-pressed', String(tesouraLigada));
    botaoRecorte.setAttribute('aria-pressed', String(recorteLigado));
    botaoRecorte.textContent = recorteLigado ? '☐ Concluir' : '☐ Caixa';
    botaoDesfazerTesoura.disabled = historicoTesoura.length === 0;
    canvasTesoura.hidden = !tesouraLigada;
    if (!tesouraLigada) limparDesenhoTesoura();
  };

  botaoTesoura.addEventListener('click', () => {
    tesouraLigada = !tesouraLigada;
    if (tesouraLigada && recorteLigado) {
      definirModoRecorte(false);
    }
    sincronizarBotaoEsquerdo3d();
    atualizarBotoesRecorte();
  });

  botaoRecorte.addEventListener('click', () => {
    if (tesouraLigada) {
      tesouraLigada = false;
    }
    definirModoRecorte(!recorteLigado);
    sincronizarBotaoEsquerdo3d();
    atualizarBotoesRecorte();
  });

  const botaoRestaurar = document.createElement('button');
  botaoRestaurar.type = 'button';
  botaoRestaurar.textContent = '↺';
  botaoRestaurar.title = 'Restaurar todos os recortes (Tesoura 3D e Caixa) para o volume inteiro';
  botaoRestaurar.setAttribute('aria-label', 'Restaurar o recorte');
  const recorte = document.createElement('div');
  recorte.className = 'vistas-3d';
  recorte.append(botaoTesoura, botaoRecorte, botaoDesfazerTesoura, botaoRestaurar);
  atualizarBotoesRecorte();

  let semMesaAtivo = false;
  let semOssoAtivo = false;
  let baseVoxelsCache: Float32Array | Int16Array | null = null;
  let imageDataOriginalCache: vtkImageData | null = null;
  let mapperOriginalCache: unknown = null;
  let imageDataFiltradoCache: vtkImageData | null = null;
  let mapperFiltradoCache: vtkVolumeMapper | null = null;

  const prepararOrigemVolume = (
    v: Types.IVolumeViewport | undefined,
  ): {
    ator: { getMapper(): unknown; setMapper(m: unknown): void };
    mapperOriginal: {
      getInputData(): vtkImageData;
      getBlendMode?(): number;
      getSampleDistance?(): number;
      getClippingPlanes?(): unknown[];
      modified?(): void;
    };
    imageDataOriginal: vtkImageData;
    baseVoxels: Float32Array | Int16Array;
    dims: [number, number, number];
  } | null => {
    if (!v) return null;
    const entry = v.getDefaultActor();
    const ator = entry?.actor as { getMapper?: () => unknown; setMapper?: (m: unknown) => void } | undefined;
    if (!ator?.getMapper || !ator?.setMapper) return null;

    if (!mapperOriginalCache) {
      mapperOriginalCache = ator.getMapper();
    }
    const mapperOriginal = mapperOriginalCache as {
      getInputData(): vtkImageData;
      getBlendMode?(): number;
      getSampleDistance?(): number;
      getClippingPlanes?(): unknown[];
      modified?(): void;
    };
    if (!imageDataOriginalCache) {
      imageDataOriginalCache = mapperOriginal.getInputData?.() ?? null;
    }
    const imageDataOriginal = imageDataOriginalCache;
    if (!imageDataOriginal) return null;

    if (!baseVoxelsCache) {
      const volumeId = (v as { getVolumeId?: () => string }).getVolumeId?.() ?? entry?.uid ?? entry?.referencedId;
      const csVol = volumeId ? cache.getVolume(volumeId) : undefined;
      const vm = csVol?.voxelManager;
      const vmArray = vm?.getCompleteScalarDataArray?.() as Float32Array | Int16Array | undefined;
      const fallbackArray = imageDataOriginal.getPointData?.()?.getScalars?.()?.getData?.() as
        | Float32Array
        | Int16Array
        | undefined;
      const origem = vmArray && vmArray.length > 0 ? vmArray : fallbackArray;
      if (!origem || origem.length === 0) return null;
      baseVoxelsCache = origem.slice() as Float32Array | Int16Array;
    }

    const d = imageDataOriginal.getDimensions();
    if (!d || d.length < 3) return null;
    return {
      ator: ator as { getMapper(): unknown; setMapper(m: unknown): void },
      mapperOriginal,
      imageDataOriginal,
      baseVoxels: baseVoxelsCache,
      dims: [d[0]!, d[1]!, d[2]!],
    };
  };

  const botaoSemMesa = document.createElement('button');
  botaoSemMesa.type = 'button';
  botaoSemMesa.textContent = 'Sem mesa';
  botaoSemMesa.title = 'Ocultar a mesa e suportes externos do tomógrafo no 3D';
  botaoSemMesa.setAttribute('aria-pressed', 'false');

  const botaoSemOsso = document.createElement('button');
  botaoSemOsso.type = 'button';
  botaoSemOsso.textContent = 'Sem osso';
  botaoSemOsso.title = 'Ocultar estruturas ósseas preservando vasos contrastados no 3D';
  botaoSemOsso.setAttribute('aria-pressed', 'false');

  let geracaoFiltro = 0;
  let destruido = false;

  const valorVazioModalidade = opcoes.modalidade === 'CT' ? -1000 : 0;

  const atualizarMapperComVoxels = (
    info: NonNullable<ReturnType<typeof prepararOrigemVolume>>,
    vpAtual: Types.IVolumeViewport,
    trabalho: Int16Array | Float32Array,
  ): void => {
    voxelsTrabalhoAtual = trabalho;
    if (!imageDataFiltradoCache) {
      imageDataFiltradoCache = vtkImageData.newInstance();
      imageDataFiltradoCache.setDimensions(info.imageDataOriginal.getDimensions());
      imageDataFiltradoCache.setSpacing(info.imageDataOriginal.getSpacing());
      imageDataFiltradoCache.setOrigin(info.imageDataOriginal.getOrigin());
      imageDataFiltradoCache.setDirection(info.imageDataOriginal.getDirection());
    }
    const arr = vtkDataArray.newInstance({
      name: 'Scalars',
      values: trabalho,
      numberOfComponents: 1,
    });
    imageDataFiltradoCache.getPointData().setScalars(arr);
    imageDataFiltradoCache.modified();

    const perfil = PERFIS_QUALIDADE_3D[preferencias().qualidade3d];
    if (!mapperFiltradoCache) {
      mapperFiltradoCache = vtkVolumeMapper.newInstance();
    }
    mapperFiltradoCache.setMaximumSamplesPerRay(perfil.maxSamplesPerRay);
    const blend = info.mapperOriginal.getBlendMode?.();
    if (blend !== undefined) mapperFiltradoCache.setBlendMode(blend as never);
    mapperFiltradoCache.setSampleDistance(perfil.sampleDistanceMm);
    mapperFiltradoCache.removeAllClippingPlanes();
    for (const pl of info.mapperOriginal.getClippingPlanes?.() ?? []) {
      mapperFiltradoCache.addClippingPlane(pl as never);
    }
    mapperFiltradoCache.setInputData(imageDataFiltradoCache);
    mapperFiltradoCache.modified();
    info.ator.setMapper(mapperFiltradoCache);
    vpAtual.render();
  };

  const aplicarMascaras = (novoMesa: boolean, novoOsso: boolean): void => {
    const v = opcoes.obterViewport();
    const info = prepararOrigemVolume(v);
    if (!v || !info) return;

    semMesaAtivo = novoMesa;
    semOssoAtivo = novoOsso;
    botaoSemMesa.setAttribute('aria-pressed', String(semMesaAtivo));
    botaoSemOsso.setAttribute('aria-pressed', String(semOssoAtivo));

    const seq = ++geracaoFiltro;

    if (!semMesaAtivo && !semOssoAtivo && historicoTesoura.length === 0) {
      voxelsTrabalhoAtual = null;
      info.ator.setMapper(info.mapperOriginal);
      info.mapperOriginal.modified?.();
      aplicarQualidadeAtual(v);
      botaoSemMesa.title = 'Ocultar a mesa e suportes externos do tomógrafo no 3D';
      botaoSemOsso.title = 'Ocultar estruturas ósseas preservando vasos contrastados no 3D';
      v.render();
      return;
    }

    if (semMesaAtivo) botaoSemMesa.title = 'Calculando filtro "Sem mesa"…';
    if (semOssoAtivo) botaoSemOsso.title = 'Calculando filtro "Sem osso"…';

    void filtrarMascara3dNoWorker(info.baseVoxels, info.dims, semMesaAtivo, semOssoAtivo).then(
      ({ trabalho, removidosMesa, removidosOsso }) => {
        if (destruido || seq !== geracaoFiltro) return;
        const vpAtual = opcoes.obterViewport();
        if (!vpAtual) return;

        // Reaplica os recortes já feitos com a Tesoura 3D, atualizando seus valoresOriginais
        for (const diff of historicoTesoura) {
          for (let n = 0; n < diff.indices.length; n++) {
            const idx = diff.indices[n]!;
            diff.valoresOriginais[n] = trabalho[idx]!;
            trabalho[idx] = valorVazioModalidade;
          }
        }

        atualizarMapperComVoxels(info, vpAtual, trabalho);

        const fmtMil = (n: number): string =>
          n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil voxels` : `${n} voxels`;
        botaoSemMesa.title = semMesaAtivo
          ? `Mesa ocultada (${fmtMil(removidosMesa)}). Clique para restaurar.`
          : 'Ocultar a mesa e suportes externos do tomógrafo no 3D';
        botaoSemOsso.title = semOssoAtivo
          ? `Osso ocultado (${fmtMil(removidosOsso)}). Clique para restaurar.`
          : 'Ocultar estruturas ósseas preservando vasos contrastados no 3D';
      },
    );
  };

  const executarCorteTesoura = (modo: 'dentro' | 'fora'): void => {
    const laco = lacoPendente;
    limparDesenhoTesoura();
    if (!laco || laco.length < 3) return;
    const v = opcoes.obterViewport();
    const info = prepararOrigemVolume(v);
    if (!v || !info) return;
    const proj = calibrarProjeccaoCamera(v);
    if (!proj) return;

    const grid = gridFromVolumeProps({
      dimensions: info.dims,
      spacing: info.imageDataOriginal.getSpacing(),
      origin: info.imageDataOriginal.getOrigin(),
      direction: info.imageDataOriginal.getDirection(),
    });
    const baseAtual = voxelsTrabalhoAtual ?? info.baseVoxels;
    const seq = ++geracaoFiltro;
    botaoTesoura.disabled = true;
    void recortarTesoura3dNoWorker(baseAtual, grid, proj, laco, modo, valorVazioModalidade)
      .then(({ trabalho, diff }) => {
        if (destruido || seq !== geracaoFiltro) return;
        const vpAtual = opcoes.obterViewport();
        if (!vpAtual || diff.indices.length === 0) return;
        historicoTesoura.push(diff);
        atualizarBotoesRecorte();
        atualizarMapperComVoxels(info, vpAtual, trabalho);
      })
      .finally(() => {
        if (!destruido) botaoTesoura.disabled = false;
      });
  };

  const desfazerCorteTesoura = (): void => {
    const ultimo = historicoTesoura.pop();
    if (!ultimo) return;
    atualizarBotoesRecorte();
    const v = opcoes.obterViewport();
    const info = prepararOrigemVolume(v);
    if (!v || !info) return;
    if (!semMesaAtivo && !semOssoAtivo && historicoTesoura.length === 0) {
      voxelsTrabalhoAtual = null;
      info.ator.setMapper(info.mapperOriginal);
      info.mapperOriginal.modified?.();
      aplicarQualidadeAtual(v);
      v.render();
      return;
    }
    if (voxelsTrabalhoAtual) {
      restaurarMascara3d(voxelsTrabalhoAtual as unknown as BufferVolumeEditavel, ultimo);
      atualizarMapperComVoxels(info, v, voxelsTrabalhoAtual);
    }
  };

  botaoDesfazerTesoura.addEventListener('click', desfazerCorteTesoura);
  botaoRestaurar.addEventListener('click', () => {
    const v = opcoes.obterViewport();
    if (v) restaurarRecorte(v);
    if (historicoTesoura.length > 0) {
      historicoTesoura.length = 0;
      atualizarBotoesRecorte();
      aplicarMascaras(semMesaAtivo, semOssoAtivo);
    }
  });

  const btnCortarDentro = document.createElement('button');
  btnCortarDentro.type = 'button';
  btnCortarDentro.className = 'primario';
  btnCortarDentro.textContent = 'Apagar dentro';
  btnCortarDentro.addEventListener('click', () => executarCorteTesoura('dentro'));

  const btnCortarFora = document.createElement('button');
  btnCortarFora.type = 'button';
  btnCortarFora.textContent = 'Apagar fora';
  btnCortarFora.addEventListener('click', () => executarCorteTesoura('fora'));

  const btnCancelarTesoura = document.createElement('button');
  btnCancelarTesoura.type = 'button';
  btnCancelarTesoura.textContent = 'Cancelar';
  btnCancelarTesoura.addEventListener('click', limparDesenhoTesoura);

  popupTesoura.append(btnCortarDentro, btnCortarFora, btnCancelarTesoura);

  const desenharLacoNoCanvas = (pts: ReadonlyArray<readonly [number, number]>, fechado: boolean): void => {
    const r = opcoes.contentor.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (canvasTesoura.width !== Math.round(w * dpr) || canvasTesoura.height !== Math.round(h * dpr)) {
      canvasTesoura.width = Math.round(w * dpr);
      canvasTesoura.height = Math.round(h * dpr);
    }
    const ctx = canvasTesoura.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
    if (fechado) ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fbbf24';
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  canvasTesoura.addEventListener('pointerdown', (ev) => {
    if (!tesouraLigada || ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    limparDesenhoTesoura();
    canvasTesoura.setPointerCapture(ev.pointerId);
    const rectEl = (opcoes.obterViewport()?.element ?? opcoes.contentor).getBoundingClientRect();
    const pts: Array<[number, number]> = [[ev.clientX - rectEl.left, ev.clientY - rectEl.top]];
    desenharLacoNoCanvas(pts, false);

    const aoMover = (m: PointerEvent): void => {
      const px = m.clientX - rectEl.left;
      const py = m.clientY - rectEl.top;
      const ant = pts[pts.length - 1]!;
      if (Math.hypot(px - ant[0], py - ant[1]) < 3) return;
      pts.push([px, py]);
      desenharLacoNoCanvas(pts, false);
    };

    const finalizar = (m: PointerEvent, cancelado: boolean): void => {
      canvasTesoura.removeEventListener('pointermove', aoMover);
      canvasTesoura.removeEventListener('pointerup', aoSoltarLaco);
      canvasTesoura.removeEventListener('pointercancel', aoCancelarLaco);
      if (cancelado || pts.length < 3) {
        limparDesenhoTesoura();
        return;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (Math.hypot(maxX - minX, maxY - minY) < 8) {
        limparDesenhoTesoura();
        return;
      }
      lacoPendente = pts;
      desenharLacoNoCanvas(pts, true);
      const rCont = opcoes.contentor.getBoundingClientRect();
      const leftPx = Math.min(Math.max(8, m.clientX - rCont.left - 90), Math.max(8, rCont.width - 260));
      const topPx = Math.min(Math.max(8, m.clientY - rCont.top + 10), Math.max(8, rCont.height - 48));
      popupTesoura.style.left = `${Math.round(leftPx)}px`;
      popupTesoura.style.top = `${Math.round(topPx)}px`;
      popupTesoura.hidden = false;
    };

    const aoSoltarLaco = (m: PointerEvent): void => finalizar(m, false);
    const aoCancelarLaco = (m: PointerEvent): void => finalizar(m, true);

    canvasTesoura.addEventListener('pointermove', aoMover);
    canvasTesoura.addEventListener('pointerup', aoSoltarLaco);
    canvasTesoura.addEventListener('pointercancel', aoCancelarLaco);
  });

  botaoSemMesa.addEventListener('click', () => aplicarMascaras(!semMesaAtivo, semOssoAtivo));
  botaoSemOsso.addEventListener('click', () => aplicarMascaras(semMesaAtivo, !semOssoAtivo));

  const filtrosGrupo = document.createElement('div');
  filtrosGrupo.className = 'vistas-3d';
  filtrosGrupo.hidden = opcoes.modalidade !== 'CT';
  filtrosGrupo.append(botaoSemMesa, botaoSemOsso);

  const modosGrupo = document.createElement('div');
  modosGrupo.className = 'vistas-3d';
  modosGrupo.title = 'Alternar entre Volume Rendering, superfícies 3D dos segmentos ou ambos';
  const botoesModo: Array<{ modo: ModoExibicao3d; botao: HTMLButtonElement }> = [];
  for (const [m, texto, dica] of [
    ['ambos', 'Vol+Seg', 'Mostrar Volume Rendering e superfícies dos segmentos juntos'],
    ['superficies', 'Superf.', 'Mostrar apenas as superfícies 3D dos segmentos (oculta o volume)'],
    ['volume', 'Volume', 'Mostrar apenas o Volume Rendering (oculta as superfícies)'],
  ] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texto;
    b.title = dica;
    b.addEventListener('click', () => {
      definirModoExibicao3d(m);
    });
    botoesModo.push({ modo: m, botao: b });
    modosGrupo.append(b);
  }

  definirVerificadorViewport3d(temViewport3dAtivo);

  const sincronizarCamadas = (permitirReconstrucao = true): void => {
    const modoAtual = modoExibicao3d();
    for (const item of botoesModo) {
      item.botao.setAttribute('aria-pressed', String(item.modo === modoAtual));
    }
    const v = opcoes.obterViewport();
    const pilhaId = opcoes.obterPilhaId?.();
    const podeReconstruir = permitirReconstrucao && !temEdicaoMascaraPendente(pilhaId);
    if (v) sincronizarSuperficies3d(v, pilhaId, podeReconstruir);
  };

  painel.append(
    seletor,
    seletorQualidade,
    deslizante('Opacidade', 'opacidade', 10, 200),
    deslizante('Brilho', 'brilho', 30, 200),
    vistas,
    recorte,
    filtrosGrupo,
    modosGrupo,
  );
  opcoes.contentor.append(canvasTesoura, popupTesoura, painel);

  let timerSuperficie: ReturnType<typeof setTimeout> | undefined;
  const agendarSincronizacaoCamadas = (permitirReconstrucao: boolean): void => {
    if (timerSuperficie) clearTimeout(timerSuperficie);
    timerSuperficie = setTimeout(() => {
      timerSuperficie = undefined;
      sincronizarCamadas(permitirReconstrucao);
    }, 100);
  };

  const aoMudarSegmentacao = (): void => {
    const modoAtual = modoExibicao3d();
    for (const item of botoesModo) {
      item.botao.setAttribute('aria-pressed', String(item.modo === modoAtual));
    }
  };
  const aoMudarSuperficie = (ev: Event): void => {
    const alvo = (ev as CustomEvent<{ pilhaId?: string }>).detail?.pilhaId;
    const atual = opcoes.obterPilhaId?.();
    if (!alvo || alvo === atual) agendarSincronizacaoCamadas(true);
  };
  const aoMudarPrefs3d = (): void => {
    seletorQualidade.value = preferencias().qualidade3d;
    const v = opcoes.obterViewport();
    aplicarQualidadeAtual(v);
    v?.render();
  };
  const aoTeclaTesoura = (ev: KeyboardEvent): void => {
    if (opcoes.contentor.hidden) return;
    if (ev.key === 'Escape') {
      if (lacoPendente) {
        ev.preventDefault();
        limparDesenhoTesoura();
      } else if (tesouraLigada) {
        ev.preventDefault();
        tesouraLigada = false;
        sincronizarBotaoEsquerdo3d();
        atualizarBotoesRecorte();
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'z') {
      if (historicoTesoura.length > 0) {
        ev.preventDefault();
        desfazerCorteTesoura();
      }
    }
  };
  document.addEventListener(EVENTO_SEGMENTACAO, aoMudarSegmentacao);
  document.addEventListener(EVENTO_SUPERFICIE_3D, aoMudarSuperficie);
  document.addEventListener(EVENTO_PREFERENCIAS, aoMudarPrefs3d);
  document.addEventListener('keydown', aoTeclaTesoura);

  // Clique simples (sem arrastar) leva os cortes 2D ao ponto; durante giro interativo alivia o shader.
  let inicio: { x: number; y: number; t: number } | null = null;
  const elemento = vp?.element;
  const finalizarGiroInterativo = (): void => {
    if (!girandoInterativo) return;
    girandoInterativo = false;
    window.removeEventListener('pointerup', finalizarGiroInterativo, true);
    window.removeEventListener('pointercancel', finalizarGiroInterativo, true);
    const v = opcoes.obterViewport();
    aplicarQualidadeAtual(v);
    v?.render();
  };
  const aoApertar = (e: PointerEvent): void => {
    inicio = e.button === 0 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (!tesouraLigada && !girandoInterativo) {
      girandoInterativo = true;
      aplicarQualidadeAtual(opcoes.obterViewport());
      window.addEventListener('pointerup', finalizarGiroInterativo, true);
      window.addEventListener('pointercancel', finalizarGiroInterativo, true);
    }
  };
  const aoSoltar = (e: PointerEvent): void => {
    const i = inicio;
    inicio = null;
    if (!i || e.button !== 0 || recorteLigado || tesouraLigada || !opcoes.aoClicar || !elemento) return;
    if (Math.hypot(e.clientX - i.x, e.clientY - i.y) > 4 || performance.now() - i.t > 500) return;
    const r = elemento.getBoundingClientRect();
    opcoes.aoClicar([e.clientX - r.left, e.clientY - r.top]);
  };
  elemento?.addEventListener('pointerdown', aoApertar, true);
  elemento?.addEventListener('pointerup', aoSoltar, true);

  aplicar();
  if (vp) aplicarVista3d(vp, 'A');
  sincronizarCamadas();

  return {
    destruir() {
      destruido = true;
      geracaoFiltro++;
      finalizarGiroInterativo();
      tesouraLigada = false;
      sincronizarBotaoEsquerdo3d();
      canvasTesoura.remove();
      popupTesoura.remove();
      painel.remove();
      if (rafAplicar) {
        cancelAnimationFrame(rafAplicar);
        rafAplicar = 0;
      }
      if (timerSuperficie) clearTimeout(timerSuperficie);
      if (mapperOriginalCache) {
        const v = opcoes.obterViewport();
        const ator = v?.getDefaultActor()?.actor as { setMapper?: (m: unknown) => void } | undefined;
        ator?.setMapper?.(mapperOriginalCache);
      }
      try {
        mapperFiltradoCache?.delete?.();
      } catch {
        /* mapper já liberado */
      }
      try {
        imageDataFiltradoCache?.delete?.();
      } catch {
        /* imageData já liberado */
      }
      baseVoxelsCache = null;
      voxelsTrabalhoAtual = null;
      historicoTesoura.length = 0;
      imageDataOriginalCache = null;
      mapperOriginalCache = null;
      imageDataFiltradoCache = null;
      mapperFiltradoCache = null;
      document.removeEventListener(EVENTO_SEGMENTACAO, aoMudarSegmentacao);
      document.removeEventListener(EVENTO_SUPERFICIE_3D, aoMudarSuperficie);
      document.removeEventListener(EVENTO_PREFERENCIAS, aoMudarPrefs3d);
      document.removeEventListener('keydown', aoTeclaTesoura);
      limparSuperficiesViewport(opcoes.obterViewport(), idVp);
      elemento?.removeEventListener('pointerdown', aoApertar, true);
      elemento?.removeEventListener('pointerup', aoSoltar, true);
      encerrarRecorte();
    },
  };
}
