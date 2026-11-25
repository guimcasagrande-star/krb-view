/**
 * Links rápidos de apoio ao laudo na barra superior.
 *
 * Princípio de privacidade (100% local):
 * - Nenhum favicon remoto nem pré-conexão é feita pelo app.
 * - Os links ficam salvos apenas no `localStorage` local e só são abertos no
 *   navegador externo do sistema quando o usuário clica explicitamente neles.
 */

export interface LinkRapido {
  id: string;
  rotulo: string;
  url: string;
  grupo?: string;
}

export const MAX_LINKS_RAPIDOS = 60;

export const LINKS_RAPIDOS_PADRAO: ReadonlyArray<LinkRapido> = [
  // Laudo, Anatomia e Referência
  {
    id: 'esquemas-laudo',
    rotulo: 'Esquemas de Laudo',
    url: 'https://esquemas-laudo.web.app/',
    grupo: 'Laudo e Referência',
  },
  {
    id: 'imaios',
    rotulo: 'IMAIOS (e-Anatomy)',
    url: 'https://www.imaios.com/br/e-anatomy',
    grupo: 'Laudo e Referência',
  },
  {
    id: 'radiopaedia',
    rotulo: 'Radiopaedia',
    url: 'https://radiopaedia.org/',
    grupo: 'Laudo e Referência',
  },
  {
    id: 'radiology-assistant',
    rotulo: 'Radiology Assistant',
    url: 'https://radiologyassistant.nl/',
    grupo: 'Laudo e Referência',
  },
  {
    id: 'acr-rads',
    rotulo: 'ACR RADS (LI / PI / O-RADS)',
    url: 'https://www.acr.org/Clinical-Resources/Clinical-Tools-and-Reference/Reporting-and-Data-Systems',
    grupo: 'Laudo e Referência',
  },
  {
    id: 'ctisus',
    rotulo: 'CTisus',
    url: 'https://www.ctisus.com/',
    grupo: 'Laudo e Referência',
  },

  // Calculadoras e Segurança
  {
    id: 'ckd-epi',
    rotulo: 'CKD-EPI (TFG — MDCalc)',
    url: 'https://www.mdcalc.com/calc/3939/ckd-epi-equations-glomerular-filtration-rate-gfr',
    grupo: 'Calculadoras e Segurança',
  },
  {
    id: 'rad-at-hand',
    rotulo: 'RAD at Hand (Calculadoras)',
    url: 'https://radathand.com/',
    grupo: 'Calculadoras e Segurança',
  },
  {
    id: 'mri-safety',
    rotulo: 'MRI Safety — THE List',
    url: 'https://www.mrisafety.com/TMDL_list.php',
    grupo: 'Calculadoras e Segurança',
  },

  // Periódicos e Busca
  {
    id: 'radiographics',
    rotulo: 'RadioGraphics (RSNA)',
    url: 'https://pubs.rsna.org/journal/radiographics',
    grupo: 'Periódicos e Busca',
  },
  {
    id: 'radiology',
    rotulo: 'Radiology (RSNA)',
    url: 'https://pubs.rsna.org/journal/radiology',
    grupo: 'Periódicos e Busca',
  },
  {
    id: 'ajr',
    rotulo: 'AJR',
    url: 'https://ajronline.org/',
    grupo: 'Periódicos e Busca',
  },
  {
    id: 'pubmed',
    rotulo: 'PubMed',
    url: 'https://pubmed.ncbi.nlm.nih.gov/',
    grupo: 'Periódicos e Busca',
  },

  // IA e Evidência
  {
    id: 'openevidence',
    rotulo: 'OpenEvidence',
    url: 'https://www.openevidence.com/',
    grupo: 'IA e Evidência',
  },
  {
    id: 'gemini',
    rotulo: 'Gemini',
    url: 'https://gemini.google.com/',
    grupo: 'IA e Evidência',
  },
  {
    id: 'claude',
    rotulo: 'Claude',
    url: 'https://claude.ai/',
    grupo: 'IA e Evidência',
  },
];

/**
 * Valida e normaliza uma URL externa para `http://` ou `https://`.
 * Se o usuário digitar apenas o domínio (ex.: `chatgpt.com`), prefixa `https://`.
 * Rejeita esquemas perigosos (`javascript:`, `data:`, `file:`) ou formatos inválidos.
 */
export function normalizarUrlExterna(entrada: string): string | null {
  const limpo = entrada.trim();
  if (!limpo || /\s/.test(limpo)) return null;

  const temEsquema = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(limpo);
  const candidata = temEsquema ? limpo : `https://${limpo}`;

  try {
    const u = new URL(candidata);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Saneia uma lista de links vinda do armazenamento local, preservando lista vazia se o usuário apagou todos. */
export function sanearLinksRapidos(bruto: unknown): LinkRapido[] {
  if (bruto === undefined) {
    return LINKS_RAPIDOS_PADRAO.map((l) => ({ ...l }));
  }
  if (!Array.isArray(bruto)) {
    return LINKS_RAPIDOS_PADRAO.map((l) => ({ ...l }));
  }
  const saida: LinkRapido[] = [];
  const idsUsados = new Set<string>();
  for (const item of bruto as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue;
    const url = typeof item.url === 'string' ? normalizarUrlExterna(item.url) : null;
    if (!url) continue;
    const rotuloBruto = typeof item.rotulo === 'string' ? item.rotulo.trim() : '';
    const rotulo = (rotuloBruto || extrairDominioCurto(url)).slice(0, 60);
    const idBase =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim().slice(0, 60)
        : `link-${saida.length + 1}`;
    let id = idBase;
    let sufixo = 2;
    while (idsUsados.has(id)) {
      id = `${idBase}-${sufixo++}`;
    }
    idsUsados.add(id);
    const grupo =
      typeof item.grupo === 'string' && item.grupo.trim()
        ? item.grupo.trim().slice(0, 40)
        : undefined;
    saida.push({ id, rotulo, url, ...(grupo ? { grupo } : {}) });
    if (saida.length >= MAX_LINKS_RAPIDOS) break;
  }
  return saida;
}

export function extrairDominioCurto(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

interface TauriCoreBridge {
  core?: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

/**
 * Abre um link validado no navegador padrão do sistema (via comando nativo no Tauri
 * ou nova aba isolada no navegador Web).
 */
export function abrirLinkExterno(urlBruta: string): void {
  const url = normalizarUrlExterna(urlBruta);
  if (!url) return;

  const tauri = (globalThis as { __TAURI__?: TauriCoreBridge }).__TAURI__;
  if (tauri?.core?.invoke) {
    void tauri.core.invoke('abrir_url_externa', { url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
