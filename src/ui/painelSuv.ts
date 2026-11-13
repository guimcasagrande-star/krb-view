/**
 * Painel "SUV" da série de PET ativa (tarefa 5.2): mostra os parâmetros usados por `computeSuv`
 * para conferência, os avisos (amarelo) e, se o SUV não pôde ser calculado, os erros (vermelho).
 */

import { formatInstantPtBr } from '../io/dicomTime';
import { correcoesDaPilha, resultadoSuv } from '../pet/provedorSuv';
import type { ScanTimeSource, SuvResult } from '../pet/suv';
import { estado } from '../state/store';
import { EVENTO_ESTADO_VIEWPORTS, EVENTO_SUV_ATUALIZADO } from '../viewer/viewport2d';

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

  function desenhar(): void {
    const pilha = estado.pilhaAtiva;
    const id = pilha?.instances.some((i) => i.modality === 'PT') ? pilha.id : null;
    if (id === idMostrado) return;
    idMostrado = id;
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
    painel.append(tabela);

    for (const w of r.warnings) {
      const d = document.createElement('div');
      d.className = 'suv-aviso';
      d.textContent = `⚠ ${w.message}`;
      painel.append(d);
    }
  }

  document.addEventListener(EVENTO_ESTADO_VIEWPORTS, desenhar);
  document.addEventListener(EVENTO_SUV_ATUALIZADO, () => {
    idMostrado = undefined;
    desenhar();
  });
  desenhar();
}
