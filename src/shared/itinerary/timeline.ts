import type { Itinerary, ItineraryStop } from '../domain/itinerary';
import type { LatLon } from '../geo/distance';
import type { TransportMode } from '../routing/RoutingProvider';
import { travelSpeedKmh } from '../routing/travelTime';
import type { TimeZoneResolver } from '../time/timeZones';
import {
  addDays,
  utcToWallClock,
  wallClockToUtc,
  type ZonedWallClock,
} from '../time/zoned';

/**
 * Arrival and departure times for every stop, derived from the plan.
 *
 * Pure and recomputed on every read. Nothing here is stored, so the times can
 * never disagree with the durations that produced them (Requirement 3.5).
 *
 * The rules, from the Phase 10 design §2.3 and §3:
 *
 * - The trip leaves the first stop at the start date and time.
 * - Arrival = previous departure + the leg's driving time.
 * - An **hours** stop leaves after its duration, as elapsed time. With
 *   `departAt` it leaves at that time on its arrival date instead, and if that
 *   is too early for its duration the conflict is flagged and the fixed time
 *   kept (Requirement 2.5).
 * - A **day-stay** leaves N calendar days after its arrival date, at its
 *   departure time, so a stay across a clock change still leaves at 09:00.
 * - `arriveBy` is a check only. It never moves anything.
 * - A leg with no route has no driving time, so its arrival, and every time
 *   after it, is **unknown** (`null`), never zero (Requirement 3.1).
 *
 * Leg times use `travelSpeedKmh` for the leg's mode, so a driving leg is never
 * timed at the walking planning speed (Requirement 3.3).
 */

export interface TimelineLeg {
  /** Null for a leg not travelled by road. */
  routeId: string | null;
  /** Null when the route has no geometry to measure. */
  distanceM: number | null;
  mode: TransportMode;
  /**
   * `other`: not by road (ferry, train, flight), timed by `minutes` and never
   * counted as driving. Absent means `road`. Phase 10 feedback, design §15.3.
   */
  kind?: 'road' | 'other';
  minutes?: number | null;
}

export interface TimelineStopInput {
  stop: ItineraryStop;
  /** Null when the stop's waypoint no longer exists. */
  position: LatLon | null;
  /** The leg arriving at this stop. Ignored on the first stop. */
  leg: TimelineLeg | null;
}

export interface TimelineInput {
  itinerary: Itinerary;
  stops: readonly TimelineStopInput[];
  /** The walking planning speed from Settings, for walking legs only. */
  walkingSpeedKmh: number;
  /** Shown for stops whose zone is unknown: the computer's own zone. */
  fallbackZone: string;
}

export type StopFlag =
  /** No route is linked for the leg arriving here, or it has no length. */
  | 'unplanned-leg'
  /** An earlier leg is unplanned, so this stop's times cannot be known. */
  | 'unknown-time'
  /** The stop's waypoint was deleted or moved to another trip. */
  | 'location-deleted'
  /** Arrival is later than `arriveBy`. */
  | 'arrive-by-missed'
  /** `departAt` comes before arrival plus the stop's duration. */
  | 'depart-at-too-early'
  /** The leg is not by road and has no travel time, so arrival is unknown. */
  | 'no-travel-time'
  /** The stop is outside every polygon the zone table knows. */
  | 'zone-unknown';

export interface TimedStop {
  stopId: string;
  index: number;
  /** The zone its times are shown in: its own, or the fallback. */
  zone: string;
  zoneKnown: boolean;
  arrival: number | null;
  departure: number | null;
  arrivalLocal: ZonedWallClock | null;
  departureLocal: ZonedWallClock | null;
  /** Driving time of the leg arriving here, in seconds. */
  legDriveSeconds: number | null;
  legDistanceM: number | null;
  /** The speed the leg was timed at, so the UI can say which it was. Null for other transport. */
  legSpeedKmh: number | null;
  legMode: TransportMode | null;
  /** Whether the leg arriving here is by road or other transport; null on the first stop. */
  legKind: 'road' | 'other' | null;
  flags: StopFlag[];
}

export interface TimelineDay {
  /** Local date in the calendar zone. */
  date: string;
  driveSeconds: number;
  driveDistanceM: number;
  /** Time on ferries, trains and flights departing this day. Not driving. */
  otherSeconds: number;
  /** Where the traveller is at the midnight ending this day, if known. */
  nightStopId: string | null;
  overDailyCap: boolean;
  /** Some of this day's times are unknown, so its totals are partial. */
  incomplete: boolean;
}

