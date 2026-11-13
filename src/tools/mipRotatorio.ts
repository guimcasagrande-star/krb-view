/**
 * MIP rotatório de volume inteiro (Fase 3.2):
 * - Gira a câmera ortográfica em torno do eixo crânio-caudal (eixo Z, viewUp = [0, 0, 1]),
 *   com tocar/pausar e arrastar com o mouse para girar à mão.
 * - Usa MIPJumpToClickTool / getPointInLineOfSightWithCriteria (com ray-marching completo
 *   nos limites do volume para ângulos oblíquos) para encontrar o voxel mais intenso
 *   na linha de visada do clique e levar os viewports 2D/MPR àquele ponto.
 */

import { CONSTANTS, Enums, type Types } from '@cornerstonejs/core';
import { MIPJumpToClickTool, utilities as toolsUtilities } from '@cornerstonejs/tools';

export { MIPJumpToClickTool };

const VELOCIDADE_GRAUS_POR_SEGUNDO = 36;
const LIMIAR_CLIQUE_PX = 5;
const SENSIBILIDADE_ARRASTO_GRAUS_POR_PX = 0.7;

export interface ControladorMipRotatorio {
  /** Liga ou desliga a rotação automática. */
  alternarRotacao(): void;
  /** Pausa a rotação automática. */
  pausar(): void;
  /** Inicia a rotação automática. */
  tocar(): void;
  /** Informa se está girando automaticamente. */
  girando(): boolean;
  /** Define o ângulo atual em graus (0° = Coronal AP, 90° = Sagital). */
  definirAngulo(graus: number): void;
  /** Ângulo atual em graus [0, 360). */
  anguloAtual(): number;
  /** Encerra timers e ouvintes de eventos. */
  destruir(): void;
}

export interface OpcoesMipRotatorio {
  elemento: HTMLElement;
  controles: HTMLElement;
  obterViewport(): Types.IVolumeViewport | undefined;
  aoClicarPontoMaisIntenso(pontoMundo: Types.Point3): void;
  iniciarGirando?: boolean;
}

/**
 * Posiciona a câmera do `VolumeViewport` no ângulo `anguloGraus` em torno do eixo
 * crânio-caudal (`viewUp = [0, 0, 1]`) e configura MIP de volume inteiro.
 */
export function aplicarCameraMipRotatorio(
  vp: Types.IVolumeViewport,
  anguloGraus: number,
): void {
  const rad = (anguloGraus * Math.PI) / 180;
  const viewPlaneNormal: Types.Point3 = [Math.sin(rad), -Math.cos(rad), 0];
  const viewUp: Types.Point3 = [0, 0, 1];

  const cam = vp.getCamera();
  const fp: Types.Point3 = cam.focalPoint ? [...cam.focalPoint] : [0, 0, 0];
  const pos = cam.position ?? [0, -500, 0];
  const dist =
    Math.hypot(pos[0] - fp[0], pos[1] - fp[1], pos[2] - fp[2]) || 500;
  const position: Types.Point3 = [
    fp[0] + dist * viewPlaneNormal[0],
    fp[1] + dist * viewPlaneNormal[1],
    fp[2] + dist * viewPlaneNormal[2],
  ];

  vp.setBlendMode(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND);
  vp.setCamera({
    focalPoint: fp,
    position,
    viewPlaneNormal,
    viewUp,
  });
  vp.setSlabThickness(CONSTANTS.RENDERING_DEFAULTS.MAXIMUM_RAY_DISTANCE);
  vp.render();
}

/**
 * Encontra o ponto 3D (em coordenadas de mundo LPS) de maior intensidade ao longo
 * do raio que passa por `worldPos` na direção de visualização atual do viewport MIP.
 *
 * Combina `utilities.planar.getPointInLineOfSightWithCriteria` (usada pelo `MIPJumpToClickTool`)
 * com varredura completa do segmento do raio dentro de `vp.getBounds()`, garantindo precisão
 * mesmo quando o volume está girado em ângulo oblíquo ou perto das bordas.
 */
