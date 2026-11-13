/**
 * Tela "Buscar no PACS" (fases 11.3 e 11.4): pesquisa em um ou mais servidores, lista de séries,
 * download com progresso e cancelamento, e abertura do estudo baixado.
 *
 * Regras: só conecta aos servidores cadastrados e só quando o usuário pede; só consulta e baixa;
 * não guarda nome de paciente nem resultados de pesquisa em disco ou log.
 */

import { findSeries, findStudies, retrieve, type PacsServer } from '../pacs/client.ts';
import { instancePath } from '../pacs/config.ts';
import { PacsError } from '../pacs/errors.ts';
import type { SeriesResult, StudyResult } from '../pacs/query.ts';
import { connectTauri, definirServidoresPermitidos } from '../pacs/transporteTauri.ts';
import { parseHeader } from '../io/readHeader';
import { formatDatePtBr } from '../io/dicomTime';
import { carregarConfigPacs, type ConfigPacs } from '../state/pacsConfig';
import {
  apagarExames,
  definirPastaDeExames,
  gravarExame,
  lerExame,
  listarExames,
  pastaDeExames,
  tamanhoDosExames,
} from '../state/examesBaixados';
import { dispararAbrirCandidatos } from './abrirPasta';
import { abrirServidoresPacs } from './servidoresPacs';

let caixa: HTMLDialogElement | undefined;

interface Resultado {
  estudo: StudyResult;
  servidor: PacsServer;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...filhos: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const { class: classe, ...resto } = props as Record<string, unknown>;
  const e = Object.assign(document.createElement(tag), resto);
  if (classe) e.className = String(classe);
  e.append(...filhos);
  return e;
}

const doCampoData = (v: string): string => v.replace(/-/g, '');

function mensagemDe(e: unknown): string {
  return e instanceof PacsError || e instanceof Error ? e.message : String(e);
}

