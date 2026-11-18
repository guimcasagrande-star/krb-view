import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gridFromVolumeProps } from '../src/io/geometry';
import {
  aplicarArquivosNiftiEmEstado,
  aplicarTotalSegmentatorEmEstado,
  lerNifti,
  MAPA_TOTALSEGMENTATOR,
  PRESETS_TOTALSEGMENTATOR,
  traduzirTotalSegmentator,
  type EstadoTotalSegPuro,
} from '../src/segmentation/totalSegmentator';

const idx = (nx: number, ny: number, i: number, j: number, k: number): number =>
  i + j * nx + k * nx * ny;

interface OpcoesNiftiTeste {
  dims: [number, number, number];
  datatype?: number; // 2=uint8, 4=int16, 16=float32
  littleEndian?: boolean;
  voxOffset?: number;
  sclSlope?: number;
  sclInter?: number;
  srowX?: [number, number, number, number];
  srowY?: [number, number, number, number];
  srowZ?: [number, number, number, number];
  dados: number[];
}

/** Constrói um buffer NIfTI-1 válido (cabeçalho de 348/352 bytes + voxels). */
function criarNiftiSintetico(opts: OpcoesNiftiTeste): Uint8Array {
  const [nx, ny, nz] = opts.dims;
  const datatype = opts.datatype ?? 2;
  const le = opts.littleEndian ?? true;
  const voxOffset = opts.voxOffset ?? 352;
  const bytesPorVoxel = datatype === 2 ? 1 : datatype === 4 ? 2 : 4;
  const buf = new Uint8Array(voxOffset + nx * ny * nz * bytesPorVoxel);
  const dv = new DataView(buf.buffer);

  dv.setInt32(0, 348, le); // sizeof_hdr
  dv.setInt16(40, 3, le); // dim[0]
  dv.setInt16(42, nx, le);
  dv.setInt16(44, ny, le);
  dv.setInt16(46, nz, le);
  dv.setInt16(70, datatype, le);
  dv.setFloat32(80, 1.5, le); // pixdim[1]
  dv.setFloat32(84, 1.5, le); // pixdim[2]
  dv.setFloat32(88, 2.5, le); // pixdim[3]
  dv.setFloat32(108, voxOffset, le);
  dv.setFloat32(112, opts.sclSlope ?? 0, le);
  dv.setFloat32(116, opts.sclInter ?? 0, le);

  if (opts.srowX && opts.srowY && opts.srowZ) {
    dv.setInt16(254, 1, le); // sform_code = 1
    for (let c = 0; c < 4; c++) {
      dv.setFloat32(280 + c * 4, opts.srowX[c]!, le);
      dv.setFloat32(296 + c * 4, opts.srowY[c]!, le);
      dv.setFloat32(312 + c * 4, opts.srowZ[c]!, le);
    }
  }

  for (let i = 0; i < opts.dados.length; i++) {
    const pos = voxOffset + i * bytesPorVoxel;
    const v = opts.dados[i]!;
    if (datatype === 2) dv.setUint8(pos, v);
    else if (datatype === 4) dv.setInt16(pos, v, le);
    else if (datatype === 16) dv.setFloat32(pos, v, le);
  }

  return buf;
}

