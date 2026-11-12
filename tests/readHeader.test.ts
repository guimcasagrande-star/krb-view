import { describe, expect, it } from 'vitest';
import { parseHeader, readHeaderFromBlob } from '../src/io/readHeader';
import { el, writeDicom, type DicomElement } from './helpers/dicomWriter';

function ctElements(): DicomElement[] {
  return [
    el('00080005', 'CS', 'ISO_IR 100'),
    el('00080008', 'CS', 'ORIGINAL\\PRIMARY\\AXIAL'),
    el('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.2'),
    el('00080018', 'UI', '1.2.3.4.5.6'),
    el('00080020', 'DA', '20260115'),
    el('00080021', 'DA', '20260115'),
    el('00080030', 'TM', '101500'),
    el('00080031', 'TM', '101730.250'),
    el('00080060', 'CS', 'CT'),
    el('00080070', 'LO', 'ACME'),
    el('0008103e', 'LO', 'ABDOME FASE PORTAL'),
    el('00100010', 'PN', 'CONCEIÇÃO^JOÃO'),
    el('00100020', 'LO', 'ABC123'),
    el('00100040', 'CS', 'M'),
    el('00101030', 'DS', '82.5'),
    el('00180050', 'DS', '1.25'),
    el('0020000d', 'UI', '1.2.3'),
    el('0020000e', 'UI', '1.2.3.4'),
    el('00200011', 'IS', '5'),
    el('00200013', 'IS', '42'),
    el('00200032', 'DS', '-180.5\\-170.25\\-312.75'),
    el('00200037', 'DS', '1\\0\\0\\0\\1\\0'),
    el('00200052', 'UI', '1.2.3.99'),
    el('00280002', 'US', 1),
    el('00280004', 'CS', 'MONOCHROME2'),
    el('00280010', 'US', 512),
    el('00280011', 'US', 256),
    el('00280030', 'DS', '0.703125\\0.75'),
    el('00280100', 'US', 16),
    el('00280101', 'US', 12),
    el('00280103', 'US', 1),
    el('00281050', 'DS', '40\\-600'),
    el('00281051', 'DS', '400\\1500'),
    el('00281052', 'DS', '-1024'),
    el('00281053', 'DS', '1'),
    el('7fe00010', 'OW', new Uint8Array(512 * 256 * 2)),
  ];
}

function petElements(): DicomElement[] {
  return [
    el('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.128'),
    el('00080018', 'UI', '1.2.9.1'),
    el('00080021', 'DA', '20260115'),
    el('00080031', 'TM', '143000'),
    el('00080022', 'DA', '20260115'),
    el('00080032', 'TM', '143005'),
    el('00080060', 'CS', 'PT'),
    el('00090010', 'LO', 'GEMS_PETD_01'),
    el('0009100d', 'DT', '20260115142955.00'),
    el('00101020', 'DS', '1.75'),
    el('00101030', 'DS', '70'),
    el('00181242', 'IS', '180000'),
    el('0020000d', 'UI', '1.2.9'),
    el('0020000e', 'UI', '1.2.9.0'),
    el('00280010', 'US', 192),
    el('00280011', 'US', 192),
    el('00280051', 'CS', 'DECY\\ATTN\\SCAT\\DTIM'),
    el('00281053', 'DS', '0.4312'),
    el('00540016', 'SQ', [
      [
        el('00180031', 'LO', 'FDG'),
        el('00181072', 'TM', '133000.00'),
        el('00181074', 'DS', '370000000'),
        el('00181075', 'DS', '6586.2'),
        el('00181078', 'DT', '20260115133000.00'),
      ],
    ]),
    el('00541001', 'CS', 'BQML'),
    el('00541102', 'CS', 'START'),
    el('00541300', 'DS', '90000'),
    // Bloco privado Philips reservado no slot 11 (não no 10), para testar a busca do criador.
    el('70530011', 'LO', 'Philips PET Private Group'),
    el('70531100', 'DS', '0.000512'),
    el('70531109', 'DS', '1.75'),
    el('7fe00010', 'OW', new Uint8Array(64)),
  ];
}

