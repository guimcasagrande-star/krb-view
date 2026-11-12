import { estado } from './state/store';
import { iniciarAbrirPasta } from './ui/abrirPasta';
import { EVENTO_ABRIR_PILHA, renderizarPainelEstudos, type AbrirPilhaEvento } from './ui/painelEstudos';
import { abrirPilha2d, configurarViewport2d } from './viewer/viewport2d';

function obter<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Elemento #${id} não encontrado no index.html.`);
  return e as T;
}

const lista = obter('lista-estudos');
const vazio = obter('vazio');
configurarViewport2d({ contentor: obter('area-viewports'), mensagem: vazio });

iniciarAbrirPasta(
  {
    botao: obter<HTMLButtonElement>('btn-abrir-pasta'),
    botaoAlternativo: obter<HTMLButtonElement>('btn-abrir-alternativo'),
    entradaPasta: obter<HTMLInputElement>('entrada-pasta'),
    zonaDrop: document.body,
    progresso: obter<HTMLProgressElement>('progresso'),
    resumo: obter('resumo'),
  },
  (resultado) => {
    estado.resultado = resultado;
    estado.pilhaAtiva = null;
    renderizarPainelEstudos(lista, resultado.index);
    vazio.hidden = false;
    vazio.textContent = 'Escolha uma série no painel.';
  },
);

document.addEventListener(EVENTO_ABRIR_PILHA, (ev) => {
  const pilha = (ev as AbrirPilhaEvento).detail;
  estado.pilhaAtiva = pilha;
  void abrirPilha2d(pilha);
});
