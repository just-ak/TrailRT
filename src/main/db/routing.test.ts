import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createDatabase, type Db, type DbHandle } from './client';
import { expectedSchemaVersion } from './migrate';
import { MIGRATIONS, splitStatements } from './migrations/index';
import * as schema from './schema';
import * as attrs from './repositories/roadAttributes';
import * as control from './repositories/routeControlPoints';
import * as routeRepo from './repositories/routes';
import * as tripRepo from './repositories/trips';

let dir: string;
let handle: DbHandle;
let db: Db;
let routeId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p4-db-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;

  const trip = tripRepo.insertTrip(db, {
    id: '0190c3ae-1f2b-7c4d-9e8f-000000000001',
    folderId: null,
    name: 'Trip',
    description: null,
    notes: null,
    now: Date.now(),
  });
  routeId = routeRepo.insertRoute(db, {
    tripId: trip.id,
    name: 'Route',
    colour: null,
    source: 'user',
    now: Date.now(),
  }).id;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 0002', () => {
  it('is applied, and 0003 is the current schema version', () => {
    expect(handle.migration.schemaVersion).toBe(expectedSchemaVersion());
    expect(expectedSchemaVersion()).toBe(7);
  });

  it('applies on top of a Phase 3 database without losing data', () => {
    // Open a database at the previous version, write a route, then let the
    // runner upgrade it. This is the path every existing install takes.
    const upgradeDir = mkdtempSync(join(tmpdir(), 'trailrt-upgrade-'));
    const file = join(upgradeDir, 'old.db');

    const first = createDatabase({ file });
    const trip = tripRepo.insertTrip(first.db, {
      id: '0190c3ae-1f2b-7c4d-9e8f-000000000002',
      folderId: null,
      name: 'Existing',
      description: null,
      notes: null,
      now: Date.now(),
    });
    const existing = routeRepo.insertRoute(first.db, {
      tripId: trip.id,
      name: 'Existing route',
      colour: null,
      source: 'user',
      now: Date.now(),
    });
    first.close();

    const second = createDatabase({ file });
    expect(second.migration.alreadyCurrent).toBe(true);
    expect(routeRepo.findRoute(second.db, existing.id)?.name).toBe(
      'Existing route',
    );
    // A pre-existing route is hand-drawn, which the null provider records.
    expect(control.hasControlPoints(second.db, existing.id)).toBe(false);
    second.close();
    rmSync(upgradeDir, { recursive: true, force: true });
  });
});

