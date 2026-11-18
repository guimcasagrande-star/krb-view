/**
 * Filtros rápidos sobre o volume exibido no Viewport 3D:
 * - "Sem mesa" (`removerMesa3d`): remove a mesa/suportes posteriores desconexos do corpo do paciente.
 * - "Sem osso" (`removerOsso3d`): remove estruturas ósseas (córtex >= 480 HU, osso contínuo >= 240 HU,
 *   medular interna cercada por córtex e casca de volume parcial) preservando vasos contrastados.
 *
 * Ambos devolvem um `DiffMascara3d` com índices e valores originais para restaurar instantaneamente
 * ao desligar os botões, sem recarregar o volume.
 */

import type { VolumeGrid } from '../io/geometry';

export interface DiffMascara3d {
  indices: Int32Array;
  valoresOriginais: Float32Array;
}

export interface ProjeccaoCamera3d {
  focalPoint: readonly [number, number, number];
  canvasFocal: readonly [number, number];
  eixoX: readonly [number, number];
  eixoY: readonly [number, number];
  eixoZ: readonly [number, number];
  perspectiva?: {
    eye: readonly [number, number, number];
    normal: readonly [number, number, number];
  };
}

export interface BufferVolumeEditavel {
  length: number;
  [index: number]: number;
}

const VALOR_AR_HU = -1000;
const LIMIAR_TECIDOS_MESA = -500;
const LIMIAR_CORPO_ANTERIOR = -450;
const LIMIAR_NUCLEO_POSTERIOR = -150;
const LIMIAR_QUEDA_ESPUMA = -160;
const LIMIAR_CORTEX_OSSO = 480;
const LIMIAR_OSSO_CONTINUO = 240;
const LIMIAR_CASCA_PARCIAL = 80;

const VIZINHOS_6: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Restaura exatamente os voxels modificados por um filtro 3D. */
export function restaurarMascara3d(data: BufferVolumeEditavel, diff: DiffMascara3d): void {
  const { indices, valoresOriginais } = diff;
  for (let i = 0; i < indices.length; i++) {
    data[indices[i]!] = valoresOriginais[i]!;
  }
}

function aplicarListaParaAr(data: BufferVolumeEditavel, alvos: number[]): DiffMascara3d {
  const indices = Int32Array.from(alvos);
  const valoresOriginais = new Float32Array(alvos.length);
  for (let n = 0; n < alvos.length; n++) {
    const idx = alvos[n]!;
    valoresOriginais[n] = data[idx]!;
    data[idx] = VALOR_AR_HU;
  }
  return { indices, valoresOriginais };
}

/**
 * Remove a mesa do tomógrafo e suportes/cabos externos usando remoção anatômica
 * "De Baixo para Cima (Bottom-Up Shell Removal)":
 * - Separa o núcleo sólido do corpo na região posterior (> -150 HU) para desconectar a espuma
 *   do colchão sem invadir pele, gordura subcutânea ou pulmões.
 * - Desconecta eventuais cascas finas inferiores (<= 14 px) separadas por queda < -160 HU.
 * - Encontra o maior componente conexo 3D (paciente) e protege toda a coluna entre
 *   `jMinCorpo[i]` e `jMaxCorpo[i] + margemPele` (até +4 px) além da dilatação protetora.
 * - Remove exclusivamente voxels > -500 HU abaixo do contorno posterior protegido ou nas abas laterais.
 */
