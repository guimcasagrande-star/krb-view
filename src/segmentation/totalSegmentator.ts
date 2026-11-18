/**
 * Suporte à importação de segmentações NIfTI-1 (.nii / .nii.gz) geradas pelo TotalSegmentator
 * (fase 10.3), 100% local em TypeScript puro (sem bibliotecas externas).
 *
 * Inclui:
 * - Dicionário anatômico completo (`MAPA_TOTALSEGMENTATOR`) para IDs numéricos (1..117) e nomes
 *   de arquivos individuais em inglês, traduzidos para português com cores anatômicas fixas.
 * - Parser NIfTI-1 (`lerNifti`) com descompressão gzip nativa (`DecompressionStream`), suporte
 *   a little/big endian, tipos inteiros/flutuantes, `scl_slope`/`scl_inter` e orientação `sform`/`qform`.
 * - Realinhamento de eixos para a grade DICOM (`realinharParaGradeDicom`) e aplicação pura em estado.
 */

import { dot, type VolumeGrid } from '../io/geometry';
import type { Vec3 } from '../io/types';
import { podeReaproveitarPlaceholder } from './vaso';

export interface InfoTotalSegmentator {
  nome: string;
  cor: [number, number, number];
}

// Cores anatômicas fixas conforme padrão clínico do visualizador
const COR_ARTERIA: [number, number, number] = [220, 45, 45];
const COR_VEIA: [number, number, number] = [50, 115, 220];
const COR_FIGADO: [number, number, number] = [165, 75, 65];
const COR_BACO: [number, number, number] = [150, 60, 135];
const COR_RINS: [number, number, number] = [210, 105, 45];
const COR_PANCREAS: [number, number, number] = [230, 190, 80];
const COR_VESICULA: [number, number, number] = [60, 175, 75];
const COR_TRATO_GI: [number, number, number] = [225, 140, 145];
const COR_PULMAO: [number, number, number] = [130, 195, 235];
const COR_CORACAO: [number, number, number] = [200, 55, 80];
const COR_OSSO: [number, number, number] = [235, 225, 195];
const COR_MUSCULO: [number, number, number] = [185, 85, 75];
const COR_ENCEFALO: [number, number, number] = [240, 180, 185];
const COR_ADRENAL: [number, number, number] = [235, 165, 70];
const COR_BEXIGA: [number, number, number] = [230, 200, 100];
const COR_TIREOIDE: [number, number, number] = [190, 125, 185];
const COR_CARTILAGEM: [number, number, number] = [180, 210, 215];
const COR_CISTO: [number, number, number] = [90, 205, 195];

const PALETA_DESCONHECIDA: Array<[number, number, number]> = [
  [230, 60, 60],
  [60, 180, 90],
  [60, 130, 230],
  [240, 200, 40],
  [200, 80, 220],
  [40, 200, 210],
  [245, 130, 40],
  [150, 110, 60],
];

