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

describe('addPlaceStop', () => {
  it('makes a waypoint at a place and puts it in the plan where asked, as one undoable step', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Ashbourne', ASHBOURNE) }));
    const { waypoint, stop } = commit(poiTripService.addPlaceStop(db, { tripId, name: 'Buxton', lat: BUXTON.lat, lon: BUXTON.lon, index: 1 }));
    expect(stop).toMatchObject({ waypointId: waypoint.id, durationKind: 'hours', durationMinutes: 60 });
    expect(itineraryService.get(db, tripId, SETTINGS)?.stops.map((s) => s.place?.name)).toEqual(['Leek', 'Buxton', 'Ashbourne']);

    undoService.undo(db);
    expect(itineraryService.get(db, tripId, SETTINGS)?.stops.map((s) => s.place?.name)).toEqual(['Leek', 'Ashbourne']);
    expect(waypointRepo.findWaypoint(db, waypoint.id)).toBeNull();
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

const v = (at: LatLon) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });
const routeIn = (owner: string, name: string, from: LatLon, to: LatLon): string =>
  routeService.create(db, { tripId: owner, name, colour: null, points: [v(from), v(to)] }).result.id;
const plan = () => itineraryService.get(db, tripId, SETTINGS)?.stops ?? [];

function buxtonToLeek(): void {
  commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }));
}

