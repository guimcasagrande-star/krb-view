import { describe, expect, it } from 'vitest';
import {
  formatarEspacoGb,
  origemLegivelTotalSeg,
  resumoCurtoTotalSeg,
  verificarEspacoRecomendado,
  type DiagnosticoTotalSeg,
} from '../src/ui/configTotalSegmentator';

function diagBase(parcial: Partial<DiagnosticoTotalSeg> = {}): DiagnosticoTotalSeg {
  return {
    instalado: false,
    origem: 'nao_encontrado',
    executavelCaminho: null,
    pythonCaminho: null,
    pastaPesos: 'C:\\Users\\Teste\\AppData\\Local\\VisuTS\\weights',
    pesosCustomizados: false,
    caminhoCustomizadoInvalido: null,
    tarefasBaixadas: [
      { id: 'total_fast', nome: 'Modelo rápido', baixado: false, parcial: false, detalhe: 'Não baixado', tamanhoMb: 0 },
      { id: 'total', nome: 'Modelo padrão', baixado: false, parcial: false, detalhe: 'Não baixado', tamanhoMb: 0 },
      { id: 'total_mr', nome: 'Modelo RM', baixado: false, parcial: false, detalhe: 'Não baixado', tamanhoMb: 0 },
    ],
    gpuNvidia: null,
    cudaDisponivel: null,
    versaoTorch: null,
    versaoCudaTorch: null,
    versaoTotalSeg: null,
    espacoLivreBytes: 20 * 1024 * 1024 * 1024,
    instalacaoEmAndamento: false,
    ...parcial,
  };
}

describe('Assistente TotalSegmentator (funções puras de diagnóstico e espaço)', () => {
  it('resume o status de acordo com instalação, CUDA e pesos', () => {
    expect(resumoCurtoTotalSeg(null)).toEqual({
      texto: 'Verificando TotalSegmentator…',
      classe: 'pendente',
    });

    expect(resumoCurtoTotalSeg(diagBase())).toEqual({
      texto: 'TotalSegmentator não configurado',
      classe: 'erro',
    });

    expect(
      resumoCurtoTotalSeg(
        diagBase({
          instalado: true,
          origem: 'isolado',
          cudaDisponivel: true,
        }),
      ),
    ).toEqual({
      texto: 'Instalado · GPU CUDA · pesos pendentes',
      classe: 'aviso',
    });

    expect(
      resumoCurtoTotalSeg(
        diagBase({
          instalado: true,
          origem: 'isolado',
          cudaDisponivel: true,
          tarefasBaixadas: [
            { id: 'total_fast', nome: 'Modelo rápido', baixado: true, parcial: false, detalhe: 'ok', tamanhoMb: 240 },
          ],
        }),
      ),
    ).toEqual({
      texto: 'Pronto · GPU CUDA',
      classe: 'ok',
    });

    expect(
      resumoCurtoTotalSeg(
        diagBase({
          instalado: true,
          origem: 'customizado',
          gpuNvidia: { nome: 'RTX 4060', memoriaMb: 8192, driver: '560.0' },
          cudaDisponivel: false,
          tarefasBaixadas: [
            { id: 'total', nome: 'Modelo padrão', baixado: true, parcial: false, detalhe: 'ok', tamanhoMb: 1200 },
          ],
        }),
      ),
    ).toEqual({
      texto: 'Pronto · CPU (CUDA inativo)',
      classe: 'ok',
    });
  });

  it('verifica alertas de espaço livre em disco para GPU vs CPU e pesos opcionais', () => {
    const gb = 1024 * 1024 * 1024;

    const okGpu = verificarEspacoRecomendado(
      diagBase({ espacoLivreBytes: 12 * gb }),
      'gpu',
      { totalFast: true, total: true, totalMr: false },
    );
    expect(okGpu.insuficiente).toBe(false);
    expect(okGpu.critico).toBe(false);
    expect(okGpu.faixaTexto).toBe('6 a 8 GB livres');

    const alertaGpu = verificarEspacoRecomendado(
      diagBase({ espacoLivreBytes: 6.5 * gb }),
      'gpu',
      { totalFast: true, total: true, totalMr: false },
    );
    expect(alertaGpu.insuficiente).toBe(true);
    expect(alertaGpu.critico).toBe(false);

    const criticoGpu = verificarEspacoRecomendado(
      diagBase({ espacoLivreBytes: 3 * gb }),
      'gpu',
      { totalFast: true, total: true, totalMr: true },
    );
    expect(criticoGpu.insuficiente).toBe(true);
    expect(criticoGpu.critico).toBe(true);
    expect(criticoGpu.requeridoGb).toBe(9);

    const okCpu = verificarEspacoRecomendado(
      diagBase({ espacoLivreBytes: 4 * gb }),
      'cpu',
      { totalFast: true, total: false, totalMr: false },
    );
    expect(okCpu.insuficiente).toBe(false);
    expect(okCpu.faixaTexto).toBe('~3 GB livres');
  });

  it('formata origem e espaço livre em português', () => {
    expect(origemLegivelTotalSeg('isolado')).toContain('%LOCALAPPDATA%\\VisuTS');
    expect(origemLegivelTotalSeg('customizado')).toContain('customizado');
    expect(formatarEspacoGb(0)).toBe('indisponível');
    expect(formatarEspacoGb(5 * 1024 * 1024 * 1024)).toMatch(/5,0\s*GB/);
  });
});
