import type { TripOverview } from '../domain/library';
import { formatDateRange } from '../itinerary/format';
import { addDays, isoWeekday } from '../time/zoned';

/**
 * The trip list's groups and second lines. Phase 14, Requirement 2.
 *
 * Coming up: dated trips that end today or later, soonest first. Ideas: trips
 * with no dates, most recently changed first. Then past trips by year, newest
 * first. A trip whose end is unknown counts as ending on its first day, so a
 * trip with dates but no stops yet is not lost among the past.
 */

export interface TripRow {
  trip: TripOverview;
  /** "Today", "Tomorrow", or null. */
  when: 'Today' | 'Tomorrow' | null;
  /** The second line: dates and size, or what is in it, or "Empty". */
  meta: string;
}

export interface TripGroup {
  key: string;
  label: string;
  rows: TripRow[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** `Thu 12 Nov` */
export function shortDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${DAYS[isoWeekday(date)] ?? ''} ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`;
}

export function distanceText(metres: number): string {
  return metres < 10_000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 1000)} km`;
}

/** What is in a trip, in words, or "Empty". */
export function contentsText(counts: TripOverview['counts']): string {
  const parts: string[] = [];
  if (counts.routes > 0) parts.push(plural(counts.routes, 'route'));
  if (counts.tracks > 0) parts.push(plural(counts.tracks, 'track'));
  if (counts.waypoints > 0) parts.push(plural(counts.waypoints, 'waypoint'));
  if (counts.photos > 0) parts.push(plural(counts.photos, 'photo'));
  return parts.length === 0 ? 'Empty' : parts.join(' · ');
}

export function tripMeta(trip: TripOverview, when: TripRow['when']): string {
  const archived = trip.status === 'archived' ? ' · archived' : '';
  if (trip.startDate === null) return contentsText(trip.counts) + archived;
  const parts: string[] = [];
  if (when !== null) parts.push(when);
  if (trip.endDate === null) {
    parts.push(`From ${shortDay(trip.startDate)}`);
    parts.push(trip.counts.waypoints === 0 ? 'no stops yet' : 'times unknown');
  } else {
    parts.push(trip.endDate === trip.startDate ? shortDay(trip.startDate) : formatDateRange(trip.startDate, trip.endDate));
    if (trip.days !== null) parts.push(plural(trip.days, 'day'));
  }
  if (trip.distanceM !== null && trip.distanceM > 0) parts.push(distanceText(trip.distanceM));
  return parts.join(' · ') + archived;
}

function byName(a: TripOverview, b: TripOverview): number {
  return a.name.localeCompare(b.name);
}

function whenOf(trip: TripOverview, today: string): TripRow['when'] {
  if (trip.startDate === today) return 'Today';
  if (trip.startDate === addDays(today, 1)) return 'Tomorrow';
  return null;
}

export function groupTrips(trips: readonly TripOverview[], today: string): TripGroup[] {
  const coming: TripOverview[] = [];
  const ideas: TripOverview[] = [];
  const past = new Map<string, TripOverview[]>();
  for (const trip of trips) {
    if (trip.startDate === null) {
      ideas.push(trip);
      continue;
    }
    const last = trip.endDate ?? trip.startDate;
    if (last >= today) {
      coming.push(trip);
      continue;
    }
    const year = trip.startDate.slice(0, 4);
    const bucket = past.get(year);
    if (bucket === undefined) past.set(year, [trip]);
    else bucket.push(trip);
  }
  const row = (trip: TripOverview): TripRow => {
    const when = whenOf(trip, today);
    return { trip, when, meta: tripMeta(trip, when) };
  };
  const groups: TripGroup[] = [];
  if (coming.length > 0) {
    groups.push({
      key: 'coming',
      label: 'Coming up',
      rows: coming.toSorted((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || byName(a, b)).map(row),
    });
  }
  if (ideas.length > 0) {
    groups.push({ key: 'ideas', label: 'Ideas · no dates', rows: ideas.toSorted((a, b) => b.updatedAt - a.updatedAt || byName(a, b)).map(row) });
  }
  for (const year of [...past.keys()].toSorted((a, b) => b.localeCompare(a))) {
    const rows = (past.get(year) ?? []).toSorted((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || byName(a, b));
    groups.push({ key: `year:${year}`, label: year, rows: rows.map(row) });
  }
  return groups;
}
