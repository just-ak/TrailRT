import type { ItineraryView } from '../domain/itinerary';
import { shortDay } from '../library/tripGroups';
import { utcToWallClock } from '../time/zoned';

/**
 * What a change to one stop's stay would move, before it is made. Phase 14
 * Requirement 5.3, design §4.8.
 *
 * Worked from the timeline the main process already computed rather than by
 * running it again: a longer stay pushes every later time back by the same
 * amount until a night's stay, whose leaving time is fixed by the clock, takes
 * it up. Pure, so it is tested without a window.
 */

export interface StayConsequence {
  /** The next stop, whose arrival moves. Null at the last stop. */
  nextName: string | null;
  /** Its arrival now and after the change, `HH:mm` in its own zone. */
  before: string | null;
  after: string | null;
  /**
   * Whether later days change: `same` when a night's stay takes the change up
   * on the same date, `change` when it does not, `unknown` when a time on the
   * way is unknown.
   */
  laterDays: 'same' | 'change' | 'unknown';
  /** The date the change stays within, for "nothing after Friday changes". */
  day: string | null;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function stayConsequence(
  view: ItineraryView,
  stopId: string,
  change: { minutes?: number | undefined; days?: number | undefined },
): StayConsequence | null {
  const index = view.stops.findIndex((s) => s.id === stopId);
  const stop = view.stops[index];
  if (index < 0 || stop === undefined) return null;

  let shift: number;
  if (change.days !== undefined) shift = (change.days - (stop.durationDays ?? 1)) * DAY;
  else if (change.minutes !== undefined) shift = (change.minutes - (stop.durationMinutes ?? 0)) * MINUTE;
  else return null;
  if (shift === 0) return null;

  const next = view.stops[index + 1];
  const timedNext = view.timeline.stops[index + 1];
  if (next === undefined || timedNext === undefined) {
    return { nextName: null, before: null, after: null, laterDays: 'same', day: null };
  }
  const name = next.place?.name ?? 'The next stop';
  if (timedNext.arrival === null) {
    return { nextName: name, before: null, after: null, laterDays: 'unknown', day: null };
  }
  const moved = timedNext.arrival + shift;
  const before = utcToWallClock(timedNext.arrival, timedNext.zone);
  const after = utcToWallClock(moved, timedNext.zone);

  // A change of whole days moves everything after it.
  if (change.days !== undefined) {
    return { nextName: name, before: before.time, after: after.time, laterDays: 'change', day: null };
  }

  // Walk on to the first night's stay: it absorbs the change if the arrival
  // there stays on the same date.
  for (let j = index + 1; j < view.stops.length; j += 1) {
    const later = view.stops[j];
    const timed = view.timeline.stops[j];
    if (later === undefined || timed === undefined) break;
    if (timed.arrival === null) return { nextName: name, before: before.time, after: after.time, laterDays: 'unknown', day: null };
    if (later.durationKind === 'days') {
      const was = utcToWallClock(timed.arrival, timed.zone).date;
      const will = utcToWallClock(timed.arrival + shift, timed.zone).date;
      return { nextName: name, before: before.time, after: after.time, laterDays: was === will ? 'same' : 'change', day: was };
    }
  }
  // No night's stay after it: the trip's last day is the one that moves.
  const last = view.timeline.stops.at(-1);
  const lastDate = last?.arrival == null ? null : utcToWallClock(last.arrival, last.zone).date;
  return { nextName: name, before: before.time, after: after.time, laterDays: 'same', day: lastDate };
}

/** "Staying 3 h instead would move Leek to 13:30. Nothing after Fri 13 Nov changes." */
export function consequenceText(c: StayConsequence): string {
  if (c.nextName === null) return 'Nothing comes after this stop, so nothing else moves.';
  if (c.before === null || c.after === null) return `${c.nextName}’s time is not known yet, so what this moves cannot be said.`;
  const first = `${c.nextName} would arrive at ${c.after} instead of ${c.before}.`;
  if (c.laterDays === 'unknown') return `${first} Later times are not known yet.`;
  if (c.laterDays === 'change') return `${first} Later days move too.`;
  return c.day === null ? first : `${first} Nothing after ${shortDay(c.day)} changes.`;
}

/**
 * The trip's one-line check (Requirement 4.2): whether each day fits the
 * daily driving limit. Null when no limit is set, so nothing is claimed.
 */
export function dayLimitText(view: ItineraryView): { ok: boolean; text: string } | null {
  const cap = view.itinerary.maxDriveMinutes;
  if (cap === null) return null;
  const limit = cap % 60 === 0 ? `${cap / 60} h` : `${Math.floor(cap / 60)} h ${cap % 60} min`;
  const over = view.timeline.days.filter((d) => d.overDailyCap);
  if (over.length > 0) {
    const days = over.map((d) => shortDay(d.date)).join(', ');
    return { ok: false, text: `Over your ${limit} limit: ${days}` };
  }
  if (view.timeline.days.some((d) => d.incomplete)) return { ok: true, text: `Within your ${limit} limit so far; some drives are not timed` };
  return { ok: true, text: `Every day is within your ${limit} limit` };
}
