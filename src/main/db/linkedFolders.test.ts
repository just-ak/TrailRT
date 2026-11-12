import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { PhotoMetadata } from '@shared/domain/linkedFolders';
import { isWaypointSource } from '@shared/domain/types';
import { collectionWaypointSchema } from '@shared/io/collection';
import { createDatabase, type Db, type DbHandle } from './client';
import { MIGRATIONS, splitStatements } from './migrations/index';
import * as schema from './schema';
import * as filesRepo from './repositories/folderFiles';
import * as foldersRepo from './repositories/linkedFolders';
import * as photosRepo from './repositories/photoMetadata';
import * as tripRepo from './repositories/trips';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripA: string;
let tripB: string;
let clock = 1_790_000_000_000;

const tick = (): number => (clock += 1000);

function trip(name: string): string {
  return tripRepo.insertTrip(db, { id: `trip-${name}`, folderId: null, name, description: null, notes: null, now: tick() }).id;
}

function folder(tripId: string, realPath: string): string {
  return foldersRepo.insertLinkedFolder(db, {
    tripId,
    path: realPath,
    realPath,
    name: realPath.split('/').at(-1) ?? realPath,
    includeSubfolders: true,
    now: tick(),
  }).id;
}

const UNLOCATED: PhotoMetadata = {
  state: 'unlocated',
  reason: 'No location in this photo',
  lat: null,
  lon: null,
  altitudeM: null,
  accuracyM: null,
  directionDeg: null,
  directionRef: null,
  takenLocal: null,
  takenOffsetMin: null,
  orientation: null,
};

function located(at: { lat: number; lon: number }, takenLocal: string | null, extra: Partial<PhotoMetadata> = {}): PhotoMetadata {
  return { ...UNLOCATED, state: 'located', reason: null, lat: at.lat, lon: at.lon, takenLocal, ...extra };
}

function photo(folderId: string, relativePath: string, meta: PhotoMetadata): string {
  const file = filesRepo.upsertFile(db, {
    folderId,
    relativePath,
    kind: 'photo',
    format: relativePath.endsWith('.heic') ? 'heic' : 'jpeg',
    sizeBytes: 3_000_000,
    mtimeMs: 1_781_000_000_123.456,
    fingerprint: `fp-${relativePath}`,
  });
  photosRepo.upsertPhotoMetadata(db, file.id, meta);
  return file.id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p11-db-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  tripA = trip('Peak weekend');
  tripB = trip('Staffordshire');
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 0006', () => {
  it('upgrades a Phase 10 database, keeps its data, and is idempotent', () => {
    const upgradeDir = mkdtempSync(join(tmpdir(), 'trailrt-p11-upgrade-'));
    const file = join(upgradeDir, 'phase10.db');
    const sqlite = new Database(file);
    sqlite.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    for (const migration of MIGRATIONS.filter((m) => m.version <= 6)) {
      for (const statement of splitStatements(migration.sql)) sqlite.exec(statement);
      sqlite.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.version, migration.name, Date.now());
    }
    tripRepo.insertTrip(drizzle(sqlite, { schema }), {
      id: 'before-phase-11',
      folderId: null,
      name: 'Before Phase 11',
      description: null,
      notes: null,
      now: Date.now(),
    });
    sqlite.close();

    const upgraded = createDatabase({ file });
    expect(upgraded.migration.applied).toEqual([7]);
    expect(tripRepo.findTrip(upgraded.db, 'before-phase-11')?.name).toBe('Before Phase 11');
    expect(foldersRepo.listLinkedFolders(upgraded.db)).toEqual([]);
    upgraded.close();

    const again = createDatabase({ file });
    expect(again.migration.applied).toEqual([]);
    again.close();
    rmSync(upgradeDir, { recursive: true, force: true });
  });
});