const CLASSES_POR_ID: ReadonlyArray<readonly [number, string, InfoTotalSegmentator]> = [
  [1, 'spleen', { nome: 'Baço', cor: COR_BACO }],
  [2, 'kidney_right', { nome: 'Rim direito', cor: COR_RINS }],
  [3, 'kidney_left', { nome: 'Rim esquerdo', cor: COR_RINS }],
  [4, 'gallbladder', { nome: 'Vesícula biliar', cor: COR_VESICULA }],
  [5, 'liver', { nome: 'Fígado', cor: COR_FIGADO }],
  [6, 'stomach', { nome: 'Estômago', cor: COR_TRATO_GI }],
  [7, 'pancreas', { nome: 'Pâncreas', cor: COR_PANCREAS }],
  [8, 'adrenal_gland_right', { nome: 'Glândula adrenal direita', cor: COR_ADRENAL }],
  [9, 'adrenal_gland_left', { nome: 'Glândula adrenal esquerda', cor: COR_ADRENAL }],
  [10, 'lung_upper_lobe_left', { nome: 'Lobo superior do pulmão esquerdo', cor: COR_PULMAO }],
  [11, 'lung_lower_lobe_left', { nome: 'Lobo inferior do pulmão esquerdo', cor: COR_PULMAO }],
  [12, 'lung_upper_lobe_right', { nome: 'Lobo superior do pulmão direito', cor: COR_PULMAO }],
  [13, 'lung_middle_lobe_right', { nome: 'Lobo médio do pulmão direito', cor: COR_PULMAO }],
  [14, 'lung_lower_lobe_right', { nome: 'Lobo inferior do pulmão direito', cor: COR_PULMAO }],
  [15, 'esophagus', { nome: 'Esôfago', cor: COR_TRATO_GI }],
  [16, 'trachea', { nome: 'Traqueia', cor: COR_PULMAO }],
  [17, 'thyroid_gland', { nome: 'Tireoide', cor: COR_TIREOIDE }],
  [18, 'small_bowel', { nome: 'Intestino delgado', cor: COR_TRATO_GI }],
  [19, 'duodenum', { nome: 'Duodeno', cor: COR_TRATO_GI }],
  [20, 'colon', { nome: 'Cólon', cor: COR_TRATO_GI }],
  [21, 'urinary_bladder', { nome: 'Bexiga urinária', cor: COR_BEXIGA }],
  [22, 'prostate', { nome: 'Próstata', cor: COR_BEXIGA }],
  [23, 'kidney_cyst_left', { nome: 'Cisto renal esquerdo', cor: COR_CISTO }],
  [24, 'kidney_cyst_right', { nome: 'Cisto renal direito', cor: COR_CISTO }],
  [25, 'sacrum', { nome: 'Sacro', cor: COR_OSSO }],
  [26, 'vertebrae_S1', { nome: 'Vértebra S1', cor: COR_OSSO }],
  [27, 'vertebrae_L5', { nome: 'Vértebra L5', cor: COR_OSSO }],
  [28, 'vertebrae_L4', { nome: 'Vértebra L4', cor: COR_OSSO }],
  [29, 'vertebrae_L3', { nome: 'Vértebra L3', cor: COR_OSSO }],
  [30, 'vertebrae_L2', { nome: 'Vértebra L2', cor: COR_OSSO }],
  [31, 'vertebrae_L1', { nome: 'Vértebra L1', cor: COR_OSSO }],
  [32, 'vertebrae_T12', { nome: 'Vértebra T12', cor: COR_OSSO }],
  [33, 'vertebrae_T11', { nome: 'Vértebra T11', cor: COR_OSSO }],
  [34, 'vertebrae_T10', { nome: 'Vértebra T10', cor: COR_OSSO }],
  [35, 'vertebrae_T9', { nome: 'Vértebra T9', cor: COR_OSSO }],
  [36, 'vertebrae_T8', { nome: 'Vértebra T8', cor: COR_OSSO }],
  [37, 'vertebrae_T7', { nome: 'Vértebra T7', cor: COR_OSSO }],
  [38, 'vertebrae_T6', { nome: 'Vértebra T6', cor: COR_OSSO }],
  [39, 'vertebrae_T5', { nome: 'Vértebra T5', cor: COR_OSSO }],
  [40, 'vertebrae_T4', { nome: 'Vértebra T4', cor: COR_OSSO }],
  [41, 'vertebrae_T3', { nome: 'Vértebra T3', cor: COR_OSSO }],
  [42, 'vertebrae_T2', { nome: 'Vértebra T2', cor: COR_OSSO }],
  [43, 'vertebrae_T1', { nome: 'Vértebra T1', cor: COR_OSSO }],
  [44, 'vertebrae_C7', { nome: 'Vértebra C7', cor: COR_OSSO }],
  [45, 'vertebrae_C6', { nome: 'Vértebra C6', cor: COR_OSSO }],
  [46, 'vertebrae_C5', { nome: 'Vértebra C5', cor: COR_OSSO }],
  [47, 'vertebrae_C4', { nome: 'Vértebra C4', cor: COR_OSSO }],
  [48, 'vertebrae_C3', { nome: 'Vértebra C3', cor: COR_OSSO }],
  [49, 'vertebrae_C2', { nome: 'Vértebra C2', cor: COR_OSSO }],
  [50, 'vertebrae_C1', { nome: 'Vértebra C1', cor: COR_OSSO }],
  [51, 'heart', { nome: 'Coração', cor: COR_CORACAO }],
  [52, 'aorta', { nome: 'Aorta', cor: COR_ARTERIA }],
  [53, 'pulmonary_vein', { nome: 'Veia pulmonar', cor: COR_VEIA }],
  [54, 'brachiocephalic_trunk', { nome: 'Tronco braquiocefálico', cor: COR_ARTERIA }],
  [55, 'subclavian_artery_right', { nome: 'Artéria subclávia direita', cor: COR_ARTERIA }],
  [56, 'subclavian_artery_left', { nome: 'Artéria subclávia esquerda', cor: COR_ARTERIA }],
  [57, 'common_carotid_artery_right', { nome: 'Artéria carótida comum direita', cor: COR_ARTERIA }],
  [58, 'common_carotid_artery_left', { nome: 'Artéria carótida comum esquerda', cor: COR_ARTERIA }],
  [59, 'brachiocephalic_vein_left', { nome: 'Veia braquiocefálica esquerda', cor: COR_VEIA }],
  [60, 'brachiocephalic_vein_right', { nome: 'Veia braquiocefálica direita', cor: COR_VEIA }],
  [61, 'atrial_appendage_left', { nome: 'Aurícula esquerda', cor: COR_CORACAO }],
  [62, 'superior_vena_cava', { nome: 'Veia cava superior', cor: COR_VEIA }],
  [63, 'inferior_vena_cava', { nome: 'Veia cava inferior', cor: COR_VEIA }],
  [64, 'portal_vein_and_splenic_vein', { nome: 'Veia porta e veia esplênica', cor: COR_VEIA }],
  [65, 'iliac_artery_left', { nome: 'Artéria ilíaca esquerda', cor: COR_ARTERIA }],
  [66, 'iliac_artery_right', { nome: 'Artéria ilíaca direita', cor: COR_ARTERIA }],
  [67, 'iliac_vena_left', { nome: 'Veia ilíaca esquerda', cor: COR_VEIA }],
  [68, 'iliac_vena_right', { nome: 'Veia ilíaca direita', cor: COR_VEIA }],
  [69, 'humerus_left', { nome: 'Úmero esquerdo', cor: COR_OSSO }],
  [70, 'humerus_right', { nome: 'Úmero direito', cor: COR_OSSO }],
  [71, 'scapula_left', { nome: 'Escápula esquerda', cor: COR_OSSO }],
  [72, 'scapula_right', { nome: 'Escápula direita', cor: COR_OSSO }],
  [73, 'clavicula_left', { nome: 'Clavícula esquerda', cor: COR_OSSO }],
  [74, 'clavicula_right', { nome: 'Clavícula direita', cor: COR_OSSO }],
  [75, 'femur_left', { nome: 'Fêmur esquerdo', cor: COR_OSSO }],
  [76, 'femur_right', { nome: 'Fêmur direito', cor: COR_OSSO }],
  [77, 'hip_left', { nome: 'Ilíaco esquerdo', cor: COR_OSSO }],
  [78, 'hip_right', { nome: 'Ilíaco direito', cor: COR_OSSO }],
  [79, 'spinal_cord', { nome: 'Medula espinal', cor: COR_ENCEFALO }],
  [80, 'gluteus_maximus_left', { nome: 'Glúteo máximo esquerdo', cor: COR_MUSCULO }],
  [81, 'gluteus_maximus_right', { nome: 'Glúteo máximo direito', cor: COR_MUSCULO }],
  [82, 'gluteus_medius_left', { nome: 'Glúteo médio esquerdo', cor: COR_MUSCULO }],
  [83, 'gluteus_medius_right', { nome: 'Glúteo médio direito', cor: COR_MUSCULO }],
  [84, 'gluteus_minimus_left', { nome: 'Glúteo mínimo esquerdo', cor: COR_MUSCULO }],
  [85, 'gluteus_minimus_right', { nome: 'Glúteo mínimo direito', cor: COR_MUSCULO }],
  [86, 'autochthon_left', { nome: 'Musculatura paravertebral esquerda', cor: COR_MUSCULO }],
  [87, 'autochthon_right', { nome: 'Musculatura paravertebral direita', cor: COR_MUSCULO }],
  [88, 'iliopsoas_left', { nome: 'Iliopsoas esquerdo', cor: COR_MUSCULO }],
  [89, 'iliopsoas_right', { nome: 'Iliopsoas direito', cor: COR_MUSCULO }],
  [90, 'brain', { nome: 'Encéfalo', cor: COR_ENCEFALO }],
  [91, 'skull', { nome: 'Crânio', cor: COR_OSSO }],
  [92, 'rib_left_1', { nome: '1ª costela esquerda', cor: COR_OSSO }],
  [93, 'rib_left_2', { nome: '2ª costela esquerda', cor: COR_OSSO }],
  [94, 'rib_left_3', { nome: '3ª costela esquerda', cor: COR_OSSO }],
  [95, 'rib_left_4', { nome: '4ª costela esquerda', cor: COR_OSSO }],
  [96, 'rib_left_5', { nome: '5ª costela esquerda', cor: COR_OSSO }],
  [97, 'rib_left_6', { nome: '6ª costela esquerda', cor: COR_OSSO }],
  [98, 'rib_left_7', { nome: '7ª costela esquerda', cor: COR_OSSO }],
  [99, 'rib_left_8', { nome: '8ª costela esquerda', cor: COR_OSSO }],
  [100, 'rib_left_9', { nome: '9ª costela esquerda', cor: COR_OSSO }],
  [101, 'rib_left_10', { nome: '10ª costela esquerda', cor: COR_OSSO }],
  [102, 'rib_left_11', { nome: '11ª costela esquerda', cor: COR_OSSO }],
  [103, 'rib_left_12', { nome: '12ª costela esquerda', cor: COR_OSSO }],
  [104, 'rib_right_1', { nome: '1ª costela direita', cor: COR_OSSO }],
  [105, 'rib_right_2', { nome: '2ª costela direita', cor: COR_OSSO }],
  [106, 'rib_right_3', { nome: '3ª costela direita', cor: COR_OSSO }],
  [107, 'rib_right_4', { nome: '4ª costela direita', cor: COR_OSSO }],
  [108, 'rib_right_5', { nome: '5ª costela direita', cor: COR_OSSO }],
  [109, 'rib_right_6', { nome: '6ª costela direita', cor: COR_OSSO }],
  [110, 'rib_right_7', { nome: '7ª costela direita', cor: COR_OSSO }],
  [111, 'rib_right_8', { nome: '8ª costela direita', cor: COR_OSSO }],
  [112, 'rib_right_9', { nome: '9ª costela direita', cor: COR_OSSO }],
  [113, 'rib_right_10', { nome: '10ª costela direita', cor: COR_OSSO }],
  [114, 'rib_right_11', { nome: '11ª costela direita', cor: COR_OSSO }],
  [115, 'rib_right_12', { nome: '12ª costela direita', cor: COR_OSSO }],
  [116, 'sternum', { nome: 'Esterno', cor: COR_OSSO }],
  [117, 'costal_cartilages', { nome: 'Cartilagens costais', cor: COR_CARTILAGEM }],
];

