/**
 * Leitura de datas e horas DICOM (VR DA, TM e DT).
 *
 * As horas DICOM são "hora de parede" do equipamento, quase sempre sem fuso.
 * Por isso tudo é convertido para milissegundos numa linha do tempo "ingênua"
 * (como se fosse UTC). Diferenças entre dois instantes do mesmo exame ficam
 * corretas, que é o que importa para o cálculo de decaimento.
 */

export interface DicomInstant {
  /** Milissegundos na linha do tempo ingênua (hora local do equipamento). */
  ms: number;
  /** Deslocamento do fuso em minutos, quando o valor DT traz o sufixo ±HHMM. */
  offsetMinutes?: number;
}

const DAY_MS = 86_400_000;

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Converte DA (AAAAMMDD, ou o formato antigo AAAA.MM.DD) em ms à meia-noite.
 * Retorna `undefined` se o valor estiver ausente ou inválido.
 */
export function parseDA(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/\./g, '');
  if (!/^\d{8}$/.test(v)) return undefined;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(4, 6));
  const day = Number(v.slice(6, 8));
  if (!isValidDate(year, month, day)) return undefined;
  return Date.UTC(year, month - 1, day);
}

/**
 * Converte TM (HHMMSS.FFFFFF, com minutos, segundos e fração opcionais, ou o
 * formato antigo HH:MM:SS) em milissegundos desde a meia-noite.
 */
export function parseTM(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().replace(/:/g, '');
  const m = /^(\d{2})(\d{2})?(\d{2})?(?:\.(\d{1,6}))?$/.exec(v);
  if (!m) return undefined;
  const hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  const seconds = m[3] === undefined ? 0 : Number(m[3]);
  // 60 é permitido pelo padrão para segundo intercalar.
  if (hours > 23 || minutes > 59 || seconds > 60) return undefined;
  const fraction = m[4] === undefined ? 0 : Number(`0.${m[4]}`);
  return ((hours * 60 + minutes) * 60 + seconds + fraction) * 1000;
}

/**
 * Converte DT (AAAAMMDDHHMMSS.FFFFFF&ZZXX). Exige pelo menos a data completa.
 * O sufixo de fuso, se existir, é devolvido em `offsetMinutes` e NÃO é aplicado
 * a `ms`: `ms` continua sendo a hora de parede.
 */
export function parseDT(value: string | undefined): DicomInstant | undefined {
  if (!value) return undefined;
  const m = /^(\d{8})(\d{2})?(\d{2})?(\d{2})?(?:\.(\d{1,6}))?([+-]\d{4})?$/.exec(value.trim());
  if (!m) return undefined;
  const date = parseDA(m[1]);
  if (date === undefined) return undefined;
  const hours = m[2] === undefined ? 0 : Number(m[2]);
  const minutes = m[3] === undefined ? 0 : Number(m[3]);
  const seconds = m[4] === undefined ? 0 : Number(m[4]);
  if (hours > 23 || minutes > 59 || seconds > 60) return undefined;
  const fraction = m[5] === undefined ? 0 : Number(`0.${m[5]}`);
  const instant: DicomInstant = {
    ms: date + ((hours * 60 + minutes) * 60 + seconds + fraction) * 1000,
  };
  const offset = parseTimezoneOffset(m[6]);
  if (offset !== undefined) instant.offsetMinutes = offset;
  return instant;
}

/** Converte '+HHMM' / '-HHMM' (0008,0201) em minutos. */
export function parseTimezoneOffset(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^([+-])(\d{2})(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/** Junta DA + TM. Retorna `undefined` se qualquer um dos dois for inválido. */
export function combineDateTime(
  date: string | undefined,
  time: string | undefined,
): DicomInstant | undefined {
  const d = parseDA(date);
  const t = parseTM(time);
  if (d === undefined || t === undefined) return undefined;
  return { ms: d + t };
}

/**
 * Diferença `later - earlier` em segundos.
 *
 * Se os dois instantes trazem fuso explícito e os fusos são diferentes, a
 * diferença de fuso é descontada. Em qualquer outro caso os dois são tratados
 * como hora de parede do mesmo relógio.
 */
export function secondsBetween(earlier: DicomInstant, later: DicomInstant): number {
  let deltaMs = later.ms - earlier.ms;
  if (earlier.offsetMinutes !== undefined && later.offsetMinutes !== undefined) {
    deltaMs -= (later.offsetMinutes - earlier.offsetMinutes) * 60_000;
  }
  return deltaMs / 1000;
}

/** 'AAAAMMDD' -> 'DD/MM/AAAA'. Devolve string vazia se inválido. */
export function formatDatePtBr(value: string | undefined): string {
  const ms = parseDA(value);
  if (ms === undefined) return '';
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Milissegundos da linha do tempo ingênua -> 'DD/MM/AAAA HH:MM:SS'. */
export function formatInstantPtBr(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

export { DAY_MS };
