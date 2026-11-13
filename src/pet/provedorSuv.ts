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
import type { InstanceMeta } from '../io/types';
import { computeSuv, type SuvResult } from './suv';

/** Formato esperado pelo loader (e por `utilities.isPTPrescaledWithSUV`). */
export interface ScalingModuleSuv {
  suvbw: number;
  suvlbm?: number;
  suvbsa?: number;
}

/**
 * Valores que o usuário corrigiu no painel "Dados PET" (valem só nesta sessão; o arquivo DICOM
 * nunca é alterado). Datas e horas no formato DICOM DT: AAAAMMDDHHMMSS.
 */
export interface CorrecoesPet {
  pesoKg?: number;
  alturaM?: number;
  /** Dose injetada em Bq. */
  doseBq?: number;
  injecaoDT?: string;
  aquisicaoDT?: string;
}

/** Escala em que o PET é entregue: SUVbw (padrão), SUL (massa magra) ou SUVbsa (superfície corporal). */
export type EscalaSuv = 'bw' | 'lbm' | 'bsa';

const escalaPorPilha = new Map<string, EscalaSuv>();

export function escalaDaPilha(stackId: string): EscalaSuv {
  return escalaPorPilha.get(stackId) ?? 'bw';
}

export function definirEscalaDaPilha(stackId: string, e: EscalaSuv): void {
  if (e === 'bw') escalaPorPilha.delete(stackId);
  else escalaPorPilha.set(stackId, e);
}

/** Nome da unidade mostrada: SUVbw, SUL, SUVbsa ou Bq/mL (quando não há SUV). */
export function unidadeDaPilha(stackId: string): string {
  if (!pilhaEmSuv(stackId)) return 'Bq/mL';
  const e = escalaDaPilha(stackId);
  return e === 'lbm' ? 'SUL' : e === 'bsa' ? 'SUVbsa' : 'SUVbw';
}

const correcoesPorPilha = new Map<string, CorrecoesPet>();

export function correcoesDaPilha(stackId: string): CorrecoesPet | undefined {
  return correcoesPorPilha.get(stackId);
}

export function definirCorrecoesDaPilha(stackId: string, c: CorrecoesPet | null): void {
  if (c && Object.values(c).some((v) => v !== undefined)) correcoesPorPilha.set(stackId, c);
  else correcoesPorPilha.delete(stackId);
}

/** Cópias das instâncias com as correções do usuário aplicadas (as originais não mudam). */
export function instanciasComCorrecoes(instances: InstanceMeta[], c: CorrecoesPet | undefined): InstanceMeta[] {
  if (!c) return instances;
  const injHora = c.injecaoDT?.slice(8, 14);
  const aqData = c.aquisicaoDT?.slice(0, 8);
  const aqHora = c.aquisicaoDT?.slice(8, 14);
  return instances.map((i) => {
    const pet = { ...(i.pet ?? { correctedImage: [] }) };
    if (c.doseBq !== undefined) pet.radionuclideTotalDoseBq = c.doseBq;
    if (c.injecaoDT) {
      pet.radiopharmaceuticalStartDateTime = c.injecaoDT;
      pet.radiopharmaceuticalStartTime = injHora;
    }
    const novo: InstanceMeta = { ...i, pet };
    if (c.pesoKg !== undefined) novo.patientWeightKg = c.pesoKg;
    if (c.alturaM !== undefined) novo.patientSizeM = c.alturaM;
    if (c.aquisicaoDT) {
      // O horário escolhido vale como início da aquisição: sem tags alternativas que o contradigam.
      novo.seriesDate = aqData;
      novo.seriesTime = aqHora;
      novo.acquisitionDate = aqData;
      novo.acquisitionTime = aqHora;
      delete pet.gePrivateScanDateTime;
      delete pet.frameReferenceTimeMs;
      delete pet.actualFrameDurationMs;
    }
    return novo;
  });
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

  const resultado = computeSuv(instanciasComCorrecoes(stack.instances, correcoesPorPilha.get(stack.id)));
  resultadoPorPilha.set(stack.id, resultado);
  esquecerImagens(stack.id);
  if (!resultado.ok) return resultado;

  const escala = escalaDaPilha(stack.id);
  const n = Math.min(imageIds.length, resultado.factors.length);
  const usados: string[] = [];
  for (let k = 0; k < n; k++) {
    const f = resultado.factors[k]!;
    // O loader aplica o fator `suvbw` aos pixels: para SUL ou SUVbsa, entrega-se o fator escolhido
    // nesse campo (se não existir para a série, fica em SUVbw).
    const escolhido = escala === 'lbm' ? f.lbm : escala === 'bsa' ? f.bsa : undefined;
    const entrada: ScalingModuleSuv = { suvbw: escolhido ?? f.bw };
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
  correcoesPorPilha.delete(stackId);
  escalaPorPilha.delete(stackId);
}

/** Resultado de `computeSuv` da pilha (se for PET e já tiver sido aberta). */
export function resultadoSuv(stackId: string): SuvResult | undefined {
  return resultadoPorPilha.get(stackId);
}

/** Verdadeiro se as imagens da pilha são entregues em SUVbw. */
export function pilhaEmSuv(stackId: string): boolean {
  return (imagensPorPilha.get(stackId)?.length ?? 0) > 0;
}
