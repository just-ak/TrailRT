import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import type { LatLon } from '@shared/geo/distance';
import { NO_LOCATION_TEXT } from '@shared/photos/photoWaypoint';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { upsertPhotoMetadata } from '../db/repositories/photoMetadata';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as photoWaypointService from './photoWaypointService';
import * as tripService from './tripService';
import * as undoService from './undoService';
import * as waypointService from './waypointService';

/** Phase 14 task 19: a photo used as a waypoint, or as a stop (Requirement 18.3–18.5). */

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;
let folderId: string;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };

function commit<T>(mutation: Mutation<T>): T {
  undoService.record(mutation.inverse);
  return mutation.result;
}

function photo(
  relativePath: string,
  at: LatLon | null,
  extra: { altitudeM?: number | null; takenLocal?: string | null; folder?: string } = {},
): string {
  const id = filesRepo.upsertFile(db, {
    folderId: extra.folder ?? folderId,
    relativePath,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: 1,
    mtimeMs: 1,
    fingerprint: null,
  }).id;
  upsertPhotoMetadata(db, id, {
    state: at === null ? 'unlocated' : 'located',
    reason: at === null ? 'No GPS in the file' : null,
    lat: at?.lat ?? null,
    lon: at?.lon ?? null,
    altitudeM: extra.altitudeM ?? null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal: extra.takenLocal ?? null,
    takenOffsetMin: null,
    orientation: null,
  });
  return id;
}

function linkFolder(trip: string, name: string): string {
  return foldersRepo.insertLinkedFolder(db, {
    tripId: trip,
    path: `/Volumes/Photos/${name}`,
    realPath: `/Volumes/Photos/${name}`,
    name,
    includeSubfolders: true,
    now: 1,
  }).id;
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

const plan = () => itineraryService.get(db, tripId, SETTINGS)?.stops.map((s) => s.place?.name ?? s.kind) ?? [];

/** Buxton on 1 July; a day break; Leek and Ashbourne on 2 July. */
function twoDays(): void {
  commit(itineraryService.create(db, { tripId, startDate: '2026-07-01', startTime: '09:00' }));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Buxton', BUXTON) }));
  commit(itineraryService.addDay(db, { tripId }, SETTINGS));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Leek', LEEK) }));
  commit(itineraryService.addStop(db, { tripId, waypointId: place('Ashbourne', ASHBOURNE) }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p14-photo-waypoint-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, { name: 'Peak', folderId: null, description: null, notes: null }).result.id;
  folderId = linkFolder(tripId, 'Peak 2026');
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a photo as a waypoint', () => {
  it('is at the photo’s place in its own trip, named from the file, with the photo symbol and source', () => {
    const id = photo('Day 1/IMG_0412.HEIC', MACCLESFIELD, { altitudeM: 160, takenLocal: '2026-07-01T14:02:10' });
    const waypoint = commit(photoWaypointService.fromPhoto(db, { photoId: id }));
    expect(waypoint).toMatchObject({
      tripId,
      name: 'IMG_0412',
      lat: MACCLESFIELD.lat,
      lon: MACCLESFIELD.lon,
      eleM: 160,
      symbol: 'photo',
      source: 'photo',
      description: 'From the photo Day 1/IMG_0412.HEIC, taken 2026-07-01 at 14:02',
    });
  });

  it('has no elevation when the photo recorded no altitude', () => {
    const id = photo('IMG_0413.JPG', BUXTON);
    expect(commit(photoWaypointService.fromPhoto(db, { photoId: id })).eleM).toBeNull();
  });

  it('refuses a photo with no location, saying why', () => {
    const id = photo('IMG_0414.JPG', null);
    expect(() => photoWaypointService.fromPhoto(db, { photoId: id })).toThrow(ServiceError);
    expect(() => photoWaypointService.fromPhoto(db, { photoId: id })).toThrow(NO_LOCATION_TEXT);
    expect(waypointService.listForTrip(db, tripId)).toHaveLength(0);
  });

  it('goes in the trip it is asked for, and outside any trip for a folder linked outside one', () => {
    const other = tripService.create(db, { name: 'Other', folderId: null, description: null, notes: null }).result.id;
    const id = photo('IMG_0415.JPG', LEEK);
    expect(commit(photoWaypointService.fromPhoto(db, { photoId: id, tripId: other })).tripId).toBe(other);

    const loose = tripService.looseTripId(db);
    const outside = photo('IMG_0416.JPG', ASHBOURNE, { folder: linkFolder(loose, 'Loose') });
    expect(commit(photoWaypointService.fromPhoto(db, { photoId: outside })).tripId).toBe(loose);
  });

  it('gives back the waypoint it made when the photo is used again, with nothing to undo', () => {
    const id = photo('IMG_0417.JPG', BUXTON);
    const first = commit(photoWaypointService.fromPhoto(db, { photoId: id }));
    const again = photoWaypointService.fromPhoto(db, { photoId: id });
    expect(again.result.id).toBe(first.id);
    expect(again.inverse.kind).toBe('none');
    expect(waypointService.listForTrip(db, tripId)).toHaveLength(1);
  });
});

describe('a photo as a stop', () => {
  it('goes on the day it was taken, after that day’s last entry', () => {
    twoDays();
    const id = photo('IMG_0420.JPG', MACCLESFIELD, { takenLocal: '2026-07-01T16:30:00' });
    commit(photoWaypointService.addPhotoStop(db, { tripId, photoId: id }, SETTINGS));
    expect(plan()).toEqual(['Buxton', 'IMG_0420', 'day', 'Leek', 'Ashbourne']);
  });

  it('goes at the end for a day the plan does not have, or a photo with no date', () => {
    twoDays();
    commit(photoWaypointService.addPhotoStop(db, { tripId, photoId: photo('Later.JPG', BUXTON, { takenLocal: '2026-07-09T10:00:00' }) }, SETTINGS));
    commit(photoWaypointService.addPhotoStop(db, { tripId, photoId: photo('Undated.JPG', LEEK) }, SETTINGS));
    expect(plan()).toEqual(['Buxton', 'day', 'Leek', 'Ashbourne', 'Later', 'Undated']);
  });

  it('makes the waypoint and the stop in one undo step, and reuses a waypoint the photo made', () => {
    twoDays();
    const id = photo('IMG_0421.JPG', MACCLESFIELD, { takenLocal: '2026-07-02T12:00:00' });
    commit(photoWaypointService.addPhotoStop(db, { tripId, photoId: id }, SETTINGS));
    expect(plan()).toEqual(['Buxton', 'day', 'Leek', 'Ashbourne', 'IMG_0421']);
    undoService.undo(db);
    expect(plan()).toEqual(['Buxton', 'day', 'Leek', 'Ashbourne']);
    expect(waypointService.listForTrip(db, tripId).map((w) => w.name)).not.toContain('IMG_0421');

    const made = commit(photoWaypointService.fromPhoto(db, { photoId: id }));
    const out = commit(photoWaypointService.addPhotoStop(db, { tripId, photoId: id, index: 0 }, SETTINGS));
    expect(out.waypoint.id).toBe(made.id);
    expect(plan()[0]).toBe('IMG_0421');
    expect(waypointService.listForTrip(db, tripId).filter((w) => w.name === 'IMG_0421')).toHaveLength(1);
  });
});