describe('things made outside a plan (Phase 14 task 11)', () => {
  it('copies a route from another trip into the plan as an entry of its own, as one undoable step', () => {
    buxtonToLeek();
    const other = tripService.create(db, { name: 'Other', folderId: null, description: null, notes: null }).result.id;
    const original = routeIn(other, 'Wincle back roads', BUXTON, LEEK);
    const { routeId, stopId } = commit(poiTripService.addRouteLeg(db, { tripId, routeId: original, index: 1, transfer: 'copy' }));
    expect(routeId).not.toBe(original);
    expect(routeService.get(db, original).tripId).toBe(other);
    expect(plan().map((s) => [s.kind, s.place?.name])).toEqual([
      ['stop', 'Buxton'],
      ['route', 'Wincle back roads'],
      ['stop', 'Leek'],
    ]);
    expect(plan().find((s) => s.id === stopId)).toMatchObject({ kind: 'route', entryRouteId: routeId, waypointId: null });

    undoService.undo(db);
    expect(plan().map((s) => s.kind)).toEqual(['stop', 'stop']);
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('asks how to bring in a route from another trip, and moves one from outside any trip without asking', () => {
    buxtonToLeek();
    const other = tripService.create(db, { name: 'Other', folderId: null, description: null, notes: null }).result.id;
    const elsewhere = routeIn(other, 'Elsewhere', BUXTON, LEEK);
    expect(() => poiTripService.addRouteLeg(db, { tripId, routeId: elsewhere, index: 1 })).toThrow(/move it here or copy it/);
    const loose = routeIn(tripService.looseTripId(db), 'Loose', BUXTON, LEEK);
    const { routeId } = commit(poiTripService.addRouteLeg(db, { tripId, routeId: loose, index: 1 }));
    expect(routeId).toBe(loose);
    expect(routeService.get(db, loose).tripId).toBe(tripId);
  });

  it('puts any route anywhere, making no stops or waypoints for its ends', () => {
    buxtonToLeek();
    const wide = routeIn(tripId, 'Ashbourne loop', ASHBOURNE, BUXTON);
    const waypointsBefore = waypointService.listForTrip(db, tripId).length;
    commit(poiTripService.addRouteLeg(db, { tripId, routeId: wide, index: 1 }));
    expect(plan().map((s) => [s.kind, s.place?.name])).toEqual([
      ['stop', 'Buxton'],
      ['route', 'Ashbourne loop'],
      ['stop', 'Leek'],
    ]);
    expect(waypointService.listForTrip(db, tripId)).toHaveLength(waypointsBefore);
    // Its start is not at Buxton, so a drive by road joins them; its end is Buxton again, not Leek.
    expect(plan()[1]).toMatchObject({ joined: false });
  });

  it('makes a plan of one route, with nothing to start or end it', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    const only = routeIn(tripId, 'Wincle back roads', BUXTON, LEEK);
    commit(poiTripService.addRouteLeg(db, { tripId, routeId: only, index: 0 }));
    const view = itineraryService.get(db, tripId, SETTINGS);
    expect(view?.stops.map((s) => [s.kind, s.entryRouteId])).toEqual([['route', only]]);
    // Timed from the route: it sets off at 09:00 and is driven to its end.
    expect(view?.timeline.stops[0]?.arrival).not.toBeNull();
    expect(view?.timeline.stops[0]?.departure).toBeGreaterThan(view?.timeline.stops[0]?.arrival ?? 0);
    expect(view?.timeline.days[0]?.driveSeconds).toBeGreaterThan(0);
  });

  it('takes a route entry out of the plan and brings it back intact with undo', () => {
    buxtonToLeek();
    const lanes = routeIn(tripId, 'Lanes', BUXTON, LEEK);
    const { stopId } = commit(poiTripService.addRouteLeg(db, { tripId, routeId: lanes, index: 1 }));
    commit(itineraryService.removeStop(db, { id: stopId }));
    expect(plan().map((s) => s.kind)).toEqual(['stop', 'stop']);
    undoService.undo(db);
    expect(plan()[1]).toMatchObject({ id: stopId, kind: 'route', entryRouteId: lanes, waypointId: null, point: null });
  });

  it('needs nothing to join a route that starts where the entry before it ends', () => {
    buxtonToLeek();
    const out = routeIn(tripId, 'Buxton to Ashbourne', BUXTON, ASHBOURNE);
    commit(poiTripService.addRouteLeg(db, { tripId, routeId: out, index: 1 }));
    expect(plan()[1]).toMatchObject({ kind: 'route', joined: true, leg: null, planIssue: null });
    // Leek is now reached from Ashbourne, the route's end.
    expect(plan()[2]?.joined).toBe(false);
  });

  it('brings a waypoint from outside any trip into the plan, moving it in', () => {
    buxtonToLeek();
    const loose = waypointService.create(db, {
      tripId: tripService.looseTripId(db),
      name: 'Ashbourne',
      lat: ASHBOURNE.lat,
      lon: ASHBOURNE.lon,
      eleM: null,
      description: null,
      symbol: 'pin',
      notes: null,
      groupId: null,
    }).result.id;
    commit(poiTripService.addWaypointStop(db, { tripId, waypointId: loose, index: 1 }));
    expect(plan().map((s) => s.place?.name)).toEqual(['Buxton', 'Ashbourne', 'Leek']);
    expect(waypointService.get(db, loose).tripId).toBe(tripId);
  });
});

describe('joining two with a new route (Phase 14 task 14)', () => {
  const NO_ROUTING = { provider: null, mode: 'auto' as const, unavailable: 'Routing is not available.' };

  it('runs a straight line from a route’s end to a waypoint, named for both, as one undo step', async () => {
    const route = routeIn(tripId, 'Wincle back roads', BUXTON, LEEK);
    const ashbourne = place('Ashbourne', ASHBOURNE);
    const joined = commit(await poiTripService.joinWithRoute(db, NO_ROUTING, { from: { kind: 'route', id: route }, to: { kind: 'waypoint', id: ashbourne }, straight: true }));
    expect(joined.name).toBe('Wincle back roads → Ashbourne');
    const line = routeService.get(db, joined.id).points.map((p) => [p.lat, p.lon]);
    expect(line).toEqual([[LEEK.lat, LEEK.lon], [ASHBOURNE.lat, ASHBOURNE.lon]]);
    undoService.undo(db);
    expect(routeService.listForTrip(db, tripId).map((r) => r.name)).toEqual(['Wincle back roads']);
  });

  it('joins a route’s end to another route’s start, by road with a provider', async () => {
    const first = routeIn(tripId, 'Out', BUXTON, LEEK);
    const second = routeIn(tripId, 'Back', ASHBOURNE, BUXTON);
    const joined = await poiTripService.joinWithRoute(db, { provider, mode: 'auto', unavailable: '' }, { from: { kind: 'route', id: first }, to: { kind: 'route', id: second }, straight: false });
    const line = routeService.get(db, joined.result.id).points;
    expect([line[0]?.lat, line.at(-1)?.lat]).toEqual([LEEK.lat, ASHBOURNE.lat]);
  });

  it('says why it cannot go by road without routing, and offers the straight line', async () => {
    const a = place('Leek', LEEK);
    const b = place('Ashbourne', ASHBOURNE);
    await expect(poiTripService.joinWithRoute(db, NO_ROUTING, { from: { kind: 'waypoint', id: a }, to: { kind: 'waypoint', id: b }, straight: false })).rejects.toThrow(
      /Routing is not available\. Join with a straight line instead\./,
    );
  });
});

const days = () => itineraryService.get(db, tripId, SETTINGS)?.timeline.days.map((d) => d.date) ?? [];

function twoDays(): { leek: string; ashbourne: string } {
  commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
  commit(itineraryService.addDay(db, { tripId }, SETTINGS));
  const leek = place('Leek', LEEK);
  const ashbourne = place('Ashbourne', ASHBOURNE);
  commit(itineraryService.addStop(db, { tripId, waypointId: leek }));
  commit(itineraryService.addStop(db, { tripId, waypointId: ashbourne }));
  return { leek, ashbourne };
}

describe('adding and removing days (Phase 14 task 16)', () => {
  it('adds an empty day at the end, which the next entry starts at the usual leaving time', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
    commit(itineraryService.addDay(db, { tripId }, SETTINGS));
    expect(days()).toEqual(['2026-07-01', '2026-07-02']);
    expect(plan().map((s) => s.kind)).toEqual(['stop', 'day']);
  });

  it('removes a day: its entries leave the plan and stay in the trip, and undo puts them back', () => {
    const { leek, ashbourne } = twoDays();
    expect(days()).toEqual(['2026-07-01', '2026-07-02']);
    commit(itineraryService.removeDay(db, { tripId, date: '2026-07-02' }, SETTINGS));
    expect(plan().map((s) => s.place?.name)).toEqual(['Buxton']);
    expect(days()).toEqual(['2026-07-01']);
    // Still in the trip: under Not in the plan.
    expect(waypointService.listForTrip(db, tripId).map((w) => w.id)).toEqual(expect.arrayContaining([leek, ashbourne]));
    undoService.undo(db);
    expect(plan().map((s) => s.place?.name ?? s.kind)).toEqual(['Buxton', 'day', 'Leek', 'Ashbourne']);
  });

  it('removing the first day starts the plan on the next one, keeping its date', () => {
    twoDays();
    commit(itineraryService.removeDay(db, { tripId, date: '2026-07-01' }, SETTINGS));
    const view = itineraryService.get(db, tripId, SETTINGS);
    expect(view?.itinerary.startDate).toBe('2026-07-02');
    expect(view?.stops.map((s) => s.place?.name)).toEqual(['Leek', 'Ashbourne']);
    expect(view?.timeline.days.map((d) => d.date)).toEqual(['2026-07-02']);
  });

  it('adds a day between two days, pushing the later one on', () => {
    twoDays();
    commit(itineraryService.addDay(db, { tripId, afterDate: '2026-07-01' }, SETTINGS));
    expect(days()).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });
});

describe('deleting from the plan (Phase 14 task 17)', () => {
  it('deletes a waypoint with its stops in the plan, and undo brings both back', () => {
    buxtonToLeek();
    const leek = plan()[1]?.waypointId as string;
    const out = commit(poiTripService.deleteItem(db, { kind: 'waypoint', id: leek }));
    expect(out.entries).toBe(1);
    expect(plan().map((s) => s.place?.name)).toEqual(['Buxton']);
    expect(waypointService.listForTrip(db, tripId).map((w) => w.id)).not.toContain(leek);
    undoService.undo(db);
    expect(plan().map((s) => s.place?.name)).toEqual(['Buxton', 'Leek']);
  });

  it('deletes a route entry with its route, and unlinks a drive that used it', () => {
    buxtonToLeek();
    const lanes = routeIn(tripId, 'Lanes', BUXTON, LEEK);
    commit(poiTripService.addRouteLeg(db, { tripId, routeId: lanes, index: 1 }));
    const out = commit(poiTripService.deleteItem(db, { kind: 'route', id: lanes }));
    expect(out.entries).toBe(1);
    expect(plan().map((s) => s.kind)).toEqual(['stop', 'stop']);
    expect(routeService.listForTrip(db, tripId)).toHaveLength(0);
  });
});
