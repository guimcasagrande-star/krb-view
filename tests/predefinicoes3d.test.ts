import { CONSTANTS } from '@cornerstonejs/core';
import { describe, expect, it } from 'vitest';
import {
  ajustarPreset,
  modalidade3d,
  PREDEFINICOES_3D,
  predefinicaoPadrao,
  PRESETS_PROPRIOS,
  type Preset3d,
  VISTAS_3D,
} from '../src/render3d/predefinicoes3d';

const base: Preset3d = {
  name: 'Teste',
  gradientOpacity: '4 0 1 255 1',
  specularPower: '10',
  scalarOpacity: '6 -1000 0 100 0.5 3000 0.8',
  specular: '0.2',
  shade: '1',
  ambient: '0.1',
  colorTransfer: '8 -1000 0 0 0 3000 0.9 0.6 0.3',
  diffuse: '0.9',
  interpolation: '1',
};

describe('predefinições 3D', () => {
  it('toda predefinição existe (no Cornerstone instalado ou nas próprias)', () => {
    const nomes = new Set([...PRESETS_PROPRIOS, ...(CONSTANTS.VIEWPORT_PRESETS as Preset3d[])].map((p) => p.name));
    for (const p of PREDEFINICOES_3D) expect(nomes.has(p.preset), p.preset).toBe(true);
  });

  it('Osso 3D próprio não mostra músculo nem órgãos (opacidade zero até 150 HU)', () => {
    const osso = PRESETS_PROPRIOS.find((p) => p.name === 'Visualizador-Osso')!;
    const pontos = osso.scalarOpacity.split(' ').slice(1).map(Number);
    for (let i = 0; i < pontos.length; i += 2) {
      if (pontos[i]! <= 150) expect(pontos[i + 1]).toBe(0);
    }
  });

  it('TC abre em Angio-TC (Vasos + Osso), RM em RM padrão, PET não tem 3D', () => {
    expect(predefinicaoPadrao('CT').rotulo).toBe('Angio-TC (Vasos + Osso)');
    expect(predefinicaoPadrao('CT').preset).toBe('Visualizador-Angio-VasosOsso');
    expect(predefinicaoPadrao('MR').preset).toBe('MR-Default');
    expect(modalidade3d('PT')).toBeNull();
    expect(modalidade3d('CT')).toBe('CT');
  });

  it('sem ajuste devolve a mesma predefinição', () => {
    expect(ajustarPreset(base, 1, 1)).toBe(base);
  });

  it('opacidade multiplica a curva de opacidade e para em 1', () => {
    const p = ajustarPreset(base, 2, 1);
    expect(p.scalarOpacity).toBe('6 -1000 0 100 1 3000 1');
    expect(p.colorTransfer).toBe(base.colorTransfer);
  });

  it('brilho multiplica as cores sem mexer nos valores em HU', () => {
    const p = ajustarPreset(base, 1, 0.5);
    expect(p.colorTransfer).toBe('8 -1000 0 0 0 3000 0.45 0.3 0.15');
    expect(p.scalarOpacity).toBe('6 -1000 0 100 0.5 3000 0.8');
  });

  it('vistas: normal e "cima" perpendiculares e unitários', () => {
    for (const v of Object.values(VISTAS_3D)) {
      const [a, b] = [v.normal, v.cima];
      expect(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).toBe(0);
      expect(Math.hypot(...a)).toBe(1);
    }
  });
});
