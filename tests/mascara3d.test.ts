import { describe, expect, it } from 'vitest';
import {
  recortarPoligono3d,
  removerMesa3d,
  removerOsso3d,
  restaurarMascara3d,
  type ProjeccaoCamera3d,
} from '../src/render3d/mascara3d';
import type { VolumeGrid } from '../src/io/geometry';

const NX = 24;
const NY = 24;
const NZ = 12;
const idx = (i: number, j: number, k: number): number => i + j * NX + k * NX * NY;

/**
 * Phantom 3D sintético em HU:
 * - Ar de fundo: -1000 HU
 * - Corpo do paciente: elipsoide/bloco central (i=6..17, j=5..16, k=1..10) a 40 HU
 * - Aorta contrastada dentro do paciente: i=11..12, j=8..9, k=1..10 a 300 HU
 * - Vértebra (córtex fechado 600 HU ao redor de medular 220 HU):
 *   anel cortical em i=9..13, j=12..15, k=2..9, com miolo i=10..12, j=13..14 a 220 HU
 * - Prancha da mesa atrás do paciente (separada por ar): i=4..19, j=20..21, k=0..11 a 150 HU
 */
function criarPhantom3d(): Float32Array {
  const data = new Float32Array(NX * NY * NZ).fill(-1000);

  // Corpo do paciente
  for (let k = 1; k <= 10; k++) {
    for (let j = 5; j <= 16; j++) {
      for (let i = 6; i <= 17; i++) {
        data[idx(i, j, k)] = 40;
      }
    }
  }

  // Aorta contrastada (300 HU, sem córtex >= 480 HU)
  for (let k = 1; k <= 10; k++) {
    for (let j = 8; j <= 9; j++) {
      for (let i = 11; i <= 12; i++) {
        data[idx(i, j, k)] = 300;
      }
    }
  }

  // Vértebra: córtex 600 HU nas bordas e medular 220 HU no interior
  for (let k = 2; k <= 9; k++) {
    for (let j = 12; j <= 15; j++) {
      for (let i = 9; i <= 13; i++) {
        const naBorda = i === 9 || i === 13 || j === 12 || j === 15;
        data[idx(i, j, k)] = naBorda ? 600 : 220;
      }
    }
  }

  // Prancha da mesa posterior (separada por ar em j=17..19)
  for (let k = 0; k < NZ; k++) {
    for (let j = 20; j <= 21; j++) {
      for (let i = 4; i <= 19; i++) {
        data[idx(i, j, k)] = 150;
      }
    }
  }

  return data;
}