describe('constraints', () => {
  let fileId: string;
  beforeEach(() => {
    fileId = filesRepo.upsertFile(db, {
      folderId: folder(tripA, '/Volumes/Photos/Peak'),
      relativePath: 'a.jpg',
      kind: 'photo',
      format: 'jpeg',
      sizeBytes: 1,
      mtimeMs: 1,
      fingerprint: null,
    }).id;
  });

  it.each<[string, Partial<PhotoMetadata>]>([
    ['half a coordinate', { lat: BUXTON.lat, lon: null }],
    ['a located photo with no position', { state: 'located', reason: null }],
    ['a direction without its reference', { directionDeg: 90, directionRef: null }],
    ['a reference without a direction', { directionRef: 'T' }],
    ['an unknown direction reference', { directionDeg: 90, directionRef: 'X' as 'T' }],
    ['an unknown state', { state: 'lost' as 'located' }],
    ['orientation 9', { orientation: 9 }],
  ])('refuses %s', (_name, patch) => {
    expect(() => photosRepo.upsertPhotoMetadata(db, fileId, { ...UNLOCATED, ...patch })).toThrow(/CHECK constraint failed/);
  });

  it('refuses an unknown file kind', () => {
    expect(() =>
      filesRepo.upsertFile(db, {
        folderId: folder(tripA, '/Volumes/Photos/Other'),
        relativePath: 'x.doc',
        kind: 'document' as 'photo',
        format: 'jpeg',
        sizeBytes: 1,
        mtimeMs: 1,
        fingerprint: null,
      }),
    ).toThrow(/CHECK constraint failed/);
  });

  it('refuses the same real path twice for one trip, and allows it for another', () => {
    expect(() => folder(tripA, '/Volumes/Photos/Peak')).toThrow(/UNIQUE constraint failed/);
    expect(() => folder(tripB, '/Volumes/Photos/Peak')).not.toThrow();
  });

  it('keeps absent values null, not 0', () => {
    photosRepo.upsertPhotoMetadata(db, fileId, located(LEEK, null));
    const stored = photosRepo.findPhoto(db, fileId);
    expect(stored?.altitudeM).toBeNull();
    expect(stored?.accuracyM).toBeNull();
    expect(stored?.directionDeg).toBeNull();
    expect(stored?.takenOffsetMin).toBeNull();
  });

  it('keeps a fractional modified time exactly', () => {
    expect(filesRepo.findFile(db, fileId)?.mtimeMs).toBe(1);
    const updated = filesRepo.upsertFile(db, { ...filesRepo.findFile(db, fileId)!, mtimeMs: 1_781_000_000_123.456 });
    expect(updated.mtimeMs).toBe(1_781_000_000_123.456);
  });
});