function formatarMb(bytes: number): string {
  return `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function desenhar(): void {
  const corpo = caixa!.querySelector<HTMLElement>('.busca-corpo')!;
  corpo.replaceChildren();
  const config = carregarConfigPacs();

  if (config.servidores.length === 0) {
    const abrir = el('button', { type: 'button', textContent: 'Cadastrar servidores…' });
    abrir.addEventListener('click', () => {
      caixa!.close();
      abrirServidoresPacs();
    });
    corpo.append(el('p', {}, 'Nenhum servidor PACS cadastrado.'), abrir);
    return;
  }

  // --- filtros ---
  const marcas = config.servidores.map((s) => {
    const c = el('input', { type: 'checkbox', checked: true });
    return { s, c, rotulo: el('label', { class: 'busca-servidor' }, c, ` ${s.name}`) };
  });
  const nome = el('input', { type: 'text', placeholder: 'ex.: joão silva' });
  const idPac = el('input', { type: 'text' });
  const acesso = el('input', { type: 'text' });
  const de = el('input', { type: 'date' });
  const ate = el('input', { type: 'date' });
  const modalidade = el('select');
  for (const m of ['', 'CT', 'MR', 'PT', 'NM', 'US', 'CR', 'DX', 'MG', 'XA']) {
    modalidade.append(el('option', { value: m, textContent: m || 'Todas' }));
  }
  const atalho = (rotulo: string, dias: number): HTMLButtonElement => {
    const b = el('button', { type: 'button', textContent: rotulo });
    b.addEventListener('click', () => {
      const hoje = new Date();
      const ini = new Date(hoje.getTime() - dias * 86_400_000);
      de.value = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-${String(ini.getDate()).padStart(2, '0')}`;
      ate.value = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
    });
    return b;
  };
  const linha = (rot: string, c: HTMLElement): HTMLElement => el('label', { class: 'cfg-linha' }, el('span', {}, rot), c);
  const buscar = el('button', { type: 'button', class: 'primario', textContent: 'Buscar' });
  const estadoBusca = el('p', { class: 'cfg-aviso' });
  estadoBusca.hidden = true;
  const dica = (t: string | null, ok = false): void => {
    estadoBusca.hidden = !t;
    estadoBusca.textContent = t ?? '';
    estadoBusca.className = ok ? 'cfg-dica' : 'cfg-aviso';
  };

  const areaResultados = el('div', { class: 'busca-resultados' });
  const areaDetalhe = el('div', { class: 'busca-detalhe' });

  corpo.append(
    el('div', { class: 'busca-servidores' }, ...marcas.map((m) => m.rotulo)),
    linha('Nome do paciente', nome),
    linha('ID do paciente', idPac),
    linha('Número de acesso', acesso),
    el('div', { class: 'cfg-linha' }, el('span', {}, 'Período'), el('span', { class: 'busca-periodo' }, de, ' a ', ate, atalho('Hoje', 0), atalho('7 dias', 7), atalho('30 dias', 30))),
    linha('Modalidade', modalidade),
    buscar,
    estadoBusca,
    areaResultados,
    areaDetalhe,
  );

  buscar.addEventListener('click', async () => {
    const escolhidos = marcas.filter((m) => m.c.checked).map((m) => m.s);
    if (escolhidos.length === 0) {
      dica('Escolha pelo menos um servidor.');
      return;
    }
    const filtros = {
      patientName: nome.value.trim(),
      patientId: idPac.value.trim(),
      accessionNumber: acesso.value.trim(),
      dateFrom: doCampoData(de.value),
      dateTo: doCampoData(ate.value),
      modality: modalidade.value,
    };
    if (Object.values(filtros).every((v) => v === '')) {
      dica('Informe pelo menos um filtro (nome, ID, número de acesso, período ou modalidade).');
      return;
    }
    buscar.disabled = true;
    areaResultados.replaceChildren();
    areaDetalhe.replaceChildren();
    dica('Buscando…', true);
    await definirServidoresPermitidos(config.servidores);
    const respostas = await Promise.allSettled(
      escolhidos.map(async (s) => ({
        s,
        r: await findStudies(s, filtros, { connect: connectTauri, callingAeTitle: config.meuAeTitle, timeoutMs: 20_000 }),
      })),
    );
    buscar.disabled = false;
    const todos: Resultado[] = [];
    const problemas: string[] = [];
    let truncado = false;
    respostas.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        truncado ||= r.value.r.truncated;
        for (const e of r.value.r.results) todos.push({ estudo: e, servidor: r.value.s });
      } else {
        problemas.push(`${escolhidos[i]!.name}: ${mensagemDe(r.reason)}`);
      }
    });
    // Mais recente primeiro, entre todos os servidores.
    todos.sort((a, b) =>
      `${b.estudo.studyDate ?? ''}${b.estudo.studyTime ?? ''}`.localeCompare(`${a.estudo.studyDate ?? ''}${a.estudo.studyTime ?? ''}`),
    );
    const avisos = [...problemas.map((p) => `⚠ ${p}`)];
    if (truncado) avisos.push('Há mais resultados; refine a pesquisa.');
    if (todos.length === 0 && problemas.length === 0) avisos.push('Nenhum estudo encontrado.');
    dica(avisos.length ? avisos.join(' · ') : null);
    mostrarResultados(areaResultados, areaDetalhe, todos);
  });
}

function mostrarResultados(area: HTMLElement, detalhe: HTMLElement, lista: Resultado[]): void {
  area.replaceChildren();
  if (lista.length === 0) return;
  const tabela = el('table', { class: 'cfg-tabela busca-tabela' });
  tabela.append(
    el('tr', {}, ...['Data', 'Paciente', 'ID', 'Modalidades', 'Descrição', 'Imagens', 'Servidor'].map((t) => el('th', {}, t))),
  );
  for (const r of lista) {
    const e = r.estudo;
    const tr = el(
      'tr',
      { class: 'busca-linha' },
      el('td', {}, formatDatePtBr(e.studyDate) || '—'),
      el('td', {}, (e.patientName ?? '').replace(/\^/g, ' ').trim() || '—'),
      el('td', {}, e.patientId ?? '—'),
      el('td', {}, e.modalities.join(', ') || '—'),
      el('td', {}, e.description ?? '—'),
      el('td', {}, e.instanceCount !== undefined ? String(e.instanceCount) : '—'),
      el('td', {}, r.servidor.name),
    );
    tr.addEventListener('click', () => {
      for (const o of tabela.querySelectorAll('tr.selecionada')) o.classList.remove('selecionada');
      tr.classList.add('selecionada');
      void mostrarSeries(detalhe, r);
    });
    tabela.append(tr);
  }
  area.append(tabela);
}

