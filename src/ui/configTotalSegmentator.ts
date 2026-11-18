/**
 * Modal guiado de instalação, diagnóstico e configuração do TotalSegmentator (Opção 3):
 * - Diagnóstico completo via `totalseg_diagnosticar` (executável, TOTALSEG_HOME_DIR, pesos,
 *   `nvidia-smi` e `torch.cuda.is_available()`);
 * - Instalação automática isolada em `%LOCALAPPDATA%\VisuTS` via `uv` (GPU CUDA 12.4 ou CPU)
 *   com pré-download de pesos (`total_fast`, `total` e opcional `total_mr`), progresso em tempo real
 *   e cancelamento seguro;
 * - Configuração manual / offline para ambientes hospitalares restritos.
 */

export interface InfoGpuNvidia {
  nome: string;
  memoriaMb: number;
  driver: string;
}

export interface InfoTarefaPesos {
  id: string;
  nome: string;
  categoria?: string;
  requerLicenca?: boolean;
  baixado: boolean;
  parcial: boolean;
  detalhe: string;
  tamanhoMb: number;
}

export interface DiagnosticoTotalSeg {
  instalado: boolean;
  origem: 'customizado' | 'isolado' | 'path' | 'nao_encontrado';
  executavelCaminho: string | null;
  pythonCaminho: string | null;
  pastaPesos: string;
  pesosCustomizados: boolean;
  caminhoCustomizadoInvalido: string | null;
  tarefasBaixadas: InfoTarefaPesos[];
  gpuNvidia: InfoGpuNvidia | null;
  cudaDisponivel: boolean | null;
  versaoTorch: string | null;
  versaoCudaTorch: string | null;
  versaoTotalSeg: string | null;
  espacoLivreBytes: number;
  instalacaoEmAndamento: boolean;
  temLicencaSalva?: boolean;
  temLicencaPadrao?: boolean;
  tarefasComLicenca?: string[];
}

export interface EventoProgressoTotalSeg {
  etapa: string;
  indiceEtapa: number;
  totalEtapas: number;
  percentual: number | null;
  linhaLog: string | null;
  ultimasLinhas: string[];
  concluido: boolean;
  erro: string | null;
  cancelado: boolean;
}

export interface OpcoesInstalacaoTotalSeg {
  modoHardware: 'gpu' | 'cpu';
  baixarTotalFast: boolean;
  baixarTotal: boolean;
  baixarTotalMr: boolean;
  tarefasPesos?: string[];
}

interface TauriTotalSegGlobal {
  core?: {
    invoke<T>(comando: string, args?: Record<string, unknown>): Promise<T>;
  };
  event?: {
    listen<T>(evento: string, aoReceber: (e: { payload: T }) => void): Promise<() => void>;
  };
}

export const EVENTO_DIAGNOSTICO_TOTALSEG = 'totalsegDiagnosticoMudou';

function tauriApi(): TauriTotalSegGlobal | undefined {
  return (globalThis as unknown as { __TAURI__?: TauriTotalSegGlobal }).__TAURI__;
}

export function tauriTotalSegDisponivel(): boolean {
  const t = tauriApi();
  return Boolean(t?.core?.invoke);
}

// ---------------------------------------------------------------------------
// Funções puras de formatação e validação (testáveis no Node)
// ---------------------------------------------------------------------------

export function formatarEspacoGb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'indisponível';
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

export function origemLegivelTotalSeg(origem: DiagnosticoTotalSeg['origem']): string {
  switch (origem) {
    case 'customizado':
      return 'Caminho customizado (manual)';
    case 'isolado':
      return 'Ambiente isolado do app (%LOCALAPPDATA%\\VisuTS)';
    case 'path':
      return 'PATH do sistema';
    case 'nao_encontrado':
      return 'Não encontrado';
  }
}

export function resumoCurtoTotalSeg(diag: DiagnosticoTotalSeg | null): {
  texto: string;
  classe: 'ok' | 'aviso' | 'erro' | 'pendente';
} {
  if (!diag) return { texto: 'Verificando TotalSegmentator…', classe: 'pendente' };
  if (!diag.instalado) {
    return { texto: 'TotalSegmentator não configurado', classe: 'erro' };
  }
  const temAlgumPeso = diag.tarefasBaixadas.some((t) => t.baixado);
  const sufixoHw =
    diag.cudaDisponivel === true
      ? 'GPU CUDA'
      : diag.gpuNvidia
        ? 'CPU (CUDA inativo)'
        : 'CPU';
  if (!temAlgumPeso) {
    return { texto: `Instalado · ${sufixoHw} · pesos pendentes`, classe: 'aviso' };
  }
  return { texto: `Pronto · ${sufixoHw}`, classe: 'ok' };
}

export function verificarEspacoRecomendado(
  diag: DiagnosticoTotalSeg | null,
  modoHardware: 'gpu' | 'cpu',
  pesos: { totalFast: boolean; total: boolean; totalMr: boolean; extrasCount?: number },
): {
  insuficiente: boolean;
  critico: boolean;
  requeridoGb: number;
  faixaTexto: string;
  mensagem: string;
} {
  const extraMrGb = pesos.totalMr ? 1 : 0;
  const extraOutrosGb = Math.ceil((pesos.extrasCount ?? 0) * 0.35);
  const temPesosCt = pesos.totalFast || pesos.total;
  const requeridoGb =
    modoHardware === 'gpu'
      ? (temPesosCt ? 8 : 5) + extraMrGb + extraOutrosGb
      : (temPesosCt ? 3 : 2) + extraMrGb + extraOutrosGb;
  const minimoCriticoGb = modoHardware === 'gpu' ? 4 : 2;
  const faixaTexto =
    extraOutrosGb > 0
      ? `~${requeridoGb} GB livres`
      : modoHardware === 'gpu'
        ? pesos.totalMr
          ? '7 a 9 GB livres'
          : '6 a 8 GB livres'
        : pesos.totalMr
          ? '3 a 4 GB livres'
          : '~3 GB livres';

  if (!diag || diag.espacoLivreBytes <= 0) {
    return {
      insuficiente: false,
      critico: false,
      requeridoGb,
      faixaTexto,
      mensagem: `Requisito estimado: ${faixaTexto}.`,
    };
  }

  const livreGb = diag.espacoLivreBytes / (1024 * 1024 * 1024);
  const insuficiente = livreGb < requeridoGb;
  const critico = livreGb < minimoCriticoGb;
  const livreFmt = formatarEspacoGb(diag.espacoLivreBytes);

  if (critico) {
    return {
      insuficiente: true,
      critico: true,
      requeridoGb,
      faixaTexto,
      mensagem: `Espaço livre muito baixo (${livreFmt}). Esta opção requer ${faixaTexto}.`,
    };
  }
  if (insuficiente) {
    return {
      insuficiente: true,
      critico: false,
      requeridoGb,
      faixaTexto,
      mensagem: `Atenção: espaço livre de ${livreFmt} está abaixo do recomendado (${faixaTexto}).`,
    };
  }
  return {
    insuficiente: false,
    critico: false,
    requeridoGb,
    faixaTexto,
    mensagem: `Espaço livre: ${livreFmt} (requisito: ${faixaTexto}).`,
  };
}

