import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { MAX_ITINERARY_STOPS } from '@shared/domain/itinerary';
import type { LatLon } from '@shared/geo/distance';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import type { Mutation } from './folderService';
import type { TreeNode } from '@shared/domain/types';
import * as itineraryService from './itineraryService';
import * as libraryService from './libraryService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };

/** Applies a mutation the way an IPC handler does: result out, inverse recorded. */
function commit<T>(mutation: Mutation<T>): T {
  undoService.record(mutation.inverse);
  return mutation.result;
}

function view() {
  const result = itineraryService.get(db, tripId, SETTINGS);
  if (result === null) throw new Error('expected an itinerary');
  return result;
}

const order = (): string[] => view().stops.map((s) => s.place?.name ?? '?');
const links = (): (string | null)[] => view().stops.map((s) => s.legRouteId);

function place(name: string, at: LatLon, trip = tripId): string {
  return waypointService.create(db, {
    tripId: trip,
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

const vertex = (at: LatLon) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });

function road(from: LatLon, to: LatLon, name = 'Leg', trip = tripId): string {
  return routeService.create(db, { tripId: trip, name, colour: null, points: [vertex(from), vertex(to)] }).result.id;
}

function findNode(node: TreeNode, id: string): TreeNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

let buxton: string;
let leek: string;
let ashbourne: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p10-svc-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, { name: 'Peak weekend', folderId: null, description: null, notes: null }).result.id;
  buxton = place('Buxton', BUXTON);
  leek = place('Leek', LEEK);
  ashbourne = place('Ashbourne', ASHBOURNE);
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function planThree(): { stops: string[]; legs: string[] } {
  commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
  const a = commit(itineraryService.addStop(db, { tripId, waypointId: buxton })).id;
  const b = commit(itineraryService.addStop(db, { tripId, waypointId: leek, durationMinutes: 60 })).id;
  const c = commit(itineraryService.addStop(db, { tripId, waypointId: ashbourne })).id;
  const ab = road(BUXTON, LEEK, 'Buxton → Leek');
  const bc = road(LEEK, ASHBOURNE, 'Leek → Ashbourne');
  commit(itineraryService.linkLeg(db, { id: b, routeId: ab }));
  commit(itineraryService.linkLeg(db, { id: c, routeId: bc }));
  return { stops: [a, b, c], legs: [ab, bc] };
}