const cfg = (): ConfigPacs => carregarConfigPacs();

async function mostrarSeries(area: HTMLElement, r: Resultado): Promise<void> {
  area.replaceChildren(el('p', { class: 'cfg-dica' }, 'Carregando séries…'));
  let series: SeriesResult[];
  try {
    series = (await findSeries(r.servidor, r.estudo.studyInstanceUid, { connect: connectTauri, callingAeTitle: cfg().meuAeTitle, timeoutMs: 20_000 })).results;
  } catch (e) {
    area.replaceChildren(el('p', { class: 'cfg-aviso' }, mensagemDe(e)));
    return;
  }
  const caixas = series.map((s) => ({ s, c: el('input', { type: 'checkbox', checked: true }) }));
  const baixar = el('button', { type: 'button', class: 'primario', textContent: 'Baixar' });
  const cancelar = el('button', { type: 'button', textContent: 'Cancelar' });
  cancelar.hidden = true;
  const progresso = el('progress', { max: 1, value: 0 });
  progresso.hidden = true;
  const resumo = el('p', { class: 'cfg-dica' });
  const pastaInfo = el('p', { class: 'cfg-dica' });

  const atualizarPasta = async (): Promise<void> => {
    try {
      const base = await pastaDeExames();
      pastaInfo.textContent = `Pasta de exames: ${base} (${formatarMb(await tamanhoDosExames(base))})`;
    } catch {
      pastaInfo.textContent = '';
    }
  };
  void atualizarPasta();

  area.replaceChildren(
    el('h3', {}, 'Séries do estudo'),
    el(
      'div',
      { class: 'busca-series' },
      ...caixas.map(({ s, c }) =>
        el(
          'label',
          {},
          c,
          ` #${s.seriesNumber ?? '?'} · ${s.modality ?? ''} · ${s.description ?? '(sem descrição)'} · ${s.instanceCount ?? '?'} imagens`,
        ),
      ),
    ),
    el('div', { class: 'pacs-botoes' }, baixar, cancelar, progresso),
    resumo,
    pastaInfo,
  );

  baixar.addEventListener('click', async () => {
    const escolhidas = caixas.filter((x) => x.c.checked).map((x) => x.s);
    if (escolhidas.length === 0) {
      resumo.textContent = 'Escolha pelo menos uma série.';
      return;
    }
    const controle = new AbortController();
    baixar.disabled = true;
    cancelar.hidden = false;
    progresso.hidden = false;
    progresso.removeAttribute('value');
    cancelar.onclick = () => controle.abort();
    resumo.textContent = 'Baixando…';
    let recebidas = 0;
    let falhas = 0;
    let cancelado = false;
    try {
      const base = await pastaDeExames();
      await definirServidoresPermitidos(cfg().servidores);
      const estudoTotal = escolhidas.reduce((n, s) => n + (s.instanceCount ?? 0), 0);
      for (const s of escolhidas) {
        const resumoSerie = await retrieve(
          r.servidor,
          { studyInstanceUid: r.estudo.studyInstanceUid, seriesInstanceUid: s.seriesInstanceUid },
          {
            connect: connectTauri,
            callingAeTitle: cfg().meuAeTitle,
            timeoutMs: 60_000,
            signal: controle.signal,
            onInstance: async (inst) => {
              // A série vem do cabeçalho do próprio arquivo recebido.
              const lido = parseHeader(inst.file, inst.sopInstanceUid);
              const serieUid = lido.ok ? lido.meta.seriesInstanceUid : undefined;
              if (!serieUid) throw new PacsError('DADOS_INVALIDOS', 'Imagem recebida sem série; não gravada.');
              await gravarExame(base, instancePath(r.estudo.studyInstanceUid, serieUid, inst.sopInstanceUid), inst.file);
            },
            onProgress: (p) => {
              resumo.textContent = `Baixando… ${recebidas + p.received} imagens`;
              if (estudoTotal > 0) {
                progresso.max = estudoTotal;
                progresso.value = recebidas + p.received;
              }
            },
          },
        );
        recebidas += resumoSerie.received;
        falhas += resumoSerie.failed;
        if (resumoSerie.cancelled) {
          cancelado = true;
          break;
        }
      }
      resumo.textContent = `${cancelado ? 'Cancelado' : 'Concluído'}: ${recebidas} imagens recebidas, ${falhas} com falha.`;
      if (recebidas > 0 && !cancelado) await abrirEstudoBaixado(base, r.estudo.studyInstanceUid);
    } catch (e) {
      resumo.textContent = `Erro: ${mensagemDe(e)} (${recebidas} imagens já gravadas).`;
    } finally {
      baixar.disabled = false;
      cancelar.hidden = true;
      progresso.hidden = true;
      await atualizarPasta();
    }
  });

}

