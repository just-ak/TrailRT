import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedFolder } from '@shared/domain/linkedFolders';
import { exifReader } from '@shared/photos/exifReader';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as photosRepo from '../db/repositories/photoMetadata';
import * as tripRepo from '../db/repositories/trips';
import { classify, icloudPlaceholderFor, isPackage, unsupportedImage } from './classify';
import { checkDataless } from './dataless';
import { readPhotoFile } from './fileReader';
import { NOT_DOWNLOADED, scanFolder, type ScanDeps, type ScanOutcome } from './scanner';

const FIXTURES = join(process.cwd(), 'test-data', 'generated');
const describeTree = existsSync(join(FIXTURES, 'photos', 'buxton.heic')) ? describe : describe.skip;

let root: string;
let photos: string;
let handle: DbHandle;
let db: Db;
let folder: LinkedFolder;
let readFile: ReturnType<typeof vi.fn<NonNullable<ScanDeps['readFile']>>>;

function deps(extra: Partial<ScanDeps> = {}): ScanDeps {
  return { db, reader: exifReader, readFile, datalessCheck: () => Promise.resolve(new Set()), ...extra };
}

async function scan(extra: Partial<ScanDeps> = {}, signal?: AbortSignal): Promise<ScanOutcome> {
  const current = foldersRepo.findLinkedFolder(db, folder.id);
  if (current === null) throw new Error('folder gone');
  return scanFolder(deps(extra), current, signal);
}

function complete(outcome: ScanOutcome) {
  if (outcome.status !== 'complete') throw new Error(`expected complete, got ${JSON.stringify(outcome)}`);
  return outcome;
}

const opened = (): string[] => readFile.mock.calls.map(([path]) => path.slice(photos.length + 1));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-scan-'));
  photos = join(root, 'photos');
  if (existsSync(join(FIXTURES, 'photos'))) {
    cpSync(join(FIXTURES, 'photos'), photos, { recursive: true, verbatimSymlinks: true });
    cpSync(join(FIXTURES, 'photos-outside'), join(root, 'photos-outside'), { recursive: true });
  } else {
    mkdirSync(photos);
  }
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  const tripId = tripRepo.insertTrip(db, { id: 'trip', folderId: null, name: 'Peak', description: null, notes: null, now: Date.now() }).id;
  folder = foldersRepo.insertLinkedFolder(db, { tripId, path: photos, realPath: photos, name: 'photos', includeSubfolders: true, now: Date.now() });
  readFile = vi.fn<NonNullable<ScanDeps['readFile']>>((path, format, reader) => readPhotoFile(path, format, reader));
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('classify', () => {
  it.each([
    ['IMG_0001.JPG', 'photo', 'jpeg'],
    ['a.jpeg', 'photo', 'jpeg'],
    ['b.HEIC', 'photo', 'heic'],
    ['day.gpx', 'geodata', 'gpx'],
    ['ride.FIT', 'geodata', 'fit'],
    ['clip.mov', 'video', 'mov'],
    ['clip.m4v', 'video', 'm4v'],
  ])('%s is %s/%s', (name, kind, format) => {
    expect(classify(name)).toEqual({ kind, format });
  });

  it('does not recognise other files, and names the image formats it leaves out', () => {
    expect(classify('notes.txt')).toBeNull();
    expect(classify('jpg')).toBeNull();
    expect(unsupportedImage('scan.PNG')).toBe('PNG');
    expect(unsupportedImage('raw.dng')).toBe('DNG');
    expect(unsupportedImage('notes.txt')).toBeNull();
  });

  it('knows packages and iCloud placeholders', () => {
    expect(isPackage('Photos Library.photoslibrary')).toBe(true);
    expect(isPackage('Trip 2026')).toBe(false);
    expect(icloudPlaceholderFor('.IMG_0001.HEIC.icloud')).toBe('IMG_0001.HEIC');
    expect(icloudPlaceholderFor('.hidden')).toBeNull();
  });
});

