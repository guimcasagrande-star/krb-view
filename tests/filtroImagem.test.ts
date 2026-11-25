import { describe, expect, it } from 'vitest';
import {
  FILTRO_IMAGEM_MAX,
  FILTRO_IMAGEM_MIN,
  PRESETS_FILTRO_IMAGEM,
  conteudoInternoFiltroSvg,
  especificacaoFiltroSvg,
  rotuloBotaoFiltroImagem,
  rotuloFiltroImagem,
  sanearNivelFiltro,
} from '../src/viewer/filtroImagem';

describe('filtroImagem', () => {
  it('saneia valores fora da faixa, inválidos e arredonda para passos de 0,5', () => {
    expect(sanearNivelFiltro(0)).toBe(0);
    expect(sanearNivelFiltro(-0)).toBe(0);
    expect(sanearNivelFiltro(1.24)).toBe(1);
    expect(sanearNivelFiltro(1.26)).toBe(1.5);
    expect(sanearNivelFiltro(-2.7)).toBe(-2.5);
    expect(sanearNivelFiltro(99)).toBe(FILTRO_IMAGEM_MAX);
    expect(sanearNivelFiltro(-99)).toBe(FILTRO_IMAGEM_MIN);
    expect(sanearNivelFiltro(NaN, 1.5)).toBe(1.5);
    expect(sanearNivelFiltro('texto', -2)).toBe(-2);
  });

  it('mapeia 0 para modo original sem conteúdo de filtro SVG', () => {
    const spec = especificacaoFiltroSvg(0);
    expect(spec).toEqual({ modo: 'original' });
    expect(conteudoInternoFiltroSvg(spec)).toBe('');
  });

  it('mapeia níveis negativos para filtro gaussiano suave monotônico e positivos para Unsharp Mask monotônico', () => {
    const s1 = especificacaoFiltroSvg(-1);
    const s3 = especificacaoFiltroSvg(-3);
    const s5 = especificacaoFiltroSvg(-5);
    expect(s1.modo).toBe('suave');
    expect(s3.modo).toBe('suave');
    expect(s5.modo).toBe('suave');
    if (s1.modo === 'suave' && s3.modo === 'suave' && s5.modo === 'suave') {
      expect(s1.sigma).toBeGreaterThan(0);
      expect(s3.sigma).toBeGreaterThan(s1.sigma);
      expect(s5.sigma).toBeGreaterThan(s3.sigma);
      expect(conteudoInternoFiltroSvg(s3)).toContain('feGaussianBlur');
      expect(conteudoInternoFiltroSvg(s3)).not.toContain('feComposite');
    }

    const n1 = especificacaoFiltroSvg(1);
    const n3 = especificacaoFiltroSvg(3);
    const n5 = especificacaoFiltroSvg(5);
    expect(n1.modo).toBe('nitido');
    expect(n3.modo).toBe('nitido');
    expect(n5.modo).toBe('nitido');
    if (n1.modo === 'nitido' && n3.modo === 'nitido' && n5.modo === 'nitido') {
      expect(n1.intensidade).toBeGreaterThan(0);
      expect(n3.intensidade).toBeGreaterThan(n1.intensidade);
      expect(n5.intensidade).toBeGreaterThan(n3.intensidade);
      expect(n3.k2 + n3.k3).toBeCloseTo(1, 5);
      expect(conteudoInternoFiltroSvg(n3)).toContain('operator="arithmetic"');
      expect(conteudoInternoFiltroSvg(n3)).toContain('feFuncA');
    }
  });

  it('formata rótulos em português do Brasil', () => {
    expect(rotuloFiltroImagem(0)).toBe('Original');
    expect(rotuloFiltroImagem(-2)).toBe('Suave -2');
    expect(rotuloFiltroImagem(-1.5)).toBe('Suave -1,5');
    expect(rotuloFiltroImagem(1.5)).toBe('Nítido +1,5');
    expect(rotuloBotaoFiltroImagem(0)).toBe('Filtro');
    expect(rotuloBotaoFiltroImagem(2)).toBe('Nítido +2');
  });

  it('mantém todos os presets dentro da faixa válida', () => {
    for (const p of PRESETS_FILTRO_IMAGEM) {
      expect(sanearNivelFiltro(p.valor)).toBe(p.valor);
    }
  });
});
