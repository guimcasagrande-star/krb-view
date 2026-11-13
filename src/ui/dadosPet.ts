/**
 * Janela "Dados PET": mostra e permite corrigir peso, altura, dose injetada e os horários da
 * injeção e da aquisição usados no cálculo do SUV. As correções valem só nesta sessão (o arquivo
 * DICOM nunca é alterado) e a série é recarregada com os novos fatores.
 */

import type { StackNode } from '../io/organize';
import {
  type CorrecoesPet,
  correcoesDaPilha,
  resultadoSuv,
} from '../pet/provedorSuv';
import { aplicarCorrecoesPet, EVENTO_DADOS_PET } from '../viewer/viewport2d';

const MCI_EM_BQ = 37_000_000;
const MBQ_EM_BQ = 1_000_000;

let caixa: HTMLDialogElement | undefined;

function campo(rotulo: string, controle: HTMLElement, dica?: string): HTMLElement {
  const l = document.createElement('label');
  l.className = 'cfg-linha';
  const s = document.createElement('span');
  s.textContent = rotulo;
  l.append(s, controle);
  if (dica) l.title = dica;
  return l;
}

function entrada(tipo: string, valor: string, extra: Partial<HTMLInputElement> = {}): HTMLInputElement {
  const i = document.createElement('input');
  i.type = tipo;
  i.value = valor;
  Object.assign(i, extra);
  return i;
}

/** ms da linha do tempo ingênua -> valor de <input type="datetime-local">. */
function msParaCampo(ms: number | undefined): string {
  return ms === undefined ? '' : new Date(ms).toISOString().slice(0, 19);
}

/** Valor de datetime-local -> DT do DICOM (AAAAMMDDHHMMSS), ou undefined se vazio/inválido. */
function campoParaDT(v: string): string | undefined {
  const digitos = v.replace(/\D/g, '');
  if (digitos.length < 12) return undefined;
  return digitos.padEnd(14, '0').slice(0, 14);
}

function formatarNumero(n: number, casas: number): string {
  return String(Number(n.toFixed(casas)));
}

