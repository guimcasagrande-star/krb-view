/**
 * Exporta a imagem do viewport ativo em PNG ou JPEG, com ou sem as medidas desenhadas.
 * O arquivo vai para a pasta de downloads do navegador; nada é gravado no exame.
 */

import { estado } from '../state/store';

function viewportAtivo(): HTMLElement | null {
  const id = estado.idViewportAtivo;
  return id ? document.querySelector<HTMLElement>(`[data-viewport-uid="${id}"]`) : null;
}

function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível desenhar as medidas na imagem.'));
    img.src = url;
  });
}

function nomeDoArquivo(extensao: string): string {
  const agora = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const carimbo = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  return `imagem-${carimbo}.${extensao}`;
}

/** Devolve uma mensagem de erro em português, ou `null` se deu certo. */
export async function exportarImagemAtiva(formato: 'png' | 'jpeg', comMedidas = true): Promise<string | null> {
  const el = viewportAtivo();
  const canvasOrigem = el?.querySelector('canvas');
  if (!el || !canvasOrigem) return 'Abra uma imagem num viewport antes de exportar.';

  const saida = document.createElement('canvas');
  saida.width = canvasOrigem.width;
  saida.height = canvasOrigem.height;
  const ctx = saida.getContext('2d');
  if (!ctx) return 'Não foi possível criar a imagem.';
  if (formato === 'jpeg') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, saida.width, saida.height);
  }
  ctx.drawImage(canvasOrigem, 0, 0);

  if (comMedidas) {
    const svg = el.querySelector('svg.svg-layer');
    if (svg) {
      try {
        const copia = svg.cloneNode(true) as SVGElement;
        copia.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        copia.setAttribute('width', String(el.clientWidth));
        copia.setAttribute('height', String(el.clientHeight));
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copia)], { type: 'image/svg+xml' }));
        try {
          ctx.drawImage(await carregarImagem(url), 0, 0, saida.width, saida.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        return e instanceof Error ? e.message : 'Falha ao incluir as medidas.';
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    saida.toBlob(resolve, formato === 'png' ? 'image/png' : 'image/jpeg', 0.92),
  );
  if (!blob) return 'Não foi possível gerar o arquivo.';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomeDoArquivo(formato === 'png' ? 'png' : 'jpg');
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return null;
}
