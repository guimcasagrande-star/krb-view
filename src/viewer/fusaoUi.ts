/**
 * Controles, legenda, colormaps e registro manual da fusão PET/CT.
 */

import { type Types, utilities as utilitariosCore } from '@cornerstonejs/core';
import type { StackNode, StudyNode } from '../io/organize';
import { findFusionCandidates, type FusionCandidate } from '../pet/fusionPairing';
import { unidadeDaPilha } from '../pet/provedorSuv';

/** Hot iron: preto, vermelho escuro, vermelho, laranja, amarelo e branco. */
export const NOME_HOT_IRON = 'Hot iron';

const COLORMAPS_FUSAO: Array<[string, string]> = [
  [NOME_HOT_IRON, 'Hot iron (ferro quente)'],
  ['jet', 'Arco-íris (jet)'],
  ['Inverted-Grayscale', 'Cinza invertido'],
  ['Grayscale', 'Cinza'],
];

let hotIronRegistrado = false;

function garantirHotIron(): void {
  if (hotIronRegistrado) return;
  hotIronRegistrado = true;
  utilitariosCore.colormap.registerColormap({
    ColorSpace: 'RGB',
    Name: NOME_HOT_IRON,
    RGBPoints: [
      0, 0, 0, 0,
      0.18, 0.4, 0, 0,
      0.38, 0.9, 0.05, 0,
      0.58, 1, 0.45, 0,
      0.78, 1, 0.92, 0.1,
      1, 1, 1, 0.95,
    ],
  } as never);
}

garantirHotIron();

export interface EstadoFusao {
  opacidade: number;
  colormap: string;
  teto: number;
  minimo: number;
}

export interface RegistroFusao {
  ativo: boolean;
  deslocamento: [number, number, number];
}

export interface SlotFusao {
  celula: HTMLElement;
  controlesFusao: HTMLElement;
  viewport?: Types.IStackViewport | Types.IVolumeViewport;
  planoSlot: string;
  pilha: StackNode | null;
  pilhaFusao: StackNode | null;
  volumesFusao?: { ct: string; pet: string };
  fusao: EstadoFusao;
  registro: RegistroFusao;
  legendaFusao?: HTMLDivElement;
  atualizarLegendaFusao?: () => void;
  atualizarLeituraRegistro?: () => void;
  reaplicarFusao?: () => void;
}

export interface OpcoesControlesFusao {
  mpr?: boolean;
  obterAlvos: () => SlotFusao[];
  estudoDaPilha: (stack: StackNode) => StudyNode | undefined;
  nomeDaSerie: (stack: StackNode) => string;
  trocarSeries: (anatomic: StackNode, pet: StackNode, sameFrame: boolean) => void;
  renderizarMotor: () => void;
}

/** Verdadeiro quando o slot tem PET associado e está em plano volumétrico (axial, coronal ou sagital). */
export function emFusao(s: Pick<SlotFusao, 'pilhaFusao' | 'planoSlot'>): boolean {
  return !!s.pilhaFusao && (s.planoSlot === 'axial' || s.planoSlot === 'coronal' || s.planoSlot === 'sagital');
}

/** Esconde controles e legenda da fusão (o PET continua associado ao slot para voltar depois). */
export function ocultarFusaoVisual(s: SlotFusao): void {
  s.controlesFusao.hidden = true;
  s.controlesFusao.replaceChildren();
  s.legendaFusao?.remove();
  s.legendaFusao = undefined;
  s.atualizarLegendaFusao = undefined;
  s.reaplicarFusao = undefined;
  s.celula.classList.remove('modo-registro');
  s.registro.ativo = false;
}

/**
 * Faz a opacidade dos volumes sobrepostos (o PET da fusão) valer o que foi pedido:
 * iguala `ScalarOpacityUnitDistance` ao percurso do raio no slab (`2 × slab + 0,025 mm`).
 */
export function corrigirOpacidadePeloSlab(vp: Types.IVolumeViewport): void {
  const percurso = 2 * vp.getSlabThickness() + 0.025;
  for (const entrada of vp.getActors().slice(1)) {
    const prop = (entrada.actor as { getProperty?: () => unknown }).getProperty?.() as
      | { setScalarOpacityUnitDistance?: (componente: number, mm: number) => void }
      | undefined;
    prop?.setScalarOpacityUnitDistance?.(0, percurso);
  }
}

