/**
 * Tela "Buscar no PACS" (fases 11.3 e 11.4): pesquisa em um ou mais servidores, lista de séries,
 * download com progresso e cancelamento, e abertura do estudo baixado.
 *
 * Regras: só conecta aos servidores cadastrados e só quando o usuário pede; só consulta e baixa;
 * não guarda nome de paciente nem resultados de pesquisa em disco ou log.
 */

import { findSeries, findStudies, retrieveStudyParallel, type PacsServer } from '../pacs/client.ts';
import { instancePath } from '../pacs/config.ts';
import { PacsError } from '../pacs/errors.ts';
import type { SeriesResult, StudyResult } from '../pacs/query.ts';
import { connectTauri, definirServidoresPermitidos } from '../pacs/transporteTauri.ts';
import { parseHeader } from '../io/readHeader';
import { formatPersonName } from '../io/organize';
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
export type AbaPacs = 'buscar' | 'baixados';
let abaAtiva: AbaPacs = 'buscar';
let atualizarRodapePasta: (() => Promise<void>) | undefined;

interface ExameBaixadoResumo {
  pastaEstudo: string;
  studyInstanceUid: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyTime: string;
  description: string;
  modalities: string[];
  numSeries: number;
  arquivos: string[];
}

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

function formatarVelocidade(bytesPorSeg: number): string {
  if (bytesPorSeg < 1_048_576) {
    return `${(bytesPorSeg / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB/s`;
  }
  return `${(bytesPorSeg / 1_048_576).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB/s`;
}

function atualizarAbasTopo(): void {
  if (!caixa) return;
  for (const b of caixa.querySelectorAll<HTMLButtonElement>('.pacs-abas button')) {
    b.classList.toggle('ativa', b.dataset.aba === abaAtiva);
  }
}

async function carregarResumoExamesBaixados(base: string): Promise<ExameBaixadoResumo[]> {
  const todosRelativos = await listarExames(base, '');
  if (todosRelativos.length === 0) return [];

  // Agrupa por pasta de estudo (1º segmento do caminho relativo) e por série (2º segmento).
  const porEstudo = new Map<string, { arquivos: string[]; primeiroPorSerie: Map<string, string> }>();
  for (const rel of todosRelativos) {
    const partes = rel.split('/');
    const pastaEstudo = partes[0];
    if (!pastaEstudo) continue;
    const pastaSerie = partes.length > 2 ? partes[1]! : '_raiz';
    let entrada = porEstudo.get(pastaEstudo);
    if (!entrada) {
      entrada = { arquivos: [], primeiroPorSerie: new Map() };
      porEstudo.set(pastaEstudo, entrada);
    }
    entrada.arquivos.push(rel);
    if (!entrada.primeiroPorSerie.has(pastaSerie)) {
      entrada.primeiroPorSerie.set(pastaSerie, rel);
    }
  }

  const resumos: ExameBaixadoResumo[] = [];
  for (const [pastaEstudo, info] of porEstudo.entries()) {
    let studyInstanceUid = pastaEstudo;
    let patientName = '';
    let patientId = '';
    let studyDate = '';
    let studyTime = '';
    let description = '';
    const mods = new Set<string>();

    const amostras = [...info.primeiroPorSerie.values()];
    for (const relAmostra of amostras) {
      try {
        const bytes = await lerExame(base, relAmostra);
        const r = parseHeader(bytes, relAmostra);
        if (!r.ok) continue;
        const m = r.meta;
        if (m.studyInstanceUid) studyInstanceUid = m.studyInstanceUid;
        if (!patientName && m.patientName) patientName = formatPersonName(m.patientName);
        if (!patientId && m.patientId) patientId = m.patientId;
        if (!studyDate && m.studyDate) studyDate = m.studyDate;
        if (!studyTime && m.studyTime) studyTime = m.studyTime;
        if (!description && (m.studyDescription || m.seriesDescription)) {
          description = m.studyDescription ?? m.seriesDescription ?? '';
        }
        if (m.modality) mods.add(m.modality);
      } catch {
        /* ignora arquivo ilegível */
      }
    }

    resumos.push({
      pastaEstudo,
      studyInstanceUid,
      patientName: patientName || '(sem nome)',
      patientId: patientId || '—',
      studyDate,
      studyTime,
      description: description || '—',
      modalities: [...mods].sort(),
      numSeries: Math.max(1, info.primeiroPorSerie.size),
      arquivos: info.arquivos,
    });
  }

  resumos.sort((a, b) =>
    `${b.studyDate}${b.studyTime}`.localeCompare(`${a.studyDate}${a.studyTime}`) ||
    a.patientName.localeCompare(b.patientName, 'pt-BR'),
  );
  return resumos;
}

