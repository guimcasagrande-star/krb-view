/**
 * Filtro visual de apresentação (Suave <-> Nítido) por viewport.
 *
 * Nota técnica sobre o Cornerstone3D 5.17.1:
 * Os tipos `STACK` e `ORTHOGRAPHIC` são remapeados internamente por `BaseRenderingEngine`
 * para `PLANAR_NEXT` (`PlanarViewport` + `PlanarViewportLegacyAdapter`), cujo
 * `toPlanarDataPresentation` ignora silenciosamente `sharpening` e `smoothing` de
 * `setProperties` (que só existiam nas classes legadas). Além disso, `PlanarViewport`
 * alterna entre `canvas.cornerstone-canvas` (WebGL) e `cpuCanvas` conforme o caminho
 * de renderização.
 *
 * Por isso aplicamos filtros SVG acelerados por GPU no compositor (Gaussian Blur para
 * Suave e Unsharp Mask verdadeiro para Nítido) diretamente nos `<canvas>` de imagem
 * do viewport — mantendo o `<svg class="svg-layer">` das medidas, a mira e o texto dos
 * cantos 100% nítidos e sem alterar em nada os valores de HU/SUV dos voxels/pixels.
 */

export const FILTRO_IMAGEM_MIN = -5;
export const FILTRO_IMAGEM_MAX = 5;
export const FILTRO_IMAGEM_PASSO = 0.5;

export interface PresetFiltroImagem {
  valor: number;
  rotulo: string;
  descricao: string;
}

export const PRESETS_FILTRO_IMAGEM: ReadonlyArray<PresetFiltroImagem> = [
  { valor: -4, rotulo: 'Suave forte', descricao: 'Reduz mais o ruído quântico (partes moles em baixa dose)' },
  { valor: -2, rotulo: 'Suave', descricao: 'Suavização moderada para parênquima e abdome' },
  { valor: 0, rotulo: 'Original', descricao: 'Sem filtro adicional (exibição original)' },
  { valor: 1.5, rotulo: 'Nítido leve', descricao: 'Unsharp mask sutil, compensando a interpolação bilinear' },
  { valor: 3.5, rotulo: 'Nítido forte', descricao: 'Realce acentuado para pulmão, osso e estruturas finas' },
];

export type EspecificacaoFiltroImagem =
  | { modo: 'original' }
  | { modo: 'suave'; sigma: number }
  | { modo: 'nitido'; sigma: number; intensidade: number; k2: number; k3: number };

/** Garante um nível válido no intervalo [-5, 5], em passos de 0,5, sem -0. */
export function sanearNivelFiltro(valor: unknown, padrao = 0): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return padrao;
  const limitado = Math.min(FILTRO_IMAGEM_MAX, Math.max(FILTRO_IMAGEM_MIN, valor));
  const arredondado = Math.round(limitado / FILTRO_IMAGEM_PASSO) * FILTRO_IMAGEM_PASSO;
  return arredondado === 0 ? 0 : arredondado;
}

/**
 * Converte o nível (-5..+5) na especificação matemática do filtro visual:
 * - `nivel === 0`: `original` (nenhum filtro aplicado, custo zero).
 * - `nivel < 0`: `suave` com desvio gaussiano `sigma` (0,24 a 2,40 px CSS).
 * - `nivel > 0`: `nitido` via Unsharp Mask:
 *   `Saída = (1 + intensidade) * Original - intensidade * Blur_sigma(Original)`,
 *   com `intensidade` de 0,20 a 2,00 e `sigma` de 0,88 a 1,15 px CSS.
 */
export function especificacaoFiltroSvg(nivel: number): EspecificacaoFiltroImagem {
  const n = sanearNivelFiltro(nivel);
  if (n < 0) {
    return {
      modo: 'suave',
      sigma: Number((Math.abs(n) * 0.48).toFixed(3)),
    };
  }
  if (n > 0) {
    const intensidade = Number((n * 0.4).toFixed(3));
    const sigma = Number((0.85 + n * 0.06).toFixed(3));
    return {
      modo: 'nitido',
      sigma,
      intensidade,
      k2: Number((1 + intensidade).toFixed(3)),
      k3: Number((-intensidade).toFixed(3)),
    };
  }
  return { modo: 'original' };
}