export function removerMesa3d(
  data: BufferVolumeEditavel,
  dims: readonly [number, number, number],
): DiffMascara3d {
  const [nx, ny, nz] = dims;
  const slice = nx * ny;
  const total = slice * nz;
  if (total === 0) return { indices: new Int32Array(0), valoresOriginais: new Float32Array(0) };

  // Passo A: Construir máscara binária `solido` desconectando espuma frouxa na região posterior
  const solido = new Uint8Array(total);
  const jCorteEspuma = Math.floor(ny * 0.62);
  for (let k = 0; k < nz; k++) {
    const baseK = k * slice;
    for (let j = 0; j < ny; j++) {
      const limiar = j >= jCorteEspuma ? LIMIAR_NUCLEO_POSTERIOR : LIMIAR_CORPO_ANTERIOR;
      const baseJ = baseK + j * nx;
      for (let i = 0; i < nx; i++) {
        const idx = baseJ + i;
        if (data[idx]! > limiar) {
          solido[idx] = 1;
        }
      }
    }
  }

  // Fallback: desconectar casca fina inferior (<= 14 px) separada por queda < -160 HU (>= 2 px)
  // antes do bloco espesso do corpo (>= 25 px em imagens clínicas, escalado para phantoms pequenos)
  const jMetadeInf = Math.floor(ny * 0.6);
  const minBlocoCorpo = Math.min(25, Math.max(4, Math.floor(ny * 0.4)));
  const minColsCasca = Math.max(4, Math.floor(nx * 0.15));
  const corteTabelaPorSlice = new Int32Array(nz).fill(ny);
  for (let k = 0; k < nz; k++) {
    const baseK = k * slice;
    const shellsNoCorte: number[] = [];
    for (let i = 0; i < nx; i++) {
      let j = ny - 1;
      while (j >= jMetadeInf && solido[baseK + j * nx + i] === 0) {
        j--;
      }
      if (j < jMetadeInf) continue;

      const jBot = j;
      while (j >= jMetadeInf && solido[baseK + j * nx + i] === 1) {
        j--;
      }
      const jTopShell = j + 1;
      const espessuraCasca = jBot - jTopShell + 1;
      if (espessuraCasca > 14) continue;

      // Medir queda de densidade (< -160 HU) imediatamente acima da casca
      let gap = 0;
      let jScan = jTopShell - 1;
      while (jScan >= 0 && data[baseK + jScan * nx + i]! < LIMIAR_QUEDA_ESPUMA) {
        gap++;
        jScan--;
      }
      if (gap < 2 || jScan < 0) continue;

      // Verificar se acima da queda existe bloco espesso do corpo
      let blocoAcima = 0;
      while (jScan >= 0 && data[baseK + jScan * nx + i]! > LIMIAR_CORPO_ANTERIOR) {
        blocoAcima++;
        jScan--;
      }
      if (blocoAcima >= minBlocoCorpo) {
        shellsNoCorte.push(jTopShell);
        for (let jZ = jTopShell; jZ <= jBot; jZ++) {
          solido[baseK + jZ * nx + i] = 0;
        }
        for (let jZ = jTopShell - gap; jZ < jTopShell; jZ++) {
          if (jZ >= 0) solido[baseK + jZ * nx + i] = 0;
        }
      }
    }

    // Se várias colunas sob o corpo detectaram a lâmina da mesa em uma cota jTopShell,
    // desconecta também a ponte central encostada na mesma cota sem invadir o dorso acima dela.
    if (shellsNoCorte.length >= minColsCasca) {
      shellsNoCorte.sort((a, b) => a - b);
      const jMesaCorte = shellsNoCorte[Math.floor(shellsNoCorte.length * 0.5)]!;
      corteTabelaPorSlice[k] = jMesaCorte;
      for (let jZ = jMesaCorte; jZ < ny; jZ++) {
        const baseJ = baseK + jZ * nx;
        for (let i = 0; i < nx; i++) {
          solido[baseJ + i] = 0;
        }
      }
    }
  }

  // Passo B: Maior componente conexo 3D dentro de `solido` = Paciente
  const visitado = new Uint8Array(total);
  let fila = new Int32Array(Math.min(total, 65536));
  let maiorVoxels: Int32Array | null = null;
  let maiorTamanho = 0;

  for (let start = 0; start < total; start++) {
    if (visitado[start] === 1 || solido[start] === 0) continue;

    let head = 0;
    let tail = 0;
    fila[tail++] = start;
    visitado[start] = 1;

    while (head < tail) {
      const idx = fila[head++]!;
      const k = Math.floor(idx / slice);
      const rest = idx - k * slice;
      const j = Math.floor(rest / nx);
      const i = rest - j * nx;

      for (const [di, dj, dk] of VIZINHOS_6) {
        const ni = i + di;
        const nj = j + dj;
        const nk = k + dk;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
        const nIdx = ni + nj * nx + nk * slice;
        if (visitado[nIdx] === 1 || solido[nIdx] === 0) continue;
        visitado[nIdx] = 1;
        if (tail === fila.length) {
          const prox = new Int32Array(Math.min(total, fila.length * 2));
          prox.set(fila);
          fila = prox;
        }
        fila[tail++] = nIdx;
      }
    }

    if (tail > maiorTamanho) {
      maiorTamanho = tail;
      maiorVoxels = fila.slice(0, tail);
    }
  }

  if (!maiorVoxels || maiorTamanho === 0) {
    return { indices: new Int32Array(0), valoresOriginais: new Float32Array(0) };
  }

  // Passo C: Máscara do paciente + dilatação protetora (até 4 voxels em TCs clínicas) +
  // preenchimento de cavidades entre jMinCorpo[i] e jMaxCorpo[i] + margemPele
  const protegido = new Uint8Array(total);
  const margemPele = Math.max(1, Math.min(4, Math.floor(ny / 60)));

  let frente: number[] = [];
  for (let m = 0; m < maiorVoxels.length; m++) {
    const idx = maiorVoxels[m]!;
    protegido[idx] = 1;
    frente.push(idx);
  }

  // Dilatação protetora de pele ao redor do componente principal (sem invadir ar)
  for (let passo = 0; passo < margemPele; passo++) {
    const proxFrente: number[] = [];
    for (let f = 0; f < frente.length; f++) {
      const idx = frente[f]!;
      const k = Math.floor(idx / slice);
      const rest = idx - k * slice;
      const j = Math.floor(rest / nx);
      const i = rest - j * nx;
      for (const [di, dj, dk] of VIZINHOS_6) {
        const ni = i + di;
        const nj = j + dj;
        const nk = k + dk;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
        const nIdx = ni + nj * nx + nk * slice;
        if (nj < corteTabelaPorSlice[nk]! && protegido[nIdx] === 0 && data[nIdx]! > LIMIAR_TECIDOS_MESA) {
          protegido[nIdx] = 1;
          proxFrente.push(nIdx);
        }
      }
    }
    frente = proxFrente;
  }

  // Passo D: Calcular contorno jMin/jMax por corte/coluna a partir do núcleo do paciente
  // e remover exclusivamente voxels > -500 HU abaixo de jLimiteProtegido (ou abas laterais j >= 0.55*ny)
  const pacienteNucleo = new Uint8Array(total);
  for (let m = 0; m < maiorVoxels.length; m++) {
    pacienteNucleo[maiorVoxels[m]!] = 1;
  }

  const remover: number[] = [];
  const jLateralMesa = Math.floor(ny * 0.55);

  for (let k = 0; k < nz; k++) {
    const baseK = k * slice;
    for (let i = 0; i < nx; i++) {
      let jMin = ny;
      let jMax = -1;
      for (let j = 0; j < ny; j++) {
        if (pacienteNucleo[baseK + j * nx + i] === 1) {
          if (j < jMin) jMin = j;
          if (j > jMax) jMax = j;
        }
      }

      if (jMax >= 0) {
        const jLimiteProtegido = Math.min(corteTabelaPorSlice[k]! - 1, jMax + margemPele);
        for (let j = jLimiteProtegido + 1; j < ny; j++) {
          const idx = baseK + j * nx + i;
          if (protegido[idx] === 0 && data[idx]! > LIMIAR_TECIDOS_MESA) {
            remover.push(idx);
          }
        }
      } else {
        for (let j = jLateralMesa; j < ny; j++) {
          const idx = baseK + j * nx + i;
          if (protegido[idx] === 0 && data[idx]! > LIMIAR_TECIDOS_MESA) {
            remover.push(idx);
          }
        }
      }
    }
  }

  return aplicarListaParaAr(data, remover);
}

