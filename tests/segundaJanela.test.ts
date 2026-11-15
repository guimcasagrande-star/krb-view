import { describe, expect, it } from 'vitest';
import {
  caminhoSeguroInstancia,
  cantosMundoDaInstancia,
  decidirSincRolagemSlot,
  deveSincronizarJanelaSlot,
  ehModoSecundario,
  encontrarPilhaEnviada,
  filtrarItensNovosParaIndice,
  intersecaoQuadComPlano,
  pilhasExibicaoDaSerie,
  prepararEnvioPilha,
  sanitizarMetasParaCatalogo,
} from '../src/compare/segundaJanelaLogica';
import { analyzeStack } from '../src/io/geometry';
import { buildIndex, type StackNode } from '../src/io/organize';
import type { InstanceMeta } from '../src/io/types';
import { sanear } from '../src/state/preferencias';
import {
  ajustarPontosOrtogonaisAoMoverAlca,
  projetarPontoOrtogonal,
} from '../src/tools/medidasAvancadas';

function meta(p: Partial<InstanceMeta> = {}): InstanceMeta {
  const sop = p.sopInstanceUid ?? '1.2.3.1';
  return {
    fileId: p.fileId ?? `C:/Users/Alice/Paciente_Secreto/${sop}.dcm`,
    sopInstanceUid: sop,
    seriesInstanceUid: p.seriesInstanceUid ?? '1.2.30',
    studyInstanceUid: p.studyInstanceUid ?? '1.2.300',
    patientName: p.patientName ?? 'SILVA^JOAO',
    patientId: p.patientId ?? '998877',
    modality: p.modality ?? 'CT',
    rows: p.rows ?? 512,
    columns: p.columns ?? 512,
    imageType: p.imageType ?? [],
    windowCenter: p.windowCenter ?? [],
    windowWidth: p.windowWidth ?? [],
    imagePositionPatient: p.imagePositionPatient ?? [0, 0, 0],
    imageOrientationPatient: p.imageOrientationPatient ?? [1, 0, 0, 0, 1, 0],
    ...p,
  };
}

function pilhaDe(metas: InstanceMeta[], id = '1.2.30#0'): StackNode {
  return {
    id,
    instances: metas,
    geometry: analyzeStack(metas),
  };
}

