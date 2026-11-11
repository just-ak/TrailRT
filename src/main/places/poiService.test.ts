import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A515_TRACE } from '@fixtures/places';
import { buildLineIndex } from '@shared/geo/corridor';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import { openAt, parseOpeningHours } from '@shared/poi/openingHours';
import type { PoiProvider } from '@shared/poi/PoiProvider';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import { isoWeekday, minutesOfDay } from '@shared/time/zoned';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { embeddedPaths } from '../routing/embedded';
import { parseIndex } from '../routing/geofabrik';
import * as itineraryService from '../services/itineraryService';
import * as routeService from '../services/routeService';
import * as tripService from '../services/tripService';
import * as waypointService from '../services/waypointService';
import { ingestPlaces } from './ingest';
import { createPoiProvider, estimateDetour, itineraryLine, pointAlong, routeLine, searchAlong } from './poiService';
import { closePlacesDb, placesFile } from './store';

/**
 * POIs along the A515 out of Buxton, against the real OpenStreetMap excerpt.
 *
 * Along `A515_TRACE` the excerpt has three fuel stations: Morrisons 617 m off
 * the road at 1.0 km, Esso Buxton Express 14 m off at 1.1 km, and Essar
 * Rockbay 1.74 km off. Measured, not chosen.
 */

let root: string;
let handle: DbHandle;
let db: Db;
let provider: PoiProvider;
let routeId: string;
let tripId: string;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };
const vertex = (at: LatLon) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-poi-'));
  const paths = embeddedPaths(join(root, 'user'), join(root, 'resources'));
  mkdirSync(join(root, 'user', 'valhalla'), { recursive: true });
  const index = parseIndex(readFileSync(resolve('test-data/geofabrik-uk.json'), 'utf8'));
  const derbyshire = index.find((r) => r.id === 'derbyshire');
  if (derbyshire === undefined) throw new Error('no Derbyshire');
  await ingestPlaces(resolve('test-data/places-excerpt/buxton.geojsonseq'), placesFile(paths), {
    regionName: 'Derbyshire',
    regions: [{ name: 'Derbyshire', rings: derbyshire.rings }],
    dataDate: '2026-11-08',
    dateIsDownload: false,
  });
  provider = createPoiProvider(paths);

  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  tripId = tripService.create(db, { name: 'A515', folderId: null, description: null, notes: null }).result.id;
  routeId = routeService.create(db, { tripId, name: 'A515', colour: null, points: A515_TRACE.map(vertex) }).result.id;
});

