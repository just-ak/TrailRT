import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedFolder, PhotoState } from '@shared/domain/linkedFolders';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { upsertPhotoMetadata } from '../db/repositories/photoMetadata';
import * as tripRepo from '../db/repositories/trips';
import { resolveFilePath } from '../linkedFolders/resolve';
import { ServiceError } from '../services/errors';
import { jpegSize, THUMBNAIL_PX, THUMBNAIL_REFUSAL, ThumbnailCache, thumbnailName, type MakeThumbnail } from './thumbnails';

const PHOTO = join(process.cwd(), 'test-data', 'generated', 'photos', 'buxton.jpg');
const describeIf = existsSync(PHOTO) ? describe : describe.skip;

let root: string;
let cacheRoot: string;
let handle: DbHandle;
let db: Db;
let folder: LinkedFolder;
let thumbnailBytes: Uint8Array;
let made: string[];
let clock: number;

/** Stands in for Quick Look: returns a real JPEG and records what it was asked for. */
const make: MakeThumbnail = (path, px) => {
  expect(px).toBe(THUMBNAIL_PX);
  made.push(path);
  return Promise.resolve(thumbnailBytes);
};

function cache(options: { boundBytes?: number; make?: MakeThumbnail; dataless?: Set<string> } = {}): ThumbnailCache {
  return new ThumbnailCache({
    root: cacheRoot,
    make: options.make ?? make,
    now: () => clock,
    datalessCheck: (paths) => Promise.resolve(new Set(paths.filter((p) => options.dataless?.has(p)))),
    ...(options.boundBytes === undefined ? {} : { boundBytes: options.boundBytes }),
  });
}

/** A photo in the linked folder, indexed as the scanner would index it. */
function photo(name: string, state: PhotoState = 'located'): string {
  const path = join(folder.path, name);
  if (!existsSync(path)) copyFileSync(PHOTO, path);
  const info = statSync(path);
  const id = filesRepo.upsertFile(db, {
    folderId: folder.id,
    relativePath: name,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs,
    fingerprint: null,
  }).id;
  upsertPhotoMetadata(db, id, {
    state,
    reason: state === 'located' ? null : 'test',
    lat: state === 'located' ? 53.259 : null,
    lon: state === 'located' ? -1.911 : null,
    altitudeM: null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal: null,
    takenOffsetMin: null,
    orientation: null,
  });
  return id;
}

const resolve = (id: string) => resolveFilePath(db, id);
/** The guard's answer while the drive is unplugged. */
const unplugged = () => Promise.reject(new ServiceError('BLOCKED', 'Peak 2026 is not available.'));

function cached(): string[] {
  const dir = join(cacheRoot, folder.id);
  return existsSync(dir) ? readdirSync(dir).toSorted() : [];
}