/** Abre a pasta do estudo pelo mesmo fluxo de "Abrir pasta". */
async function abrirEstudoBaixado(base: string, estudoUid: string): Promise<void> {
  const arquivos = await listarExames(base, estudoUid);
  dispararAbrirCandidatos(
    arquivos.map((rel) => ({
      path: rel,
      obter: async () => new File([(await lerExame(base, rel)) as BlobPart], rel.split('/').pop() ?? rel),
    })),
  );
  caixa?.close();
}

function criarCaixa(): HTMLDialogElement {
  const d = el('dialog', { id: 'buscar-pacs' });
  d.setAttribute('aria-label', 'Buscar no PACS');
  const fechar = el('button', { type: 'button', textContent: 'Fechar', class: 'cfg-fechar' });
  fechar.addEventListener('click', () => d.close());

  // Configuração da pasta de exames baixados e limpeza.
  const pasta = el('input', { type: 'text', class: 'busca-pasta' });
  pasta.title = 'Pasta onde os exames baixados são gravados (caminho completo)';
  const espaco = el('span', { class: 'cfg-dica' });
  const apagar = el('button', { type: 'button', textContent: 'Apagar exames baixados' });
  const carregar = async (): Promise<void> => {
    try {
      const base = await pastaDeExames();
      pasta.value = base;
      espaco.textContent = formatarMb(await tamanhoDosExames(base));
    } catch {
      /* fora do Tauri */
    }
  };
  pasta.addEventListener('change', () => {
    definirPastaDeExames(pasta.value);
    void carregar();
  });
  apagar.addEventListener('click', async () => {
    const base = await pastaDeExames();
    if (!window.confirm(`Apagar TODOS os exames baixados em\n${base}\n(isso não afeta o PACS)?`)) return;
    await apagarExames(base, '');
    await carregar();
  });
  d.addEventListener('toggle', () => {
    if (d.open) void carregar();
  });

  d.append(
    el('h2', {}, 'Buscar no PACS'),
    el('div', { class: 'busca-corpo' }),
    el('div', { class: 'cfg-linha busca-pastarow' }, el('span', {}, 'Pasta de exames'), pasta, espaco, apagar),
    el('p', { class: 'cfg-aviso' }, 'Sem VPN ou DICOM TLS, os dados trafegam abertos.'),
    fechar,
  );
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  });
  document.body.append(d);
  return d;
}

export function abrirBuscarPacs(): void {
  caixa ??= criarCaixa();
  desenhar();
  if (!caixa.open) caixa.showModal();
}
