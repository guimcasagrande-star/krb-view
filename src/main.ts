import { iniciarAtalhos } from './tools/atalhos';
import { iniciarEstiloMedidas } from './tools/estiloMedidas';
import { iniciarMoverMedidas } from './tools/moverMedidas';
import { iniciarSelecaoFacil } from './tools/selecao';
import { estado } from './state/store';
import { iniciarAbrirPasta } from './ui/abrirPasta';
import { iniciarBarraFerramentas } from './ui/barraFerramentas';
import { iniciarDadosPet } from './ui/dadosPet';
import { iniciarPainelSuv } from './ui/painelSuv';
import {
  EVENTO_ABRIR_PILHA,
  marcarPilhaAtiva,
  renderizarPainelEstudos,
  type AbrirPilhaEvento,
} from './ui/painelEstudos';
import {
  abrirPilha2d,
  configurarViewport2d,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  limparViewports,
} from './viewer/viewport2d';

function obter<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Elemento #${id} não encontrado no index.html.`);
  return e as T;
}

// Barra lateral recolhível (lembra a escolha neste computador).
const appEl = obter('app');
const botaoLateral = obter<HTMLButtonElement>('btn-lateral');
function definirLateral(visivel: boolean): void {
  appEl.classList.toggle('lateral-recolhida', !visivel);
  botaoLateral.setAttribute('aria-pressed', String(visivel));
  try {
    localStorage.setItem('visualizador.lateral', visivel ? '1' : '0');
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}
try {
  if (localStorage.getItem('visualizador.lateral') === '0') definirLateral(false);
} catch {
  /* ignora */
}
botaoLateral.addEventListener('click', () => definirLateral(appEl.classList.contains('lateral-recolhida')));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    definirLateral(appEl.classList.contains('lateral-recolhida'));
  }
});

const lista = obter('lista-estudos');
const vazio = obter('vazio');
configurarViewport2d({ contentor: obter('area-viewports') });
iniciarBarraFerramentas(obter('ferramentas'));
iniciarAtalhos();
iniciarEstiloMedidas();
iniciarSelecaoFacil(obter('area-viewports'));
iniciarMoverMedidas(obter('area-viewports'));
iniciarPainelSuv(obter('painel-suv'));
iniciarDadosPet();

iniciarAbrirPasta(
  {
    botao: obter<HTMLButtonElement>('btn-abrir-pasta'),
    botaoAlternativo: obter<HTMLButtonElement>('btn-abrir-alternativo'),
    botaoLimpar: obter<HTMLButtonElement>('btn-limpar-lista'),
    entradaPasta: obter<HTMLInputElement>('entrada-pasta'),
    zonaDrop: document.body,
    progresso: obter<HTMLProgressElement>('progresso'),
    resumo: obter('resumo'),
  },
  (resultado) => {
    estado.resultado = resultado;
    renderizarPainelEstudos(lista, resultado.index);
    marcarPilhaAtiva(lista, estado.pilhaAtiva?.id ?? null);
    vazio.hidden = true;
  },
  () => {
    estado.resultado = null;
    void limparViewports();
    lista.replaceChildren();
    vazio.hidden = false;
  },
);

document.addEventListener(EVENTO_ABRIR_PILHA, (ev) => {
  void abrirPilha2d((ev as AbrirPilhaEvento).detail);
});

// O destaque no painel segue a série do viewport ativo.
document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => {
  marcarPilhaAtiva(lista, (ev as CustomEvent<EstadoViewports>).detail.pilhaId);
});