const EXTRAS_POR_NOME: ReadonlyArray<readonly [string, InfoTotalSegmentator]> = [
  ['myocardium', { nome: 'Miocárdio', cor: COR_CORACAO }],
  ['heart_myocardium', { nome: 'Miocárdio', cor: COR_CORACAO }],
  ['atrium_left', { nome: 'Átrio esquerdo', cor: COR_CORACAO }],
  ['heart_atrium_left', { nome: 'Átrio esquerdo', cor: COR_CORACAO }],
  ['ventricle_left', { nome: 'Ventrículo esquerdo', cor: COR_CORACAO }],
  ['heart_ventricle_left', { nome: 'Ventrículo esquerdo', cor: COR_CORACAO }],
  ['atrium_right', { nome: 'Átrio direito', cor: COR_CORACAO }],
  ['heart_atrium_right', { nome: 'Átrio direito', cor: COR_CORACAO }],
  ['ventricle_right', { nome: 'Ventrículo direito', cor: COR_CORACAO }],
  ['heart_ventricle_right', { nome: 'Ventrículo direito', cor: COR_CORACAO }],
  ['pulmonary_artery', { nome: 'Artéria pulmonar', cor: COR_ARTERIA }],
  ['celiac_trunk', { nome: 'Tronco celíaco', cor: COR_ARTERIA }],
  ['superior_mesenteric_artery', { nome: 'Artéria mesentérica superior', cor: COR_ARTERIA }],
  ['lung_vessels', { nome: 'Vasos pulmonares', cor: COR_ARTERIA }],
  ['lung_trachea_bronchia', { nome: 'Traqueia e brônquios', cor: COR_PULMAO }],
  ['lung_airways', { nome: 'Vias aéreas pulmonares', cor: COR_PULMAO }],
  ['lung_airways_wall', { nome: 'Parede brônquica', cor: COR_PULMAO }],
  ['lung_arteries', { nome: 'Artérias pulmonares', cor: COR_ARTERIA }],
  ['lung_veins', { nome: 'Veias pulmonares', cor: COR_VEIA }],
  ['lung', { nome: 'Pulmões', cor: COR_PULMAO }],
  ['lung_nodules', { nome: 'Nódulos pulmonares', cor: [245, 95, 65] }],
  ['lung_pleural', { nome: 'Cavidade pleural', cor: COR_PULMAO }],
  ['pleural_effusion', { nome: 'Derrame pleural', cor: [75, 175, 235] }],
  ['pericardial_effusion', { nome: 'Derrame pericárdico', cor: [110, 150, 240] }],
  ['liver_vessels', { nome: 'Vasos hepáticos', cor: COR_VEIA }],
  ['liver_tumor', { nome: 'Tumor hepático', cor: [245, 95, 65] }],
  ['liver_lesions', { nome: 'Lesões hepáticas', cor: [245, 95, 65] }],
  ['liver_segment_1', { nome: 'Segmento hepático I (caudado)', cor: [185, 85, 70] }],
  ['liver_segment_2', { nome: 'Segmento hepático II', cor: [205, 95, 75] }],
  ['liver_segment_3', { nome: 'Segmento hepático III', cor: [220, 115, 80] }],
  ['liver_segment_4', { nome: 'Segmento hepático IV', cor: [195, 125, 65] }],
  ['liver_segment_5', { nome: 'Segmento hepático V', cor: [165, 95, 75] }],
  ['liver_segment_6', { nome: 'Segmento hepático VI', cor: [150, 80, 70] }],
  ['liver_segment_7', { nome: 'Segmento hepático VII', cor: [175, 70, 65] }],
  ['liver_segment_8', { nome: 'Segmento hepático VIII', cor: [210, 85, 65] }],
  ['subcutaneous_fat', { nome: 'Gordura subcutânea', cor: [240, 210, 95] }],
  ['torso_fat', { nome: 'Gordura visceral (tronco)', cor: [245, 165, 55] }],
  ['skeletal_muscle', { nome: 'Músculo esquelético', cor: COR_MUSCULO }],
  ['aorta_true_lumen', { nome: 'Aorta — luz verdadeira', cor: COR_ARTERIA }],
  ['aorta_false_lumen', { nome: 'Aorta — luz falsa', cor: [245, 145, 50] }],
  ['renal_arteries', { nome: 'Artérias renais', cor: COR_ARTERIA }],
  ['coronary_arteries', { nome: 'Artérias coronárias', cor: COR_ARTERIA }],
  ['intracerebral_hemorrhage', { nome: 'Hemorragia intracerebral', cor: [235, 50, 60] }],
  ['breast', { nome: 'Mamas', cor: [235, 165, 185] }],
  ['psoas_major_right', { nome: 'Psoas maior direito', cor: COR_MUSCULO }],
  ['psoas_major_left', { nome: 'Psoas maior esquerdo', cor: COR_MUSCULO }],
  ['rectus_abdominis_right', { nome: 'Reto abdominal direito', cor: COR_MUSCULO }],
  ['rectus_abdominis_left', { nome: 'Reto abdominal esquerdo', cor: COR_MUSCULO }],
  ['external_oblique_right', { nome: 'Oblíquo externo direito', cor: COR_MUSCULO }],
  ['external_oblique_left', { nome: 'Oblíquo externo esquerdo', cor: COR_MUSCULO }],
  ['internal_oblique_right', { nome: 'Oblíquo interno direito', cor: COR_MUSCULO }],
  ['internal_oblique_left', { nome: 'Oblíquo interno esquerdo', cor: COR_MUSCULO }],
  ['quadratus_lumborum_right', { nome: 'Quadrado lombar direito', cor: COR_MUSCULO }],
  ['quadratus_lumborum_left', { nome: 'Quadrado lombar esquerdo', cor: COR_MUSCULO }],
  ['erector_spinae_right', { nome: 'Eretor da espinha direito', cor: COR_MUSCULO }],
  ['erector_spinae_left', { nome: 'Eretor da espinha esquerdo', cor: COR_MUSCULO }],
  ['body_trunc', { nome: 'Tronco corporal', cor: COR_MUSCULO }],
  ['body_extremities', { nome: 'Extremidades corporais', cor: COR_MUSCULO }],
];