describe('the file index', () => {
  it('upserts by path, keeping the row id', () => {
    const f = folder(tripA, '/p');
    const first = filesRepo.upsertFile(db, { folderId: f, relativePath: 'a.jpg', kind: 'photo', format: 'jpeg', sizeBytes: 1, mtimeMs: 1, fingerprint: null });
    const second = filesRepo.upsertFile(db, { folderId: f, relativePath: 'a.jpg', kind: 'photo', format: 'jpeg', sizeBytes: 2, mtimeMs: 2, fingerprint: 'x' });
    expect(second.id).toBe(first.id);
    expect(second.sizeBytes).toBe(2);
    expect(filesRepo.indexOf(db, f).size).toBe(1);
  });

  it('deletes only the paths not kept, with their metadata', () => {
    const f = folder(tripA, '/p');
    const kept = photo(f, 'kept.jpg', located(BUXTON, '2026-06-14T10:00:00'));
    const gone = Array.from({ length: 1200 }, (_, i) => photo(f, `gone/${i}.jpg`, UNLOCATED));
    expect(filesRepo.deleteMissing(db, f, new Set(['kept.jpg']))).toBe(1200);
    expect([...filesRepo.indexOf(db, f).keys()]).toEqual(['kept.jpg']);
    expect(photosRepo.findPhoto(db, kept)?.state).toBe('located');
    expect(photosRepo.findPhoto(db, gone[0] ?? '')).toBeNull();
  });

  it('moves a path, keeping the id and the metadata', () => {
    const f = folder(tripA, '/p');
    const id = photo(f, 'Day 1/IMG_1.heic', located(BUXTON, '2026-06-14T10:00:00'));
    expect(filesRepo.movePath(db, id, 'Best/IMG_1.heic', 3_000_000, 5)).toBe(true);
    const moved = photosRepo.findPhoto(db, id);
    expect(moved?.relativePath).toBe('Best/IMG_1.heic');
    expect(moved?.lat).toBe(BUXTON.lat);
  });

  it('finds a fingerprint across a trip’s folders', () => {
    const one = folder(tripA, '/one');
    const two = folder(tripA, '/two');
    const id = photo(two, 'moved.jpg', UNLOCATED);
    expect(filesRepo.findByFingerprint(db, [one, two], 'fp-moved.jpg').map((f) => f.id)).toEqual([id]);
    expect(filesRepo.findByFingerprint(db, [one], 'fp-moved.jpg')).toEqual([]);
  });

  it('counts by kind and by state', () => {
    const f = folder(tripA, '/p');
    photo(f, 'a.jpg', located(BUXTON, null));
    photo(f, 'b.jpg', UNLOCATED);
    photo(f, 'c.jpg', { ...UNLOCATED, state: 'unreadable', reason: 'Not a JPEG image' });
    filesRepo.upsertFile(db, { folderId: f, relativePath: 'day.gpx', kind: 'geodata', format: 'gpx', sizeBytes: 1, mtimeMs: 1, fingerprint: null });
    filesRepo.upsertFile(db, { folderId: f, relativePath: 'clip.mov', kind: 'video', format: 'mov', sizeBytes: 1, mtimeMs: 1, fingerprint: null });
    expect(filesRepo.countsByKind(db, f)).toEqual({ photo: 3, geodata: 1, video: 1 });
    expect(photosRepo.countsByState(db, f)).toEqual({ located: 1, unlocated: 1, unreadable: 1, 'not-downloaded': 0 });
  });
});

describe('photos', () => {
  it('lists in taken-time order, with no taken time last by path', () => {
    const f = folder(tripA, '/p');
    photo(f, 'z-undated.jpg', UNLOCATED);
    photo(f, 'late.jpg', located(BUXTON, '2026-06-14T18:00:00'));
    photo(f, 'a-undated.jpg', UNLOCATED);
    photo(f, 'early.jpg', located(LEEK, '2026-06-14T08:00:00'));
    expect(photosRepo.listPhotos(db, f).map((p) => p.relativePath)).toEqual(['early.jpg', 'late.jpg', 'a-undated.jpg', 'z-undated.jpg']);
  });

  it('lists photos only, not the GPX and video in the index', () => {
    const f = folder(tripA, '/p');
    photo(f, 'a.jpg', UNLOCATED);
    filesRepo.upsertFile(db, { folderId: f, relativePath: 'day.gpx', kind: 'geodata', format: 'gpx', sizeBytes: 1, mtimeMs: 1, fingerprint: null });
    expect(photosRepo.listPhotos(db, f)).toHaveLength(1);
  });

  it('deleting the trip removes its folders, index and metadata', () => {
    const f = folder(tripA, '/p');
    const id = photo(f, 'a.jpg', located(BUXTON, null));
    tripRepo.deleteTrip(db, tripA);
    expect(foldersRepo.findLinkedFolder(db, f)).toBeNull();
    expect(filesRepo.findFile(db, id)).toBeNull();
    expect(db.select().from(schema.photoMetadata).all()).toEqual([]);
  });

  it('deleting a linked folder removes its index and metadata, and nothing of the trip', () => {
    const f = folder(tripA, '/p');
    photo(f, 'a.jpg', located(BUXTON, null));
    foldersRepo.deleteLinkedFolder(db, f);
    expect(db.select().from(schema.folderFiles).all()).toEqual([]);
    expect(db.select().from(schema.photoMetadata).all()).toEqual([]);
    expect(tripRepo.findTrip(db, tripA)).not.toBeNull();
  });
});