// ---------------------------------------------------------------------------
// Estado compartilhado do diagnóstico em cache
// ---------------------------------------------------------------------------

let diagnosticoCache: DiagnosticoTotalSeg | null = null;
let promessaDiagnostico: Promise<DiagnosticoTotalSeg | null> | null = null;

function publicarDiagnostico(diag: DiagnosticoTotalSeg | null): void {
  diagnosticoCache = diag;
  document.dispatchEvent(new CustomEvent(EVENTO_DIAGNOSTICO_TOTALSEG, { detail: diag }));
}

export function obterDiagnosticoCacheTotalSeg(): DiagnosticoTotalSeg | null {
  return diagnosticoCache;
}

export async function consultarDiagnosticoTotalSeg(forcar = false): Promise<DiagnosticoTotalSeg | null> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke) return null;
  if (!forcar && diagnosticoCache) return diagnosticoCache;
  if (!forcar && promessaDiagnostico) return promessaDiagnostico;

  promessaDiagnostico = invoke<DiagnosticoTotalSeg>('totalseg_diagnosticar')
    .then((diag) => {
      publicarDiagnostico(diag);
      return diag;
    })
    .catch(() => diagnosticoCache)
    .finally(() => {
      promessaDiagnostico = null;
    });

  return promessaDiagnostico;
}

// ---------------------------------------------------------------------------
// Modal guiado
// ---------------------------------------------------------------------------

type AbaModalTotalSeg = 'automatica' | 'manual';

let modal: HTMLDialogElement | undefined;
let abaAtual: AbaModalTotalSeg = 'automatica';
let operacaoEmAndamento = false;
let hardwareSelecionado: 'gpu' | 'cpu' | null = null;
const tarefasMarcadasSet = new Set<string>(['total_fast', 'total']);
const categoriasAbertasSet = new Set<string>(['essenciais']);
let rascunhoLicenca = '';
const rascunhosLicencaTarefa = new Map<string, string>();
let mensagemLicenca: { texto: string; tipo: 'ok' | 'aviso' | 'erro' } | null = null;
let ultimoProgresso: EventoProgressoTotalSeg | null = null;
let mensagemOperacao: { texto: string; tipo: 'ok' | 'aviso' | 'erro' } | null = null;
let mensagemManual: { texto: string; tipo: 'ok' | 'aviso' | 'erro' } | null = null;
let ouvinteProgressoAtivo = false;
let rascunhoExec = '';
let rascunhoPesos = '';
let rascunhoInicializado = false;

interface DefTarefaUi {
  id: string;
  nome: string;
  dica: string;
  categoria: 'essenciais' | 'abdome' | 'torax' | 'outros' | 'licenca';
  requerLicenca?: boolean;
}

