/**
 * A date read from a track's name (Phase 14 Requirement 22.7).
 *
 * Recordings with no times often carry their date in the file name instead:
 * "Ride 16-05-25", "Peak loop 16 May 2025", "2025-05-16 Dovedale". The Tracks
 * section places such a track under that day, marked as read from its name.
 * The date is never written into the track: its recorded times stay missing.
 *
 * Numbers are read day first (dd-mm-yy, dd-mm-yyyy), as the owner asked and
 * as a UK user writes them. Month first is used only when day first is not a
 * date at all, so 05-16-25 is 16 May, but 03-04-25 is 3 April, never 4 March.
 * A two-digit year from 70 is 19xx, below it 20xx. Anything that does not
 * name a real calendar day is ignored.
 */

export interface NameDate {
  /** YYYY-MM-DD. */
  date: string;
  /** The text in the name it was read from. */
  text: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Full names and the usual short forms, longest first so "June" wins over "Jun".
const MONTH_WORD = '(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)';
const SEP = '[-/._ ]';
const NOT_DIGIT_BEFORE = '(?<![0-9])';
const NOT_DIGIT_AFTER = '(?![0-9])';

function monthOfWord(word: string): number {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3)) + 1;
}

function fullYear(text: string): number {
  if (text.length === 4) return Number(text);
  const yy = Number(text);
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

function valid(year: number, month: number, day: number): boolean {
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface Reader {
  pattern: RegExp;
  read(m: RegExpExecArray): [number, number, number] | null;
}

const READERS: Reader[] = [
  // 2025-05-16, 2025/05/16, 2025.05.16
  {
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{4})${SEP}(\\d{1,2})${SEP}(\\d{1,2})${NOT_DIGIT_AFTER}`, 'i'),
    read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
  // 16 May 2025, 16-May-25, 16th May 2025, 16May2025
  {
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})(?:st|nd|rd|th)?${SEP}*${MONTH_WORD}\\.?${SEP}*,?${SEP}*(\\d{4}|\\d{2})${NOT_DIGIT_AFTER}`, 'i'),
    read: (m) => [fullYear(m[3] ?? ''), monthOfWord(m[2] ?? ''), Number(m[1])],
  },
  // May 16, 2025; May 16th 2025
  {
    pattern: new RegExp(`(?<![a-z])${MONTH_WORD}\\.?${SEP}*(\\d{1,2})(?:st|nd|rd|th)?,?${SEP}+(\\d{4})${NOT_DIGIT_AFTER}`, 'i'),
    read: (m) => [Number(m[3]), monthOfWord(m[1] ?? ''), Number(m[2])],
  },
  // 16-05-2025, 16/05/25, 16.5.25: day first, month first only when day first is impossible.
  {
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}(\\d{1,2})${SEP}(\\d{1,2})${SEP}(\\d{4}|\\d{2})${NOT_DIGIT_AFTER}`, 'i'),
    read: (m) => {
      const year = fullYear(m[3] ?? '');
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (valid(year, b, a)) return [year, b, a];
      if (valid(year, a, b)) return [year, a, b];
      return null;
    },
  },
  // 20250516, as cameras and devices name files.
  {
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}((?:19|20)\\d{2})(\\d{2})(\\d{2})${NOT_DIGIT_AFTER}`),
    read: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
];

/** The first real date in the name, by the readers in order, or null. */
export function dateFromName(name: string): NameDate | null {
  for (const reader of READERS) {
    const m = reader.pattern.exec(name);
    if (m === null) continue;
    const parts = reader.read(m);
    if (parts === null) continue;
    const [year, month, day] = parts;
    if (valid(year, month, day)) return { date: iso(year, month, day), text: m[0].trim() };
  }
  return null;
}
