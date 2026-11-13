/**
 * Painel "SUV" da série de PET ativa (tarefa 5.2): mostra os parâmetros usados por `computeSuv`
 * para conferência, os avisos (amarelo) e, se o SUV não pôde ser calculado, os erros (vermelho).
 */

import { formatInstantPtBr } from '../io/dicomTime';
import {
  correcoesDaPilha,
  definirEscalaDaPilha,
  type EscalaSuv,
  escalaDaPilha,
  resultadoSuv,
} from '../pet/provedorSuv';
import {
  definirTetoSuv,
  escolherFerramentaPrimaria,
  EVENTO_BOTOES_MUDARAM,
  ferramentaPrimariaAtual,
  viewportAtivo,
} from '../tools/grupo';
import {
  definirModoLesaoAtual,
  EVENTO_LESAO_ATUALIZADA,
  modoLesaoAtual,
  NOME_LESAO_PET,
  ultimaLesaoNoViewport,
} from '../tools/voiEsfera';
import type { ModoLesao } from '../volume/voi';
import type { ScanTimeSource, SuvResult } from '../pet/suv';
import { estado } from '../state/store';
import {
  aplicarCorrecoesPet,
  EVENTO_ESTADO_VIEWPORTS,
  EVENTO_JANELA_MUDOU,
  EVENTO_SUV_ATUALIZADO,
} from '../viewer/viewport2d';

const ORIGEM_HORARIO: Record<ScanTimeSource, string> = {
  serie: 'Série (SeriesDate/Time)',
  'ge-privado': 'Tag privada da GE',
  quadro: 'Recalculado (quadro)',
  aquisicao: 'Menor hora de aquisição',
};