describe('segundaJanelaLogica', () => {
  it('identifica modo secundário pela query string ou pelo rótulo da janela Tauri', () => {
    expect(ehModoSecundario('')).toBe(false);
    expect(ehModoSecundario('?janela=principal')).toBe(false);
    expect(ehModoSecundario('?janela=secundaria')).toBe(true);
    expect(ehModoSecundario('', 'secundaria')).toBe(true);
    expect(ehModoSecundario('', 'main')).toBe(false);
  });

  it('gera caminho seguro baseado em UIDs compatível com o PACS e sanitiza UIDs atípicos', () => {
    expect(
      caminhoSeguroInstancia(
        { studyInstanceUid: '1.2.3', seriesInstanceUid: '1.2.3.4', sopInstanceUid: '1.2.3.4.5' },
        0,
      ),
    ).toBe('1.2.3/1.2.3.4/1.2.3.4.5.dcm');

    expect(
      caminhoSeguroInstancia(
        { studyInstanceUid: '../fora', seriesInstanceUid: 'ser/1', sopInstanceUid: '' },
        2,
      ),
    ).not.toContain('..');
  });

  it('sanitiza catálogo de metas removendo nome de paciente e caminho original do disco', () => {
    const m = meta({
      fileId: 'C:/Exames/MARIA_SOUZA/corte1.dcm',
      patientName: 'SOUZA^MARIA',
      sopInstanceUid: '1.2.3.9',
    });
    const limpas = sanitizarMetasParaCatalogo([m]);
    expect(limpas[0]!.patientName).toBeUndefined();
    expect(limpas[0]!.fileId).toBe('1.2.300/1.2.30/1.2.3.9.dcm');
    expect(JSON.stringify(limpas)).not.toContain('MARIA');
  });

  it('prepara envio via BroadcastChannel (File) sem incluir nome de paciente nem caminho do disco', () => {
    const m1 = meta({
      fileId: 'pasta-paciente/JOAO_SILVA/ct1.dcm',
      sopInstanceUid: '1.2.3.1',
      patientName: 'JOAO DA SILVA',
    });
    const m2 = meta({
      fileId: 'pasta-paciente/JOAO_SILVA/ct2.dcm',
      sopInstanceUid: '1.2.3.2',
      patientName: 'JOAO DA SILVA',
    });
    const f1 = new File([new Uint8Array([1, 2])], 'ct1.dcm');
    const f2 = new File([new Uint8Array([3, 4])], 'ct2.dcm');
    const arquivos = new Map<string, File>([
      [m1.fileId, f1],
      [m2.fileId, f2],
    ]);

    const msg = prepararEnvioPilha(pilhaDe([m1, m2]), arquivos);
    expect(msg.tipo).toBe('abrir-serie');
    expect(msg.itens).toHaveLength(2);
    expect(msg.itens[0]!.arquivo).toBe(f1);
    expect(msg.itens[0]!.pacsRelativo).toBeUndefined();
    expect(msg.itens[0]!.caminho).toBe('1.2.300/1.2.30/1.2.3.1.dcm');

    const serializado = JSON.stringify({
      ...msg,
      itens: msg.itens.map((i) => ({ caminho: i.caminho, sopInstanceUid: i.sopInstanceUid })),
    });
    expect(serializado).not.toContain('JOAO');
    expect(serializado).not.toContain('pasta-paciente');
  });

  it('prepara envio via caminho relativo do PACS quando o arquivo já está salvo no disco', () => {
    const m1 = meta({ sopInstanceUid: '1.2.3.10' });
    const caminhoEsperado = '1.2.300/1.2.30/1.2.3.10.dcm';
    const msg = prepararEnvioPilha(pilhaDe([m1]), new Map(), new Set([caminhoEsperado]));

    expect(msg.itens).toEqual([
      {
        caminho: caminhoEsperado,
        sopInstanceUid: '1.2.3.10',
        pacsRelativo: caminhoEsperado,
      },
    ]);
  });

  it('filtra instâncias já carregadas na segunda janela para não duplicar a série', () => {
    const m1 = meta({ sopInstanceUid: '1.2.3.1' });
    const m2 = meta({ sopInstanceUid: '1.2.3.2' });
    const m3 = meta({ sopInstanceUid: '1.2.3.3' });
    const novos = filtrarItensNovosParaIndice(
      [
        { caminho: 'a/b/1.dcm', sopInstanceUid: '1.2.3.1' },
        { caminho: 'a/b/2.dcm', sopInstanceUid: '1.2.3.2' },
        { caminho: 'a/b/3.dcm', sopInstanceUid: '1.2.3.3' },
        { caminho: 'a/b/3dup.dcm', sopInstanceUid: '1.2.3.3' },
      ],
      [m1, m2],
    );
    expect(novos).toEqual([{ caminho: 'a/b/3.dcm', sopInstanceUid: '1.2.3.3' }]);
    expect(m3.sopInstanceUid).toBe('1.2.3.3');
  });

  it('encontra a pilha enviada pelo id exato ou pelo SOP inicial dentro da série', () => {
    const p0 = meta({
      fileId: '1',
      seriesInstanceUid: '1.2.99',
      sopInstanceUid: '1.2.99.1',
      imagePositionPatient: [0, 0, 0],
    });
    const p1 = meta({
      fileId: '2',
      seriesInstanceUid: '1.2.99',
      sopInstanceUid: '1.2.99.2',
      acquisitionNumber: 2,
      imagePositionPatient: [0, 0, 0],
    });
    const index = buildIndex([p0, p1]);
    const pilhaAlvo = index.patients[0]!.studies[0]!.series[0]!.stacks[1]!;

    expect(
      encontrarPilhaEnviada(index, {
        pilhaId: pilhaAlvo.id,
        seriesInstanceUid: '1.2.99',
      }),
    ).toBe(pilhaAlvo);

    expect(
      encontrarPilhaEnviada(index, {
        pilhaId: '1.2.99#5',
        seriesInstanceUid: '1.2.99',
        sopInicial: '1.2.99.2',
      }),
    ).toBe(pilhaAlvo);
  });

  it('decide rolagem por posição em mm entre séries do mesmo estudo/plano e linha de referência em planos ortogonais', () => {
    const msgAxial = {
      tipo: 'sinc-rolagem' as const,
      studyInstanceUid: '1.2.300',
      frameOfReferenceUid: 'FOR-1',
      normal: [0, 0, 1] as [number, number, number],
      posicaoMm: 16,
    };

    // Série PET no mesmo estudo, axial (espessura 4 mm, cortes a cada 4 mm)
    const petAxial = decidirSincRolagemSlot(msgAxial, {
      studyInstanceUid: '1.2.300',
      frameOfReferenceUid: 'FOR-1',
      normal: [0, 0, 1],
      positions: [0, 4, 8, 12, 16, 20],
      sliceThickness: 4,
      ehPilha2d: true,
    });
    expect(petAxial).toEqual({ acao: 'rolar', alvoMm: 16, indiceMaisProximo: 4 });

    // Série Coronal no mesmo estudo -> deve atualizar a linha de referência
    const coronal = decidirSincRolagemSlot(msgAxial, {
      studyInstanceUid: '1.2.300',
      frameOfReferenceUid: 'FOR-1',
      normal: [0, 1, 0],
      positions: [-100, 0, 100],
      sliceThickness: 3,
      ehPilha2d: true,
    });
    expect(coronal).toEqual({ acao: 'linha-referencia' });

    // Estudo diferente -> ignora
    const outroEstudo = decidirSincRolagemSlot(msgAxial, {
      studyInstanceUid: '9.9.999',
      normal: [0, 0, 1],
      positions: [0, 16, 32],
      ehPilha2d: true,
    });
    expect(outroEstudo).toEqual({ acao: 'ignorar' });
  });

  it('calcula interseção 3D de um corte axial com um plano sagital para desenhar a linha de referência', () => {
    const instAxial = meta({
      imagePositionPatient: [-100, -100, 25],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      rows: 200,
      columns: 200,
      pixelSpacing: [1, 1],
    });
    const cantos = cantosMundoDaInstancia(instAxial);
    expect(cantos).not.toBeNull();

    // Plano sagital em x = 0 (normal = [1, 0, 0])
    const seg = intersecaoQuadComPlano(cantos!, [0, 0, 0], [1, 0, 0]);
    expect(seg).not.toBeNull();
    expect(seg![0]).toEqual([0, -100, 25]);
    expect(seg![1]).toEqual([0, 100, 25]);
  });

  it('filtra sincronia de janela/nível apenas para a mesma modalidade', () => {
    expect(deveSincronizarJanelaSlot({ modality: 'CT' }, 'CT')).toBe(true);
    expect(deveSincronizarJanelaSlot({ modality: 'CT' }, 'PT')).toBe(false);
    expect(deveSincronizarJanelaSlot({ modality: 'PT' }, 'PT')).toBe(true);
  });

  it('saneia e persiste preferências de telas, grades padrão (ex.: 2x2 + 1x2), monitor e tela cheia', () => {
    const prefs = sanear({
      telas: {
        gradePrincipal: '2x2',
        gradeSecundaria: '1x2',
        modoTelaPrincipal: 'maximizada',
        modoTelaSecundaria: 'tela-cheia',
        monitorSecundaria: '\\\\.\\DISPLAY2',
        abrirSecundariaAoIniciar: true,
      },
    });
    expect(prefs.telas.gradePrincipal).toBe('2x2');
    expect(prefs.telas.gradeSecundaria).toBe('1x2');
    expect(prefs.telas.modoTelaPrincipal).toBe('maximizada');
    expect(prefs.telas.modoTelaSecundaria).toBe('tela-cheia');
    expect(prefs.telas.monitorSecundaria).toBe('\\\\.\\DISPLAY2');
    expect(prefs.telas.abrirSecundariaAoIniciar).toBe(true);
    expect(prefs.telas.presets.length).toBeGreaterThanOrEqual(4);
  });

  it('saneia os 6 botões favoritos do topo do menu de clique direito e migra ProbeHuSuv para OrthogonalLengths', () => {
    const padrao = sanear({});
    expect(padrao.favoritosMenu).toHaveLength(6);
    expect(padrao.favoritosMenu).toContain('OrthogonalLengths');
    expect(padrao.favoritosMenu).not.toContain('ProbeHuSuv');

    const custom = sanear({
      favoritosMenu: ['Length', 'ProbeHuSuv', 'acao:mpr', 'janela:1', '', 123, 'ExtraIgnorado'],
    });
    expect(custom.favoritosMenu).toHaveLength(6);
    expect(custom.favoritosMenu[0]).toBe('Length');
    expect(custom.favoritosMenu[1]).toBe('OrthogonalLengths');
    expect(custom.favoritosMenu[2]).toBe('acao:mpr');
    expect(custom.favoritosMenu[3]).toBe('janela:1');
    expect(custom.favoritosMenu[4]).toBe(padrao.favoritosMenu[4]);
    expect(custom.favoritosMenu[5]).toBe(padrao.favoritosMenu[5]);
  });

  it('força a 2ª medida das Medidas Ortogonais (90°) a ser perpendicular à 1ª medida ao desenhar e ao mover alças', () => {
    // 1ª medida inclinada a 45° no plano axial: de (0, 0, 10) até (20, 20, 10)
    const p0: [number, number, number] = [0, 0, 10];
    const p1: [number, number, number] = [20, 20, 10];
    const p2: [number, number, number] = [10, 10, 10];
    // Cursor movido para um ponto qualquer fora de 90°: (25, 5, 10)
    const p3Projetado = projetarPontoOrtogonal(p0, p1, p2, [25, 5, 10]);

    const v1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v2 = [p3Projetado[0] - p2[0], p3Projetado[1] - p2[1], p3Projetado[2] - p2[2]];
    const produtoEscalar = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    expect(produtoEscalar).toBeCloseTo(0, 6);
    expect(p3Projetado[2]).toBeCloseTo(10, 6);

    // Ao mover a alça 1 (ponta da 1ª medida), a 2ª medida deve girar mantendo seu comprimento e 90°
    const originais = [p0, p1, p2, p3Projetado];
    const ptsMovidos = [p0, [30, 0, 10] as [number, number, number], p2, [...p3Projetado] as [number, number, number]];
    ajustarPontosOrtogonaisAoMoverAlca(originais, ptsMovidos, 1);

    const nv1 = [ptsMovidos[1][0] - ptsMovidos[0][0], ptsMovidos[1][1] - ptsMovidos[0][1], ptsMovidos[1][2] - ptsMovidos[0][2]];
    const nv2 = [ptsMovidos[3][0] - ptsMovidos[2][0], ptsMovidos[3][1] - ptsMovidos[2][1], ptsMovidos[3][2] - ptsMovidos[2][2]];
    const novoEscalar = nv1[0] * nv2[0] + nv1[1] * nv2[1] + nv1[2] * nv2[2];
    expect(novoEscalar).toBeCloseTo(0, 6);
  });

  it('unifica subpilhas da mesma sequência e plano (ex.: AXI T1_smsp_recon em 5 blocos e perfusão) em uma pilha única', () => {
    // 5 blocos axiais angulados (5 cortes cada = 25 imagens no total, como em RM de coluna por disco)
    const instanciasColuna: InstanceMeta[] = [];
    for (let bloco = 0; bloco < 5; bloco++) {
      const angRad = ((bloco * 4 - 8) * Math.PI) / 180;
      const iop: [number, number, number, number, number, number] = [
        1,
        0,
        0,
        0,
        Math.cos(angRad),
        -Math.sin(angRad),
      ];
      for (let k = 0; k < 5; k++) {
        const num = bloco * 5 + k + 1;
        instanciasColuna.push(
          meta({
            fileId: `smsp/${num}.dcm`,
            sopInstanceUid: `1.2.901.${num}`,
            seriesInstanceUid: '1.2.901',
            seriesNumber: 901,
            modality: 'MR',
            seriesDescription: 'AXI T1_smsp_recon',
            instanceNumber: num,
            pixelSpacing: [0.5, 0.5],
            imageOrientationPatient: iop,
            imagePositionPatient: [0, 0, 100 - num * 3],
          }),
        );
      }
    }

    const index = buildIndex(instanciasColuna);
    const serie = index.patients[0]!.studies[0]!.series[0]!;
    // Internamente splitIntoStacks separa os 5 blocos angulados:
    expect(serie.stacks).toHaveLength(5);

    // Para exibição e rolagem conjunta, pilhasExibicaoDaSerie unifica os 5 blocos axiais em 1 só:
    const exibicao = pilhasExibicaoDaSerie(serie);
    expect(exibicao).toHaveLength(1);
    expect(exibicao[0]!.label).toBeUndefined();
    expect(exibicao[0]!.instances).toHaveLength(25);
    expect(exibicao[0]!.instances.map((i) => i.instanceNumber)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(exibicao[0]!.geometry.issues).toEqual([]);
  });
});