const CATALOGO_PESOS_UI: ReadonlyArray<DefTarefaUi> = [
  // Principais
  { id: 'total_fast', nome: 'total_fast — Rápido TC (--fast, ~250 MB)', dica: '117 estruturas em 3 mm · ideal para prévia rápida e base de recorte de outras tarefas.', categoria: 'essenciais' },
  { id: 'total', nome: 'total — Completo TC alta resolução (~1,3 GB)', dica: '117 estruturas em 1,5 mm · usado nos presets de Pâncreas, Fígado, Rins e Vasos.', categoria: 'essenciais' },
  { id: 'total_fast_mr', nome: 'total_fast_mr — Rápido RM (--fast, ~230 MB)', dica: '50 estruturas de Ressonância Magnética em modo rápido.', categoria: 'essenciais' },
  { id: 'total_mr', nome: 'total_mr — Completo RM alta resolução (~500 MB)', dica: '50 estruturas de Ressonância Magnética em alta resolução.', categoria: 'essenciais' },

  // Abdome, Fígado e Oncologia
  { id: 'liver_vessels', nome: 'liver_vessels — Vasos e tumores hepáticos (TC)', dica: 'Segmenta vasos hepáticos e tumores hepáticos.', categoria: 'abdome' },
  { id: 'liver_segments', nome: 'liver_segments — Segmentos de Couinaud I–VIII (TC)', dica: 'Divisão cirúrgica dos 8 segmentos hepáticos na TC.', categoria: 'abdome' },
  { id: 'liver_segments_mr', nome: 'liver_segments_mr — Segmentos de Couinaud I–VIII (RM)', dica: 'Divisão cirúrgica dos 8 segmentos hepáticos na RM.', categoria: 'abdome' },
  { id: 'liver_lesions', nome: 'liver_lesions — Lesões hepáticas (TC)', dica: 'Segmentação dedicada de lesões focais hepáticas em TC.', categoria: 'abdome' },
  { id: 'liver_lesions_mr', nome: 'liver_lesions_mr — Lesões hepáticas (RM)', dica: 'Segmentação dedicada de lesões focais hepáticas em RM.', categoria: 'abdome' },
  { id: 'kidney_cysts', nome: 'kidney_cysts — Cistos renais (TC)', dica: 'Cistos renais bilaterais.', categoria: 'abdome' },
  { id: 'abdominal_muscles', nome: 'abdominal_muscles — Músculos abdominais e psoas (TC)', dica: 'Psoas, reto abdominal, oblíquos, quadrado lombar e paravertebrais (sarcopenia).', categoria: 'abdome' },

  // Tórax e Pulmão
  { id: 'lung_vessels', nome: 'lung_vessels — Vasos pulmonares e brônquios (TC)', dica: 'Artérias pulmonares, veias pulmonares e árvore traqueobrônquica.', categoria: 'torax' },
  { id: 'lung_nodules', nome: 'lung_nodules — Nódulos pulmonares (TC)', dica: 'Parênquima pulmonar e nódulos pulmonares.', categoria: 'torax' },
  { id: 'pleural_pericard_effusion', nome: 'pleural_pericard_effusion — Derrame pleural e pericárdico (TC)', dica: 'Quantifica automaticamente derrame pleural e pericárdico em mL.', categoria: 'torax' },

  // Coluna, Cabeça/Pescoço, Mama e Outros
  { id: 'vertebrae_mr', nome: 'vertebrae_mr — Vértebras e discos (RM)', dica: 'Corpos vertebrais e discos intervertebrais em RM de coluna.', categoria: 'outros' },
  { id: 'breasts', nome: 'breasts — Mamas (TC)', dica: 'Segmentação mamária em TC.', categoria: 'outros' },
  { id: 'cerebral_bleed', nome: 'cerebral_bleed — Hemorragia intracraniana (TC)', dica: 'Hemorragia intraparenquimatosa em TC de crânio.', categoria: 'outros' },
  { id: 'brain_aneurysm', nome: 'brain_aneurysm — Aneurismas cerebrais (TOF-MRA / Angio-TC)', dica: 'Detecção de aneurismas intracranianos.', categoria: 'outros' },
  { id: 'ventricle_parts', nome: 'ventricle_parts — Ventrículos cerebrais (TC/RM)', dica: 'Porções do sistema ventricular cerebral.', categoria: 'outros' },
  { id: 'head_glands_cavities', nome: 'head_glands_cavities — Glândulas e seios da face (TC)', dica: 'Parótidas, submandibulares, tireoide, cavidade nasal e seios paranasais.', categoria: 'outros' },
  { id: 'headneck_bones_vessels', nome: 'headneck_bones_vessels — Ossos e vasos cervicais (TC)', dica: 'Carótidas, jugulares e arcabouço ósseo cérvico-facial.', categoria: 'outros' },
  { id: 'headneck_muscles', nome: 'headneck_muscles — Músculos de cabeça e pescoço (TC)', dica: 'Musculatura mastigatória, faríngea e cervical.', categoria: 'outros' },
  { id: 'hip_implant', nome: 'hip_implant — Prótese de quadril (TC)', dica: 'Implantes ortopédicos coxofemorais.', categoria: 'outros' },
  { id: 'body', nome: 'body — Contorno corporal e extremidades (TC)', dica: 'Tronco e extremidades corporais.', categoria: 'outros' },
  { id: 'body_mr', nome: 'body_mr — Contorno corporal (RM)', dica: 'Contorno corporal em RM.', categoria: 'outros' },

  // Com licença acadêmica gratuita
  { id: 'tissue_types', nome: '🔑 tissue_types — Gordura visceral/subcutânea e músculo (TC)', dica: 'Composição corporal (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'tissue_types_mr', nome: '🔑 tissue_types_mr — Gordura visceral/subcutânea e músculo (RM)', dica: 'Composição corporal em RM (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'aortic_dissection', nome: '🔑 aortic_dissection — Dissecção de aorta: luz verdadeira/falsa (TC)', dica: 'Luz verdadeira e luz falsa da aorta (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'renal_arteries', nome: '🔑 renal_arteries — Tronco celíaco, AMS e artérias renais (TC)', dica: 'Ramos viscerais abdominais finos (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'coronary_arteries', nome: '🔑 coronary_arteries — Artérias coronárias (TC)', dica: 'Árvore coronariana em TC cardíaca/tórax (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'heartchambers_highres', nome: '🔑 heartchambers_highres — Câmaras cardíacas alta res. (TC)', dica: 'Átrios, ventrículos, miocárdio, aorta e tronco pulmonar (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'appendicular_bones', nome: '🔑 appendicular_bones — Ossos apendiculares (TC)', dica: 'Ossos dos membros superiores e inferiores (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'appendicular_bones_mr', nome: '🔑 appendicular_bones_mr — Ossos apendiculares (RM)', dica: 'Ossos dos membros em RM (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
  { id: 'brain_structures', nome: '🔑 brain_structures — Estruturas encefálicas (TC)', dica: 'Estruturas parenquimatosas cerebrais em TC (requer chave acadêmica gratuita).', categoria: 'licenca', requerLicenca: true },
];

const ROTULOS_CATEGORIA_PESOS: Record<DefTarefaUi['categoria'], string> = {
  essenciais: 'Principais — Corpo inteiro TC e RM (uso livre)',
  abdome: 'Abdome, Fígado e Oncologia (uso livre)',
  torax: 'Tórax e Pulmão (uso livre)',
  outros: 'Coluna, Cabeça/Pescoço, Mama e Outros (uso livre)',
  licenca: 'Tarefas com Chave Acadêmica Gratuita (opcional)',
};

function calcularEspacoAtual(diag: DiagnosticoTotalSeg | null, hw: 'gpu' | 'cpu') {
  const extras = Array.from(tarefasMarcadasSet).filter(
    (id) => id !== 'total_fast' && id !== 'total' && id !== 'total_mr',
  ).length;
  return verificarEspacoRecomendado(diag, hw, {
    totalFast: tarefasMarcadasSet.has('total_fast'),
    total: tarefasMarcadasSet.has('total'),
    totalMr: tarefasMarcadasSet.has('total_mr'),
    extrasCount: extras,
  });
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

function botao(texto: string, acao: () => void, classe = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: texto, class: classe });
  b.addEventListener('click', acao);
  return b;
}

async function garantirOuvinteProgresso(): Promise<void> {
  if (ouvinteProgressoAtivo) return;
  const listen = tauriApi()?.event?.listen;
  if (!listen) return;
  ouvinteProgressoAtivo = true;
  try {
    await listen<EventoProgressoTotalSeg>('totalseg-instalacao-progresso', (ev) => {
      ultimoProgresso = ev.payload;
      atualizarBlocoProgresso();
    });
  } catch {
    ouvinteProgressoAtivo = false;
  }
}

function atualizarBlocoProgresso(): void {
  if (!modal) return;
  const box = modal.querySelector<HTMLElement>('.ts-progresso-box');
  if (!box) return;
  const p = ultimoProgresso;
  box.hidden = !operacaoEmAndamento && !p;
  if (!p) return;

  const etapaEl = box.querySelector<HTMLElement>('.ts-etapa-texto');
  const barra = box.querySelector<HTMLProgressElement>('progress');
  const logEl = box.querySelector<HTMLElement>('.ts-log');
  if (etapaEl) {
    const prefixo = p.totalEtapas > 0 ? `Etapa ${p.indiceEtapa}/${p.totalEtapas}: ` : '';
    etapaEl.textContent = `${prefixo}${p.etapa}`;
  }
  if (barra) {
    if (typeof p.percentual === 'number' && Number.isFinite(p.percentual)) {
      barra.max = 100;
      barra.value = Math.max(0, Math.min(100, p.percentual));
    } else {
      barra.removeAttribute('value');
    }
  }
  if (logEl) {
    logEl.textContent = p.ultimasLinhas.join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function sincronizarRascunhosComDiagnostico(diag: DiagnosticoTotalSeg | null): void {
  if (!diag) return;
  if (!rascunhoInicializado) {
    rascunhoExec = diag.origem === 'customizado' ? (diag.executavelCaminho ?? '') : '';
    rascunhoPesos = diag.pesosCustomizados ? diag.pastaPesos : '';
    rascunhoInicializado = true;
  }
  if (hardwareSelecionado === null) {
    hardwareSelecionado = diag.gpuNvidia ? 'gpu' : 'cpu';
  }
}

function renderizarDiagnostico(diag: DiagnosticoTotalSeg | null, carregando: boolean): HTMLElement {
  const card = el('div', { class: 'ts-diag-card' });
  const resumo = resumoCurtoTotalSeg(diag);

  const cab = el(
    'div',
    { class: 'ts-diag-topo' },
    el('span', { class: `ts-badge ts-badge-${resumo.classe}`, textContent: carregando ? 'Verificando ambiente…' : resumo.texto }),
    (() => {
      const b = botao('🔄 Atualizar diagnóstico', () => {
        void atualizarDiagnosticoNoModal();
      });
      b.disabled = carregando || operacaoEmAndamento;
      return b;
    })(),
  );
  card.append(cab);

  if (!diag) {
    card.append(el('p', { class: 'cfg-dica' }, 'Consultando Python, pesos locais e GPU NVIDIA…'));
    return card;
  }

  if (diag.caminhoCustomizadoInvalido) {
    card.append(
      el(
        'p',
        { class: 'cfg-aviso' },
        `⚠ O caminho customizado salvo não existe mais: ${diag.caminhoCustomizadoInvalido}`,
      ),
    );
  }

  const grade = el('dl', { class: 'ts-diag-grid' });
  const adicionarLinha = (rotulo: string, valor: string): void => {
    grade.append(el('dt', {}, rotulo), el('dd', { title: valor }, valor));
  };

  adicionarLinha('Origem', origemLegivelTotalSeg(diag.origem));
  adicionarLinha(
    'Executável',
    diag.executavelCaminho
      ? `${diag.executavelCaminho}${diag.versaoTotalSeg ? ` (v${diag.versaoTotalSeg})` : ''}`
      : 'Não encontrado',
  );
  adicionarLinha(
    'Pasta de pesos (TOTALSEG_HOME_DIR)',
    `${diag.pastaPesos}${diag.pesosCustomizados ? ' · customizada' : ' · gerenciada pelo app'}`,
  );
  adicionarLinha(
    'GPU NVIDIA (nvidia-smi)',
    diag.gpuNvidia
      ? `${diag.gpuNvidia.nome} (${Math.max(1, Math.round(diag.gpuNvidia.memoriaMb / 1024))} GB · driver ${diag.gpuNvidia.driver})`
      : 'Não detectada',
  );
  adicionarLinha(
    'PyTorch / CUDA',
    diag.versaoTorch
      ? `torch ${diag.versaoTorch} · torch.cuda.is_available() = ${diag.cudaDisponivel ? `True (CUDA ${diag.versaoCudaTorch ?? '?'})` : 'False (CPU)'}`
      : diag.instalado
        ? 'Não consultado (sem python.exe irmão)'
        : '—',
  );
  adicionarLinha('Espaço livre em disco', formatarEspacoGb(diag.espacoLivreBytes));
  card.append(grade);

  const listaPesos = el('div', { class: 'ts-diag-pesos' });
  const baixadasOuParciais = diag.tarefasBaixadas.filter((t) => t.baixado || t.parcial);
  const principaisIds = new Set(['total_fast', 'total', 'total_mr']);
  const exibir = diag.tarefasBaixadas.filter(
    (t) => t.baixado || t.parcial || principaisIds.has(t.id),
  );
  for (const t of exibir) {
    const cls = t.baixado ? 'ok' : t.parcial ? 'aviso' : 'vazio';
    const ic = t.baixado ? '✓' : t.parcial ? '⚠' : '○';
    const mb = t.tamanhoMb > 0 ? ` (${t.tamanhoMb} MB)` : '';
    const chip = el('span', {
      class: `ts-peso-chip ${cls}`,
      textContent: `${ic} ${t.id}${mb}`,
      title: `${t.nome}: ${t.detalhe}`,
    });
    listaPesos.append(chip);
  }
  const restantes = diag.tarefasBaixadas.length - exibir.length;
  if (restantes > 0) {
    listaPesos.append(
      el('span', {
        class: 'ts-peso-chip vazio',
        textContent: `+${restantes} modelos opcionais disponíveis abaixo`,
        title: `${baixadasOuParciais.length} pacote(s) baixado(s) no total`,
      }),
    );
  }
  if (diag.temLicencaSalva) {
    const qtdTarefas = diag.tarefasComLicenca?.length ?? 0;
    const txtLic =
      qtdTarefas > 0
        ? `🔑 ${qtdTarefas} licença(s) por tarefa${diag.temLicencaPadrao ? ' + chave padrão' : ''}`
        : '🔑 Licença acadêmica ativa';
    listaPesos.append(
      el('span', {
        class: 'ts-peso-chip ok',
        textContent: txtLic,
        title: qtdTarefas > 0 ? `Chaves específicas salvas: ${diag.tarefasComLicenca!.join(', ')}` : 'Chave padrão salva',
      }),
    );
  }
  card.append(listaPesos);
  return card;
}

function renderizarAbaAutomatica(diag: DiagnosticoTotalSeg | null): HTMLElement {
  const raiz = el('div', { class: 'ts-aba-conteudo' });
  const hw: 'gpu' | 'cpu' = hardwareSelecionado ?? (diag?.gpuNvidia ? 'gpu' : 'cpu');

  raiz.append(
    el(
      'p',
      { class: 'cfg-dica' },
      'Cria um ambiente Python 3.11 isolado em %LOCALAPPDATA%\\VisuTS usando uv portátil, sem alterar o Python global do Windows.',
    ),
  );

  // Escolha de hardware (GPU CUDA vs CPU)
  const tituloHw = el('h3', {}, '1. Aceleração de processamento');
  const cardsHw = el('div', { class: 'ts-cards-hw' });

  const criarCardHw = (
    modo: 'gpu' | 'cpu',
    titulo: string,
    desc: string,
    recomendado: boolean,
  ): HTMLLabelElement => {
    const radio = el('input', {
      type: 'radio',
      name: 'ts-hw',
      value: modo,
      checked: hw === modo,
      disabled: operacaoEmAndamento,
    });
    radio.addEventListener('change', () => {
      hardwareSelecionado = modo;
      desenharModal();
    });
    const cab = el('div', { class: 'ts-card-hw-cab' }, radio, el('strong', {}, titulo));
    if (recomendado) {
      cab.append(el('span', { class: 'ts-tag-rec', textContent: 'Recomendado' }));
    }
    const card = el('label', { class: `ts-card-hw${hw === modo ? ' selecionado' : ''}` }, cab, el('small', {}, desc));
    return card;
  };

  cardsHw.append(
    criarCardHw(
      'gpu',
      'GPU NVIDIA (CUDA 12.4)',
      diag?.gpuNvidia
        ? `Usa ${diag.gpuNvidia.nome}. Instala torch/torchvision CUDA antes do TotalSegmentator. Requer ~6 a 8 GB livres.`
        : 'Nenhuma GPU NVIDIA detectada pelo nvidia-smi. Só escolha se o driver ainda for instalado. Requer ~6 a 8 GB livres.',
      Boolean(diag?.gpuNvidia),
    ),
    criarCardHw(
      'cpu',
      'CPU (sem GPU dedicada)',
      'Usa PyTorch CPU. Recomendado usar o modo rápido (--fast) ou recorte de órgãos. Requer ~3 GB livres.',
      !diag?.gpuNvidia,
    ),
  );

  // Escolha de pesos pré-baixados (todas as categorias clínicas)
  const tituloPesos = el('h3', {}, `2. Modelos e tarefas para uso offline (${tarefasMarcadasSet.size} marcados)`);

  const barraAtalhosPesos = el('div', { class: 'ts-atalhos-pesos' });
  const btnSelEssenciais = botao('Essenciais TC', () => {
    tarefasMarcadasSet.clear();
    tarefasMarcadasSet.add('total_fast');
    tarefasMarcadasSet.add('total');
    categoriasAbertasSet.add('essenciais');
    desenharModal();
  });
  const btnSelAbdome = botao('Pacote Abdome / Onco (TC+RM)', () => {
    for (const id of [
      'total_fast',
      'total',
      'total_fast_mr',
      'total_mr',
      'liver_vessels',
      'liver_segments',
      'liver_segments_mr',
      'liver_lesions',
      'liver_lesions_mr',
      'kidney_cysts',
      'abdominal_muscles',
    ]) {
      tarefasMarcadasSet.add(id);
    }
    categoriasAbertasSet.add('essenciais');
    categoriasAbertasSet.add('abdome');
    desenharModal();
  });
  const btnSelTodosLivres = botao('Marcar todos livres (25)', () => {
    for (const item of CATALOGO_PESOS_UI) {
      if (!item.requerLicenca) tarefasMarcadasSet.add(item.id);
    }
    desenharModal();
  });
  const btnLimparPesos = botao('Limpar seleção', () => {
    tarefasMarcadasSet.clear();
    desenharModal();
  });
  for (const b of [btnSelEssenciais, btnSelAbdome, btnSelTodosLivres, btnLimparPesos]) {
    b.disabled = operacaoEmAndamento;
  }
  barraAtalhosPesos.append(btnSelEssenciais, btnSelAbdome, btnSelTodosLivres, btnLimparPesos);

  const boxPesos = el('div', { class: 'ts-pesos-lista' });
  const mapaBaixados = new Map((diag?.tarefasBaixadas ?? []).map((t) => [t.id, t]));

  for (const cat of ['essenciais', 'abdome', 'torax', 'outros', 'licenca'] as const) {
    const itensCat = CATALOGO_PESOS_UI.filter((i) => i.categoria === cat);
    const qtdMarcadosCat = itensCat.filter((i) => tarefasMarcadasSet.has(i.id)).length;
    const qtdBaixadosCat = itensCat.filter((i) => mapaBaixados.get(i.id)?.baixado).length;

    const sanfona = el('details', { class: 'ts-grupo-pesos' });
    sanfona.open = categoriasAbertasSet.has(cat);
    sanfona.addEventListener('toggle', () => {
      if (sanfona.open) categoriasAbertasSet.add(cat);
      else categoriasAbertasSet.delete(cat);
    });

    const sumario = el(
      'summary',
      { class: 'ts-grupo-pesos-titulo' },
      el('span', {}, ROTULOS_CATEGORIA_PESOS[cat]),
      el(
        'small',
        { class: 'ts-grupo-pesos-contagem' },
        `${qtdMarcadosCat}/${itensCat.length} marcados · ${qtdBaixadosCat} baixados`,
      ),
    );
    sanfona.append(sumario);

    const corpoGrupo = el('div', { class: 'ts-grupo-pesos-itens' });
    const tarefasComChaveSet = new Set(diag?.tarefasComLicenca ?? []);
    if (cat === 'licenca') {
      const inpLic = el('input', {
        type: 'text',
        value: rascunhoLicenca,
        placeholder: diag?.temLicencaPadrao
          ? 'Chave padrão salva (cole outra para substituir ou deixe vazio p/ remover)'
          : 'Opcional: chave padrão (se várias tarefas compartilharem a mesma chave)',
        disabled: operacaoEmAndamento,
      });
      inpLic.addEventListener('input', () => {
        rascunhoLicenca = inpLic.value;
      });
      const btnSalvarLic = botao(
        diag?.temLicencaPadrao ? 'Atualizar padrão' : 'Salvar padrão',
        () => void salvarLicencaTotalSeg(undefined),
      );
      btnSalvarLic.disabled = operacaoEmAndamento;
      corpoGrupo.append(
        el(
          'div',
          { class: 'ts-licenca-box' },
          el(
            'small',
            {},
            'No site oficial (backend.totalsegmentator.com/license-academic/), cada subtarefa pode ter sua própria chave gratuita. Você pode salvar uma chave específica em cada tarefa abaixo (o app troca automaticamente ao baixar ou rodar) ou definir uma chave padrão:',
          ),
          el('div', { class: 'ts-campo-linha' }, inpLic, btnSalvarLic),
          ...(mensagemLicenca
            ? [el('small', { class: `ts-msg-status ${mensagemLicenca.tipo}`, textContent: mensagemLicenca.texto })]
            : []),
        ),
      );
    }

    for (const item of itensCat) {
      const info = mapaBaixados.get(item.id);
      const chk = el('input', {
        type: 'checkbox',
        checked: tarefasMarcadasSet.has(item.id),
        disabled: operacaoEmAndamento,
      });
      chk.addEventListener('change', () => {
        if (chk.checked) tarefasMarcadasSet.add(item.id);
        else tarefasMarcadasSet.delete(item.id);
        desenharModal();
      });
      const sufixo = info?.baixado
        ? ` ✓ já baixado${info.tamanhoMb > 0 ? ` (${info.tamanhoMb} MB)` : ''}`
        : info?.parcial
          ? ' ⚠ parcial'
          : '';

      if (cat === 'licenca') {
        const baseId = item.id.endsWith('_mr') ? item.id.slice(0, -3) : item.id;
        const temPropria = tarefasComChaveSet.has(item.id);
        const herdaIrma = !temPropria && tarefasComChaveSet.has(baseId);
        const badgeTexto = temPropria
          ? '🔑 Chave própria salva'
          : herdaIrma
            ? `🔑 Usa chave de ${baseId}`
            : diag?.temLicencaPadrao
              ? '🔑 Usa chave padrão'
              : '⚠ Sem chave salva';
        const badgeCls = temPropria || herdaIrma || diag?.temLicencaPadrao ? 'ok' : 'aviso';
        const inpTarefa = el('input', {
          type: 'text',
          value: rascunhosLicencaTarefa.get(item.id) ?? '',
          placeholder: temPropria
            ? `Chave de ${item.id} salva (cole outra p/ trocar)`
            : `Chave específica de ${item.id} (ex.: aca_...)`,
          disabled: operacaoEmAndamento,
        });
        inpTarefa.addEventListener('input', () => {
          rascunhosLicencaTarefa.set(item.id, inpTarefa.value);
        });
        const btnSalvarTarefa = botao(
          temPropria ? 'Trocar chave' : 'Salvar chave',
          () => void salvarLicencaTotalSeg(item.id),
        );
        btnSalvarTarefa.disabled = operacaoEmAndamento;
        const linhaChave = el('div', { class: 'ts-campo-linha ts-licenca-item-linha' }, inpTarefa, btnSalvarTarefa);
        if (temPropria) {
          const btnRemoverTarefa = botao('Remover', () => {
            rascunhosLicencaTarefa.set(item.id, '');
            void salvarLicencaTotalSeg(item.id);
          });
          btnRemoverTarefa.disabled = operacaoEmAndamento;
          linhaChave.append(btnRemoverTarefa);
        }

        corpoGrupo.append(
          el(
            'div',
            { class: 'ts-peso-item ts-peso-item-licenca' },
            el(
              'label',
              { class: 'ts-peso-item-cab' },
              chk,
              el(
                'span',
                {},
                el('strong', {}, item.nome),
                sufixo ? el('em', { class: 'ts-peso-status' }, sufixo) : '',
                el('span', { class: `ts-lic-badge ${badgeCls}`, textContent: badgeTexto }),
                el('small', {}, item.dica),
              ),
            ),
            linhaChave,
          ),
        );
      } else {
        corpoGrupo.append(
          el(
            'label',
            { class: 'ts-peso-item' },
            chk,
            el(
              'span',
              {},
              el('strong', {}, item.nome),
              sufixo ? el('em', { class: 'ts-peso-status' }, sufixo) : '',
              el('small', {}, item.dica),
            ),
          ),
        );
      }
    }
    sanfona.append(corpoGrupo);
    boxPesos.append(sanfona);
  }

  // Alerta de espaço livre
  const espacoInfo = calcularEspacoAtual(diag, hw);
  const boxEspaco = el('div', {
    class: `ts-alerta-espaco${espacoInfo.critico ? ' erro' : espacoInfo.insuficiente ? ' aviso' : ''}`,
    textContent: espacoInfo.mensagem,
  });

  // Botões de ação
  const acoes = el('div', { class: 'ts-acoes' });
  const btnInstalar = botao(
    diag?.origem === 'isolado'
      ? '↻ Reinstalar ambiente isolado'
      : '⬇ Instalar TotalSegmentator (ambiente isolado)',
    () => void iniciarInstalacao(hw),
    'primario',
  );
  btnInstalar.disabled = operacaoEmAndamento || espacoInfo.critico;

  const tarefasMarcadas = Array.from(tarefasMarcadasSet);
  const btnBaixarPesos = botao(
    `⬇ Baixar apenas pesos marcados (${tarefasMarcadas.length})`,
    () => void iniciarDownloadPesos(tarefasMarcadas),
    '',
  );
  btnBaixarPesos.disabled = operacaoEmAndamento || !diag?.instalado || tarefasMarcadas.length === 0;
  btnBaixarPesos.title = diag?.instalado
    ? 'Baixa apenas os modelos selecionados para a pasta TOTALSEG_HOME_DIR sem reinstalar o Python'
    : 'Disponível após o TotalSegmentator estar instalado/configurado';

  const btnCancelar = botao('✕ Cancelar', () => void cancelarOperacao(), 'ts-btn-cancelar');
  btnCancelar.hidden = !operacaoEmAndamento;

  acoes.append(btnInstalar, btnBaixarPesos, btnCancelar);

  // Bloco de progresso em tempo real
  const progBox = el(
    'div',
    { class: 'ts-progresso-box', hidden: !operacaoEmAndamento && !ultimoProgresso },
    el('div', { class: 'ts-etapa-texto', textContent: 'Preparando…' }),
    el('progress', { max: 100, value: 0 }),
    el('pre', { class: 'ts-log' }),
  );

  raiz.append(tituloHw, cardsHw, tituloPesos, barraAtalhosPesos, boxPesos, boxEspaco, acoes, progBox);

  if (mensagemOperacao) {
    raiz.append(
      el('p', {
        class: `ts-msg-status ${mensagemOperacao.tipo}`,
        textContent: mensagemOperacao.texto,
      }),
    );
  }
  return raiz;
}

function renderizarAbaManual(diag: DiagnosticoTotalSeg | null): HTMLElement {
  const raiz = el('div', { class: 'ts-aba-conteudo' });
  raiz.append(
    el(
      'p',
      { class: 'cfg-dica' },
      'Para máquinas hospitalares sem internet ou com ambiente Python/TotalSegmentator já instalado. Aponte o executável e/ou a pasta de pesos (TOTALSEG_HOME_DIR).',
    ),
  );

  const inpExec = el('input', {
    type: 'text',
    value: rascunhoExec,
    placeholder: 'Ex.: C:\\TotalSegmentator\\Scripts\\TotalSegmentator.exe ou python.exe',
    disabled: operacaoEmAndamento,
  });
  inpExec.addEventListener('input', () => {
    rascunhoExec = inpExec.value;
  });
  const btnPickExec = botao('Procurar arquivo…', () => void escolherExecutavelManual());
  btnPickExec.disabled = operacaoEmAndamento;

  const inpPesos = el('input', {
    type: 'text',
    value: rascunhoPesos,
    placeholder: diag?.pastaPesos ? `Padrão do app: ${diag.pastaPesos}` : 'Pasta contendo nnunet\\results',
    disabled: operacaoEmAndamento,
  });
  inpPesos.addEventListener('input', () => {
    rascunhoPesos = inpPesos.value;
  });
  const btnPickPesos = botao('Procurar pasta…', () => void escolherPastaPesosManual());
  btnPickPesos.disabled = operacaoEmAndamento;

  const linhaExec = el(
    'div',
    { class: 'ts-campo-manual' },
    el('label', {}, 'Executável (TotalSegmentator.exe ou python.exe)'),
    el('div', { class: 'ts-campo-linha' }, inpExec, btnPickExec),
  );
  const linhaPesos = el(
    'div',
    { class: 'ts-campo-manual' },
    el('label', {}, 'Pasta de pesos (TOTALSEG_HOME_DIR — deixe vazio para usar a pasta do app)'),
    el('div', { class: 'ts-campo-linha' }, inpPesos, btnPickPesos),
  );

  const btnSalvar = botao('✓ Validar e salvar', () => void salvarConfigManual(), 'primario');
  btnSalvar.disabled = operacaoEmAndamento;
  const btnReset = botao('↺ Voltar para detecção automática', () => void limparConfigManual());
  btnReset.disabled = operacaoEmAndamento;

  raiz.append(linhaExec, linhaPesos, el('div', { class: 'ts-acoes' }, btnSalvar, btnReset));

  if (mensagemManual) {
    raiz.append(
      el('p', {
        class: `ts-msg-status ${mensagemManual.tipo}`,
        textContent: mensagemManual.texto,
      }),
    );
  }
  return raiz;
}

async function atualizarDiagnosticoNoModal(): Promise<void> {
  await consultarDiagnosticoTotalSeg(true);
  sincronizarRascunhosComDiagnostico(diagnosticoCache);
  desenharModal();
}

async function salvarLicencaTotalSeg(tarefa?: string): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || operacaoEmAndamento) return;
  const rascunho = tarefa ? (rascunhosLicencaTarefa.get(tarefa) ?? '').trim() : rascunhoLicenca.trim();
  try {
    const diag = await invoke<DiagnosticoTotalSeg>('totalseg_salvar_licenca', {
      chave: rascunho || null,
      tarefa: tarefa ?? null,
    });
    publicarDiagnostico(diag);
    if (tarefa) {
      mensagemLicenca = rascunho
        ? { texto: `✓ Chave específica para "${tarefa}" salva!`, tipo: 'ok' }
        : { texto: `Chave específica de "${tarefa}" removida.`, tipo: 'aviso' };
      rascunhosLicencaTarefa.delete(tarefa);
    } else {
      mensagemLicenca = rascunho
        ? { texto: '✓ Chave padrão salva!', tipo: 'ok' }
        : { texto: 'Chave padrão removida.', tipo: 'aviso' };
      rascunhoLicenca = '';
    }
  } catch (e) {
    mensagemLicenca = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
  }
  desenharModal();
}

async function iniciarInstalacao(hw: 'gpu' | 'cpu'): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || operacaoEmAndamento) return;

  const espacoInfo = calcularEspacoAtual(diagnosticoCache, hw);
  if (espacoInfo.critico) {
    mensagemOperacao = { texto: espacoInfo.mensagem, tipo: 'erro' };
    desenharModal();
    return;
  }
  if (espacoInfo.insuficiente) {
    const ok = window.confirm(`${espacoInfo.mensagem}\n\nDeseja tentar instalar mesmo assim?`);
    if (!ok) return;
  }

  await garantirOuvinteProgresso();
  operacaoEmAndamento = true;
  mensagemOperacao = null;
  const listaTarefas = Array.from(tarefasMarcadasSet);
  ultimoProgresso = {
    etapa: 'Iniciando instalação isolada…',
    indiceEtapa: 1,
    totalEtapas: 5 + listaTarefas.length,
    percentual: 2,
    linhaLog: null,
    ultimasLinhas: ['Preparando ambiente em %LOCALAPPDATA%\\VisuTS…'],
    concluido: false,
    erro: null,
    cancelado: false,
  };
  desenharModal();

  try {
    const diag = await invoke<DiagnosticoTotalSeg>('totalseg_instalar', {
      opcoes: {
        modoHardware: hw,
        baixarTotalFast: tarefasMarcadasSet.has('total_fast'),
        baixarTotal: tarefasMarcadasSet.has('total'),
        baixarTotalMr: tarefasMarcadasSet.has('total_mr'),
        tarefasPesos: listaTarefas,
      } satisfies OpcoesInstalacaoTotalSeg,
    });
    publicarDiagnostico(diag);
    sincronizarRascunhosComDiagnostico(diag);
    if (hw === 'gpu' && diag.cudaDisponivel === false) {
      mensagemOperacao = {
        texto:
          'TotalSegmentator instalado, mas torch.cuda.is_available() retornou False (executará em CPU). Verifique o driver NVIDIA.',
        tipo: 'aviso',
      };
    } else {
      mensagemOperacao = {
        texto: 'TotalSegmentator instalado e validado com sucesso!',
        tipo: 'ok',
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    mensagemOperacao = {
      texto: msg,
      tipo: msg.toLowerCase().includes('cancelad') ? 'aviso' : 'erro',
    };
    void consultarDiagnosticoTotalSeg(true).then(() => desenharModal());
  } finally {
    operacaoEmAndamento = false;
    desenharModal();
  }
}

async function iniciarDownloadPesos(tarefas: string[]): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || operacaoEmAndamento || tarefas.length === 0) return;

  await garantirOuvinteProgresso();
  operacaoEmAndamento = true;
  mensagemOperacao = null;
  ultimoProgresso = {
    etapa: 'Preparando download dos pesos…',
    indiceEtapa: 1,
    totalEtapas: tarefas.length,
    percentual: 5,
    linhaLog: null,
    ultimasLinhas: [`Baixando tarefas: ${tarefas.join(', ')}…`],
    concluido: false,
    erro: null,
    cancelado: false,
  };
  desenharModal();

  try {
    const diag = await invoke<DiagnosticoTotalSeg>('totalseg_baixar_pesos', { tarefas });
    publicarDiagnostico(diag);
    mensagemOperacao = {
      texto: 'Pesos baixados e prontos para uso 100% offline!',
      tipo: 'ok',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    mensagemOperacao = {
      texto: msg,
      tipo: msg.toLowerCase().includes('cancelad') ? 'aviso' : 'erro',
    };
    void consultarDiagnosticoTotalSeg(true).then(() => desenharModal());
  } finally {
    operacaoEmAndamento = false;
    desenharModal();
  }
}

async function cancelarOperacao(): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || !operacaoEmAndamento) return;
  try {
    await invoke<boolean>('totalseg_cancelar_instalacao');
    mensagemOperacao = { texto: 'Cancelando processo e limpando arquivos parciais…', tipo: 'aviso' };
    desenharModal();
  } catch {
    /* aguarda término da tarefa */
  }
}

async function escolherExecutavelManual(): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke) return;
  try {
    const caminho = await invoke<string | null>('totalseg_escolher_executavel');
    if (caminho) {
      rascunhoExec = caminho;
      desenharModal();
    }
  } catch (e) {
    mensagemManual = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
    desenharModal();
  }
}