async function refusal(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ServiceError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-thumbs-'));
  cacheRoot = join(root, 'userData', 'photo-thumbnails');
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  const tripId = tripRepo.insertTrip(db, { id: 'trip', folderId: null, name: 'Peak', description: null, notes: null, now: 1 }).id;
  const path = join(root, 'Peak 2026');
  mkdirSync(path);
  folder = foldersRepo.insertLinkedFolder(db, { tripId, path, realPath: path, name: 'Peak 2026', includeSubfolders: true, now: 1 });
  thumbnailBytes = new Uint8Array(readFileSync(PHOTO));
  made = [];
  clock = 1_700_000_000_000;
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('jpegSize', () => {
  it('reads the frame size of a real JPEG', () => {
    expect(jpegSize(new Uint8Array(readFileSync(PHOTO)))).toEqual({ width: 1200, height: 800 });
  });

  it('answers null for anything that is not a JPEG with a frame', () => {
    expect(jpegSize(new Uint8Array([]))).toBeNull();
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(jpegSize(new Uint8Array(readFileSync(PHOTO)).slice(0, 200))).toBeNull();
  });
});

describeIf('ThumbnailCache', () => {
  it('makes a thumbnail once, then serves it from the cache', async () => {
    const id = photo('a.jpg');
    const c = cache();
    const first = await c.get(db, id, resolve);
    const second = await c.get(db, id, resolve);
    expect(made).toHaveLength(1);
    expect(made[0]?.endsWith(join('Peak 2026', 'a.jpg'))).toBe(true);
    expect(first).toMatchObject({ width: 1200, height: 800 });
    expect(second.bytes).toEqual(first.bytes);
    const info = statSync(join(folder.path, 'a.jpg'));
    expect(cached()).toEqual([thumbnailName(id, info.size, info.mtimeMs)]);
  });

  it('gives a changed photo a new thumbnail and removes the old one', async () => {
    const id = photo('a.jpg');
    const c = cache();
    await c.get(db, id, resolve);
    const before = cached();
    utimesSync(join(folder.path, 'a.jpg'), new Date(2030, 0, 1), new Date(2030, 0, 1));
    await c.get(db, id, resolve);
    expect(made).toHaveLength(2);
    const after = cached();
    expect(after).toHaveLength(1);
    expect(after).not.toEqual(before);
  });

  it('asks Quick Look once for two requests at the same time', async () => {
    const id = photo('a.jpg');
    const c = cache();
    await Promise.all([c.get(db, id, resolve), c.get(db, id, resolve), c.get(db, id, resolve)]);
    expect(made).toHaveLength(1);
  });

  it('keeps the bound, evicting the least recently served', async () => {
    const one = thumbnailBytes.length;
    const c = cache({ boundBytes: one * 3 + 10 });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => photo(`${n}.jpg`));
    for (const id of ids.slice(0, 3)) {
      clock += 1000;
      // oxlint-disable-next-line no-await-in-loop
      await c.get(db, id, resolve);
    }
    // Serve the first again, so it is the most recently used.
    clock += 1000;
    await c.get(db, ids[0] ?? '', resolve);
    for (const id of ids.slice(3)) {
      clock += 1000;
      // oxlint-disable-next-line no-await-in-loop
      await c.get(db, id, resolve);
      // oxlint-disable-next-line no-await-in-loop
      expect(await c.size()).toBeLessThanOrEqual(one * 3 + 10);
    }
    const kept = cached().map((name) => name.slice(0, 36));
    expect(kept).toContain(ids[5]);
    expect(kept).not.toContain(ids[1]); // served once, long ago
    expect(kept.length).toBeLessThanOrEqual(3);
  });

  it('never makes a thumbnail of a photo iCloud has not downloaded', async () => {
    const id = photo('cloud.jpg', 'not-downloaded');
    const error = await refusal(cache().get(db, id, resolve));
    expect(error.code).toBe('BLOCKED');
    expect(error.message).toBe(THUMBNAIL_REFUSAL.notDownloaded);
    expect(made).toHaveLength(0);
  });

  it('checks the disk, not only the last scan: a photo evicted to iCloud since is refused', async () => {
    const id = photo('evicted.jpg');
    const path = join(folder.path, 'evicted.jpg');
    // A sparse file occupies no blocks, like a dataless one.
    writeFileSync(path, '');
    truncateSync(path, 4096);
    const real = (await resolve(id)).path;
    const error = await refusal(cache({ dataless: new Set([real]) }).get(db, id, resolve));
    expect(error.message).toBe(THUMBNAIL_REFUSAL.notDownloaded);
    expect(made).toHaveLength(0);
  });

  it('reports a photo Quick Look cannot preview, and writes nothing', async () => {
    const id = photo('a.jpg');
    const error = await refusal(cache({ make: () => Promise.resolve(null) }).get(db, id, resolve));
    expect(error.code).toBe('IO_ERROR');
    expect(cached()).toEqual([]);
  });

  it('never builds a path itself: a refusal from the guard is passed on', async () => {
    const id = photo('a.jpg');
    const guard = vi.fn(() => Promise.reject(new ServiceError('BLOCKED', 'outside')));
    const error = await refusal(cache().get(db, id, guard));
    expect(error.message).toBe('outside');
    expect(made).toHaveLength(0);
  });

  it('shows the thumbnail made earlier while the folder is unplugged, without touching the disk', async () => {
    const id = photo('a.jpg');
    const c = cache();
    const made1 = await c.get(db, id, resolve);
    // The drive goes away: the guard refuses, as it would for a missing folder.
    const served = await c.get(db, id, unplugged);
    expect(served.fromCache).toBe(true);
    expect(served.bytes).toEqual(made1.bytes);
    expect(made).toHaveLength(1);
  });

  it('shows the thumbnail made before a photo went back to iCloud, and never asks Quick Look', async () => {
    const id = photo('a.jpg');
    const c = cache();
    await c.get(db, id, resolve);
    photo('a.jpg', 'not-downloaded');
    const served = await c.get(db, id, resolve);
    expect(served.fromCache).toBe(true);
    expect(made).toHaveLength(1);
  });

  it('passes the reason on when there is nothing cached to show', async () => {
    const id = photo('a.jpg');
    const error = await refusal(cache().get(db, id, unplugged));
    expect(error.message).toBe('Peak 2026 is not available.');
  });

  it('removes a folder’s thumbnails when it is unlinked', async () => {
    const id = photo('a.jpg');
    const c = cache();
    await c.get(db, id, resolve);
    await c.removeFolder(folder.id);
    expect(cached()).toEqual([]);
  });

  it('removes the thumbnails of folders no longer linked, and only those', async () => {
    const id = photo('a.jpg');
    const c = cache();
    await c.get(db, id, resolve);
    const orphan = join(cacheRoot, '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f');
    mkdirSync(orphan);
    writeFileSync(join(orphan, 'x.jpg'), 'x');
    expect(await c.removeOrphanFolders(db)).toBe(1);
    expect(existsSync(orphan)).toBe(false);
    expect(cached()).toHaveLength(1);
  });

  it('sweeps thumbnails of files no longer indexed, and half-written files', async () => {
    const keep = photo('a.jpg');
    const gone = photo('b.jpg');
    const c = cache();
    await c.get(db, keep, resolve);
    await c.get(db, gone, resolve);
    writeFileSync(join(cacheRoot, folder.id, '.half.tmp'), 'x');
    filesRepo.deleteFile(db, gone);
    await c.sweep(db);
    expect(cached().map((n) => n.slice(0, 36))).toEqual([keep]);
  });
});