/**
 * Dicionário anatômico do TotalSegmentator (v1/v2):
 * indexa tanto IDs numéricos (`1..117`) quanto nomes em inglês em minúsculas.
 */
export const MAPA_TOTALSEGMENTATOR: Readonly<Record<string, InfoTotalSegmentator>> = (() => {
  const mapa: Record<string, InfoTotalSegmentator> = {};
  for (const [id, chave, info] of CLASSES_POR_ID) {
    mapa[String(id)] = info;
    mapa[chave.toLowerCase()] = info;
  }
  for (const [chave, info] of EXTRAS_POR_NOME) {
    mapa[chave.toLowerCase()] = info;
  }
  return mapa;
})();

/** Extrai o nome-base sem pasta nem extensão `.nii` / `.nii.gz`. */
export function extrairChaveArquivoNifti(nomeArquivo: string): string {
  const base = nomeArquivo.split(/[/\\]/).pop() ?? nomeArquivo;
  return base.replace(/\.nii(\.gz)?$/i, '').replace(/\.gz$/i, '').trim();
}

function formatarNomeDesconhecido(chave: string): string {
  const limpo = chave.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return 'Segmento importado';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/** Traduz um ID numérico ou nome de arquivo do TotalSegmentator para nome em português e cor fixa. */
export function traduzirTotalSegmentator(chave: number | string, indicePaleta = 0): InfoTotalSegmentator {
  const texto = typeof chave === 'number' ? String(chave) : extrairChaveArquivoNifti(chave);
  const achado = MAPA_TOTALSEGMENTATOR[texto.toLowerCase()];
  if (achado) {
    return { nome: achado.nome, cor: [...achado.cor] as [number, number, number] };
  }
  const cor = PALETA_DESCONHECIDA[Math.abs(indicePaleta) % PALETA_DESCONHECIDA.length]!;
  return {
    nome: typeof chave === 'number' ? `Estrutura ${chave}` : formatarNomeDesconhecido(texto),
    cor: [...cor] as [number, number, number],
  };
}

// ---------------------------------------------------------------------------
// Parser NIfTI-1 puro (.nii e .nii.gz)
// ---------------------------------------------------------------------------

export interface OrientacaoNiftiLps {
  origin: Vec3;
  stepI: Vec3;
  stepJ: Vec3;
  stepK: Vec3;
}

export interface VolumeNifti {
  dims: [number, number, number];
  spacing: [number, number, number];
  datatype: number;
  voxOffset: number;
  sclSlope: number;
  sclInter: number;
  /** Rótulos inteiros arredondados (ordem `i + j*nx + k*nx*ny`). */
  rotulos: Uint8Array | Uint16Array;
  /** Vetores de passo e origem convertidos de NIfTI RAS para DICOM LPS, quando `sform`/`qform` > 0. */
  orientacaoLps?: OrientacaoNiftiLps;
}

const TAMANHOS_DATATYPE: Record<number, number> = {
  2: 1,   // uint8
  4: 2,   // int16
  8: 4,   // int32
  16: 4,  // float32
  64: 8,  // float64
  256: 1, // int8
  512: 2, // uint16
  768: 4, // uint32
};

async function descompactarGzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const resposta = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await resposta.arrayBuffer());
  }
  throw new Error('Descompressão gzip indisponível neste ambiente.');
}

function matrizQuaternariaParaLps(dv: DataView, le: boolean, spacing: [number, number, number]): OrientacaoNiftiLps {
  const pixdim0 = dv.getFloat32(76, le);
  const qfac = pixdim0 < 0 ? -1 : 1;
  const b = dv.getFloat32(256, le);
  const c = dv.getFloat32(260, le);
  const d = dv.getFloat32(264, le);
  const qx = dv.getFloat32(268, le);
  const qy = dv.getFloat32(272, le);
  const qz = dv.getFloat32(276, le);
  const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));

  const r00 = a * a + b * b - c * c - d * d;
  const r01 = 2 * (b * c - a * d);
  const r02 = 2 * (b * d + a * c) * qfac;

  const r10 = 2 * (b * c + a * d);
  const r11 = a * a + c * c - b * b - d * d;
  const r12 = 2 * (c * d - a * b) * qfac;

  const r20 = 2 * (b * d - a * c);
  const r21 = 2 * (c * d + a * b);
  const r22 = (a * a + d * d - c * c - b * b) * qfac;

  // RAS -> LPS inverte os eixos X e Y
  return {
    origin: [-qx, -qy, qz],
    stepI: [-r00 * spacing[0], -r10 * spacing[0], r20 * spacing[0]],
    stepJ: [-r01 * spacing[1], -r11 * spacing[1], r21 * spacing[1]],
    stepK: [-r02 * spacing[2], -r12 * spacing[2], r22 * spacing[2]],
  };
}

