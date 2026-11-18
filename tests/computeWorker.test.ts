import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gridFromVolumeProps } from '../src/io/geometry';
import { coletarBuffersTransferiveis, viewPorTipoArray } from '../src/workers/compute.worker';
import {
  calcularSuperficiesNoWorker,
  calcularVolumetriaNoWorker,
  filtrarMascara3dNoWorker,
  processarTotalSegmentatorNoWorker,
} from '../src/workers/computeClient';

describe('compute worker e cliente assíncrono (Fase B)', () => {
  it('coletarBuffersTransferiveis filtra buffers vazios e duplicados (evita erro ao transferir MALHA_VAZIA)', () => {
    const vazio = new Float32Array(0).buffer;
    const a = new Float32Array([1, 2, 3]).buffer;
    const b = new Uint32Array([0, 1, 2]).buffer;
    const lista = coletarBuffersTransferiveis([vazio, a, b, a, undefined]);
    expect(lista).toHaveLength(2);
    expect(lista).toContain(a);
    expect(lista).toContain(b);
    expect(lista).not.toContain(vazio);
  });

  it('viewPorTipoArray preserva Int16Array e Float32Array sem corromper o buffer', () => {
    const int16 = new Int16Array([-1000, 40, 700, -50]);
    const view16 = viewPorTipoArray(int16.buffer, 'int16');
    expect(view16).toBeInstanceOf(Int16Array);
    expect(Array.from(view16)).toEqual([-1000, 40, 700, -50]);

    const f32 = new Float32Array([1.5, 10.25]);
    const view32 = viewPorTipoArray(f32.buffer, 'float32');
    expect(view32).toBeInstanceOf(Float32Array);
    expect(view32[0]).toBeCloseTo(1.5, 6);
    expect(view32[1]).toBeCloseTo(10.25, 6);
  });

  it('filtrarMascara3dNoWorker preserva Int16Array ao filtrar osso e mesa', async () => {
    const dims: [number, number, number] = [6, 6, 4];
    const base = new Int16Array(6 * 6 * 4).fill(-1000);
    // Coluna/osso denso em (3, 3, 1..2)
    base[3 + 3 * 6 + 1 * 36] = 800;
    base[3 + 3 * 6 + 2 * 36] = 600;
    // Tecido/vaso contrastado separado em (1, 1, 1)
    base[1 + 1 * 6 + 1 * 36] = 280;

    const res = await filtrarMascara3dNoWorker(base, dims, false, true);
    expect(res.trabalho).toBeInstanceOf(Int16Array);
    expect(res.removidosOsso).toBeGreaterThanOrEqual(2);
    expect(res.trabalho[3 + 3 * 6 + 1 * 36]).toBe(-1000);
    expect(res.trabalho[1 + 1 * 6 + 1 * 36]).toBe(280);
    // Original não é mutado
    expect(base[3 + 3 * 6 + 1 * 36]).toBe(800);
  });

  it('calcularVolumetriaNoWorker e calcularSuperficiesNoWorker operam sobre o mesmo contrato', async () => {
    const dims: [number, number, number] = [6, 6, 6];
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const valores = new Int16Array(6 * 6 * 6).fill(30);
    const rotulos = new Uint8Array(6 * 6 * 6);
    for (let k = 2; k <= 3; k++) {
      for (let j = 2; j <= 3; j++) {
        for (let i = 2; i <= 3; i++) {
          const idx = i + j * 6 + k * 36;
          rotulos[idx] = 1;
          valores[idx] = 90;
        }
      }
    }

    const linhas = await calcularVolumetriaNoWorker(
      'pilha-worker-test',
      rotulos,
      { data: valores, grid },
      [{ indice: 1, nome: 'Lesão' }, { indice: 2, nome: 'Vazio' }],
      false,
    );
    expect(linhas[0]!.voxels).toBe(8);
    expect(linhas[0]!.media).toBe(90);
    expect(linhas[1]!.voxels).toBe(0);

    const sups = await calcularSuperficiesNoWorker('pilha-worker-test', rotulos, grid, [1, 2], []);
    expect(sups).toHaveLength(2);
    expect(sups[0]!.malha?.triangleCount).toBeGreaterThan(0);
    expect(sups[1]!.malha?.triangleCount).toBe(0);
  });

  it('processarTotalSegmentatorNoWorker decodifica .nii.gz e popula segmentos', async () => {
    const dims: [number, number, number] = [4, 4, 2];
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const buf = new Uint8Array(352 + 32);
    const dv = new DataView(buf.buffer);
    dv.setInt32(0, 348, true);
    dv.setInt16(40, 3, true);
    dv.setInt16(42, 4, true);
    dv.setInt16(44, 4, true);
    dv.setInt16(46, 2, true);
    dv.setInt16(70, 2, true); // uint8
    dv.setFloat32(108, 352, true);
    buf[352 + 5] = 52; // Aorta

    const gz = new Uint8Array(gzipSync(buf));
    const { estado, resumo } = await processarTotalSegmentatorNoWorker(
      {
        segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
        ativo: 1,
        rotulos: new Uint8Array(32),
      },
      grid,
      [{ nome: 'total.nii.gz', bytes: gz }],
    );
    expect(resumo.importados).toBe(1);
    expect(resumo.nomes).toEqual(['Aorta']);
    expect(estado.rotulos[5]).toBe(1);
  });
});
