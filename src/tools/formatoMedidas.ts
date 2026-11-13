/**
 * Texto das medidas conforme as preferências (unidade, casas decimais, campos da ROI).
 * Funções puras, sem Cornerstone, para poderem ser testadas.
 */

import type { PrefsMedidas } from '../state/preferencias';

export function formatarNumero(n: number, casas: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(Math.min(100, Math.max(0, Math.round(casas)))).replace('.', ',');
}

/** Comprimento a partir de mm, na unidade escolhida. */
export function formatarComprimentoMm(mm: number, p: PrefsMedidas): string {
  const valor = p.unidade === 'cm' ? mm / 10 : mm;
  return `${formatarNumero(valor, p.casas)} ${p.unidade}`;
}

/** Área a partir de mm². */
export function formatarAreaMm2(mm2: number, p: PrefsMedidas): string {
  const valor = p.unidade === 'cm' ? mm2 / 100 : mm2;
  return `${formatarNumero(valor, p.casas)} ${p.unidade}²`;
}

/** Valor com unidade fornecida pelo Cornerstone: só converte quando for mm. */
export function comprimentoComUnidade(valor: number, unidade: string | undefined, p: PrefsMedidas): string {
  if (!unidade || unidade === 'mm') return formatarComprimentoMm(valor, p);
  return `${formatarNumero(valor, p.casas)} ${unidade}`;
}

export function areaComUnidade(valor: number, unidade: string | undefined, p: PrefsMedidas): string {
  if (!unidade || unidade === 'mm²' || unidade === 'mm2') return formatarAreaMm2(valor, p);
  return `${formatarNumero(valor, p.casas)} ${unidade}`;
}

export interface EstatisticasRoi {
  area?: number;
  areaUnit?: string;
  isEmptyArea?: boolean;
  mean?: number;
  stdDev?: number;
  max?: number;
  min?: number;
  perimeter?: number;
  length?: number;
  unit?: string;
  modalityUnit?: string;
}

const eNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Linhas de texto de uma ROI, só com os campos ligados nas preferências. */
export function linhasRoi(s: EstatisticasRoi | undefined, p: PrefsMedidas): string[] {
  const linhas: string[] = [];
  if (!s) return linhas;
  const un = s.modalityUnit ? ` ${s.modalityUnit}` : '';
  const v = (n: number) => `${formatarNumero(n, p.casasValores)}${un}`;
  if (p.roi.area && eNumero(s.area)) {
    linhas.push(s.isEmptyArea ? 'Área: plano oblíquo não suportado' : `Área: ${areaComUnidade(s.area, s.areaUnit, p)}`);
  }
  if (p.roi.media && eNumero(s.mean)) linhas.push(`Média: ${v(s.mean)}`);
  if (p.roi.maximo && eNumero(s.max)) linhas.push(`Máx.: ${v(s.max)}`);
  if (p.roi.minimo && eNumero(s.min)) linhas.push(`Mín.: ${v(s.min)}`);
  if (p.roi.desvio && eNumero(s.stdDev)) linhas.push(`Desvio: ${v(s.stdDev)}`);
  if (p.roi.perimetro && eNumero(s.perimeter)) linhas.push(`Perímetro: ${comprimentoComUnidade(s.perimeter, s.unit, p)}`);
  if (eNumero(s.length) && !eNumero(s.perimeter)) linhas.push(comprimentoComUnidade(s.length, s.unit, p));
  return linhas;
}

export function linhaAngulo(graus: number, p: PrefsMedidas): string {
  return `${formatarNumero(graus, p.casasValores)}°`;
}