function lerOrientacaoLps(
  dv: DataView,
  le: boolean,
  spacing: [number, number, number],
): OrientacaoNiftiLps | undefined {
  const qformCode = dv.getInt16(252, le);
  const sformCode = dv.getInt16(254, le);
  if (sformCode > 0) {
    const sx = [dv.getFloat32(280, le), dv.getFloat32(284, le), dv.getFloat32(288, le), dv.getFloat32(292, le)] as const;
    const sy = [dv.getFloat32(296, le), dv.getFloat32(300, le), dv.getFloat32(304, le), dv.getFloat32(308, le)] as const;
    const sz = [dv.getFloat32(312, le), dv.getFloat32(316, le), dv.getFloat32(320, le), dv.getFloat32(324, le)] as const;
    // RAS -> LPS inverte X e Y
    return {
      origin: [-sx[3], -sy[3], sz[3]],
      stepI: [-sx[0], -sy[0], sz[0]],
      stepJ: [-sx[1], -sy[1], sz[1]],
      stepK: [-sx[2], -sy[2], sz[2]],
    };
  }
  if (qformCode > 0) {
    return matrizQuaternariaParaLps(dv, le, spacing);
  }
  return undefined;
}

/**
 * Lê um arquivo NIfTI-1 (`.nii` ou `.nii.gz`) em TypeScript puro e devolve os rótulos
 * inteiros em `Uint16Array`, junto às dimensões, espaçamento e orientação em LPS.
 */
export async function lerNifti(bytes: Uint8Array): Promise<VolumeNifti> {
  const bruto =
    bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? await descompactarGzip(bytes) : bytes;

  if (bruto.byteLength < 348) {
    throw new Error('O arquivo NIfTI está incompleto (cabeçalho menor que 348 bytes).');
  }

  const dv = new DataView(bruto.buffer, bruto.byteOffset, bruto.byteLength);
  let le = true;
  if (dv.getInt32(0, true) === 348) le = true;
  else if (dv.getInt32(0, false) === 348) le = false;
  else throw new Error('O arquivo não é um NIfTI-1 válido (sizeof_hdr ≠ 348).');

  const nx = dv.getInt16(42, le);
  const ny = dv.getInt16(44, le);
  const nz = dv.getInt16(46, le);
  if (nx <= 0 || ny <= 0 || nz <= 0) {
    throw new Error(`Dimensões NIfTI inválidas (${nx}×${ny}×${nz}).`);
  }

  const datatype = dv.getInt16(70, le);
  const bytesPorVoxel = TAMANHOS_DATATYPE[datatype];
  if (!bytesPorVoxel) {
    throw new Error(`Tipo de dado NIfTI não suportado (datatype=${datatype}).`);
  }

  const sx = Math.abs(dv.getFloat32(80, le)) || 1;
  const sy = Math.abs(dv.getFloat32(84, le)) || 1;
  const sz = Math.abs(dv.getFloat32(88, le)) || 1;
  const spacing: [number, number, number] = [sx, sy, sz];

  const voxOffsetRaw = dv.getFloat32(108, le);
  const voxOffset = Number.isFinite(voxOffsetRaw) && voxOffsetRaw >= 352 ? Math.floor(voxOffsetRaw) : 352;
  const totalVoxels = nx * ny * nz;
  if (voxOffset + totalVoxels * bytesPorVoxel > bruto.byteLength) {
    throw new Error('Os dados de voxels do arquivo NIfTI estão truncados.');
  }

  const slopeBruto = dv.getFloat32(112, le);
  const interBruto = dv.getFloat32(116, le);
  const usarEscala = Number.isFinite(slopeBruto) && slopeBruto !== 0;
  const sclSlope = usarEscala ? slopeBruto : 1;
  const sclInter = usarEscala && Number.isFinite(interBruto) ? interBruto : 0;

  let rotulos: Uint8Array | Uint16Array;
  if (datatype === 2 && sclSlope === 1 && sclInter === 0) {
    // Máscaras uint8 sem fator de escala reutilizam o próprio buffer descompactado (zero-copy).
    rotulos = bruto.subarray(voxOffset, voxOffset + totalVoxels);
  } else {
    rotulos = new Uint16Array(totalVoxels);
    for (let i = 0; i < totalVoxels; i++) {
      const pos = voxOffset + i * bytesPorVoxel;
      let val = 0;
      switch (datatype) {
        case 2:
          val = dv.getUint8(pos);
          break;
        case 4:
          val = dv.getInt16(pos, le);
          break;
        case 8:
          val = dv.getInt32(pos, le);
          break;
        case 16:
          val = dv.getFloat32(pos, le);
          break;
        case 64:
          val = dv.getFloat64(pos, le);
          break;
        case 256:
          val = dv.getInt8(pos);
          break;
        case 512:
          val = dv.getUint16(pos, le);
          break;
        case 768:
          val = dv.getUint32(pos, le);
          break;
      }
      const escalado = usarEscala ? val * sclSlope + sclInter : val;
      rotulos[i] = escalado > 0 && Number.isFinite(escalado) ? Math.min(65535, Math.round(escalado)) : 0;
    }
  }

  return {
    dims: [nx, ny, nz],
    spacing,
    datatype,
    voxOffset,
    sclSlope,
    sclInter,
    rotulos,
    orientacaoLps: lerOrientacaoLps(dv, le, spacing),
  };
}

/**
 * Confere dimensões e inverte os eixos X/Y/Z quando a orientação do NIfTI (`sform`/`qform`)
 * tiver sentido oposto ao da grade do volume DICOM no Cornerstone.
 */
