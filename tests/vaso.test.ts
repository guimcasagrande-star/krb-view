import { describe, expect, it } from 'vitest';
import type { VolumeGrid } from '../src/io/geometry';
import {
  aplicarVasoEmEstado,
  calcularFaixaInteligenteVaso,
  CORES_VASO,
  CORES_VENA,
  crescerVaso,
  intensidadeReferenciaVaso,
  media3x3NoCorte,
  PADRAO_DELTA_MAX_VASO,
  PADRAO_DELTA_MIN_VASO,
  PRESETS_VASO,
  recalcularVasoEmEstado,
  type EstadoVasoPuro,
} from '../src/segmentation/vaso';
import { FERRAMENTAS_SEGMENTACAO, RAIO_PADRAO_MM } from '../src/segmentation/ferramentas';
import { autoLigarCortesPincel, limparDefeitosMascaraPuro } from '../src/segmentation/segmentacao';

const NX = 24;
const NY = 24;
const NZ = 24;

const grid: VolumeGrid = {
  dims: [NX, NY, NZ],
  origin: [0, 0, 0],
  stepI: [1, 0, 0],
  stepJ: [0, 1, 0],
  stepK: [0, 0, 1],
  spacing: [1, 1, 1],
};

const idx = (i: number, j: number, k: number): number => i + j * NX + k * NX * NY;

/**
 * Monta um volume sintético de angio-TC (fundo 40 HU):
 * - Vaso 1 (aorta + ramo): tronco em i=5..7, j=5..7, k=2..19 (~300 HU) + ramo em i=8..13, j=6..7, k=10..11 (~250 HU).
 * - Osso/calcificação desconexa no lado oposto (i=18..20, j=18..20, k=4..16, 320 HU) para garantir que não vaza.
 * - Vaso 2 independente em i=15..16, j=5..6, k=3..12 (~290 HU).
 */
function criarPhantomVascular(): Float32Array {
  const d = new Float32Array(NX * NY * NZ).fill(40);

  // Vaso 1: tronco principal ao longo de Z
  for (let k = 2; k <= 19; k++) {
    for (let j = 5; j <= 7; j++) {
      for (let i = 5; i <= 7; i++) {
        d[idx(i, j, k)] = 300;
      }
    }
  }
  // Ramo conectado ao Vaso 1 (com HU ligeiramente menor, dentro do padrão -80/+300)
  for (let k = 10; k <= 11; k++) {
    for (let j = 6; j <= 7; j++) {
      for (let i = 8; i <= 13; i++) {
        d[idx(i, j, k)] = 250;
      }
    }
  }

  // Estrutura hiperdensa desconexa (osso) dentro da faixa de HU, mas separada por fundo de 40 HU
  for (let k = 4; k <= 16; k++) {
    for (let j = 18; j <= 20; j++) {
      for (let i = 18; i <= 20; i++) {
        d[idx(i, j, k)] = 320;
      }
    }
  }

  // Vaso 2 separado
  for (let k = 3; k <= 12; k++) {
    for (let j = 5; j <= 6; j++) {
      for (let i = 15; i <= 16; i++) {
        d[idx(i, j, k)] = 290;
      }
    }
  }

  return d;
}

