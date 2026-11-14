import { describe, expect, it } from 'vitest';
import {
  type CabecalhoSegmentacao,
  codificarSegmentacao,
  conferirSegmentacao,
  type GeometriaSalva,
  lerSegmentacao,
  nomeSugerido,
} from '../src/segmentation/arquivoSegmentacao';

const geometria: GeometriaSalva = {
  dims: [8, 6, 4],
  spacing: [0.7, 0.7, 3],
  origin: [-100, -120, 30],
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

const base = {
  serieUid: '1.2.3.4',
  referencialUid: '1.2.3.9',
  serie: 'CT · TÓRAX',
  geometria,
  segmentos: [
    { indice: 1, nome: 'Fígado', cor: [230, 60, 60] as [number, number, number], visivel: true, bloqueado: false },
    { indice: 2, nome: 'Lesão', cor: [60, 180, 90] as [number, number, number], visivel: false, bloqueado: true },
  ],
  ativo: 2,
  salvoEm: '2026-11-13T22:00:00.000Z',
};

function rotulos(): Uint8Array {
  const r = new Uint8Array(8 * 6 * 4);
  for (let i = 0; i < r.length; i++) r[i] = i % 7 === 0 ? 1 : i % 11 === 0 ? 2 : 0;
  return r;
}

describe('arquivo .vseg', () => {
  it('salva e reabre voxel a voxel, com os segmentos', async () => {
    const original = rotulos();
    const bytes = await codificarSegmentacao(base, original);
    const { cabecalho, rotulos: lidos } = await lerSegmentacao(bytes);
    expect(Array.from(lidos)).toEqual(Array.from(original));
    expect(cabecalho.segmentos).toEqual(base.segmentos);
    expect(cabecalho.ativo).toBe(2);
    expect(cabecalho.versao).toBe(1);
  });

  it('não guarda nome nem ID do paciente', async () => {
    const bytes = await codificarSegmentacao(base, rotulos());
    const texto = new TextDecoder().decode(bytes.subarray(0, 600));
    expect(texto).not.toMatch(/patient|paciente/i);
  });

  it('recusa arquivo que não é .vseg ou está cortado', async () => {
    await expect(lerSegmentacao(new TextEncoder().encode('qualquer coisa'))).rejects.toThrow(/não é uma segmentação/);
    const bytes = await codificarSegmentacao(base, rotulos());
    await expect(lerSegmentacao(bytes.subarray(0, bytes.length - 10))).rejects.toThrow(/corrompido/);
  });

  it('recusa máscara de tamanho errado ao salvar', async () => {
    await expect(codificarSegmentacao(base, new Uint8Array(5))).rejects.toThrow();
  });

  it('confere série e grade antes de aplicar', async () => {
    const { cabecalho } = await lerSegmentacao(await codificarSegmentacao(base, rotulos()));
    const cab = cabecalho as CabecalhoSegmentacao;
    expect(conferirSegmentacao(cab, { serieUid: '1.2.3.4', geometria })).toBeNull();
    expect(conferirSegmentacao(cab, { serieUid: '9.9', geometria })).toMatch(/outra série/);
    expect(conferirSegmentacao(cab, { serieUid: '1.2.3.4', geometria: { ...geometria, dims: [8, 6, 5] } })).toMatch(
      /grade é diferente/,
    );
    expect(
      conferirSegmentacao(cab, { serieUid: '1.2.3.4', geometria: { ...geometria, spacing: [0.7, 0.7, 2.5] } }),
    ).toMatch(/voxel/);
    expect(
      conferirSegmentacao(cab, { serieUid: '1.2.3.4', geometria: { ...geometria, origin: [-100, -120, 33] } }),
    ).toMatch(/posição/);
  });

  it('nome sugerido sem acentos nem espaços', () => {
    expect(nomeSugerido('CT · TÓRAX c/ contraste')).toBe('segmentacao-ct-torax-c-contraste.vseg');
  });
});
