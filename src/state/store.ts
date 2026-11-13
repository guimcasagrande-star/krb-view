/** Estado global mínimo: o que foi aberto e o que o viewport ativo mostra. */

import type { StackNode } from '../io/organize';
import type { ResultadoAbertura } from '../ui/abrirPasta';

export const estado: {
  resultado: ResultadoAbertura | null;
  /** Pilha mostrada no viewport ativo (null se ele está vazio). */
  pilhaAtiva: StackNode | null;
  /** Id do viewport ativo no Cornerstone, ou null antes de existir algum. */
  idViewportAtivo: string | null;
} = {
  resultado: null,
  pilhaAtiva: null,
  idViewportAtivo: null,
};