/**
 * Remove estruturas ósseas (córtex >= 480 HU conectado a osso >= 240 HU, medular interna
 * cercada por córtex em cada corte e casca de volume parcial de 1 voxel), preservando
 * vasos contrastados (ex.: aorta/veia porta de 150–400 HU) sem córtex >= 480 HU.
 */
export function removerOsso3d(
  data: BufferVolumeEditavel,
  dims: readonly [number, number, number],
): DiffMascara3d {
  const [nx, ny, nz] = dims;
  const slice = nx * ny;
  const total = slice * nz;
  if (total === 0) return { indices: new Int32Array(0), valoresOriginais: new Float32Array(0) };

  const osso = new Uint8Array(total);
  let fila = new Int32Array(Math.min(total, 65536));
  let head = 0;
  let tail = 0;

  // 1. Semear em todos os voxels corticais densos (>= 480 HU)
  for (let i = 0; i < total; i++) {
    if (data[i]! >= LIMIAR_CORTEX_OSSO) {
      osso[i] = 1;
      if (tail === fila.length) {
        const prox = new Int32Array(Math.min(total, fila.length * 2));
        prox.set(fila);
        fila = prox;
      }
      fila[tail++] = i;
    }
  }

  if (tail === 0) {
    return { indices: new Int32Array(0), valoresOriginais: new Float32Array(0) };
  }

  // 2. Crescer conectividade 6 no osso contínuo (>= 240 HU)
  while (head < tail) {
    const idx = fila[head++]!;
    const k = Math.floor(idx / slice);
    const rest = idx - k * slice;
    const j = Math.floor(rest / nx);
    const i = rest - j * nx;

    for (const [di, dj, dk] of VIZINHOS_6) {
      const ni = i + di;
      const nj = j + dj;
      const nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      const nIdx = ni + nj * nx + nk * slice;
      if (osso[nIdx] === 1 || data[nIdx]! < LIMIAR_OSSO_CONTINUO) continue;
      osso[nIdx] = 1;
      if (tail === fila.length) {
        const prox = new Int32Array(Math.min(total, fila.length * 2));
        prox.set(fila);
        fila = prox;
      }
      fila[tail++] = nIdx;
    }
  }

  // 3. Preencher osso medular interno cercado por córtex em cada corte 2D
  const externo2d = new Uint8Array(slice);
  const fila2d = new Int32Array(slice);
  for (let k = 0; k < nz; k++) {
    const baseK = k * slice;
    externo2d.fill(0);
    let h2 = 0;
    let t2 = 0;

    const tentarBorda = (i: number, j: number): void => {
      const p = i + j * nx;
      if (externo2d[p] === 1 || osso[baseK + p] === 1) return;
      externo2d[p] = 1;
      fila2d[t2++] = p;
    };

    for (let i = 0; i < nx; i++) {
      tentarBorda(i, 0);
      tentarBorda(i, ny - 1);
    }
    for (let j = 1; j < ny - 1; j++) {
      tentarBorda(0, j);
      tentarBorda(nx - 1, j);
    }

    while (h2 < t2) {
      const p = fila2d[h2++]!;
      const j = Math.floor(p / nx);
      const i = p - j * nx;
      if (i > 0) {
        const np = p - 1;
        if (externo2d[np] === 0 && osso[baseK + np] === 0) {
          externo2d[np] = 1;
          fila2d[t2++] = np;
        }
      }
      if (i + 1 < nx) {
        const np = p + 1;
        if (externo2d[np] === 0 && osso[baseK + np] === 0) {
          externo2d[np] = 1;
          fila2d[t2++] = np;
        }
      }
      if (j > 0) {
        const np = p - nx;
        if (externo2d[np] === 0 && osso[baseK + np] === 0) {
          externo2d[np] = 1;
          fila2d[t2++] = np;
        }
      }
      if (j + 1 < ny) {
        const np = p + nx;
        if (externo2d[np] === 0 && osso[baseK + np] === 0) {
          externo2d[np] = 1;
          fila2d[t2++] = np;
        }
      }
    }

    for (let p = 0; p < slice; p++) {
      if (externo2d[p] === 0 && osso[baseK + p] === 0) {
        osso[baseK + p] = 1;
      }
    }
  }

  // 4. Dilatação de 1 voxel na casca parcial (>= 80 HU) e coleta dos índices a remover
  const remover: number[] = [];
  const dilatado = new Uint8Array(total);
  for (let idx = 0; idx < total; idx++) {
    if (osso[idx] !== 1) continue;
    if (dilatado[idx] === 0) {
      dilatado[idx] = 1;
      remover.push(idx);
    }
    const k = Math.floor(idx / slice);
    const rest = idx - k * slice;
    const j = Math.floor(rest / nx);
    const i = rest - j * nx;
    for (const [di, dj, dk] of VIZINHOS_6) {
      const ni = i + di;
      const nj = j + dj;
      const nk = k + dk;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= nx || nj >= ny || nk >= nz) continue;
      const nIdx = ni + nj * nx + nk * slice;
      if (dilatado[nIdx] === 0 && osso[nIdx] === 0 && data[nIdx]! >= LIMIAR_CASCA_PARCIAL) {
        dilatado[nIdx] = 1;
        remover.push(nIdx);
      }
    }
  }

  return aplicarListaParaAr(data, remover);
}

