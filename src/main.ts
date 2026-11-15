import { iniciarAtalhos } from './tools/atalhos';
import { iniciarEstiloMedidas } from './tools/estiloMedidas';
import { iniciarMoverMedidas } from './tools/moverMedidas';
import { iniciarSelecaoFacil } from './tools/selecao';
import { estado } from './state/store';
import { telas } from './state/preferencias';
import { iniciarAbrirPasta } from './ui/abrirPasta';
import { iniciarBarraFerramentas } from './ui/barraFerramentas';
import { iniciarDadosPet } from './ui/dadosPet';
import { iniciarMenuContexto } from './ui/menuContexto';
import { iniciarPacs } from './ui/servidoresPacs';
import { iniciarPainelSuv } from './ui/painelSuv';
import { iniciarPainelSegmentos } from './ui/painelSegmentos';
import {
  EVENTO_ABRIR_PILHA,
  marcarPilhaAtiva,
  renderizarPainelEstudos,
  type AbrirPilhaEvento,
} from './ui/painelEstudos';
import {
  abrirPilha2d,
  abrirPilhaEmSlotDisponivel,
  configurarViewport2d,
  EVENTO_ESTADO_VIEWPORTS,
  type EstadoViewports,
  limparViewports,
} from './viewer/viewport2d';
import {
  abrirOuPedirPilhaNaSegundaJanela,
  alternarTelaCheiaJanelaAtual,
  ehJanelaSecundaria,
  iniciarCanalJanelaPrincipal,
  iniciarModoSecundario,
  sincronizarCatalogoComSegundaJanela,
} from './viewer/segundaJanela';

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
  } else if (e.key === 'F11') {
    e.preventDefault();
    void alternarTelaCheiaJanelaAtual();
  }
});

const lista = obter('lista-estudos');
const vazio = obter('vazio');
const gradeInicial = ehJanelaSecundaria() ? telas().gradeSecundaria : telas().gradePrincipal;
iniciarBarraFerramentas(obter('ferramentas'));
configurarViewport2d({ contentor: obter('area-viewports'), layoutInicial: gradeInicial });
iniciarAtalhos();
iniciarEstiloMedidas();
iniciarSelecaoFacil(obter('area-viewports'));
iniciarMoverMedidas(obter('area-viewports'));
iniciarMenuContexto(obter('area-viewports'));
iniciarPainelSuv(obter('painel-suv'));
iniciarPainelSegmentos(obter('painel-segmentos'));
iniciarDadosPet();

if (ehJanelaSecundaria()) {
  obter('abrir').hidden = true;
  vazio.innerHTML =
    'Segunda janela pronta.<br /><span>Clique numa série ao lado ou envie pela primeira janela.</span>';
  iniciarModoSecundario({
    aoAtualizarIndice: (resultado) => {
      if (resultado.metas.length === 0) {
        lista.replaceChildren();
        vazio.hidden = false;
        return;
      }
      estado.resultado = resultado;
      definirLateral(true);
      renderizarPainelEstudos(lista, resultado.index);
      marcarPilhaAtiva(lista, estado.pilhaAtiva?.id ?? null);
      vazio.hidden = true;
    },
    aoAbrirPilha: async (pilha, noSlotAtivo) => {
      vazio.hidden = true;
      if (noSlotAtivo) {
        await abrirPilha2d(pilha);
      } else {
        await abrirPilhaEmSlotDisponivel(pilha);
      }
    },
    aoProgredir: (feitos, total) => {
      if (estado.pilhaAtiva) return;
      vazio.hidden = false;
      vazio.textContent = `Recebendo série: ${feitos} de ${total} imagens…`;
    },
    aoErro: (mensagem) => {
      window.alert(mensagem);
    },
  });
} else {
  iniciarPacs();
  iniciarCanalJanelaPrincipal();

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
      definirLateral(true);
      renderizarPainelEstudos(lista, resultado.index);
      marcarPilhaAtiva(lista, estado.pilhaAtiva?.id ?? null);
      vazio.hidden = true;
      sincronizarCatalogoComSegundaJanela();
    },
    () => {
      estado.resultado = null;
      void limparViewports();
      lista.replaceChildren();
      vazio.hidden = false;
      sincronizarCatalogoComSegundaJanela();
    },
    () => {
      definirLateral(true);
    },
  );
}

document.addEventListener(EVENTO_ABRIR_PILHA, (ev) => {
  const pilha = (ev as AbrirPilhaEvento).detail;
  if (ehJanelaSecundaria()) {
    void abrirOuPedirPilhaNaSegundaJanela(pilha);
    return;
  }
  void abrirPilha2d(pilha);
});

// O destaque no painel segue a série do viewport ativo.
document.addEventListener(EVENTO_ESTADO_VIEWPORTS, (ev) => {
  marcarPilhaAtiva(lista, (ev as CustomEvent<EstadoViewports>).detail.pilhaId);
});