function num(v: number, casas: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function linhas(r: SuvResult): Array<[string, string]> {
  const p = r.params;
  const out: Array<[string, string]> = [];
  const add = (rotulo: string, valor: string | undefined): void => {
    if (valor !== undefined) out.push([rotulo, valor]);
  };
  add('Radiofármaco', p.radiopharmaceutical || undefined);
  add('Peso', p.weightKg !== undefined ? `${num(p.weightKg, 1)} kg` : undefined);
  add('Altura', p.heightM !== undefined ? `${num(p.heightM * 100, 0)} cm` : undefined);
  add('Dose injetada', p.injectedDoseBq !== undefined ? `${num(p.injectedDoseBq / 1e6, 1)} MBq` : undefined);
  add('Meia-vida', p.halfLifeS !== undefined ? `${num(p.halfLifeS / 60, 1)} min` : undefined);
  add('Injeção', p.injectionMs !== undefined ? formatInstantPtBr(p.injectionMs) : undefined);
  add('Início da aquisição', p.scanStartMs !== undefined ? formatInstantPtBr(p.scanStartMs) : undefined);
  add('Horário vindo de', p.scanTimeSource ? ORIGEM_HORARIO[p.scanTimeSource] : undefined);
  add('Tempo de captação', p.uptakeSeconds !== undefined ? `${num(p.uptakeSeconds / 60, 1)} min` : undefined);
  add('Dose decaída', p.decayedDoseBq !== undefined ? `${num(p.decayedDoseBq / 1e6, 1)} MBq` : undefined);
  if (r.ok) {
    const f = r.factors[0];
    if (f) {
      add('Fator SUVbw', f.bw.toFixed(9).replace('.', ','));
      add('Fator SUL', f.lbm !== undefined ? f.lbm.toFixed(9).replace('.', ',') : undefined);
      add('Fator SUVbsa', f.bsa !== undefined ? f.bsa.toFixed(9).replace('.', ',') : undefined);
    }
    if (!r.uniform) out.push(['Fator', 'varia entre as imagens (valor do 1º corte)']);
  }
  return out;
}

export function iniciarPainelSuv(painel: HTMLElement): void {
  let idMostrado: string | null | undefined;
  let campoTeto: HTMLInputElement | null = null;
  let caixaLesao: HTMLElement | null = null;

  function atualizarResumoLesao(): void {
    const caixa = caixaLesao;
    if (!caixa || !caixa.isConnected) return;
    caixa.replaceChildren();

    const tituloLesao = document.createElement('div');
    tituloLesao.className = 'suv-lesao-titulo';
    tituloLesao.textContent = 'Lesão (VOI esférica)';
    caixa.append(tituloLesao);

    const linha = document.createElement('div');
    linha.className = 'suv-lesao-botoes';

    const medindo = ferramentaPrimariaAtual() === NOME_LESAO_PET;
    const btnMedir = document.createElement('button');
    btnMedir.type = 'button';
    btnMedir.textContent = 'Medir lesão';
    btnMedir.title = 'Clique no centro e arraste o raio da lesão PET (tecla J)';
    if (medindo) btnMedir.className = 'ativo';
    btnMedir.setAttribute('aria-pressed', String(medindo));
    btnMedir.addEventListener('click', () => escolherFerramentaPrimaria(NOME_LESAO_PET));
    linha.append(btnMedir);

    const modoAtivo = modoLesaoAtual();
    const modos: Array<[ModoLesao, string]> = [
      ['41%', '41% do máx.'],
      ['suv25', 'SUV ≥ 2,5'],
      ['esfera', 'Esfera'],
    ];
    for (const [m, rotulo] of modos) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = rotulo;
      if (modoAtivo === m) b.className = 'ativo';
      b.setAttribute('aria-pressed', String(modoAtivo === m));
      b.addEventListener('click', () => definirModoLesaoAtual(m, estado.idViewportAtivo));
      linha.append(b);
    }
    caixa.append(linha);

    const voi = ultimaLesaoNoViewport(estado.idViewportAtivo);
    if (!voi) {
      if (medindo) {
        const dica = document.createElement('div');
        dica.className = 'suv-lesao-resumo';
        dica.textContent = 'Clique no centro da lesão na imagem e arraste o raio.';
        caixa.append(dica);
      }
      return;
    }
    const resumo = document.createElement('div');
    resumo.className = 'suv-lesao-resumo';
    if (voi.estado === 'calculando') {
      resumo.textContent = 'Calculando lesão…';
    } else if (voi.estado === 'erro') {
      resumo.className = 'suv-erro suv-detalhe';
      resumo.textContent = voi.mensagem ?? 'Erro ao medir lesão.';
    } else if (voi.estado === 'pronto' && voi.resultado) {
      const res = voi.resultado;
      const partes = [
        `SUVmáx ${num(res.max, 2)}`,
        `SUVmédio ${num(res.media, 2)}`,
        ...(res.pico !== undefined ? [`SUVpico ${num(res.pico, 2)}`] : []),
      ];
      if (res.mtvMl !== undefined && res.tlg !== undefined) {
        partes.push(`MTV ${num(res.mtvMl, 1)} mL`, `TLG ${num(res.tlg, 1)}`);
      } else {
        partes.push(`Vol ${num(res.volumeMl, 1)} mL`);
      }
      resumo.textContent = partes.join(' · ');
    }
    const sanfona = document.createElement('details');
    sanfona.className = 'suv-sanfona';
    const sumario = document.createElement('summary');
    sumario.textContent = 'Resumo da lesão';
    sanfona.append(sumario, resumo);
    caixa.append(sanfona);
  }

  /** Mostra no campo o teto da janela atual do viewport ativo (teclas 1–3, botões, arrastar). */
  async function atualizarCampoTeto(): Promise<void> {
    const campo = campoTeto;
    if (!campo || !campo.isConnected || document.activeElement === campo) return;
    const v = await viewportAtivo();
    const teto = v?.getProperties()?.voiRange?.upper;
    if (teto === undefined || !Number.isFinite(teto) || campo !== campoTeto) return;
    campo.value = String(Math.round(teto * 10) / 10);
  }

  function desenhar(): void {
    const pilha = estado.pilhaAtiva;
    const id = pilha?.instances.some((i) => i.modality === 'PT') ? pilha.id : null;
    if (id === idMostrado) {
      void atualizarCampoTeto();
      atualizarResumoLesao();
      return;
    }
    idMostrado = id;
    campoTeto = null;
    caixaLesao = null;
    painel.replaceChildren();
    const r = id ? resultadoSuv(id) : undefined;
    if (!id || !r) {
      painel.hidden = true;
      return;
    }
    painel.hidden = false;

    const titulo = document.createElement('h3');
    titulo.textContent = 'SUV';
    painel.append(titulo);
    if (correcoesDaPilha(id)) {
      const editado = document.createElement('div');
      editado.className = 'suv-aviso';
      editado.textContent = '✎ Dados corrigidos pelo usuário (o arquivo não foi alterado)';
      painel.append(editado);
    }

    if (!r.ok) {
      const aviso = document.createElement('div');
      aviso.className = 'suv-erro';
      aviso.textContent = 'SUV não calculado: valores em Bq/mL';
      painel.append(aviso);
      for (const e of r.errors) {
        const d = document.createElement('div');
        d.className = 'suv-erro suv-detalhe';
        d.textContent = e.message;
        painel.append(d);
      }
    }

    const tabela = document.createElement('table');
    tabela.className = 'suv-tabela';
    for (const [rotulo, valor] of linhas(r)) {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = rotulo;
      const b = document.createElement('td');
      b.textContent = valor;
      tr.append(a, b);
      tabela.append(tr);
    }
    const sanfona = document.createElement('details');
    sanfona.className = 'suv-sanfona';
    const sumario = document.createElement('summary');
    sumario.textContent = 'Parâmetros do SUV';
    sanfona.append(sumario, tabela);
    painel.append(sanfona);

    if (r.ok && pilha) {
      // Escala de exibição (SUVbw, SUL ou SUVbsa): troca recarrega a série na nova escala.
      const f0 = r.factors[0];
      const opcoes: Array<[EscalaSuv, string]> = [['bw', 'SUVbw (peso)']];
      if (f0?.lbm !== undefined) opcoes.push(['lbm', 'SUL (massa magra)']);
      if (f0?.bsa !== undefined) opcoes.push(['bsa', 'SUVbsa (superfície)']);
      const controles = document.createElement('div');
      controles.className = 'suv-controles';
      if (opcoes.length > 1) {
        const rotulo = document.createElement('label');
        rotulo.textContent = 'Escala ';
        const sel = document.createElement('select');
        for (const [v, t] of opcoes) {
          const o = document.createElement('option');
          o.value = v;
          o.textContent = t;
          sel.append(o);
        }
        sel.value = escalaDaPilha(id);
        sel.addEventListener('change', () => {
          definirEscalaDaPilha(id, sel.value as EscalaSuv);
          sel.disabled = true;
          void aplicarCorrecoesPet(pilha, correcoesDaPilha(id) ?? null);
        });
        rotulo.append(sel);
        controles.append(rotulo);
      }
      // Teto da janela (a janela vai de 0 até o teto).
      const rotuloTeto = document.createElement('label');
      rotuloTeto.textContent = 'Teto da janela ';
      const teto = document.createElement('input');
      teto.type = 'number';
      teto.min = '0.5';
      teto.step = '0.5';
      teto.value = '5';
      campoTeto = teto;
      teto.setAttribute('aria-label', 'Teto da janela em SUV');
      teto.addEventListener('change', () => void definirTetoSuv(Number(teto.value.replace(',', '.'))));
      rotuloTeto.append(teto);
      controles.append(rotuloTeto);
      const atalhos = document.createElement('div');
      for (const v of [5, 7, 10]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `0–${v}`;
        b.addEventListener('click', () => {
          teto.value = String(v);
          void definirTetoSuv(v);
        });
        atalhos.append(b);
      }
      controles.append(atalhos);
      const secLesao = document.createElement('div');
      secLesao.className = 'suv-lesao';
      caixaLesao = secLesao;
      controles.append(secLesao);
      painel.append(controles);
      void atualizarCampoTeto();
      atualizarResumoLesao();
    }

    for (const w of r.warnings) {
      const d = document.createElement('div');
      d.className = 'suv-aviso';
      d.textContent = `⚠ ${w.message}`;
      painel.append(d);
    }
  }

  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, desenhar);
  document.addEventListener(EVENTO_LESAO_ATUALIZADA, atualizarResumoLesao);
  document.addEventListener(EVENTO_BOTOES_MUDARAM, atualizarResumoLesao);
  document.addEventListener(EVENTO_JANELA_MUDOU, (e) => {
    const idVp = (e as CustomEvent<{ idViewport: string }>).detail?.idViewport;
    if (idVp === estado.idViewportAtivo) void atualizarCampoTeto();
  });
  document.addEventListener(EVENTO_SUV_ATUALIZADO, () => {
    idMostrado = undefined;
    desenhar();
  });
  desenhar();
}
