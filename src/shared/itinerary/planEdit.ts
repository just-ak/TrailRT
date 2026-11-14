/**
 * Where an edit to the plan's order lands. Phase 14 Requirement 11.4 and
 * 11.5, design §4.9. Pure, so the arithmetic of a drag is tested without one.
 */

/**
 * The index a stop moves to when it is dragged from `from` and dropped before
 * the stop now at `before` (`before` may be the number of stops, for the end).
 * `itinerary:moveStop` takes the index the stop has after the move. Null when
 * the drop leaves it where it is.
 */
export function moveTarget(from: number, before: number): number | null {
  const to = before > from ? before - 1 : before;
  return to === from ? null : to;
}

/**
 * Where Add in a day card puts a new stop: after the selected stop when it is
 * one of that day's, otherwise after the day's last stop. A day with no stops
 * of its own adds after the last stop before it, or at the start.
 */
export function addIndex(dayStops: readonly number[], selected: number | null, before: number): number {
  if (selected !== null && dayStops.includes(selected)) return selected + 1;
  const last = dayStops.at(-1);
  return last === undefined ? before : last + 1;
}

/** The stop a day row stands for: its own for a stop, the one it arrives at for a drive. */
export function rowStopId(key: string): { stopId: string; kind: 'stop' | 'leg' } | null {
  const [kind, id] = key.split(':');
  if ((kind === 'stop' || kind === 'leg') && id !== undefined && id !== '') return { stopId: id, kind };
  return null;
}

/** The view as these helpers need it. */
export interface PlanShape {
  itinerary: { startDate: string };
  stops: readonly { id: string; kind: 'stop' | 'route' | 'day' }[];
  timeline: { calendarZone: string; stops: readonly { arrival: number | null; departure: number | null }[] };
}

/**
 * The day each entry is on (Phase 14 Requirement 15). An entry whose time is
 * known is on that date. One whose time is not yet known (a drive before it
 * not planned) is on the day it follows in the plan: the first day, or the
 * day the last day break before it started. A day break whose own time is
 * unknown starts the day after the one before it.
 */
export function entryDays(view: PlanShape, dateOf: (instant: number, zone: string) => string, nextDate: (date: string) => string): (string | null)[] {
  const zone = view.timeline.calendarZone;
  const firstReal = view.stops.findIndex((s) => s.kind !== 'day');
  let current = view.itinerary.startDate;
  return view.stops.map((stop, index) => {
    const timed = view.timeline.stops[index];
    const at = index === firstReal && stop.kind !== 'route' ? (timed?.departure ?? null) : (timed?.arrival ?? null);
    const known = at === null ? null : dateOf(at, zone);
    if (stop.kind === 'day') current = known ?? nextDate(current);
    else if (known !== null) current = known;
    return known ?? current;
  });
}

/**
 * Where Add to the Plan puts a photo (Requirement 18.4): after the last entry
 * of the day it was taken, or at the end when the plan has no such day or the
 * photo no date.
 */
export function photoStopIndex(
  view: PlanShape,
  day: string | null,
  dateOf: (instant: number, zone: string) => string,
  nextDate: (date: string) => string,
): number {
  if (day === null) return view.stops.length;
  const { last } = dayEntries(view, day, dateOf, nextDate);
  return last === null ? view.stops.length : last + 1;
}

/** The entries a day holds, and the index of its last, by `entryDays`. */
export function dayEntries(
  view: PlanShape,
  date: string,
  dateOf: (instant: number, zone: string) => string,
  nextDate: (date: string) => string,
): { entries: string[]; last: number | null } {
  const days = entryDays(view, dateOf, nextDate);
  const entries: string[] = [];
  let last: number | null = null;
  view.stops.forEach((stop, index) => {
    if (days[index] !== date) return;
    entries.push(stop.id);
    last = index;
  });
  return { entries, last };
}
