import type Database from 'better-sqlite3';
import type { ItineraryView } from '@shared/domain/itinerary';
import {
  buildLineIndex,
  corridorBox,
  project,
  uncoveredStretches,
  type CorridorSection,
  type LineIndex,
} from '@shared/geo/corridor';
import { haversineDistance, type BoundingBox, type LatLon } from '@shared/geo/distance';
import { pointInRings, ringsBoundingBox } from '@shared/geo/polygon';
import { checkRange, type RangeCheckResult } from '@shared/itinerary/rangeCheck';
import { timeAlongLeg } from '@shared/itinerary/timeline';
import { extractAttributes } from '@shared/poi/attributes';
import { isPoiCategoryId, type PoiCategoryId } from '@shared/poi/categories';
import { openAt, parseOpeningHours, type OpenState } from '@shared/poi/openingHours';
import type {
  AlongResult,
  AlongSection,
  DetourEstimate,
  PlaceDataState,
  Poi,
  PoiHit,
  PoiProvider,
} from '@shared/poi/PoiProvider';
import type { RoutingProvider, TransportMode } from '@shared/routing/RoutingProvider';
import { isoWeekday, minutesOfDay, utcToWallClock, type ZonedWallClock } from '@shared/time/zoned';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import type { EmbeddedPaths } from '../routing/embedded';
import { routeLeg } from '../services/routingService';
import { notFound, ServiceError } from '../services/errors';
import { placesDb, placesState, readMeta } from './store';

/**
 * Points of interest along a route or a whole itinerary. Phase 10
 * Requirements 6 and 9, design §6 and §8.
 *
 * Offline: candidates come from `places.sqlite`, never from a network
 * service (ADR 0019 §6). The only call that can leave the machine is the
 * optional road detour, and that goes to the routing provider the user has
 * already set up and consented to.
 */

interface PoiRow {
  id: number;
  osm: string;
  category: string;
  kind: string;
  name: string | null;
  lat: number;
  lon: number;
  tags: string;
}

function rowToPoi(row: PoiRow): Poi | null {
  if (!isPoiCategoryId(row.category)) return null;
  let tags: Record<string, string> = {};
  try {
    tags = JSON.parse(row.tags) as Record<string, string>;
  } catch {
    /* an unreadable tag set is shown as no attributes, not as an error */
  }
  return {
    id: row.id,
    osm: row.osm,
    category: row.category,
    kind: row.kind,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    attributes: extractAttributes(tags),
  };
}

export function createPoiProvider(paths: EmbeddedPaths): PoiProvider {
  const db = (): Database.Database | null => placesDb(paths);
  return {
    state: (): PlaceDataState => placesState(paths),
    inBox(box: BoundingBox, categories: readonly PoiCategoryId[]): Poi[] {
      const handle = db();
      if (handle === null || categories.length === 0) return [];
      const marks = categories.map(() => '?').join(',');
      const rows = handle
        .prepare(
          `SELECT id, osm, category, kind, name, lat, lon, tags FROM poi
            WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND category IN (${marks})`,
        )
        .all(box.minLat, box.maxLat, box.minLon, box.maxLon, ...categories) as PoiRow[];
      return rows.map(rowToPoi).filter((poi): poi is Poi => poi !== null);
    },
    get(id: number): Poi | null {
      const handle = db();
      if (handle === null) return null;
      const row = handle
        .prepare('SELECT id, osm, category, kind, name, lat, lon, tags FROM poi WHERE id = ?')
        .get(id) as PoiRow | undefined;
      return row === undefined ? null : rowToPoi(row);
    },
    covers(point: LatLon): boolean {
      const handle = db();
      const meta = handle === null ? null : readMeta(handle);
      if (meta === null) return false;
      const box = ringsBoundingBox(meta.coverage);
      if (box === null) return false;
      if (point.lat < box.minLat || point.lat > box.maxLat || point.lon < box.minLon || point.lon > box.maxLon) {
        return false;
      }
      return pointInRings(meta.coverage, point);
    },
  };
}

// ----------------------------------------------------------- the line

/** One leg of the searched line, so a hit can say which stop it is on the way to. */
interface LegSpan {
  /** Index of the stop this leg arrives at. */
  stopIndex: number;
  fromM: number;
  toM: number;
}

interface SearchLine {
  index: LineIndex;
  legs: LegSpan[];
  view: ItineraryView | null;
  /**
   * Distances along the line where an other-transport leg (a ferry, a train)
   * sits between two road legs. Nothing is searched there, and a range gap
   * that spans one cannot be checked.
   */
  otherAtM: number[];
}

