import { describe, expect, it } from 'vitest';
import { analyzeStack, sortSlices } from '../src/io/geometry';
import {
  applyTranslation,
  createLink,
  invertLink,
  isIssue,
  mapPosition,
  nearestIndex,
  relink,
  syncedSlice,
  translationFromPoints,
  type ScrollLink,
} from '../src/compare/sync';
import { AXIAL, CORONAL, makeSeries } from './helpers/fixtures';
import type { Orientation } from '../src/io/types';

const stack = (options: Parameters<typeof makeSeries>[0]) =>
  analyzeStack(sortSlices(makeSeries(options)).sorted);

function link(a: ReturnType<typeof stack>, b: ReturnType<typeof stack>, options = {}): ScrollLink {
  const result = createLink(a, b, options);
  if (isIssue(result)) throw new Error(result.code);
  return result;
}

describe('nearestIndex', () => {
  it('posições crescentes', () => {
    const p = [0, 2.5, 5, 7.5, 10];
    expect(nearestIndex(p, 5.1)).toBe(2);
    expect(nearestIndex(p, 6.3)).toBe(3);
    expect(nearestIndex(p, -40)).toBe(0);
    expect(nearestIndex(p, 400)).toBe(4);
  });
  it('posições decrescentes', () => {
    const p = [10, 7.5, 5, 2.5, 0];
    expect(nearestIndex(p, 5.1)).toBe(2);
    expect(nearestIndex(p, 9)).toBe(0);
    expect(nearestIndex(p, 8.7)).toBe(1);
    expect(nearestIndex(p, -1)).toBe(4);
  });
  it('casos de borda', () => {
    expect(nearestIndex([], 1)).toBe(-1);
    expect(nearestIndex([3], 100)).toBe(0);
    expect(nearestIndex([0, 10], 5)).toBe(0);
  });
  it('bate com busca exaustiva', () => {
    const p = Array.from({ length: 200 }, (_, k) => -310.4 + k * 1.25);
    for (const target of [-400, -310.4, -309.8, -100.01, 0, 17.3, 300]) {
      let best = 0;
      p.forEach((v, k) => {
        if (Math.abs(v - target) < Math.abs(p[best]! - target)) best = k;
      });
      expect(nearestIndex(p, target)).toBe(best);
    }
  });
});

