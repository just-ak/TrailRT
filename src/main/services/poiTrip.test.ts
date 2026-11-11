import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import { extractAttributes } from '@shared/poi/attributes';
import type { Poi } from '@shared/poi/PoiProvider';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as waypointRepo from '../db/repositories/waypoints';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as poiTripService from './poiTripService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };

function commit<T>(mutation: Mutation<T>): T {
  undoService.record(mutation.inverse);
  return mutation.result;
}

/** A provider whose roads run straight between the points, 1.25 times as long. */
const provider = {
  id: 'fake',
  name: 'Fake',
  origins: [],
  attribution: '',
  snap: async (points: readonly LatLon[]) => {
    const [a, b] = points;
    return {
      legs: [
        {
          shape: [...points],
          distanceM: a !== undefined && b !== undefined ? haversineDistance(a, b) * 1.25 : 0,
          matched: true,
        },
      ],
      displaced: [],
    };
  },
} as unknown as RoutingProvider;

/** The Palace Hotel, as the place data holds it (tags from the OSM excerpt). */
const palace: Poi = {
  id: 7,
  osm: 'way/117882931',
  category: 'accommodation',
  kind: 'hotel',
  name: 'Palace Hotel',
  lat: BUXTON.lat,
  lon: BUXTON.lon,
  attributes: extractAttributes({ phone: '+44 1298 22001', stars: '4', 'addr:street': 'Palace Road' }),
};

function place(name: string, at: LatLon): string {
  return waypointService.create(db, {
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
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p10-poi-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, { name: 'Trip', folderId: null, description: null, notes: null }).result.id;
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('waypointFromPoi', () => {
  it('takes the name, symbol, a plain-text description and where it came from', () => {
    const input = poiTripService.waypointFromPoi(palace, tripId, '2026-11-08');
    expect(input).toMatchObject({
      name: 'Palace Hotel',
      symbol: 'lodging',
      source: 'poi',
      metadata: { osm: { element: 'way/117882931', category: 'accommodation', kind: 'hotel', dataDate: '2026-11-08' } },
    });
    expect(input.description).toBe(
      'Address: Palace Road\nPhone: +44 1298 22001\nStars: 4\nFrom OpenStreetMap. © OpenStreetMap contributors, ODbL.',
    );
  });

  it('gives a campsite the tent, and an unnamed POI its category', () => {
    const camp = poiTripService.waypointFromPoi({ ...palace, kind: 'camp_site', name: null }, tripId, null);
    expect(camp).toMatchObject({ symbol: 'campground', name: 'Accommodation' });
  });
});

describe('addPoiWaypoint and undo', () => {
  it('keeps the source and provenance when a deletion is undone', () => {
    const waypoint = commit(poiTripService.addPoiWaypoint(db, palace, tripId, '2026-11-08'));
    commit(waypointService.remove(db, waypoint.id));
    undoService.undo(db);
    const back = waypointService.get(db, waypoint.id);
    expect(back.source).toBe('poi');
    expect(waypointRepo.readWaypointMetadata(db, waypoint.id)).toEqual({
      osm: { element: 'way/117882931', category: 'accommodation', kind: 'hotel', dataDate: '2026-11-08' },
    });
  });
});

describe('addPoiStop', () => {
  it('adds the waypoint and the stop as one undoable step, staying the night at a hotel', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }));
    const { waypoint, stop } = commit(poiTripService.addPoiStop(db, palace, { tripId, dataDate: '2026-11-08' }));
    expect(stop).toMatchObject({ waypointId: waypoint.id, durationKind: 'days', durationDays: 1 });

    undoService.undo(db);
    expect(itineraryService.get(db, tripId, SETTINGS)?.stops).toHaveLength(1);
    expect(waypointRepo.findWaypoint(db, waypoint.id)).toBeNull();

    undoService.redo(db);
    const stops = itineraryService.get(db, tripId, SETTINGS)?.stops ?? [];
    expect(stops.map((s) => s.place?.name)).toEqual(['Leek', 'Palace Hotel']);
    expect(waypointService.get(db, waypoint.id).source).toBe('poi');
  });
});

describe('planLeg and planAround', () => {
  it('routes, saves and links a leg, and one undo takes both back', async () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
    const leek = commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }));

    const { route } = commit(await poiTripService.planLeg(db, provider, 'auto', leek.id));
    expect(route.name).toBe('Buxton → Leek');
    const view = itineraryService.get(db, tripId, SETTINGS);
    expect(view?.stops[1]?.leg).toMatchObject({ routeId: route.id, fits: true });
    expect(view?.timeline.complete).toBe(true);

    undoService.undo(db);
    expect(routeService.listForTrip(db, tripId)).toEqual([]);
    expect(itineraryService.get(db, tripId, SETTINGS)?.stops[1]?.legRouteId).toBeNull();
  });

  it('refuses the first stop, which no leg arrives at', async () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    const first = commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
    await expect(poiTripService.planLeg(db, provider, 'auto', first.id)).rejects.toThrow(/no leg to plan/);
  });

  it('routes through an inserted stop and leaves the old route untouched in the trip', async () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
    const end = commit(itineraryService.addStop(db, { tripId, waypointId: place('Ashbourne', ASHBOURNE) }));
    const { route: old } = commit(await poiTripService.planLeg(db, provider, 'auto', end.id));
    const oldPoints = routeService.get(db, old.id).points;

    const { stop } = commit(poiTripService.addPoiStop(db, { ...palace, lat: LEEK.lat, lon: LEEK.lon, name: 'Leek Hotel' }, { tripId, index: 1, dataDate: null }));
    const { routes } = commit(await poiTripService.planAround(db, provider, 'auto', stop.id));

    expect(routes.map((r) => r.name)).toEqual(['Buxton → Leek Hotel', 'Leek Hotel → Ashbourne']);
    const view = itineraryService.get(db, tripId, SETTINGS);
    expect(view?.stops.map((s) => s.leg?.name ?? null)).toEqual([null, 'Buxton → Leek Hotel', 'Leek Hotel → Ashbourne']);
    expect(routeService.get(db, old.id).points).toEqual(oldPoints);

    undoService.undo(db);
    expect(routeService.listForTrip(db, tripId).map((r) => r.id)).toEqual([old.id]);
  });
});