describe('itineraryService', () => {
  it('a trip with no itinerary has none, and nothing about it changes', () => {
    const before = tripService.get(db, tripId);
    expect(itineraryService.get(db, tripId, SETTINGS)).toBeNull();
    expect(tripService.get(db, tripId)).toEqual(before);
  });

  it('builds a timed plan from stops and linked legs', () => {
    planThree();
    const { stops, timeline } = view();
    expect(stops.map((s) => s.leg?.fits ?? null)).toEqual([null, true, true]);
    expect(timeline.complete).toBe(true);
    expect(timeline.stops[0]?.departureLocal?.time).toBe('09:00');
    // Hand-drawn routes are timed at the settings mode's average, never walking pace.
    expect(timeline.stops[1]?.legSpeedKmh).toBe(55);
  });

  it('refuses a second itinerary, a foreign waypoint and a foreign route', () => {
    planThree();
    expect(() => itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' })).toThrow(
      /already has an itinerary/,
    );
    const other = tripService.create(db, { name: 'Other', folderId: null, description: null, notes: null }).result.id;
    const elsewhere = place('Macclesfield', MACCLESFIELD, other);
    expect(() => itineraryService.addStop(db, { tripId, waypointId: elsewhere })).toThrow(/own waypoints/);
    const stop = view().stops[1]?.id ?? '';
    expect(() => itineraryService.linkLeg(db, { id: stop, routeId: road(BUXTON, LEEK, 'x', other) })).toThrow(
      /own routes/,
    );
  });

  it('validates dates, times and durations', () => {
    expect(() => itineraryService.create(db, { tripId, startDate: '2026-02-30', startTime: '09:00' })).toThrow();
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    expect(() => itineraryService.update(db, tripId, { startTime: '24:00' })).toThrow();
    expect(() => itineraryService.update(db, tripId, { reservePct: 95 })).toThrow();
    const stop = commit(itineraryService.addStop(db, { tripId, waypointId: buxton }));
    expect(() => itineraryService.updateStop(db, stop.id, { durationKind: 'days', durationDays: 0 })).toThrow();
    expect(() => itineraryService.updateStop(db, stop.id, { durationMinutes: 25 * 60 })).toThrow();
  });

  it('switching a stop to days drops the hours fields, and back', () => {
    planThree();
    const id = view().stops[1]?.id ?? '';
    commit(itineraryService.updateStop(db, id, { durationKind: 'days', durationDays: 2 }));
    expect(view().stops[1]).toMatchObject({ durationKind: 'days', durationDays: 2, durationMinutes: null });
    commit(itineraryService.updateStop(db, id, { durationKind: 'hours', durationMinutes: 45 }));
    expect(view().stops[1]).toMatchObject({ durationKind: 'hours', durationDays: null, durationMinutes: 45 });
  });

  it('removing the itinerary keeps waypoints and routes, and undo brings every stop back', () => {
    const { legs } = planThree();
    const before = view();
    commit(itineraryService.remove(db, tripId));
    expect(itineraryService.get(db, tripId, SETTINGS)).toBeNull();
    expect(waypointService.listForTrip(db, tripId)).toHaveLength(3);
    expect(routeService.listForTrip(db, tripId).map((r) => r.id).toSorted()).toEqual(legs.toSorted());

    undoService.undo(db);
    const after = view();
    expect(after.stops.map((s) => [s.id, s.waypointId, s.legRouteId, s.durationMinutes])).toEqual(
      before.stops.map((s) => [s.id, s.waypointId, s.legRouteId, s.durationMinutes]),
    );
    undoService.redo(db);
    expect(itineraryService.get(db, tripId, SETTINGS)).toBeNull();
  });

  it('inserting a stop clears the leg it splits, and undo restores it', () => {
    planThree();
    const macc = place('Macclesfield', MACCLESFIELD);
    commit(itineraryService.addStop(db, { tripId, waypointId: macc, index: 2 }));
    expect(order()).toEqual(['Buxton', 'Leek', 'Macclesfield', 'Ashbourne']);
    // Leek → Ashbourne no longer joins Macclesfield to Ashbourne.
    expect(links()[3]).toBeNull();
    expect(view().timeline.stops[3]?.flags).toContain('unplanned-leg');

    undoService.undo(db);
    expect(order()).toEqual(['Buxton', 'Leek', 'Ashbourne']);
    expect(view().timeline.complete).toBe(true);
    undoService.redo(db);
    expect(order()).toEqual(['Buxton', 'Leek', 'Macclesfield', 'Ashbourne']);
  });

  it('removing a stop clears the next leg, and undo restores both', () => {
    const { stops, legs } = planThree();
    commit(itineraryService.removeStop(db, { id: stops[1] ?? '' }));
    expect(order()).toEqual(['Buxton', 'Ashbourne']);
    expect(links()).toEqual([null, null]);

    undoService.undo(db);
    expect(order()).toEqual(['Buxton', 'Leek', 'Ashbourne']);
    expect(links()).toEqual([null, legs[0], legs[1]]);
    expect(view().stops[1]?.id).toBe(stops[1]);
  });

  it('moving a stop clears the links it breaks; undo and redo are exact', () => {
    const { legs } = planThree();
    const ash = view().stops[2]?.id ?? '';
    commit(itineraryService.moveStop(db, { id: ash, toIndex: 1 }));
    expect(order()).toEqual(['Buxton', 'Ashbourne', 'Leek']);
    expect(links()).toEqual([null, null, null]);

    undoService.undo(db);
    expect(order()).toEqual(['Buxton', 'Leek', 'Ashbourne']);
    expect(links()).toEqual([null, legs[0], legs[1]]);

    undoService.redo(db);
    expect(order()).toEqual(['Buxton', 'Ashbourne', 'Leek']);
    expect(links()).toEqual([null, null, null]);
  });

  it('a stop that becomes first loses its arriving leg', () => {
    planThree();
    const leekStop = view().stops[1]?.id ?? '';
    commit(itineraryService.moveStop(db, { id: leekStop, toIndex: 0 }));
    expect(order()[0]).toBe('Leek');
    expect(links()[0]).toBeNull();
  });

  it('undoes stop edits, leg links and plan edits', () => {
    const { stops, legs } = planThree();
    commit(itineraryService.updateStop(db, stops[1] ?? '', { durationMinutes: 120, notes: 'Lunch' }));
    commit(itineraryService.linkLeg(db, { id: stops[2] ?? '', routeId: null }));
    commit(itineraryService.update(db, tripId, { startTime: '07:30', rangeKm: 200 }));

    undoService.undo(db);
    expect(view().itinerary).toMatchObject({ startTime: '09:00', rangeKm: null });
    undoService.undo(db);
    expect(links()[2]).toBe(legs[1]);
    undoService.undo(db);
    expect(view().stops[1]).toMatchObject({ durationMinutes: 60, notes: null });
  });

  it('a deleted waypoint shows as a missing place, and its undo heals the stop', () => {
    planThree();
    commit(waypointService.remove(db, leek));
    const lost = view();
    expect(lost.stops[1]?.place).toBeNull();
    expect(lost.timeline.stops[1]?.flags).toContain('location-deleted');

    undoService.undo(db);
    expect(view().stops[1]?.place?.name).toBe('Leek');
  });

  it('a linked route that does not join its stops is not trusted for timing', () => {
    const { stops } = planThree();
    commit(itineraryService.linkLeg(db, { id: stops[2] ?? '', routeId: road(MACCLESFIELD, BUXTON, 'Wrong way') }));
    const result = view();
    expect(result.stops[2]?.leg?.fits).toBe(false);
    expect(result.timeline.stops[2]?.flags).toContain('unplanned-leg');
  });

  it('choosing a route makes it the user’s; clearing it returns the leg to by road', () => {
    const { stops, legs } = planThree();
    expect(view().stops[1]?.legMode).toBe('route');
    commit(itineraryService.linkLeg(db, { id: stops[1] ?? '', routeId: null }));
    expect(view().stops[1]).toMatchObject({ legMode: 'road', legRouteId: null });
    undoService.undo(db);
    expect(view().stops[1]).toMatchObject({ legMode: 'route', legRouteId: legs[0] });
  });

  it('marks a leg as other transport with a time, and undo restores the route it had', () => {
    const { stops, legs } = planThree();
    commit(
      itineraryService.setLegMode(db, { id: stops[2] ?? '', mode: 'other', transport: 'ferry', minutes: 90, label: 'Leek ferry' }),
    );
    const ferry = view();
    expect(ferry.stops[2]).toMatchObject({ legMode: 'other', legTransport: 'ferry', legMinutes: 90, legRouteId: null, leg: null });
    expect(ferry.timeline.stops[2]?.legDriveSeconds).toBe(5400);
    undoService.undo(db);
    expect(view().stops[2]).toMatchObject({ legMode: 'route', legRouteId: legs[1], legTransport: null });
  });

  it('refuses a leg mode on the first stop, a route mode without a route, and nonsense times', () => {
    const { stops } = planThree();
    expect(() => itineraryService.setLegMode(db, { id: stops[0] ?? '', mode: 'other' })).toThrow(/first stop/);
    expect(() => itineraryService.setLegMode(db, { id: stops[1] ?? '', mode: 'route' })).toThrow(/Choose the route/);
    expect(() => itineraryService.setLegMode(db, { id: stops[1] ?? '', mode: 'other', minutes: 0 })).toThrow();
  });

  it('a reorder resets the legs it breaks to by road, and undo restores them exactly', () => {
    const { stops } = planThree();
    commit(itineraryService.setLegMode(db, { id: stops[2] ?? '', mode: 'other', transport: 'train', minutes: 40 }));
    commit(itineraryService.moveStop(db, { id: stops[2] ?? '', toIndex: 1 }));
    expect(view().stops.map((s) => s.legMode)).toEqual(['road', 'road', 'road']);
    undoService.undo(db);
    expect(view().stops.map((s) => s.legMode)).toEqual(['road', 'route', 'other']);
    expect(view().stops[2]).toMatchObject({ legTransport: 'train', legMinutes: 40 });
  });

  it('says why a by-road leg has no route, and only for those', () => {
    const { stops } = planThree();
    commit(itineraryService.linkLeg(db, { id: stops[1] ?? '', routeId: null }));
    commit(itineraryService.setLegMode(db, { id: stops[2] ?? '', mode: 'other', transport: 'ferry' }));
    const result = itineraryService.get(db, tripId, SETTINGS, () => 'No map regions are loaded.');
    expect(result?.stops.map((s) => s.planIssue)).toEqual([null, 'No map regions are loaded.', null]);
  });

  it('archiving the trip keeps the itinerary', () => {
    planThree();
    commit(tripService.setStatus(db, { id: tripId, status: 'archived' }));
    expect(view().stops).toHaveLength(3);
  });

  it('stops at the 100-stop bound', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    for (let i = 0; i < MAX_ITINERARY_STOPS; i += 1) itineraryService.addStop(db, { tripId, waypointId: buxton });
    expect(() => itineraryService.addStop(db, { tripId, waypointId: leek })).toThrow(/at most 100/);
  });
});