/** A route's own line. */
export function routeLine(db: Db, routeId: string): SearchLine {
  const route = routeRepo.findRoute(db, routeId);
  if (route === null) throw notFound('That route');
  return { index: buildLineIndex(routeRepo.listPoints(db, routeId)), legs: [], view: null, otherAtM: [] };
}

/**
 * An itinerary's legs, end to end. Only legs with a route that joins its two
 * stops are included; an unplanned leg leaves a gap that is reported as a
 * stretch with nothing to search, never as an empty one.
 */
export function itineraryLine(db: Db, view: ItineraryView): SearchLine {
  const points: LatLon[] = [];
  const legs: LegSpan[] = [];
  let offset = 0;
  const otherAtM: number[] = [];
  for (const [stopIndex, stop] of view.stops.entries()) {
    if (stopIndex > 0 && stop.legMode === 'other') {
      otherAtM.push(offset);
      continue;
    }
    if (stop.leg === null || stop.leg.name === null || stop.leg.fits === false) continue;
    const shape = routeRepo.listPoints(db, stop.leg.routeId);
    if (shape.length < 2) continue;
    const index = buildLineIndex(shape);
    // Legs are laid end to end. Consecutive legs meet at their shared stop,
    // so the join adds nothing; the next leg simply starts there.
    legs.push({ stopIndex, fromM: offset, toM: offset + index.totalM });
    offset += index.totalM;
    for (const point of shape) points.push({ lat: point.lat, lon: point.lon });
  }
  return { index: buildLineIndex(points), legs, view, otherAtM };
}

// ---------------------------------------------------------- the search

const CHUNK = 2000;

const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function sectionFor(line: SearchLine, section: AlongSection): CorridorSection {
  if (section.kind !== 'day') return section;
  const view = line.view;
  if (view === null) throw new ServiceError('INVALID_REQUEST', 'A day can only be chosen for an itinerary.');
  const spans = line.legs.filter((leg) => {
    const previous = view.timeline.stops[leg.stopIndex - 1];
    const departure = previous?.departure ?? null;
    return departure !== null && utcToWallClock(departure, view.timeline.calendarZone).date === section.date;
  });
  const first = spans[0];
  const last = spans.at(-1);
  // A day with no known driving has nothing along it.
  if (first === undefined || last === undefined) return { kind: 'range', fromM: 1, toM: 0 };
  return { kind: 'range', fromM: first.fromM, toM: last.toM };
}

function openState(poi: Poi, local: ZonedWallClock | null): OpenState {
  if (local === null || poi.attributes.openingHours === null) return 'unknown';
  return openAt(parseOpeningHours(poi.attributes.openingHours), {
    weekday: isoWeekday(local.date),
    minutes: minutesOfDay(local.time),
  });
}

export interface AlongRequest {
  line: SearchLine;
  categories: readonly PoiCategoryId[];
  widthM: number;
  section: AlongSection;
  signal?: AbortSignal;
}

/**
 * The search. Chunked, yielding every 2,000 candidates so the main process
 * stays responsive on a long route, and cancellable (Requirement 6.8).
 */