function abrir(stack: StackNode): void {
  const d = caixa ?? criarCaixa();
  const corpo = d.querySelector<HTMLElement>('.dados-pet-corpo')!;
  corpo.replaceChildren();

  const primeira = stack.instances[0];
  const r = resultadoSuv(stack.id);
  const p = r?.params;
  const peso = p?.weightKg ?? primeira?.patientWeightKg;
  const altura = p?.heightM ?? primeira?.patientSizeM;
  const doseBq = p?.injectedDoseBq ?? primeira?.pet?.radionuclideTotalDoseBq;

  const campoPeso = entrada('number', peso !== undefined ? formatarNumero(peso, 1) : '', { min: '1', max: '500', step: '0.1' });
  const campoAltura = entrada('number', altura !== undefined ? formatarNumero(altura * 100, 0) : '', { min: '30', max: '260', step: '1' });
  const campoDose = entrada('number', doseBq !== undefined ? formatarNumero(doseBq / MCI_EM_BQ, 2) : '', { min: '0', step: '0.01' });
  const unidade = document.createElement('select');
  for (const [v, t] of [['mCi', 'mCi (milicurie)'], ['MBq', 'MBq (megabecquerel)']]) {
    const o = document.createElement('option');
    o.value = v!;
    o.textContent = t!;
    unidade.append(o);
  }
  unidade.addEventListener('change', () => {
    // Converte o número mostrado quando a unidade muda.
    const atual = Number(campoDose.value.replace(',', '.'));
    if (!Number.isFinite(atual) || atual <= 0) return;
    const bq = unidade.value === 'MBq' ? atual * MCI_EM_BQ : atual * MBQ_EM_BQ;
    campoDose.value = unidade.value === 'MBq' ? formatarNumero(bq / MBQ_EM_BQ, 1) : formatarNumero(bq / MCI_EM_BQ, 2);
  });
  const linhaDose = document.createElement('div');
  linhaDose.className = 'dados-pet-dose';
  linhaDose.append(campoDose, unidade);

  const campoInjecao = entrada('datetime-local', msParaCampo(p?.injectionMs), { step: '1' });
  const campoAquisicao = entrada('datetime-local', msParaCampo(p?.scanStartMs), { step: '1' });

  const erro = document.createElement('div');
  erro.className = 'cfg-aviso';
  erro.hidden = true;

  const dica = document.createElement('p');
  dica.className = 'cfg-dica';
  dica.textContent =
    'Valores lidos do exame. Corrija só se precisar: o arquivo não é alterado, e a correção vale nesta sessão.';

  const aviso = document.createElement('p');
  aviso.className = 'cfg-aviso';
  aviso.hidden = r?.ok !== false;
  aviso.textContent = r && !r.ok ? `SUV não calculado: ${r.errors.map((e) => e.message).join(' ')}` : '';

  corpo.append(
    dica,
    aviso,
    campo('Peso (kg)', campoPeso),
    campo('Altura (cm)', campoAltura),
    campo('Dose injetada', linhaDose, '1 mCi = 37 MBq'),
    campo('Horário da injeção', campoInjecao),
    campo('Horário da aquisição (início)', campoAquisicao),
    erro,
  );

  const botoes = d.querySelector<HTMLElement>('.dados-pet-botoes')!;
  botoes.replaceChildren();
  const aplicar = document.createElement('button');
  aplicar.type = 'button';
  aplicar.className = 'primario';
  aplicar.textContent = 'Aplicar';
  const restaurar = document.createElement('button');
  restaurar.type = 'button';
  restaurar.textContent = 'Voltar aos valores do arquivo';
  restaurar.disabled = !correcoesDaPilha(stack.id);
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.textContent = 'Cancelar';
  botoes.append(aplicar, restaurar, cancelar);

  const ocupado = async (acao: () => Promise<void>): Promise<void> => {
    aplicar.disabled = restaurar.disabled = cancelar.disabled = true;
    aplicar.textContent = 'Recalculando…';
    try {
      await acao();
      d.close();
    } finally {
      aplicar.disabled = cancelar.disabled = false;
      aplicar.textContent = 'Aplicar';
    }
  };

  cancelar.addEventListener('click', () => d.close());
  restaurar.addEventListener('click', () => void ocupado(() => aplicarCorrecoesPet(stack, null)));
  aplicar.addEventListener('click', () => {
    const num = (e: HTMLInputElement): number => Number(e.value.replace(',', '.'));
    const c: CorrecoesPet = {};
    const pesoN = num(campoPeso);
    const alturaN = num(campoAltura);
    const doseN = num(campoDose);
    const problemas: string[] = [];
    if (campoPeso.value !== '') {
      if (pesoN >= 1 && pesoN <= 500) c.pesoKg = pesoN;
      else problemas.push('Peso deve estar entre 1 e 500 kg.');
    }
    if (campoAltura.value !== '') {
      if (alturaN >= 30 && alturaN <= 260) c.alturaM = alturaN / 100;
      else problemas.push('Altura deve estar entre 30 e 260 cm.');
    }
    if (campoDose.value !== '') {
      if (doseN > 0) c.doseBq = doseN * (unidade.value === 'MBq' ? MBQ_EM_BQ : MCI_EM_BQ);
      else problemas.push('A dose deve ser maior que zero.');
    }
    if (campoInjecao.value !== '') {
      const dt = campoParaDT(campoInjecao.value);
      if (dt) c.injecaoDT = dt;
      else problemas.push('Horário da injeção inválido.');
    }
    if (campoAquisicao.value !== '') {
      const dt = campoParaDT(campoAquisicao.value);
      if (dt) c.aquisicaoDT = dt;
      else problemas.push('Horário da aquisição inválido.');
    }
    if (problemas.length > 0) {
      erro.hidden = false;
      erro.textContent = problemas.join(' ');
      return;
    }
    erro.hidden = true;
    void ocupado(() => aplicarCorrecoesPet(stack, c));
  });

  if (!d.open) d.showModal();
}

function criarCaixa(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.id = 'dados-pet';
  d.setAttribute('aria-label', 'Dados PET');
  const h = document.createElement('h2');
  h.textContent = 'Dados PET';
  const corpo = document.createElement('div');
  corpo.className = 'dados-pet-corpo';
  const botoes = document.createElement('div');
  botoes.className = 'dados-pet-botoes';
  d.append(h, corpo, botoes);
  // Teclas digitadas aqui não podem disparar atalhos do visualizador.
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  caixa = d;
  return d;
}

export function iniciarDadosPet(): void {
  document.addEventListener(EVENTO_DADOS_PET, (e) => abrir((e as CustomEvent<StackNode>).detail));
}
