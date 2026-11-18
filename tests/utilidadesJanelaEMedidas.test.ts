import { describe, expect, it } from 'vitest';
import { MEDIDAS_PADRAO } from '../src/state/preferencias';
import { calcularAutoJanela, formatarAnotacaoParaTexto } from '../src/tools/utilidadesJanelaEMedidas';

describe('utilidadesJanelaEMedidas (Auto-janela e cópia de medidas)', () => {
  it('calcula auto-janela em corte de TC ignorando ar externo (-1000 HU) e enquadrando partes moles', () => {
    const pixels = new Int16Array(400);
    // 60% ar (-1000 HU), 40% tecido abdominal (-80 a +180 HU)
    for (let i = 0; i < 240; i++) pixels[i] = -1000;
    for (let i = 240; i < 400; i++) {
      pixels[i] = -80 + Math.round(((i - 240) / 159) * 260);
    }
    const voi = calcularAutoJanela(pixels, 1, 0, 'CT');
    expect(voi).not.toBeNull();
    expect(voi!.lower).toBeGreaterThan(-250);
    expect(voi!.upper).toBeGreaterThan(150);
    expect(voi!.upper).toBeLessThan(300);
  });

  it('calcula auto-janela em corte de RM ignorando fundo zero', () => {
    const pixels = new Uint16Array(200);
    for (let i = 0; i < 100; i++) pixels[i] = 0;
    for (let i = 100; i < 200; i++) pixels[i] = 50 + (i - 100) * 4;
    const voi = calcularAutoJanela(pixels, 1, 0, 'MR');
    expect(voi).not.toBeNull();
    expect(voi!.lower).toBeGreaterThan(0);
    expect(voi!.upper).toBeGreaterThan(400);
  });

  it('formata medidas lineares, angulares e ROIs em português para cópia (Ctrl+C)', () => {
    const dist = formatarAnotacaoParaTexto(
      {
        metadata: { toolName: 'Length' },
        data: { cachedStats: { 'imageId:1': { length: 30, unit: 'mm' } } },
      },
      MEDIDAS_PADRAO,
    );
    expect(dist).toBe('30,0 mm');

    const ang = formatarAnotacaoParaTexto(
      {
        metadata: { toolName: 'Angle' },
        data: { cachedStats: { 'imageId:1': { angle: 45.2 } } },
      },
      MEDIDAS_PADRAO,
    );
    expect(ang).toBe('45,2°');
  });
});