describe('parseHeader', () => {
  it('lê os campos de uma TC', () => {
    const outcome = parseHeader(writeDicom(ctElements()), 'pasta/IM001');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.complete).toBe(true);
    const m = outcome.meta;
    expect(m.fileId).toBe('pasta/IM001');
    expect(m.transferSyntaxUid).toBe('1.2.840.10008.1.2.1');
    expect(m.sopInstanceUid).toBe('1.2.3.4.5.6');
    expect(m.modality).toBe('CT');
    expect(m.patientName).toBe('CONCEIÇÃO^JOÃO');
    expect(m.patientWeightKg).toBe(82.5);
    expect(m.seriesDescription).toBe('ABDOME FASE PORTAL');
    expect(m.seriesNumber).toBe(5);
    expect(m.instanceNumber).toBe(42);
    expect(m.seriesTime).toBe('101730.250');
    expect(m.rows).toBe(512);
    expect(m.columns).toBe(256);
    expect(m.pixelSpacing).toEqual([0.703125, 0.75]);
    expect(m.imagePositionPatient).toEqual([-180.5, -170.25, -312.75]);
    expect(m.imageOrientationPatient).toEqual([1, 0, 0, 0, 1, 0]);
    expect(m.frameOfReferenceUid).toBe('1.2.3.99');
    expect(m.imageType).toEqual(['ORIGINAL', 'PRIMARY', 'AXIAL']);
    expect(m.windowCenter).toEqual([40, -600]);
    expect(m.windowWidth).toEqual([400, 1500]);
    expect(m.rescaleIntercept).toBe(-1024);
    expect(m.rescaleSlope).toBe(1);
    expect(m.bitsAllocated).toBe(16);
    expect(m.pixelRepresentation).toBe(1);
    expect(m.pet).toBeUndefined();
    expect(m.numberOfFrames).toBeUndefined();
  });

  it('decodifica nomes em UTF-8', () => {
    const elements = ctElements().map((e) => (e.tag === '00080005' ? el('00080005', 'CS', 'ISO_IR 192') : e));
    const outcome = parseHeader(writeDicom(elements, { encoding: 'utf8' }), 'x');
    expect(outcome.ok && outcome.meta.patientName).toBe('CONCEIÇÃO^JOÃO');
  });

  it('lê os campos de PET, a sequência do radiofármaco e as tags privadas', () => {
    const outcome = parseHeader(writeDicom(petElements()), 'pet');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const pet = outcome.meta.pet!;
    expect(pet.units).toBe('BQML');
    expect(pet.correctedImage).toEqual(['DECY', 'ATTN', 'SCAT', 'DTIM']);
    expect(pet.decayCorrection).toBe('START');
    expect(pet.radionuclideTotalDoseBq).toBe(370000000);
    expect(pet.radionuclideHalfLifeS).toBe(6586.2);
    expect(pet.radiopharmaceuticalStartTime).toBe('133000.00');
    expect(pet.radiopharmaceuticalStartDateTime).toBe('20260115133000.00');
    expect(pet.radiopharmaceutical).toBe('FDG');
    expect(pet.frameReferenceTimeMs).toBe(90000);
    expect(pet.actualFrameDurationMs).toBe(180000);
    expect(pet.gePrivateScanDateTime).toBe('20260115142955.00');
    expect(pet.philipsSuvScaleFactor).toBe(0.000512);
    expect(pet.philipsActivityConcentrationScaleFactor).toBe(1.75);
    expect(outcome.meta.patientSizeM).toBe(1.75);
    expect(outcome.meta.rescaleSlope).toBe(0.4312);
  });

  it('não lê tags privadas de outro criador', () => {
    const elements = petElements().map((e) =>
      e.tag === '00090010' ? el('00090010', 'LO', 'OUTRO_FABRICANTE') : e,
    );
    const outcome = parseHeader(writeDicom(elements), 'pet');
    expect(outcome.ok && outcome.meta.pet!.gePrivateScanDateTime).toBeUndefined();
  });

  it('deixa indefinido o que não existe, sem inventar valor', () => {
    const minimal = [
      el('00080016', 'UI', '1.2.840.10008.5.1.4.1.1.128'),
      el('00080060', 'CS', 'PT'),
      el('0020000d', 'UI', '1.2.9'),
      el('00101030', 'DS', ''),
    ];
    const outcome = parseHeader(writeDicom(minimal), 'x');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.complete).toBe(false);
    expect(outcome.meta.patientWeightKg).toBeUndefined();
    expect(outcome.meta.pet).toEqual({ correctedImage: [] });
    expect(outcome.meta.pixelSpacing).toBeUndefined();
    expect(outcome.meta.imagePositionPatient).toBeUndefined();
  });

  it('recusa o que não é DICOM', () => {
    const text = new TextEncoder().encode('isto não é um DICOM '.repeat(40));
    expect(parseHeader(text, 'leia-me.txt')).toEqual({ ok: false, reason: expect.any(String) });
    expect(parseHeader(new Uint8Array(0), 'vazio').ok).toBe(false);
    const jpeg = new Uint8Array(4000).fill(0xff);
    expect(parseHeader(jpeg, 'foto.jpg').ok).toBe(false);
  });

  it('recusa DICOMDIR', () => {
    const dicomdir = [el('00080016', 'UI', '1.2.840.10008.1.3.10'), el('0020000d', 'UI', '1.2')];
    const outcome = parseHeader(writeDicom(dicomdir), 'DICOMDIR');
    expect(outcome).toEqual({ ok: false, reason: expect.stringContaining('DICOMDIR') });
  });

  it('lê arquivo cru em Implicit VR, sem cabeçalho Part 10', () => {
    const outcome = parseHeader(writeDicom(ctElements(), { part10: false }), 'cru');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.meta.modality).toBe('CT');
    expect(outcome.meta.rows).toBe(512);
    expect(outcome.meta.imagePositionPatient).toEqual([-180.5, -170.25, -312.75]);
    expect(outcome.complete).toBe(true);
  });

  it('avisa quando os bytes acabam antes do PixelData', () => {
    const bytes = writeDicom(ctElements());
    const outcome = parseHeader(bytes.subarray(0, 700), 'cortado');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.complete).toBe(false);
  });
});