describe('ferramenta Vaso (crescimento de região contíguo)', () => {
  it('cresce de forma contígua em 3D pelo vaso e ramos sem vazar para estruturas desconexas', () => {
    const volume = { data: criarPhantomVascular(), grid };
    const res = crescerVaso(volume, [6, 6, 4]);

    expect(PADRAO_DELTA_MIN_VASO).toBe(-80);
    expect(PADRAO_DELTA_MAX_VASO).toBe(300);
    expect(res.huReferencia).toBeCloseTo(300, 5);
    expect(res.min).toBeCloseTo(220, 5);
    expect(res.max).toBeCloseTo(600, 5);

    const pintados = new Set(Array.from(res.indices));
    // Tronco em vários cortes
    expect(pintados.has(idx(6, 6, 2))).toBe(true);
    expect(pintados.has(idx(6, 6, 19))).toBe(true);
    // Ramo conectado (250 HU está entre 220 e 600 HU)
    expect(pintados.has(idx(12, 6, 10))).toBe(true);
    // Não vaza para o osso desconexo nem para o Vaso 2 nem para o fundo
    expect(pintados.has(idx(19, 19, 8))).toBe(false);
    expect(pintados.has(idx(15, 5, 8))).toBe(false);
    expect(pintados.has(idx(1, 1, 1))).toBe(false);
    // 18 cortes * 3x3 (162) + ramo 6x2x2 (24) = 186 voxels
    expect(res.indices.length).toBe(186);
    expect(res.volumeMl).toBeCloseTo(186 / 1000, 5);
  });

  it('respeita os limites deltaMin e deltaMax configuráveis pelo usuário', () => {
    const volume = { data: criarPhantomVascular(), grid };
    // Ramo tem 250 HU vs 300 HU no tronco (-50 HU): faixa apertada [-30, +30] deve excluir o ramo
    const apertado = crescerVaso(volume, [6, 6, 4], { deltaMin: -30, deltaMax: 30 });
    const setApertado = new Set(Array.from(apertado.indices));

    expect(setApertado.has(idx(6, 6, 19))).toBe(true);
    expect(setApertado.has(idx(12, 6, 10))).toBe(false);
    expect(apertado.indices.length).toBe(162);
  });

  it('usa média 3x3 no corte para suavizar ruído de pixel isolado e faz fallback em vaso fino', () => {
    const data = criarPhantomVascular();
    // Ruído isolado no centro do vaso (490 HU cercado por 300 HU): média 3x3 = (8*300 + 490)/9 ≈ 321.1 HU
    data[idx(6, 6, 8)] = 490;
    const volumeRuido = { data, grid };

    const media = media3x3NoCorte(volumeRuido, [6, 6, 8]);
    expect(media).toBeCloseTo((8 * 300 + 490) / 9, 4);
    expect(intensidadeReferenciaVaso(volumeRuido, [6, 6, 8])).toBeCloseTo(media, 4);

    const resSuavizado = crescerVaso(volumeRuido, [6, 6, 8]);
    // Com referência ~321.1 e deltaMin -80 -> min ~241.1, todo o vaso (300) e ramo (250) continuam contíguos!
    expect(resSuavizado.indices.length).toBe(186);

    // Vaso fino de 1 voxel (280 HU) cercado por ar (-1000 HU): média 3x3 seria negativa e excluiria a semente -> fallback 280 HU
    const fino = new Float32Array(NX * NY * NZ).fill(-1000);
    for (let k = 2; k <= 10; k++) fino[idx(10, 10, k)] = 280;
    const volFino = { data: fino, grid };
    expect(intensidadeReferenciaVaso(volFino, [10, 10, 5])).toBe(280);
    const resFino = crescerVaso(volFino, [10, 10, 5]);
    expect(resFino.indices.length).toBe(9);
  });

  it('cria novos segmentos arteriais ("Vaso 1", "Vaso 2") ou aplica no segmento ativo', () => {
    const volume = { data: criarPhantomVascular(), grid };
    const estado: EstadoVasoPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(NX * NY * NZ),
    };

    // 1º clique: reaproveita o placeholder vazio "Segmento 1" como "Vaso 1"
    const r1 = aplicarVasoEmEstado(estado, volume, [6, 6, 4], { criarNovoSegmento: true });
    expect(r1.erro).toBeUndefined();
    expect(r1.criado).toBe(true);
    expect(r1.segmento?.nome).toBe('Vaso 1');
    expect(r1.segmento?.cor).toEqual(CORES_VASO[0]);
    expect(r1.pintados).toBe(186);
    expect(estado.segmentos).toHaveLength(1);
    expect(estado.rotulos[idx(6, 6, 4)]).toBe(1);

    // 2º clique no Vaso 2: cria "Vaso 2" mantendo os rótulos do Vaso 1
    const r2 = aplicarVasoEmEstado(estado, volume, [15, 5, 6], { criarNovoSegmento: true });
    expect(r2.erro).toBeUndefined();
    expect(r2.criado).toBe(true);
    expect(r2.segmento?.nome).toBe('Vaso 2');
    expect(r2.segmento?.cor).toEqual(CORES_VASO[1]);
    expect(estado.segmentos).toHaveLength(2);
    expect(estado.ativo).toBe(r2.segmento!.indice);
    expect(estado.rotulos[idx(6, 6, 4)]).toBe(1);
    expect(estado.rotulos[idx(15, 5, 6)]).toBe(r2.segmento!.indice);

    // Modo aplicar no segmento ativo: não cria "Vaso 3"
    const r3 = aplicarVasoEmEstado(estado, volume, [15, 5, 6], { criarNovoSegmento: false });
    expect(r3.criado).toBe(false);
    expect(estado.segmentos).toHaveLength(2);

    // Clique fora do volume não cria segmento novo
    const fora = aplicarVasoEmEstado(estado, volume, [-1, 5, 5], { criarNovoSegmento: true });
    expect(fora.erro).toBeDefined();
    expect(fora.criado).toBe(false);
    expect(estado.segmentos).toHaveLength(2);
  });

  it('recalcula em tempo real ao ajustar deltaMin/deltaMax na última semente e suporta presets Arterial e Venoso', () => {
    const data = criarPhantomVascular();
    // Simula parênquima adjacente ao tronco (130 HU encostado em i=4, j=5..7, k=5..8)
    for (let k = 5; k <= 8; k++) {
      for (let j = 5; j <= 7; j++) {
        data[idx(4, j, k)] = 130;
      }
    }
    const volume = { data, grid };
    const estado: EstadoVasoPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(NX * NY * NZ),
    };

    // Clique inicial com deltaMin muito aberto (-200): vaza para o parênquima de 130 HU
    const inicial = aplicarVasoEmEstado(estado, volume, [6, 6, 4], { deltaMin: -200, deltaMax: 300 });
    expect(inicial.pintados).toBe(186 + 12);
    expect(estado.rotulos[idx(4, 6, 6)]).toBe(1);
    expect(estado.ultimaSementeVaso?.segmentoIndice).toBe(1);

    // Ajuste em tempo real para Arterial (-80 a +300): remove o vazamento de 130 HU sem criar novo segmento
    const ajusteArterial = recalcularVasoEmEstado(estado, volume, {
      deltaMin: PRESETS_VASO.arterial.deltaMin,
      deltaMax: PRESETS_VASO.arterial.deltaMax,
      cor: PRESETS_VASO.arterial.cor,
    });
    expect(ajusteArterial.erro).toBeUndefined();
    expect(ajusteArterial.pintados).toBe(186);
    expect(estado.segmentos).toHaveLength(1);
    expect(estado.rotulos[idx(4, 6, 6)]).toBe(0);
    expect(estado.rotulos[idx(12, 6, 10)]).toBe(1);
    expect(estado.segmentos[0]?.cor).toEqual([220, 48, 48]);

    // Ajuste mais apertado (-30 a +30): exclui o ramo de 250 HU mantendo apenas o tronco (162 voxels)
    const ajusteFino = recalcularVasoEmEstado(estado, volume, { deltaMin: -30, deltaMax: 30 });
    expect(ajusteFino.pintados).toBe(162);
    expect(estado.rotulos[idx(12, 6, 10)]).toBe(0);
    expect(estado.rotulos[idx(6, 6, 19)]).toBe(1);

    // Preset Venoso / Porta (-35 a +150 HU, azul [50, 115, 220]) em novo segmento
    expect(PRESETS_VASO.venoso.deltaMin).toBe(-35);
    expect(PRESETS_VASO.venoso.deltaMax).toBe(150);
    expect(PRESETS_VASO.venoso.cor).toEqual([50, 115, 220]);

    const venoso = aplicarVasoEmEstado(estado, volume, [15, 5, 6], {
      modo: 'venoso',
      deltaMin: PRESETS_VASO.venoso.deltaMin,
      deltaMax: PRESETS_VASO.venoso.deltaMax,
    });
    expect(venoso.criado).toBe(true);
    expect(venoso.segmento?.nome).toBe('Vaso 2');
    expect(venoso.segmento?.cor).toEqual(CORES_VENA[1]);
    expect(venoso.pintados).toBe(40); // 10 cortes * 2x2
  });

  it('detecta fase arterial vs portal automaticamente e impede vazar para parênquima ou cortical óssea', () => {
    const art = calcularFaixaInteligenteVaso(310, 'auto', 100, true);
    expect(art.modoEfetivo).toBe('arterial');
    expect(art.pisoMin).toBeGreaterThanOrEqual(115);
    expect(art.tetoMax).toBeLessThanOrEqual(650);

    const porta = calcularFaixaInteligenteVaso(145, 'auto', 100, true);
    expect(porta.modoEfetivo).toBe('venoso');
    expect(porta.pisoMin).toBeGreaterThanOrEqual(95);

    // Simula veia porta (145 HU) encostada em parênquima hepático (88 HU) e aorta (300 HU) encostada em cortical vertebral (750 HU)
    const d = new Float32Array(NX * NY * NZ).fill(88);
    for (let k = 4; k <= 12; k++) {
      d[idx(10, 10, k)] = 145;
      d[idx(11, 10, k)] = 145;
      d[idx(5, 5, k)] = 300;
      d[idx(6, 5, k)] = 750; // cortical óssea encostada
    }
    const vol = { data: d, grid };
    const rPorta = crescerVaso(vol, [10, 10, 6], {
      deltaMin: porta.deltaMin,
      deltaMax: porta.deltaMax,
      pisoMin: porta.pisoMin,
      tetoMax: porta.tetoMax,
    });
    expect(rPorta.indices.length).toBe(18); // apenas a veia porta, sem invadir o fígado de 88 HU!

    const rAorta = crescerVaso(vol, [5, 5, 6], {
      deltaMin: art.deltaMin,
      deltaMax: art.deltaMax,
      pisoMin: art.pisoMin,
      tetoMax: art.tetoMax,
    });
    expect(rAorta.indices.length).toBe(9); // apenas a aorta, sem invadir a cortical vertebral de 750 HU!
  });

  it('configura pincel fino (2,5 mm), auto-ligar cortes por padrão e limpeza de defeitos (buracos + ilhas)', () => {
    expect(RAIO_PADRAO_MM).toBe(2.5);
    expect(autoLigarCortesPincel()).toBe(true);
    expect(FERRAMENTAS_SEGMENTACAO.map((f) => f.rotulo)).toEqual(['Pincel', 'Corrigir', 'Vasos']);

    // Anel oco 5x5 no corte k=2 (centro 3x3 vazio = 9 voxels de buraco) * 4 cortes = >36 voxels na peça principal
    // + 2 voxels de respingo isolado em k=10
    const rot = new Uint8Array(10 * 10 * 12);
    const id10 = (i: number, j: number, k: number) => i + j * 10 + k * 100;
    for (let k = 1; k <= 4; k++) {
      for (let j = 2; j <= 6; j++) {
        for (let i = 2; i <= 6; i++) {
          const borda = i === 2 || i === 6 || j === 2 || j === 6;
          if (borda) rot[id10(i, j, k)] = 1;
        }
      }
    }
    rot[id10(8, 8, 10)] = 1;
    rot[id10(9, 8, 10)] = 1;

    const limpo = limparDefeitosMascaraPuro(rot, [10, 10, 12], 1);
    expect(limpo.buracosPreenchidos).toBe(36); // 9 por corte * 4 cortes
    expect(limpo.ilhasRemovidas).toBe(2);
    expect(rot[id10(4, 4, 2)]).toBe(1);
    expect(rot[id10(8, 8, 10)]).toBe(0);
  });
});
