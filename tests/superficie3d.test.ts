import { describe, expect, it } from 'vitest';
import { gridFromVolumeProps, type VolumeGrid, voxelToWorld } from '../src/io/geometry';
import {
  CacheSuperficie3d,
  gerarSuperficieSegmento,
  paraPolysVtk,
} from '../src/segmentation/superficie3d';

const idx = (nx: number, ny: number, i: number, j: number, k: number): number =>
  i + j * nx + k * nx * ny;

describe('superfícies 3D de segmentos (fase 10.1)', () => {
  it('devolve malha vazia quando o segmento não possui voxels pintados', () => {
    const grid = gridFromVolumeProps({
      dimensions: [8, 8, 8],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const rotulos = new Uint8Array(8 * 8 * 8);
    const malha = gerarSuperficieSegmento(rotulos, grid, 1);

    expect(malha.vertexCount).toBe(0);
    expect(malha.triangleCount).toBe(0);
    expect(malha.bounds).toBeNull();
  });

  it('posiciona vértices e normais nas coordenadas físicas corretas com spacing, origin e direction anisotrópicos', () => {
    const dims: [number, number, number] = [12, 12, 8];
    const grid: VolumeGrid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [0.5, 1.5, 3.0],
      origin: [-100, 50, -30],
      // Ordem invertida no eixo K e rotação 90° em XY para testar direction completa (inclusive mão esquerda)
      direction: [0, 1, 0, -1, 0, 0, 0, 0, -1],
    });

    const rotulos = new Uint8Array(dims[0] * dims[1] * dims[2]);
    // Cubo de voxels em i=[4..7] (4), j=[5..8] (4), k=[2..4] (3) -> centro em [5.5, 6.5, 3.0]
    for (let k = 2; k <= 4; k++) {
      for (let j = 5; j <= 8; j++) {
        for (let i = 4; i <= 7; i++) {
          rotulos[idx(dims[0], dims[1], i, j, k)] = 2;
        }
      }
    }

    const bruta = gerarSuperficieSegmento(rotulos, grid, 2, { suavizacao: 0 });
    expect(bruta.vertexCount).toBeGreaterThan(0);
    expect(bruta.triangleCount).toBeGreaterThan(0);
    expect(bruta.bounds).not.toBeNull();

    // Centro geométrico esperado em espaço físico (mm):
    // stepI = [0, 0.5, 0], stepJ = [-1.5, 0, 0], stepK = [0, 0, -3]
    // Centro ijk = [5.5, 6.5, 3.0] -> [-100 - 9.75, 50 + 2.75, -30 - 9.0] = [-109.75, 52.75, -39.0]
    const centroEsperado = voxelToWorld(grid, [5.5, 6.5, 3.0]);
    const [minX, maxX, minY, maxY, minZ, maxZ] = bruta.bounds!;
    expect((minX + maxX) / 2).toBeCloseTo(centroEsperado[0], 3);
    expect((minY + maxY) / 2).toBeCloseTo(centroEsperado[1], 3);
    expect((minZ + maxZ) / 2).toBeCloseTo(centroEsperado[2], 3);

    // Extensões físicas exatas do bloco 4*1.5=6mm em X, 4*0.5=2mm em Y, 3*3=9mm em Z
    expect(maxX - minX).toBeCloseTo(6.0, 2);
    expect(maxY - minY).toBeCloseTo(2.0, 2);
    expect(maxZ - minZ).toBeCloseTo(9.0, 2);

    // Confere que todas as faces apontam para fora no espaço físico (mesmo com det < 0)
    let facesParaFora = 0;
    for (let t = 0; t < bruta.triangles.length; t += 3) {
      const ia = bruta.triangles[t]! * 3;
      const ib = bruta.triangles[t + 1]! * 3;
      const ic = bruta.triangles[t + 2]! * 3;
      expect(bruta.triangles[t]!).toBeLessThan(bruta.vertexCount);
      expect(bruta.triangles[t + 1]!).toBeLessThan(bruta.vertexCount);
      expect(bruta.triangles[t + 2]!).toBeLessThan(bruta.vertexCount);

      const ax = bruta.positions[ia]!, ay = bruta.positions[ia + 1]!, az = bruta.positions[ia + 2]!;
      const bx = bruta.positions[ib]!, by = bruta.positions[ib + 1]!, bz = bruta.positions[ib + 2]!;
      const cx = bruta.positions[ic]!, cy = bruta.positions[ic + 1]!, cz = bruta.positions[ic + 2]!;
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const tx = (ax + bx + cx) / 3 - centroEsperado[0];
      const ty = (ay + by + cy) / 3 - centroEsperado[1];
      const tz = (az + bz + cz) / 3 - centroEsperado[2];
      if (nx * tx + ny * ty + nz * tz > 0) facesParaFora++;
    }
    expect(facesParaFora).toBe(bruta.triangleCount);
  });

  it('gera malha fechada suavizada para uma esfera, fecha segmentos na borda e converte para vtkCellArray', () => {
    const N = 16;
    const grid = gridFromVolumeProps({
      dimensions: [N, N, N],
      spacing: [2, 2, 2],
      origin: [10, 20, 30],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const rotulos = new Uint8Array(N * N * N);

    // Esfera de segmento 1 centrada em (8, 8, 8) com raio 4 voxels (8 mm)
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if ((i - 8) ** 2 + (j - 8) ** 2 + (k - 8) ** 2 <= 16) {
            rotulos[idx(N, N, i, j, k)] = 1;
          }
        }
      }
    }
    // Segmento 2 encostando na borda (i=0..1, j=0..1, k=0..1) não deve contaminar o 1 nem abrir buracos
    for (let k = 0; k <= 1; k++) {
      for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= 1; i++) {
          rotulos[idx(N, N, i, j, k)] = 2;
        }
      }
    }

    const esfera = gerarSuperficieSegmento(rotulos, grid, 1, { suavizacao: 3 });
    expect(esfera.vertexCount).toBeGreaterThan(20);
    expect(esfera.triangleCount).toBeGreaterThan(30);

    // Centro físico da esfera em (10 + 16, 20 + 16, 30 + 16) = (26, 36, 46)
    const [minX, maxX, minY, maxY, minZ, maxZ] = esfera.bounds!;
    expect((minX + maxX) / 2).toBeCloseTo(26, 1);
    expect((minY + maxY) / 2).toBeCloseTo(36, 1);
    expect((minZ + maxZ) / 2).toBeCloseTo(46, 1);
    // Diâmetro suavizado preservado perto de 16 mm (sem encolhimento excessivo)
    expect(maxX - minX).toBeGreaterThan(15);
    expect(maxX - minX).toBeLessThan(18.5);

    // Todas as normais têm módulo ~1
    for (let v = 0; v < esfera.normals.length; v += 3) {
      const mag = Math.hypot(esfera.normals[v]!, esfera.normals[v + 1]!, esfera.normals[v + 2]!);
      expect(mag).toBeCloseTo(1, 4);
    }

    // Malha fechada sem bordas abertas (cada aresta pertence a exatamente 2 triângulos)
    const arestas = new Map<string, number>();
    for (let t = 0; t < esfera.triangles.length; t += 3) {
      const vs = [esfera.triangles[t]!, esfera.triangles[t + 1]!, esfera.triangles[t + 2]!];
      for (let e = 0; e < 3; e++) {
        const a = vs[e]!;
        const b = vs[(e + 1) % 3]!;
        const chave = a < b ? `${a}-${b}` : `${b}-${a}`;
        arestas.set(chave, (arestas.get(chave) ?? 0) + 1);
      }
    }
    for (const contagem of arestas.values()) {
      expect(contagem).toBe(2);
    }

    // Formato vtkCellArray [3, a, b, c, ...]
    const polysVtk = paraPolysVtk(esfera.triangles);
    expect(polysVtk.length).toBe(esfera.triangleCount * 4);
    expect(polysVtk[0]).toBe(3);

    // Segmento 2 encostando na borda (0,0,0) também gera superfície fechada
    const borda = gerarSuperficieSegmento(rotulos, grid, 2);
    expect(borda.triangleCount).toBeGreaterThan(0);
    expect(borda.bounds![0]).toBeLessThan(10); // metade do voxel (0 -> -0.5) fica abaixo da origem 10 mm
  });

  it('faz cache por segmento e só recalcula quando os voxels daquele segmento mudam', () => {
    const N = 10;
    const grid = gridFromVolumeProps({
      dimensions: [N, N, N],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const rotulos = new Uint8Array(N * N * N);
    rotulos[idx(N, N, 2, 2, 2)] = 1;
    rotulos[idx(N, N, 7, 7, 7)] = 2;

    const cache = new CacheSuperficie3d();

    const s1a = cache.obter('serie-1', rotulos, grid, 1);
    const s2a = cache.obter('serie-1', rotulos, grid, 2);
    expect(s1a.doCache).toBe(false);
    expect(s2a.doCache).toBe(false);

    // Sem edição -> cache hit O(1)
    const s1b = cache.obter('serie-1', rotulos, grid, 1);
    expect(s1b.doCache).toBe(true);
    expect(s1b.malha).toBe(s1a.malha);

    // Suja apenas segmento 2 -> segmento 1 continua vindo do cache
    rotulos[idx(N, N, 7, 7, 6)] = 2;
    cache.marcarSujo('serie-1', 2);
    expect(cache.obter('serie-1', rotulos, grid, 1).doCache).toBe(true);
    const s2b = cache.obter('serie-1', rotulos, grid, 2);
    expect(s2b.doCache).toBe(false);
    expect(s2b.malha).not.toBe(s2a.malha);

    // Suja toda a pilha sem alterar os voxels do segmento 1 -> assinatura igual preserva malha em cache
    cache.marcarSujo('serie-1');
    const s1c = cache.obter('serie-1', rotulos, grid, 1);
    expect(s1c.doCache).toBe(true);
    expect(s1c.malha).toBe(s1a.malha);

    // Ao editar um voxel do segmento 1, a malha é recalculada
    rotulos[idx(N, N, 3, 2, 2)] = 1;
    cache.marcarSujo('serie-1', 1);
    const s1d = cache.obter('serie-1', rotulos, grid, 1);
    expect(s1d.doCache).toBe(false);
    expect(s1d.malha).not.toBe(s1a.malha);
  });

  it('obterSeLimpo e obterLote resolvem múltiplos segmentos em uma passada com boundsIjk exato', () => {
    const N = 10;
    const grid = gridFromVolumeProps({
      dimensions: [N, N, N],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const rotulos = new Uint8Array(N * N * N);
    rotulos[idx(N, N, 1, 2, 3)] = 1;
    rotulos[idx(N, N, 2, 2, 3)] = 1;
    rotulos[idx(N, N, 6, 7, 8)] = 2;

    const cache = new CacheSuperficie3d();
    expect(cache.obterSeLimpo('serie-2', 1)).toBeUndefined();

    // Primeira passagem em lote constrói 1, 2 e 3 (vazio)
    const lote1 = cache.obterLote('serie-2', rotulos, grid, [1, 2, 3]);
    expect(lote1.get(1)!.doCache).toBe(false);
    expect(lote1.get(1)!.malha.triangleCount).toBeGreaterThan(0);
    expect(lote1.get(2)!.malha.triangleCount).toBeGreaterThan(0);
    expect(lote1.get(3)!.malha.triangleCount).toBe(0);
    // Bate exatamente com a geração individual
    const ind1 = gerarSuperficieSegmento(rotulos, grid, 1);
    expect(lote1.get(1)!.malha.positions).toEqual(ind1.positions);
    expect(lote1.get(1)!.malha.triangles).toEqual(ind1.triangles);

    // obterSeLimpo devolve sem leitura do array
    expect(cache.obterSeLimpo('serie-2', 1)?.doCache).toBe(true);

    // Edita apenas o 2, marca todos sujos -> 1 continua reaproveitado pela assinatura, 2 recalcula
    rotulos[idx(N, N, 6, 7, 7)] = 2;
    cache.marcarSujo('serie-2');
    const lote2 = cache.obterLote('serie-2', rotulos, grid, [1, 2]);
    expect(lote2.get(1)!.doCache).toBe(true);
    expect(lote2.get(1)!.malha).toBe(lote1.get(1)!.malha);
    expect(lote2.get(2)!.doCache).toBe(false);
    expect(lote2.get(2)!.malha).not.toBe(lote1.get(2)!.malha);
  });
});