export interface Timeline {
  /** The first stop's zone. Days are laid out on its dates. */
  calendarZone: string;
  calendarZoneKnown: boolean;
  stops: TimedStop[];
  days: TimelineDay[];
  /** The last arrival's date in the calendar zone; null when unknown. */
  endDate: string | null;
  /** True when every stop's times are known. */
  complete: boolean;
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

/** Driving seconds for a leg, or null when it cannot be timed. */
export function legDriveSeconds(
  leg: TimelineLeg | null,
  walkingSpeedKmh: number,
): { seconds: number; speedKmh: number | null } | null {
  if (leg !== null && leg.kind === 'other') {
    const minutes = leg.minutes ?? null;
    return minutes !== null && minutes > 0 ? { seconds: minutes * 60, speedKmh: null } : null;
  }
  if (leg === null || leg.distanceM === null || !(leg.distanceM > 0)) return null;
  const speedKmh = travelSpeedKmh(leg.mode, walkingSpeedKmh);
  if (!(speedKmh > 0)) return null;
  return { seconds: leg.distanceM / (speedKmh / 3.6), speedKmh };
}

function local(instant: number | null, zone: string): ZonedWallClock | null {
  return instant === null ? null : utcToWallClock(instant, zone);
}

export function computeTimeline(
  input: TimelineInput,
  resolveZone: TimeZoneResolver,
): Timeline {
  const { itinerary } = input;
  const count = input.stops.length;

  const zones = input.stops.map((entry) => {
    const resolved = entry.position === null ? null : resolveZone(entry.position);
    return { zone: resolved ?? input.fallbackZone, known: resolved !== null };
  });

  const calendarZone = zones[0]?.zone ?? input.fallbackZone;
  const calendarZoneKnown = zones[0]?.known ?? false;

  const stops: TimedStop[] = [];
  let previousDeparture: number | null = null;

  for (const [index, entry] of input.stops.entries()) {
    const { stop } = entry;
    const zoneInfo = zones[index] ?? { zone: input.fallbackZone, known: false };
    const zone = zoneInfo.zone;
    const flags: StopFlag[] = [];
    if (entry.position === null) flags.push('location-deleted');
    if (!zoneInfo.known) flags.push('zone-unknown');

    const isFirst = index === 0;
    const isLast = index === count - 1;

    let arrival: number | null = null;
    let departure: number | null = null;
    let timed: { seconds: number; speedKmh: number | null } | null = null;

    if (isFirst) {
      departure = wallClockToUtc(
        { date: itinerary.startDate, time: itinerary.startTime },
        zone,
      );
    } else {
      timed = legDriveSeconds(entry.leg, input.walkingSpeedKmh);
      if (timed === null) flags.push(entry.leg?.kind === 'other' ? 'no-travel-time' : 'unplanned-leg');
      if (previousDeparture === null) flags.push('unknown-time');
      if (timed !== null && previousDeparture !== null) {
        // Whole seconds: an estimate has no business carrying floating-point
        // dust into an instant that is later compared and displayed.
        arrival = previousDeparture + Math.round(timed.seconds) * MS_PER_SECOND;
      }
    }

    const arrivalLocal = local(arrival, zone);

    if (arrival !== null && arrivalLocal !== null && stop.arriveBy !== null) {
      const deadline = wallClockToUtc({ date: arrivalLocal.date, time: stop.arriveBy }, zone);
      if (arrival > deadline) flags.push('arrive-by-missed');
    }

    if (!isFirst && !isLast && arrival !== null && arrivalLocal !== null) {
      if (stop.durationKind === 'days') {
        const days = Math.max(1, stop.durationDays ?? 1);
        departure = wallClockToUtc(
          {
            date: addDays(arrivalLocal.date, days),
            time: stop.departTime ?? itinerary.defaultDepart,
          },
          zone,
        );
      } else {
        const afterDuration: number = arrival +(stop.durationMinutes ?? 0) * MS_PER_MINUTE;
        if (stop.departAt === null) {
          departure = afterDuration;
        } else {
          // The fixed time is kept even when it is too early. Moving it would
          // be the silent change Requirement 2.5 forbids.
          departure = wallClockToUtc({ date: arrivalLocal.date, time: stop.departAt }, zone);
          if (departure < afterDuration) flags.push('depart-at-too-early');
        }
      }
    }

    stops.push({
      stopId: stop.id,
      index,
      zone,
      zoneKnown: zoneInfo.known,
      arrival,
      departure,
      arrivalLocal,
      departureLocal: local(departure, zone),
      legDriveSeconds: timed?.seconds ?? null,
      legDistanceM: isFirst ? null : (entry.leg?.distanceM ?? null),
      legSpeedKmh: timed?.speedKmh ?? null,
      legMode: isFirst ? null : (entry.leg?.mode ?? null),
      legKind: isFirst ? null : (entry.leg?.kind ?? 'road'),
      flags,
    });

    previousDeparture = isLast ? null : departure;
  }

  const complete = stops.every((s, i) => (i === 0 ? s.departure !== null : s.arrival !== null));
  const last = stops.at(-1);
  const endDate =
    last === undefined
      ? null
      : last.index === 0
        ? (local(last.departure, calendarZone)?.date ?? null)
        : (local(last.arrival, calendarZone)?.date ?? null);

  return {
    calendarZone,
    calendarZoneKnown,
    stops,
    days: buildDays(stops, itinerary, calendarZone, complete, endDate),
    endDate,
    complete,
  };
}

/**
 * Groups the timeline into local dates.
 *
 * A leg's driving counts on the date it departs: a drive that starts at 23:30
 * belongs to that evening. Totals are summed only from legs whose times are
 * known; a day after the first unknown time is marked incomplete rather than
 * shown with totals that look final.
 */
function buildDays(
  stops: readonly TimedStop[],
  itinerary: Itinerary,
  zone: string,
  complete: boolean,
  endDate: string | null,
): TimelineDay[] {
  const first = stops[0];
  if (first === undefined || first.departure === null) return [];

  const startDate = utcToWallClock(first.departure, zone).date;

  // The last date anything is known to happen on.
  let lastKnown = startDate;
  for (const stop of stops) {
    for (const instant of [stop.arrival, stop.departure]) {
      if (instant === null) continue;
      const date = utcToWallClock(instant, zone).date;
      if (date > lastKnown) lastKnown = date;
    }
  }
  const finalDate = endDate ?? lastKnown;

  const days: TimelineDay[] = [];
  for (let date = startDate; date <= finalDate; date = addDays(date, 1)) {
    days.push({
      date,
      driveSeconds: 0,
      driveDistanceM: 0,
      otherSeconds: 0,
      nightStopId: null,
      overDailyCap: false,
      incomplete: !complete && date >= lastKnown,
    });
    if (days.length > 400) break; // a guard against a corrupt plan, never a real trip
  }

  const byDate = new Map(days.map((day) => [day.date, day]));

  for (let index = 1; index < stops.length; index += 1) {
    const stop = stops[index];
    const previous = stops[index - 1];
    if (stop === undefined || previous === undefined) continue;
    if (previous.departure === null || stop.legDriveSeconds === null) continue;
    const day = byDate.get(utcToWallClock(previous.departure, zone).date);
    if (day === undefined) continue;
    if (stop.legKind === 'other') {
      day.otherSeconds += stop.legDriveSeconds;
      continue;
    }
    day.driveSeconds += stop.legDriveSeconds;
    day.driveDistanceM += stop.legDistanceM ?? 0;
  }

  for (const day of days) {
    if (itinerary.maxDriveMinutes !== null) {
      day.overDailyCap = day.driveSeconds > itinerary.maxDriveMinutes * 60;
    }
    const midnight = wallClockToUtc({ date: addDays(day.date, 1), time: '00:00' }, zone);
    day.nightStopId = stopAt(stops, midnight);
  }

  return days;
}

/**
 * The stop the traveller is at at an instant, or null when driving or unknown.
 *
 * The first stop counts from the start; the last stop from its arrival on.
 */
export function stopAt(stops: readonly TimedStop[], instant: number): string | null {
  for (const [index, stop] of stops.entries()) {
    const from = index === 0 ? Number.NEGATIVE_INFINITY : stop.arrival;
    const until = index === stops.length - 1 ? Number.POSITIVE_INFINITY : stop.departure;
    // An unknown time means nothing from here on can be placed.
    if (from === null || until === null) return null;
    if (instant >= from && instant < until) return stop.stopId;
  }
  // Between a departure and the next arrival: on the road.
  return null;
}

/**
 * When the traveller is expected to pass a point some way into a leg.
 *
 * For "you reach this fuel station at about 14:20". Null when the leg's
 * departure or speed is unknown.
 */
export function timeAlongLeg(
  timeline: Timeline,
  arrivingStopIndex: number,
  alongLegM: number,
): number | null {
  const stop = timeline.stops[arrivingStopIndex];
  const previous = timeline.stops[arrivingStopIndex - 1];
  if (stop === undefined || previous === undefined) return null;
  if (previous.departure === null || stop.legSpeedKmh === null) return null;
  return previous.departure + (alongLegM / (stop.legSpeedKmh / 3.6)) * MS_PER_SECOND;
}