export function encontrarPontoMaisIntensoNoRaio(
  vp: Types.IVolumeViewport,
  worldPos: Types.Point3,
): Types.Point3 | undefined {
  const volumeId = vp.getVolumeId();
  let melhorPonto: Types.Point3 | undefined;
  let maiorIntensidade = -Infinity;

  if (volumeId) {
    try {
      const candidato = toolsUtilities.planar.getPointInLineOfSightWithCriteria(
        vp,
        worldPos,
        volumeId,
        (intensidade, ponto) => {
          if ( Number.isFinite(intensidade) && intensidade > maiorIntensidade) {
            maiorIntensidade = intensidade;
            melhorPonto = [ponto[0], ponto[1], ponto[2]];
            return ponto;
          }
          return mejorPontoOuVazio(melhorPonto);
        },
        0.25,
      );
      if (candidato && candidato.length === 3 && !melhorPonto) {
        melhorPonto = [candidato[0], candidato[1], candidato[2]];
      }
    } catch {
      /* fallback abaixo cobre qualquer caso em que getPointInLineOfSightWithCriteria falhe */
    }
  }

  // Varredura completa da interseção do raio com a caixa delimitadora (bounds) do volume:
  const bounds = vp.getBounds();
  const normal = vp.getCamera()?.viewPlaneNormal;
  if (!bounds || bounds.length < 6 || !normal) return melhorPonto;

  const [xMin, xMax, yMin, yMax, zMin, zMax] = bounds as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const intersecao = intersecaoRaioCaixa(worldPos, normal, [
    xMin,
    xMax,
    yMin,
    yMax,
    zMin,
    zMax,
  ]);
  if (!intersecao) return melhorPonto;

  const [tMin, tMax] = intersecao;
  const imgData = vp.getImageData();
  const menorEspacamento = imgData?.spacing
    ? Math.min(imgData.spacing[0], imgData.spacing[1], imgData.spacing[2])
    : 2;
  const passo = Math.max(0.5, menorEspacamento * 0.25);

  for (let t = tMin; t <= tMax; t += passo) {
    const p: Types.Point3 = [
      worldPos[0] + normal[0] * t,
      worldPos[1] + normal[1] * t,
      worldPos[2] + normal[2] * t,
    ];
    const valor = vp.getIntensityFromWorld(p);
    if (typeof valor === 'number' && Number.isFinite(valor) && valor > maiorIntensidade) {
      maiorIntensidade = valor;
      melhorPonto = p;
    }
  }

  return melhorPonto;
}

function mejorPontoOuVazio(p: Types.Point3 | undefined): Types.Point3 {
  return p ?? (undefined as unknown as Types.Point3);
}

/** Calcula o intervalo [tMin, tMax] em que a reta `origem + t * direcao` cruza a caixa AABB. */
function intersecaoRaioCaixa(
  origem: Types.Point3,
  direcao: Types.Point3,
  caixa: [number, number, number, number, number, number],
): [number, number] | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const mins = [caixa[0], caixa[2], caixa[4]];
  const maxs = [caixa[1], caixa[3], caixa[5]];

  for (let i = 0; i < 3; i++) {
    const o = origem[i]!;
    const d = direcao[i]!;
    const bMin = mins[i]!;
    const bMax = maxs[i]!;
    if (Math.abs(d) < 1e-8) {
      if (o < bMin || o > bMax) return null;
    } else {
      let t1 = (bMin - o) / d;
      let t2 = (bMax - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return null;
    }
  }
  return [tMin, tMax];
}

/**
 * Cria os controles visuais (botão Girar/Pausar e indicador de ângulo) e a interação
 * de arrastar para girar à mão + clicar para saltar ao ponto mais intenso.
 */