/** Monta o conteúdo interno XML do `<filter>` SVG para níveis diferentes de zero. */
export function conteudoInternoFiltroSvg(spec: EspecificacaoFiltroImagem): string {
  if (spec.modo === 'original') return '';
  if (spec.modo === 'suave') {
    return `<feGaussianBlur in="SourceGraphic" stdDeviation="${spec.sigma}" edgeMode="duplicate" />`;
  }
  return (
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${spec.sigma}" edgeMode="duplicate" result="blur" />` +
    `<feComposite in="SourceGraphic" in2="blur" operator="arithmetic" k1="0" k2="${spec.k2}" k3="${spec.k3}" k4="0" result="sharp" />` +
    `<feComponentTransfer in="sharp"><feFuncA type="linear" slope="0" intercept="1" /></feComponentTransfer>`
  );
}

const NS_SVG = 'http://www.w3.org/2000/svg';
let defsGlobal: SVGDefsElement | null = null;
const nivelAplicadoPorFiltro = new Map<string, number>();

function garantirDefsSvg(): SVGDefsElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (defsGlobal && defsGlobal.isConnected) return defsGlobal;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;width:0;height:0;pointer-events:none;overflow:hidden;';
  const defs = document.createElementNS(NS_SVG, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  defsGlobal = defs;
  nivelAplicadoPorFiltro.clear();
  return defs;
}

export function idFiltroDomViewport(idViewport: string): string {
  return `visu-filtro-${idViewport.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Aplica o filtro visual (Suave / Nítido) somente aos `<canvas>` de imagem dentro do
 * elemento do viewport, preservando anotações SVG e overlays sem distorção.
 */
export function aplicarFiltroVisualElemento(
  elementoViewport: HTMLElement | null | undefined,
  idViewport: string,
  nivel: number,
): void {
  if (!elementoViewport) return;
  const n = sanearNivelFiltro(nivel, 0);
  const spec = especificacaoFiltroSvg(n);
  const canvases = elementoViewport.querySelectorAll('canvas');

  if (spec.modo === 'original') {
    for (const c of canvases) {
      if (c.style.filter) c.style.filter = '';
    }
    return;
  }

  const defs = garantirDefsSvg();
  if (!defs) return;

  const idFiltro = idFiltroDomViewport(idViewport);
  let filtroEl = defs.querySelector<SVGFilterElement>(`#${idFiltro}`);
  if (!filtroEl) {
    filtroEl = document.createElementNS(NS_SVG, 'filter');
    filtroEl.setAttribute('id', idFiltro);
    filtroEl.setAttribute('x', '0%');
    filtroEl.setAttribute('y', '0%');
    filtroEl.setAttribute('width', '100%');
    filtroEl.setAttribute('height', '100%');
    filtroEl.setAttribute('color-interpolation-filters', 'sRGB');
    defs.appendChild(filtroEl);
  }

  if (nivelAplicadoPorFiltro.get(idFiltro) !== n) {
    filtroEl.innerHTML = conteudoInternoFiltroSvg(spec);
    nivelAplicadoPorFiltro.set(idFiltro, n);
  }

  const valorCss = `url(#${idFiltro})`;
  for (const c of canvases) {
    if (c.style.filter !== valorCss) c.style.filter = valorCss;
  }
}

function formatarNumeroFiltro(n: number): string {
  return String(n).replace('.', ',');
}

/** Rótulo descritivo para menus, dicas e overlay (ex.: "Original", "Suave -2", "Nítido +1,5"). */
export function rotuloFiltroImagem(nivel: number): string {
  const n = sanearNivelFiltro(nivel);
  if (n === 0) return 'Original';
  if (n < 0) return `Suave ${formatarNumeroFiltro(n)}`;
  return `Nítido +${formatarNumeroFiltro(n)}`;
}

/** Rótulo curto para o botão da barra superior. */
export function rotuloBotaoFiltroImagem(nivel: number): string {
  const n = sanearNivelFiltro(nivel);
  if (n === 0) return 'Filtro';
  if (n < 0) return `Suave ${formatarNumeroFiltro(n)}`;
  return `Nítido +${formatarNumeroFiltro(n)}`;
}
