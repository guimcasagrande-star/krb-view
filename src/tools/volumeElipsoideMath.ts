/**
 * Cálculo de volume elipsoide a partir de 3 diâmetros (em mm) e detecção automática
 * de trios de medidas em 3D (2 eixos num plano + 1 eixo em plano ortogonal/oblíquo).
 *
 * Módulo 100% puro (sem Cornerstone nem DOM) para testes unitários.
 */

import { formatarNumero } from './formatoMedidas';

export type Ponto3D = [number, number, number];

export interface SegmentoMedida3D {
  /** UID da anotação a que este segmento pertence. */
  annotationUID: string;
  /** Identificador do sistema de coordenadas 3D do paciente (obrigatório para pareamento 3D). */
  frameOfReferenceUid: string;
  a: Ponto3D;
  b: Ponto3D;
  /**
   * Quando duas medidas já pertencem à mesma anotação (ex.: `OrthogonalLengths`),
   * compartilham o mesmo `parId` para serem priorizadas juntas.
   */
  parId?: string;
}

export interface ResultadoVolumeAuto {
  volumeMl: number;
  /** Os 3 diâmetros em mm (do maior para o menor). */
  diametrosMm: [number, number, number];
  /** UIDs das anotações que compõem o trio (2 se houver `OrthogonalLengths` + `Length`, ou 3 `Length`). */
  annotationUIDs: string[];
}

/**
 * Volume do elipsoide a partir de 3 diâmetros em milímetros, devolvido em mL (cm³):
 *
 *   V = (π / 6) × D1 × D2 × D3   (com D em cm → divide por 1000 para mm³ → mL)
 */
export function calcularVolumeElipsoideMl(d1Mm: number, d2Mm: number, d3Mm: number): number {
  if (
    !Number.isFinite(d1Mm) ||
    !Number.isFinite(d2Mm) ||
    !Number.isFinite(d3Mm) ||
    d1Mm <= 0 ||
    d2Mm <= 0 ||
    d3Mm <= 0
  ) {
    return 0;
  }
  return (Math.PI / 6000) * d1Mm * d2Mm * d3Mm;
}

/** Formata volume elipsoide em mL com vírgula decimal (padrão pt-BR). */
export function formatarVolumeElipsoide(volumeMl: number, casas = 1): string {
  return `Vol. ${formatarNumero(volumeMl, casas)} mL`;
}