export function realinharParaGradeDicom(nifti: VolumeNifti, grid: VolumeGrid): Uint8Array | Uint16Array {
  const [nx, ny, nz] = nifti.dims;
  const [gx, gy, gz] = grid.dims;
  if (nx !== gx || ny !== gy || nz !== gz) {
    throw new Error(
      `A máscara NIfTI (${nx}×${ny}×${nz}) tem dimensões diferentes da série aberta (${gx}×${gy}×${gz}).`,
    );
  }
  const ori = nifti.orientacaoLps;
  const invI = ori ? dot(ori.stepI, grid.stepI) < 0 : false;
  const invJ = ori ? dot(ori.stepJ, grid.stepJ) < 0 : false;
  const invK = ori ? dot(ori.stepK, grid.stepK) < 0 : false;
  if (!invI && !invJ && !invK) return nifti.rotulos;

  const porCorte = nx * ny;
  const saida =
    nifti.rotulos instanceof Uint8Array
      ? new Uint8Array(nifti.rotulos.length)
      : new Uint16Array(nifti.rotulos.length);
  for (let k = 0; k < nz; k++) {
    const sk = invK ? nz - 1 - k : k;
    for (let j = 0; j < ny; j++) {
      const sj = invJ ? ny - 1 - j : j;
      for (let i = 0; i < nx; i++) {
        const si = invI ? nx - 1 - i : i;
        saida[i + j * nx + k * porCorte] = nifti.rotulos[si + sj * nx + sk * porCorte]!;
      }
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Aplicação pura em estado (reaproveitada por `segmentacao.ts` e testável no Node)
// ---------------------------------------------------------------------------

export interface SegmentoTotalSeg {
  indice: number;
  nome: string;
  cor: [number, number, number];
  bloqueado?: boolean;
}

export interface EstadoTotalSegPuro {
  segmentos: SegmentoTotalSeg[];
  ativo: number;
  rotulos: Uint8Array;
}

export interface ResumoImportacaoTotalSeg {
  importados: number;
  nomes: string[];
  ignorados: string[];
}

const NOMES_GENERICOS_MULTILABEL = new Set([
  'total',
  'totalsegmentator',
  'seg',
  'segs',
  'segmentation',
  'segmentations',
  'label',
  'labels',
  'labelmap',
  'mask',
  'masks',
]);

function garantirAlvo(
  estado: EstadoTotalSegPuro,
  info: InfoTotalSegmentator,
  jaTinhaVoxels: boolean,
): { alvo?: SegmentoTotalSeg; limiteAtingido: boolean } {
  const existente = estado.segmentos.find((s) => s.nome.trim().toLowerCase() === info.nome.trim().toLowerCase());
  if (existente) {
    existente.cor = [...info.cor] as [number, number, number];
    estado.ativo = existente.indice;
    return { alvo: existente, limiteAtingido: false };
  }
  if (podeReaproveitarPlaceholder(estado.segmentos, jaTinhaVoxels)) {
    const primeiro = estado.segmentos[0]!;
    primeiro.nome = info.nome;
    primeiro.cor = [...info.cor] as [number, number, number];
    estado.ativo = primeiro.indice;
    return { alvo: primeiro, limiteAtingido: false };
  }
  const usado = new Set(estado.segmentos.map((s) => s.indice));
  let indice = 1;
  while (usado.has(indice) && indice <= 255) indice++;
  if (indice > 255) return { limiteAtingido: true };
  const novo: SegmentoTotalSeg = {
    indice,
    nome: info.nome,
    cor: [...info.cor] as [number, number, number],
    bloqueado: false,
  };
  estado.segmentos.push(novo);
  estado.ativo = indice;
  return { alvo: novo, limiteAtingido: false };
}

/**
 * Aplica um ou mais volumes NIfTI do TotalSegmentator (um arquivo multilabel com IDs `> 0`
 * ou múltiplos arquivos binários por órgão) sobre a lista de segmentos e o buffer de rótulos,
 * realinhando os eixos diretamente na escrita sem alocar um segundo buffer 3D intermediário.
 */
export function aplicarTotalSegmentatorEmEstado(
  estado: EstadoTotalSegPuro,
  grid: VolumeGrid,
  arquivos: Array<{ nome: string; volume: VolumeNifti }>,
): ResumoImportacaoTotalSeg {
  const nomesImportados: string[] = [];
  const ignorados: string[] = [];
  const bloqueados = new Set(estado.segmentos.filter((s) => s.bloqueado).map((s) => s.indice));
  let jaTinhaVoxels = estado.rotulos.some((v) => v !== 0);
  const [gx, gy, gz] = grid.dims;

  for (const arq of arquivos) {
    const [nx, ny, nz] = arq.volume.dims;
    if (nx !== gx || ny !== gy || nz !== gz) {
      throw new Error(
        `A máscara NIfTI (${nx}×${ny}×${nz}) tem dimensões diferentes da série aberta (${gx}×${gy}×${gz}).`,
      );
    }

    const bruto = arq.volume.rotulos;
    const idsPresentes = new Set<number>();
    for (let i = 0; i < bruto.length; i++) {
      const v = bruto[i]!;
      if (v > 0) idsPresentes.add(v);
    }
    if (idsPresentes.size === 0) {
      ignorados.push(`${arq.nome} (vazio)`);
      continue;
    }

    const chaveArquivo = extrairChaveArquivoNifti(arq.nome);
    const ehBinarioPorNome =
      idsPresentes.size === 1 &&
      idsPresentes.has(1) &&
      chaveArquivo.length > 0 &&
      !NOMES_GENERICOS_MULTILABEL.has(chaveArquivo.toLowerCase());

    const idsOrdenados = [...idsPresentes].sort((a, b) => a - b);
    const mapaIdParaSeg = new Map<number, { indice: number; nome: string }>();
    for (const idNifti of idsOrdenados) {
      const info = ehBinarioPorNome
        ? traduzirTotalSegmentator(chaveArquivo, estado.segmentos.length)
        : traduzirTotalSegmentator(idNifti, estado.segmentos.length);

      const { alvo, limiteAtingido } = garantirAlvo(estado, info, jaTinhaVoxels);
      if (limiteAtingido || !alvo) {
        ignorados.push(`${info.nome} (limite de 255 segmentos)`);
        continue;
      }
      jaTinhaVoxels = true;
      mapaIdParaSeg.set(idNifti, { indice: alvo.indice, nome: alvo.nome });
    }

    if (mapaIdParaSeg.size === 0) continue;

    const ori = arq.volume.orientacaoLps;
    const invI = ori ? dot(ori.stepI, grid.stepI) < 0 : false;
    const invJ = ori ? dot(ori.stepJ, grid.stepJ) < 0 : false;
    const invK = ori ? dot(ori.stepK, grid.stepK) < 0 : false;
    const pintadosPorSeg = new Set<string>();

    // Grava todos os órgãos do arquivo NIfTI em uma única passada sem alocar cópia de realinhamento.
    if (!invI && !invJ && !invK) {
      for (let i = 0; i < bruto.length; i++) {
        const v = bruto[i]!;
        if (v === 0) continue;
        const destino = mapaIdParaSeg.get(v);
        if (!destino) continue;
        const atual = estado.rotulos[i]!;
        if (atual !== 0 && atual !== destino.indice && bloqueados.has(atual)) continue;
        estado.rotulos[i] = destino.indice;
        pintadosPorSeg.add(destino.nome);
      }
    } else {
      const porCorte = nx * ny;
      let srcIdx = 0;
      for (let sk = 0; sk < nz; sk++) {
        const dk = invK ? nz - 1 - sk : sk;
        const baseDstK = dk * porCorte;
        for (let sj = 0; sj < ny; sj++) {
          const dj = invJ ? ny - 1 - sj : sj;
          const baseDstJK = baseDstK + dj * nx;
          for (let si = 0; si < nx; si++, srcIdx++) {
            const v = bruto[srcIdx]!;
            if (v === 0) continue;
            const destino = mapaIdParaSeg.get(v);
            if (!destino) continue;
            const di = invI ? nx - 1 - si : si;
            const dstIdx = baseDstJK + di;
            const atual = estado.rotulos[dstIdx]!;
            if (atual !== 0 && atual !== destino.indice && bloqueados.has(atual)) continue;
            estado.rotulos[dstIdx] = destino.indice;
            pintadosPorSeg.add(destino.nome);
          }
        }
      }
    }

    for (const nome of pintadosPorSeg) {
      if (!nomesImportados.includes(nome)) nomesImportados.push(nome);
    }
  }

  return {
    importados: nomesImportados.length,
    nomes: nomesImportados,
    ignorados,
  };
}

/**
 * Descompacta e aplica uma lista de arquivos NIfTI (`.nii` / `.nii.gz`) sobre `estado`
 * um por vez (em streaming), liberando o buffer de cada arquivo imediatamente após aplicá-lo
 * para evitar estouro de `ArrayBuffer` quando há dezenas/centenas de órgãos (ex.: 117 estruturas).
 */
export async function aplicarArquivosNiftiEmEstado(
  estado: EstadoTotalSegPuro,
  grid: VolumeGrid,
  arquivos: Array<{ nome: string; bytes: Uint8Array }>,
): Promise<ResumoImportacaoTotalSeg> {
  const nomesImportados: string[] = [];
  const ignorados: string[] = [];

  for (let i = 0; i < arquivos.length; i++) {
    const arq = arquivos[i]!;
    const bytes = arq.bytes;
    arq.bytes = new Uint8Array(0);
    const volume = await lerNifti(bytes);
    const parcial = aplicarTotalSegmentatorEmEstado(estado, grid, [{ nome: arq.nome, volume }]);
    for (const nome of parcial.nomes) {
      if (!nomesImportados.includes(nome)) nomesImportados.push(nome);
    }
    ignorados.push(...parcial.ignorados);
  }

  return {
    importados: nomesImportados.length,
    nomes: nomesImportados,
    ignorados,
  };
}

// ---------------------------------------------------------------------------
// Catálogo completo de presets e tarefas do TotalSegmentator para Tauri
// ---------------------------------------------------------------------------

export type PresetTotalSegId = string;

export interface PresetTotalSeg {
  id: PresetTotalSegId;
  rotulo: string;
  grupo: string;
  /** Tarefa `--task` do TotalSegmentator (padrão `'total'`). */
  tarefa: string;
  /** Pacote de pesos correspondente no gerenciador de downloads. */
  idPesos: string;
  orgaos: string[];
  modoRapido: boolean;
  requerLicenca?: boolean;
  modalidade?: 'CT' | 'MR';
}

export const PRESETS_TOTALSEGMENTATOR: PresetTotalSeg[] = [
  // Recortes rápidos de rotina em TC
  {
    id: 'pancreas_vasos',
    rotulo: 'Pâncreas, duodeno e vasos (TC)',
    grupo: 'Recortes rápidos (TC)',
    tarefa: 'total',
    idPesos: 'total',
    orgaos: ['pancreas', 'duodenum', 'aorta', 'portal_vein_and_splenic_vein', 'inferior_vena_cava', 'spleen'],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'hepato_biliar',
    rotulo: 'Fígado, vesícula, baço e vasos (TC)',
    grupo: 'Recortes rápidos (TC)',
    tarefa: 'total',
    idPesos: 'total',
    orgaos: ['liver', 'gallbladder', 'pancreas', 'spleen', 'aorta', 'portal_vein_and_splenic_vein', 'inferior_vena_cava'],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'urinario_vascular',
    rotulo: 'Rins, adrenais, bexiga e vasos (TC)',
    grupo: 'Recortes rápidos (TC)',
    tarefa: 'total',
    idPesos: 'total',
    orgaos: [
      'kidney_right',
      'kidney_left',
      'adrenal_gland_right',
      'adrenal_gland_left',
      'aorta',
      'inferior_vena_cava',
      'iliac_artery_left',
      'iliac_artery_right',
      'iliac_vena_left',
      'iliac_vena_right',
      'urinary_bladder',
    ],
    modoRapido: false,
    modalidade: 'CT',
  },

  // Corpo inteiro (TC e RM)
  {
    id: 'completo_rapido',
    rotulo: 'Todos os órgãos TC (--fast · rápido)',
    grupo: 'Corpo inteiro (TC e RM)',
    tarefa: 'total',
    idPesos: 'total_fast',
    orgaos: [],
    modoRapido: true,
    modalidade: 'CT',
  },
  {
    id: 'completo_alta_res',
    rotulo: 'Todos os órgãos TC (alta resolução)',
    grupo: 'Corpo inteiro (TC e RM)',
    tarefa: 'total',
    idPesos: 'total',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'total_mr_rapido',
    rotulo: 'Todos os órgãos RM (--fast · rápido)',
    grupo: 'Corpo inteiro (TC e RM)',
    tarefa: 'total_mr',
    idPesos: 'total_fast_mr',
    orgaos: [],
    modoRapido: true,
    modalidade: 'MR',
  },
  {
    id: 'total_mr_completo',
    rotulo: 'Todos os órgãos RM (alta resolução)',
    grupo: 'Corpo inteiro (TC e RM)',
    tarefa: 'total_mr',
    idPesos: 'total_mr',
    orgaos: [],
    modoRapido: false,
    modalidade: 'MR',
  },

  // Abdome, Fígado e Oncologia (uso livre)
  {
    id: 'liver_vessels',
    rotulo: 'Vasos hepáticos e tumores hepáticos (TC)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'liver_vessels',
    idPesos: 'liver_vessels',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'liver_segments',
    rotulo: 'Segmentos hepáticos de Couinaud I–VIII (TC)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'liver_segments',
    idPesos: 'liver_segments',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'liver_segments_mr',
    rotulo: 'Segmentos hepáticos de Couinaud I–VIII (RM)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'liver_segments_mr',
    idPesos: 'liver_segments_mr',
    orgaos: [],
    modoRapido: false,
    modalidade: 'MR',
  },
  {
    id: 'liver_lesions',
    rotulo: 'Lesões hepáticas (TC)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'liver_lesions',
    idPesos: 'liver_lesions',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'liver_lesions_mr',
    rotulo: 'Lesões hepáticas (RM)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'liver_lesions_mr',
    idPesos: 'liver_lesions_mr',
    orgaos: [],
    modoRapido: false,
    modalidade: 'MR',
  },
  {
    id: 'kidney_cysts',
    rotulo: 'Cistos renais (TC)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'kidney_cysts',
    idPesos: 'kidney_cysts',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'abdominal_muscles',
    rotulo: 'Músculos abdominais / psoas / sarcopenia (TC)',
    grupo: 'Abdome, Fígado e Oncologia',
    tarefa: 'abdominal_muscles',
    idPesos: 'abdominal_muscles',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },

  // Tórax e Pulmão (uso livre)
  {
    id: 'lung_vessels',
    rotulo: 'Vasos pulmonares e árvore brônquica (TC)',
    grupo: 'Tórax e Pulmão',
    tarefa: 'lung_vessels',
    idPesos: 'lung_vessels',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'lung_nodules',
    rotulo: 'Nódulos pulmonares e pulmões (TC)',
    grupo: 'Tórax e Pulmão',
    tarefa: 'lung_nodules',
    idPesos: 'lung_nodules',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'pleural_pericard_effusion',
    rotulo: 'Derrame pleural e pericárdico (TC)',
    grupo: 'Tórax e Pulmão',
    tarefa: 'pleural_pericard_effusion',
    idPesos: 'pleural_pericard_effusion',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },

  // Coluna, Cabeça/Pescoço, Mama e Outros (uso livre)
  {
    id: 'vertebrae_mr',
    rotulo: 'Vértebras e discos intervertebrais (RM)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'vertebrae_mr',
    idPesos: 'vertebrae_mr',
    orgaos: [],
    modoRapido: false,
    modalidade: 'MR',
  },
  {
    id: 'breasts',
    rotulo: 'Mamas (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'breasts',
    idPesos: 'breasts',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'cerebral_bleed',
    rotulo: 'Hemorragia intracraniana (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'cerebral_bleed',
    idPesos: 'cerebral_bleed',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'brain_aneurysm',
    rotulo: 'Aneurismas cerebrais (TOF-MRA / Angio-TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'brain_aneurysm',
    idPesos: 'brain_aneurysm',
    orgaos: [],
    modoRapido: false,
  },
  {
    id: 'ventricle_parts',
    rotulo: 'Ventrículos cerebrais (TC/RM)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'ventricle_parts',
    idPesos: 'ventricle_parts',
    orgaos: [],
    modoRapido: false,
  },
  {
    id: 'head_glands_cavities',
    rotulo: 'Glândulas salivares, tireoide e seios da face (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'head_glands_cavities',
    idPesos: 'head_glands_cavities',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'headneck_bones_vessels',
    rotulo: 'Ossos e vasos de cabeça e pescoço (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'headneck_bones_vessels',
    idPesos: 'headneck_bones_vessels',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'headneck_muscles',
    rotulo: 'Músculos de cabeça e pescoço (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'headneck_muscles',
    idPesos: 'headneck_muscles',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },
  {
    id: 'hip_implant',
    rotulo: 'Prótese de quadril (TC)',
    grupo: 'Coluna, Cabeça/Pescoço e Outros',
    tarefa: 'hip_implant',
    idPesos: 'hip_implant',
    orgaos: [],
    modoRapido: false,
    modalidade: 'CT',
  },

  // Tarefas com chave acadêmica gratuita
  {
    id: 'tissue_types',
    rotulo: '🔑 Gordura visceral, subcutânea e músculo (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'tissue_types',
    idPesos: 'tissue_types',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'tissue_types_mr',
    rotulo: '🔑 Gordura visceral, subcutânea e músculo (RM)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'tissue_types_mr',
    idPesos: 'tissue_types_mr',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'MR',
  },
  {
    id: 'aortic_dissection',
    rotulo: '🔑 Dissecção de aorta: luz verdadeira e falsa (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'aortic_dissection',
    idPesos: 'aortic_dissection',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'renal_arteries',
    rotulo: '🔑 Tronco celíaco, AMS e artérias renais (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'renal_arteries',
    idPesos: 'renal_arteries',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'coronary_arteries',
    rotulo: '🔑 Artérias coronárias (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'coronary_arteries',
    idPesos: 'coronary_arteries',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'heartchambers_highres',
    rotulo: '🔑 Câmaras cardíacas em alta resolução (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'heartchambers_highres',
    idPesos: 'heartchambers_highres',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'appendicular_bones',
    rotulo: '🔑 Ossos apendiculares (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'appendicular_bones',
    idPesos: 'appendicular_bones',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
  {
    id: 'appendicular_bones_mr',
    rotulo: '🔑 Ossos apendiculares (RM)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'appendicular_bones_mr',
    idPesos: 'appendicular_bones_mr',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'MR',
  },
  {
    id: 'brain_structures',
    rotulo: '🔑 Estruturas encefálicas (TC)',
    grupo: 'Com chave acadêmica gratuita',
    tarefa: 'brain_structures',
    idPesos: 'brain_structures',
    orgaos: [],
    modoRapido: false,
    requerLicenca: true,
    modalidade: 'CT',
  },
];

export function obterPresetTotalSegmentator(presetId: string): PresetTotalSeg {
  return PRESETS_TOTALSEGMENTATOR.find((p) => p.id === presetId) ?? PRESETS_TOTALSEGMENTATOR[0]!;
}
