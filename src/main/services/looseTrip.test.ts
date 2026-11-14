import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as libraryService from './libraryService';
import * as routeService from './routeService';
import * as tripService from './tripService';

/**
 * Phase 14 task 8: items outside a trip, kept by one hidden holder (ADR 0022).
 * The holder is a trips row, so everything that works on a trip works on it;
 * these tests pin down that it is never treated as one.
 */

let dir: string;
let handle: DbHandle;
let db: Db;

const ok = <T>(m: Mutation<T>): T => m.result;
const trip = (name: string): string => ok(tripService.create(db, { name, folderId: null, description: null, notes: null })).id;
const vertex = (at: { lat: number; lon: number }) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });
const route = (tripId: string, name: string): string =>
  ok(routeService.create(db, { tripId, name, colour: null, points: [vertex(BUXTON), vertex(LEEK)] })).id;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-loose-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const listed = (): string[] => tripService.list(db, { includeArchived: true, sortKey: 'name', sortDirection: 'asc' }).map((t) => t.name);

describe('the holder of items outside a trip', () => {
  it('is made once, on first use, and kept', () => {
    const first = tripService.looseTripId(db);
    expect(tripService.looseTripId(db)).toBe(first);
    expect(tripService.isLoose(db, first)).toBe(true);
    expect(tripService.get(db, first).name).toBe('Not in a trip');
  });

  it('is never listed, searched for or shown in the overview as a trip', () => {
    trip('Peak loop');
    tripService.looseTripId(db);
    expect(listed()).toEqual(['Peak loop']);
    expect(tripService.search(db, 'trip').map((t) => t.name)).toEqual([]);
    expect(libraryService.overview(db, { includeArchived: true }).map((t) => t.name)).toEqual(['Peak loop']);
    const tree = libraryService.tree(db, { includeArchived: true });
    const trips = tree.children.find((c) => c.viewId === 'trips');
    expect(trips?.children.map((c) => c.name)).toEqual(['Peak loop']);
  });

  it('refuses everything that only makes sense for a trip', () => {
    const loose = tripService.looseTripId(db);
    expect(() => tripService.update(db, { id: loose, name: 'Mine' })).toThrow(/outside a trip/);
    expect(() => tripService.remove(db, loose)).toThrow(/outside a trip/);
    expect(() => tripService.duplicate(db, loose)).toThrow(/outside a trip/);
    expect(() => tripService.setStatus(db, { id: loose, status: 'archived' })).toThrow(/outside a trip/);
    expect(() => tripService.move(db, { id: loose, folderId: null })).toThrow(/outside a trip/);
    expect(() => itineraryService.create(db, { tripId: loose, startDate: '2026-11-13', startTime: '09:00' })).toThrow(/plan/);
  });

  it('lists its items first in a section, as not in a trip', () => {
    const peak = trip('Peak loop');
    route(peak, 'A515');
    route(tripService.looseTripId(db), 'Wincle back roads');
    const tree = libraryService.tree(db, { includeArchived: true });
    const routes = tree.children.find((c) => c.viewId === 'routes');
    expect(routes?.children.map((c) => [c.name, c.detail])).toEqual([
      ['Wincle back roads', 'Not in a trip'],
      ['A515', 'Peak loop'],
    ]);
  });

  it('moves an item out of a trip and back, each one step with its own inverse', () => {
    const peak = trip('Peak loop');
    const id = route(peak, 'A515');
    const loose = tripService.looseTripId(db);
    const out = routeService.moveToTrip(db, { id, tripId: loose });
    expect(out.result.tripId).toBe(loose);
    expect(out.inverse).toEqual({ kind: 'route:move', payload: { id, tripId: peak } });
    const back = routeService.moveToTrip(db, { id, tripId: peak });
    expect(back.inverse).toEqual({ kind: 'route:move', payload: { id, tripId: loose } });
  });
});