function sub(a: Ponto3D, b: Ponto3D): Ponto3D {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Ponto3D, b: Ponto3D): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Ponto3D, b: Ponto3D): Ponto3D {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function norm(a: Ponto3D): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function pontoMedio(a: Ponto3D, b: Ponto3D): Ponto3D {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/** Menor distância euclidiana 3D entre dois segmentos fechados P0–P1 e Q0–Q1 (Ericson, Real-Time Collision Detection). */
export function distanciaEntreSegmentos3D(p0: Ponto3D, p1: Ponto3D, q0: Ponto3D, q1: Ponto3D): number {
  const d1 = sub(p1, p0);
  const d2 = sub(q1, q0);
  const r = sub(p0, q0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  const EPS = 1e-9;

  let s = 0;
  let t = 0;

  if (a <= EPS && e <= EPS) {
    return norm(r);
  }
  if (a <= EPS) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const c1: Ponto3D = [p0[0] + d1[0] * s, p0[1] + d1[1] * s, p0[2] + d1[2] * s];
  const c2: Ponto3D = [q0[0] + d2[0] * t, q0[1] + d2[1] * t, q0[2] + d2[2] * t];
  return norm(sub(c1, c2));
}

interface SegPreparado {
  idx: number;
  seg: SegmentoMedida3D;
  len: number;
  dir: Ponto3D;
  mid: Ponto3D;
}

/** Comprimento mínimo (mm) para um segmento participar do cálculo automático. */
const COMPRIMENTO_MIN_MM = 2;
/** Produto misto mínimo |u1 · (u2 × u3)| para garantir 3 eixos realmente tridimensionais (rejeita 3 linhas coplanares). */
const DET_MIN_3D = 0.45;

function parProximo(a: SegPreparado, b: SegPreparado): { ok: boolean; distSeg: number; distMid: number } {
  const distMid = norm(sub(a.mid, b.mid));
  const maxLen = Math.max(a.len, b.len);
  const limMid = 0.65 * maxLen + 8;
  if (distMid > limMid) return { ok: false, distSeg: Infinity, distMid };

  const distSeg = distanciaEntreSegmentos3D(a.seg.a, a.seg.b, b.seg.a, b.seg.b);
  const minLen = Math.min(a.len, b.len);
  const limSeg = 0.35 * minLen + 6;
  return { ok: distSeg <= limSeg, distSeg, distMid };
}

/**
 * Agrupa medidas lineares 3D no mesmo `FrameOfReferenceUID` em trios compatíveis com os
 * 3 eixos de um mesmo elipsoide (2 medidas aproximadamente perpendiculares num plano + 1 no
 * plano ortogonal/oblíquo, passando pela mesma região 3D).
 *
 * Devolve um `Map<annotationUID, ResultadoVolumeAuto>` para cada anotação que integra um trio.
 */
export function detectarVolumesElipsoideAuto(
  segmentos: SegmentoMedida3D[],
): Map<string, ResultadoVolumeAuto> {
  const resultado = new Map<string, ResultadoVolumeAuto>();
  if (segmentos.length < 3) return resultado;

  // Agrupa por FrameOfReferenceUID
  const porFor = new Map<string, SegPreparado[]>();
  segmentos.forEach((seg, idx) => {
    if (!seg.frameOfReferenceUid) return;
    const v = sub(seg.b, seg.a);
    const len = norm(v);
    if (!Number.isFinite(len) || len < COMPRIMENTO_MIN_MM) return;
    const prep: SegPreparado = {
      idx,
      seg,
      len,
      dir: [v[0] / len, v[1] / len, v[2] / len],
      mid: pontoMedio(seg.a, seg.b),
    };
    let lista = porFor.get(seg.frameOfReferenceUid);
    if (!lista) {
      lista = [];
      porFor.set(seg.frameOfReferenceUid, lista);
    }
    lista.push(prep);
  });

  for (const lista of porFor.values()) {
    const n = lista.length;
    if (n < 3) continue;

    interface Candidato {
      i: number;
      j: number;
      k: number;
      score: number;
      temParOrtogonal: boolean;
    }

    const candidatos: Candidato[] = [];

    for (let i = 0; i < n - 2; i++) {
      const si = lista[i]!;
      for (let j = i + 1; j < n - 1; j++) {
        const sj = lista[j]!;
        const pIJ = parProximo(si, sj);
        if (!pIJ.ok) continue;

        for (let k = j + 1; k < n; k++) {
          const sk = lista[k]!;
          // Se dois segmentos pertencem à mesma anotação `OrthogonalLengths`, o 3º não pode ser dela também
          if (si.seg.parId && sj.seg.parId && sk.seg.parId && si.seg.parId === sj.seg.parId && sj.seg.parId === sk.seg.parId) {
            continue;
          }

          const det = Math.abs(dot(si.dir, cross(sj.dir, sk.dir)));
          if (det < DET_MIN_3D) continue;

          const pIK = parProximo(si, sk);
          if (!pIK.ok) continue;
          const pJK = parProximo(sj, sk);
          if (!pJK.ok) continue;

          const escala = Math.max(si.len, sj.len, sk.len, 1);
          const distSegMedia = (pIJ.distSeg + pIK.distSeg + pJK.distSeg) / (3 * escala);
          const distMidMedia = (pIJ.distMid + pIK.distMid + pJK.distMid) / (3 * escala);
          const temParOrtogonal =
            (si.seg.parId !== undefined && si.seg.parId === sj.seg.parId) ||
            (si.seg.parId !== undefined && si.seg.parId === sk.seg.parId) ||
            (sj.seg.parId !== undefined && sj.seg.parId === sk.seg.parId);

          // Menor score = trio mais compacto e ortogonal; prioriza pares já criados com Medidas Ortogonais
          const score = distSegMedia * 2 + distMidMedia - det * 0.5 - (temParOrtogonal ? 0.35 : 0);
          candidatos.push({ i, j, k, score, temParOrtogonal });
        }
      }
    }

    candidatos.sort((a, b) => a.score - b.score);

    const usadosSeg = new Set<number>();
    const usadosPar = new Set<string>();

    for (const c of candidatos) {
      const s1 = lista[c.i]!;
      const s2 = lista[c.j]!;
      const s3 = lista[c.k]!;
      if (usadosSeg.has(s1.idx) || usadosSeg.has(s2.idx) || usadosSeg.has(s3.idx)) continue;

      // Se um segmento de um `OrthogonalLengths` entra no trio, o outro segmento do par também deve estar nele
      const paresNoTrio = [s1.seg.parId, s2.seg.parId, s3.seg.parId].filter((p): p is string => !!p);
      let parIncompleto = false;
      for (const pId of new Set(paresNoTrio)) {
        if (usadosPar.has(pId)) {
          parIncompleto = true;
          break;
        }
        const contagem = paresNoTrio.filter((x) => x === pId).length;
        if (contagem !== 2) {
          parIncompleto = true;
          break;
        }
      }
      if (parIncompleto) continue;

      usadosSeg.add(s1.idx);
      usadosSeg.add(s2.idx);
      usadosSeg.add(s3.idx);
      for (const pId of paresNoTrio) usadosPar.add(pId);

      const volumeMl = calcularVolumeElipsoideMl(s1.len, s2.len, s3.len);
      const ordenados = [s1.len, s2.len, s3.len].sort((a, b) => b - a) as [number, number, number];
      const uids = [...new Set([s1.seg.annotationUID, s2.seg.annotationUID, s3.seg.annotationUID])];
      const res: ResultadoVolumeAuto = {
        volumeMl,
        diametrosMm: ordenados,
        annotationUIDs: uids,
      };
      for (const uid of uids) resultado.set(uid, res);
    }
  }

  return resultado;
}