function desenhar(): void {
  atualizarAbasTopo();
  if (abaAtiva === 'baixados') {
    void desenharBaixados();
  } else {
    desenharBusca();
  }
}

async function desenharBaixados(): Promise<void> {
  const corpo = caixa!.querySelector<HTMLElement>('.busca-corpo')!;
  corpo.replaceChildren(el('p', { class: 'cfg-dica' }, 'Lendo exames salvos neste computador…'));

  let base: string;
  let exames: ExameBaixadoResumo[];
  try {
    base = await pastaDeExames();
    exames = await carregarResumoExamesBaixados(base);
  } catch (e) {
    corpo.replaceChildren(el('p', { class: 'cfg-aviso' }, `Erro ao listar exames baixados: ${mensagemDe(e)}`));
    return;
  }

  const btnAbaBaixados = caixa?.querySelector<HTMLButtonElement>('.pacs-abas button[data-aba="baixados"]');
  if (btnAbaBaixados) {
    btnAbaBaixados.textContent = `📥 Exames já baixados (${exames.length})`;
  }

  corpo.replaceChildren();
  if (exames.length === 0) {
    const irParaBusca = el('button', {
      type: 'button',
      class: 'primario',
      textContent: '🔍 Buscar exames no PACS',
    });
    irParaBusca.addEventListener('click', () => {
      abaAtiva = 'buscar';
      desenhar();
    });
    corpo.append(
      el('p', { class: 'cfg-dica' }, 'Nenhum exame baixado do PACS encontrado na pasta atual.'),
      irParaBusca,
    );
    return;
  }

  const selecionados = new Set<string>();
  const campoFiltro = el('input', {
    type: 'text',
    placeholder: 'Filtrar por paciente, ID, modalidade, data ou descrição…',
    class: 'busca-filtro-baixados',
  });

  const btnAbrirSel = el('button', {
    type: 'button',
    class: 'primario',
    textContent: '📂 Abrir selecionados (0)',
    disabled: true,
  });
  const btnApagarSel = el('button', {
    type: 'button',
    textContent: '🗑 Apagar selecionados (0)',
    disabled: true,
  });
  const btnAtualizar = el('button', {
    type: 'button',
    textContent: '🔄 Atualizar',
  });

  const atualizarBotoesLote = (): void => {
    const n = selecionados.size;
    btnAbrirSel.textContent = `📂 Abrir selecionados (${n})`;
    btnAbrirSel.disabled = n === 0;
    btnApagarSel.textContent = `🗑 Apagar selecionados (${n})`;
    btnApagarSel.disabled = n === 0;
  };

  btnAtualizar.addEventListener('click', () => void desenharBaixados());

  btnAbrirSel.addEventListener('click', () => {
    const escolhidos = exames.filter((x) => selecionados.has(x.pastaEstudo));
    if (escolhidos.length === 0) return;
    const todosArquivos = escolhidos.flatMap((x) => x.arquivos);
    dispararAbrirCandidatos(
      todosArquivos.map((rel) => ({
        path: rel,
        obter: async () => new File([(await lerExame(base, rel)) as BlobPart], rel.split('/').pop() ?? rel),
      })),
    );
    caixa?.close();
  });

  btnApagarSel.addEventListener('click', async () => {
    const escolhidos = exames.filter((x) => selecionados.has(x.pastaEstudo));
    if (escolhidos.length === 0) return;
    const nomes = escolhidos
      .slice(0, 6)
      .map((x) => `• ${formatDatePtBr(x.studyDate) || 'sem data'} — ${x.patientName} (${x.modalities.join(', ') || 'DICOM'})`)
      .join('\n');
    const mais = escolhidos.length > 6 ? `\n… e mais ${escolhidos.length - 6} exame(s)` : '';
    if (
      !window.confirm(
        `Apagar ${escolhidos.length} exame(s) selecionado(s) deste computador?\n\n${nomes}${mais}\n\n(Isso não afeta o servidor PACS.)`,
      )
    ) {
      return;
    }
    for (const ex of escolhidos) {
      await apagarExames(base, ex.pastaEstudo);
    }
    await atualizarRodapePasta?.();
    await desenharBaixados();
  });

  const barraAcoes = el(
    'div',
    { class: 'busca-acoes-baixados' },
    campoFiltro,
    btnAbrirSel,
    btnApagarSel,
    btnAtualizar,
  );

  const contentorTabela = el('div', { class: 'busca-resultados' });

  const renderizarTabela = (): void => {
    contentorTabela.replaceChildren();
    const termo = campoFiltro.value.trim().toLowerCase();
    const visiveis = termo
      ? exames.filter((x) => {
          const alvo = `${formatDatePtBr(x.studyDate)} ${x.studyDate} ${x.patientName} ${x.patientId} ${x.modalities.join(' ')} ${x.description}`.toLowerCase();
          return alvo.includes(termo);
        })
      : exames;

    if (visiveis.length === 0) {
      contentorTabela.append(el('p', { class: 'cfg-dica' }, 'Nenhum exame corresponde ao filtro digitado.'));
      return;
    }

    const chkTodos = el('input', { type: 'checkbox' });
    chkTodos.title = 'Selecionar ou desmarcar todos os exames visíveis';
    chkTodos.checked = visiveis.length > 0 && visiveis.every((x) => selecionados.has(x.pastaEstudo));

    const tabela = el('table', { class: 'cfg-tabela busca-tabela' });
    const thCheck = el('th', {}, chkTodos);
    tabela.append(
      el(
        'tr',
        {},
        thCheck,
        ...['Data', 'Paciente', 'ID', 'Modalidades', 'Descrição', 'Volume', 'Ações'].map((t) => el('th', {}, t)),
      ),
    );

    const checkboxesLinhas: Array<{ ex: ExameBaixadoResumo; chk: HTMLInputElement; tr: HTMLTableRowElement }> = [];

    chkTodos.addEventListener('change', () => {
      for (const { ex, chk, tr } of checkboxesLinhas) {
        chk.checked = chkTodos.checked;
        if (chkTodos.checked) selecionados.add(ex.pastaEstudo);
        else selecionados.delete(ex.pastaEstudo);
        tr.classList.toggle('selecionada', chk.checked);
      }
      atualizarBotoesLote();
    });

    for (const ex of visiveis) {
      const chk = el('input', { type: 'checkbox', checked: selecionados.has(ex.pastaEstudo) });
      const btnAbrirUm = el('button', {
        type: 'button',
        class: 'primario',
        textContent: '📂 Abrir',
        title: 'Abrir este exame no visualizador',
      });
      const btnApagarUm = el('button', {
        type: 'button',
        textContent: '🗑 Apagar',
        title: 'Apagar apenas este exame do computador',
      });

      btnAbrirUm.addEventListener('click', (ev) => {
        ev.stopPropagation();
        dispararAbrirCandidatos(
          ex.arquivos.map((rel) => ({
            path: rel,
            obter: async () => new File([(await lerExame(base, rel)) as BlobPart], rel.split('/').pop() ?? rel),
          })),
        );
        caixa?.close();
      });

      btnApagarUm.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (
          !window.confirm(
            `Apagar o exame de ${ex.patientName} (${formatDatePtBr(ex.studyDate) || 'sem data'} · ${ex.modalities.join(', ')}) deste computador?\n\n(Isso não afeta o servidor PACS.)`,
          )
        ) {
          return;
        }
        await apagarExames(base, ex.pastaEstudo);
        selecionados.delete(ex.pastaEstudo);
        await atualizarRodapePasta?.();
        await desenharBaixados();
      });

      const tr = el(
        'tr',
        { class: `busca-linha${selecionados.has(ex.pastaEstudo) ? ' selecionada' : ''}` },
        el('td', {}, chk),
        el('td', {}, formatDatePtBr(ex.studyDate) || '—'),
        el('td', {}, ex.patientName),
        el('td', {}, ex.patientId),
        el('td', {}, ex.modalities.join(', ') || '—'),
        el('td', {}, ex.description),
        el('td', {}, `${ex.numSeries} ${ex.numSeries === 1 ? 'série' : 'séries'} · ${ex.arquivos.length} imgs`),
        el('td', { class: 'pacs-acoes' }, btnAbrirUm, btnApagarUm),
      );

      const alternarSelecaoLinha = (marcado: boolean): void => {
        chk.checked = marcado;
        if (marcado) selecionados.add(ex.pastaEstudo);
        else selecionados.delete(ex.pastaEstudo);
        tr.classList.toggle('selecionada', marcado);
        chkTodos.checked = visiveis.length > 0 && visiveis.every((v) => selecionados.has(v.pastaEstudo));
        atualizarBotoesLote();
      };

      chk.addEventListener('click', (ev) => ev.stopPropagation());
      chk.addEventListener('change', () => alternarSelecaoLinha(chk.checked));
      tr.addEventListener('click', () => alternarSelecaoLinha(!chk.checked));
      tr.addEventListener('dblclick', () => btnAbrirUm.click());

      checkboxesLinhas.push({ ex, chk, tr });
      tabela.append(tr);
    }

    contentorTabela.append(tabela);
  };

  campoFiltro.addEventListener('input', renderizarTabela);
  renderizarTabela();
  corpo.append(
    el(
      'p',
      { class: 'cfg-dica' },
      'Marque os exames que deseja abrir juntos (ex.: comparação) ou apagar individualmente. Dê 2 cliques numa linha para abrir direto.',
    ),
    barraAcoes,
    contentorTabela,
  );
}

