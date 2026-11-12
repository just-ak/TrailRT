import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedFolder } from '@shared/domain/linkedFolders';
import { exifReader } from '@shared/photos/exifReader';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as tripRepo from '../db/repositories/trips';
import { readPhotoFile } from './fileReader';
import { FolderScanner, fsWatchRecursive, type FolderScannerOptions, type ScannerEvent, type WatchFn } from './folderScanner';

const PHOTO = join(process.cwd(), 'test-data', 'generated', 'photos', 'buxton.jpg');
const describeIf = existsSync(PHOTO) ? describe : describe.skip;

let root: string;
let handle: DbHandle;
let db: Db;
let tripId: string;
let scanner: FolderScanner | null;
let events: ScannerEvent[];

/** A watcher the test drives by hand. */
function fakeWatch() {
  const watchers = new Map<string, { change: () => void; error: () => void; closed: boolean }>();
  const watch: WatchFn = (path, change, error) => {
    const w = { change, error, closed: false };
    watchers.set(path, w);
    return { close: () => void (w.closed = true) };
  };
  return { watch, watchers };
}

function makeFolder(name: string, files = 1): LinkedFolder {
  const path = join(root, name);
  mkdirSync(path, { recursive: true });
  for (let i = 0; i < files; i += 1) copyFileSync(PHOTO, join(path, `${i}.jpg`));
  return foldersRepo.insertLinkedFolder(db, { tripId, path, realPath: path, name, includeSubfolders: true, now: Date.now() });
}

function start(options: Partial<FolderScannerOptions> = {}): FolderScanner {
  scanner = new FolderScanner({
    db: () => db,
    reader: exifReader,
    emit: (event) => events.push(event),
    scanDeps: { datalessCheck: () => Promise.resolve(new Set()), progressMs: 0 },
    debounceMs: 5,
    missingPollMs: 20,
    watch: fakeWatch().watch,
    ...options,
  });
  scanner.reconcile();
  return scanner;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-scanner-'));
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  tripId = tripRepo.insertTrip(db, { id: 'trip', folderId: null, name: 'Peak', description: null, notes: null, now: Date.now() }).id;
  events = [];
  scanner = null;
});

