/**
 * Organiza os cabeçalhos lidos em paciente > estudo > série > pilha.
 *
 * Uma "pilha" é um conjunto de cortes que pode ser rolado como uma coisa só.
 * A maioria das séries tem uma pilha; difusão, dinâmicos e localizadores têm várias.
 */

import { analyzeStack, splitIntoStacks, type StackGeometry } from './geometry';
import type { InstanceMeta } from './types';

export type SeriesKind = 'imagem' | 'segmentacao' | 'outro';

export interface StackNode {
  /** Identificador estável: UID da série + '#' + índice da pilha. */
  id: string;
  label?: string;
  instances: InstanceMeta[];
  geometry: StackGeometry;
}

export interface SeriesNode {
  seriesInstanceUid: string;
  kind: SeriesKind;
  modality: string;
  seriesNumber?: number;
  description: string;
  date?: string;
  time?: string;
  frameOfReferenceUid?: string;
  instanceCount: number;
  stacks: StackNode[];
}

export interface StudyNode {
  studyInstanceUid: string;
  date?: string;
  time?: string;
  description: string;
  accessionNumber?: string;
  modalities: string[];
  series: SeriesNode[];
}

export interface PatientNode {
  key: string;
  patientId?: string;
  /** Nome já formatado para exibição. */
  name: string;
  birthDate?: string;
  sex?: string;
  studies: StudyNode[];
}

export interface SkippedFile {
  fileId: string;
  reason: string;
}