async function escolherPastaPesosManual(): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke) return;
  try {
    const pasta = await invoke<string | null>('totalseg_escolher_pasta_pesos');
    if (pasta) {
      rascunhoPesos = pasta;
      desenharModal();
    }
  } catch (e) {
    mensagemManual = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
    desenharModal();
  }
}

async function salvarConfigManual(): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || operacaoEmAndamento) return;
  mensagemManual = { texto: 'Validando executável e pasta de pesos…', tipo: 'aviso' };
  desenharModal();
  try {
    const diag = await invoke<DiagnosticoTotalSeg>('totalseg_salvar_config_manual', {
      executavel: rascunhoExec.trim() || null,
      pastaPesos: rascunhoPesos.trim() || null,
    });
    publicarDiagnostico(diag);
    rascunhoInicializado = false;
    sincronizarRascunhosComDiagnostico(diag);
    mensagemManual = diag.instalado
      ? { texto: 'Configuração manual validada e salva!', tipo: 'ok' }
      : { texto: 'Caminho salvo, mas o TotalSegmentator não respondeu como esperado.', tipo: 'aviso' };
  } catch (e) {
    mensagemManual = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
  }
  desenharModal();
}

async function limparConfigManual(): Promise<void> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke || operacaoEmAndamento) return;
  try {
    const diag = await invoke<DiagnosticoTotalSeg>('totalseg_limpar_config_customizada');
    publicarDiagnostico(diag);
    rascunhoExec = '';
    rascunhoPesos = '';
    rascunhoInicializado = true;
    mensagemManual = {
      texto: 'Configuração customizada removida. Usando detecção automática.',
      tipo: 'ok',
    };
  } catch (e) {
    mensagemManual = { texto: e instanceof Error ? e.message : String(e), tipo: 'erro' };
  }
  desenharModal();
}

