import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import { autoPlan, isPlannedRoute } from './autoPlanService';
import { batch } from './compose';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

/**
 * Automatic planning (Phase 10 Requirement 15) with a fake provider whose
 * roads run straight between the points, 1.25 times as long. What is under
 * test is which legs get planned, which routes are replaced, and undo.
 */

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };
let calls = 0;

function provider(matched = true): RoutingProvider {
  return {
    id: 'fake',
    name: 'Fake',
    origins: [],
    attribution: '',
    snap: async (points: readonly LatLon[]) => {
      calls += 1;
      const [a, b] = points;
      return {
        legs: [{ shape: [...points], distanceM: a && b ? haversineDistance(a, b) * 1.25 : 0, matched }],
        displaced: [],
      };
    },
  } as unknown as RoutingProvider;
}

/** What an IPC handler does: the change and the planning, recorded as one step. */
async function withPlanning<T>(mutation: Mutation<T>, given: RoutingProvider | null = provider()): Promise<T> {
  const result = await autoPlan(db, given, 'auto', tripId, 'No routing is available.');
  undoService.record(batch(mutation.result, mutation, ...result.mutations).inverse);
  return mutation.result;
}

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

const view = () => {
  const result = itineraryService.get(db, tripId, SETTINGS);
  if (result === null) throw new Error('no itinerary');
  return result;
};
const routeNames = () => routeService.listForTrip(db, tripId).map((r) => r.name).toSorted();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-autoplan-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  calls = 0;
  tripId = tripService.create(db, { name: 'Trip', folderId: null, description: null, notes: null }).result.id;
  itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' });
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

async function threeStops(): Promise<string[]> {
  const ids: string[] = [];
  for (const [name, at] of [
    ['Buxton', BUXTON],
    ['Leek', LEEK],
    ['Ashbourne', ASHBOURNE],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop
    ids.push((await withPlanning(itineraryService.addStop(db, { tripId, waypointId: place(name, at) }))).id);
  }
  return ids;
}

describe('autoPlan', () => {
  it('joins each new stop to the last by road, and marks the routes as planned', async () => {
    await threeStops();
    const result = view();
    expect(routeNames()).toEqual(['Buxton → Leek', 'Leek → Ashbourne']);
    expect(result.stops.map((s) => s.legMode)).toEqual(['road', 'road', 'road']);
    expect(result.stops.slice(1).every((s) => s.leg?.fits === true)).toBe(true);
    expect(result.timeline.complete).toBe(true);
    for (const route of routeService.listForTrip(db, tripId)) expect(isPlannedRoute(db, route.id)).toBe(true);
  });

  it('plans nothing again when every leg already fits', async () => {
    await threeStops();
    const before = calls;
    const again = await autoPlan(db, provider(), 'auto', tripId, '');
    expect(again.mutations).toEqual([]);
    expect(calls).toBe(before);
  });

  it('one undo takes back a stop and the drives planned for it', async () => {
    await threeStops();
    undoService.undo(db);
    expect(view().stops).toHaveLength(2);
    expect(routeNames()).toEqual(['Buxton → Leek']);
    undoService.redo(db);
    expect(view().stops).toHaveLength(3);
    expect(routeNames()).toEqual(['Buxton → Leek', 'Leek → Ashbourne']);
  });

  it('replaces planned routes when a stop moves, and never touches the user’s own', async () => {
    const [, leek, ashbourne] = await threeStops();
    // The user draws their own route for the first leg and chooses it.
    const own = routeService.create(db, {
      tripId,
      name: 'My scenic way',
      colour: null,
      points: [BUXTON, MACCLESFIELD, LEEK].map((p) => ({ lat: p.lat, lon: p.lon, ele: null, name: null, symbol: null, notes: null })),
    }).result;
    await withPlanning(itineraryService.linkLeg(db, { id: leek ?? '', routeId: own.id }));
    const ownPoints = routeService.get(db, own.id).points;

    // Ashbourne's waypoint moves to Macclesfield: its planned leg no longer fits.
    const ashbourneWaypoint = view().stops[2]?.waypointId ?? '';
    await withPlanning(waypointService.move(db, { id: ashbourneWaypoint, lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon }));

    const result = view();
    expect(result.stops[1]).toMatchObject({ legMode: 'route', legRouteId: own.id });
    expect(routeService.get(db, own.id).points).toEqual(ownPoints);
    expect(result.stops[2]?.leg?.fits).toBe(true);
    // The old planned Leek → Ashbourne route was replaced; the first planned
    // route, unlinked when the user chose theirs, was removed as unused.
    expect(routeService.listForTrip(db, tripId).filter((r) => isPlannedRoute(db, r.id))).toHaveLength(1);
    expect(routeNames()).toContain('My scenic way');
    expect(ashbourne).toBeDefined();
  });

  it('removes a planned route when its stop goes', async () => {
    const [, leek] = await threeStops();
    await withPlanning(itineraryService.removeStop(db, { id: leek ?? '' }));
    expect(routeNames()).toEqual(['Buxton → Ashbourne']);
  });

  it('leaves a leg unplanned with a reason when there is no provider', async () => {
    place('unused', BUXTON);
    const a = place('Buxton', BUXTON);
    const b = place('Leek', LEEK);
    itineraryService.addStop(db, { tripId, waypointId: a });
    const stop = itineraryService.addStop(db, { tripId, waypointId: b }).result;
    const result = await autoPlan(db, null, 'auto', tripId, 'No map regions are loaded.');
    expect(result.mutations).toEqual([]);
    expect(result.failures.get(stop.id)).toBe('No map regions are loaded.');
  });

  it('draws no straight line when the engine finds no road', async () => {
    itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) });
    const stop = itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }).result;
    const result = await autoPlan(db, provider(false), 'auto', tripId, '');
    expect(result.failures.get(stop.id)).toMatch(/No road was found/);
    expect(routeRepo.listRoutesForTrip(db, tripId)).toEqual([]);
  });

  it('never plans an other-transport leg', async () => {
    itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) });
    const stop = itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }).result;
    itineraryService.setLegMode(db, { id: stop.id, mode: 'other', transport: 'train', minutes: 50 });
    const result = await autoPlan(db, provider(), 'auto', tripId, '');
    expect(result.mutations).toEqual([]);
    expect(calls).toBe(0);
  });

  it('keeps the planned marker through a deletion and its undo', async () => {
    await threeStops();
    const planned = routeService.listForTrip(db, tripId)[0];
    if (planned === undefined) throw new Error('no route');
    undoService.record(routeService.remove(db, planned.id).inverse);
    undoService.undo(db);
    expect(isPlannedRoute(db, planned.id)).toBe(true);
  });
});
