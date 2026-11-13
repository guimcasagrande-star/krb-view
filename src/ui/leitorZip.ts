/**
 * Extrator leve de arquivos `.zip` diretamente no navegador (sem dependências externas),
 * usando `DecompressionStream('deflate-raw')` nativo da Web API.
 * Suporta entradas não comprimidas ( método 0 = Stored ) e Deflate ( método 8 ),
 * lendo a partir do diretório central (Central Directory) no fim do arquivo ZIP.
 */

export interface EntradaZipExtraida {
  caminho: string;
  arquivo: File;
}

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

function decodificarNome(bytes: Uint8Array, utf8: boolean): string {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
    return s;
  }
}

async function descomprimirDeflateRaw(comprimido: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador não suporta DecompressionStream para arquivos ZIP.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const escritor = ds.writable.getWriter();
  const copia = new Uint8Array(comprimido.byteLength);
  copia.set(comprimido);
  void escritor.write(copia).then(() => escritor.close()).catch(() => {});

  const leitor = ds.readable.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    if (value) {
      pedacos.push(value);
      total += value.byteLength;
    }
  }
  const saida = new Uint8Array(total);
  let offset = 0;
  for (const p of pedacos) {
    saida.set(p, offset);
    offset += p.byteLength;
  }
  return saida;
}

/**
 * Extrai todos os arquivos regulares de um `File` ou `Blob` `.zip`.
 */
export async function extrairArquivosDoZip(
  zipBlob: Blob,
  prefixo = '',
): Promise<EntradaZipExtraida[]> {
  const buffer = await zipBlob.arrayBuffer();
  const vista = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const tamanho = bytes.byteLength;

  // Procura o End of Central Directory (EOCD) de trás para frente (últimos 65 KB):
  const limiteBusca = Math.max(0, tamanho - 65557);
  let posEocd = -1;
  for (let pos = tamanho - 22; pos >= limiteBusca; pos--) {
    if (vista.getUint32(pos, true) === ASSINATURA_EOCD) {
      posEocd = pos;
      break;
    }
  }
  if (posEocd < 0) {
    throw new Error('Arquivo ZIP inválido ou corrompido (diretório central não encontrado).');
  }

  const totalEntradas = vista.getUint16(posEocd + 10, true);
  const offsetCentral = vista.getUint32(posEocd + 16, true);

  const saida: EntradaZipExtraida[] = [];
  let cursor = offsetCentral;

  for (let i = 0; i < totalEntradas && cursor + 46 <= tamanho; i++) {
    if (vista.getUint32(cursor, true) !== ASSINATURA_CENTRAL) break;

    const flags = vista.getUint16(cursor + 8, true);
    const metodo = vista.getUint16(cursor + 10, true);
    const tamComprimido = vista.getUint32(cursor + 20, true);
    const tamNome = vista.getUint16(cursor + 28, true);
    const tamExtra = vista.getUint16(cursor + 30, true);
    const tamComentario = vista.getUint16(cursor + 32, true);
    const offsetLocal = vista.getUint32(cursor + 42, true);

    const bytesNome = bytes.subarray(cursor + 46, cursor + 46 + tamNome);
    const utf8 = (flags & 0x0800) !== 0;
    const nomeRelativo = decodificarNome(bytesNome, utf8).replace(/\\/g, '/').replace(/^\/+/, '');

    cursor += 46 + tamNome + tamExtra + tamComentario;

    // Ignora diretórios e metadados de sistema (__MACOSX, .DS_Store)
    if (
      !nomeRelativo ||
      nomeRelativo.endsWith('/') ||
      nomeRelativo.startsWith('__MACOSX/') ||
      nomeRelativo.endsWith('/.DS_Store') ||
      nomeRelativo === '.DS_Store'
    ) {
      continue;
    }

    if (offsetLocal + 30 > tamanho || vista.getUint32(offsetLocal, true) !== ASSINATURA_LOCAL) {
      continue;
    }
    const tamNomeLocal = vista.getUint16(offsetLocal + 26, true);
    const tamExtraLocal = vista.getUint16(offsetLocal + 28, true);
    const inicioDados = offsetLocal + 30 + tamNomeLocal + tamExtraLocal;
    if (inicioDados + tamComprimido > tamanho) continue;

    const fatiaComprimida = bytes.subarray(inicioDados, inicioDados + tamComprimido);
    let conteudo: Uint8Array;
    if (metodo === 0) {
      conteudo = fatiaComprimida;
    } else if (metodo === 8) {
      conteudo = await descomprimirDeflateRaw(fatiaComprimida);
    } else {
      // Método não suportado (ex.: BZIP2/LZMA): pula sem interromper os demais
      continue;
    }

    const caminhoFinal = prefixo ? `${prefixo}/${nomeRelativo}` : nomeRelativo;
    const nomeCurto = nomeRelativo.split('/').pop() ?? nomeRelativo;
    const copiaBuffer = new Uint8Array(conteudo.byteLength);
    copiaBuffer.set(conteudo);
    const arquivo = new File([copiaBuffer], nomeCurto, { type: 'application/dicom' });
    saida.push({ caminho: caminhoFinal, arquivo });
  }

  return saida;
}