export interface DicomIndex {
  patients: PatientNode[];
  skipped: SkippedFile[];
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/** Comparação simples de texto; serve para datas/horas DICOM, que têm largura fixa. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dateTimeKey(date: string | undefined, time: string | undefined): string {
  return `${date ?? ''}${(time ?? '').padEnd(6, '0')}`;
}

/** 'SOBRENOME^NOME^MEIO^PREFIXO^SUFIXO' -> 'NOME MEIO SOBRENOME'. */
export function formatPersonName(value: string | undefined): string {
  if (!value) return '';
  // Só o primeiro grupo (alfabético); os grupos ideográfico e fonético vêm depois de '='.
  const alphabetic = value.split('=')[0] ?? '';
  const [family = '', given = '', middle = '', prefix = '', suffix = ''] = alphabetic
    .split('^')
    .map((p) => p.trim());
  return [prefix, given, middle, family, suffix].filter((p) => p !== '').join(' ');
}

function seriesKind(instances: InstanceMeta[]): SeriesKind {
  const modality = instances[0]?.modality ?? '';
  if (modality === 'SEG' || modality === 'RTSTRUCT') return 'segmentacao';
  const hasPixels = instances.some((i) => i.rows !== undefined && i.columns !== undefined);
  return hasPixels ? 'imagem' : 'outro';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function patientKey(i: InstanceMeta): string {
  if (i.patientId) return `id:${i.patientId}`;
  if (i.patientName) return `nome:${i.patientName}|${i.patientBirthDate ?? ''}`;
  return 'desconhecido';
}

/** Primeiro valor definido de um campo dentro de uma lista de instâncias. */
function firstDefined<K extends keyof InstanceMeta>(
  instances: InstanceMeta[],
  field: K,
): InstanceMeta[K] | undefined {
  for (const i of instances) {
    const v = i[field];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function buildSeries(seriesInstanceUid: string, instances: InstanceMeta[]): SeriesNode {
  const kind = seriesKind(instances);
  const stacks: StackNode[] =
    kind === 'imagem'
      ? splitIntoStacks(instances.filter((i) => i.rows !== undefined)).map((stack, n) => {
          const node: StackNode = {
            id: `${seriesInstanceUid}#${n}`,
            instances: stack.instances,
            geometry: analyzeStack(stack.instances),
          };
          if (stack.label) node.label = stack.label;
          return node;
        })
      : [];

  const node: SeriesNode = {
    seriesInstanceUid,
    kind,
    modality: firstDefined(instances, 'modality') ?? '',
    description: firstDefined(instances, 'seriesDescription') ?? '',
    instanceCount: instances.length,
    stacks,
  };
  const seriesNumber = firstDefined(instances, 'seriesNumber');
  if (seriesNumber !== undefined) node.seriesNumber = seriesNumber;
  const date = firstDefined(instances, 'seriesDate');
  if (date !== undefined) node.date = date;
  const time = firstDefined(instances, 'seriesTime');
  if (time !== undefined) node.time = time;
  const frame = firstDefined(instances, 'frameOfReferenceUid');
  if (frame !== undefined) node.frameOfReferenceUid = frame;
  return node;
}

function buildStudy(studyInstanceUid: string, instances: InstanceMeta[]): StudyNode {
  const bySeries = groupBy(instances, (i) => i.seriesInstanceUid ?? 'sem-uid-de-serie');
  const series = [...bySeries.entries()].map(([uid, list]) => buildSeries(uid, list));
  series.sort(
    (a, b) =>
      (a.seriesNumber ?? Number.MAX_SAFE_INTEGER) - (b.seriesNumber ?? Number.MAX_SAFE_INTEGER) ||
      compareText(dateTimeKey(a.date, a.time), dateTimeKey(b.date, b.time)) ||
      compareText(a.seriesInstanceUid, b.seriesInstanceUid),
  );

  const node: StudyNode = {
    studyInstanceUid,
    description: firstDefined(instances, 'studyDescription') ?? '',
    modalities: [...new Set(series.map((s) => s.modality).filter((m) => m !== ''))].sort(),
    series,
  };
  const date = firstDefined(instances, 'studyDate');
  if (date !== undefined) node.date = date;
  const time = firstDefined(instances, 'studyTime');
  if (time !== undefined) node.time = time;
  const accession = firstDefined(instances, 'accessionNumber');
  if (accession !== undefined) node.accessionNumber = accession;
  return node;
}

/**
 * Monta a árvore paciente > estudo > série > pilha a partir dos cabeçalhos.
 *
 * - Arquivos repetidos (mesmo SOPInstanceUID) entram uma vez só.
 * - Estudos ficam do mais recente para o mais antigo.
 * - Pacientes são separados pelo PatientID; o mesmo paciente vindo de hospitais
 *   diferentes aparece duas vezes, e a comparação deve permitir escolher
 *   quaisquer dois estudos.
 */
export function buildIndex(instances: InstanceMeta[]): DicomIndex {
  const skipped: SkippedFile[] = [];
  const seen = new Set<string>();
  const unique: InstanceMeta[] = [];
  for (const instance of instances) {
    if (instance.sopInstanceUid) {
      if (seen.has(instance.sopInstanceUid)) {
        skipped.push({ fileId: instance.fileId, reason: 'Arquivo repetido (mesma imagem já carregada).' });
        continue;
      }
      seen.add(instance.sopInstanceUid);
    }
    unique.push(instance);
  }

  const patients: PatientNode[] = [];
  for (const [key, patientInstances] of groupBy(unique, patientKey)) {
    const byStudy = groupBy(patientInstances, (i) => i.studyInstanceUid ?? 'sem-uid-de-estudo');
    const studies = [...byStudy.entries()].map(([uid, list]) => buildStudy(uid, list));
    studies.sort(
      (a, b) =>
        compareText(dateTimeKey(b.date, b.time), dateTimeKey(a.date, a.time)) ||
        compareText(a.studyInstanceUid, b.studyInstanceUid),
    );

    const node: PatientNode = {
      key,
      name: formatPersonName(firstDefined(patientInstances, 'patientName')) || 'Paciente sem nome',
      studies,
    };
    const patientId = firstDefined(patientInstances, 'patientId');
    if (patientId !== undefined) node.patientId = patientId;
    const birthDate = firstDefined(patientInstances, 'patientBirthDate');
    if (birthDate !== undefined) node.birthDate = birthDate;
    const sex = firstDefined(patientInstances, 'patientSex');
    if (sex !== undefined) node.sex = sex;
    patients.push(node);
  }
  patients.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.key, b.key));

  return { patients, skipped };
}