describe('ligação por posição', () => {
  it('exames com espessuras diferentes rolam juntos', () => {
    // Mesmo paciente, mesma cobertura (0 a 300 mm): atual 1,25 mm, anterior 5 mm.
    const current = stack({ count: 241, spacing: 1.25 });
    const previous = stack({ count: 61, spacing: 5 });
    const l = link(current, previous, { alignment: 'mesmo-referencial' });
    expect(l).toEqual({ sign: 1, offsetMm: 0 });

    // Corte 100 do atual está em 125 mm -> corte 25 do anterior.
    const s = syncedSlice(l, current.positions[100]!, previous)!;
    expect(s.index).toBe(25);
    expect(s.distanceMm).toBeCloseTo(0, 9);
    expect(s.outOfRange).toBe(false);

    // Rolando o atual corte a corte, o anterior nunca fica a mais de meio corte.
    for (const p of current.positions) {
      const r = syncedSlice(l, p, previous)!;
      expect(r.distanceMm).toBeLessThanOrEqual(2.5 + 1e-9);
      expect(r.outOfRange).toBe(false);
    }
  });

  it('alinha pelo corte mais superior quando os referenciais são diferentes', () => {
    // Atual cobre z de -500 a -200; anterior, de 100 a 400 (outra mesa, outro zero).
    const current = stack({ count: 121, spacing: 2.5, origin: [0, 0, -500] });
    const previous = stack({ count: 101, spacing: 3, origin: [0, 0, 100] });
    const l = link(current, previous);
    expect(l.offsetMm).toBeCloseTo(400 - -200, 9);
    // O topo de um cai no topo do outro.
    const top = syncedSlice(l, -200, previous)!;
    expect(previous.positions[top.index]).toBeCloseTo(400, 9);
  });

  it('alinha pelo centro quando pedido', () => {
    const a = stack({ count: 101, spacing: 2, origin: [0, 0, 0] }); // 0 a 200
    const b = stack({ count: 51, spacing: 2, origin: [0, 0, 1000] }); // 1000 a 1100
    expect(link(a, b, { alignment: 'centro' }).offsetMm).toBeCloseTo(1050 - 100, 9);
  });

  it('funciona com a pilha do equipamento em ordem decrescente', () => {
    const current = stack({ count: 100, spacing: 3, numbering: 'desc' });
    const previous = stack({ count: 100, spacing: 3 });
    expect(current.direction).toBe(-1);
    const l = link(current, previous, { alignment: 'mesmo-referencial' });
    // Primeiro corte mostrado no atual é o mais alto (297 mm) -> último do anterior.
    expect(syncedSlice(l, current.positions[0]!, previous)!.index).toBe(99);
    expect(syncedSlice(l, current.positions[99]!, previous)!.index).toBe(0);
  });

  it('trata normais opostas', () => {
    const flipped: Orientation = [1, 0, 0, 0, -1, 0]; // normal -z
    const a = stack({ count: 50, spacing: 2 }); // z de 0 a 98, normal +z
    const b = stack({ count: 50, spacing: 2, orientation: flipped, step: [0, 0, 2] }); // mesmo z, normal -z
    const l = link(a, b, { alignment: 'mesmo-referencial' });
    expect(l.sign).toBe(-1);
    // z = 40 mm é o corte 20 nas duas séries.
    const s = syncedSlice(l, 40, b)!;
    expect(s.index).toBe(20);
    expect(s.distanceMm).toBeCloseTo(0, 9);
    // E o alinhamento "superior" continua casando os topos anatômicos.
    const top = link(a, b);
    expect(b.positions[syncedSlice(top, 98, b)!.index]).toBeCloseTo(-98, 9);
  });

  it('marca quando sai da cobertura do outro exame', () => {
    const long = stack({ count: 200, spacing: 2 }); // 0 a 398
    const short = stack({ count: 50, spacing: 2, origin: [0, 0, 100] }); // 100 a 198
    const l = link(long, short, { alignment: 'mesmo-referencial' });
    const below = syncedSlice(l, 40, short)!;
    expect(below.index).toBe(0);
    expect(below.outOfRange).toBe(true);
    expect(below.distanceMm).toBeCloseTo(60, 9);
    const above = syncedSlice(l, 300, short)!;
    expect(above.index).toBe(49);
    expect(above.outOfRange).toBe(true);
    expect(syncedSlice(l, 150, short)!.outOfRange).toBe(false);
  });

  it('recusa planos diferentes e séries sem geometria', () => {
    const axial = stack({ count: 20, orientation: AXIAL });
    const coronal = stack({ count: 20, orientation: CORONAL });
    const refused = createLink(axial, coronal);
    expect(isIssue(refused) && refused.code).toBe('PLANOS_DIFERENTES');

    const series = makeSeries({ count: 10 });
    series.forEach((i) => delete i.imagePositionPatient);
    const none = createLink(axial, analyzeStack(series));
    expect(isIssue(none) && none.code).toBe('SEM_GEOMETRIA');
  });

  it('aceita pequena diferença de angulação entre os exames', () => {
    const a = (8 * Math.PI) / 180;
    const tilted: Orientation = [1, 0, 0, 0, Math.cos(a), -Math.sin(a)];
    const result = createLink(stack({ count: 30 }), stack({ count: 30, orientation: tilted }));
    expect(isIssue(result)).toBe(false);
  });
});

describe('ajuste manual do deslocamento', () => {
  it('religa mantendo o ponto anatômico escolhido', () => {
    const current = stack({ count: 200, spacing: 1.5, origin: [0, 0, -700] });
    const previous = stack({ count: 120, spacing: 2.5, origin: [0, 0, 55] });
    let l = link(current, previous);

    // O usuário desliga o vínculo, põe a carina nos dois (corte 80 e corte 31) e religa.
    const carinaCurrent = current.positions[80]!;
    const carinaPrevious = previous.positions[31]!;
    l = relink(l, carinaCurrent, carinaPrevious);
    expect(syncedSlice(l, carinaCurrent, previous)!.index).toBe(31);

    // 30 mm abaixo no atual = 30 mm abaixo no anterior (12 cortes de 2,5 mm).
    const lower = syncedSlice(l, carinaCurrent - 30, previous)!;
    expect(lower.index).toBe(31 - 12);
    expect(lower.distanceMm).toBeCloseTo(0, 9);
  });

  it('a ligação inversa devolve a posição original', () => {
    for (const l of [
      { sign: 1, offsetMm: 37.5 },
      { sign: -1, offsetMm: -212.25 },
    ] as ScrollLink[]) {
      const back = invertLink(l);
      for (const p of [-300, 0, 12.5, 410]) {
        expect(mapPosition(back, mapPosition(l, p))).toBeCloseTo(p, 9);
      }
    }
    expect(invertLink({ sign: -1, offsetMm: 0 })).toEqual({ sign: -1, offsetMm: 0 });
  });
});

describe('ligação em 3D', () => {
  it('translação entre pontos equivalentes', () => {
    const t = translationFromPoints([10, 20, 30], [12, 18, 130]);
    expect(t).toEqual([2, -2, 100]);
    expect(applyTranslation([0, 0, 0], t)).toEqual([2, -2, 100]);
    expect(applyTranslation([10, 20, 30], t)).toEqual([12, 18, 130]);
  });
});
