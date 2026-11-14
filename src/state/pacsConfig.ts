/**
 * Servidores PACS cadastrados e AE title desta estação. Ficam no armazenamento do app (pasta de
 * dados do programa, fora do projeto). Nunca guarda nome de paciente nem resultados de pesquisa.
 */

import type { PacsServer } from '../pacs/client.ts';
import { normalizeFingerprint } from '../pacs/config.ts';

export interface ConfigPacs {
  meuAeTitle: string;
  servidores: PacsServer[];
}

const CHAVE = 'visualizador.pacs.v1';

export function carregarConfigPacs(): ConfigPacs {
  const padrao: ConfigPacs = { meuAeTitle: 'VISUALIZADOR', servidores: [] };
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Partial<ConfigPacs> | null;
    if (!bruto || typeof bruto !== 'object') return padrao;
    const servidores = Array.isArray(bruto.servidores)
      ? bruto.servidores.filter(
          (s): s is PacsServer =>
            !!s && typeof s.name === 'string' && typeof s.host === 'string' && typeof s.port === 'number' && typeof s.aeTitle === 'string',
        )
      : [];
    // Só os campos conhecidos, com a impressão digital no formato único.
    const limpos = servidores.map<PacsServer>((s) => {
      const digital = typeof s.certificateSha256 === 'string' ? normalizeFingerprint(s.certificateSha256) : undefined;
      return {
        name: s.name,
        host: s.host,
        port: s.port,
        aeTitle: s.aeTitle,
        ...(s.tls === true ? { tls: true } : {}),
        ...(s.tls === true && digital ? { certificateSha256: digital } : {}),
      };
    });
    return { meuAeTitle: typeof bruto.meuAeTitle === 'string' ? bruto.meuAeTitle : padrao.meuAeTitle, servidores: limpos };
  } catch {
    return padrao;
  }
}

export function salvarConfigPacs(c: ConfigPacs): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(c));
  } catch {
    /* armazenamento indisponível: vale só nesta sessão */
  }
}