export async function searchAlong(provider: PoiProvider, request: AlongRequest): Promise<AlongResult> {
  const { line, widthM } = request;
  const state = provider.state();
  const dataDate = state.kind === 'ready' ? state.dataDate : null;
  const section = sectionFor(line, request.section);
  const maxOff = section.kind === 'near' ? section.radiusM : widthM;

  const box = corridorBox(line.index.points, maxOff);
  const candidates = box === null ? [] : provider.inBox(box, request.categories);

  const hits: PoiHit[] = [];
  for (let start = 0; start < candidates.length; start += CHUNK) {
    if (request.signal?.aborted === true) throw new ServiceError('CANCELLED', 'The search was cancelled.');
    for (const poi of candidates.slice(start, start + CHUNK)) {
      if (section.kind === 'near' && haversineDistance(section.point, poi) > section.radiusM) continue;
      const projection = project(line.index, poi, maxOff);
      if (projection === null) continue;
      if (section.kind === 'range' && (projection.alongM < section.fromM || projection.alongM > section.toM)) continue;

      let stopIndex: number | null = null;
      let passTime: number | null = null;
      let passLocal: ZonedWallClock | null = null;
      const leg = line.legs.find((span) => projection.alongM >= span.fromM && projection.alongM <= span.toM);
      if (leg !== undefined && line.view !== null) {
        stopIndex = leg.stopIndex;
        passTime = timeAlongLeg(line.view.timeline, leg.stopIndex, projection.alongM - leg.fromM);
        const zone = line.view.timeline.stops[leg.stopIndex]?.zone ?? line.view.timeline.calendarZone;
        passLocal = passTime === null ? null : utcToWallClock(passTime, zone);
      }
      hits.push({ poi, alongM: projection.alongM, offM: projection.offM, stopIndex, passTime, passLocal, open: openState(poi, passLocal) });
    }
    // Deliberately one chunk at a time: the point is to give the event loop back.
    // oxlint-disable-next-line no-await-in-loop
    await yieldNow();
  }
  hits.sort((a, b) => a.alongM - b.alongM || a.offM - b.offM);

  const uncovered = state.kind === 'ready' ? uncoveredStretches(line.index, (p) => provider.covers(p)) : [{ fromM: 0, toM: line.index.totalM }];
  // Unplanned means a road leg with no route; other transport is not unplanned.
  const unplanned =
    line.view === null
      ? 0
      : line.view.stops.filter((stop, i) => i > 0 && stop.legMode !== 'other' && line.legs.every((leg) => leg.stopIndex !== i)).length;
  const otherTransport = line.view === null ? 0 : line.view.stops.filter((stop, i) => i > 0 && stop.legMode === 'other').length;

  let range: RangeCheckResult | null = null;
  const itinerary = line.view?.itinerary ?? null;
  if (itinerary !== null) {
    const refuel: PoiCategoryId = itinerary.energy === 'electric' ? 'charging' : 'fuel';
    const stations = box === null ? [] : provider.inBox(corridorBox(line.index.points, widthM) ?? box, [refuel]);
    const refuelAlongM: number[] = [];
    for (const station of stations) {
      const projection = project(line.index, station, widthM);
      if (projection !== null) refuelAlongM.push(projection.alongM);
    }
    range = checkRange({
      totalM: line.index.totalM,
      refuelAlongM,
      // A ferry or train crossing is a point the range check cannot see past.
      uncovered: [...uncovered, ...line.otherAtM.map((at) => ({ fromM: at, toM: at }))],
      rangeKm: itinerary.rangeKm,
      reservePct: itinerary.reservePct,
    });
  }

  return { hits, totalM: line.index.totalM, widthM, uncovered, unplanned, otherTransport, dataDate, range };
}

// ------------------------------------------------------------ detours

/**
 * The point a given distance along a line, interpolated within its segment.
 * Interpolated, not snapped to a vertex: on a sparse hand-drawn line the
 * nearest vertex can be kilometres from the distance asked for.
 */
export function pointAlong(line: LineIndex, alongM: number): LatLon | null {
  const { points, cumulative } = line;
  if (points.length === 0) return null;
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = cumulative[i] ?? 0;
    const end = cumulative[i + 1] ?? start;
    if (alongM <= end) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) return null;
      const t = end === start ? 0 : Math.min(1, Math.max(0, (alongM - start) / (end - start)));
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
  }
  return points.at(-1) ?? null;
}

/**
 * The extra distance of calling at a POI, by road (Requirement 6.5).
 *
 * Two legs through the routing provider: from the route a little before the
 * POI, to it, and back to the route a little after. The detour is their sum
 * less the route's own distance between those two points. It is labelled an
 * estimate, and straight-line distance is never offered in its place.
 */
export async function estimateDetour(
  provider: RoutingProvider,
  mode: TransportMode,
  line: LineIndex,
  poi: LatLon,
  marginM = 2000,
): Promise<DetourEstimate> {
  // 50 km: a detour to somewhere further is not a detour.
  const projection = project(line, poi, 50_000);
  if (projection === null) throw new ServiceError('INVALID_REQUEST', 'That place is not near the route.');
  const fromM = Math.max(0, projection.alongM - marginM);
  const toM = Math.min(line.totalM, projection.alongM + marginM);
  const from = pointAlong(line, fromM) ?? poi;
  const to = pointAlong(line, toM) ?? poi;
  const there = await routeLeg(provider, from, poi, mode);
  const back = await routeLeg(provider, poi, to, mode);
  const viaM = (there.distanceM ?? 0) + (back.distanceM ?? 0);
  return {
    extraM: Math.max(0, viaM - (toM - fromM)),
    fromM,
    toM,
    matched: there.matched && back.matched && there.distanceM !== null && back.distanceM !== null,
  };
}

