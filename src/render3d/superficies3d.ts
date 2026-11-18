/**
 * Renderização das superfícies poligonais 3D dos segmentos no Viewport3D (fase 10.1):
 * injeta `vtkActor`s (`vtkPolyData` + `vtkMapper`) diretamente no `VolumeViewport3D`
 * do Cornerstone, com cor, opacidade e iluminação especular suaves por segmento,
 * além de alternância entre Volume Rendering, Superfícies 3D ou ambos sobrepostos.
 */

import type { Types } from '@cornerstonejs/core';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import {
  modoExibicao3d,
  obterSuperficiesEmCache,
  type Segmento,
  segmentacaoDaPilha,
  superficiesDosSegmentosAsync,
} from '../segmentation/segmentacao';
import { type MalhaSuperficie3d, paraPolysVtk } from '../segmentation/superficie3d';

interface RegistroAtorSuperficie {
  uid: string;
  actor: vtkActor;
  polyData: vtkPolyData;
  mapper: vtkMapper;
  ultimaMalha: MalhaSuperficie3d | null;
}

const porViewport = new Map<string, Map<number, RegistroAtorSuperficie>>();
const pilhasEm3d = new Map<string, string>();
const geracaoPorViewport = new Map<string, number>();

function proximaGeracao(idViewport: string): number {
  const g = (geracaoPorViewport.get(idViewport) ?? 0) + 1;
  geracaoPorViewport.set(idViewport, g);
  return g;
}

function liberarRegistro(reg: RegistroAtorSuperficie): void {
  try {
    reg.mapper.delete?.();
  } catch {
    /* já liberado */
  }
  try {
    reg.polyData.delete?.();
  } catch {
    /* já liberado */
  }
}

function aplicarAtorMalha(
  vp: Types.IVolumeViewport,
  mapa: Map<number, RegistroAtorSuperficie>,
  pilhaId: string,
  s: Segmento,
  malha: MalhaSuperficie3d,
  removerRegs: RegistroAtorSuperficie[],
): void {
  let reg = mapa.get(s.indice);
  if (malha.triangleCount === 0) {
    if (reg) {
      removerRegs.push(reg);
      mapa.delete(s.indice);
    }
    return;
  }
  if (!reg) {
    reg = criarRegistro(uidSuperficie(pilhaId, s.indice));
    atualizarGeometria(reg, malha);
    const prop = reg.actor.getProperty();
    prop.setColor(s.cor[0] / 255, s.cor[1] / 255, s.cor[2] / 255);
    prop.setOpacity(s.opacidade3d);
    vp.addActor({ uid: reg.uid, actor: reg.actor as unknown as Types.Actor });
    mapa.set(s.indice, reg);
  } else {
    atualizarGeometria(reg, malha);
    const prop = reg.actor.getProperty();
    prop.setColor(s.cor[0] / 255, s.cor[1] / 255, s.cor[2] / 255);
    prop.setOpacity(s.opacidade3d);
  }
}

function removerRegistrosDoViewport(vp: Types.IVolumeViewport, regs: RegistroAtorSuperficie[]): void {
  if (regs.length === 0) return;
  try {
    vp.removeActors(regs.map((r) => r.uid));
  } catch {
    /* ator já removido */
  }
  for (const r of regs) liberarRegistro(r);
}

export function registrarViewport3d(idViewport: string, pilhaId: string | undefined): void {
  if (pilhaId) pilhasEm3d.set(idViewport, pilhaId);
  else pilhasEm3d.delete(idViewport);
}

export function temViewport3dAtivo(pilhaId: string): boolean {
  for (const p of pilhasEm3d.values()) {
    if (p === pilhaId) return true;
  }
  return false;
}

function uidSuperficie(pilhaId: string, indice: number): string {
  return `seg-superficie-${pilhaId}-${indice}`;
}

function atualizarGeometria(reg: RegistroAtorSuperficie, malha: MalhaSuperficie3d): void {
  if (reg.ultimaMalha === malha) return;
  reg.polyData.getPoints().setData(malha.positions, 3);
  reg.polyData.getPolys().setData(paraPolysVtk(malha.triangles));
  reg.polyData.getPointData().setNormals(
    vtkDataArray.newInstance({
      name: 'Normals',
      numberOfComponents: 3,
      values: malha.normals,
    }),
  );
  reg.polyData.modified();
  reg.mapper.modified();
  reg.ultimaMalha = malha;
}

function criarRegistro(uid: string): RegistroAtorSuperficie {
  const polyData = vtkPolyData.newInstance();
  const mapper = vtkMapper.newInstance({ scalarVisibility: false });
  mapper.setInputData(polyData);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  const prop = actor.getProperty();
  prop.setInterpolationToPhong();
  prop.setAmbient(0.2);
  prop.setDiffuse(0.75);
  prop.setSpecular(0.35);
  prop.setSpecularPower(24);
  return { uid, actor, polyData, mapper, ultimaMalha: null };
}