export function criarControladorMipRotatorio(
  opcoes: OpcoesMipRotatorio,
): ControladorMipRotatorio {
  const { elemento, controles, obterViewport, aoClicarPontoMaisIntenso } = opcoes;
  let angulo = 0;
  let rodando = opcoes.iniciarGirando ?? true;
  let rafId: number | null = null;
  let ultimoInstante: number | null = null;
  let destruido = false;

  controles.replaceChildren();
  controles.hidden = false;

  const btnPlay = document.createElement('button');
  btnPlay.type = 'button';
  btnPlay.className = 'btn-mip-play';
  btnPlay.title = 'Tocar ou pausar a rotação do MIP';

  const rotuloAngulo = document.createElement('span');
  rotuloAngulo.className = 'rotulo-mip-angulo';
  rotuloAngulo.title = 'Arraste a imagem para girar à mão · Clique num ponto para ir ao corte correspondente';

  controles.append(btnPlay, rotuloAngulo);

  function normalizarAngulo(g: number): number {
    return ((g % 360) + 360) % 360;
  }

  function atualizarUi(): void {
    btnPlay.textContent = rodando ? '⏸ Pausar' : '▶ Girar';
    btnPlay.setAttribute('aria-pressed', String(rodando));
    rotuloAngulo.textContent = `${Math.round(angulo)}° · clique = ir ao pico`;
  }

  function aplicar(): void {
    const vp = obterViewport();
    if (!vp) return;
    aplicarCameraMipRotatorio(vp, angulo);
    atualizarUi();
  }

  function quadro(agora: number): void {
    if (destruido || !rodando) {
      rafId = null;
      ultimoInstante = null;
      return;
    }
    if (ultimoInstante !== null) {
      const dt = Math.min((agora - ultimoInstante) / 1000, 0.1);
      angulo = normalizarAngulo(angulo + dt * VELOCIDADE_GRAUS_POR_SEGUNDO);
      aplicar();
    }
    ultimoInstante = agora;
    rafId = requestAnimationFrame(quadro);
  }

  function tocar(): void {
    if (destruido || rodando) return;
    rodando = true;
    ultimoInstante = null;
    atualizarUi();
    rafId = requestAnimationFrame(quadro);
  }

  function pausar(): void {
    rodando = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    ultimoInstante = null;
    atualizarUi();
  }

  function alternarRotacao(): void {
    if (rodando) pausar();
    else tocar();
  }

  btnPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    alternarRotacao();
  });

  // Interação de mouse: botão esquerdo gira à mão ao arrastar ou salta ao ponto mais intenso ao clicar.
  let arrastando = false;
  let moveu = false;
  let inicioX = 0;
  let inicioY = 0;
  let anguloInicial = 0;

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0 || e.ctrlKey || e.altKey || e.metaKey) return;
    e.stopPropagation();
    e.preventDefault();
    arrastando = true;
    moveu = false;
    inicioX = e.clientX;
    inicioY = e.clientY;
    anguloInicial = angulo;
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!arrastando) return;
    const dx = e.clientX - inicioX;
    const dy = e.clientY - inicioY;
    if (!moveu && Math.hypot(dx, dy) > LIMIAR_CLIQUE_PX) {
      moveu = true;
      pausar();
    }
    if (moveu) {
      e.stopPropagation();
      e.preventDefault();
      angulo = normalizarAngulo(anguloInicial - dx * SENSIBILIDADE_ARRASTO_GRAUS_POR_PX);
      aplicar();
    }
  }

  function onMouseUp(e: MouseEvent): void {
    if (!arrastando) return;
    arrastando = false;
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('mouseup', onMouseUp, true);

    if (!moveu) {
      const vp = obterViewport();
      if (!vp) return;
      const rect = elemento.getBoundingClientRect();
      const canvasPos: Types.Point2 = [e.clientX - rect.left, e.clientY - rect.top];
      const worldPos = vp.canvasToWorld(canvasPos);
      if (worldPos) {
        const ponto = encontrarPontoMaisIntensoNoRaio(vp, worldPos);
        if (ponto) {
          aoClicarPontoMaisIntenso(ponto);
        }
      }
    }
  }

  elemento.addEventListener('mousedown', onMouseDown, true);

  atualizarUi();
  if (rodando) {
    rafId = requestAnimationFrame(quadro);
  }

  return {
    alternarRotacao,
    pausar,
    tocar,
    girando: () => rodando,
    definirAngulo(graus: number) {
      angulo = normalizarAngulo(graus);
      aplicar();
    },
    anguloAtual: () => angulo,
    destruir() {
      destruido = true;
      pausar();
      elemento.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      controles.hidden = true;
      controles.replaceChildren();
    },
  };
}