describe('filtros 3D Sem Mesa e Sem Osso (mascara3d)', () => {
  it('removerMesa3d apaga a prancha da mesa, preserva o paciente e restaura exatamente', () => {
    const data = criarPhantom3d();
    const original = Float32Array.from(data);

    const diff = removerMesa3d(data, [NX, NY, NZ]);
    expect(diff.indices.length).toBeGreaterThan(0);

    // Mesa removida para -1000 HU
    expect(data[idx(10, 20, 5)]).toBe(-1000);
    expect(data[idx(10, 21, 5)]).toBe(-1000);

    // Paciente, aorta e vértebra intactos
    expect(data[idx(8, 7, 5)]).toBe(40);
    expect(data[idx(11, 8, 5)]).toBe(300);
    expect(data[idx(9, 13, 5)]).toBe(600);

    // Restauração exata ao desligar o filtro
    restaurarMascara3d(data, diff);
    expect(data).toEqual(original);
  });

  it('removerOsso3d apaga córtex e medular da vértebra preservando a aorta de 300 HU', () => {
    const data = criarPhantom3d();
    const original = Float32Array.from(data);

    const diff = removerOsso3d(data, [NX, NY, NZ]);
    expect(diff.indices.length).toBeGreaterThan(0);

    // Córtex (600 HU) e medular interna (220 HU) da vértebra foram removidos para -1000 HU
    expect(data[idx(9, 13, 5)]).toBe(-1000);
    expect(data[idx(11, 13, 5)]).toBe(-1000);

    // Aorta contrastada (300 HU) está distante >= 3 voxels do córtex e sem 480 HU -> preservada!
    expect(data[idx(11, 8, 5)]).toBe(300);
    expect(data[idx(12, 9, 5)]).toBe(300);

    // Restauração exata
    restaurarMascara3d(data, diff);
    expect(data).toEqual(original);
  });

  it('permite usar Sem Mesa + Sem Osso juntos e restaurar na ordem inversa sem corromper valores', () => {
    const data = criarPhantom3d();
    const original = Float32Array.from(data);

    const diffMesa = removerMesa3d(data, [NX, NY, NZ]);
    const diffOsso = removerOsso3d(data, [NX, NY, NZ]);

    expect(data[idx(10, 20, 5)]).toBe(-1000);
    expect(data[idx(11, 13, 5)]).toBe(-1000);
    expect(data[idx(11, 8, 5)]).toBe(300);

    restaurarMascara3d(data, diffOsso);
    restaurarMascara3d(data, diffMesa);
    expect(data).toEqual(original);
  });

  it('removerMesa3d remove a prancha da mesa mesmo quando o dorso do paciente encosta nela', () => {
    const data = criarPhantom3d();
    // Conecta o dorso do paciente (j=16) diretamente à prancha da mesa (j=20) na faixa central i=10..13
    for (let k = 2; k <= 9; k++) {
      for (let j = 17; j <= 19; j++) {
        for (let i = 10; i <= 13; i++) {
          data[idx(i, j, k)] = 30;
        }
      }
    }
    const original = Float32Array.from(data);

    const diff = removerMesa3d(data, [NX, NY, NZ]);
    expect(diff.indices.length).toBeGreaterThan(0);

    // Toda a prancha da mesa (j=20..21, inclusive abaixo do contato) é removida para -1000 HU
    expect(data[idx(5, 20, 5)]).toBe(-1000);
    expect(data[idx(11, 20, 5)]).toBe(-1000);
    expect(data[idx(11, 21, 5)]).toBe(-1000);

    // Corpo do paciente, aorta e vértebra acima da prancha permanecem preservados
    expect(data[idx(8, 7, 5)]).toBe(40);
    expect(data[idx(11, 8, 5)]).toBe(300);
    expect(data[idx(9, 13, 5)]).toBe(600);

    restaurarMascara3d(data, diff);
    expect(data).toEqual(original);
  });

  it('removerMesa3d remove a mesa mesmo quando há espuma (-250 HU) ligando o dorso à prancha', () => {
    const data = criarPhantom3d();
    // Espuma do colchão (-250 HU) entre as costas (j=16) e a prancha da mesa (j=20)
    for (let k = 1; k <= 10; k++) {
      for (let j = 17; j <= 19; j++) {
        for (let i = 7; i <= 16; i++) {
          data[idx(i, j, k)] = -250;
        }
      }
    }
    const original = Float32Array.from(data);

    const diff = removerMesa3d(data, [NX, NY, NZ]);
    expect(diff.indices.length).toBeGreaterThan(0);

    // Prancha da mesa e espuma posterior removidas para -1000 HU
    expect(data[idx(10, 20, 5)]).toBe(-1000);
    expect(data[idx(10, 21, 5)]).toBe(-1000);
    expect(data[idx(10, 19, 5)]).toBe(-1000);

    // Paciente, pele, aorta e vértebra preservados
    expect(data[idx(10, 16, 5)]).toBe(40);
    expect(data[idx(11, 8, 5)]).toBe(300);
    expect(data[idx(9, 13, 5)]).toBe(600);

    restaurarMascara3d(data, diff);
    expect(data).toEqual(original);
  });

  it('removerMesa3d preserva pulmão posterior (-750 HU) e gordura subcutânea (-110 HU) em j=0.70*ny removendo 100% da mesa', () => {
    const nx = 64;
    const ny = 64;
    const nz = 8;
    const pIdx = (i: number, j: number, k: number): number => i + j * nx + k * nx * ny;
    const data = new Float32Array(nx * ny * nz).fill(-1000);

    // Tronco (partes moles 40 HU) de j=16..43, i=16..47
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 16; j <= 43; j++) {
        for (let i = 16; i <= 47; i++) {
          data[pIdx(i, j, k)] = 40;
        }
      }
      // Pulmão posterior (-750 HU) em j=36..42 (inclui j=0.70*64=44? Vamos pôr pulmão até j=42 e gordura em j=43..45 = ~0.70*ny)
      for (let j = 36; j <= 42; j++) {
        for (let i = 20; i <= 43; i++) {
          data[pIdx(i, j, k)] = -750;
        }
      }
      // Gordura subcutânea nas costas (-110 HU) em j=43..45 (j=45 ~ 0.70 * 64)
      for (let j = 43; j <= 45; j++) {
        for (let i = 16; i <= 47; i++) {
          data[pIdx(i, j, k)] = -110;
        }
      }
      // Colchão (-220 HU) entre costas e mesa: j=46..53
      for (let j = 46; j <= 53; j++) {
        for (let i = 12; i <= 51; i++) {
          data[pIdx(i, j, k)] = -220;
        }
      }
    }

    // Prancha da mesa (+120 HU) em j=54..56 (~0.85 * 64) em todos os cortes
    for (let k = 0; k < nz; k++) {
      for (let j = 54; j <= 56; j++) {
        for (let i = 8; i <= 55; i++) {
          data[pIdx(i, j, k)] = 120;
        }
      }
    }

    const original = Float32Array.from(data);
    const diff = removerMesa3d(data, [nx, ny, nz]);
    expect(diff.indices.length).toBeGreaterThan(0);

    // 100% da mesa removida para -1000 HU
    for (let k = 0; k < nz; k++) {
      for (let j = 54; j <= 56; j++) {
        for (let i = 8; i <= 55; i++) {
          expect(data[pIdx(i, j, k)]).toBe(-1000);
        }
      }
    }

    // 0 voxels alterados no corpo, pulmão posterior (-750 HU) e gordura subcutânea (-110 HU)
    for (let k = 1; k < nz - 1; k++) {
      for (let j = 16; j <= 45; j++) {
        for (let i = 16; i <= 47; i++) {
          expect(data[pIdx(i, j, k)]).toBe(original[pIdx(i, j, k)]);
        }
      }
    }

    restaurarMascara3d(data, diff);
    expect(data).toEqual(original);
  });

  it('recortarPoligono3d (Tesoura 3D) apaga dentro ou fora do laço e permite desfazer exatamente', () => {
    const data = criarPhantom3d();
    const original = Float32Array.from(data);
    const grid: VolumeGrid = {
      dims: [NX, NY, NZ],
      origin: [0, 0, 0],
      stepI: [1, 0, 0],
      stepJ: [0, 1, 0],
      stepK: [0, 0, 1],
      spacing: [1, 1, 1],
    };
    // Vista coronal simples: X_mundo -> x_canvas, Z_mundo -> y_canvas (independente de Y_mundo)
    const proj: ProjeccaoCamera3d = {
      focalPoint: [0, 0, 0],
      canvasFocal: [0, 0],
      eixoX: [1, 0],
      eixoY: [0, 0],
      eixoZ: [0, 1],
    };
    // Polígono cobrindo apenas i = 10..13, k = 3..7
    const laco: Array<[number, number]> = [
      [9.5, 2.5],
      [13.5, 2.5],
      [13.5, 7.5],
      [9.5, 7.5],
    ];

    const diffDentro = recortarPoligono3d(data, grid, proj, laco, 'dentro', -1000);
    expect(diffDentro.indices.length).toBeGreaterThan(0);
    // Voxel dentro do laço (i=11, j=8, k=5) foi apagado para -1000
    expect(data[idx(11, 8, 5)]).toBe(-1000);
    // Voxel fora do laço (i=7, j=8, k=5) continua intacto (40 HU)
    expect(data[idx(7, 8, 5)]).toBe(40);

    // Desfaz o recorte 'dentro'
    restaurarMascara3d(data, diffDentro);
    expect(data).toEqual(original);

    // Agora recorta 'fora' do mesmo laço
    const diffFora = recortarPoligono3d(data, grid, proj, laco, 'fora', -1000);
    expect(diffFora.indices.length).toBeGreaterThan(0);
    expect(data[idx(11, 8, 5)]).toBe(300); // aorta dentro do laço preservada!
    expect(data[idx(7, 8, 5)]).toBe(-1000); // fora do laço apagado!

    restaurarMascara3d(data, diffFora);
    expect(data).toEqual(original);
  });
});