/** Teste rápido ray-casting se o ponto 2D `(px, py)` está dentro do polígono fechado. */
export function pontoNoPoligono2d(
  px: number,
  py: number,
  xs: Float64Array,
  ys: Float64Array,
): boolean {
  const n = xs.length;
  let dentro = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xs[i]!;
    const yi = ys[i]!;
    const xj = xs[j]!;
    const yj = ys[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/**
 * Tesoura 3D: projeta cada voxel da grade 3D para o canvas 2D da câmera atual e apaga
 * (define para `valorVazio`, ex.: -1000 HU na TC ou 0 na RM) os voxels projetados
 * dentro (`modo === 'dentro'`) ou fora (`modo === 'fora'`) do laço desenhado pelo usuário.
 * Devolve `DiffMascara3d` para permitir desfazer (`↶`) instantaneamente.
 */
export function recortarPoligono3d(
  data: BufferVolumeEditavel,
  grid: VolumeGrid,
  projeccao: ProjeccaoCamera3d,
  poligono: ReadonlyArray<readonly [number, number]>,
  modo: 'dentro' | 'fora',
  valorVazio: number = VALOR_AR_HU,
): DiffMascara3d {
  const [nx, ny, nz] = grid.dims;
  const total = nx * ny * nz;
  if (total === 0 || poligono.length < 3) {
    return { indices: new Int32Array(0), valoresOriginais: new Float32Array(0) };
  }

  const nVerts = poligono.length;
  const polyX = new Float64Array(nVerts);
  const polyY = new Float64Array(nVerts);
  let minPx = Infinity;
  let maxPx = -Infinity;
  let minPy = Infinity;
  let maxPy = -Infinity;
  for (let v = 0; v < nVerts; v++) {
    const x = poligono[v]![0];
    const y = poligono[v]![1];
    polyX[v] = x;
    polyY[v] = y;
    if (x < minPx) minPx = x;
    if (x > maxPx) maxPx = x;
    if (y < minPy) minPy = y;
    if (y > maxPy) maxPy = y;
  }

  const [ox, oy, oz] = grid.origin;
  const [ix, iy, iz] = grid.stepI;
  const [jx, jy, jz] = grid.stepJ;
  const [kx, ky, kz] = grid.stepK;
  const [fx, fy, fz] = projeccao.focalPoint;
  const [cx0, cy0] = projeccao.canvasFocal;
  const [exX, eyX] = projeccao.eixoX;
  const [exY, eyY] = projeccao.eixoY;
  const [exZ, eyZ] = projeccao.eixoZ;

  const alvos: number[] = [];
  const slice = nx * ny;
  const persp = projeccao.perspectiva;

  if (!persp) {
    // Projeção paralela (padrão do Cornerstone 3D): incremento afim exato + rejeição em blocos 8³
    const baseDx = ox - fx;
    const baseDy = oy - fy;
    const baseDz = oz - fz;
    const cOrigX = cx0 + baseDx * exX + baseDy * exY + baseDz * exZ;
    const cOrigY = cy0 + baseDx * eyX + baseDy * eyY + baseDz * eyZ;

    const dCxI = ix * exX + iy * exY + iz * exZ;
    const dCyI = ix * eyX + iy * eyY + iz * eyZ;
    const dCxJ = jx * exX + jy * exY + jz * exZ;
    const dCyJ = jx * eyX + jy * eyY + jz * eyZ;
    const dCxK = kx * exX + ky * exY + kz * exZ;
    const dCyK = kx * eyX + ky * eyY + kz * eyZ;

    const BLOCO = 8;
    for (let bk = 0; bk < nz; bk += BLOCO) {
      const kFim = Math.min(nz, bk + BLOCO);
      const dkMax = kFim - 1 - bk;
      for (let bj = 0; bj < ny; bj += BLOCO) {
        const jFim = Math.min(ny, bj + BLOCO);
        const djMax = jFim - 1 - bj;
        for (let bi = 0; bi < nx; bi += BLOCO) {
          const iFim = Math.min(nx, bi + BLOCO);
          const diMax = iFim - 1 - bi;

          // Caixa envolvente 2D exata deste bloco afim
          const bx0 = cOrigX + bi * dCxI + bj * dCxJ + bk * dCxK;
          const by0 = cOrigY + bi * dCyI + bj * dCyJ + bk * dCyK;
          const bxMin =
            bx0 + Math.min(0, diMax * dCxI) + Math.min(0, djMax * dCxJ) + Math.min(0, dkMax * dCxK);
          const bxMax =
            bx0 + Math.max(0, diMax * dCxI) + Math.max(0, djMax * dCxJ) + Math.max(0, dkMax * dCxK);
          const byMin =
            by0 + Math.min(0, diMax * dCyI) + Math.min(0, djMax * dCyJ) + Math.min(0, dkMax * dCyK);
          const byMax =
            by0 + Math.max(0, diMax * dCyI) + Math.max(0, djMax * dCyJ) + Math.max(0, dkMax * dCyK);

          const totalmenteForaAabb = bxMax < minPx || bxMin > maxPx || byMax < minPy || byMin > maxPy;
          if (totalmenteForaAabb) {
            if (modo === 'fora') {
              for (let k = bk; k < kFim; k++) {
                const offK = k * slice;
                for (let j = bj; j < jFim; j++) {
                  const offJ = offK + j * nx;
                  for (let i = bi; i < iFim; i++) {
                    const idx = offJ + i;
                    if (data[idx]! > valorVazio) alvos.push(idx);
                  }
                }
              }
            }
            continue;
          }

          for (let k = bk; k < kFim; k++) {
            const offK = k * slice;
            const ckx = cOrigX + k * dCxK;
            const cky = cOrigY + k * dCyK;
            for (let j = bj; j < jFim; j++) {
              const offJ = offK + j * nx;
              let px = ckx + j * dCxJ + bi * dCxI;
              let py = cky + j * dCyJ + bi * dCyI;
              for (let i = bi; i < iFim; i++, px += dCxI, py += dCyI) {
                const idx = offJ + i;
                if (data[idx]! <= valorVazio) continue;
                const noAabb = px >= minPx && px <= maxPx && py >= minPy && py <= maxPy;
                const dentro = noAabb && pontoNoPoligono2d(px, py, polyX, polyY);
                if ((modo === 'dentro' && dentro) || (modo === 'fora' && !dentro)) {
                  alvos.push(idx);
                }
              }
            }
          }
        }
      }
    }
  } else {
    // Projeção em perspectiva
    const [eyex, eyey, eyez] = persp.eye;
    const [nxCam, nyCam, nzCam] = persp.normal;
    const d0 = (eyex - fx) * nxCam + (eyey - fy) * nyCam + (eyez - fz) * nzCam;
    for (let k = 0; k < nz; k++) {
      const offK = k * slice;
      const wkX = ox + k * kx;
      const wkY = oy + k * ky;
      const wkZ = oz + k * kz;
      for (let j = 0; j < ny; j++) {
        const offJ = offK + j * nx;
        let wx = wkX + j * jx;
        let wy = wkY + j * jy;
        let wz = wkZ + j * jz;
        for (let i = 0; i < nx; i++, wx += ix, wy += iy, wz += iz) {
          const idx = offJ + i;
          if (data[idx]! <= valorVazio) continue;
          const d = (eyex - wx) * nxCam + (eyey - wy) * nyCam + (eyez - wz) * nzCam;
          if (d <= 1e-3) continue;
          const escala = d0 / d;
          const projX = eyex + (wx - eyex) * escala - fx;
          const projY = eyey + (wy - eyey) * escala - fy;
          const projZ = eyez + (wz - eyez) * escala - fz;
          const px = cx0 + projX * exX + projY * exY + projZ * exZ;
          const py = cy0 + projX * eyX + projY * eyY + projZ * eyZ;
          const noAabb = px >= minPx && px <= maxPx && py >= minPy && py <= maxPy;
          const dentro = noAabb && pontoNoPoligono2d(px, py, polyX, polyY);
          if ((modo === 'dentro' && dentro) || (modo === 'fora' && !dentro)) {
            alvos.push(idx);
          }
        }
      }
    }
  }

  const indices = Int32Array.from(alvos);
  const valoresOriginais = new Float32Array(alvos.length);
  for (let n = 0; n < alvos.length; n++) {
    const idx = alvos[n]!;
    valoresOriginais[n] = data[idx]!;
    data[idx] = valorVazio;
  }
  return { indices, valoresOriginais };
}
