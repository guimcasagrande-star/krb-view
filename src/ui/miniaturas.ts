/**
 * Miniaturas das séries no painel, geradas sob demanda: só quando a linha entra na área
 * visível do painel, no máximo duas ao mesmo tempo. Usa o corte do meio da pilha.
 * A imagem da miniatura sai do cache logo depois de desenhada, para não pesar na memória.
 */

import { cache, imageLoader, type Types } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { StackNode } from '../io/organize';
import { estado } from '../state/store';
import { iniciarCornerstone } from '../viewer/iniciar';

/** Lado da miniatura em pixels do canvas (o CSS mostra em cartão maior, nítido mesmo ao ampliar a barra). */
const LADO = 240;
const GERACOES_SIMULTANEAS = 2;

export interface ObservadorMiniaturas {
  /** Reserva o espaço e gera a miniatura quando `alvo` ficar visível. */
  observar(alvo: HTMLElement, pilha: StackNode): void;
  desconectar(): void;
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'erro desconhecido';
}

/** Primeiro valor de um campo que pode vir como número ou lista. */
function primeiro(v: number | number[] | undefined): number | undefined {
  const n = Array.isArray(v) ? v[0] : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Desenha a imagem em tons de cinza no canvas, com a janela do cabeçalho ou, na falta
 * dela, do mínimo ao máximo. Só para a miniatura: não serve para medir nada.
 */
function imagemParaCanvas(imagem: Types.IImage): HTMLCanvasElement {
  if (imagem.color) return imagem.getCanvas();
  const { rows, columns } = imagem;
  const dados = imagem.getPixelData();
  const inclinacao = imagem.slope ?? 1;
  const intercepto = imagem.intercept ?? 0;
  let largura = primeiro(imagem.windowWidth);
  let centro = primeiro(imagem.windowCenter);
  if (largura === undefined || centro === undefined || largura <= 0) {
    const minimo = imagem.minPixelValue * inclinacao + intercepto;
    const maximo = imagem.maxPixelValue * inclinacao + intercepto;
    centro = (minimo + maximo) / 2;
    largura = Math.max(maximo - minimo, 1e-6);
  }
  const baixo = centro - largura / 2;
  const tela = document.createElement('canvas');
  tela.width = columns;
  tela.height = rows;
  const ctx = tela.getContext('2d');
  if (!ctx) throw new Error('canvas 2D indisponível');
  const pixels = ctx.createImageData(columns, rows);
  for (let i = 0; i < rows * columns; i++) {
    const fracao = ((dados[i]! * inclinacao + intercepto - baixo) / largura);
    let v = Math.round(Math.min(Math.max(fracao, 0), 1) * 255);
    if (imagem.invert) v = 255 - v;
    pixels.data[i * 4] = v;
    pixels.data[i * 4 + 1] = v;
    pixels.data[i * 4 + 2] = v;
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return tela;
}

async function desenhar(alvo: HTMLElement, pilha: StackNode): Promise<void> {
  const instancia = pilha.instances[Math.floor(pilha.instances.length / 2)];
  const arquivo = instancia ? estado.resultado?.arquivos.get(instancia.fileId) : undefined;
  if (!arquivo) throw new Error('arquivo da série não encontrado');

  await iniciarCornerstone();
  const imageId = wadouri.fileManager.add(arquivo);
  try {
    const imagem = await imageLoader.loadAndCacheImage(imageId);
    const origem = imagemParaCanvas(imagem);
    const mini = document.createElement('canvas');
    mini.width = LADO;
    mini.height = LADO;
    const ctx = mini.getContext('2d');
    if (!ctx) throw new Error('canvas 2D indisponível');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LADO, LADO);
    // Cabe inteira na miniatura, sem esticar.
    const escala = Math.min(LADO / origem.width, LADO / origem.height);
    const largura = origem.width * escala;
    const altura = origem.height * escala;
    ctx.drawImage(origem, (LADO - largura) / 2, (LADO - altura) / 2, largura, altura);
    alvo.replaceChildren(mini);
  } finally {
    try {
      cache.removeImageLoadObject(imageId);
    } catch {
      /* não chegou a entrar no cache */
    }
    const indice = Number(imageId.slice(imageId.indexOf(':') + 1));
    if (Number.isInteger(indice)) wadouri.fileManager.remove(indice);
  }
}

export function criarObservadorMiniaturas(raiz: HTMLElement): ObservadorMiniaturas {
  const pilhas = new WeakMap<Element, StackNode>();
  const visiveis = new Set<Element>();
  const prontas = new WeakSet<Element>();
  const naFila = new Set<Element>();
  const fila: Element[] = [];
  let rodando = 0;
  let fechado = false;

  function proxima(): void {
    while (!fechado && rodando < GERACOES_SIMULTANEAS) {
      const alvo = fila.shift();
      if (!alvo) return;
      naFila.delete(alvo);
      // Saiu da tela antes da vez: volta a ser gerada se aparecer de novo.
      if (!visiveis.has(alvo) || prontas.has(alvo)) continue;
      const pilha = pilhas.get(alvo);
      if (!pilha) continue;
      rodando++;
      prontas.add(alvo);
      desenhar(alvo as HTMLElement, pilha)
        .catch((e: unknown) => {
          const motivo = mensagemDeErro(e);
          const aviso = document.createElement('span');
          aviso.className = 'mini-erro';
          aviso.textContent = '!';
          aviso.title = `Sem miniatura: ${motivo}`;
          (alvo as HTMLElement).replaceChildren(aviso);
        })
        .finally(() => {
          rodando--;
          proxima();
        });
    }
  }

  const io = new IntersectionObserver(
    (entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) {
          visiveis.add(e.target);
          if (!prontas.has(e.target) && !naFila.has(e.target)) {
            naFila.add(e.target);
            fila.push(e.target);
          }
        } else {
          visiveis.delete(e.target);
        }
      }
      proxima();
    },
    { root: raiz, rootMargin: '80px' },
  );

  return {
    observar(alvo, pilha) {
      pilhas.set(alvo, pilha);
      io.observe(alvo);
    },
    desconectar() {
      fechado = true;
      io.disconnect();
      fila.length = 0;
    },
  };
}