describeTree('scanFolder over the fixture tree', () => {
  it('indexes the tree on the first scan, with photos by state and the rest counted', async () => {
    const outcome = complete(await scan());
    expect(outcome.added).toBe(32); // 29 photos, 2 track files, 1 video
    expect(outcome.removed).toBe(0);
    expect(outcome.skipped.symlinks).toBe(1);
    expect(outcome.skipped.packages).toBe(1);
    expect(outcome.skipped.hidden).toBeGreaterThanOrEqual(1);
    expect(outcome.skipped.unsupported).toEqual({ PNG: 1 });
    expect(filesRepo.countsByKind(db, folder.id)).toEqual({ photo: 29, geodata: 2, video: 1 });
    expect(photosRepo.countsByState(db, folder.id)).toEqual({ located: 20, unlocated: 5, unreadable: 4, 'not-downloaded': 0 });
    expect(foldersRepo.findLinkedFolder(db, folder.id)?.lastScanAt).not.toBeNull();
  });

  it('stores what was read, with reasons for the unlocated and unreadable', async () => {
    await scan();
    const byPath = new Map(photosRepo.listPhotos(db, folder.id).map((p) => [p.relativePath, p]));
    expect(byPath.get('buxton.heic')).toMatchObject({ state: 'located', altitudeM: 300.5, directionDeg: 271.25, directionRef: 'T', takenOffsetMin: 60 });
    expect(byPath.get('zero-zero.jpg')?.reason).toMatch(/0°, 0°/);
    expect(byPath.get('no-gps.jpg')?.reason).toBe('No location recorded in this photo');
    expect(byPath.get('not-an-image.heic')).toMatchObject({ state: 'unreadable', reason: 'Not a HEIC image' });
    expect(byPath.get('nested/deeper/ashbourne.jpg')?.state).toBe('located');
    expect(byPath.get('buxton.jpg')?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never follows the symbolic link out, and skips hidden folders and the Photos library', async () => {
    await scan();
    const paths = [...filesRepo.indexOf(db, folder.id).keys()];
    expect(paths.some((p) => p.startsWith('link-out'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.hidden'))).toBe(false);
    expect(paths.some((p) => p.includes('.photoslibrary'))).toBe(false);
    expect(opened().some((p) => p.startsWith('link-out'))).toBe(false);
  });

  it('opens no GPX, FIT or video file', async () => {
    await scan();
    expect(opened().filter((p) => !/\.(jpe?g|heic)$/i.test(p))).toEqual([]);
  });

  it('opens no file at all on an unchanged rescan', async () => {
    await scan();
    readFile.mockClear();
    const outcome = complete(await scan());
    expect(readFile).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ added: 0, changed: 0, removed: 0, moved: 0, unchanged: 32 });
  });

  it('rereads only a file whose modified time changed', async () => {
    await scan();
    readFile.mockClear();
    utimesSync(join(photos, 'leek-o6.jpg'), new Date(), new Date('2026-07-01T10:00:00Z'));
    expect(complete(await scan()).changed).toBe(1);
    expect(opened()).toEqual(['leek-o6.jpg']);
  });

  it('removes the row of a deleted file, and nothing else', async () => {
    await scan();
    unlinkSync(join(photos, 'no-gps.jpg'));
    expect(complete(await scan()).removed).toBe(1);
    expect(filesRepo.indexOf(db, folder.id).has('no-gps.jpg')).toBe(false);
    expect(filesRepo.countsByKind(db, folder.id).photo).toBe(28);
  });

  it('keeps a renamed photo’s row id and metadata, without rereading the rest', async () => {
    await scan();
    const before = filesRepo.indexOf(db, folder.id).get('buxton.jpg');
    mkdirSync(join(photos, 'Best'));
    renameSync(join(photos, 'buxton.jpg'), join(photos, 'Best/Buxton viewpoint.jpg'));
    readFile.mockClear();

    const outcome = complete(await scan());
    expect(outcome).toMatchObject({ moved: 1, added: 0, removed: 0 });
    const after = filesRepo.indexOf(db, folder.id).get('Best/Buxton viewpoint.jpg');
    expect(after?.id).toBe(before?.id);
    expect(photosRepo.findPhoto(db, after?.id ?? '')?.altitudeM).toBe(300.5);
    expect(opened()).toEqual(['Best/Buxton viewpoint.jpg']);
  });

  it('does not pair a move when two new files share the fingerprint', async () => {
    await scan();
    const before = filesRepo.indexOf(db, folder.id).get('leek-o6.jpg');
    cpSync(join(photos, 'leek-o6.jpg'), join(photos, 'copy-a.jpg'));
    cpSync(join(photos, 'leek-o6.jpg'), join(photos, 'copy-b.jpg'));
    unlinkSync(join(photos, 'leek-o6.jpg'));

    const outcome = complete(await scan());
    expect(outcome).toMatchObject({ moved: 0, added: 2, removed: 1 });
    const index = filesRepo.indexOf(db, folder.id);
    expect(index.get('copy-a.jpg')?.id).not.toBe(before?.id);
    expect(index.get('copy-b.jpg')?.id).not.toBe(before?.id);
  });

  it('drops nested files when subfolders are switched off, and finds them again when switched on', async () => {
    await scan();
    foldersRepo.updateLinkedFolder(db, folder.id, { includeSubfolders: false }, Date.now());
    const off = complete(await scan());
    expect(off.skipped.subfolders).toBeGreaterThanOrEqual(3); // burst, nested, tracks
    expect(filesRepo.indexOf(db, folder.id).has('nested/deeper/ashbourne.jpg')).toBe(false);
    foldersRepo.updateLinkedFolder(db, folder.id, { includeSubfolders: true }, Date.now());
    await scan();
    expect(filesRepo.indexOf(db, folder.id).has('nested/deeper/ashbourne.jpg')).toBe(true);
  });
});

describeTree('scans that cannot finish delete nothing', () => {
  it('a scan cancelled before it starts does nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await scan({}, controller.signal)).status).toBe('cancelled');
    expect(filesRepo.indexOf(db, folder.id).size).toBe(0);
  });

  it('a scan cancelled after its walk deletes nothing, even with nothing to read', async () => {
    await scan();
    unlinkSync(join(photos, 'no-gps.jpg'));
    const controller = new AbortController();
    // Cancel as the reading phase begins, after the walk has seen the deletion.
    const onProgress: ScanDeps['onProgress'] = (progress) => {
      if (progress.phase === 'reading') controller.abort();
    };
    expect((await scan({ onProgress }, controller.signal)).status).toBe('cancelled');
    expect(filesRepo.indexOf(db, folder.id).has('no-gps.jpg')).toBe(true);
  });

  it('a scan cancelled while reading keeps the rows it had written', async () => {
    const controller = new AbortController();
    let reads = 0;
    readFile.mockImplementation(async (path, format, reader) => {
      reads += 1;
      if (reads === 3) controller.abort();
      return readPhotoFile(path, format, reader);
    });
    expect((await scan({}, controller.signal)).status).toBe('cancelled');
    const kept = filesRepo.indexOf(db, folder.id).size;
    expect(kept).toBeGreaterThanOrEqual(3);
    expect(kept).toBeLessThan(32);
  });

  it('a walk with an unreadable subfolder is partial, and deletes nothing', async () => {
    await scan();
    unlinkSync(join(photos, 'no-gps.jpg'));
    chmodSync(join(photos, 'burst'), 0o000);
    try {
      const outcome = await scan();
      expect(outcome.status).toBe('partial');
      expect(filesRepo.indexOf(db, folder.id).has('no-gps.jpg')).toBe(true);
      expect(filesRepo.indexOf(db, folder.id).has('burst/1.jpg')).toBe(true);
    } finally {
      chmodSync(join(photos, 'burst'), 0o755);
    }
  });

  it('a renamed folder is missing, with every row kept, and comes back by itself', async () => {
    await scan();
    renameSync(photos, `${photos}-unplugged`);
    expect(await scan()).toEqual({ status: 'missing' });
    expect(filesRepo.countsByKind(db, folder.id).photo).toBe(29);

    renameSync(`${photos}-unplugged`, photos);
    readFile.mockClear();
    expect(complete(await scan())).toMatchObject({ removed: 0, unchanged: 32 });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('iCloud: files not downloaded are never opened', () => {
  it('a candidate the check confirms is listed as not downloaded and not opened', async () => {
    // A sparse file has no blocks, so it is a candidate; the stubbed check says dataless.
    execFileSync('/usr/bin/truncate', ['-s', '3m', join(photos, 'IMG_0001.HEIC')]);
    const outcome = complete(await scan({ datalessCheck: (paths) => Promise.resolve(new Set(paths)) }));
    expect(outcome.added).toBeGreaterThanOrEqual(1);
    expect(opened()).not.toContain('IMG_0001.HEIC');
    const row = photosRepo.listPhotos(db, folder.id).find((p) => p.relativePath === 'IMG_0001.HEIC');
    expect(row).toMatchObject({ state: 'not-downloaded', reason: NOT_DOWNLOADED, lat: null });
  });

  it('the real check finds no SF_DATALESS flag on a sparse local file, so it is read', async () => {
    const sparse = join(photos, 'sparse.jpg');
    execFileSync('/usr/bin/truncate', ['-s', '1m', sparse]);
    writeFileSync(join(photos, 'dense.jpg'), 'x');
    expect(await checkDataless([sparse])).toEqual(new Set());
    await scan({ datalessCheck: checkDataless });
    expect(opened()).toContain('sparse.jpg');
  });

  it('the real check treats a path it cannot stat as not downloaded, rather than open it', async () => {
    const gone = join(photos, 'gone.jpg');
    expect(await checkDataless([gone])).toEqual(new Set([gone]));
  });

  it('an .icloud placeholder is listed under its real name as not downloaded', async () => {
    writeFileSync(join(photos, '.IMG_0002.HEIC.icloud'), 'placeholder');
    await scan();
    const row = photosRepo.listPhotos(db, folder.id).find((p) => p.relativePath === 'IMG_0002.HEIC');
    expect(row?.state).toBe('not-downloaded');
    expect(opened()).not.toContain('IMG_0002.HEIC');
  });
});
