/**
 * Gerador mínimo de arquivos DICOM, só para testes e para o phantom sintético.
 *
 * Escreve Explicit VR Little Endian com cabeçalho Part 10 (ou Implicit VR sem
 * cabeçalho, para testar arquivos "crus"). Não usa nenhuma biblioteca, e não
 * importa nada, para poder ser executado direto pelo Node.
 */

export type DicomValue = string | number | number[] | Uint8Array | DicomElement[][];

export interface DicomElement {
  /** 'GGGGEEEE' em hexadecimal, ex.: '00100010'. */
  tag: string;
  vr: string;
  value: DicomValue;
}

export function el(tag: string, vr: string, value: DicomValue): DicomElement {
  return { tag: tag.toLowerCase(), vr, value };
}

export interface WriteOptions {
  /** Padrão: Explicit VR Little Endian. */
  transferSyntaxUid?: string;
  /** Falso gera dataset cru em Implicit VR, sem preâmbulo nem grupo 0002. */
  part10?: boolean;
  /** Codificação dos textos. Padrão latin1 (ISO_IR 100). */
  encoding?: 'latin1' | 'utf8';
}

const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const LONG_VRS = new Set(['OB', 'OW', 'OF', 'OD', 'OL', 'SQ', 'UT', 'UN', 'UC', 'UR']);

function encodeText(text: string, encoding: 'latin1' | 'utf8'): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(text);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function tagBytes(tag: string): Uint8Array {
  return concat([u16(parseInt(tag.slice(0, 4), 16)), u16(parseInt(tag.slice(4, 8), 16))]);
}

function pad(bytes: Uint8Array, padByte: number): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = padByte;
  return out;
}

function valueBytes(
  element: DicomElement,
  encoding: 'latin1' | 'utf8',
  explicit: boolean,
): Uint8Array {
  const { vr, value } = element;

  if (vr === 'SQ') {
    const items = value as DicomElement[][];
    return concat(
      items.map((item) => {
        const body = encodeElements(item, encoding, explicit);
        return concat([tagBytes('fffee000'), u32(body.length), body]);
      }),
    );
  }
  if (value instanceof Uint8Array) return pad(value, 0);

  const numbers = typeof value === 'number' ? [value] : Array.isArray(value) ? (value as number[]) : null;
  const binary: Record<string, [number, (v: DataView, o: number, n: number) => void]> = {
    US: [2, (v, o, n) => v.setUint16(o, n, true)],
    SS: [2, (v, o, n) => v.setInt16(o, n, true)],
    UL: [4, (v, o, n) => v.setUint32(o, n, true)],
    SL: [4, (v, o, n) => v.setInt32(o, n, true)],
    FL: [4, (v, o, n) => v.setFloat32(o, n, true)],
    FD: [8, (v, o, n) => v.setFloat64(o, n, true)],
  };
  const spec = binary[vr];
  if (spec && numbers) {
    const [size, write] = spec;
    const out = new Uint8Array(size * numbers.length);
    const view = new DataView(out.buffer);
    numbers.forEach((n, i) => write(view, i * size, n));
    return out;
  }

  const text = numbers ? numbers.join('\\') : String(value);
  return pad(encodeText(text, encoding), vr === 'UI' ? 0 : 0x20);
}

function encodeElements(
  elements: DicomElement[],
  encoding: 'latin1' | 'utf8',
  explicit: boolean,
): Uint8Array {
  const sorted = [...elements].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const parts: Uint8Array[] = [];
  for (const element of sorted) {
    const body = valueBytes(element, encoding, explicit);
    parts.push(tagBytes(element.tag));
    if (!explicit) {
      parts.push(u32(body.length));
    } else if (LONG_VRS.has(element.vr)) {
      parts.push(encodeText(element.vr, 'latin1'), u16(0), u32(body.length));
    } else {
      parts.push(encodeText(element.vr, 'latin1'), u16(body.length));
    }
    parts.push(body);
  }
  return concat(parts);
}

function findText(elements: DicomElement[], tag: string): string | undefined {
  const found = elements.find((e) => e.tag === tag);
  return found && typeof found.value === 'string' ? found.value : undefined;
}

/** Monta os bytes de um arquivo DICOM a partir da lista de elementos. */
export function writeDicom(elements: DicomElement[], options: WriteOptions = {}): Uint8Array {
  const encoding = options.encoding ?? 'latin1';
  if (options.part10 === false) {
    return encodeElements(elements, encoding, false);
  }

  const transferSyntax = options.transferSyntaxUid ?? EXPLICIT_VR_LE;
  const metaBody = encodeElements(
    [
      el('00020001', 'OB', new Uint8Array([0, 1])),
      el('00020002', 'UI', findText(elements, '00080016') ?? '1.2.840.10008.5.1.4.1.1.7'),
      el('00020003', 'UI', findText(elements, '00080018') ?? '1.2.3.4'),
      el('00020010', 'UI', transferSyntax),
      el('00020012', 'UI', '1.2.826.0.1.3680043.8.498.1'),
    ],
    'latin1',
    true,
  );
  const groupLength = encodeElements([el('00020000', 'UL', metaBody.length)], 'latin1', true);
  const preamble = new Uint8Array(128);
  return concat([
    preamble,
    encodeText('DICM', 'latin1'),
    groupLength,
    metaBody,
    encodeElements(elements, encoding, true),
  ]);
}
