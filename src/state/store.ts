/** Estado global mínimo: o que foi aberto e a pilha ativa. */

import type { StackNode } from '../io/organize';
import type { ResultadoAbertura } from '../ui/abrirPasta';

export const estado: {
  resultado: ResultadoAbertura | null;
  pilhaAtiva: StackNode | null;
} = {
  resultado: null,
  pilhaAtiva: null,
};
