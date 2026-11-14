import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinkedFolder } from '@shared/domain/linkedFolders';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { upsertPhotoMetadata } from '../db/repositories/photoMetadata';
import * as tripRepo from '../db/repositories/trips';
import { ServiceError } from './errors';
import * as photoService from './photoService';

let root: string;
let handle: DbHandle;
let db: Db;
let folder: LinkedFolder;

const VALID = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f';

function file(relativePath: string, kind: 'photo' | 'geodata' | 'video'): string {
  const format = kind === 'photo' ? 'jpeg' : kind === 'geodata' ? 'gpx' : 'mov';
  return filesRepo.upsertFile(db, { folderId: folder.id, relativePath, kind, format, sizeBytes: 1, mtimeMs: 1, fingerprint: null }).id;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-photos-'));
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  const tripId = tripRepo.insertTrip(db, { id: 'trip', folderId: null, name: 'Peak', description: null, notes: null, now: 1 }).id;
  folder = foldersRepo.insertLinkedFolder(db, {
    tripId,
    path: '/Volumes/Photos/Peak 2026',
    realPath: '/Volumes/Photos/Peak 2026',
    name: 'Peak 2026',
    includeSubfolders: true,
    now: 1,
  });
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('photoService', () => {
  it('summarises a folder: files by kind, photos by state, and the scanner’s runtime state', () => {
    const photo = file('a.jpg', 'photo');
    upsertPhotoMetadata(db, photo, {
      state: 'located', reason: null, lat: 53.259, lon: -1.911, altitudeM: null, accuracyM: null,
      directionDeg: null, directionRef: null, takenLocal: null, takenOffsetMin: null, orientation: null,
    });
    file('tracks/day-1.gpx', 'geodata');
    file('clip.mov', 'video');

    const [summary] = photoService.folderSummaries(db, folder.tripId, () => ({
      state: 'scanning',
      progress: { folderId: folder.id, phase: 'reading', seen: 3, read: 1 },
      lastOutcome: null,
    }));
    expect(summary).toMatchObject({
      id: folder.id,
      name: 'Peak 2026',
      displayPath: '/Volumes/Photos/Peak 2026',
      files: { photo: 1, geodata: 1, video: 1 },
      photos: { located: 1, unlocated: 0, unreadable: 0, 'not-downloaded': 0 },
      state: 'scanning',
    });
    // A path for display only: the summary carries no field the renderer could send back as one.
    expect(Object.keys(summary ?? {})).not.toContain('path');
  });

  it('reports no runtime state before the scanner has started', () => {
    const [summary] = photoService.folderSummaries(db, undefined, () => null);
    expect(summary?.state).toBeNull();
    expect(summary?.progress).toBeNull();
  });

  it('refuses to list the photos of a folder that is not linked', () => {
    expect(() => photoService.listPhotos(db, VALID)).toThrow(ServiceError);
  });

  it('gives one photo with its folder name and trip', () => {
    const photo = file('a.jpg', 'photo');
    upsertPhotoMetadata(db, photo, {
      state: 'unlocated', reason: 'No location recorded in this photo', lat: null, lon: null, altitudeM: null,
      accuracyM: null, directionDeg: null, directionRef: null, takenLocal: '2026-05-01T10:00:00', takenOffsetMin: 60,
      orientation: 1,
    });
    const details = photoService.details(db, photo);
    expect(details).toMatchObject({ folderName: 'Peak 2026', tripId: folder.tripId });
    expect(details.photo.state).toBe('unlocated');
    expect(() => photoService.details(db, VALID)).toThrow(ServiceError);
  });
});
