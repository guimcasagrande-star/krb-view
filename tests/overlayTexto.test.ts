import { describe, expect, it } from 'vitest';
import { montarOverlay } from '../src/viewer/overlayTexto';
import type { InstanceMeta } from '../src/io/types';

function corte(extra: Partial<InstanceMeta> = {}): InstanceMeta {
  return { fileId: 'a', imageType: [], windowCenter: [], windowWidth: [], ...extra };
}

const primeira = corte({
  patientName: 'SILVA^JOAO^^^',
  patientId: '12345',
  studyDate: '20260315',
  studyDescription: 'TC abdome',
  modality: 'CT',
  seriesDescription: 'Abdome contraste',
});

describe('montarOverlay', () => {
  it('monta os quatro cantos com paciente, estudo, corte, janela e zoom', () => {
    const atual = corte({
      modality: 'CT',
      seriesDescription: 'Abdome contraste',
      sliceThickness: 2.5,
      sliceLocation: -120.5,
    });
    const t = montarOverlay({
      primeira,
      atual,
      indice: 41,
      total: 500,
      voiRange: { lower: -160, upper: 240 },
      zoom: 1.08,
    });
    expect(t.superiorEsquerdo).toEqual(['JOAO SILVA', 'ID 12345']);
    expect(t.superiorDireito).toEqual(['Estudo 15/03/2026', 'CT · Abdome contraste', 'TC abdome']);
    expect(t.inferiorEsquerdo).toEqual(['Corte 42 / 500', 'Espessura 2,5 mm', 'Posição -120,5 mm']);
    expect(t.inferiorDireito).toEqual(['Janela 400 · Nível 40', 'Zoom 108%']);
  });

  it('usa a posição em z quando sliceLocation não existe', () => {
    const atual = corte({ imagePositionPatient: [0, 0, 33] });
    const t = montarOverlay({ primeira, atual, indice: 0, total: 1 });
    expect(t.inferiorEsquerdo).toContain('Posição 33 mm');
  });

  it('omite o que não existe, sem inventar valor', () => {
    const t = montarOverlay({ primeira: corte(), atual: corte(), indice: 0, total: 3 });
    expect(t.superiorEsquerdo).toEqual([]);
    expect(t.superiorDireito).toEqual([]);
    expect(t.inferiorEsquerdo).toEqual(['Corte 1 / 3']);
    expect(t.inferiorDireito).toEqual([]);
  });
});