afterEach(() => {
  scanner?.stop();
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describeIf('FolderScanner', () => {
  it('scans every linked folder on reconcile, at most two at a time', async () => {
    const folders = ['a', 'b', 'c'].map((n) => makeFolder(n));
    let running = 0;
    let peak = 0;
    const s = start({
      scanDeps: {
        datalessCheck: () => Promise.resolve(new Set()),
        readFile: async (path, format, reader) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 10));
          running -= 1;
          return readPhotoFile(path, format, reader);
        },
      },
    });
    await s.idle();
    expect(peak).toBe(2);
    for (const f of folders) {
      expect(s.runtime(f.id)?.state).toBe('available');
      expect(filesRepo.indexOf(db, f.id).size).toBe(1);
    }
    expect(events.filter((e) => e.type === 'changed')).toHaveLength(3);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
  });

  it('runs a folder again, once, when asked during a scan', async () => {
    const folder = makeFolder('a');
    let scans = 0;
    const gate: { release?: () => void } = {};
    const s = start({
      scanDeps: {
        datalessCheck: () => Promise.resolve(new Set()),
        readFile: async (path, format, reader) => {
          scans += 1;
          if (scans === 1) await new Promise<void>((resolve) => (gate.release = resolve));
          return readPhotoFile(path, format, reader);
        },
      },
    });
    await vi.waitFor(() => expect(scans).toBe(1));
    s.rescan(folder.id);
    s.rescan(folder.id); // asking twice still means one more run
    copyFileSync(PHOTO, join(folder.path, 'new.jpg')); // so the second run has something to read
    gate.release?.();
    await s.idle();
    await vi.waitFor(() => expect(s.runtime(folder.id)?.state).toBe('available'));
    expect(filesRepo.indexOf(db, folder.id).size).toBe(2);
    expect(scans).toBe(2);
  });

  it('marks a vanished folder missing, keeps its rows, and rescans it when it returns', async () => {
    const folder = makeFolder('drive');
    const s = start();
    await s.idle();
    renameSync(folder.path, `${folder.path}-unplugged`);
    s.rescan(folder.id);
    await s.idle();
    expect(s.runtime(folder.id)?.state).toBe('missing');
    expect(filesRepo.indexOf(db, folder.id).size).toBe(1);

    renameSync(`${folder.path}-unplugged`, folder.path);
    await vi.waitFor(() => expect(s.runtime(folder.id)?.state).toBe('available'), { timeout: 2000 });
    expect(filesRepo.indexOf(db, folder.id).size).toBe(1);
  });

  it('treats a watcher event as a hint: a debounced rescan finds the new file', async () => {
    const folder = makeFolder('a');
    const { watch, watchers } = fakeWatch();
    const s = start({ watch });
    await s.idle();
    copyFileSync(PHOTO, join(folder.path, 'added.jpg'));
    const w = watchers.get(folder.path);
    w?.change();
    w?.change();
    w?.change();
    await vi.waitFor(() => expect(filesRepo.indexOf(db, folder.id).has('added.jpg')).toBe(true));
  });

  it('marks a folder missing when its watcher fails, and checks for its return', async () => {
    const folder = makeFolder('a');
    const { watch, watchers } = fakeWatch();
    const s = start({ watch });
    await s.idle();
    watchers.get(folder.path)?.error();
    expect(s.runtime(folder.id)?.state).toBe('missing');
    // The folder is still there, so the 20 ms check finds it and rescans.
    await vi.waitFor(() => expect(s.runtime(folder.id)?.state).toBe('available'), { timeout: 2000 });
  });

  it('forgets an unlinked folder and closes its watcher', async () => {
    const folder = makeFolder('a');
    const { watch, watchers } = fakeWatch();
    const s = start({ watch });
    await s.idle();
    foldersRepo.deleteLinkedFolder(db, folder.id);
    s.reconcile();
    expect(s.runtime(folder.id)).toBeNull();
    expect(watchers.get(folder.path)?.closed).toBe(true);
  });

  it('rescans a relinked folder at its new path, and watches there', async () => {
    const folder = makeFolder('old', 1);
    const moved = makeFolder('elsewhere', 2);
    foldersRepo.deleteLinkedFolder(db, moved.id);
    const { watch, watchers } = fakeWatch();
    const s = start({ watch });
    await s.idle();
    foldersRepo.updateLinkedFolder(db, folder.id, { path: moved.path, realPath: moved.path }, Date.now());
    s.reconcile();
    await s.idle();
    expect(filesRepo.indexOf(db, folder.id).size).toBe(2);
    expect(watchers.get(folder.path)?.closed).toBe(true);
    expect(watchers.has(moved.path)).toBe(true);
  });

  it('on focus, rescans folders that are stale or missing, and leaves fresh ones alone', async () => {
    const fresh = makeFolder('fresh');
    const stale = makeFolder('stale');
    let now = 1_000_000;
    const s = start({ now: () => now });
    await s.idle();
    foldersRepo.updateLinkedFolder(db, stale.id, { lastScanAt: now - 11 * 60 * 1000 }, now);
    events = [];
    s.onFocus();
    await s.idle();
    const rescanned = events.filter((e) => e.type === 'changed').map((e) => (e as { folderId: string }).folderId);
    expect(rescanned).toEqual([stale.id]);
    expect(rescanned).not.toContain(fresh.id);
    now += 1;
  });

  it('stops: no more scans, watchers closed', async () => {
    const folder = makeFolder('a');
    const { watch, watchers } = fakeWatch();
    const s = start({ watch });
    await s.idle();
    s.stop();
    s.rescan(folder.id);
    s.reconcile();
    expect(s.runtime(folder.id)).toBeNull();
    expect(watchers.get(folder.path)?.closed).toBe(true);
  });
});

describeIf('the real watcher', () => {
  // An FSEvents stream takes a moment to start, and a change made in that
  // moment can be missed. That is harmless in the app, where the watcher is
  // only a hint and focus and manual rescans catch up (design §5.7), but the
  // test waits for the stream so that it tests delivery, not start-up.
  it('fs.watch on a folder reports a file added in a subfolder', { timeout: 20_000 }, async () => {
    const folder = makeFolder('watched');
    mkdirSync(join(folder.path, 'Day 2'));
    const s = start({ watch: fsWatchRecursive, debounceMs: 50 });
    await s.idle();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    copyFileSync(PHOTO, join(folder.path, 'Day 2', 'late.jpg'));
    await vi.waitFor(() => expect(filesRepo.indexOf(db, folder.id).has('Day 2/late.jpg')).toBe(true), { timeout: 15_000 });
  });
});
