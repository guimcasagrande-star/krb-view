/**
 * Lógica pura da segunda janela (Etapas 1 a 4):
 * - Detecção do modo secundário (?janela=secundaria ou rótulo da janela Tauri).
 * - Catálogo leve do exame (metas sem nome de paciente + apenas a fatia central de cada pilha
 *   para a miniatura), permitindo ver todas as séries na segunda janela e baixar os arquivos
 *   completos só quando o usuário clicar na série ou enviá-la.
 * - Montagem segura da mensagem de envio de uma pilha (apenas UIDs e referências
 *   File ou caminhos relativos do PACS — nunca nome de paciente ou caminhos do disco).
 * - Sincronia entre janelas: rolagem por posição em mm, janela/nível por modalidade,
 *   cruzinha 3D (┼ Localizar) e linha de referência (interseção 3D entre planos distintos).
 */

import { nearestIndex } from './sync';
import { analyzeStack, dot } from '../io/geometry';
import type { DicomIndex, SeriesNode, StackNode } from '../io/organize';
import type { InstanceMeta, Vec3 } from '../io/types';
import { instancePath } from '../pacs/config.ts';

export const CANAL_SEGUNDA_JANELA = 'visualizador-dicom-segunda-janela';

export interface OpcoesSincroniaJanelas {
  rolagem: boolean;
  janela: boolean;
  localizador: boolean;
  linhas: boolean;
}

export const SINCRONIA_JANELAS_PADRAO: OpcoesSincroniaJanelas = {
  rolagem: true,
  janela: false,
  localizador: true,
  linhas: true,
};

export interface ArquivoSerieTransferido {
  /** Caminho relativo seguro baseado apenas em UIDs (nunca contém nome de paciente ou caminho do disco). */
  caminho: string;
  sopInstanceUid: string;
  /** Objeto File clonado via BroadcastChannel (pasta aberta pelo usuário, arquivo solto ou ZIP). */
  arquivo?: File;
  /** Caminho relativo dentro da pasta de exames baixados do PACS, lido via `lerExame` no Rust. */
  pacsRelativo?: string;
}

export interface MensagemAbrirSerie {
  tipo: 'abrir-serie';
  pilhaId: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  sopInicial?: string;
  /** Se verdadeiro, apenas abastece os arquivos da pilha e abre se ainda for a série pedida. */
  abrirNoQuadro: boolean;
  /** Se verdadeiro, abre exatamente no slot ativo da 2ª janela (ex.: clique ou arraste para um quadro específico). */
  noSlotAtivo?: boolean;
  itens: ArquivoSerieTransferido[];
}

export interface MensagemCatalogoExames {
  tipo: 'catalogo-exames';
  /** Metadados já indexados na janela principal, sem `patientName` e com `fileId` sanitizado. */
  metas: InstanceMeta[];
  /** Fatia central de cada pilha para desenhar as miniaturas no painel da 2ª janela sem carregar tudo. */
  miniaturas: ArquivoSerieTransferido[];
}

export interface MensagemPedirSerie {
  tipo: 'pedir-serie';
  pilhaId: string;
  seriesInstanceUid: string;
  studyInstanceUid: string;
  sopInicial?: string;
}

export interface MensagemSincRolagem {
  tipo: 'sinc-rolagem';
  studyInstanceUid: string;
  frameOfReferenceUid?: string;
  normal: Vec3;
  posicaoMm: number;
  cantosMundo?: [Vec3, Vec3, Vec3, Vec3];
}

export interface MensagemSincJanela {
  tipo: 'sinc-janela';
  studyInstanceUid: string;
  modality: string;
  lower: number;
  upper: number;
  invert?: boolean;
}

export interface MensagemSincLocalizador {
  tipo: 'sinc-localizador';
  studyInstanceUid: string;
  frameOfReferenceUid?: string;
  pontoMundo: Vec3;
}

export interface MensagemConfigSincronia {
  tipo: 'config-sincronia';
  opcoes: OpcoesSincroniaJanelas;
}

export interface MensagemDefinirLayout {
  tipo: 'definir-layout';
  alvo: 'principal' | 'secundaria';
  layout: string;
}

export type MensagemSegundaJanela =
  | { tipo: 'ping-janela' }
  | { tipo: 'janela-pronta' }
  | { tipo: 'limpar-exames' }
  | { tipo: 'limpar-localizador' }
  | { tipo: 'preferencias-atualizadas' }
  | MensagemCatalogoExames
  | MensagemPedirSerie
  | MensagemAbrirSerie
  | MensagemSincRolagem
  | MensagemSincJanela
  | MensagemSincLocalizador
  | MensagemConfigSincronia
  | MensagemDefinirLayout;