afterAll(() => {
  closePlacesDb();
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

const names = (hits: { poi: { name: string | null } }[]) => hits.map((h) => h.poi.name);

describe('searchAlong a route', () => {
  it('finds fuel within the corridor, in the order it is reached', async () => {
    const result = await searchAlong(provider, {
      line: routeLine(db, routeId),
      categories: ['fuel'],
      widthM: 1000,
      section: { kind: 'all' },
    });
    expect(names(result.hits)).toEqual(['Morrisons', 'Esso Buxton Express']);
    expect(result.hits[1]?.offM).toBeLessThan(20);
    expect(result.hits[0]?.alongM).toBeLessThan(result.hits[1]?.alongM ?? 0);
    expect(result.dataDate).toBe('2026-11-08');
    expect(result.uncovered).toEqual([]);
    // A route has no times, so nothing is said about opening.
    expect(result.hits.every((h) => h.passTime === null && h.open === 'unknown')).toBe(true);
    expect(result.range).toBeNull();
  });

  it('a wider corridor reaches further', async () => {
    const result = await searchAlong(provider, {
      line: routeLine(db, routeId),
      categories: ['fuel'],
      widthM: 2000,
      section: { kind: 'all' },
    });
    expect(names(result.hits)).toContain('Essar Rockbay Service Station');
  });

  it('limits to a stretch, and to a radius round a point', async () => {
    const stretch = await searchAlong(provider, {
      line: routeLine(db, routeId),
      categories: ['fuel'],
      widthM: 1000,
      section: { kind: 'range', fromM: 1100, toM: 5000 },
    });
    expect(names(stretch.hits)).toEqual(['Esso Buxton Express']);

    const esso = stretch.hits[0]?.poi;
    const near = await searchAlong(provider, {
      line: routeLine(db, routeId),
      categories: ['fuel', 'food'],
      widthM: 100,
      section: { kind: 'near', point: esso ?? A515_TRACE[0]!, radiusM: 300 },
    });
    expect(near.hits.length).toBeGreaterThan(0);
    for (const hit of near.hits) expect(haversineDistance(hit.poi, esso ?? hit.poi)).toBeLessThanOrEqual(300);
  });

  it('finds hotels, including those mapped as buildings', async () => {
    const result = await searchAlong(provider, {
      line: routeLine(db, routeId),
      categories: ['accommodation'],
      widthM: 500,
      section: { kind: 'all' },
    });
    expect(names(result.hits)).toEqual(
      expect.arrayContaining(['Palace Hotel', 'Buxton Crescent Hotel and Spa', 'Old Hall Hotel']),
    );
  });

  it('reports a stretch outside the place data as not covered', async () => {
    const south = A515_TRACE[12]?.lat ?? 0;
    const partial: PoiProvider = { ...provider, covers: (p) => p.lat >= south };
    const result = await searchAlong(partial, {
      line: routeLine(db, routeId),
      categories: ['fuel'],
      widthM: 1000,
      section: { kind: 'all' },
    });
    expect(result.uncovered).toHaveLength(1);
    expect(result.uncovered[0]?.toM).toBeCloseTo(result.totalM, 6);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchAlong(provider, {
        line: routeLine(db, routeId),
        categories: ['parking'],
        widthM: 1000,
        section: { kind: 'all' },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('searchAlong an itinerary', () => {
  let view: NonNullable<ReturnType<typeof itineraryService.get>>;

  beforeAll(() => {
    const start = A515_TRACE[0] ?? { lat: 0, lon: 0 };
    const end = A515_TRACE.at(-1) ?? start;
    const place = (name: string, at: LatLon) =>
      waypointService.create(db, {
        tripId,
        name,
        lat: at.lat,
        lon: at.lon,
        eleM: null,
        description: null,
        symbol: 'pin',
        notes: null,
        groupId: null,
      }).result.id;
    itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' });
    itineraryService.addStop(db, { tripId, waypointId: place('Buxton', start) });
    const arrive = itineraryService.addStop(db, { tripId, waypointId: place('South', end) }).result;
    itineraryService.linkLeg(db, { id: arrive.id, routeId });
    view = itineraryService.get(db, tripId, SETTINGS)!;
  });

  it('gives each hit its leg, its pass time and whether it should be open then', async () => {
    const result = await searchAlong(provider, {
      line: itineraryLine(db, view),
      categories: ['fuel'],
      widthM: 1000,
      section: { kind: 'all' },
    });
    const esso = result.hits.find((h) => h.poi.name === 'Esso Buxton Express');
    expect(esso?.stopIndex).toBe(1);
    // 09:00 BST departure plus 1.13 km at 55 km/h: about 09:01.
    expect(esso?.passLocal).toMatchObject({ date: '2026-07-01', time: '09:01' });
    const hours = esso?.poi.attributes.openingHours ?? null;
    const expected =
      hours === null || esso?.passLocal === null || esso?.passLocal === undefined
        ? 'unknown'
        : openAt(parseOpeningHours(hours), {
            weekday: isoWeekday(esso.passLocal.date),
            minutes: minutesOfDay(esso.passLocal.time),
          });
    expect(esso?.open).toBe(expected);
  });

  it('limits to one day of the plan', async () => {
    const line = itineraryLine(db, view);
    const today = await searchAlong(provider, { line, categories: ['fuel'], widthM: 1000, section: { kind: 'day', date: '2026-07-01' } });
    expect(names(today.hits)).toEqual(['Morrisons', 'Esso Buxton Express']);
    const tomorrow = await searchAlong(provider, { line, categories: ['fuel'], widthM: 1000, section: { kind: 'day', date: '2026-07-02' } });
    expect(tomorrow.hits).toEqual([]);
  });

  it('runs the range check only when a range is set', async () => {
    const line = itineraryLine(db, view);
    const unset = await searchAlong(provider, { line, categories: ['fuel'], widthM: 1000, section: { kind: 'all' } });
    expect(unset.range).toEqual({ checked: false, reason: 'no-range' });

    itineraryService.update(db, tripId, { rangeKm: 10, reservePct: 0 });
    const short = await searchAlong(provider, {
      line: itineraryLine(db, itineraryService.get(db, tripId, SETTINGS)!),
      categories: ['food'],
      widthM: 1000,
      section: { kind: 'all' },
    });
    // The last station is at 1.1 km of 17.4 km, so 16 km has none mapped.
    expect(short.range?.checked && short.range.gaps.map((g) => g.status)).toEqual(['warning']);

    itineraryService.update(db, tripId, { rangeKm: 20 });
    const enough = await searchAlong(provider, {
      line: itineraryLine(db, itineraryService.get(db, tripId, SETTINGS)!),
      categories: ['food'],
      widthM: 1000,
      section: { kind: 'all' },
    });
    expect(enough.range?.checked && enough.range.gaps).toEqual([]);
  });
});

describe('estimateDetour', () => {
  /** A provider whose roads are 1.2 times the straight line. */
  const fake: RoutingProvider = {
    id: 'fake',
    capabilities: () => ({ snap: true, roadAttributes: false, alternatives: false, transportModes: ['auto'] }),
    snap: async (points: LatLon[]) => {
      const [a, b] = points;
      const distance = a !== undefined && b !== undefined ? haversineDistance(a, b) * 1.2 : 0;
      return {
        legs: [{ shape: [...points], distanceM: distance, matched: true }],
        displaced: [],
      };
    },
  } as unknown as RoutingProvider;

  it('is the road distance there and back less the route between', async () => {
    const line = buildLineIndex(A515_TRACE);
    const mid = A515_TRACE[11] ?? A515_TRACE[0]!;
    const off = { lat: mid.lat + 0.005, lon: mid.lon };
    const estimate = await estimateDetour(fake, 'auto', line, off);
    expect(estimate.matched).toBe(true);
    expect(estimate.extraM).toBeGreaterThan(0);
    expect(estimate.toM).toBeGreaterThan(estimate.fromM);
    // The road distance there and back, 1.2 × straight lines, less the 4 km of route.
    const from = pointAlong(line, estimate.fromM)!;
    const to = pointAlong(line, estimate.toM)!;
    const via = (haversineDistance(from, off) + haversineDistance(off, to)) * 1.2;
    expect(estimate.extraM).toBeCloseTo(via - (estimate.toM - estimate.fromM), 3);
  });

  it('interpolates within a segment rather than snapping to a vertex', () => {
    const line = buildLineIndex(A515_TRACE);
    const middle = ((line.cumulative[10] ?? 0) + (line.cumulative[11] ?? 0)) / 2;
    const point = pointAlong(line, middle)!;
    expect(haversineDistance(point, A515_TRACE[10]!)).toBeGreaterThan(1000);
    expect(haversineDistance(point, A515_TRACE[11]!)).toBeGreaterThan(1000);
  });
});

describe('createPoiProvider', () => {
  it('has nothing to offer when no place data exists', () => {
    const empty = createPoiProvider(embeddedPaths(join(root, 'none'), join(root, 'resources')));
    expect(empty.state()).toEqual({ kind: 'none' });
    expect(empty.inBox({ minLat: 53, maxLat: 54, minLon: -2, maxLon: -1 }, ['fuel'])).toEqual([]);
    expect(empty.covers(A515_TRACE[0]!)).toBe(false);
  });
});
