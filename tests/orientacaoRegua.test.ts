import { describe, expect, it } from 'vitest';
import { calcularGeometriaRegua, rotuloDoVetor } from '../src/viewer/orientacaoRegua';

describe('orientacaoRegua', () => {
  it('posiciona a régua à esquerda, centralizada verticalmente e ocupando até ~1/3 da altura', () => {
    const geo = calcularGeometriaRegua(600, 600, 2);
    expect(geo).not.toBeNull();
    expect(geo!.xLinha).toBe(26);
    const extensao = geo!.yBase - geo!.topo;
    expect(extensao).toBeGreaterThan(0);
    expect(extensao).toBeLessThanOrEqual(200); // 1/3 de 600 px
    expect((geo!.topo + geo!.yBase) / 2).toBeCloseTo(300, 5);
  });

  it('retorna null quando o quadro é muito pequeno ou pxPorMm inválido', () => {
    expect(calcularGeometriaRegua(80, 600, 2)).toBeNull();
    expect(calcularGeometriaRegua(600, 600, 0)).toBeNull();
  });

  it('gera rótulos anatômicos corretos para eixos LPS', () => {
    expect(rotuloDoVetor([1, 0, 0])).toBe('E');
    expect(rotuloDoVetor([-1, 0, 0])).toBe('D');
    expect(rotuloDoVetor([0, -1, 0])).toBe('A');
    expect(rotuloDoVetor([0, 0, 1])).toBe('S');
  });
});
