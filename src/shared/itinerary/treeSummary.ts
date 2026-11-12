import type { ItineraryView, OtherTransport } from '../domain/itinerary';
import type { TreeNode } from '../domain/types';
import { isoWeekday, utcToWallClock } from '../time/zoned';
import { formatDateRange } from './format';
import { CAMERA_TIME_HINT, dayPhotoText } from '../photos/library';

/**
 * A dated trip in the library tree, as a summary of its plan. Phase 10
 * Requirement 14, design §15.4.
 *
 * Children follow the plan: one group per day holding that day's stops and
 * drives in order, with their local times; then anything whose time is
 * unknown; then everything in the trip that is not in the plan. Nothing in
 * the trip is left out of the tree.
 *
 * Pure. The caller passes the library's own row builders, so a route row
 * looks the same here as anywhere else in the tree.
 */

export interface SummaryBuilders {
  route: (route: { id: string; name: string; distanceM: number | null }, path: string) => TreeNode;
  track: (track: { id: string; name: string; distanceM: number | null }, path: string) => TreeNode;
  waypoint: (waypoint: { id: string; name: string }, path: string) => TreeNode;
}

export interface TripContents {
  routes: readonly { id: string; name: string; distanceM: number | null }[];
  tracks: readonly { id: string; name: string; distanceM: number | null }[];
  waypoints: readonly { id: string; name: string }[];
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRANSPORT: Record<OtherTransport, string> = { ferry: 'Ferry', train: 'Train', flight: 'Flight', other: 'Other transport' };
const GLYPH: Record<OtherTransport, string> = { ferry: '⛴️', train: '🚆', flight: '✈️', other: '↔️' };

function dayName(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${DAYS[isoWeekday(date)] ?? ''} ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`;
}

function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function km(metres: number): string {
  return metres < 10_000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres / 1000)} km`;
}

/** "23–25 Oct 2026 · 3 days · 98 km", "at least" when a drive is unknown. */
export function tripSummary(view: ItineraryView): string {
  const { timeline, itinerary } = view;
  const parts = [formatDateRange(itinerary.startDate, timeline.endDate)];
  if (timeline.endDate !== null) {
    const days = timeline.days.length;
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }
  let metres = 0;
  let unknown = false;
  for (const stop of timeline.stops) {
    if (stop.index === 0 || stop.legKind === 'other') continue;
    if (stop.legDistanceM === null || stop.legDriveSeconds === null) unknown = true;
    else metres += stop.legDistanceM;
  }
  if (metres > 0) parts.push(unknown ? `at least ${km(metres)}` : km(metres));
  return parts.join(' · ');
}

interface Event {
  instant: number | null;
  node: TreeNode;
}

/** Phase 11: a day's photos from the trip's linked folders, by wall-clock date (design §8.4). */
export type PhotoDays = ReadonlyMap<string, { count: number; cameraTime: number }>;

export function itineraryTreeChildren(
  view: ItineraryView,
  contents: TripContents,
  path: string,
  build: SummaryBuilders,
  photoDays: PhotoDays = new Map(),
): TreeNode[] {
  const { stops, timeline } = view;
  const zone = timeline.calendarZone;
  const local = (instant: number | null) => (instant === null ? null : utcToWallClock(instant, zone));
  const routesById = new Map(contents.routes.map((r) => [r.id, r]));
  const waypointsById = new Map(contents.waypoints.map((w) => [w.id, w]));

  const events: Event[] = [];
  for (const [index, stop] of stops.entries()) {
    const timed = timeline.stops[index];
    const isFirst = index === 0;
    const isLast = index === stops.length - 1;

    if (!isFirst) {
      const before = timeline.stops[index - 1];
      const leaves = before?.departure ?? null;
      const id = `${path}/leg:${stop.id}`;
      const time = timed?.legDriveSeconds === null || timed?.legDriveSeconds === undefined ? null : duration(timed.legDriveSeconds);
      let node: TreeNode;
      if (stop.legMode === 'other') {
        const kind = TRANSPORT[stop.legTransport ?? 'other'];
        node = {
          id,
          kind: 'group',
          glyph: GLYPH[stop.legTransport ?? 'other'],
          name: stop.legLabel === null ? kind : `${kind}: ${stop.legLabel}`,
          detail: time ?? 'time not given',
          children: [],
        };
      } else {
        const route = stop.legRouteId === null ? undefined : routesById.get(stop.legRouteId);
        node =
          route === undefined || stop.leg?.fits === false
            ? { id, kind: 'group', glyph: '⚠️', name: `Drive to ${stop.place?.name ?? 'next stop'}`, detail: 'not planned', children: [] }
            : { ...build.route(route, `${path}/leg:${stop.id}`), id, ...(time === null ? {} : { detail: time }) };
      }
      events.push({ instant: leaves, node });
    }

    const arrive = local(timed?.arrival ?? null);
    const leave = local(timed?.departure ?? null);
    const detail = isFirst
      ? leave === null
        ? 'leave —'
        : `leave ${leave.time}`
      : isLast
        ? arrive === null
          ? 'arrive —'
          : `arrive ${arrive.time}`
        : arrive === null || leave === null
          ? 'time unknown'
          : `${arrive.time} – ${leave.date === arrive.date ? '' : `${DAYS[isoWeekday(leave.date)] ?? ''} `}${leave.time}`;
    const waypoint = waypointsById.get(stop.waypointId);
    const id = `${path}/stop:${stop.id}`;
    const node: TreeNode =
      waypoint === undefined
        ? { id, kind: 'group', glyph: '⚠️', name: 'Place deleted', detail, children: [] }
        : { ...build.waypoint(waypoint, id), id, detail };
    events.push({ instant: isFirst ? (timed?.departure ?? null) : (timed?.arrival ?? null), node });
  }

  const children: TreeNode[] = [];
  for (const day of timeline.days) {
    const dayPath = `${path}/day:${day.date}`;
    const inDay = events.filter((e) => e.instant !== null && local(e.instant)?.date === day.date);
    const parts: string[] = [];
    if (day.driveSeconds > 0) parts.push(`${duration(day.driveSeconds)} driving`);
    if (day.otherSeconds > 0) parts.push(`${duration(day.otherSeconds)} other transport`);
    if (day.driveSeconds === 0 && day.otherSeconds === 0) parts.push('no travel');
    const photos = photoDays.get(day.date);
    if (photos !== undefined && photos.count > 0) parts.push(dayPhotoText(photos));
    children.push({
      id: dayPath,
      kind: 'group',
      glyph: '📅',
      name: dayName(day.date),
      detail: parts.join(' · '),
      ...(photos !== undefined && photos.cameraTime > 0 ? { hint: CAMERA_TIME_HINT } : {}),
      defaultExpanded: true,
      children: inDay.map((e) => ({ ...e.node, id: `${dayPath}/${e.node.id.slice(path.length + 1)}` })),
    });
  }

  const unknown = events.filter((e) => e.instant === null);
  if (unknown.length > 0) {
    const groupPath = `${path}/unknown`;
    children.push({
      id: groupPath,
      kind: 'group',
      glyph: '❔',
      name: 'Unknown times',
      detail: 'until every drive is planned',
      defaultExpanded: true,
      children: unknown.map((e) => ({ ...e.node, id: `${groupPath}/${e.node.id.slice(path.length + 1)}` })),
    });
  }

  const usedRoutes = new Set(stops.map((s) => s.legRouteId).filter((id): id is string => id !== null));
  const usedWaypoints = new Set(stops.map((s) => s.waypointId));
  const outPath = `${path}/not-in-plan`;
  const outside = [
    ...contents.routes.filter((r) => !usedRoutes.has(r.id)).map((r) => build.route(r, outPath)),
    ...contents.tracks.map((t) => build.track(t, outPath)),
    ...contents.waypoints.filter((w) => !usedWaypoints.has(w.id)).map((w) => build.waypoint(w, outPath)),
  ];
  if (outside.length > 0) {
    children.push({ id: outPath, kind: 'group', glyph: '🗂️', name: 'Not in the plan', children: outside });
  }
  return children;
}