/** Blob a partir de bytes (cópia para um ArrayBuffer comum, que é o que o tipo Blob aceita). */
function blobOf(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy]);
}

describe('readHeaderFromBlob', () => {
  it('lê só o começo quando o cabeçalho cabe', async () => {
    const bytes = writeDicom(ctElements());
    expect(bytes.length).toBeGreaterThan(256 * 1024);
    const outcome = await readHeaderFromBlob(blobOf(bytes), 'a');
    expect(outcome.ok && outcome.complete).toBe(true);
    expect(outcome.ok && outcome.meta.instanceNumber).toBe(42);
  });

  it('relê o arquivo inteiro quando o cabeçalho não cabe no trecho inicial', async () => {
    const bytes = writeDicom(ctElements());
    // Trecho inicial de 600 bytes corta o cabeçalho no meio.
    const outcome = await readHeaderFromBlob(blobOf(bytes), 'a', 600);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.complete).toBe(true);
    expect(outcome.meta.rescaleIntercept).toBe(-1024);
    expect(outcome.meta.windowWidth).toEqual([400, 1500]);
  });

  it('recusa arquivos minúsculos e não-DICOM sem ler tudo', async () => {
    expect((await readHeaderFromBlob(blobOf(new Uint8Array(10)), 'a')).ok).toBe(false);
    const junk = new Uint8Array(900_000).fill(0x41);
    expect((await readHeaderFromBlob(blobOf(junk), 'a')).ok).toBe(false);
  });
});