function desenharBusca(): void {
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
  // Modalidades: marque uma ou mais (nenhuma = todas).
  const MODALIDADES: Array<[string, string]> = [
    ['PT', 'PET'],
    ['CT', 'TC'],
    ['MR', 'RM'],
    ['NM', 'Cintilografia'],
    ['US', 'US'],
    ['CR', 'CR'],
    ['DX', 'DX'],
    ['MG', 'Mamografia'],
    ['XA', 'Angiografia'],
  ];
  const caixasModalidade = MODALIDADES.map(([codigo, rotulo]) => ({
    codigo,
    c: el('input', { type: 'checkbox' }),
    rotulo: el('label', { class: 'busca-modalidade', title: codigo }),
    texto: rotulo,
  }));
  for (const m of caixasModalidade) m.rotulo.append(m.c, ` ${m.texto}`);
  const modalidade = el('div', { class: 'busca-modalidades' }, ...caixasModalidade.map((m) => m.rotulo));
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
    const escolhidasModalidades = caixasModalidade.filter((m) => m.c.checked).map((m) => m.codigo);
    const filtros = {
      patientName: nome.value.trim(),
      patientId: idPac.value.trim(),
      accessionNumber: acesso.value.trim(),
      dateFrom: doCampoData(de.value),
      dateTo: doCampoData(ate.value),
      modality: '',
    };
    if (Object.values(filtros).every((v) => v === '') && escolhidasModalidades.length === 0) {
      dica('Informe pelo menos um filtro (nome, ID, número de acesso, período ou modalidade).');
      return;
    }
    // O PACS precisa de nome, ID, número de acesso ou data (a modalidade sozinha pediria o PACS
    // inteiro): só com modalidade marcada, usa os últimos 30 dias.
    let avisoPeriodo = '';
    if (!filtros.patientName && !filtros.patientId && !filtros.accessionNumber && !filtros.dateFrom && !filtros.dateTo) {
      const hoje = new Date();
      const ini = new Date(hoje.getTime() - 30 * 86_400_000);
      const fmt = (d: Date): string =>
        `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      filtros.dateFrom = fmt(ini);
      filtros.dateTo = fmt(hoje);
      avisoPeriodo = 'Sem outro filtro: mostrando os últimos 30 dias.';
    }
    buscar.disabled = true;
    areaResultados.replaceChildren();
    areaDetalhe.replaceChildren();
    dica('Buscando…', true);
    await definirServidoresPermitidos(config.servidores);
    // Uma consulta por modalidade marcada (ou uma só, sem modalidade); os estudos repetidos entre
    // consultas do mesmo servidor entram uma vez só.
    const consultas = escolhidos.flatMap((s) =>
      (escolhidasModalidades.length ? escolhidasModalidades : ['']).map((m) => ({ s, m })),
    );
    const respostas = await Promise.allSettled(
      consultas.map(async ({ s, m }) => ({
        s,
        r: await findStudies(s, { ...filtros, modality: m }, { connect: connectTauri, callingAeTitle: config.meuAeTitle, timeoutMs: 20_000 }),
      })),
    );
    buscar.disabled = false;
    const todos: Resultado[] = [];
    const problemas: string[] = [];
    const vistos = new Set<string>();
    let truncado = false;
    respostas.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        truncado ||= r.value.r.truncated;
        for (const e of r.value.r.results) {
          const chave = `${r.value.s.name}|${e.studyInstanceUid}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          todos.push({ estudo: e, servidor: r.value.s });
        }
      } else {
        const msg = `${consultas[i]!.s.name}: ${mensagemDe(r.reason)}`;
        if (!problemas.includes(msg)) problemas.push(msg);
      }
    });
    // Mais recente primeiro, entre todos os servidores.
    todos.sort((a, b) =>
      `${b.estudo.studyDate ?? ''}${b.estudo.studyTime ?? ''}`.localeCompare(`${a.estudo.studyDate ?? ''}${a.estudo.studyTime ?? ''}`),
    );
    const avisos = [...problemas.map((p) => `⚠ ${p}`)];
    if (avisoPeriodo) avisos.unshift(avisoPeriodo);
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
    let bytesRecebidos = 0;
    let falhas = 0;
    let cancelado = false;
    const inicioMs = performance.now();
    const JANELA_VELOCIDADE_MS = 1500;
    const amostras: Array<{ t: number; bytes: number; imgs: number }> = [{ t: inicioMs, bytes: 0, imgs: 0 }];
    const emMemoria = new Map<string, File>();
    try {
      const base = await pastaDeExames();
      await definirServidoresPermitidos(cfg().servidores);
      const estudoTotal = escolhidas.reduce((n, s) => n + (s.instanceCount ?? 0), 0);
      const resumoEstudo = await retrieveStudyParallel(r.servidor, r.estudo.studyInstanceUid, {
        connect: connectTauri,
        callingAeTitle: cfg().meuAeTitle,
        timeoutMs: 60_000,
        signal: controle.signal,
        seriesList: escolhidas,
        concurrency: 4,
        onInstance: async (inst) => {
          // A série vem do cabeçalho do próprio arquivo recebido.
          const lido = parseHeader(inst.file, inst.sopInstanceUid);
          const serieUid = lido.ok ? lido.meta.seriesInstanceUid : undefined;
          if (!serieUid) throw new PacsError('DADOS_INVALIDOS', 'Imagem recebida sem série; não gravada.');
          const rel = instancePath(r.estudo.studyInstanceUid, serieUid, inst.sopInstanceUid);
          const nomeArquivo = rel.split('/').pop() ?? `${inst.sopInstanceUid}.dcm`;
          emMemoria.set(rel, new File([inst.file as BlobPart], nomeArquivo));
          await gravarExame(base, rel, inst.file);
        },
        onProgress: (p) => {
          recebidas = p.received;
          bytesRecebidos = p.bytesReceived;
          const agora = performance.now();
          amostras.push({ t: agora, bytes: p.bytesReceived, imgs: p.received });
          while (amostras.length > 2 && agora - amostras[0]!.t > JANELA_VELOCIDADE_MS) {
            amostras.shift();
          }
          const baseAmostra = amostras[0]!;
          const dtSeg = (agora - baseAmostra.t) / 1000;
          let sufixoVel = '';
          if (dtSeg >= 0.25 && p.bytesReceived > 0) {
            const bytesPorSeg = Math.max(0, p.bytesReceived - baseAmostra.bytes) / dtSeg;
            const imgsPorSeg = Math.max(0, p.received - baseAmostra.imgs) / dtSeg;
            const imgsTxt = imgsPorSeg.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
            sufixoVel = ` · ${formatarMb(p.bytesReceived)} · ${formatarVelocidade(bytesPorSeg)} (${imgsTxt} img/s)`;
          } else if (p.bytesReceived > 0) {
            sufixoVel = ` · ${formatarMb(p.bytesReceived)}`;
          }
          const total = p.total ?? estudoTotal;
          const baseTexto =
            total > 0
              ? `Baixando… ${p.received} de ${total} imagens (série ${p.completedSeries}/${p.totalSeries})`
              : `Baixando… ${p.received} imagens (série ${p.completedSeries}/${p.totalSeries})`;
          resumo.textContent = `${baseTexto}${sufixoVel}`;
          if (total > 0) {
            progresso.max = total;
            progresso.value = p.received;
          }
        },
      });
      recebidas = resumoEstudo.received;
      falhas = resumoEstudo.failed;
      cancelado = resumoEstudo.cancelled;
      const decorridoSeg = Math.max(0.05, (performance.now() - inicioMs) / 1000);
      const mediaVel =
        bytesRecebidos > 0
          ? ` · ${formatarMb(bytesRecebidos)} em ${decorridoSeg.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s (média ${formatarVelocidade(bytesRecebidos / decorridoSeg)})`
          : '';
      resumo.textContent = `${cancelado ? 'Cancelado' : 'Concluído'}: ${recebidas} imagens recebidas, ${falhas} com falha.${mediaVel}`;
      if (recebidas > 0 && !cancelado) {
        await abrirEstudoBaixado(base, r.estudo.studyInstanceUid, emMemoria);
      } else {
        emMemoria.clear();
      }
    } catch (e) {
      emMemoria.clear();
      resumo.textContent = `Erro: ${mensagemDe(e)} (${recebidas} imagens já gravadas).`;
    } finally {
      baixar.disabled = false;
      cancelar.hidden = true;
      progresso.hidden = true;
      await atualizarPasta();
    }
  });

}

