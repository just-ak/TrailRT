import type { ItineraryView, OtherTransport } from '../domain/itinerary';
import { daysBetween, utcToWallClock } from '../time/zoned';
import { shortDay } from '../library/tripGroups';

/**
 * A dated trip's Plan tab, day by day. Phase 14, design §3.1.
 *
 * The same grouping the library tree used for a dated trip (Phase 10
 * Requirement 14), as data rather than tree nodes: each day's stops and
 * drives in order with their local times, then anything whose time is
 * unknown, then what is in the trip but not in the plan. A recorded track
 * with timestamps is placed on the day it was recorded. Nothing in the trip
 * is left out.
 */

export type DayRowKind = 'stop' | 'leg' | 'other' | 'unplanned' | 'missing' | 'track';

export interface DayRow {
  key: string;
  kind: DayRowKind;
  /** What selecting the row selects. Null for a place that was deleted, or a crossing with no object. */
  ref: { kind: 'waypoint' | 'route' | 'track'; id: string } | null;
  name: string;
  /** "leave 09:00", "09:35–12:00", "12:30 · 1 night", "10:00 · 35 min", "not planned". */
  time: string;
  /** Sort key within the day; null when unknown. */
  at: number | null;
}

export interface DayCard {
  date: string;
  label: string;
  driveSeconds: number;
  distanceM: number;
  otherSeconds: number;
  rows: DayRow[];
}

export interface PlanCards {
  days: DayCard[];
  unknown: DayRow[];
  notInPlan: DayRow[];
}

export interface PlanContents {
  routes: readonly { id: string; name: string; distanceM: number | null }[];
  tracks: readonly { id: string; name: string; startedAt: number | null; endedAt: number | null }[];
  waypoints: readonly { id: string; name: string }[];
}

const TRANSPORT: Record<OtherTransport, string> = { ferry: 'Ferry', train: 'Train', flight: 'Flight', other: 'Other transport' };

export function durationText(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function dayCards(view: ItineraryView, contents: PlanContents): PlanCards {
  const { stops, timeline } = view;
  const zone = timeline.calendarZone;
  const local = (instant: number | null) => (instant === null ? null : utcToWallClock(instant, zone));
  const routesById = new Map(contents.routes.map((r) => [r.id, r]));
  const waypointsById = new Map(contents.waypoints.map((w) => [w.id, w]));

  const rows: DayRow[] = [];
  for (const [index, stop] of stops.entries()) {
    const timed = timeline.stops[index];
    const isFirst = index === 0;
    const isLast = index === stops.length - 1;
    const name = stop.place?.name ?? waypointsById.get(stop.waypointId)?.name ?? 'Place deleted';

    if (!isFirst) {
      const leaves = timeline.stops[index - 1]?.departure ?? null;
      const leaveTime = local(leaves)?.time ?? null;
      const seconds = timed?.legDriveSeconds ?? null;
      if (stop.legMode === 'other') {
        const kind = TRANSPORT[stop.legTransport ?? 'other'];
        rows.push({
          key: `leg:${stop.id}`,
          kind: 'other',
          ref: null,
          name: stop.legLabel === null ? kind : `${kind}: ${stop.legLabel}`,
          time: [leaveTime, seconds === null ? 'time not given' : durationText(seconds)].filter((x) => x !== null).join(' · '),
          at: leaves,
        });
      } else {
        const route = stop.legRouteId === null ? undefined : routesById.get(stop.legRouteId);
        const planned = route !== undefined && stop.leg?.fits !== false;
        rows.push({
          key: `leg:${stop.id}`,
          kind: planned ? 'leg' : 'unplanned',
          ref: planned ? { kind: 'route', id: route.id } : null,
          name: planned ? route.name : `Drive to ${name}`,
          time: planned
            ? [leaveTime, seconds === null ? null : durationText(seconds)].filter((x) => x !== null).join(' · ')
            : 'not planned',
          at: leaves,
        });
      }
    }

    const arrive = local(timed?.arrival ?? null);
    const leave = local(timed?.departure ?? null);
    let time: string;
    if (isFirst) time = leave === null ? 'leave —' : `leave ${leave.time}`;
    else if (isLast) time = arrive === null ? 'arrive —' : `arrive ${arrive.time}`;
    else if (arrive === null || leave === null) time = 'time unknown';
    else if (leave.date === arrive.date) time = `${arrive.time}–${leave.time}`;
    else {
      const nights = daysBetween(arrive.date, leave.date);
      time = `${arrive.time} · ${nights} night${nights === 1 ? '' : 's'}`;
    }
    rows.push({
      key: `stop:${stop.id}`,
      kind: stop.place === null ? 'missing' : 'stop',
      ref: stop.place === null ? null : { kind: 'waypoint', id: stop.place.id },
      name,
      time,
      at: isFirst ? (timed?.departure ?? null) : (timed?.arrival ?? null),
    });
  }

  // Recorded tracks land on the day they were recorded.
  const placedTracks = new Set<string>();
  for (const track of contents.tracks) {
    if (track.startedAt === null || track.endedAt === null) continue;
    const from = local(track.startedAt);
    const to = local(track.endedAt);
    rows.push({
      key: `track:${track.id}`,
      kind: 'track',
      ref: { kind: 'track', id: track.id },
      name: track.name,
      time: `${from?.time ?? ''}–${to?.time ?? ''} recorded`,
      at: track.startedAt,
    });
    placedTracks.add(track.id);
  }

  const days: DayCard[] = [];
  const used = new Set<string>();
  for (const day of timeline.days) {
    const inDay = rows
      .filter((r) => r.at !== null && local(r.at)?.date === day.date)
      .toSorted((a, b) => (a.at ?? 0) - (b.at ?? 0));
    for (const r of inDay) used.add(r.key);
    days.push({
      date: day.date,
      label: shortDay(day.date),
      driveSeconds: day.driveSeconds,
      distanceM: day.driveDistanceM,
      otherSeconds: day.otherSeconds,
      rows: inDay,
    });
  }

  // A track recorded outside the trip's days is not in the plan.
  const unknown = rows.filter((r) => !used.has(r.key) && r.kind !== 'track');
  const usedRoutes = new Set(stops.map((s) => s.legRouteId).filter((id): id is string => id !== null));
  const usedWaypoints = new Set(stops.map((s) => s.waypointId));
  const notInPlan: DayRow[] = [
    ...contents.routes
      .filter((r) => !usedRoutes.has(r.id))
      .map((r) => ({ key: `route:${r.id}`, kind: 'leg' as const, ref: { kind: 'route' as const, id: r.id }, name: r.name, time: '', at: null })),
    ...contents.tracks
      .filter((t) => !used.has(`track:${t.id}`))
      .map((t) => ({
        key: `track:${t.id}`,
        kind: 'track' as const,
        ref: { kind: 'track' as const, id: t.id },
        name: t.name,
        time: placedTracks.has(t.id) ? 'recorded outside the trip' : '',
        at: null,
      })),
    ...contents.waypoints
      .filter((w) => !usedWaypoints.has(w.id))
      .map((w) => ({ key: `waypoint:${w.id}`, kind: 'stop' as const, ref: { kind: 'waypoint' as const, id: w.id }, name: w.name, time: '', at: null })),
  ];
  return { days, unknown, notInPlan };
}
