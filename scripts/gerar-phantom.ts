/**
 * Gera exames sintéticos (sem nenhum dado de paciente) para testar o
 * visualizador: um PET/CT "atual" e uma TC "anterior" para a comparação.
 *
 * Uso:  npm run phantom            (grava em test-data/phantom)
 *       npm run phantom -- pasta   (grava em outra pasta)
 *
 * Os valores são conhecidos de antemão, então servem de gabarito:
 *
 *   PET (fundo SUV 1,00)
 *     lesão A: esfera de 15 mm de raio, SUV 10,00, centro em (-60, 0, 128) mm
 *     lesão B: esfera de  8 mm de raio, SUV  5,00, centro em ( 70, 30, 180) mm
 *   TC
 *     corpo 40 HU, ar -1000 HU, "coluna" 700 HU, lesões A e B com 80 HU
 *   TC anterior (outro referencial, mesa 37 mm deslocada, cortes de 5 mm)
 *     lesão A com 10 mm de raio
 *
 * Parâmetros do PET: 70 kg, 1,75 m, masculino, 370 MBq de F-18 às 13:30,
 * aquisição às 14:30. Fator de SUVbw esperado: 0,000276336681717643.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { el, writeDicom, type DicomElement } from '../tests/helpers/dicomWriter.ts';

const UID_ROOT = '1.2.826.0.1.3680043.8.498.77';

export const PHANTOM = {
  weightKg: 70,
  heightM: 1.75,
  doseBq: 370e6,
  halfLifeS: 6586.2,
  suvFactor: 70000 / (370e6 * 2 ** (-3600 / 6586.2)),
  petSlope: 2,
  background: 1,
  lesionA: { center: [-60, 0, 128] as [number, number, number], radius: 15, suv: 10 },
  lesionB: { center: [70, 30, 180] as [number, number, number], radius: 8, suv: 5 },
};

interface SeriesSpec {
  folder: string;
  modality: 'CT' | 'PT';
  studyUid: string;
  seriesUid: string;
  frameUid: string;
  studyDate: string;
  seriesNumber: number;
  description: string;
  size: number;
  pixelMm: number;
  sliceMm: number;
  slices: number;
  /** z do primeiro corte (mm). */
  z0: number;
  /** Valor físico (HU ou Bq/mL) na posição do paciente. */
  value: (x: number, y: number, z: number) => number;
  slope: number;
  intercept: number;
  window: [number, number];
}

function inSphere(x: number, y: number, z: number, c: [number, number, number], r: number): boolean {
  return Math.hypot(x - c[0], y - c[1], z - c[2]) <= r;
}

function inBody(x: number, y: number): boolean {
  return (x / 160) ** 2 + (y / 110) ** 2 <= 1;
}

function ctValue(lesionARadius: number, zShift: number) {
  return (x: number, y: number, zRaw: number): number => {
    const z = zRaw - zShift;
    if (!inBody(x, y)) return -1000;
    if (Math.hypot(x, y - 70) <= 18) return 700;
    if (inSphere(x, y, z, PHANTOM.lesionA.center, lesionARadius)) return 80;
    if (inSphere(x, y, z, PHANTOM.lesionB.center, PHANTOM.lesionB.radius)) return 80;
    return 40;
  };
}

function petValue(x: number, y: number, z: number): number {
  let suv = 0;
  if (inBody(x, y)) suv = PHANTOM.background;
  if (inSphere(x, y, z, PHANTOM.lesionA.center, PHANTOM.lesionA.radius)) suv = PHANTOM.lesionA.suv;
  if (inSphere(x, y, z, PHANTOM.lesionB.center, PHANTOM.lesionB.radius)) suv = PHANTOM.lesionB.suv;
  return suv / PHANTOM.suvFactor;
}

