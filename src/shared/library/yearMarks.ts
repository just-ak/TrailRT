import type { TripOverview } from '../domain/library';
import { addDays, daysBetween } from '../time/zoned';

/**
 * The year view's marked days and its today and tomorrow. Phase 14,
 * Requirement 4.1 and view 1 of the mock-ups.
 *
 * A trip marks the days from its start to its end. A trip whose end is not
 * known marks only its first day, the one thing that is known; nothing is
 * guessed past it.
 */

/** Distinguishable on the light and dark panel; a trip keeps its colour all year. */
export const TRIP_COLOURS = ['#2563eb', '#0d9488', '#b45309', '#7c3aed', '#db2777', '#0891b2', '#65a30d', '#64748b'];

export interface YearMarks {
  year: number;
  /** `YYYY-MM-DD` to the trips on it, in start order. */
  days: Map<string, string[]>;
  /** Trip id to its colour, by start order across the year. */
  colours: Map<string, string>;
  /** Trips with a day in the year. */
  trips: TripOverview[];
}

function tripDays(trip: TripOverview): string[] {
  if (trip.startDate === null) return [];
  const last = trip.endDate ?? trip.startDate;
  const span = Math.max(0, daysBetween(trip.startDate, last));
  return Array.from({ length: span + 1 }, (_, i) => addDays(trip.startDate ?? last, i));
}

export function yearMarks(trips: readonly TripOverview[], year: number): YearMarks {
  const prefix = `${year}-`;
  const dated = trips
    .filter((t) => t.startDate !== null)
    .toSorted((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.name.localeCompare(b.name));
  const days = new Map<string, string[]>();
  const inYear: TripOverview[] = [];
  for (const trip of dated) {
    const mine = tripDays(trip).filter((d) => d.startsWith(prefix));
    if (mine.length === 0) continue;
    inYear.push(trip);
    for (const day of mine) days.set(day, [...(days.get(day) ?? []), trip.id]);
  }
  const colours = new Map(inYear.map((t, i) => [t.id, TRIP_COLOURS[i % TRIP_COLOURS.length] ?? '#64748b']));
  return { year, days, colours, trips: inYear };
}

/** Trips with a day on `date`, soonest start first. */
export function tripsOn(trips: readonly TripOverview[], date: string): TripOverview[] {
  return trips
    .filter((t) => tripDays(t).includes(date))
    .toSorted((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
}

/** Days in a month, for the grid: 28 to 31. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