describe('TotalSegmentator e parser NIfTI-1 (fase 10.3)', () => {
  it('traduz IDs numéricos e nomes de arquivo para português com cores anatômicas fixas', () => {
    expect(MAPA_TOTALSEGMENTATOR['1']).toEqual({ nome: 'Baço', cor: [150, 60, 135] });
    expect(traduzirTotalSegmentator(5)).toEqual({ nome: 'Fígado', cor: [165, 75, 65] });
    expect(traduzirTotalSegmentator(52)).toEqual({ nome: 'Aorta', cor: [220, 45, 45] });
    expect(traduzirTotalSegmentator('aorta.nii.gz')).toEqual({ nome: 'Aorta', cor: [220, 45, 45] });
    expect(traduzirTotalSegmentator('pancreas.nii.gz')).toEqual({ nome: 'Pâncreas', cor: [230, 190, 80] });
    expect(traduzirTotalSegmentator('portal_vein_and_splenic_vein.nii.gz')).toEqual({
      nome: 'Veia porta e veia esplênica',
      cor: [50, 115, 220],
    });
    expect(traduzirTotalSegmentator('celiac_trunk.nii.gz')).toEqual({
      nome: 'Tronco celíaco',
      cor: [220, 45, 45],
    });
    expect(traduzirTotalSegmentator('superior_mesenteric_artery.nii.gz')).toEqual({
      nome: 'Artéria mesentérica superior',
      cor: [220, 45, 45],
    });
    expect(traduzirTotalSegmentator('liver.nii.gz')).toEqual({ nome: 'Fígado', cor: [165, 75, 65] });
    expect(traduzirTotalSegmentator('vertebrae_L1.nii.gz')).toEqual({ nome: 'Vértebra L1', cor: [235, 225, 195] });
    expect(traduzirTotalSegmentator('inferior_vena_cava.nii')).toEqual({
      nome: 'Veia cava inferior',
      cor: [50, 115, 220],
    });
    expect(traduzirTotalSegmentator('myocardium.nii.gz')).toEqual({ nome: 'Miocárdio', cor: [200, 55, 80] });
    expect(traduzirTotalSegmentator('liver_segment_1.nii.gz').nome).toBe('Segmento hepático I (caudado)');
    expect(traduzirTotalSegmentator('pleural_effusion.nii.gz').nome).toBe('Derrame pleural');
    expect(traduzirTotalSegmentator('lung_nodules.nii.gz').nome).toBe('Nódulos pulmonares');
    expect(traduzirTotalSegmentator('subcutaneous_fat.nii.gz').nome).toBe('Gordura subcutânea');
    expect(traduzirTotalSegmentator('torso_fat.nii.gz').nome).toBe('Gordura visceral (tronco)');
    expect(traduzirTotalSegmentator('aorta_true_lumen.nii.gz').nome).toBe('Aorta — luz verdadeira');

    expect(PRESETS_TOTALSEGMENTATOR.length).toBeGreaterThanOrEqual(25);
    expect(PRESETS_TOTALSEGMENTATOR.some((p) => p.tarefa === 'liver_segments')).toBe(true);
    expect(PRESETS_TOTALSEGMENTATOR.some((p) => p.tarefa === 'lung_nodules')).toBe(true);
    expect(PRESETS_TOTALSEGMENTATOR.some((p) => p.tarefa === 'tissue_types' && p.requerLicenca)).toBe(true);

    const desconhecido = traduzirTotalSegmentator('/tmp/lesao_alvo_1.nii.gz', 2);
    expect(desconhecido.nome).toBe('Lesao alvo 1');
    expect(desconhecido.cor).toEqual([60, 130, 230]);
  });

  it('lê NIfTI-1 bruto e .nii.gz com múltiplos órgãos e cria os segmentos em português', async () => {
    const dims: [number, number, number] = [4, 4, 3];
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1.5, 1.5, 2.5],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });

    const dados = new Array<number>(4 * 4 * 3).fill(0);
    dados[idx(4, 4, 1, 1, 0)] = 1;  // Baço
    dados[idx(4, 4, 2, 1, 1)] = 5;  // Fígado
    dados[idx(4, 4, 3, 2, 2)] = 52; // Aorta

    const bruto = criarNiftiSintetico({ dims, datatype: 2, dados });
    const comprimido = new Uint8Array(gzipSync(bruto));

    const volBruto = await lerNifti(bruto);
    const volGz = await lerNifti(comprimido);
    expect(volBruto.dims).toEqual(dims);
    expect(volGz.dims).toEqual(dims);
    expect(volGz.rotulos).toEqual(volBruto.rotulos);

    const estado: EstadoTotalSegPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(4 * 4 * 3),
    };

    const resumo = aplicarTotalSegmentatorEmEstado(estado, grid, [{ nome: 'total.nii.gz', volume: volGz }]);
    expect(resumo.importados).toBe(3);
    expect(resumo.nomes).toEqual(['Baço', 'Fígado', 'Aorta']);
    expect(estado.segmentos).toHaveLength(3);

    expect(estado.segmentos[0]).toMatchObject({ indice: 1, nome: 'Baço', cor: [150, 60, 135] });
    expect(estado.segmentos[1]).toMatchObject({ indice: 2, nome: 'Fígado', cor: [165, 75, 65] });
    expect(estado.segmentos[2]).toMatchObject({ indice: 3, nome: 'Aorta', cor: [220, 45, 45] });

    expect(estado.rotulos[idx(4, 4, 1, 1, 0)]).toBe(1);
    expect(estado.rotulos[idx(4, 4, 2, 1, 1)]).toBe(2);
    expect(estado.rotulos[idx(4, 4, 3, 2, 2)]).toBe(3);
  });

  it('importa múltiplos arquivos binários individuais por órgão (ex.: aorta.nii.gz, liver.nii.gz)', async () => {
    const dims: [number, number, number] = [4, 4, 2];
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });

    const dAorta = new Array<number>(32).fill(0);
    dAorta[idx(4, 4, 0, 0, 0)] = 1;
    const dLiver = new Array<number>(32).fill(0);
    dLiver[idx(4, 4, 3, 3, 1)] = 1;

    const vAorta = await lerNifti(new Uint8Array(gzipSync(criarNiftiSintetico({ dims, dados: dAorta }))));
    const vLiver = await lerNifti(new Uint8Array(gzipSync(criarNiftiSintetico({ dims, dados: dLiver }))));

    const estado: EstadoTotalSegPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(32),
    };

    const resumo = aplicarTotalSegmentatorEmEstado(estado, grid, [
      { nome: 'aorta.nii.gz', volume: vAorta },
      { nome: 'liver.nii.gz', volume: vLiver },
    ]);

    expect(resumo.importados).toBe(2);
    expect(resumo.nomes).toEqual(['Aorta', 'Fígado']);
    expect(estado.segmentos[0]).toMatchObject({ nome: 'Aorta', cor: [220, 45, 45] });
    expect(estado.segmentos[1]).toMatchObject({ nome: 'Fígado', cor: [165, 75, 65] });
    expect(estado.rotulos[idx(4, 4, 0, 0, 0)]).toBe(1);
    expect(estado.rotulos[idx(4, 4, 3, 3, 1)]).toBe(2);
  });

  it('suporta big-endian, float32 com scl_slope/scl_inter e inverte eixos conforme sform', async () => {
    const dims: [number, number, number] = [4, 4, 2];
    // Grade DICOM LPS padrão (+X esquerda, +Y posterior, +Z superior)
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });

    // NIfTI em RAS canônico (srow_x=+1, srow_y=+1 -> LPS stepI=-1, stepJ=-1 -> precisa espelhar X e Y)
    const dFloat = new Array<number>(32).fill(-10); // com slope 0.5 e inter 5 => (-10)*0.5 + 5 = 0
    // Voxel em (i=0, j=1, k=0) com valor codificado 94 => 94*0.5 + 5 = 52 (Aorta)
    dFloat[idx(4, 4, 0, 1, 0)] = 94;

    const niftiFloat = await lerNifti(
      criarNiftiSintetico({
        dims,
        datatype: 16,
        littleEndian: false,
        sclSlope: 0.5,
        sclInter: 5,
        srowX: [1, 0, 0, 0],
        srowY: [0, 1, 0, 0],
        srowZ: [0, 0, 1, 0],
        dados: dFloat,
      }),
    );

    const estado: EstadoTotalSegPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(32),
    };

    const resumo = aplicarTotalSegmentatorEmEstado(estado, grid, [{ nome: 'total.nii', volume: niftiFloat }]);
    expect(resumo.nomes).toEqual(['Aorta']);
    // Espelhado: i = 4 - 1 - 0 = 3, j = 4 - 1 - 1 = 2, k = 0
    expect(estado.rotulos[idx(4, 4, 3, 2, 0)]).toBe(1);
    expect(estado.rotulos[idx(4, 4, 0, 1, 0)]).toBe(0);
  });

  it('rejeita cabeçalho NIfTI inválido ou dimensões diferentes da série', async () => {
    await expect(lerNifti(new Uint8Array(100))).rejects.toThrow(/incompleto/i);
    await expect(lerNifti(new Uint8Array(352))).rejects.toThrow(/NIfTI-1 válido/i);

    const nifti = await lerNifti(criarNiftiSintetico({ dims: [4, 4, 2], dados: new Array(32).fill(1) }));
    const gridMaior = gridFromVolumeProps({
      dimensions: [8, 8, 4],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });
    const estado: EstadoTotalSegPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60] }],
      ativo: 1,
      rotulos: new Uint8Array(8 * 8 * 4),
    };
    expect(() => aplicarTotalSegmentatorEmEstado(estado, gridMaior, [{ nome: 'aorta.nii', volume: nifti }])).toThrow(
      /dimensões diferentes/,
    );
  });

  it('processa múltiplos arquivos .nii.gz em streaming liberando os buffers de entrada um por vez', async () => {
    const dims: [number, number, number] = [4, 4, 2];
    const grid = gridFromVolumeProps({
      dimensions: dims,
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    });

    const dSpleen = new Array<number>(32).fill(0);
    dSpleen[idx(4, 4, 1, 0, 0)] = 1;
    const dVazio = new Array<number>(32).fill(0);
    const dPancreas = new Array<number>(32).fill(0);
    dPancreas[idx(4, 4, 2, 3, 1)] = 1;

    const entradas = [
      {
        nome: 'spleen.nii.gz',
        bytes: new Uint8Array(
          gzipSync(
            criarNiftiSintetico({
              dims,
              srowX: [1, 0, 0, 0],
              srowY: [0, 1, 0, 0],
              srowZ: [0, 0, 1, 0],
              dados: dSpleen,
            }),
          ),
        ),
      },
      {
        nome: 'brain.nii.gz',
        bytes: new Uint8Array(gzipSync(criarNiftiSintetico({ dims, dados: dVazio }))),
      },
      {
        nome: 'pancreas.nii.gz',
        bytes: new Uint8Array(gzipSync(criarNiftiSintetico({ dims, dados: dPancreas }))),
      },
    ];

    const estado: EstadoTotalSegPuro = {
      segmentos: [{ indice: 1, nome: 'Segmento 1', cor: [230, 60, 60], bloqueado: false }],
      ativo: 1,
      rotulos: new Uint8Array(32),
    };

    const resumo = await aplicarArquivosNiftiEmEstado(estado, grid, entradas);
    expect(resumo.importados).toBe(2);
    expect(resumo.nomes).toEqual(['Baço', 'Pâncreas']);
    expect(resumo.ignorados).toEqual(['brain.nii.gz (vazio)']);
    // Confirma que os buffers de entrada foram liberados ao longo do streaming
    for (const e of entradas) {
      expect(e.bytes.byteLength).toBe(0);
    }
    // Baço com srow RAS (+X, +Y) espelha i=1->2, j=0->3, k=0
    expect(estado.rotulos[idx(4, 4, 2, 3, 0)]).toBe(1);
    expect(estado.rotulos[idx(4, 4, 2, 3, 1)]).toBe(2);
  });
});