/** Verdadeiro quando esta instância da aplicação deve rodar em modo janela secundária. */
export function ehModoSecundario(search: string, labelJanela?: string): boolean {
  if (labelJanela === 'secundaria') return true;
  const parametros = new URLSearchParams(search);
  return parametros.get('janela') === 'secundaria';
}

function segmentoSeguro(valor: string | undefined, reserva: string): string {
  const limpo = (valor ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return limpo || reserva;
}

/**
 * Gera um caminho relativo `<estudo>/<série>/<sop>.dcm` apenas com UIDs, compatível com
 * `instancePath` do PACS quando todos os UIDs seguem o padrão numérico DICOM.
 */
export function caminhoSeguroInstancia(
  inst: Pick<InstanceMeta, 'studyInstanceUid' | 'seriesInstanceUid' | 'sopInstanceUid'>,
  indice: number,
): string {
  const estudo = inst.studyInstanceUid || 'estudo';
  const serie = inst.seriesInstanceUid || 'serie';
  const sop = inst.sopInstanceUid || `corte-${indice + 1}`;
  try {
    return instancePath(estudo, serie, sop);
  } catch {
    return `${segmentoSeguro(estudo, 'estudo')}/${segmentoSeguro(serie, 'serie')}/${segmentoSeguro(sop, `corte-${indice + 1}`)}.dcm`;
  }
}

/**
 * Remove `patientName` e substitui `fileId` pelo caminho seguro baseado em UIDs,
 * para enviar o catálogo de séries à segunda janela sem expor nome de paciente.
 */
export function sanitizarMetasParaCatalogo(metas: ReadonlyArray<InstanceMeta>): InstanceMeta[] {
  return metas.map((m, idx) => {
    const copia: InstanceMeta = {
      ...m,
      fileId: caminhoSeguroInstancia(m, idx),
    };
    delete copia.patientName;
    return copia;
  });
}

/**
 * Monta o pacote de envio de uma pilha para a segunda janela.
 * Prefere `pacsRelativo` quando a imagem já está na pasta de exames baixados do PACS;
 * caso contrário envia o `File` já aberto em memória para clonagem via `BroadcastChannel`.
 */
export function prepararEnvioPilha(
  pilha: StackNode,
  arquivos: ReadonlyMap<string, File>,
  arquivosPacsDoEstudo?: ReadonlySet<string>,
  abrirNoQuadro = true,
): MensagemAbrirSerie {
  const primeira = pilha.instances[0];
  if (!primeira || pilha.instances.length === 0) {
    throw new Error('A série selecionada não tem imagens para enviar.');
  }

  const itens: ArquivoSerieTransferido[] = pilha.instances.map((inst, indice) => {
    const caminho = caminhoSeguroInstancia(inst, indice);
    const sopInstanceUid = inst.sopInstanceUid ?? '';
    if (arquivosPacsDoEstudo?.has(caminho)) {
      return {
        caminho,
        sopInstanceUid,
        pacsRelativo: caminho,
      };
    }
    const arquivo = arquivos.get(inst.fileId);
    if (!arquivo) {
      throw new Error(
        `O arquivo da imagem ${sopInstanceUid || `#${indice + 1}`} não está mais disponível para envio.`,
      );
    }
    return {
      caminho,
      sopInstanceUid,
      arquivo,
    };
  });

  return {
    tipo: 'abrir-serie',
    pilhaId: pilha.id,
    seriesInstanceUid: primeira.seriesInstanceUid ?? '',
    studyInstanceUid: primeira.studyInstanceUid ?? '',
    ...(primeira.sopInstanceUid ? { sopInicial: primeira.sopInstanceUid } : {}),
    abrirNoQuadro,
    itens,
  };
}

const cachePilhasExibicao = new WeakMap<SeriesNode, StackNode[]>();

const AVISOS_IGNORADOS_PILHA_UNIFICADA = new Set([
  'ORIENTACAO_VARIAVEL',
  'ESPACAMENTO_IRREGULAR',
  'CORTES_FALTANDO',
  'POSICAO_DUPLICADA',
  'FORA_DE_ORDEM',
  'GANTRY_INCLINADO',
]);

const ROTULO_PLANO: Record<string, string> = {
  axial: 'Axial',
  coronal: 'Coronal',
  sagital: 'Sagital',
};

function menorInstanceNumber(pilha: StackNode): number | undefined {
  let menor: number | undefined;
  for (const inst of pilha.instances) {
    if (inst.instanceNumber === undefined) continue;
    if (menor === undefined || inst.instanceNumber < menor) {
      menor = inst.instanceNumber;
    }
  }
  return menor;
}

/**
 * Unifica subpilhas da mesma série e do mesmo plano anatômico (ex.: sequências de coluna
 * multi-bloco com inclinação por disco como `AXI T1_smsp_recon`, ou séries dinâmicas/perfusão/difusão)
 * em uma única pilha contínua para rolagem conjunta na barra lateral e no viewport 2D.
 * Localizadores com múltiplos planos distintos (Axial + Coronal + Sagital na mesma série)
 * permanecem separados apenas por plano.
 */
export function pilhasExibicaoDaSerie(serie: SeriesNode): StackNode[] {
  const emCache = cachePilhasExibicao.get(serie);
  if (emCache) return emCache;

  if (serie.stacks.length <= 1) {
    cachePilhasExibicao.set(serie, serie.stacks);
    return serie.stacks;
  }

  const porPlano = new Map<string, Array<{ pilha: StackNode; ordemOriginal: number }>>();
  serie.stacks.forEach((pilha, idx) => {
    const chavePlano = pilha.geometry.plane?.plane ?? 'outro';
    const lista = porPlano.get(chavePlano);
    if (lista) lista.push({ pilha, ordemOriginal: idx });
    else porPlano.set(chavePlano, [{ pilha, ordemOriginal: idx }]);
  });

  const multiplosPlanos = porPlano.size > 1;
  const resultado: StackNode[] = [];

  for (const [chavePlano, grupo] of porPlano.entries()) {
    if (grupo.length === 1) {
      const unica = grupo[0]!.pilha;
      if (!multiplosPlanos && !unica.label) {
        resultado.push(unica);
      } else {
        const rotuloPlano = multiplosPlanos ? (ROTULO_PLANO[chavePlano] ?? unica.label) : undefined;
        const copia: StackNode = {
          id: unica.id,
          instances: unica.instances,
          geometry: unica.geometry,
        };
        if (rotuloPlano) copia.label = rotuloPlano;
        resultado.push(copia);
      }
      continue;
    }

    const todosTemNum = grupo.every((g) => menorInstanceNumber(g.pilha) !== undefined);
    const ordenados = [...grupo].sort((a, b) => {
      if (todosTemNum) {
        const na = menorInstanceNumber(a.pilha)!;
        const nb = menorInstanceNumber(b.pilha)!;
        if (na !== nb) return na - nb;
      }
      return a.ordemOriginal - b.ordemOriginal;
    });

    const instances = ordenados.flatMap((g) => g.pilha.instances);
    const geoBruta = analyzeStack(instances);
    const geometry = {
      ...geoBruta,
      issues: geoBruta.issues.filter((i) => !AVISOS_IGNORADOS_PILHA_UNIFICADA.has(i.code)),
    };

    const unificada: StackNode = {
      id: grupo[0]!.pilha.id,
      instances,
      geometry,
    };
    if (multiplosPlanos && ROTULO_PLANO[chavePlano]) {
      unificada.label = ROTULO_PLANO[chavePlano];
    }
    resultado.push(unificada);
  }

  cachePilhasExibicao.set(serie, resultado);
  return resultado;
}

/**
 * Coleta apenas o corte central de cada pilha do índice para que as miniaturas do painel
 * lateral da segunda janela possam ser desenhadas sem transferir os arquivos de todas as séries.
 */
export function prepararMiniaturasDoCatalogo(
  index: DicomIndex,
  arquivos: ReadonlyMap<string, File>,
): ArquivoSerieTransferido[] {
  const saida: ArquivoSerieTransferido[] = [];
  const vistos = new Set<string>();
  for (const pac of index.patients) {
    for (const est of pac.studies) {
      for (const ser of est.series) {
        for (const pilha of [...pilhasExibicaoDaSerie(ser), ...ser.stacks]) {
          if (pilha.instances.length === 0) continue;
          const idxMeio = Math.floor(pilha.instances.length / 2);
          const inst = pilha.instances[idxMeio]!;
          const caminho = caminhoSeguroInstancia(inst, idxMeio);
          if (vistos.has(caminho)) continue;
          const arq = arquivos.get(inst.fileId);
          if (!arq) continue;
          vistos.add(caminho);
          saida.push({
            caminho,
            sopInstanceUid: inst.sopInstanceUid ?? '',
            arquivo: arq,
          });
        }
      }
    }
  }
  return saida;
}

/** Remove itens cujo SOP Instance UID já foi indexado na segunda janela. */
export function filtrarItensNovosParaIndice(
  itens: ReadonlyArray<ArquivoSerieTransferido>,
  metasExistentes: ReadonlyArray<Pick<InstanceMeta, 'sopInstanceUid'>>,
): ArquivoSerieTransferido[] {
  const jaExistentes = new Set(metasExistentes.map((m) => m.sopInstanceUid).filter((uid): uid is string => !!uid));
  const novos: ArquivoSerieTransferido[] = [];
  for (const item of itens) {
    if (item.sopInstanceUid && jaExistentes.has(item.sopInstanceUid)) continue;
    if (item.sopInstanceUid) jaExistentes.add(item.sopInstanceUid);
    novos.push(item);
  }
  return novos;
}

/** Verdadeiro se todos os arquivos da pilha já estão disponíveis no mapa de arquivos da janela. */
export function pilhaTemTodosArquivos(
  pilha: StackNode,
  arquivos: ReadonlyMap<string, File>,
): boolean {
  if (pilha.instances.length === 0) return false;
  return pilha.instances.every((inst, idx) => {
    return arquivos.has(inst.fileId) || arquivos.has(caminhoSeguroInstancia(inst, idx));
  });
}

/** Localiza no índice a pilha correspondente à referência enviada/pedida. */
export function encontrarPilhaEnviada(
  index: DicomIndex | undefined,
  ref: { pilhaId: string; seriesInstanceUid: string; sopInicial?: string },
): StackNode | null {
  if (!index) return null;

  for (const paciente of index.patients) {
    for (const estudo of paciente.studies) {
      for (const serie of estudo.series) {
        const unificadas = pilhasExibicaoDaSerie(serie);
        for (const pilha of unificadas) {
          if (pilha.id === ref.pilhaId) return pilha;
        }
        for (const pilha of serie.stacks) {
          if (pilha.id === ref.pilhaId) return pilha;
        }
      }
    }
  }

  let primeiraDaSerie: StackNode | null = null;
  for (const paciente of index.patients) {
    for (const estudo of paciente.studies) {
      for (const serie of estudo.series) {
        if (serie.seriesInstanceUid !== ref.seriesInstanceUid) continue;
        for (const pilha of serie.stacks) {
          if (ref.sopInicial && pilha.instances[0]?.sopInstanceUid === ref.sopInicial) {
            return pilha;
          }
        }
        const unificadas = pilhasExibicaoDaSerie(serie);
        for (const pilha of unificadas) {
          primeiraDaSerie ??= pilha;
          if (ref.sopInicial && pilha.instances.some((inst) => inst.sopInstanceUid === ref.sopInicial)) {
            return pilha;
          }
        }
      }
    }
  }

  return primeiraDaSerie;
}

// ---------------------------------------------------------------------------
// Sincronia entre janelas (Etapas 2 e 3: rolagem por posição, janela, cruzinha e linhas)
// ---------------------------------------------------------------------------

export interface SlotParaSincRolagem {
  studyInstanceUid?: string;
  frameOfReferenceUid?: string;
  normal?: Vec3;
  positions: readonly number[];
  sliceThickness?: number;
  ehPilha2d: boolean;
}

export type DecisaoSincRolagem =
  | { acao: 'ignorar' }
  | { acao: 'rolar'; alvoMm: number; indiceMaisProximo?: number }
  | { acao: 'linha-referencia' };

/**
 * Decide como um quadro deve reagir a uma mensagem de rolagem vinda da outra janela:
 * - Mesmo estudo e mesmo plano (`|cos| >= 0.9`): rola para a mesma posição em mm (respeitando cobertura).
 * - Mesmo estudo e plano diferente (`|cos| < 0.9`): projeta a linha de referência do corte remoto.
 */
export function decidirSincRolagemSlot(
  msg: MensagemSincRolagem,
  slot: SlotParaSincRolagem,
): DecisaoSincRolagem {
  if (!msg.studyInstanceUid || slot.studyInstanceUid !== msg.studyInstanceUid) {
    return { acao: 'ignorar' };
  }
  if (
    msg.frameOfReferenceUid &&
    slot.frameOfReferenceUid &&
    msg.frameOfReferenceUid !== slot.frameOfReferenceUid
  ) {
    return { acao: 'ignorar' };
  }
  if (!slot.normal) return { acao: 'ignorar' };

  const cos = dot(msg.normal, slot.normal);
  if (Math.abs(cos) >= 0.9) {
    const sinal = cos >= 0 ? 1 : -1;
    const alvoMm = msg.posicaoMm * sinal;
    if (slot.ehPilha2d) {
      if (slot.positions.length === 0) return { acao: 'ignorar' };
      const idx = nearestIndex([...slot.positions], alvoMm);
      const passo = Math.max(slot.sliceThickness ?? 5, 1);
      if (Math.abs(slot.positions[idx]! - alvoMm) > passo) {
        return { acao: 'ignorar' };
      }
      return { acao: 'rolar', alvoMm, indiceMaisProximo: idx };
    }
    return { acao: 'rolar', alvoMm };
  }

  return { acao: 'linha-referencia' };
}

/** Verdadeiro quando o quadro deve receber a mudança de janela/nível da outra janela. */
export function deveSincronizarJanelaSlot(
  msg: Pick<MensagemSincJanela, 'modality'>,
  modalidadeSlot: string | undefined,
): boolean {
  return Boolean(msg.modality && modalidadeSlot && msg.modality === modalidadeSlot);
}

/** Calcula os 4 cantos 3D (em mm, LPS) de uma imagem 2D a partir de sua geometria DICOM. */
export function cantosMundoDaInstancia(
  inst: Pick<
    InstanceMeta,
    'imagePositionPatient' | 'imageOrientationPatient' | 'rows' | 'columns' | 'pixelSpacing'
  >,
): [Vec3, Vec3, Vec3, Vec3] | null {
  const ipp = inst.imagePositionPatient;
  const iop = inst.imageOrientationPatient;
  const rows = inst.rows;
  const cols = inst.columns;
  const spacing = inst.pixelSpacing;
  if (!ipp || !iop || !rows || !cols || !spacing) return null;

  const [rowSp, colSp] = spacing;
  const larguraMm = cols * colSp;
  const alturaMm = rows * rowSp;
  const rx = iop[0] * larguraMm;
  const ry = iop[1] * larguraMm;
  const rz = iop[2] * larguraMm;
  const cx = iop[3] * alturaMm;
  const cy = iop[4] * alturaMm;
  const cz = iop[5] * alturaMm;

  const c0: Vec3 = [ipp[0], ipp[1], ipp[2]];
  const c1: Vec3 = [ipp[0] + rx, ipp[1] + ry, ipp[2] + rz];
  const c2: Vec3 = [c1[0] + cx, c1[1] + cy, c1[2] + cz];
  const c3: Vec3 = [ipp[0] + cx, ipp[1] + cy, ipp[2] + cz];
  return [c0, c1, c2, c3];
}

/**
 * Intersecta o quadrilátero 3D de um corte `[C0, C1, C2, C3]` com o plano `(pontoPlano, normalPlano)`
 * de outro corte (ex.: corte axial cruzando um corte sagital/coronal).
 * Devolve os dois extremos 3D do segmento de interseção, ou `null` se não cruzarem.
 */
export function intersecaoQuadComPlano(
  cantos: [Vec3, Vec3, Vec3, Vec3],
  pontoPlano: Vec3,
  normalPlano: Vec3,
): [Vec3, Vec3] | null {
  const dist = (p: Vec3): number =>
    (p[0] - pontoPlano[0]) * normalPlano[0] +
    (p[1] - pontoPlano[1]) * normalPlano[1] +
    (p[2] - pontoPlano[2]) * normalPlano[2];

  const pontos: Vec3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = cantos[i]!;
    const b = cantos[(i + 1) % 4]!;
    const da = dist(a);
    const db = dist(b);
    if (Math.abs(da) <= 1e-5) {
      pontos.push(a);
      continue;
    }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      pontos.push([
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        a[2] + t * (b[2] - a[2]),
      ]);
    }
  }

  const unicos: Vec3[] = [];
  for (const p of pontos) {
    const repetido = unicos.some(
      (u) => Math.hypot(u[0] - p[0], u[1] - p[1], u[2] - p[2]) < 0.05,
    );
    if (!repetido) unicos.push(p);
  }
  if (unicos.length < 2) return null;
  return [unicos[0]!, unicos[1]!];
}
