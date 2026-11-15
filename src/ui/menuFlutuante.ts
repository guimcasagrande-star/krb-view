/**
 * Menu suspenso que abre na posição do mouse (menu do botão direito e menu do cubo de orientação).
 * Um só aberto por vez; fecha com Esc, clique fora, roda do mouse ou ao escolher um item.
 */

export interface ItemMenuFlutuante {
  rotulo: string;
  /** Texto à direita (tecla de atalho). */
  atalho?: string;
  acao?: () => void;
  /** Submenu aberto ao passar o mouse. */
  filhos?: EntradaMenuFlutuante[];
  /** Marca o item como a opção em uso. */
  marcado?: boolean;
  desabilitado?: boolean;
}

export interface BotaoIconeMenuFlutuante {
  id: string;
  /** Ícone esquemático em SVG (sem texto). */
  svg: string;
  /** Dica mostrada ao passar o mouse (nome da função e atalho). */
  dica: string;
  marcado?: boolean;
  desabilitado?: boolean;
  acao: () => void;
}

export interface BarraIconesMenuFlutuante {
  tipo: 'barra-icones';
  botoes: BotaoIconeMenuFlutuante[];
}

export type EntradaMenuFlutuante = ItemMenuFlutuante | BarraIconesMenuFlutuante | 'divisor';

let aberto: HTMLDivElement | null = null;

export function fecharMenuFlutuante(): void {
  if (!aberto) return;
  aberto.remove();
  aberto = null;
  document.removeEventListener('mousedown', aoPressionarFora, true);
  document.removeEventListener('keydown', aoTecla, true);
  window.removeEventListener('blur', fecharMenuFlutuante);
  window.removeEventListener('resize', fecharMenuFlutuante);
  document.removeEventListener('wheel', fecharMenuFlutuante, true);
}

function aoPressionarFora(ev: MouseEvent): void {
  if (aberto && ev.target instanceof Node && aberto.contains(ev.target)) return;
  fecharMenuFlutuante();
}

function aoTecla(ev: KeyboardEvent): void {
  if (ev.key !== 'Escape') return;
  // Esc fecha só o menu; não cancela a ferramenta em uso.
  ev.stopPropagation();
  ev.preventDefault();
  fecharMenuFlutuante();
}

function montarPainel(entradas: EntradaMenuFlutuante[]): HTMLDivElement {
  const painel = document.createElement('div');
  painel.className = 'menu-flutuante-painel';
  painel.setAttribute('role', 'menu');
  for (const e of entradas) {
    if (e === 'divisor') {
      const hr = document.createElement('hr');
      hr.className = 'divisor-menu';
      painel.append(hr);
      continue;
    }
    if ('tipo' in e) {
      const barra = document.createElement('div');
      barra.className = 'menu-flutuante-favoritos';
      barra.setAttribute('role', 'toolbar');
      barra.setAttribute('aria-label', 'Favoritos rápidos');
      for (const item of e.botoes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-flutuante-fav';
        btn.dataset.favId = item.id;
        btn.title = item.dica;
        btn.setAttribute('aria-label', item.dica);
        btn.setAttribute('aria-pressed', item.marcado ? 'true' : 'false');
        btn.disabled = Boolean(item.desabilitado);
        btn.innerHTML = item.svg;
        btn.addEventListener('click', () => {
          fecharMenuFlutuante();
          item.acao();
        });
        barra.append(btn);
      }
      painel.append(barra);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-flutuante-item';
    b.setAttribute('role', 'menuitem');
    b.disabled = !!e.desabilitado;
    if (e.marcado) b.setAttribute('aria-checked', 'true');
    const texto = document.createElement('span');
    texto.textContent = e.rotulo;
    b.append(texto);
    if (e.filhos) {
      const seta = document.createElement('span');
      seta.className = 'menu-flutuante-seta';
      seta.textContent = '▸';
      b.append(seta);
      const linha = document.createElement('div');
      linha.className = 'menu-flutuante-grupo';
      const sub = montarPainel(e.filhos);
      linha.append(b, sub);
      // O submenu abre ao lado; se não couber na tela, sobe ou passa para a esquerda.
      linha.addEventListener('mouseenter', () => {
        sub.style.top = '-6px';
        sub.classList.remove('para-esquerda');
        const r = sub.getBoundingClientRect();
        if (r.right > window.innerWidth - 4) sub.classList.add('para-esquerda');
        if (r.bottom > window.innerHeight - 4) sub.style.top = `${-6 - (r.bottom - window.innerHeight + 4)}px`;
      });
      painel.append(linha);
      continue;
    }
    if (e.atalho) {
      const kbd = document.createElement('kbd');
      kbd.textContent = e.atalho;
      b.append(kbd);
    }
    b.addEventListener('click', () => {
      fecharMenuFlutuante();
      e.acao?.();
    });
    painel.append(b);
  }
  return painel;
}

/** Abre o menu com o canto em (x, y), em px da janela, ajustado para caber na tela. */
export function abrirMenuFlutuante(x: number, y: number, entradas: EntradaMenuFlutuante[]): void {
  fecharMenuFlutuante();
  if (entradas.length === 0) return;
  const raiz = document.createElement('div');
  raiz.className = 'menu-flutuante';
  raiz.append(montarPainel(entradas));
  raiz.addEventListener('contextmenu', (e) => e.preventDefault());
  // Dentro de uma caixa de diálogo aberta o menu precisa ficar na mesma camada.
  (document.querySelector('dialog[open]') ?? document.body).append(raiz);
  const r = raiz.getBoundingClientRect();
  raiz.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  raiz.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  aberto = raiz;
  document.addEventListener('mousedown', aoPressionarFora, true);
  document.addEventListener('keydown', aoTecla, true);
  window.addEventListener('blur', fecharMenuFlutuante);
  window.addEventListener('resize', fecharMenuFlutuante);
  document.addEventListener('wheel', fecharMenuFlutuante, true);
}
