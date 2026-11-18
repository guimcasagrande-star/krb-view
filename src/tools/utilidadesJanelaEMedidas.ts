/**
 * Utilitários clínicos rápidos:
 * - S4: Auto-janela no corte atual (`calcularAutoJanela` + `autoJanelaCorteAtual`, tecla `0`),
 *   calculando percentis robustos sobre os pixels do tecido visível (ignorando ar externo/padding).
 * - S5: Cópia rápida de medidas selecionadas para a área de transferência (`Ctrl+C`),
 *   formatando em português do Brasil.
 */

import { cache, Enums, type Types } from '@cornerstonejs/core';
import { annotation } from '@cornerstonejs/tools';
import { medidas, type PrefsMedidas } from '../state/preferencias';
import { estado } from '../state/store';
import { iniciarCornerstone } from '../viewer/iniciar';
import { textoAngulo, textoDistancia, textoRoi } from './estiloMedidas';
import { formatarNumero } from './formatoMedidas';

export function calcularAutoJanela(
  dados: ArrayLike<number>,
  slope = 1,
  intercept = 0,
  modalidade?: string,
): { lower: number; upper: number } | null {
  const n = dados.length;
  if (n === 0) return null;

  const maxAmostras = 65536;
  const passo = Math.max(1, Math.floor(n / maxAmostras));
  const todos: number[] = [];
  for (let i = 0; i < n; i += passo) {
    const bruto = dados[i]!;
    if (!Number.isFinite(bruto)) continue;
    const val = bruto * slope + intercept;
    if (Number.isFinite(val)) todos.push(val);
  }
  if (todos.length === 0) return null;
  todos.sort((a, b) => a - b);

  const minGlobal = todos[0]!;
  const maxGlobal = todos[todos.length - 1]!;
  if (maxGlobal <= minGlobal) {
    return { lower: minGlobal - 1, upper: maxGlobal + 1 };
  }

  const ehTc = modalidade === 'CT' || (modalidade === undefined && minGlobal <= -800 && maxGlobal > -100);
  let uteis = todos;
  if (ehTc) {
    // Na TC, descarta padding circular (<-1024) e ar externo (<= -850 HU) se houver tecido suficiente
    const tecidos = todos.filter((v) => v > -850);
    if (tecidos.length >= Math.max(32, todos.length * 0.05)) {
      uteis = tecidos;
    } else {
      const semPadding = todos.filter((v) => v >= -1024);
      if (semPadding.length >= 16) uteis = semPadding;
    }
  } else {
    // Em RM / US / CR, ignora fundo zero puro se houver anatomia positiva suficiente
    const positivos = todos.filter((v) => v > 0);
    if (positivos.length >= Math.max(32, todos.length * 0.05)) {
      uteis = positivos;
    }
  }

  const pBaixo = ehTc ? 0.02 : 0.01;
  const pAlto = ehTc ? 0.985 : 0.992;
  const idxBaixo = Math.min(uteis.length - 1, Math.max(0, Math.floor((uteis.length - 1) * pBaixo)));
  const idxAlto = Math.min(uteis.length - 1, Math.max(idxBaixo, Math.ceil((uteis.length - 1) * pAlto)));
  let lower = uteis[idxBaixo]!;
  let upper = uteis[idxAlto]!;
  const span = Math.max(1, upper - lower);
  // Pequena folga (6%) para não estourar vasos ou cortical nem lavar o fundo
  lower -= span * 0.06;
  upper += span * 0.06;
  if (ehTc) {
    lower = Math.round(lower);
    upper = Math.max(lower + 1, Math.round(upper));
  }
  return { lower, upper };
}

function amostrarViewportVolume(vp: Types.IVolumeViewport): number[] {
  const el = vp.element;
  const larg = el?.clientWidth ?? 0;
  const alt = el?.clientHeight ?? 0;
  if (larg < 16 || alt < 16) return [];
  const entry = vp.getDefaultActor();
  const volId = (vp as { getVolumeId?: () => string }).getVolumeId?.() ?? entry?.uid ?? entry?.referencedId;
  const vol = volId ? cache.getVolume(volId) : undefined;
  const imageData = vol?.imageData as
    | { worldToIndex?: (w: Types.Point3) => number[]; getDimensions?: () => number[] }
    | undefined;
  const escalares = vol?.voxelManager?.getCompleteScalarDataArray?.();
  const dims = imageData?.getDimensions?.();
  if (!imageData?.worldToIndex || !escalares || !dims || dims.length < 3) return [];
  const [nx, ny, nz] = [dims[0]!, dims[1]!, dims[2]!];
  const slice = nx * ny;
  const valores: number[] = [];
  const grade = 80;
  for (let gy = 1; gy < grade; gy++) {
    const cy = (gy / grade) * alt;
    for (let gx = 1; gx < grade; gx++) {
      const cx = (gx / grade) * larg;
      try {
        const w = vp.canvasToWorld([cx, cy]);
        const idx = imageData.worldToIndex(w);
        const i = Math.round(idx[0]!);
        const j = Math.round(idx[1]!);
        const k = Math.round(idx[2]!);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const v = escalares[i + j * nx + k * slice];
        if (v !== undefined && Number.isFinite(v)) valores.push(v);
      } catch {
        /* fora do plano */
      }
    }
  }
  return valores;
}

