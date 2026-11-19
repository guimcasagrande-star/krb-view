/**
 * Servidores PACS cadastrados e AE title desta estação. Ficam no armazenamento do app (pasta de
 * dados do programa, fora do projeto). Nunca guarda nome de paciente nem resultados de pesquisa.
 */

import type { PacsServer } from '../pacs/client.ts';
import { normalizeFingerprint } from '../pacs/config.ts';

export interface ConfigPacs {
  meuAeTitle: string;
  /** Porta TCP local de escuta usada apenas em servidores configurados para C-MOVE (padrão: 11112). */
  portaEscuta: number;
  servidores: PacsServer[];
  /** Limite máximo em GB para a pasta de exames baixados (0 = sem limite). Padrão: 10 GB. */
  limiteCacheGb: number;
}

const CHAVE = 'visualizador.pacs.v1';

export function carregarConfigPacs(): ConfigPacs {
  const padrao: ConfigPacs = { meuAeTitle: 'VISUALIZADOR', portaEscuta: 11112, servidores: [], limiteCacheGb: 10 };
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
      const retrieveMode = s.retrieveMode === 'cmove' ? 'cmove' : undefined;
      const maxConnections =
        typeof s.maxConnections === 'number' && Number.isInteger(s.maxConnections) && s.maxConnections >= 1 && s.maxConnections <= 8
          ? s.maxConnections
          : undefined;
      const maxPduLength =
        typeof s.maxPduLength === 'number' && Number.isInteger(s.maxPduLength) && s.maxPduLength >= 4096
          ? s.maxPduLength
          : undefined;
      return {
        name: s.name,
        host: s.host,
        port: s.port,
        aeTitle: s.aeTitle,
        ...(s.tls === true ? { tls: true } : {}),
        ...(s.tls === true && digital ? { certificateSha256: digital } : {}),
        ...(retrieveMode ? { retrieveMode } : {}),
        ...(maxConnections !== undefined ? { maxConnections } : {}),
        ...(maxPduLength !== undefined ? { maxPduLength } : {}),
      };
    });
    const portaEscuta =
      typeof bruto.portaEscuta === 'number' && Number.isInteger(bruto.portaEscuta) && bruto.portaEscuta >= 1 && bruto.portaEscuta <= 65535
        ? bruto.portaEscuta
        : padrao.portaEscuta;
    const limiteCacheGb =
      typeof bruto.limiteCacheGb === 'number' && Number.isFinite(bruto.limiteCacheGb) && bruto.limiteCacheGb >= 0
        ? bruto.limiteCacheGb
        : padrao.limiteCacheGb;
    return {
      meuAeTitle: typeof bruto.meuAeTitle === 'string' ? bruto.meuAeTitle : padrao.meuAeTitle,
      portaEscuta,
      servidores: limpos,
      limiteCacheGb,
    };
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
