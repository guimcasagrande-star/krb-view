import * as dicomParserModule from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import { anonimizarDicom, garantirPart10, gerarUidDicom } from '../src/export/anonimizarDicom';
import { caminhoDicomdir, gerarDicomdir } from '../src/export/dicomdir';
import { parseHeader } from '../src/io/readHeader';
import { computeSuv } from '../src/pet/suv';
import { concat } from '../src/pacs/pdu';
import { TS } from '../src/pacs/uids';

const dicomParser: typeof dicomParserModule =
  (dicomParserModule as unknown as { default?: typeof dicomParserModule }).default ??
  dicomParserModule;

/** Monta um elemento Explicit VR Little Endian sintético para testes. */
function el(group: number, element: number, vr: string, valor: Uint8Array): Uint8Array {
  const longo = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
  const cab = new Uint8Array(longo ? 12 : 8);
  const v = new DataView(cab.buffer);
  v.setUint16(0, group, true);
  v.setUint16(2, element, true);
  cab[4] = vr.charCodeAt(0);
  cab[5] = vr.charCodeAt(1);
  if (longo) v.setUint32(8, valor.length, true);
  else v.setUint16(6, valor.length, true);
  return concat([cab, valor]);
}

function str(texto: string, pad = 0x20): Uint8Array {
  const par = texto.length + (texto.length % 2);
  const b = new Uint8Array(par);
  for (let i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i);
  if (texto.length % 2 === 1) b[texto.length] = pad;
  return b;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function montarItemSeq(elementos: Uint8Array[]): Uint8Array {
  const corpo = concat(elementos);
  const cab = new Uint8Array(8);
  const v = new DataView(cab.buffer);
  v.setUint16(0, 0xfffe, true);
  v.setUint16(2, 0xe000, true);
  v.setUint32(4, corpo.length, true);
  return concat([cab, corpo]);
}

/** Cria um DICOM Part 10 completo (com tags identificadoras, PET RadiopharmaceuticalSequence e PixelData). */
function criarDicomSintetico(opts: {
  modality: 'CT' | 'PT';
  sopClassUid: string;
  sopInstanceUid: string;
  studyUid: string;
  seriesUid: string;
  frameOfReferenceUid: string;
  pixelBytes: Uint8Array;
}): Uint8Array {
  const metaCorpo = concat([
    el(0x0002, 0x0001, 'OB', Uint8Array.of(0, 1)),
    el(0x0002, 0x0002, 'UI', str(opts.sopClassUid, 0)),
    el(0x0002, 0x0003, 'UI', str(opts.sopInstanceUid, 0)),
    el(0x0002, 0x0010, 'UI', str(TS.explicitVrLittleEndian, 0)),
    el(0x0002, 0x0016, 'AE', str('PACS_HOSP_A')),
  ]);
  const pre = new Uint8Array(132);
  pre.set([0x44, 0x49, 0x43, 0x4d], 128);
  const meta = concat([pre, el(0x0002, 0x0000, 'UL', u32(metaCorpo.length)), metaCorpo]);

  const elementos: Uint8Array[] = [
    el(0x0008, 0x0005, 'CS', str('ISO_IR 100')),
    el(0x0008, 0x0016, 'UI', str(opts.sopClassUid, 0)),
    el(0x0008, 0x0018, 'UI', str(opts.sopInstanceUid, 0)),
    el(0x0008, 0x0020, 'DA', str('20261110')),
    el(0x0008, 0x0021, 'DA', str('20261110')),
    el(0x0008, 0x0022, 'DA', str('20261110')),
    el(0x0008, 0x0030, 'TM', str('090000')),
    el(0x0008, 0x0031, 'TM', str('100000')),
    el(0x0008, 0x0032, 'TM', str('100000')),
    el(0x0008, 0x0050, 'SH', str('ACC998877')),
    el(0x0008, 0x0060, 'CS', str(opts.modality)),
    el(0x0008, 0x0080, 'LO', str('HOSPITAL CENTRAL')),
    el(0x0008, 0x0090, 'PN', str('DR^SILVA')),
    el(0x0008, 0x1010, 'SH', str('TOMOGRAFO_01')),
    el(0x0008, 0x1030, 'LO', str('PET CT ONCOLOGICO')),
    el(0x0008, 0x103e, 'LO', str(opts.modality === 'PT' ? 'PET AC' : 'CT TORAX')),
    el(0x0008, 0x1050, 'PN', str('DR^EXECUTANTE')),
    el(0x0008, 0x1070, 'PN', str('TEC^OPERADOR')),
    el(0x0010, 0x0010, 'PN', str('PACIENTE^REAL')),
    el(0x0010, 0x0020, 'LO', str('PRONT12345')),
    el(0x0010, 0x0030, 'DA', str('19800515')),
    el(0x0010, 0x0040, 'CS', str('M')),
    el(0x0010, 0x1020, 'DS', str('1.75')),
    el(0x0010, 0x1030, 'DS', str('70')),
    el(0x0010, 0x1040, 'LO', str('RUA DAS FLORES 100')),
    el(0x0020, 0x000d, 'UI', str(opts.studyUid, 0)),
    el(0x0020, 0x000e, 'UI', str(opts.seriesUid, 0)),
    el(0x0020, 0x0010, 'SH', str('ST123')),
    el(0x0020, 0x0011, 'IS', str(opts.modality === 'CT' ? '1' : '2')),
    el(0x0020, 0x0013, 'IS', str('1')),
    el(0x0020, 0x0052, 'UI', str(opts.frameOfReferenceUid, 0)),
    el(0x0028, 0x0002, 'US', u16(1)),
    el(0x0028, 0x0004, 'CS', str('MONOCHROME2')),
    el(0x0028, 0x0010, 'US', u16(2)),
    el(0x0028, 0x0011, 'US', u16(2)),
    el(0x0028, 0x0100, 'US', u16(16)),
    el(0x0028, 0x0101, 'US', u16(16)),
    el(0x0028, 0x0102, 'US', u16(15)),
    el(0x0028, 0x0103, 'US', u16(0)),
    el(0x0028, 0x1052, 'DS', str('0')),
    el(0x0028, 0x1053, 'DS', str('1')),
  ];

  if (opts.modality === 'PT') {
    const radioItem = montarItemSeq([
      el(0x0018, 0x0031, 'LO', str('FDG')),
      el(0x0018, 0x1072, 'TM', str('090000')),
      el(0x0018, 0x1074, 'DS', str('370000000')),
      el(0x0018, 0x1075, 'DS', str('6586.2')),
    ]);
    elementos.push(
      el(0x0028, 0x0051, 'CS', str('ATTN\\DECY')),
      el(0x0054, 0x0016, 'SQ', radioItem),
      el(0x0054, 0x1001, 'CS', str('BQML')),
      el(0x0054, 0x1102, 'CS', str('START')),
    );
  }

  elementos.push(el(0x7fe0, 0x0010, 'OW', opts.pixelBytes));
  return concat([meta, ...elementos]);
}

describe('anonimizarDicom', () => {
  it('remove dados identificadores, preserva peso/altura/sexo/horários/PET SUV e remapeia UIDs de forma coerente', () => {
    const pixelsCt = Uint8Array.of(10, 0, 20, 0, 30, 0, 40, 0);
    const pixelsPet = Uint8Array.of(100, 0, 200, 0, 50, 0, 25, 0);
    const estudoOrig = '1.2.3.4.100';
    const frameOrig = '1.2.3.4.999';

    const ctBytes = criarDicomSintetico({
      modality: 'CT',
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUid: '1.2.3.4.100.1.1',
      studyUid: estudoOrig,
      seriesUid: '1.2.3.4.100.1',
      frameOfReferenceUid: frameOrig,
      pixelBytes: pixelsCt,
    });
    const petBytes = criarDicomSintetico({
      modality: 'PT',
      sopClassUid: '1.2.840.10008.5.1.4.1.1.128',
      sopInstanceUid: '1.2.3.4.100.2.1',
      studyUid: estudoOrig,
      seriesUid: '1.2.3.4.100.2',
      frameOfReferenceUid: frameOrig,
      pixelBytes: pixelsPet,
    });

    const mapaUids = new Map<string, string>();
    const resCt = anonimizarDicom(ctBytes, { rotuloPaciente: 'CASO_01', mapaUids });
    const resPet = anonimizarDicom(petBytes, { rotuloPaciente: 'CASO_01', mapaUids });

    // Lê de volta com dicom-parser e parseHeader (garante Part 10 íntegro)
    const dsCt = dicomParser.parseDicom(resCt.bytes);
    const dsPet = dicomParser.parseDicom(resPet.bytes);
    const headCt = parseHeader(resCt.bytes, 'ct');
    const headPet = parseHeader(resPet.bytes, 'pet');
    const headPetOrig = parseHeader(petBytes, 'pet-orig');

    expect(headCt.ok && headPet.ok && headPetOrig.ok).toBe(true);
    if (!headCt.ok || !headPet.ok || !headPetOrig.ok) return;

    // Identificadores removidos/substituídos
    expect(headCt.meta.patientName).toBe('CASO_01');
    expect(headCt.meta.patientId).toBe('CASO_01');
    expect(headCt.meta.patientBirthDate).toBeUndefined();
    expect(headCt.meta.accessionNumber).toBeUndefined();
    expect(dsCt.string('x00080080')).toBeUndefined(); // InstitutionName removido
    expect(dsCt.string('x00080090') ?? '').toBe(''); // ReferringPhysicianName vazio
    expect(dsCt.string('x00081050')).toBeUndefined(); // PerformingPhysicianName removido
    expect(dsCt.string('x00081070')).toBeUndefined(); // OperatorsName removido
    expect(dsCt.string('x00101040')).toBeUndefined(); // PatientAddress removido
    expect(dsCt.string('x00020016')).toBeUndefined(); // Source AE Title removido

    // Peso, altura, sexo e horários técnicos preservados
    expect(headCt.meta.patientSex).toBe('M');
    expect(headCt.meta.patientWeightKg).toBe(70);
    expect(headCt.meta.patientSizeM).toBe(1.75);
    expect(headCt.meta.studyDate).toBe('20261110');
    expect(headCt.meta.studyTime).toBe('090000');

    // UIDs mudaram, mas StudyInstanceUID e FrameOfReferenceUID batem entre CT e PET (fusão preservada!)
    expect(headCt.meta.studyInstanceUid).not.toBe(estudoOrig);
    expect(headCt.meta.studyInstanceUid).toBe(headPet.meta.studyInstanceUid);
    expect(headCt.meta.frameOfReferenceUid).not.toBe(frameOrig);
    expect(headCt.meta.frameOfReferenceUid).toBe(headPet.meta.frameOfReferenceUid);
    expect(dsCt.string('x00020003')).toBe(headCt.meta.sopInstanceUid);

    // PixelData intacto byte a byte
    const pxCt = dsCt.elements['x7fe00010']!;
    expect(resCt.bytes.subarray(pxCt.dataOffset, pxCt.dataOffset + pxCt.length)).toEqual(pixelsCt);
    const pxPet = dsPet.elements['x7fe00010']!;
    expect(resPet.bytes.subarray(pxPet.dataOffset, pxPet.dataOffset + pxPet.length)).toEqual(pixelsPet);

    // Cálculo de SUV no PET anonimizado bate exatamente com o original!
    const suvOrig = computeSuv([headPetOrig.meta]);
    const suvAnon = computeSuv([headPet.meta]);
    expect(suvOrig.ok && suvAnon.ok).toBe(true);
    if (suvOrig.ok && suvAnon.ok) {
      expect(suvAnon.factors[0]!.bw).toBeCloseTo(suvOrig.factors[0]!.bw, 10);
      expect(suvAnon.factors[0]!.lbm).toBeCloseTo(suvOrig.factors[0]!.lbm!, 10);
      expect(suvAnon.factors[0]!.bsa).toBeCloseTo(suvOrig.factors[0]!.bsa!, 10);
    }
  });

  it('preserva PixelData encapsulado (sintaxe comprimida JPEG 2000) byte a byte', () => {
    const metaCorpo = concat([
      el(0x0002, 0x0001, 'OB', Uint8Array.of(0, 1)),
      el(0x0002, 0x0002, 'UI', str('1.2.840.10008.5.1.4.1.1.2', 0)),
      el(0x0002, 0x0003, 'UI', str('1.2.3.4.50', 0)),
      el(0x0002, 0x0010, 'UI', str(TS.jpeg2000Lossless, 0)),
    ]);
    const pre = new Uint8Array(132);
    pre.set([0x44, 0x49, 0x43, 0x4d], 128);
    const meta = concat([pre, el(0x0002, 0x0000, 'UL', u32(metaCorpo.length)), metaCorpo]);

    // PixelData encapsulado (comprimento indefinido 0xFFFFFFFF + Basic Offset Table + fragmento + FFFE,E0DD)
    const cabPx = new Uint8Array(12);
    const vp = new DataView(cabPx.buffer);
    vp.setUint16(0, 0x7fe0, true);
    vp.setUint16(2, 0x0010, true);
    cabPx[4] = 0x4f; // 'O'
    cabPx[5] = 0x42; // 'B'
    vp.setUint32(8, 0xffffffff, true);
    const bot = montarItemSeq([]);
    const frame = montarItemSeq([Uint8Array.of(0xff, 0x4f, 0xff, 0x51, 0xde, 0xad, 0xbe, 0xef)]);
    const fim = new Uint8Array(8);
    const vf = new DataView(fim.buffer);
    vf.setUint16(0, 0xfffe, true);
    vf.setUint16(2, 0xe0dd, true);
    const pixelEncapsulado = concat([cabPx, bot, frame, fim]);

    const dcm = concat([
      meta,
      el(0x0008, 0x0016, 'UI', str('1.2.840.10008.5.1.4.1.1.2', 0)),
      el(0x0008, 0x0018, 'UI', str('1.2.3.4.50', 0)),
      el(0x0010, 0x0010, 'PN', str('PACIENTE^COMPRIMIDO')),
      el(0x0010, 0x0020, 'LO', str('ID999')),
      el(0x0020, 0x000d, 'UI', str('1.2.3.4', 0)),
      el(0x0020, 0x000e, 'UI', str('1.2.3.4.1', 0)),
      pixelEncapsulado,
    ]);

    const res = anonimizarDicom(dcm, { rotuloPaciente: 'ANON_J2K' });
    expect(res.transferSyntaxUid).toBe(TS.jpeg2000Lossless);
    expect(res.bytes.subarray(res.bytes.length - pixelEncapsulado.length)).toEqual(pixelEncapsulado);
    const ds = dicomParser.parseDicom(res.bytes);
    expect(ds.string('x00100010')).toBe('ANON_J2K');
    expect(ds.string('x00020010')).toBe(TS.jpeg2000Lossless);
  });

  it('garantirPart10 preserva arquivos já Part 10 e encapsula arquivos sem preâmbulo', () => {
    const brutoSemMeta = concat([
      el(0x0008, 0x0016, 'UI', str('1.2.840.10008.5.1.4.1.1.2', 0)),
      el(0x0008, 0x0018, 'UI', str('1.2.3.4.5', 0)),
      el(0x0010, 0x0010, 'PN', str('JOAO')),
    ]);
    const garantido = garantirPart10(brutoSemMeta, {
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      sopInstanceUid: '1.2.3.4.5',
    });
    const ds = dicomParser.parseDicom(garantido.bytes);
    expect(ds.string('x00020002')).toBe('1.2.840.10008.5.1.4.1.1.2');
    expect(ds.string('x00020003')).toBe('1.2.3.4.5');
    expect(ds.string('x00100010')).toBe('JOAO');
  });

  it('gerarUidDicom gera UIDs válidos e únicos <= 64 caracteres', () => {
    const a = gerarUidDicom();
    const b = gerarUidDicom();
    expect(a).not.toBe(b);
    expect(a.startsWith('2.25.')).toBe(true);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(/^[0-9.]+$/.test(a)).toBe(true);
  });
});

describe('gerarDicomdir', () => {
  it('gera DICOMDIR válido com árvore PATIENT -> STUDY -> SERIES -> IMAGE e offsets exatos', () => {
    const caminho1 = caminhoDicomdir(0, 0, 0);
    const caminho2 = caminhoDicomdir(0, 0, 1);
    expect(caminho1).toEqual(['DICOM', 'ST000001', 'SE000001', 'IM000001']);

    const bytes = gerarDicomdir([
      {
        patientName: 'ANONIMO',
        patientId: 'ANONIMO',
        sex: 'F',
        estudos: [
          {
            studyInstanceUid: '2.25.100',
            studyDate: '20261110',
            studyTime: '093000',
            description: 'TC TORAX',
            series: [
              {
                seriesInstanceUid: '2.25.100.1',
                modality: 'CT',
                seriesNumber: 1,
                description: 'PULMAO',
                imagens: [
                  {
                    caminhoRelativo: caminho1,
                    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
                    sopInstanceUid: '2.25.100.1.1',
                    transferSyntaxUid: TS.explicitVrLittleEndian,
                    instanceNumber: 1,
                  },
                  {
                    caminhoRelativo: caminho2,
                    sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
                    sopInstanceUid: '2.25.100.1.2',
                    transferSyntaxUid: TS.explicitVrLittleEndian,
                    instanceNumber: 2,
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const ds = dicomParser.parseDicom(bytes);
    expect(ds.string('x00020002')).toBe('1.2.840.10008.1.3.10');
    expect(ds.string('x00020010')).toBe(TS.explicitVrLittleEndian);

    const seq = ds.elements['x00041220'];
    expect(seq?.items).toHaveLength(5); // PATIENT + STUDY + SERIES + 2 IMAGEs

    const tipos = seq!.items!.map((it) => it.dataSet!.string('x00041430'));
    expect(tipos).toEqual(['PATIENT', 'STUDY', 'SERIES', 'IMAGE', 'IMAGE']);

    // Offsets absolutos no DICOMDIR precisam apontar exatamente para os cabeçalhos FFFE,E000 dos registros!
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offTag = (off: number) => `${view.getUint16(off, true).toString(16)}_${view.getUint16(off + 2, true).toString(16)}`;

    const firstRoot = ds.uint32('x00041200')!;
    const lastRoot = ds.uint32('x00041202')!;
    expect(firstRoot).toBeGreaterThan(132);
    expect(firstRoot).toBe(lastRoot);
    expect(offTag(firstRoot)).toBe('fffe_e000');

    const [pat, est, ser, img1, img2] = seq!.items!.map((it) => it.dataSet!);
    // PATIENT -> lower points to STUDY
    const offStudy = pat!.uint32('x00041420')!;
    expect(offTag(offStudy)).toBe('fffe_e000');
    expect(pat!.uint32('x00041400')).toBe(0);

    // STUDY -> lower points to SERIES
    const offSeries = est!.uint32('x00041420')!;
    expect(offTag(offSeries)).toBe('fffe_e000');

    // SERIES -> lower points to IMAGE 1
    const offImg1 = ser!.uint32('x00041420')!;
    expect(offTag(offImg1)).toBe('fffe_e000');

    // IMAGE 1 -> next points to IMAGE 2; IMAGE 2 -> next = 0, lower = 0
    const offImg2 = img1!.uint32('x00041400')!;
    expect(offImg2).toBeGreaterThan(offImg1);
    expect(offTag(offImg2)).toBe('fffe_e000');
    expect(img2!.uint32('x00041400')).toBe(0);
    expect(img2!.uint32('x00041420')).toBe(0);

    expect(img1!.string('x00041500')).toBe('DICOM\\ST000001\\SE000001\\IM000001');
    expect(img2!.string('x00041500')).toBe('DICOM\\ST000001\\SE000001\\IM000002');
  });
});
