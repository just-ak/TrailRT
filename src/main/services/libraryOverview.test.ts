import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { LatLon } from '@shared/geo/distance';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { upsertPhotoMetadata } from '../db/repositories/photoMetadata';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as libraryService from './libraryService';
import * as photoService from './photoService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as waypointService from './waypointService';

/** Phase 14 task 3: the trip overview and a trip's photos (design §3.2). */

let dir: string;
let handle: DbHandle;
let db: Db;

const ok = <T>(m: Mutation<T>): T => m.result;
const trip = (name: string): string => ok(tripService.create(db, { name, folderId: null, description: null, notes: null })).id;
const vertex = (at: LatLon) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });

function place(tripId: string, name: string, at: LatLon): string {
  return ok(
    waypointService.create(db, { tripId, name, lat: at.lat, lon: at.lon, eleM: null, description: null, symbol: 'pin', notes: null, groupId: null }),
  ).id;
}

function road(tripId: string, from: LatLon, to: LatLon, name: string): string {
  return ok(routeService.create(db, { tripId, name, colour: null, points: [vertex(from), vertex(to)] })).id;
}

let n = 0;
function photo(folderId: string, takenLocal: string | null): string {
  n += 1;
  const id = filesRepo.upsertFile(db, {
    folderId,
    relativePath: `IMG_${n}.jpg`,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: n,
    mtimeMs: n,
    fingerprint: null,
  }).id;
  upsertPhotoMetadata(db, id, {
    state: 'unlocated',
    reason: null,
    lat: null,
    lon: null,
    altitudeM: null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal,
    takenOffsetMin: takenLocal === null ? null : 0,
    orientation: null,
  });
  return id;
}

function folder(tripId: string, name: string) {
  const path = `/Volumes/Photos/${name}`;
  return foldersRepo.insertLinkedFolder(db, { tripId, path, realPath: path, name, includeSubfolders: true, now: 1 });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p14-overview-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the trip overview', () => {
  it('gives a timed trip its dates, days and planned length', () => {
    const id = trip('Peak weekend');
    ok(itineraryService.create(db, { tripId: id, startDate: '2026-11-13', startTime: '09:00' }));
    const buxton = place(id, 'Buxton', BUXTON);
    const leek = place(id, 'Leek', LEEK);
    const ashbourne = place(id, 'Ashbourne', ASHBOURNE);
    ok(itineraryService.addStop(db, { tripId: id, waypointId: buxton }));
    const b = ok(itineraryService.addStop(db, { tripId: id, waypointId: leek, durationKind: 'days', durationDays: 1 })).id;
    const c = ok(itineraryService.addStop(db, { tripId: id, waypointId: ashbourne })).id;
    ok(itineraryService.linkLeg(db, { id: b, routeId: road(id, BUXTON, LEEK, 'Buxton → Leek') }));
    ok(itineraryService.linkLeg(db, { id: c, routeId: road(id, LEEK, ASHBOURNE, 'Leek → Ashbourne') }));

    const [row] = libraryService.overview(db, { includeArchived: false });
    expect(row).toMatchObject({ name: 'Peak weekend', startDate: '2026-11-13', endDate: '2026-11-14', days: 2 });
    expect(row?.distanceM).toBeGreaterThan(20_000);
    expect(row?.driveSeconds).toBeGreaterThan(0);
    expect(row).toMatchObject({ startPlace: 'Buxton', startTime: '09:00' });
    expect(row?.counts).toEqual({ routes: 2, tracks: 0, waypoints: 3, photos: 0, linkedFolders: 0 });
  });

  it('leaves the end and the length missing when a drive is not timed, never zero', () => {
    const id = trip('Half planned');
    ok(itineraryService.create(db, { tripId: id, startDate: '2026-11-18', startTime: '09:00' }));
    ok(itineraryService.addStop(db, { tripId: id, waypointId: place(id, 'Buxton', BUXTON) }));
    ok(itineraryService.addStop(db, { tripId: id, waypointId: place(id, 'Leek', LEEK) }));
    const [row] = libraryService.overview(db, { includeArchived: false });
    expect(row).toMatchObject({ startDate: '2026-11-18', endDate: null, days: null, distanceM: null, driveSeconds: null });
  });

  it('has no dates for a trip with no itinerary, and counts what is in it', () => {
    const id = trip('Ideas');
    place(id, 'Monsal Head', BUXTON);
    const f = folder(id, 'Hope Valley');
    photo(f.id, '2026-05-01T10:00:00');
    photo(f.id, null);
    const [row] = libraryService.overview(db, { includeArchived: false });
    expect(row).toMatchObject({ startDate: null, endDate: null, days: null, distanceM: null, driveSeconds: null, startPlace: null, startTime: null });
    expect(row?.counts).toEqual({ routes: 0, tracks: 0, waypoints: 1, photos: 2, linkedFolders: 1 });
  });

  it('leaves archived trips out unless asked', () => {
    const id = trip('Old');
    trip('Current');
    ok(tripService.setStatus(db, { id, status: 'archived' }));
    expect(libraryService.overview(db, { includeArchived: false }).map((t) => t.name)).toEqual(['Current']);
    expect(libraryService.overview(db, { includeArchived: true }).map((t) => [t.name, t.status])).toEqual([
      ['Current', 'active'],
      ['Old', 'archived'],
    ]);
  });
});

describe('a trip’s photos', () => {
  it('lists every linked folder’s photos in taken order, undated last, and nothing from other trips', () => {
    const id = trip('Peak');
    const other = trip('Skye');
    const a = folder(id, 'Day 1');
    const b = folder(id, 'Day 2');
    const late = photo(b.id, '2026-11-14T12:00:00');
    const early = photo(a.id, '2026-11-13T09:00:00');
    const undated = photo(a.id, null);
    photo(folder(other, 'Skye').id, '2026-11-13T08:00:00');
    expect(photoService.listForTrip(db, id).map((p) => p.id)).toEqual([early, late, undated]);
    expect(photoService.listForTrip(db, trip('Empty'))).toEqual([]);
  });
});