function desenharModal(): void {
  if (!modal) return;
  const diagBox = modal.querySelector<HTMLElement>('.ts-diag-container');
  const corpo = modal.querySelector<HTMLElement>('.ts-corpo');
  const btnFechar = modal.querySelector<HTMLButtonElement>('.ts-btn-fechar');
  if (diagBox) {
    diagBox.replaceChildren(renderizarDiagnostico(diagnosticoCache, promessaDiagnostico !== null));
  }
  if (corpo) {
    corpo.replaceChildren(
      abaAtual === 'automatica'
        ? renderizarAbaAutomatica(diagnosticoCache)
        : renderizarAbaManual(diagnosticoCache),
    );
  }
  for (const b of modal.querySelectorAll<HTMLButtonElement>('.cfg-abas button')) {
    b.classList.toggle('ativa', b.dataset.aba === abaAtual);
    b.disabled = operacaoEmAndamento;
  }
  if (btnFechar) {
    btnFechar.disabled = operacaoEmAndamento;
  }
  atualizarBlocoProgresso();
}

function criarModal(): HTMLDialogElement {
  if (modal) return modal;
  const d = el('dialog', { id: 'modal-totalseg' });
  d.setAttribute('aria-label', 'Instalar / Configurar TotalSegmentator');

  const abas = el('div', { class: 'cfg-abas' });
  for (const [id, rotulo] of [
    ['automatica', 'Instalação Automática (Online)'],
    ['manual', 'Configuração Manual / Offline'],
  ] as const) {
    const b = botao(rotulo, () => {
      if (operacaoEmAndamento) return;
      abaAtual = id;
      desenharModal();
    });
    b.dataset.aba = id;
    abas.append(b);
  }

  const btnFechar = botao('Fechar', () => {
    if (!operacaoEmAndamento) d.close();
  }, 'cfg-fechar ts-btn-fechar');

  d.append(
    el('h2', {}, 'TotalSegmentator (IA) — Instalação e Configuração'),
    el('div', { class: 'ts-diag-container' }),
    abas,
    el('div', { class: 'ts-corpo' }),
    el('div', { class: 'cfg-rodape' }, el('span', { class: 'cfg-dica' }, 'Execução 100% local após instalação e download dos pesos.'), btnFechar),
  );

  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && operacaoEmAndamento) {
      e.preventDefault();
      return;
    }
    if (e.key !== 'Escape') e.stopPropagation();
  });
  d.addEventListener('click', (e) => {
    if (e.target === d && !operacaoEmAndamento) d.close();
  });

  document.body.append(d);
  modal = d;
  return d;
}

export function abrirConfigTotalSegmentator(opcoes?: { abaInicial?: AbaModalTotalSeg }): void {
  if (!tauriTotalSegDisponivel()) {
    window.alert('A execução automática do TotalSegmentator está disponível apenas no aplicativo instalado (Tauri). No navegador, use "Importar NIfTI / TotalSegmentator".');
    return;
  }
  const d = criarModal();
  if (opcoes?.abaInicial && !operacaoEmAndamento) {
    abaAtual = opcoes.abaInicial;
  }
  mensagemOperacao = null;
  mensagemManual = null;
  rascunhoInicializado = false;
  if (diagnosticoCache) {
    sincronizarRascunhosComDiagnostico(diagnosticoCache);
  }
  desenharModal();
  if (!d.open) d.showModal();
  void consultarDiagnosticoTotalSeg(true).then((diag) => {
    sincronizarRascunhosComDiagnostico(diag);
    desenharModal();
  });
}