/**
 * Sincroniza as superfícies 3D da segmentação da pilha com os atores do `VolumeViewport3D`
 * e aplica o modo de exibição atual (`ambos` | `superficies` | `volume`).
 * Quando `permitirReconstrucao` é `false`, atualiza apenas visibilidade, cor e opacidade dos
 * atores já existentes sem extrair novas malhas (evitando trabalho durante o arrasto do pincel).
 */
export function sincronizarSuperficies3d(
  vp: Types.IVolumeViewport,
  pilhaId: string | undefined,
  permitirReconstrucao = true,
): void {
  registrarViewport3d(vp.id, pilhaId);
  const modo = modoExibicao3d();
  const atorVolume = vp.getDefaultActor()?.actor as
    | { setVisibility?: (v: boolean) => void; getVisibility?: () => boolean }
    | undefined;
  const mostrarVolume = modo !== 'superficies';
  if (atorVolume?.setVisibility && atorVolume.getVisibility?.() !== mostrarVolume) {
    atorVolume.setVisibility(mostrarVolume);
  }

  let mapa = porViewport.get(vp.id);
  if (!mapa) {
    mapa = new Map();
    porViewport.set(vp.id, mapa);
  }

  const minhaGeracao = proximaGeracao(vp.id);
  const seg = segmentacaoDaPilha(pilhaId);
  const desejados = new Map<number, Segmento>();
  if (modo !== 'volume' && seg && pilhaId) {
    for (const s of seg.segmentos) {
      if (s.visivel && s.visivel3d && s.opacidade3d > 0) {
        desejados.set(s.indice, s);
      }
    }
  }

  const removerRegs: RegistroAtorSuperficie[] = [];
  for (const [indice, reg] of [...mapa.entries()]) {
    const s = desejados.get(indice);
    if (!s || !pilhaId || reg.uid !== uidSuperficie(pilhaId, indice)) {
      removerRegs.push(reg);
      mapa.delete(indice);
    }
  }

  let pendentes: number[] = [];
  if (pilhaId && desejados.size > 0) {
    if (!permitirReconstrucao) {
      for (const [indice, s] of desejados) {
        const reg = mapa.get(indice);
        if (reg) {
          const prop = reg.actor.getProperty();
          prop.setColor(s.cor[0] / 255, s.cor[1] / 255, s.cor[2] / 255);
          prop.setOpacity(s.opacidade3d);
        }
      }
    } else {
      const emCache = obterSuperficiesEmCache(pilhaId, [...desejados.keys()]);
      pendentes = emCache.pendentes;
      for (const [indice, malha] of emCache.prontas) {
        const s = desejados.get(indice);
        if (s) aplicarAtorMalha(vp, mapa, pilhaId, s, malha, removerRegs);
      }
      for (const idx of pendentes) {
        const reg = mapa.get(idx);
        const s = desejados.get(idx);
        if (reg && s) {
          const prop = reg.actor.getProperty();
          prop.setColor(s.cor[0] / 255, s.cor[1] / 255, s.cor[2] / 255);
          prop.setOpacity(s.opacidade3d);
        }
      }
    }
  }

  removerRegistrosDoViewport(vp, removerRegs);
  vp.render();

  if (permitirReconstrucao && pilhaId && pendentes.length > 0) {
    void superficiesDosSegmentosAsync(pilhaId, pendentes).then((calculadas) => {
      if (geracaoPorViewport.get(vp.id) !== minhaGeracao || pilhasEm3d.get(vp.id) !== pilhaId) return;
      const segAtual = segmentacaoDaPilha(pilhaId);
      const mapaAtual = porViewport.get(vp.id);
      if (!segAtual || !mapaAtual || modoExibicao3d() === 'volume') return;

      const porIdxAtual = new Map(segAtual.segmentos.map((x) => [x.indice, x]));
      const removerAsync: RegistroAtorSuperficie[] = [];
      for (const [indice, malha] of calculadas) {
        const s = porIdxAtual.get(indice);
        if (!s || !s.visivel || !s.visivel3d || s.opacidade3d <= 0) continue;
        aplicarAtorMalha(vp, mapaAtual, pilhaId, s, malha, removerAsync);
      }
      removerRegistrosDoViewport(vp, removerAsync);
      vp.render();
    });
  }
}

/** Remove os atores de superfície ao fechar/recriar o viewport 3D. */
export function limparSuperficiesViewport(vp: Types.IVolumeViewport | undefined, idViewport: string): void {
  proximaGeracao(idViewport);
  const mapa = porViewport.get(idViewport);
  if (mapa && mapa.size > 0) {
    const regs = [...mapa.values()];
    if (vp) removerRegistrosDoViewport(vp, regs);
    else for (const r of regs) liberarRegistro(r);
  }
  const atorVolume = vp?.getDefaultActor()?.actor as { setVisibility?: (v: boolean) => void } | undefined;
  try {
    atorVolume?.setVisibility?.(true);
  } catch {
    /* viewport já desligado */
  }
  porViewport.delete(idViewport);
  pilhasEm3d.delete(idViewport);
  geracaoPorViewport.delete(idViewport);
}
