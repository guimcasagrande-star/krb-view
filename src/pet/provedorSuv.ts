/**
 * Liga `computeSuv` ao carregador de imagens do Cornerstone3D.
 *
 * O `dicom-image-loader` consulta `metaData.get('scalingModule', imageId)` ao decodificar uma
 * imagem de PET: se vier `suvbw` numérico, o pixel já sai em SUVbw (veja `getScalingParameters`
 * no loader). Este provedor responde a esse tipo com os fatores calculados por `computeSuv`.
 *
 * Regras:
 * - O provedor precisa estar registrado e os fatores guardados ANTES de carregar as imagens
 *   (a decodificação usa o valor no momento do carregamento).
 * - Se `computeSuv` devolve `ok: false`, o provedor NÃO responde para aquela série: os valores
 *   ficam em Bq/mL. Nunca se assume valor padrão.
 * - O resultado (parâmetros, avisos e erros) fica disponível em `resultadoSuv(stackId)` para a
 *   interface mostrar.
 */

import { metaData } from '@cornerstonejs/core';
import type { StackNode } from '../io/organize';
import { computeSuv, type SuvResult } from './suv';

/** Formato esperado pelo loader (e por `utilities.isPTPrescaledWithSUV`). */
export interface ScalingModuleSuv {
  suvbw: number;
  suvlbm?: number;
  suvbsa?: number;
}

const fatoresPorImagem = new Map<string, ScalingModuleSuv>();
const resultadoPorPilha = new Map<string, SuvResult>();
const imagensPorPilha = new Map<string, string[]>();
let provedorRegistrado = false;

function provedorScalingModule(type: string, imageId: string): ScalingModuleSuv | undefined {
  if (type !== 'scalingModule') return undefined;
  return fatoresPorImagem.get(imageId);
}

function garantirProvedor(): void {
  if (provedorRegistrado) return;
  // Prioridade acima da padrão (0): consultado antes dos provedores do loader.
  metaData.addProvider(provedorScalingModule, 100);
  provedorRegistrado = true;
}

/**
 * Calcula o SUV da pilha de PET e guarda os fatores de cada imageId.
 * Chamar logo depois de criar os imageIds e antes de carregar qualquer imagem.
 * Devolve `null` se a pilha não é de PET.
 */
export function registrarSuvDaPilha(stack: StackNode, imageIds: string[]): SuvResult | null {
  if (!stack.instances.some((i) => i.modality === 'PT')) return null;
  garantirProvedor();

  const resultado = computeSuv(stack.instances);
  resultadoPorPilha.set(stack.id, resultado);
  esquecerImagens(stack.id);
  if (!resultado.ok) return resultado;

  const n = Math.min(imageIds.length, resultado.factors.length);
  const usados: string[] = [];
  for (let k = 0; k < n; k++) {
    const f = resultado.factors[k]!;
    const entrada: ScalingModuleSuv = { suvbw: f.bw };
    if (f.lbm !== undefined) entrada.suvlbm = f.lbm;
    if (f.bsa !== undefined) entrada.suvbsa = f.bsa;
    fatoresPorImagem.set(imageIds[k]!, entrada);
    usados.push(imageIds[k]!);
  }
  imagensPorPilha.set(stack.id, usados);
  return resultado;
}

function esquecerImagens(stackId: string): void {
  for (const id of imagensPorPilha.get(stackId) ?? []) fatoresPorImagem.delete(id);
  imagensPorPilha.delete(stackId);
}

/** Libera os fatores e o resultado da pilha (série fechada). */
export function esquecerSuvDaPilha(stackId: string): void {
  esquecerImagens(stackId);
  resultadoPorPilha.delete(stackId);
}

/** Resultado de `computeSuv` da pilha (se for PET e já tiver sido aberta). */
export function resultadoSuv(stackId: string): SuvResult | undefined {
  return resultadoPorPilha.get(stackId);
}

/** Verdadeiro se as imagens da pilha são entregues em SUVbw. */
export function pilhaEmSuv(stackId: string): boolean {
  return (imagensPorPilha.get(stackId)?.length ?? 0) > 0;
}