describe('map points', () => {
  it('gives one trip’s located photos, column by column, with null for no direction', () => {
    const f = folder(tripA, '/p');
    const a = photo(f, 'a.jpg', located(BUXTON, null, { directionDeg: 271.25, directionRef: 'T' }));
    const b = photo(f, 'b.jpg', located(LEEK, null));
    photo(f, 'c.jpg', UNLOCATED);
    photo(folder(tripB, '/q'), 'd.jpg', located(ASHBOURNE, null));

    const points = photosRepo.mapPoints(db, { tripId: tripA });
    expect(points.ids).toEqual([a, b].toSorted());
    const at = (id: string) => points.ids.indexOf(id);
    expect(points.lat[at(a)]).toBe(BUXTON.lat);
    expect(points.lon[at(b)]).toBe(LEEK.lon);
    expect(points.dir[at(a)]).toBe(271.25);
    expect(points.dir[at(b)]).toBeNull();
    expect(points.folders).toEqual([f]);
    expect([...points.folder]).toEqual([0, 0]);
  });

  it('shows a folder linked to two trips once in all-trips mode', () => {
    const inA = folder(tripA, '/Volumes/Photos/2026');
    const inB = folder(tripB, '/Volumes/Photos/2026');
    const first = photo(inA, 'buxton.jpg', located(BUXTON, '2026-06-14T10:00:00'));
    photo(inB, 'buxton.jpg', located(BUXTON, '2026-06-14T10:00:00'));
    photo(inB, 'leek.jpg', located(LEEK, '2026-06-15T10:00:00'));

    const all = photosRepo.mapPoints(db, { all: true, includeArchived: false });
    expect(all.ids).toHaveLength(2);
    expect(all.ids).toContain(first); // the earliest-linked copy
    // Each trip still shows its own copy.
    expect(photosRepo.mapPoints(db, { tripId: tripB }).ids).toHaveLength(2);
  });

  it('filters all trips by year, by no date, and by trip', () => {
    const f = folder(tripA, '/a');
    const g = folder(tripB, '/b');
    const y2025 = photo(f, '2025.jpg', located(BUXTON, '2025-08-01T10:00:00'));
    const y2026 = photo(g, '2026.jpg', located(LEEK, '2026-06-14T10:00:00'));
    const undated = photo(g, 'undated.jpg', located(ASHBOURNE, null));

    expect(photosRepo.mapPoints(db, { all: true, includeArchived: false, year: 2025 }).ids).toEqual([y2025]);
    expect(photosRepo.mapPoints(db, { all: true, includeArchived: false, year: 'none' }).ids).toEqual([undated]);
    expect(photosRepo.mapPoints(db, { all: true, includeArchived: false, tripId: tripB }).ids.toSorted()).toEqual(
      [y2026, undated].toSorted(),
    );
  });

  it('leaves archived trips out unless asked', () => {
    photo(folder(tripA, '/a'), 'a.jpg', located(BUXTON, null));
    tripRepo.updateTrip(db, tripA, { status: 'archived' }, tick());
    expect(photosRepo.mapPoints(db, { all: true, includeArchived: false }).ids).toEqual([]);
    expect(photosRepo.mapPoints(db, { all: true, includeArchived: true }).ids).toHaveLength(1);
  });

  it('counts photos by year, once per photo, with the undated apart', () => {
    const shared = '/Volumes/Photos/2026';
    for (const t of [tripA, tripB]) {
      const f = folder(t, shared);
      photo(f, 'a.jpg', located(BUXTON, '2026-06-14T10:00:00'));
      photo(f, 'b.jpg', UNLOCATED);
    }
    photo(folder(tripA, '/old'), 'c.jpg', located(LEEK, '2024-05-01T09:00:00'));
    expect(photosRepo.photoYears(db, false)).toEqual({
      years: [
        { year: 2026, count: 1 },
        { year: 2024, count: 1 },
      ],
      noDate: 1,
    });
  });
});

describe('waypoints made from photos', () => {
  it('accept the photo source, in the app and in a collection file', () => {
    expect(isWaypointSource('photo')).toBe(true);
    expect(collectionWaypointSchema.shape.source.safeParse('photo').success).toBe(true);
  });
});