function buildSeries(spec: SeriesSpec): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const half = ((spec.size - 1) * spec.pixelMm) / 2;
  for (let k = 0; k < spec.slices; k++) {
    const z = spec.z0 + k * spec.sliceMm;
    const pixels = new Uint16Array(spec.size * spec.size);
    for (let j = 0; j < spec.size; j++) {
      for (let i = 0; i < spec.size; i++) {
        const physical = spec.value(-half + i * spec.pixelMm, -half + j * spec.pixelMm, z);
        const stored = Math.round((physical - spec.intercept) / spec.slope);
        pixels[j * spec.size + i] = Math.max(0, Math.min(65535, stored));
      }
    }

    const sopUid = `${spec.seriesUid}.${k + 1}`;
    const elements: DicomElement[] = [
      el('00080005', 'CS', 'ISO_IR 100'),
      el('00080008', 'CS', 'ORIGINAL\\PRIMARY\\AXIAL'),
      el(
        '00080016',
        'UI',
        spec.modality === 'CT' ? '1.2.840.10008.5.1.4.1.1.2' : '1.2.840.10008.5.1.4.1.1.128',
      ),
      el('00080018', 'UI', sopUid),
      el('00080020', 'DA', spec.studyDate),
      el('00080021', 'DA', spec.studyDate),
      el('00080022', 'DA', spec.studyDate),
      el('00080030', 'TM', '142000'),
      el('00080031', 'TM', '143000'),
      el('00080032', 'TM', '143000'),
      el('00080050', 'SH', 'PHANTOM'),
      el('00080060', 'CS', spec.modality),
      el('00080070', 'LO', 'PHANTOM SINTETICO'),
      el('00081030', 'LO', 'PHANTOM PET/CT'),
      el('0008103e', 'LO', spec.description),
      el('00100010', 'PN', 'PHANTOM^SUV'),
      el('00100020', 'LO', 'PHANTOM001'),
      el('00100030', 'DA', '19700101'),
      el('00100040', 'CS', 'M'),
      el('00101020', 'DS', String(PHANTOM.heightM)),
      el('00101030', 'DS', String(PHANTOM.weightKg)),
      el('00180050', 'DS', String(spec.sliceMm)),
      el('00185100', 'CS', 'HFS'),
      el('0020000d', 'UI', spec.studyUid),
      el('0020000e', 'UI', spec.seriesUid),
      el('00200010', 'SH', '1'),
      el('00200011', 'IS', String(spec.seriesNumber)),
      el('00200013', 'IS', String(k + 1)),
      el('00200032', 'DS', `${-half}\\${-half}\\${z}`),
      el('00200037', 'DS', '1\\0\\0\\0\\1\\0'),
      el('00200052', 'UI', spec.frameUid),
      el('00201041', 'DS', String(z)),
      el('00280002', 'US', 1),
      el('00280004', 'CS', 'MONOCHROME2'),
      el('00280010', 'US', spec.size),
      el('00280011', 'US', spec.size),
      el('00280030', 'DS', `${spec.pixelMm}\\${spec.pixelMm}`),
      el('00280100', 'US', 16),
      el('00280101', 'US', 16),
      el('00280102', 'US', 15),
      el('00280103', 'US', 0),
      el('00281050', 'DS', String(spec.window[0])),
      el('00281051', 'DS', String(spec.window[1])),
      el('00281052', 'DS', String(spec.intercept)),
      el('00281053', 'DS', String(spec.slope)),
      el('7fe00010', 'OW', new Uint8Array(pixels.buffer)),
    ];

    if (spec.modality === 'PT') {
      elements.push(
        el('00280051', 'CS', 'DECY\\ATTN\\SCAT\\DTIM\\RAN\\NORM'),
        el('00181242', 'IS', '120000'),
        el('00540016', 'SQ', [
          [
            el('00180031', 'LO', 'FDG'),
            el('00181072', 'TM', '133000.00'),
            el('00181074', 'DS', String(PHANTOM.doseBq)),
            el('00181075', 'DS', String(PHANTOM.halfLifeS)),
            el('00181078', 'DT', `${spec.studyDate}133000.00`),
          ],
        ]),
        el('00540081', 'US', spec.slices),
        el('00541000', 'CS', 'WHOLE BODY\\IMAGE'),
        el('00541001', 'CS', 'BQML'),
        el('00541002', 'CS', 'EMISSION'),
        el('00541102', 'CS', 'START'),
        el('00541300', 'DS', '0'),
        el('00541330', 'US', k + 1),
      );
    }

    const name = `IM${String(k + 1).padStart(4, '0')}.dcm`;
    files.set(join(spec.folder, name), writeDicom(elements));
  }
  return files;
}

/** Monta todos os arquivos do phantom em memória: caminho relativo -> bytes. */
export function buildPhantom(): Map<string, Uint8Array> {
  const current = `${UID_ROOT}.1`;
  const previous = `${UID_ROOT}.2`;
  const specs: SeriesSpec[] = [
    {
      folder: join('atual', 'CT'),
      modality: 'CT',
      studyUid: current,
      seriesUid: `${current}.2`,
      frameUid: `${current}.99`,
      studyDate: '20260115',
      seriesNumber: 2,
      description: 'CT PHANTOM 3MM',
      size: 128,
      pixelMm: 3,
      sliceMm: 3,
      slices: 86,
      z0: 0,
      value: ctValue(PHANTOM.lesionA.radius, 0),
      slope: 1,
      intercept: -1024,
      window: [40, 400],
    },
    {
      folder: join('atual', 'PT'),
      modality: 'PT',
      studyUid: current,
      seriesUid: `${current}.3`,
      frameUid: `${current}.99`,
      studyDate: '20260115',
      seriesNumber: 3,
      description: 'PET PHANTOM AC',
      size: 96,
      pixelMm: 4,
      sliceMm: 4,
      slices: 64,
      z0: 0,
      value: petValue,
      slope: PHANTOM.petSlope,
      intercept: 0,
      window: [9000, 18000],
    },
    {
      folder: join('anterior', 'CT'),
      modality: 'CT',
      studyUid: previous,
      seriesUid: `${previous}.2`,
      frameUid: `${previous}.99`,
      studyDate: '20250710',
      seriesNumber: 2,
      description: 'CT PHANTOM 5MM ANTERIOR',
      size: 128,
      pixelMm: 3,
      sliceMm: 5,
      slices: 52,
      z0: 37,
      value: ctValue(10, 37),
      slope: 1,
      intercept: -1024,
      window: [40, 400],
    },
  ];

  const files = new Map<string, Uint8Array>();
  for (const spec of specs) {
    for (const [path, bytes] of buildSeries(spec)) files.set(path, bytes);
  }
  return files;
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false;
if (invoked) {
  const out = process.argv[2] ?? join('test-data', 'phantom');
  const files = buildPhantom();
  for (const [path, bytes] of files) {
    const full = join(out, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  console.log(`${files.size} arquivos gravados em ${out}`);
}
