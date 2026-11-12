import { describe, expect, it } from 'vitest';
import { buildIndex, formatPersonName } from '../src/io/organize';
import { CORONAL, makeSeries, shuffle } from './helpers/fixtures';

describe('formatPersonName', () => {
  it('põe o nome na ordem de leitura', () => {
    expect(formatPersonName('SILVA^JOAO^CARLOS')).toBe('JOAO CARLOS SILVA');
    expect(formatPersonName('SILVA^MARIA')).toBe('MARIA SILVA');
    expect(formatPersonName('SOUZA^ANA^^DRA.')).toBe('DRA. ANA SOUZA');
  });
  it('aceita nome sem separador, vazio e com grupos extras', () => {
    expect(formatPersonName('JOAO DA SILVA')).toBe('JOAO DA SILVA');
    expect(formatPersonName(undefined)).toBe('');
    expect(formatPersonName('YAMADA^TARO=山田^太郎')).toBe('TARO YAMADA');
  });
});

describe('buildIndex', () => {
  it('agrupa paciente, estudo e série', () => {
    const ct = makeSeries({ count: 20, seriesUid: '1.1', extra: { seriesNumber: 2, seriesDescription: 'ABDOME' } });
    const scout = makeSeries({ count: 2, seriesUid: '1.2', orientation: CORONAL, extra: { seriesNumber: 1 } });
    const { patients, skipped } = buildIndex(shuffle([...ct, ...scout]));
    expect(skipped).toEqual([]);
    expect(patients).toHaveLength(1);
    expect(patients[0]!.name).toBe('TESTE PHANTOM');
    const study = patients[0]!.studies[0]!;
    expect(study.modalities).toEqual(['CT']);
    expect(study.series.map((s) => s.seriesNumber)).toEqual([1, 2]);
    const series = study.series[1]!;
    expect(series.description).toBe('ABDOME');
    expect(series.kind).toBe('imagem');
    expect(series.instanceCount).toBe(20);
    expect(series.stacks).toHaveLength(1);
    expect(series.stacks[0]!.id).toBe('1.1#0');
    expect(series.stacks[0]!.geometry.volumeOk).toBe(true);
    expect(series.stacks[0]!.instances[0]!.instanceNumber).toBe(1);
  });

  it('põe o estudo mais recente primeiro', () => {
    const older = makeSeries({ count: 3, studyUid: 'A', seriesUid: 'A.1', extra: { studyDate: '20240310', studyTime: '101500' } });
    const newer = makeSeries({ count: 3, studyUid: 'B', seriesUid: 'B.1', extra: { studyDate: '20260115', studyTime: '0830' } });
    const sameDayLater = makeSeries({ count: 3, studyUid: 'C', seriesUid: 'C.1', extra: { studyDate: '20260115', studyTime: '143000.000' } });
    const { patients } = buildIndex([...older, ...newer, ...sameDayLater]);
    expect(patients[0]!.studies.map((s) => s.studyInstanceUid)).toEqual(['C', 'B', 'A']);
  });

  it('descarta arquivo repetido', () => {
    const series = makeSeries({ count: 5 });
    const copy = { ...series[2]!, fileId: 'copia/IM0002' };
    const { patients, skipped } = buildIndex([...series, copy]);
    expect(patients[0]!.studies[0]!.series[0]!.instanceCount).toBe(5);
    expect(skipped).toEqual([{ fileId: 'copia/IM0002', reason: expect.stringContaining('repetido') }]);
  });

  it('separa pacientes diferentes e ordena por nome', () => {
    const a = makeSeries({ count: 2, studyUid: 'A', seriesUid: 'A.1', extra: { patientId: '2', patientName: 'ZICO^ARTUR' } });
    const b = makeSeries({ count: 2, studyUid: 'B', seriesUid: 'B.1', extra: { patientId: '1', patientName: 'ABREU^BIA' } });
    const { patients } = buildIndex([...a, ...b]);
    expect(patients.map((p) => p.name)).toEqual(['ARTUR ZICO', 'BIA ABREU']);
  });

  it('classifica séries sem imagem e de segmentação', () => {
    const report = makeSeries({ count: 1, seriesUid: '7.1', modality: 'SR' });
    delete report[0]!.rows;
    delete report[0]!.columns;
    const seg = makeSeries({ count: 1, seriesUid: '7.2', modality: 'SEG' });
    const { patients } = buildIndex([...report, ...seg]);
    const kinds = Object.fromEntries(patients[0]!.studies[0]!.series.map((s) => [s.modality, s.kind]));
    expect(kinds).toEqual({ SR: 'outro', SEG: 'segmentacao' });
    expect(patients[0]!.studies[0]!.series.every((s) => s.stacks.length === 0)).toBe(true);
  });

  it('divide difusão em pilhas rotuladas', () => {
    const dwi = [0, 800].flatMap((b) => makeSeries({ count: 10, seriesUid: '8.1', extra: { diffusionBValue: b, modality: 'MR' } }));
    dwi.forEach((i, k) => (i.sopInstanceUid = `8.1.${k}`));
    const { patients } = buildIndex(dwi);
    const stacks = patients[0]!.studies[0]!.series[0]!.stacks;
    expect(stacks.map((s) => [s.id, s.label])).toEqual([
      ['8.1#0', 'b=0'],
      ['8.1#1', 'b=800'],
    ]);
  });

  it('aceita arquivos sem identificadores', () => {
    const series = makeSeries({ count: 2 });
    series.forEach((i) => {
      delete i.patientId;
      delete i.patientName;
      delete i.studyInstanceUid;
      delete i.seriesInstanceUid;
    });
    const { patients } = buildIndex(series);
    expect(patients[0]!.name).toBe('Paciente sem nome');
    expect(patients[0]!.studies[0]!.series[0]!.instanceCount).toBe(2);
  });
});