/** Calcula e aplica a auto-janela sobre os pixels visíveis no corte atual do viewport ativo (tecla `0`). */
export async function autoJanelaCorteAtual(): Promise<void> {
  const id = estado.idViewportAtivo;
  if (!id) return;
  const motor = await iniciarCornerstone();
  const vp = motor.getViewport(id) as Types.IStackViewport | Types.IVolumeViewport | undefined;
  if (!vp || vp.type === Enums.ViewportType.VOLUME_3D) return;
  const modalidade = estado.pilhaAtiva?.instances[0]?.modality;

  let faixa: { lower: number; upper: number } | null = null;
  if ('setImageIdIndex' in vp) {
    const imageId = vp.getCurrentImageId();
    const img = imageId ? cache.getImage(imageId) : undefined;
    if (img) {
      faixa = calcularAutoJanela(img.getPixelData(), img.slope ?? 1, img.intercept ?? 0, modalidade);
    }
  } else {
    const amostras = amostrarViewportVolume(vp);
    if (amostras.length > 0) {
      faixa = calcularAutoJanela(amostras, 1, 0, modalidade);
    }
  }
  if (!faixa) return;
  vp.setProperties({ voiRange: faixa });
  vp.render();
}

export function formatarAnotacaoParaTexto(
  ann: { metadata?: { toolName?: string }; data?: Record<string, unknown> },
  prefs: PrefsMedidas,
): string {
  const nome = ann.metadata?.toolName ?? '';
  const data = (ann.data ?? {}) as Record<string, unknown> & {
    label?: string;
    texto?: string;
    textLines?: string[];
    cachedStats?: Record<string, unknown>;
  };

  if (Array.isArray(data.textLines) && data.textLines.length > 0) {
    return data.textLines.filter(Boolean).join(' · ');
  }
  if (typeof data.texto === 'string' && data.texto.trim()) {
    return data.texto.trim();
  }

  const chaves = Object.keys(data.cachedStats ?? {});
  const alvo = chaves[0] ?? '';
  if (nome === 'Length' && alvo) {
    const t = textoDistancia(data, alvo);
    if (t?.length) return t.join(' · ');
  }
  if (nome === 'Angle' && alvo) {
    const t = textoAngulo(data, alvo);
    if (t?.length) return t.join(' · ');
  }
  if ((nome === 'EllipticalROI' || nome === 'PlanarFreehandROI') && alvo) {
    const t = textoRoi(data, alvo);
    if (t?.length) return t.join(' · ');
  }

  // Fallback genérico para estatísticas numéricas em cachedStats
  if (alvo && data.cachedStats?.[alvo] && typeof data.cachedStats[alvo] === 'object') {
    const st = data.cachedStats[alvo] as Record<string, unknown>;
    const partes: string[] = [];
    if (typeof st.length === 'number') partes.push(`${formatarNumero(st.length, prefs.casas)} mm`);
    if (typeof st.angle === 'number') partes.push(`${formatarNumero(st.angle, prefs.casasValores)}°`);
    if (typeof st.mean === 'number') partes.push(`Média ${formatarNumero(st.mean, prefs.casasValores)}`);
    if (typeof st.max === 'number') partes.push(`Máx ${formatarNumero(st.max, prefs.casasValores)}`);
    if (partes.length > 0) return partes.join(' · ');
  }

  if (typeof data.label === 'string' && data.label.trim()) {
    return data.label.trim();
  }
  return '';
}

function extrairTextoSvgDaAnotacao(uid: string): string {
  if (typeof document === 'undefined') return '';
  const nos = document.querySelectorAll<SVGElement>(`[data-annotation-uid="${CSS.escape(uid)}"] text`);
  const linhas: string[] = [];
  for (const t of nos) {
    const tspans = t.querySelectorAll('tspan');
    if (tspans.length > 0) {
      for (const s of tspans) {
        const txt = s.textContent?.trim();
        if (txt) linhas.push(txt);
      }
    } else {
      const txt = t.textContent?.trim();
      if (txt) linhas.push(txt);
    }
  }
  return linhas.join(' · ');
}

let timerAvisoCopia = 0;

function mostrarAvisoRapido(mensagem: string): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('toast-rapido-visu');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-rapido-visu';
    el.className = 'toast-rapido';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = mensagem;
  el.hidden = false;
  if (timerAvisoCopia) window.clearTimeout(timerAvisoCopia);
  timerAvisoCopia = window.setTimeout(() => {
    if (el) el.hidden = true;
  }, 1900);
}

/** Copia o texto formatado das medidas selecionadas para a área de transferência (`Ctrl+C`). */
export async function copiarMedidasSelecionadas(): Promise<boolean> {
  const uids = annotation.selection
    .getAnnotationsSelected()
    .filter((uid) => annotation.state.getAnnotation(uid)?.metadata?.toolName !== 'Crosshairs');
  if (uids.length === 0) return false;

  const prefs = medidas();
  const textos: string[] = [];
  for (const uid of uids) {
    const doSvg = extrairTextoSvgDaAnotacao(uid);
    if (doSvg) {
      textos.push(doSvg);
      continue;
    }
    const ann = annotation.state.getAnnotation(uid);
    if (ann) {
      const formatado = formatarAnotacaoParaTexto(
        ann as unknown as { metadata?: { toolName?: string }; data?: Record<string, unknown> },
        prefs,
      );
      if (formatado) textos.push(formatado);
    }
  }
  if (textos.length === 0) return false;

  const final = textos.join('\n');
  try {
    await navigator.clipboard.writeText(final);
    mostrarAvisoRapido(
      textos.length === 1 ? `✓ Copiado: ${textos[0]}` : `✓ ${textos.length} medidas copiadas`,
    );
    return true;
  } catch {
    return false;
  }
}