/** Abre a pasta do estudo pelo mesmo fluxo de "Abrir pasta", reaproveitando arquivos já em memória. */
async function abrirEstudoBaixado(
  base: string,
  estudoUid: string,
  emMemoria?: Map<string, File>,
): Promise<void> {
  const caminhos = new Set(await listarExames(base, estudoUid));
  if (emMemoria) {
    for (const rel of emMemoria.keys()) caminhos.add(rel);
  }
  const arquivos = [...caminhos].sort();
  dispararAbrirCandidatos(
    arquivos.map((rel) => {
      const arquivoEmMemoria = emMemoria?.get(rel);
      return {
        path: rel,
        obter: arquivoEmMemoria
          ? async () => {
              emMemoria?.delete(rel);
              return arquivoEmMemoria;
            }
          : async () => new File([(await lerExame(base, rel)) as BlobPart], rel.split('/').pop() ?? rel),
      };
    }),
  );
  caixa?.close();
}

function criarCaixa(): HTMLDialogElement {
  const d = el('dialog', { id: 'buscar-pacs' });
  d.setAttribute('aria-label', 'Buscar no PACS');
  const fechar = el('button', { type: 'button', textContent: 'Fechar', class: 'cfg-fechar' });
  fechar.addEventListener('click', () => d.close());

  const abas = el('div', { class: 'cfg-abas pacs-abas' });
  const btnAbaBuscar = el('button', {
    type: 'button',
    textContent: '🔍 Buscar no servidor PACS',
  });
  btnAbaBuscar.dataset.aba = 'buscar';
  btnAbaBuscar.addEventListener('click', () => {
    abaAtiva = 'buscar';
    desenhar();
  });

  const btnAbaBaixados = el('button', {
    type: 'button',
    textContent: '📥 Exames já baixados',
  });
  btnAbaBaixados.dataset.aba = 'baixados';
  btnAbaBaixados.addEventListener('click', () => {
    abaAtiva = 'baixados';
    desenhar();
  });
  abas.append(btnAbaBuscar, btnAbaBaixados);

  // Configuração da pasta de exames baixados e limpeza.
  const pasta = el('input', { type: 'text', class: 'busca-pasta' });
  pasta.title = 'Pasta onde os exames baixados são gravados (caminho completo)';
  const espaco = el('span', { class: 'cfg-dica' });
  const apagar = el('button', { type: 'button', textContent: 'Apagar todos' });
  const carregar = async (): Promise<void> => {
    try {
      const base = await pastaDeExames();
      pasta.value = base;
      espaco.textContent = formatarMb(await tamanhoDosExames(base));
      const todos = await listarExames(base, '');
      const pastasEstudo = new Set(todos.map((r) => r.split('/')[0]).filter(Boolean));
      btnAbaBaixados.textContent = `📥 Exames já baixados (${pastasEstudo.size})`;
    } catch {
      /* fora do Tauri */
    }
  };
  atualizarRodapePasta = carregar;
  pasta.addEventListener('change', () => {
    definirPastaDeExames(pasta.value);
    void carregar();
    if (abaAtiva === 'baixados') void desenharBaixados();
  });
  apagar.addEventListener('click', async () => {
    const base = await pastaDeExames();
    if (!window.confirm(`Apagar TODOS os exames baixados em\n${base}\n(isso não afeta o PACS)?`)) return;
    await apagarExames(base, '');
    await carregar();
    if (abaAtiva === 'baixados') void desenharBaixados();
  });
  d.addEventListener('toggle', () => {
    if (d.open) void carregar();
  });

  d.append(
    el('h2', {}, 'PACS — Busca e Exames Baixados'),
    abas,
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

export function abrirBuscarPacs(aba: AbaPacs = 'buscar'): void {
  caixa ??= criarCaixa();
  abaAtiva = aba;
  desenhar();
  if (!caixa.open) caixa.showModal();
}

export function abrirExamesBaixadosPacs(): void {
  abrirBuscarPacs('baixados');
}