function tripNodeOf(id: string): TreeNode | undefined {
  return findNode(libraryService.tree(db, { includeArchived: true }), `trip:${id}`);
}

const names = (node: TreeNode | undefined): string[] => (node?.children ?? []).map((c) => c.name);

describe('the trip in the library summarises its plan', () => {
  it('lists each day’s stops and drives in order, with their times', () => {
    planThree();
    commit(itineraryService.updateStop(db, view().stops[1]?.id ?? '', { durationKind: 'days', durationDays: 1 }));
    const trip = tripNodeOf(tripId);
    expect(names(trip)).toEqual(['Wed 1 Jul', 'Thu 2 Jul']);
    const [first, second] = trip?.children ?? [];
    expect(first?.children.map((c) => [c.kind, c.name])).toEqual([
      ['waypoint', 'Buxton'],
      ['route', 'Buxton → Leek'],
      ['waypoint', 'Leek'],
    ]);
    expect(first?.children[0]?.detail).toBe('leave 09:00');
    expect(first?.children[1]?.ref).toMatchObject({ kind: 'route' });
    expect(first?.children[2]?.detail).toMatch(/^\d\d:\d\d – Thu 09:00$/);
    expect(second?.children.map((c) => c.name)).toEqual(['Leek → Ashbourne', 'Ashbourne']);
    expect(first?.defaultExpanded).toBe(true);
    expect(first?.ref).toBeUndefined();
  });

  it('gives a stop used twice two distinct rows', () => {
    planThree();
    commit(itineraryService.addStop(db, { tripId, waypointId: buxton }));
    const rows: TreeNode[] = [];
    const walk = (node: TreeNode): void => {
      rows.push(node);
      node.children.forEach(walk);
    };
    walk(libraryService.tree(db, { includeArchived: true }));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    // The start, on its day; and the return, after a drive not yet planned,
    // under "Unknown times". Both select the same waypoint.
    const buxtonRows = rows.filter((r) => r.id.startsWith(`trip:${tripId}/`) && r.ref?.id === buxton);
    expect(buxtonRows.map((r) => r.id.split('/')[1])).toEqual(['day:2026-07-01', 'unknown']);
  });

  it('lists what is not in the plan, and unknown times, so nothing is lost', () => {
    planThree();
    road(LEEK, MACCLESFIELD, 'Side trip');
    place('Macclesfield', MACCLESFIELD);
    commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek again', LEEK) }));
    const trip = tripNodeOf(tripId);
    expect(names(trip)).toEqual(['Wed 1 Jul', 'Unknown times', 'Not in the plan']);
    // The drive leaves Ashbourne at a known time, so it is on that day, marked
    // not planned; only the arrival after it is unknown.
    const day = trip?.children[0];
    expect(day?.children.at(-1)).toMatchObject({ name: 'Drive to Leek again', detail: 'not planned' });
    const unknown = trip?.children.find((c) => c.name === 'Unknown times');
    expect(unknown?.children.map((c) => [c.name, c.detail])).toEqual([['Leek again', 'arrive —']]);
    const outside = trip?.children.find((c) => c.name === 'Not in the plan');
    expect(outside?.children.map((c) => c.name).toSorted()).toEqual(['Macclesfield', 'Side trip']);
  });

  it('shows other transport as a step with its time', () => {
    const { stops } = planThree();
    commit(itineraryService.setLegMode(db, { id: stops[2] ?? '', mode: 'other', transport: 'ferry', minutes: 90, label: 'Lake crossing' }));
    const day = tripNodeOf(tripId)?.children[0];
    expect(day?.children.find((c) => c.name === 'Ferry: Lake crossing')).toMatchObject({ kind: 'group', detail: '1 h 30 min' });
    expect(day?.detail).toContain('1 h 30 min other transport');
  });
});

describe('library tree dates', () => {

  it('shows a scheduled trip’s date range and leaves an unscheduled trip’s node unchanged', () => {
    const other = tripService.create(db, { name: 'No dates', folderId: null, description: null, notes: null }).result
      .id;
    const before = tripNodeOf(other);
    expect(before).not.toHaveProperty('detail');

    planThree();
    commit(itineraryService.updateStop(db, view().stops[1]?.id ?? '', { durationKind: 'days', durationDays: 2 }));

    expect(tripNodeOf(tripId)?.detail).toMatch(/^1–3 Jul 2026 · 3 days · \d+(\.\d)? km$/);
    expect(tripNodeOf(other)).toEqual(before);
  });

  it('says "from" while the end is unknown', () => {
    commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
    commit(itineraryService.addStop(db, { tripId, waypointId: buxton }));
    commit(itineraryService.addStop(db, { tripId, waypointId: leek }));
    expect(tripNodeOf(tripId)?.detail).toBe('from 1 Jul 2026');
  });
});