function gradienteDoColormap(nome: string): string {
  garantirHotIron();
  const cm = utilitariosCore.colormap.resolveColormap(nome) as { RGBPoints?: number[] } | undefined;
  const pts = cm?.RGBPoints;
  if (!pts || pts.length < 8) return 'linear-gradient(to top, #000, #fff)';
  const paradas: string[] = [];
  for (let i = 0; i + 3 < pts.length; i += 4) {
    const c = [pts[i + 1]!, pts[i + 2]!, pts[i + 3]!].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
    paradas.push(`rgb(${c[0]}, ${c[1]}, ${c[2]}) ${(pts[i]! * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to top, ${paradas.join(', ')})`;
}

function unidadeLegenda(stack: StackNode | null): string {
  const un = stack ? unidadeDaPilha(stack.id) : 'SUVbw';
  return un === 'SUVbw' || un === 'SUL' ? `${un} (g/ml)` : un === 'SUVbsa' ? `${un} (cm²/ml)` : un;
}

/** Translada o PET sobre a TC (registro manual) deslocando o ator do volume. */
export function aplicarRegistroPet(slot: Pick<SlotFusao, 'viewport' | 'registro'>, volumePetId: string): void {
  const vp = slot.viewport as Types.IVolumeViewport | undefined;
  const ator = vp?.getActors().find((a) => a.referencedId === volumePetId)?.actor as
    | { setPosition?: (x: number, y: number, z: number) => void }
    | undefined;
  const d = slot.registro.deslocamento;
  ator?.setPosition?.(d[0], d[1], d[2]);
}

/** Aplica opacidade, colormap e teto de SUV ao PET da fusão (independentes da janela da TC). */
export function aplicarFusao(
  slot: SlotFusao,
  volumeCtId: string,
  volumePetId: string,
  renderizarMotor: () => void,
): void {
  garantirHotIron();
  const vp = slot.viewport as Types.IVolumeViewport | undefined;
  if (!vp) return;
  const { opacidade, colormap, teto, minimo } = slot.fusao;
  const piso = Math.min(minimo, teto * 0.9);
  vp.setProperties(
    {
      voiRange: { lower: 0, upper: teto },
      colormap: {
        name: colormap,
        opacity: [
          ...(piso <= 0
            ? [
                { value: 0, opacity: opacidade },
                { value: Math.max(teto, 0.01), opacity: opacidade },
              ]
            : [
                { value: 0, opacity: 0 },
                { value: piso, opacity: 0 },
                { value: piso + (teto - piso) * 0.25, opacity: opacidade },
                { value: Math.max(teto, piso + 0.01), opacity: opacidade },
              ]),
        ],
      },
    },
    volumePetId,
  );
  void volumeCtId;
  corrigirOpacidadePeloSlab(vp);
  slot.atualizarLegendaFusao?.();
  aplicarRegistroPet(slot, volumePetId);
  vp.render();
  renderizarMotor();
}

/** Cria e mantém atualizada a legenda vertical de escala de SUV da fusão no slot. */
export function criarLegendaFusao(slot: SlotFusao): void {
  slot.legendaFusao?.remove();
  const legenda = document.createElement('div');
  legenda.className = 'legenda-fusao';
  const legOp = document.createElement('div');
  legOp.className = 'leg-op';
  const legCorpo = document.createElement('div');
  legCorpo.className = 'leg-corpo';
  const legBarra = document.createElement('div');
  legBarra.className = 'leg-barra';
  const legRot = document.createElement('div');
  legRot.className = 'leg-rotulos';
  const legMax = document.createElement('span');
  const legMin = document.createElement('span');
  legRot.append(legMax, legMin);
  legCorpo.append(legBarra, legRot);
  const legUn = document.createElement('div');
  legUn.className = 'leg-un';
  legenda.append(legOp, legCorpo, legUn);
  slot.celula.append(legenda);
  slot.legendaFusao = legenda;
  slot.atualizarLegendaFusao = () => {
    const f = slot.fusao;
    const num = (n: number): string =>
      n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    legOp.textContent = `${Math.round(f.opacidade * 100)}%`;
    legBarra.style.background = gradienteDoColormap(f.colormap);
    legMax.textContent = num(f.teto);
    legMin.textContent = num(0);
    legUn.textContent = unidadeLegenda(slot.pilhaFusao);
  };
  slot.atualizarLegendaFusao();
}

/** Monta a barra de controles flutuante da fusão (opacidade, colormap, janela SUV e registro). */
export function montarControlesFusao(
  slot: SlotFusao,
  volumeCtId: string,
  volumePetId: string,
  opcoes: OpcoesControlesFusao,
): void {
  slot.volumesFusao = { ct: volumeCtId, pet: volumePetId };
  criarLegendaFusao(slot);

  const c = slot.controlesFusao;
  c.replaceChildren();
  c.hidden = false;
  const reaplicar = (): void => {
    for (const a of opcoes.obterAlvos()) {
      const v = a.volumesFusao ?? { ct: volumeCtId, pet: volumePetId };
      aplicarFusao(a, v.ct, v.pet, opcoes.renderizarMotor);
    }
  };
  slot.reaplicarFusao = reaplicar;

  const opac = document.createElement('input');
  opac.type = 'range';
  opac.min = '0';
  opac.max = '100';
  opac.value = String(Math.round(slot.fusao.opacidade * 100));
  opac.title = 'Opacidade do PET';
  opac.addEventListener('input', () => {
    slot.fusao.opacidade = Number(opac.value) / 100;
    reaplicar();
  });

  const cor = document.createElement('select');
  cor.title = 'Colormap do PET';
  for (const [v, t] of COLORMAPS_FUSAO) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    cor.append(o);
  }
  cor.value = slot.fusao.colormap;
  cor.addEventListener('change', () => {
    slot.fusao.colormap = cor.value;
    reaplicar();
  });

  const teto = document.createElement('input');
  teto.type = 'number';
  teto.min = '0.5';
  teto.step = '0.5';
  teto.value = String(slot.fusao.teto);
  teto.title = 'Teto de SUV do PET (a janela do PET vai de 0 até aqui)';
  teto.addEventListener('change', () => {
    const v = Number(teto.value.replace(',', '.'));
    if (v > 0) {
      slot.fusao.teto = v;
      reaplicar();
    }
  });

  const minimo = document.createElement('input');
  minimo.type = 'number';
  minimo.min = '0';
  minimo.step = '0.5';
  minimo.value = String(slot.fusao.minimo);
  minimo.title = 'SUV mínimo: abaixo disso o PET fica transparente';
  minimo.addEventListener('change', () => {
    const v = Number(minimo.value.replace(',', '.'));
    if (v >= 0) {
      slot.fusao.minimo = v;
      reaplicar();
    }
  });

  const rot = (t: string, el: HTMLElement): HTMLElement => {
    const l = document.createElement('label');
    l.textContent = t;
    l.append(el);
    return l;
  };

  const mover = document.createElement('button');
  mover.type = 'button';
  mover.textContent = 'Mover PET';
  mover.title = 'Arraste no viewport para deslocar o PET sobre a TC (corrige movimento do paciente)';
  const leitura = document.createElement('span');
  const restaurar = document.createElement('button');
  restaurar.type = 'button';
  restaurar.textContent = 'Restaurar';
  const atualizarLeitura = (): void => {
    const d = slot.registro.deslocamento;
    const nulo = d[0] === 0 && d[1] === 0 && d[2] === 0;
    leitura.textContent = nulo ? 'Δ 0 mm' : `Δ ${d.map((v) => v.toFixed(1).replace('.', ',')).join(' · ')} mm`;
    restaurar.disabled = nulo;
    mover.setAttribute('aria-pressed', String(slot.registro.ativo));
    slot.celula.classList.toggle('modo-registro', slot.registro.ativo);
  };
  const passoZ = (delta: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = delta > 0 ? 'z+' : 'z−';
    b.title = `Desloca o PET ${Math.abs(delta)} mm na direção cabeça-pés`;
    b.addEventListener('click', () => {
      slot.registro.deslocamento[2] += delta;
      aplicarRegistroPet(slot, volumePetId);
      atualizarLeitura();
      opcoes.renderizarMotor();
    });
    return b;
  };
  mover.addEventListener('click', () => {
    slot.registro.ativo = !slot.registro.ativo;
    atualizarLeitura();
  });
  restaurar.addEventListener('click', () => {
    slot.registro.deslocamento = [0, 0, 0];
    aplicarRegistroPet(slot, volumePetId);
    atualizarLeitura();
    opcoes.renderizarMotor();
  });
  atualizarLeitura();
  slot.atualizarLeituraRegistro = atualizarLeitura;

  const estudo = slot.pilha ? opcoes.estudoDaPilha(slot.pilha) : undefined;
  const pares = estudo ? findFusionCandidates(estudo) : [];
  const unicos = (pegar: (cand: FusionCandidate) => StackNode): StackNode[] => {
    const m = new Map<string, StackNode>();
    for (const cand of pares) m.set(pegar(cand).id, pegar(cand));
    return [...m.values()];
  };
  const seletorSerie = (
    rotulo: string,
    lista: StackNode[],
    atual: string | undefined,
    aoEscolher: (st: StackNode) => void,
  ): HTMLElement => {
    const sel = document.createElement('select');
    sel.title = rotulo;
    for (const st of lista) {
      const o = document.createElement('option');
      o.value = st.id;
      o.textContent = `${opcoes.nomeDaSerie(st)} (${st.instances.length})`;
      sel.append(o);
    }
    if (atual) sel.value = atual;
    sel.disabled = lista.length < 2;
    sel.addEventListener('change', () => {
      const st = lista.find((x) => x.id === sel.value);
      if (st) aoEscolher(st);
    });
    return rot(`${rotulo} `, sel);
  };
  const trocar = (pet: StackNode, anat: StackNode): void => {
    const par = pares.find((cand) => cand.pet.id === pet.id && cand.anatomic.id === anat.id);
    opcoes.trocarSeries(anat, pet, par ? par.sameFrame : false);
  };
  const seriesFusao = document.createElement('div');
  seriesFusao.className = 'series-fusao';
  seriesFusao.append(
    seletorSerie('PET', unicos((cand) => cand.pet), slot.pilhaFusao?.id, (st) => slot.pilha && trocar(st, slot.pilha)),
    seletorSerie(
      'TC/RM',
      unicos((cand) => cand.anatomic),
      slot.pilha?.id,
      (st) => slot.pilhaFusao && trocar(slot.pilhaFusao, st),
    ),
  );

  const painel = document.createElement('div');
  painel.className = 'painel-fusao';
  painel.hidden = true;
  if (opcoes.mpr) painel.append(rot('PET ', opac), rot('', cor), rot('SUV mín ', minimo), rot('máx ', teto));
  else {
    painel.append(
      seriesFusao,
      rot('PET ', opac),
      rot('', cor),
      rot('SUV mín ', minimo),
      rot('máx ', teto),
      mover,
      passoZ(-2),
      passoZ(2),
      leitura,
      restaurar,
    );
  }
  const abrir = document.createElement('button');
  abrir.type = 'button';
  abrir.className = 'btn-fusao';
  abrir.textContent = '⚙ Fusão';
  abrir.title = 'Opacidade, colormap, SUV mín/máx e ajuste do registro do PET';
  abrir.addEventListener('click', () => {
    painel.hidden = !painel.hidden;
  });
  c.append(abrir, painel);
}

/** Ativa o arrasto manual do PET sobre a TC quando o botão "Mover PET" está ligado (com throttle rAF). */
export function ligarArrastoRegistroPet(
  celula: HTMLElement,
  elemento: HTMLElement,
  slot: SlotFusao,
  renderizarMotor: () => void,
): void {
  celula.addEventListener(
    'mousedown',
    (ev) => {
      const v = slot.viewport;
      if (ev.button !== 0 || !slot.registro.ativo || !emFusao(slot) || !v || !slot.volumesFusao) return;
      if (ev.target instanceof Element && ev.target.closest('.controles-fusao')) return;
      const rect = elemento.getBoundingClientRect();
      const mundoInicial = v.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]);
      const base = [...slot.registro.deslocamento] as [number, number, number];
      let rafRender = 0;

      const agendarRender = (): void => {
        if (rafRender) return;
        rafRender = requestAnimationFrame(() => {
          rafRender = 0;
          renderizarMotor();
        });
      };

      const aplicarEvento = (m: MouseEvent): void => {
        if (!slot.volumesFusao) return;
        const atual = v.canvasToWorld([m.clientX - rect.left, m.clientY - rect.top]);
        const dx = atual[0] - mundoInicial[0];
        const dy = atual[1] - mundoInicial[1];
        const dz = atual[2] - mundoInicial[2];
        const n = v.getCamera().viewPlaneNormal ?? [0, 0, 1];
        const ao = dx * n[0] + dy * n[1] + dz * n[2];
        slot.registro.deslocamento = [base[0] + dx - ao * n[0], base[1] + dy - ao * n[1], base[2] + dz - ao * n[2]];
        aplicarRegistroPet(slot, slot.volumesFusao.pet);
        slot.atualizarLeituraRegistro?.();
        agendarRender();
      };

      const aoMover = (m: MouseEvent): void => {
        aplicarEvento(m);
      };
      const aoSoltar = (): void => {
        window.removeEventListener('mousemove', aoMover, true);
        window.removeEventListener('mouseup', aoSoltar, true);
        if (rafRender) {
          cancelAnimationFrame(rafRender);
          rafRender = 0;
          renderizarMotor();
        }
      };
      window.addEventListener('mousemove', aoMover, true);
      window.addEventListener('mouseup', aoSoltar, true);
      ev.stopPropagation();
      ev.preventDefault();
    },
    true,
  );
}
