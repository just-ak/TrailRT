import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import type { ParsedTrack } from '@shared/io/types';
import * as trackService from '../services/trackService';
import * as tripService from '../services/tripService';
import { createDatabase } from './client';
import { MIGRATIONS, splitStatements } from './migrations/index';
import * as trackRepo from './repositories/tracks';

/**
 * ADR 0025: each imported file is kept once, however many tracks were read
 * from it. Migration 0011 collapses the copies older builds made, and the
 * file is compacted afterwards so the space comes back.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-sources-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const count = (sqlite: Database.Database, sql: string): number => (sqlite.prepare(sql).get() as { n: number }).n;

/** A database as a build before migration 0011 left it: a copy of the file per track. */
function legacyDatabase(file: string, copies: { trackId: string; bytes: Uint8Array }[]): void {
  const sqlite = new Database(file);
  sqlite.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  for (const migration of MIGRATIONS.filter((m) => m.version <= 11)) {
    for (const statement of splitStatements(migration.sql)) sqlite.exec(statement);
    sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, Date.now());
  }
  sqlite.prepare("INSERT INTO trips (id, name, status, created_at, updated_at) VALUES ('t1', 'Peak', 'active', 1, 1)").run();
  for (const [i, copy] of copies.entries()) {
    sqlite.prepare("INSERT INTO tracks (id, trip_id, name, source, created_at, updated_at) VALUES (?, 't1', ?, 'import', ?, ?)").run(copy.trackId, `Track ${i}`, 1000 + i, 1000 + i);
    sqlite
      .prepare("INSERT INTO track_sources (id, track_id, format, content_hash, original_bytes, created_at) VALUES (?, ?, 'gpx', ?, ?, ?)")
      .run(`s${i}`, copy.trackId, sha(copy.bytes), Buffer.from(copy.bytes), 1000 + i);
  }
  sqlite.close();
}

describe('migration 0011: source files', () => {
  it('keeps one copy of each file, every track still finds its own bytes, and the file shrinks', () => {
    const file = join(dir, 'legacy.db');
    // One 1 MB file read into three tracks, as a multi-track GPX was, and another file.
    const shared = randomBytes(1024 * 1024);
    const other = randomBytes(64 * 1024);
    legacyDatabase(file, [
      { trackId: 'a', bytes: shared },
      { trackId: 'b', bytes: shared },
      { trackId: 'c', bytes: shared },
      { trackId: 'd', bytes: other },
    ]);
    const before = new Database(file, { readonly: true });
    const pagesBefore = count(before, 'SELECT page_count AS n FROM pragma_page_count');
    before.close();

    const upgraded = createDatabase({ file });
    expect(upgraded.migration.applied).toEqual([12]);
    expect(count(upgraded.sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(2);
    expect(count(upgraded.sqlite, 'SELECT count(*) AS n FROM track_sources')).toBe(4);
    for (const id of ['a', 'b', 'c']) expect(Buffer.from(trackRepo.findTrackSource(upgraded.db, id)?.bytes ?? [])).toEqual(shared);
    expect(Buffer.from(trackRepo.findTrackSource(upgraded.db, 'd')?.bytes ?? [])).toEqual(other);
    expect(trackRepo.findTrackSource(upgraded.db, 'a')).toMatchObject({ format: 'gpx', contentHash: sha(shared) });
    // Compacted: the two dropped copies are gone from the file, not left as free pages.
    expect(count(upgraded.sqlite, 'SELECT freelist_count AS n FROM pragma_freelist_count')).toBe(0);
    expect(count(upgraded.sqlite, 'SELECT page_count AS n FROM pragma_page_count')).toBeLessThan(pagesBefore * 0.6);
    upgraded.close();
  });

  it('upgrades a database with no originals at all', () => {
    const file = join(dir, 'empty.db');
    legacyDatabase(file, []);
    const upgraded = createDatabase({ file });
    expect(upgraded.migration.applied).toEqual([12]);
    expect(count(upgraded.sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(0);
    upgraded.close();
  });
});

const parsed = (name: string): ParsedTrack => ({
  name,
  segments: [{ points: [{ lat: BUXTON.lat, lon: BUXTON.lon, ele: null, time: null }, { lat: LEEK.lat, lon: LEEK.lon, ele: null, time: null }] }],
  metadata: {},
});

describe('source files, from now on', () => {

  it('stores a file once when several tracks come from it, and removes it with the last of them', () => {
    const handle = createDatabase({ file: join(dir, 'new.db') });
    const { db, sqlite } = handle;
    const tripId = tripService.create(db, { name: 'Peak', folderId: null, description: null, notes: null }).result.id;
    const bytes = new TextEncoder().encode('<gpx>two tracks</gpx>');
    const make = (name: string): string =>
      trackService.createFromParsed(db, { tripId, parsed: parsed(name), source: 'import', originalBytes: bytes, originalFormat: 'gpx' }).result.id;
    const first = make('One');
    const second = make('Two');

    expect(count(sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(1);
    expect(trackService.originalBytes(db, second)?.bytes).toEqual(bytes);

    trackService.remove(db, first);
    expect(count(sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(1);
    expect(trackService.originalBytes(db, second)?.bytes).toEqual(bytes);

    trackService.remove(db, second);
    expect(count(sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(0);
    handle.close();
  });

  it('removes the file when the trip goes with its tracks', () => {
    const handle = createDatabase({ file: join(dir, 'trip.db') });
    const { db, sqlite } = handle;
    const tripId = tripService.create(db, { name: 'Peak', folderId: null, description: null, notes: null }).result.id;
    trackService.createFromParsed(db, { tripId, parsed: parsed('One'), source: 'import', originalBytes: new Uint8Array([1, 2, 3]), originalFormat: 'gpx' });
    expect(count(sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(1);
    tripService.remove(db, tripId);
    expect(count(sqlite, 'SELECT count(*) AS n FROM source_files')).toBe(0);
    handle.close();
  });
});
