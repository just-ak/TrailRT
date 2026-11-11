/**
 * The common subset of OpenStreetMap's `opening_hours` syntax.
 *
 * Enough to answer "will the fuel station be open when I get there?" for the
 * ordinary cases (Phase 10 Requirement 7.3):
 *
 * - `24/7`
 * - rules separated by `;`, each an optional weekday selector and either a
 *   list of time ranges or `off` / `closed`
 * - weekday lists and ranges, including wrapping ones (`Fr-Mo`)
 * - time ranges past midnight (`18:00-02:00`, or `18:00-26:00`)
 * - a later rule replaces earlier ones for the days it names, as the
 *   specification says
 * - `PH` (public holidays) rules are skipped, and the answer says so, because
 *   knowing whether a date is a holiday needs a calendar this does not have
 *
 * Anything else — months, week numbers, sunrise, comments, `+`, `||` fallback
 * rules — returns **unparsed**, and the raw text is shown instead of a guess.
 * The full grammar has a library; it was not adopted because an honest
 * "unparsed" for the long tail is better than a 30 kB dependency (ADR 0019 §7).
 */

/** Minutes from the day's midnight. `end` may exceed 1440 when a range runs past midnight. */
export interface Interval {
  start: number;
  end: number;
}

export type OpeningHours =
  | {
      kind: 'parsed';
      /** Index 0 = Monday … 6 = Sunday. */
      week: Interval[][];
      /** A `PH` rule was present and ignored. */
      ignoredHolidays: boolean;
    }
  | { kind: 'unparsed'; raw: string };

export type OpenState = 'open' | 'closed' | 'unknown';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const MINUTES_PER_DAY = 1440;

function dayIndex(token: string): number {
  return (DAYS as readonly string[]).indexOf(token);
}

/** `Mo-Fr,Su` → [0,1,2,3,4,6]; null when anything in it is not a weekday. */
function parseDays(selector: string): { days: number[]; holiday: boolean } | null {
  const days = new Set<number>();
  let holiday = false;
  for (const part of selector.split(',')) {
    const item = part.trim();
    if (item === 'PH') {
      holiday = true;
      continue;
    }
    const range = /^([A-Z][a-z])-([A-Z][a-z])$/.exec(item);
    if (range !== null) {
      const from = dayIndex(range[1] ?? '');
      const to = dayIndex(range[2] ?? '');
      if (from < 0 || to < 0) return null;
      for (let d = from; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === to) break;
      }
      continue;
    }
    const single = dayIndex(item);
    if (single < 0) return null;
    days.add(single);
  }
  return { days: [...days].toSorted((a, b) => a - b), holiday };
}

function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 48) return null;
  return hours * 60 + minutes;
}

/** `08:00-12:00,13:00-17:30` → intervals; null when any range is not plain. */
function parseTimes(selector: string): Interval[] | null {
  const intervals: Interval[] = [];
  for (const part of selector.split(',')) {
    const range = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(part.trim());
    if (range === null) return null;
    const start = parseClock(range[1] ?? '');
    let end = parseClock(range[2] ?? '');
    if (start === null || end === null || start >= MINUTES_PER_DAY) return null;
    // `18:00-02:00` runs past midnight.
    if (end <= start) end += MINUTES_PER_DAY;
    if (end > 2 * MINUTES_PER_DAY) return null;
    intervals.push({ start, end });
  }
  return intervals;
}

export function parseOpeningHours(raw: string): OpeningHours {
  const text = raw.trim();
  const unparsed: OpeningHours = { kind: 'unparsed', raw };
  if (text.length === 0) return unparsed;

  if (text === '24/7') {
    return {
      kind: 'parsed',
      week: DAYS.map(() => [{ start: 0, end: MINUTES_PER_DAY }]),
      ignoredHolidays: false,
    };
  }

  // Characters that only appear in syntax this subset does not handle.
  if (/[|"+[\]()]/.test(text)) return unparsed;

  const week: Interval[][] = DAYS.map(() => []);
  let ignoredHolidays = false;

  for (const rawRule of text.split(';')) {
    const rule = rawRule.trim();
    if (rule.length === 0) continue;

    const tokens = rule.split(/\s+/);
    let selector: { days: number[]; holiday: boolean } | null = null;
    let rest = tokens;

    const firstToken = tokens[0] ?? '';
    if (/^[A-Z]/.test(firstToken)) {
      selector = parseDays(firstToken);
      if (selector === null) return unparsed;
      rest = tokens.slice(1);
    }

    if (selector !== null && selector.holiday) ignoredHolidays = true;
    // A rule naming only public holidays changes nothing we can evaluate.
    if (selector !== null && selector.days.length === 0) continue;

    const days = selector?.days ?? [0, 1, 2, 3, 4, 5, 6];
    const body = rest.join(' ');

    let intervals: Interval[];
    if (body === 'off' || body === 'closed') {
      intervals = [];
    } else if ((body === '' && selector !== null) || body === '24/7') {
      // `Mo-Fr` alone means open all day on those days.
      intervals = [{ start: 0, end: MINUTES_PER_DAY }];
    } else {
      const parsed = parseTimes(body);
      if (parsed === null) return unparsed;
      intervals = parsed;
    }

    for (const day of days) {
      week[day] = intervals.map((interval) => ({ start: interval.start, end: interval.end }));
    }
  }

  return { kind: 'parsed', week, ignoredHolidays };
}

/**
 * Whether a place is open at a local weekday and time.
 *
 * `unknown` for no hours at all (absent is not open) and for unparsed hours.
 * A range that runs past midnight is checked from the previous day too.
 */
export function openAt(
  hours: OpeningHours | null,
  at: { weekday: number; minutes: number },
): OpenState {
  if (hours === null || hours.kind === 'unparsed') return 'unknown';
  const today = hours.week[at.weekday] ?? [];
  if (today.some((interval) => at.minutes >= interval.start && at.minutes < interval.end)) {
    return 'open';
  }
  const yesterday = hours.week[(at.weekday + 6) % 7] ?? [];
  const spilled = at.minutes + MINUTES_PER_DAY;
  if (yesterday.some((interval) => spilled >= interval.start && spilled < interval.end)) {
    return 'open';
  }
  return 'closed';
}