describe('migration 0003', () => {
  it('upgrades a Phase 5 database: existing control points become via points with unknown boundaries', () => {
    // Build a database exactly as Phase 5 left it: migrations 1–3 only, with a
    // snapped route's control points written in the old three-column form.
    const upgradeDir = mkdtempSync(join(tmpdir(), 'trailrt-p6-upgrade-'));
    const file = join(upgradeDir, 'phase5.db');

    const sqlite = new Database(file);
    sqlite.exec(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    for (const migration of MIGRATIONS.filter((m) => m.version <= 3)) {
      for (const statement of splitStatements(migration.sql)) sqlite.exec(statement);
      sqlite
        .prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)')
        .run(migration.version, migration.name, Date.now());
    }
    const old = drizzle(sqlite, { schema });
    const trip = tripRepo.insertTrip(old, {
      id: '0190c3ae-1f2b-7c4d-9e8f-000000000003',
      folderId: null,
      name: 'Phase 5 trip',
      description: null,
      notes: null,
      now: Date.now(),
    });
    const route = routeRepo.insertRoute(old, {
      tripId: trip.id,
      name: 'Snapped in Phase 5',
      colour: null,
      source: 'user',
      now: Date.now(),
    });
    const insert = sqlite.prepare(
      'INSERT INTO route_control_points (id, route_id, seq, lat, lon) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('cp-0', route.id, 0, 53.2588, -1.911);
    insert.run('cp-1', route.id, 1, 53.2602, -2.1255);
    sqlite.close();

    const upgraded = createDatabase({ file });
    // 0004 (Phase 10) follows on the same upgrade; it touches no route table.
    expect(upgraded.migration.applied).toEqual([4, 5, 6, 7]);
    expect(control.listControlRows(upgraded.db, route.id)).toEqual([
      { lat: 53.2588, lon: -1.911, role: 'via', shapeIndex: null },
      { lat: 53.2602, lon: -2.1255, role: 'via', shapeIndex: null },
    ]);
    upgraded.close();
    rmSync(upgradeDir, { recursive: true, force: true });
  });
});

describe('route control points', () => {
  it('store role and leg boundary, defaulting to via and unknown', () => {
    control.replaceControlPoints(db, routeId, [
      { lat: 53.2588, lon: -1.911, role: 'via', shapeIndex: 0 },
      { lat: 53.26, lon: -2.0, role: 'shaping', shapeIndex: 40 },
      { lat: 53.2602, lon: -2.1255 },
    ]);
    expect(control.listControlRows(db, routeId)).toEqual([
      { lat: 53.2588, lon: -1.911, role: 'via', shapeIndex: 0 },
      { lat: 53.26, lon: -2.0, role: 'shaping', shapeIndex: 40 },
      { lat: 53.2602, lon: -2.1255, role: 'via', shapeIndex: null },
    ]);
  });

  // Absence is the signal for "hand-drawn", which is how every pre-Phase-4
  // route keeps behaving exactly as it did.
  it('are absent for a route that was never snapped', () => {
    expect(control.hasControlPoints(db, routeId)).toBe(false);
    expect(control.listControlPoints(db, routeId)).toEqual([]);
  });

  it('round-trip in order', () => {
    const points = [
      { lat: 53.2533, lon: -1.9343 },
      { lat: 53.2578, lon: -2.0327 },
      { lat: 53.261, lon: -2.0675 },
    ];
    control.replaceControlPoints(db, routeId, points);

    expect(control.listControlPoints(db, routeId)).toEqual(points);
    expect(control.hasControlPoints(db, routeId)).toBe(true);
  });

  it('preserve full coordinate precision', () => {
    const point = { lat: 53.25331234567890, lon: -1.93431234567890 };
    control.replaceControlPoints(db, routeId, [point]);
    expect(control.listControlPoints(db, routeId)[0]).toEqual(point);
  });

  it('replace rather than append', () => {
    control.replaceControlPoints(db, routeId, [
      { lat: 53.2588, lon: -1.911 },
      { lat: 53.1043, lon: -2.0221 },
    ]);
    control.replaceControlPoints(db, routeId, [{ lat: 53.0177, lon: -1.7317 }]);

    expect(control.listControlPoints(db, routeId)).toEqual([
      { lat: 53.0177, lon: -1.7317 },
    ]);
  });

  it('can be cleared, returning the route to hand-drawn', () => {
    control.replaceControlPoints(db, routeId, [{ lat: 53.2588, lon: -1.911 }]);
    control.clearControlPoints(db, routeId);
    expect(control.hasControlPoints(db, routeId)).toBe(false);
  });

  it('are deleted with their route', () => {
    control.replaceControlPoints(db, routeId, [{ lat: 53.2588, lon: -1.911 }]);
    routeRepo.deleteRoute(db, routeId);
    expect(control.listControlPoints(db, routeId)).toEqual([]);
  });
});

describe('geometryHash', () => {
  const a = { lat: 53.2533, lon: -1.9343 };
  const b = { lat: 53.2578, lon: -2.0327 };

  it('is stable for the same geometry', () => {
    expect(attrs.geometryHash([a, b])).toBe(attrs.geometryHash([a, b]));
  });

  it('changes when a coordinate changes', () => {
    expect(attrs.geometryHash([a, b])).not.toBe(
      attrs.geometryHash([a, { lat: 53.1043, lon: -2.0221 }]),
    );
  });

  it('changes when order changes, because a reversed route is different', () => {
    expect(attrs.geometryHash([a, b])).not.toBe(attrs.geometryHash([b, a]));
  });

  // A prefix must not collide with the longer geometry it is a prefix of.
  it('distinguishes a geometry from its own prefix', () => {
    expect(attrs.geometryHash([a])).not.toBe(attrs.geometryHash([a, a]));
  });

  // Rounding to six decimals is about 11 cm — far finer than any matching
  // tolerance, but enough that a float round-trip does not read as an edit.
  it('ignores differences far below matching tolerance', () => {
    expect(attrs.geometryHash([a])).toBe(
      attrs.geometryHash([{ lat: 53.2533000001, lon: -1.9343000001 }]),
    );
  });

  it('notices a change at the retained precision', () => {
    expect(attrs.geometryHash([a])).not.toBe(
      attrs.geometryHash([{ lat: 53.25331, lon: -1.9343 }]),
    );
  });

  it('handles an empty geometry', () => {
    expect(attrs.geometryHash([])).toBe(attrs.geometryHash([]));
  });
});

describe('road attribute cache', () => {
  const shape = [
    { lat: 53.2533, lon: -1.9343 },
    { lat: 53.2578, lon: -2.0327 },
  ];
  const payload: attrs.RoadAttributePayload = {
    mode: 'auto',
    unmatchedPointCount: 0,
    edges: [
      {
        startIndex: 0,
        endIndex: 1,
        lengthM: 500,
        speedLimitMps: 22.22,
        roadClass: 'secondary',
        surface: 'paved',
      },
    ],
  };

  const store = (geometry: readonly { lat: number; lon: number }[]): void => {
    attrs.upsert(db, {
      ownerType: 'route',
      ownerId: routeId,
      provider: 'valhalla',
      geometryHash: attrs.geometryHash(geometry),
      fetchedAt: 1_700_000_000_000,
      payload,
    });
  };

  it('returns nothing before anything is cached', () => {
    expect(
      attrs.findFresh(db, 'route', routeId, attrs.geometryHash(shape)),
    ).toBeNull();
  });

  it('returns a hit for unchanged geometry', () => {
    store(shape);
    const hit = attrs.findFresh(db, 'route', routeId, attrs.geometryHash(shape));

    expect(hit?.provider).toBe('valhalla');
    expect(hit?.fetchedAt).toBe(1_700_000_000_000);
    expect(hit?.payload.edges[0]?.roadClass).toBe('secondary');
    expect(hit?.payload.edges[0]?.speedLimitMps).toBeCloseTo(22.22, 6);
  });

  // The whole point of hashing: an edited route must never be handed
  // attributes computed for its previous shape.
  it('misses after the geometry changes', () => {
    store(shape);
    const edited = [...shape, { lat: 53.2602, lon: -2.1256 }];
    expect(
      attrs.findFresh(db, 'route', routeId, attrs.geometryHash(edited)),
    ).toBeNull();
  });

  it('keeps one row per object, replacing on re-match', () => {
    store(shape);
    store([...shape, { lat: 53.2602, lon: -2.1256 }]);

    // The newer hash hits; the older one does not, because there is only one row.
    expect(
      attrs.findFresh(
        db,
        'route',
        routeId,
        attrs.geometryHash([...shape, { lat: 53.2602, lon: -2.1256 }]),
      ),
    ).not.toBeNull();
    expect(
      attrs.findFresh(db, 'route', routeId, attrs.geometryHash(shape)),
    ).toBeNull();
  });

  it('keeps route and track caches separate', () => {
    store(shape);
    expect(
      attrs.findFresh(db, 'track', routeId, attrs.geometryHash(shape)),
    ).toBeNull();
  });

  // Requirement 8.4: showing stale data with its age beats showing nothing when
  // the provider is unreachable.
  it('can be read regardless of staleness, for the offline path', () => {
    store(shape);
    const any = attrs.findAny(db, 'route', routeId);
    expect(any?.fetchedAt).toBe(1_700_000_000_000);
    expect(any?.geometryHash).toBe(attrs.geometryHash(shape));
  });

  it('preserves a null speed limit rather than coercing it', () => {
    attrs.upsert(db, {
      ownerType: 'route',
      ownerId: routeId,
      provider: 'valhalla',
      geometryHash: attrs.geometryHash(shape),
      fetchedAt: 1,
      payload: {
        mode: 'auto',
        unmatchedPointCount: 2,
        edges: [
          {
            startIndex: 0,
            endIndex: 1,
            lengthM: 500,
            speedLimitMps: null,
            roadClass: 'unclassified',
            surface: null,
          },
        ],
      },
    });

    const hit = attrs.findFresh(db, 'route', routeId, attrs.geometryHash(shape));
    expect(hit?.payload.edges[0]?.speedLimitMps).toBeNull();
    expect(hit?.payload.edges[0]?.surface).toBeNull();
    expect(hit?.payload.unmatchedPointCount).toBe(2);
  });

  it('treats a corrupt payload as a miss rather than throwing', () => {
    store(shape);
    handle.sqlite
      .prepare('update road_attributes set payload = ? where owner_id = ?')
      .run('{not json', routeId);

    expect(
      attrs.findFresh(db, 'route', routeId, attrs.geometryHash(shape)),
    ).toBeNull();
  });

  it('can be removed', () => {
    store(shape);
    attrs.remove(db, 'route', routeId);
    expect(attrs.findAny(db, 'route', routeId)).toBeNull();
  });
});
