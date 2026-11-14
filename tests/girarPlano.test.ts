import { describe, expect, it } from 'vitest';
import { girarCamera, girarVetor, projetarNoPlano, type CameraPlano } from '../src/tools/girarPlano';
import { FACES_DO_CUBO, nomeDoPlano, paraTela } from '../src/viewer/cuboOrientacao';

type Vec = [number, number, number];
const perto = (a: Vec, b: Vec): void => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, 9);
};
const escalar = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vetorial = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const menos = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Axial visto pelos pés: normal para os pés, anterior em cima. */
const AXIAL: CameraPlano = {
  position: [0, 0, -500],
  focalPoint: [0, 0, 0],
  viewUp: [0, -1, 0],
  viewPlaneNormal: [0, 0, -1],
};

/** Posição de `p` na tela (x, y) e a distância dele ao plano da imagem (z). */
function naTela(p: Vec, c: CameraPlano): Vec {
  return paraTela(menos(p, c.focalPoint), vetorial(c.viewUp, c.viewPlaneNormal), c.viewUp, c.viewPlaneNormal);
}

describe('girar plano', () => {
  it('gira um vetor 90° em torno de um eixo', () => {
    perto(girarVetor([1, 0, 0], [0, 0, 1], Math.PI / 2), [0, 1, 0]);
    perto(girarVetor([0, 0, 2], [0, 0, 1], 1.234), [0, 0, 2]);
  });

  it('mantém o ponto marcado no plano e no mesmo lugar da tela', () => {
    const pivo: Vec = [30, -20, 0];
    const antes = naTela(pivo, AXIAL);
    let c = girarCamera(AXIAL, pivo, AXIAL.viewUp, (25 * Math.PI) / 180);
    c = girarCamera(c, pivo, vetorial(c.viewUp, c.viewPlaneNormal), (-40 * Math.PI) / 180);
    const depois = naTela(pivo, c);
    expect(depois[2]).toBeCloseTo(0, 9);
    expect(depois[0]).toBeCloseTo(antes[0], 9);
    expect(depois[1]).toBeCloseTo(antes[1], 9);
    expect(nomeDoPlano(c.viewPlaneNormal)).toBe('Oblíquo');
  });

  it('conserva a distância da câmera e os eixos ortogonais e unitários', () => {
    const c = girarCamera(AXIAL, [10, 5, 3], [1, 1, 0], 0.7);
    const d = menos(c.position, c.focalPoint);
    const dist = Math.hypot(d[0], d[1], d[2]);
    expect(dist).toBeCloseTo(500, 9);
    expect(escalar(c.viewUp, c.viewPlaneNormal)).toBeCloseTo(0, 9);
    expect(Math.hypot(...c.viewUp)).toBeCloseTo(1, 9);
    // A normal continua apontando do ponto focal para a câmera.
    perto(c.viewPlaneNormal, [d[0] / dist, d[1] / dist, d[2] / dist]);
  });

  it('girar 90° em torno do eixo vertical leva o axial ao sagital', () => {
    const c = girarCamera(AXIAL, [0, 0, 0], AXIAL.viewUp, Math.PI / 2);
    expect(nomeDoPlano(c.viewPlaneNormal)).toBe('Sagital');
  });

  it('projeta o ponto marcado no plano da imagem', () => {
    perto(projetarNoPlano([12, -7, 40], AXIAL), [12, -7, 0]);
  });
});

describe('cubo de orientação', () => {
  it('dá nome aos planos retos e chama o resto de oblíquo', () => {
    expect(nomeDoPlano([0, 0, -1])).toBe('Axial');
    expect(nomeDoPlano([0, -1, 0])).toBe('Coronal');
    expect(nomeDoPlano([1, 0, 0])).toBe('Sagital');
    expect(nomeDoPlano([0, -0.7071, 0.7071])).toBe('Oblíquo');
  });

  it('no coronal AP a face A fica de frente, com a esquerda do paciente à direita da tela', () => {
    // Câmera na frente do paciente (normal = anterior), cabeça em cima.
    const normal: Vec = [0, -1, 0];
    const cima: Vec = [0, 0, 1];
    const direita = vetorial(cima, normal);
    perto(direita, [1, 0, 0]); // +x = esquerda do paciente
    const face = (letra: string): Vec => FACES_DO_CUBO.find((f) => f.letra === letra)!.normal;
    perto(paraTela(face('A'), direita, cima, normal), [0, 0, 1]); // de frente para o observador
    perto(paraTela(face('E'), direita, cima, normal), [1, 0, 0]); // à direita da tela
    perto(paraTela(face('S'), direita, cima, normal), [0, -1, 0]); // em cima (y do CSS cresce para baixo)
  });
});
