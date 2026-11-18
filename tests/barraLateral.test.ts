import { describe, expect, it } from 'vitest';
import {
  ALTURA_MAX_RODAPE,
  ALTURA_MIN_RODAPE,
  decidirPosicaoPorArraste,
  LARGURA_MAX_ESQUERDA,
  LARGURA_MIN_ESQUERDA,
  limitarTamanhoBarraLateral,
} from '../src/ui/barraLateral';
import { JANELAS_PADRAO, sanear } from '../src/state/preferencias';

describe('barraLateral acoplável e preferências novas', () => {
  it('decide acoplamento à esquerda ou no rodapé conforme posição do ponteiro', () => {
    // Margem esquerda em monitor retrato (1080x1920)
    expect(decidirPosicaoPorArraste(120, 600, 1080, 1920, 'rodape')).toBe('esquerda');
    // Faixa inferior central -> rodapé
    expect(decidirPosicaoPorArraste(540, 1750, 1080, 1920, 'esquerda')).toBe('rodape');
    // Dimensões inválidas mantêm posição atual
    expect(decidirPosicaoPorArraste(0, 0, 0, 0, 'rodape')).toBe('rodape');
  });

  it('limita largura da barra à esquerda e altura no rodapé às faixas seguras', () => {
    expect(limitarTamanhoBarraLateral('esquerda', 80)).toBe(LARGURA_MIN_ESQUERDA);
    expect(limitarTamanhoBarraLateral('esquerda', 900)).toBe(LARGURA_MAX_ESQUERDA);
    expect(limitarTamanhoBarraLateral('esquerda', 180.4)).toBe(180);

    expect(limitarTamanhoBarraLateral('rodape', 40)).toBe(ALTURA_MIN_RODAPE);
    expect(limitarTamanhoBarraLateral('rodape', 500)).toBe(ALTURA_MAX_RODAPE);
    expect(limitarTamanhoBarraLateral('rodape', 149.6)).toBe(150);
    // Em tela paisagem baixa (ex.: 500px úteis), limita proporcionalmente sem travar
    expect(limitarTamanhoBarraLateral('rodape', 400, 500)).toBe(260);
  });

  it('inclui preset Angio / Vasos e valida preferências de barra acoplada, GPU, qualidade 3D e barra superior', () => {
    expect(JANELAS_PADRAO.some((j) => j.rotulo === 'Angio / Vasos' && j.centro === 150 && j.largura === 600)).toBe(
      true,
    );
    const prefs = sanear({
      telas: {
        posicaoBarraSeriesPrincipal: 'rodape',
        posicaoBarraSeriesSecundaria: 'invalido',
        larguraBarraEsquerda: 99,
        alturaBarraRodape: 200,
      },
      qualidade3d: 'desempenho',
      preferenciaGpu: 'economia',
      barraSuperiorOcultos: ['cine', 'cine', 'mip3d', ''],
    });
    expect(prefs.telas.posicaoBarraSeriesPrincipal).toBe('rodape');
    expect(prefs.telas.posicaoBarraSeriesSecundaria).toBe('esquerda');
    expect(prefs.telas.larguraBarraEsquerda).toBe(136);
    expect(prefs.telas.alturaBarraRodape).toBe(200);
    expect(prefs.qualidade3d).toBe('desempenho');
    expect(prefs.preferenciaGpu).toBe('economia');
    expect(prefs.barraSuperiorOcultos).toEqual(['cine', 'mip3d']);
  });
});
