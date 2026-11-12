import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinkedFolder, PhotoState } from '@shared/domain/linkedFolders';
import type { TreeNode } from '@shared/domain/types';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { photoDays, upsertPhotoMetadata } from '../db/repositories/photoMetadata';
import * as tripRepo from '../db/repositories/trips';
import * as libraryService from './libraryService';

/**
 * Phase 11 task 9: linked folders in the library tree and the Photos view
 * (design §8.1 and §8.2), and the per-day counts behind a dated trip's days
 * (§8.4).
 */

let root: string;
let handle: DbHandle;
let db: Db;
let peak: string;
let skye: string;

function folder(tripId: string, name: string, createdAt = 1): LinkedFolder {
  const path = `/Volumes/Photos/${name}`;
  return foldersRepo.insertLinkedFolder(db, { tripId, path, realPath: path, name, includeSubfolders: true, now: createdAt });
}

let n = 0;
function photo(f: LinkedFolder, state: PhotoState, takenLocal: string | null, takenOffsetMin: number | null = 60): string {
  n += 1;
  const id = filesRepo.upsertFile(db, {
    folderId: f.id,
    relativePath: `IMG_${n}.jpg`,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: n,
    mtimeMs: n,
    fingerprint: null,
  }).id;
  const located = state === 'located';
  upsertPhotoMetadata(db, id, {
    state,
    reason: located ? null : 'test',
    lat: located ? 53.259 : null,
    lon: located ? -1.911 : null,
    altitudeM: null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal,
    takenOffsetMin,
    orientation: null,
  });
  return id;
}

function view(tree: TreeNode, id: string): TreeNode {
  const found = tree.children.find((c) => c.viewId === id);
  if (found === undefined) throw new Error(`no view ${id}`);
  return found;
}

function tripRow(tree: TreeNode, tripId: string): TreeNode {
  const found = view(tree, 'trips').children.find((c) => c.ref?.id === tripId);
  if (found === undefined) throw new Error(`no trip ${tripId}`);
  return found;
}

function photosView(photos: libraryService.PhotoViewFilter): string[] {
  return view(libraryService.tree(db, { includeArchived: false, photos }), 'photos').children.map((r) => r.name);
}

const byYear = (year: number | 'none'): string[] => photosView({ year });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-library-'));
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  peak = tripRepo.insertTrip(db, { id: 'peak', folderId: null, name: 'Peak District', description: null, notes: null, now: 1 }).id;
  skye = tripRepo.insertTrip(db, { id: 'skye', folderId: null, name: 'Isle of Skye', description: null, notes: null, now: 1 }).id;
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('the library tree with linked folders', () => {
  it('adds nothing to a trip with no linked folder, and the Photos view is empty with a hint', () => {
    const tree = libraryService.tree(db, { includeArchived: false });
    expect(tripRow(tree, peak).children).toEqual([]);
    const photos = view(tree, 'photos');
    expect(photos.children).toEqual([]);
    expect(photos.available).toBe(true);
    expect(photos.hint).toMatch(/Link a folder/);
  });

  it('gives a trip a Linked folders group, after its contents, with one selectable row per folder', () => {
    const f = folder(peak, 'Peak 2026');
    photo(f, 'located', '2026-05-01T10:00:00');
    photo(f, 'unlocated', '2026-05-01T11:00:00');
    const tree = libraryService.tree(db, { includeArchived: false, folderState: () => 'available' });
    const group = tripRow(tree, peak).children.at(-1);
    expect(group).toMatchObject({ kind: 'group', name: 'Linked folders', detail: '1' });
    expect(group?.children).toHaveLength(1);
    expect(group?.children[0]).toMatchObject({
      kind: 'linkedFolder',
      ref: { kind: 'linkedFolder', id: f.id },
      name: 'Peak 2026',
      detail: '2 photos · 1 without location',
    });
  });

  it('says on the row when a folder is unavailable', () => {
    const f = folder(peak, 'Peak 2026');
    photo(f, 'located', '2026-05-01T10:00:00');
    const tree = libraryService.tree(db, { includeArchived: false, folderState: () => 'missing' });
    expect(tripRow(tree, peak).children.at(-1)?.children[0]?.detail).toBe('1 photo · unavailable');
  });
});

describe('the Photos view', () => {
  let peakFolder: LinkedFolder;
  let skyeFolder: LinkedFolder;

  beforeEach(() => {
    peakFolder = folder(peak, 'Peak 2026');
    photo(peakFolder, 'located', '2026-05-01T10:00:00');
    skyeFolder = folder(skye, 'Skye 2019');
    photo(skyeFolder, 'located', '2019-08-12T09:00:00');
    photo(skyeFolder, 'unreadable', null, null);
  });

  it('lists every linked folder across the visible trips, annotated with its trip', () => {
    const rows = view(libraryService.tree(db, { includeArchived: false }), 'photos').children;
    expect(rows.map((r) => [r.name, r.detail])).toEqual([
      ['Skye 2019', 'Isle of Skye · 2 photos · 1 without location'],
      ['Peak 2026', 'Peak District · 1 photo'],
    ]);
    expect(rows.every((r) => r.ref?.kind === 'linkedFolder')).toBe(true);
  });

  it('leaves out an archived trip’s folders unless archived trips are shown', () => {
    tripRepo.updateTrip(db, skye, { status: 'archived' }, 2);
    expect(view(libraryService.tree(db, { includeArchived: false }), 'photos').children.map((r) => r.name)).toEqual([
      'Peak 2026',
    ]);
    expect(view(libraryService.tree(db, { includeArchived: true }), 'photos').children).toHaveLength(2);
  });

  it('filters by the year a photo was taken, and by "No date"', () => {
    expect(byYear(2026)).toEqual(['Peak 2026']);
    expect(byYear(2019)).toEqual(['Skye 2019']);
    expect(byYear('none')).toEqual(['Skye 2019']);
    expect(byYear(2001)).toEqual([]);
  });

  it('filters by trip, and both filters together', () => {
    expect(photosView({ tripId: peak })).toEqual(['Peak 2026']);
    expect(photosView({ tripId: peak, year: 2019 })).toEqual([]);
    expect(photosView({ tripId: skye, year: 2019 })).toEqual(['Skye 2019']);
  });

  it('never filters a trip’s own Linked folders group', () => {
    const tree = libraryService.tree(db, { includeArchived: false, photos: { year: 2001 } });
    expect(tripRow(tree, peak).children.at(-1)?.children).toHaveLength(1);
  });
});

describe('photos per day', () => {
  it('counts by the date of the wall clock where each photo was taken, and flags camera time', () => {
    const f = folder(peak, 'Peak 2026');
    // 23:30 local on the 1st, ten hours ahead of UTC: still the 1st where it was taken.
    photo(f, 'located', '2026-05-01T23:30:00', 600);
    photo(f, 'unlocated', '2026-05-01T08:00:00', 60);
    // No zone recorded: placed by the camera's clock.
    photo(f, 'located', '2026-05-02T00:15:00', null);
    photo(f, 'located', null, null);
    const other = folder(skye, 'Skye');
    photo(other, 'located', '2026-05-01T12:00:00');

    const days = photoDays(db, [peak]);
    expect([...(days.get(peak) ?? new Map()).entries()].toSorted()).toEqual([
      ['2026-05-01', { count: 2, cameraTime: 0 }],
      ['2026-05-02', { count: 1, cameraTime: 1 }],
    ]);
    expect(days.has(skye)).toBe(false);
    expect(photoDays(db, []).size).toBe(0);
  });
});
