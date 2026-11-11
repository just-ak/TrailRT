/**
 * Wording for dates in an itinerary. Pure, so the tree, the properties panel
 * and the calendar all say the same thing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: string): { day: number; month: string; year: number } {
  const [year, month, day] = date.split('-').map(Number);
  return { day: day ?? 1, month: MONTHS[(month ?? 1) - 1] ?? '', year: year ?? 0 };
}

/** `12 May 2027` */
export function formatDate(date: string): string {
  const p = parts(date);
  return `${p.day} ${p.month} ${p.year}`;
}

/**
 * A trip's dates, as short as they can be and still unambiguous:
 * `12–16 May 2027`, `28 Jun – 2 Jul 2027`, `30 Dec 2026 – 2 Jan 2027`.
 * With no known end: `from 12 May 2027`, because the end is unknown, not the
 * same day.
 */
export function formatDateRange(start: string, end: string | null): string {
  if (end === null) return `from ${formatDate(start)}`;
  if (end === start) return formatDate(start);
  const a = parts(start);
  const b = parts(end);
  if (a.year !== b.year) return `${formatDate(start)} – ${formatDate(end)}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day}–${b.day} ${b.month} ${b.year}`;
}

/** A stop's duration in words: `1 h 30 min`, `45 min`, `2 days`. */
export function formatStopDuration(stop: {
  durationKind: 'hours' | 'days';
  durationMinutes: number | null;
  durationDays: number | null;
}): string {
  if (stop.durationKind === 'days') {
    const days = stop.durationDays ?? 1;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  const total = stop.durationMinutes ?? 0;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
