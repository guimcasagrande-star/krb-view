import { describe, expect, it } from 'vitest';
import {
  LINKS_RAPIDOS_PADRAO,
  extrairDominioCurto,
  normalizarUrlExterna,
  sanearLinksRapidos,
} from '../src/state/linksRapidos';
import { sanear } from '../src/state/preferencias';

describe('linksRapidos', () => {
  it('inclui todos os 16 links predefinidos com URLs http/https válidas e IDs únicos', () => {
    expect(LINKS_RAPIDOS_PADRAO.length).toBe(16);
    const ids = new Set<string>();
    for (const link of LINKS_RAPIDOS_PADRAO) {
      expect(ids.has(link.id)).toBe(false);
      ids.add(link.id);
      expect(normalizarUrlExterna(link.url)).not.toBeNull();
    }
  });

  it('normaliza domínios sem protocolo e bloqueia esquemas perigosos ou inválidos', () => {
    expect(normalizarUrlExterna('radiopaedia.org')).toBe('https://radiopaedia.org/');
    expect(normalizarUrlExterna('  https://esquemas-laudo.web.app/  ')).toBe('https://esquemas-laudo.web.app/');
    expect(normalizarUrlExterna('http://intranet.hospital.br/pacs')).toBe('http://intranet.hospital.br/pacs');
    expect(normalizarUrlExterna('javascript:alert(1)')).toBeNull();
    expect(normalizarUrlExterna('data:text/html,oi')).toBeNull();
    expect(normalizarUrlExterna('file:///C:/Windows/win.ini')).toBeNull();
    expect(normalizarUrlExterna('semponto')).toBeNull();
    expect(normalizarUrlExterna('https://com espaco.com')).toBeNull();
    expect(normalizarUrlExterna('')).toBeNull();
  });

  it('permite apagar links predefinidos (inclusive todos) e persiste a lista reduzida ou vazia', () => {
    // Sem campo no JSON antigo -> carrega todos os padrões
    const padrao = sanear({});
    expect(padrao.linksRapidos.length).toBe(LINKS_RAPIDOS_PADRAO.length);

    // Usuário apagou quase todos, deixando apenas 1 predefinido
    const apenasUm = sanear({
      linksRapidos: [{ id: 'gemini', rotulo: 'Gemini', url: 'https://gemini.google.com/' }],
    });
    expect(apenasUm.linksRapidos).toEqual([
      { id: 'gemini', rotulo: 'Gemini', url: 'https://gemini.google.com/' },
    ]);

    // Usuário apagou todos os links (inclusive os que já vieram) -> respeita array vazio!
    const vazio = sanear({ linksRapidos: [] });
    expect(vazio.linksRapidos).toEqual([]);
  });

  it('saneia itens malformados e deduplica IDs repetidos', () => {
    const lista = sanearLinksRapidos([
      { id: 'meu', rotulo: 'Meu Site', url: 'meusite.com.br' },
      { id: 'meu', rotulo: '', url: 'https://www.outro.org/caminho' },
      { id: 'ruim', rotulo: 'Ruim', url: 'javascript:void(0)' },
    ]);
    expect(lista).toEqual([
      { id: 'meu', rotulo: 'Meu Site', url: 'https://meusite.com.br/' },
      { id: 'meu-2', rotulo: 'outro.org', url: 'https://www.outro.org/caminho' },
    ]);
    expect(extrairDominioCurto('https://www.mrisafety.com/TMDL_list.php')).toBe('mrisafety.com');
  });
});
