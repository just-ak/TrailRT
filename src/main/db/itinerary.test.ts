import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import { createDatabase, type Db, type DbHandle } from './client';
import { MIGRATIONS, splitStatements } from './migrations/index';
import * as schema from './schema';
import * as itineraryRepo from './repositories/itineraries';
import * as tripRepo from './repositories/trips';
import * as waypointRepo from './repositories/waypoints';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

function waypoint(name: string, at: { lat: number; lon: number }): string {
  return waypointRepo.insertWaypoint(db, {
    tripId,
    groupId: null,
    name,
    lat: at.lat,
    lon: at.lon,
    eleM: null,
    description: null,
    symbol: 'pin',
    notes: null,
    source: 'user',
    metadata: undefined,
    now: Date.now(),
  }).id;
}

function stopValues(seq: number, waypointId: string): itineraryRepo.InsertStopValues {
  return {
    tripId,
    seq,
    waypointId,
    legRouteId: null,
    durationKind: 'hours',
    durationMinutes: 30,
    durationDays: null,
    departTime: null,
    arriveBy: null,
    departAt: null,
    notes: null,
    now: Date.now(),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p10-db-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  tripId = tripRepo.insertTrip(db, {
    id: '0190c3ae-1f2b-7c4d-9e8f-000000000010',
    folderId: null,
    name: 'Peak weekend',
    description: null,
    notes: null,
    now: Date.now(),
  }).id;
  itineraryRepo.insertItinerary(db, {
    tripId,
    startDate: '2026-10-23',
    startTime: '16:00',
    defaultDepart: '09:00',
    maxDriveMinutes: null,
    rangeKm: null,
    reservePct: 20,
    energy: 'fuel',
    now: Date.now(),
  });
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 0004', () => {
  it('upgrades a Phase 7 database and leaves its trips without an itinerary', () => {
    const upgradeDir = mkdtempSync(join(tmpdir(), 'trailrt-p10-upgrade-'));
    const file = join(upgradeDir, 'phase7.db');

    const sqlite = new Database(file);
    sqlite.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    for (const migration of MIGRATIONS.filter((m) => m.version <= 4)) {
      for (const statement of splitStatements(migration.sql)) sqlite.exec(statement);
      sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, Date.now());
    }
    const old = drizzle(sqlite, { schema });
    const existing = tripRepo.insertTrip(old, {
      id: '0190c3ae-1f2b-7c4d-9e8f-000000000011',
      folderId: null,
      name: 'Before Phase 10',
      description: null,
      notes: null,
      now: Date.now(),
    });
    sqlite.close();

    const upgraded = createDatabase({ file });
    expect(upgraded.migration.applied).toEqual([5, 6]);
    expect(tripRepo.findTrip(upgraded.db, existing.id)?.name).toBe('Before Phase 10');
    expect(itineraryRepo.findItinerary(upgraded.db, existing.id)).toBeNull();
    upgraded.close();
    rmSync(upgradeDir, { recursive: true, force: true });
  });

  it('0005 marks a leg that already had a route as the user’s own choice', () => {
    const upgradeDir = mkdtempSync(join(tmpdir(), 'trailrt-p10-legs-'));
    const file = join(upgradeDir, 'phase10.db');
    const sqlite = new Database(file);
    sqlite.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    for (const migration of MIGRATIONS.filter((m) => m.version <= 5)) {
      for (const statement of splitStatements(migration.sql)) sqlite.exec(statement);
      sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, Date.now());
    }
    sqlite.exec(`
      INSERT INTO trips (id, name) VALUES ('t', 'Trip');
      INSERT INTO itineraries (trip_id, start_date, start_time) VALUES ('t', '2026-07-01', '09:00');
      INSERT INTO itinerary_stops (id, trip_id, seq, waypoint_id, leg_route_id) VALUES ('a', 't', 0, 'w1', NULL);
      INSERT INTO itinerary_stops (id, trip_id, seq, waypoint_id, leg_route_id) VALUES ('b', 't', 1, 'w2', 'r1');
      INSERT INTO itinerary_stops (id, trip_id, seq, waypoint_id, leg_route_id) VALUES ('c', 't', 2, 'w3', NULL);
    `);
    sqlite.close();

    const upgraded = createDatabase({ file });
    expect(itineraryRepo.listStops(upgraded.db, 't').map((s) => [s.id, s.legMode])).toEqual([
      ['a', 'road'],
      ['b', 'route'],
      ['c', 'road'],
    ]);
    upgraded.close();
    rmSync(upgradeDir, { recursive: true, force: true });
  });

  it('refuses an energy or reserve outside its range', () => {
    expect(() => itineraryRepo.updateItinerary(db, tripId, { reservePct: 95 }, Date.now())).toThrow();
    expect(() =>
      itineraryRepo.updateItinerary(db, tripId, { energy: 'diesel' as 'fuel' }, Date.now()),
    ).toThrow();
  });
});

describe('itinerary repository', () => {
  it('lists stops in sequence order, whatever order they were written in', () => {
    const a = waypoint('Buxton', BUXTON);
    const b = waypoint('Leek', LEEK);
    const second = itineraryRepo.insertStop(db, stopValues(1, b));
    const first = itineraryRepo.insertStop(db, stopValues(0, a));
    expect(itineraryRepo.listStops(db, tripId).map((s) => s.id)).toEqual([first.id, second.id]);

    itineraryRepo.resequence(db, [second.id, first.id]);
    expect(itineraryRepo.listStops(db, tripId).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('deleting the trip removes the itinerary and its stops', () => {
    const stop = itineraryRepo.insertStop(db, stopValues(0, waypoint('Buxton', BUXTON)));
    tripRepo.deleteTrip(db, tripId);
    expect(itineraryRepo.findItinerary(db, tripId)).toBeNull();
    expect(itineraryRepo.findStop(db, stop.id)).toBeNull();
  });

  it('removing the itinerary removes its stops but not the waypoints', () => {
    const wp = waypoint('Buxton', BUXTON);
    const stop = itineraryRepo.insertStop(db, stopValues(0, wp));
    itineraryRepo.deleteItinerary(db, tripId);
    expect(itineraryRepo.findStop(db, stop.id)).toBeNull();
    expect(waypointRepo.findWaypoint(db, wp)).not.toBeNull();
  });

  it('deleting a waypoint leaves its stop in place, pointing at the old id', () => {
    const wp = waypoint('Buxton', BUXTON);
    const stop = itineraryRepo.insertStop(db, stopValues(0, wp));
    waypointRepo.deleteWaypoint(db, wp);
    expect(itineraryRepo.findStop(db, stop.id)?.waypointId).toBe(wp);
  });

  it('keeps nullable fields null rather than zero', () => {
    const stop = itineraryRepo.insertStop(db, {
      ...stopValues(0, waypoint('Buxton', BUXTON)),
      durationKind: 'days',
      durationMinutes: null,
      durationDays: 2,
    });
    expect(stop).toMatchObject({ durationMinutes: null, departTime: null, legRouteId: null });
    const plan = itineraryRepo.findItinerary(db, tripId);
    expect(plan).toMatchObject({ maxDriveMinutes: null, rangeKm: null, reservePct: 20 });
  });
});
