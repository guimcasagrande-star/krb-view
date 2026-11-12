import { describe, expect, it } from 'vitest';
import {
  combineDateTime,
  formatDatePtBr,
  formatInstantPtBr,
  parseDA,
  parseDT,
  parseTM,
  parseTimezoneOffset,
  secondsBetween,
} from '../src/io/dicomTime';

describe('parseDA', () => {
  it('lê AAAAMMDD', () => {
    expect(parseDA('20260115')).toBe(Date.UTC(2026, 0, 15));
  });
  it('aceita o formato antigo com pontos', () => {
    expect(parseDA('2026.01.15')).toBe(Date.UTC(2026, 0, 15));
  });
  it('recusa datas inexistentes e lixo', () => {
    expect(parseDA('20260231')).toBeUndefined();
    expect(parseDA('2026011')).toBeUndefined();
    expect(parseDA('')).toBeUndefined();
    expect(parseDA(undefined)).toBeUndefined();
  });
});

describe('parseTM', () => {
  it('lê hora completa com fração', () => {
    expect(parseTM('143015.500000')).toBe(((14 * 60 + 30) * 60 + 15.5) * 1000);
  });
  it('aceita partes opcionais', () => {
    expect(parseTM('14')).toBe(14 * 3600_000);
    expect(parseTM('1430')).toBe((14 * 60 + 30) * 60_000);
  });
  it('aceita o formato antigo com dois-pontos e espaços no fim', () => {
    expect(parseTM('14:30:15 ')).toBe(((14 * 60 + 30) * 60 + 15) * 1000);
  });
  it('recusa valores fora da faixa', () => {
    expect(parseTM('250000')).toBeUndefined();
    expect(parseTM('126100')).toBeUndefined();
    expect(parseTM('abc')).toBeUndefined();
  });
});

describe('parseDT', () => {
  it('lê data e hora com fração', () => {
    expect(parseDT('20260115143015.25')?.ms).toBe(Date.UTC(2026, 0, 15, 14, 30, 15, 250));
  });
  it('guarda o fuso sem aplicar à hora de parede', () => {
    const dt = parseDT('20260115143015-0300');
    expect(dt?.ms).toBe(Date.UTC(2026, 0, 15, 14, 30, 15));
    expect(dt?.offsetMinutes).toBe(-180);
  });
  it('aceita só a data', () => {
    expect(parseDT('20260115')?.ms).toBe(Date.UTC(2026, 0, 15));
  });
  it('recusa lixo', () => {
    expect(parseDT('2026')).toBeUndefined();
    expect(parseDT('20261315000000')).toBeUndefined();
  });
});

describe('fuso e diferenças', () => {
  it('lê deslocamento de fuso', () => {
    expect(parseTimezoneOffset('-0300')).toBe(-180);
    expect(parseTimezoneOffset('+0530')).toBe(330);
    expect(parseTimezoneOffset('0300')).toBeUndefined();
  });
  it('calcula diferença simples', () => {
    const a = combineDateTime('20260115', '130000')!;
    const b = combineDateTime('20260115', '140000')!;
    expect(secondsBetween(a, b)).toBe(3600);
  });
  it('cruza a meia-noite quando as datas estão certas', () => {
    const a = combineDateTime('20260115', '233000')!;
    const b = combineDateTime('20260116', '003000')!;
    expect(secondsBetween(a, b)).toBe(3600);
  });
  it('desconta fusos diferentes só quando os dois são conhecidos', () => {
    const a = parseDT('20260115120000-0300')!; // 15:00 UTC
    const b = parseDT('20260115160000+0000')!; // 16:00 UTC
    expect(secondsBetween(a, b)).toBe(3600);
    const c = parseDT('20260115160000')!;
    expect(secondsBetween(a, c)).toBe(4 * 3600);
  });
});

describe('formatação', () => {
  it('formata data e instante em pt-BR', () => {
    expect(formatDatePtBr('20260115')).toBe('15/01/2026');
    expect(formatDatePtBr('xx')).toBe('');
    expect(formatInstantPtBr(Date.UTC(2026, 0, 15, 9, 5, 7))).toBe('15/01/2026 09:05:07');
  });
});
