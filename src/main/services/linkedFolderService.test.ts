import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as photosRepo from '../db/repositories/photoMetadata';
import * as tripRepo from '../db/repositories/trips';
import { assertNotInLinkedFolder, IN_LINKED_FOLDER } from '../linkedFolders/writeGuard';
import { applyCommand, isUndoable, labelFor } from './commands';
import * as service from './linkedFolderService';
import { alreadyLinked, containsLinked, insideLinked, REFUSAL } from './linkedFolderService';
import * as tripService from './tripService';

let root: string;
let handle: DbHandle;
let db: Db;
let tripId: string;
let otherTripId: string;
let appData: string;

/** Real path of a temp path: macOS's /var is /private/var. */
const real = (path: string): string => realpathSync.native(path).normalize('NFC');

function makeTrip(name: string): string {
  return tripRepo.insertTrip(db, { id: `trip-${name}`, folderId: null, name, description: null, notes: null, now: Date.now() }).id;
}

async function linkPath(path: string, trip = tripId, includeSubfolders = true) {
  const chosen = await service.chooseFolder(db, { tripId: trip, path, appDataDir: appData });
  return service.link(db, { token: chosen.token, includeSubfolders });
}

async function refusal(path: string, trip = tripId): Promise<string> {
  try {
    await service.chooseFolder(db, { tripId: trip, path, appDataDir: appData });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${path} was not refused`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-link-'));
  for (const dir of ['Photos/2026/Peak', 'Other', 'AppData', 'Library.photoslibrary/originals']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, 'Photos/2026/Peak/buxton.jpg'), 'not really a photo');
  writeFileSync(join(root, 'notes.txt'), 'a file');
  symlinkSync(join(root, 'Photos/2026'), join(root, 'Alias'));
  appData = join(root, 'AppData');
  handle = createDatabase({ file: join(root, 'AppData', 'test.db') });
  db = handle.db;
  tripId = makeTrip('Peak weekend');
  otherTripId = makeTrip('Staffordshire');
  service.clearPendingChoices();
});

afterEach(() => {
  handle.close();
  chmodSync(join(root, 'Other'), 0o755);
  rmSync(root, { recursive: true, force: true });
});

describe('choosing and linking', () => {
  it('links a folder under its real path and name, undoably', async () => {
    const chosen = await service.chooseFolder(db, { tripId, path: join(root, 'Photos/2026'), appDataDir: appData });
    expect(chosen.name).toBe('2026');
    expect(chosen.displayPath).toBe(real(join(root, 'Photos/2026')));

    const linked = service.link(db, { token: chosen.token, includeSubfolders: false });
    expect(linked.result).toMatchObject({ tripId, name: '2026', realPath: real(join(root, 'Photos/2026')), includeSubfolders: false });
    expect(linked.inverse).toEqual({ kind: 'linkedFolder:unlink', payload: { id: linked.result.id } });
    expect(labelFor(linked.inverse.kind)).toBe('link folder');
  });

  it('uses a token once, and refuses an unknown one', async () => {
    const chosen = await service.chooseFolder(db, { tripId, path: join(root, 'Photos'), appDataDir: appData });
    service.link(db, { token: chosen.token, includeSubfolders: true });
    expect(() => service.link(db, { token: chosen.token, includeSubfolders: true })).toThrow(REFUSAL.tokenExpired);
  });

  it('refuses an expired token', async () => {
    const chosen = await service.chooseFolder(db, { tripId, path: join(root, 'Photos'), appDataDir: appData, now: 0 });
    expect(() => service.link(db, { token: chosen.token, includeSubfolders: true, now: 11 * 60 * 1000 })).toThrow(
      REFUSAL.tokenExpired,
    );
  });

  it('allows the same folder to be linked to another trip', async () => {
    await linkPath(join(root, 'Photos'));
    await expect(linkPath(join(root, 'Photos'), otherTripId)).resolves.toBeDefined();
  });
});

describe('refusals (design §4.2)', () => {
  it('refuses an Apple Photos library, and a folder inside one', async () => {
    expect(await refusal(join(root, 'Library.photoslibrary'))).toBe(REFUSAL.photosLibrary);
    expect(await refusal(join(root, 'Library.photoslibrary/originals'))).toBe(REFUSAL.photosLibrary);
  });

  it('refuses the same folder twice for one trip', async () => {
    await linkPath(join(root, 'Photos/2026'));
    expect(await refusal(join(root, 'Photos/2026'))).toBe(alreadyLinked('Peak weekend'));
  });

  it('catches a symlinked spelling of a linked folder', async () => {
    await linkPath(join(root, 'Photos/2026'));
    expect(await refusal(join(root, 'Alias'))).toBe(alreadyLinked('Peak weekend'));
  });

  it('catches a differently-cased spelling of a linked folder', async () => {
    await linkPath(join(root, 'Photos/2026'));
    expect(await refusal(join(root, 'PHOTOS/2026'))).toBe(alreadyLinked('Peak weekend'));
  });

  it('refuses a folder inside a linked folder', async () => {
    await linkPath(join(root, 'Photos'));
    expect(await refusal(join(root, 'Photos/2026/Peak'))).toBe(insideLinked('Photos', 'Peak weekend'));
  });

  it('refuses a folder that contains a linked folder', async () => {
    await linkPath(join(root, 'Photos/2026/Peak'));
    expect(await refusal(join(root, 'Photos'))).toBe(containsLinked('Peak', 'Peak weekend'));
  });

  it('does not mistake a sibling with a common prefix for a parent', async () => {
    mkdirSync(join(root, 'Photos 2'));
    await linkPath(join(root, 'Photos'));
    await expect(linkPath(join(root, 'Photos 2'))).resolves.toBeDefined();
  });

  it('refuses TrailRT’s own data folder, and a folder containing it', async () => {
    expect(await refusal(appData)).toBe(REFUSAL.appData);
    expect(await refusal(root)).toBe(REFUSAL.appData);
  });

  it('refuses a missing folder and a file', async () => {
    expect(await refusal(join(root, 'Nowhere'))).toBe(REFUSAL.missing);
    expect(await refusal(join(root, 'notes.txt'))).toBe(REFUSAL.notFolder);
  });

  it('says macOS refused access, rather than calling the folder empty', async () => {
    chmodSync(join(root, 'Other'), 0o000);
    expect(await refusal(join(root, 'Other'))).toBe(REFUSAL.denied);
  });

  it('checks again at link time, in case another link was made since the choice', async () => {
    const first = await service.chooseFolder(db, { tripId, path: join(root, 'Photos'), appDataDir: appData });
    const second = await service.chooseFolder(db, { tripId, path: join(root, 'Photos/2026'), appDataDir: appData });
    service.link(db, { token: first.token, includeSubfolders: true });
    expect(() => service.link(db, { token: second.token, includeSubfolders: true })).toThrow(insideLinked('Photos', 'Peak weekend'));
  });
});

function indexPhoto(folderId: string, relativePath: string): string {
  const file = filesRepo.upsertFile(db, {
    folderId,
    relativePath,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: 10,
    mtimeMs: 1,
    fingerprint: `fp-${relativePath}`,
  });
  photosRepo.upsertPhotoMetadata(db, file.id, {
    state: 'unlocated',
    reason: 'No location in this photo',
    lat: null,
    lon: null,
    altitudeM: null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal: '2026-06-14T10:00:00',
    takenOffsetMin: null,
    orientation: 1,
  });
  return file.id;
}

describe('undo', () => {
  it('link → unlink → undo brings the folder back under the same id', async () => {
    const linked = (await linkPath(join(root, 'Photos'))).result;
    indexPhoto(linked.id, 'a.jpg');

    const unlinked = service.unlink(db, linked.id);
    expect(foldersRepo.findLinkedFolder(db, linked.id)).toBeNull();
    expect(filesRepo.indexOf(db, linked.id).size).toBe(0); // the cache goes with it
    expect(isUndoable(unlinked.inverse)).toBe(true);
    expect(labelFor(unlinked.inverse.kind)).toBe('unlink folder');

    // Through the command registry, as the undo stack applies it, after a JSON
    // round trip like any stored payload.
    const undone = applyCommand(db, JSON.parse(JSON.stringify(unlinked.inverse)));
    const restored = foldersRepo.findLinkedFolder(db, linked.id);
    expect(restored).toMatchObject({ id: linked.id, path: linked.path, realPath: linked.realPath, createdAt: linked.createdAt });
    expect(restored?.lastScanAt).toBeNull(); // the index must be rebuilt

    // Redo unlinks again.
    applyCommand(db, undone.inverse);
    expect(foldersRepo.findLinkedFolder(db, linked.id)).toBeNull();
  });

  it('relink keeps every index row, matched by path, and undoes to the old location', async () => {
    const linked = (await linkPath(join(root, 'Photos/2026'))).result;
    const fileId = indexPhoto(linked.id, 'Peak/buxton.jpg');
    mkdirSync(join(root, 'Moved'));

    const relinked = await service.relink(db, { folderId: linked.id, path: join(root, 'Moved'), appDataDir: appData });
    expect(relinked.result.realPath).toBe(real(join(root, 'Moved')));
    expect(relinked.result.name).toBe('Moved');
    expect(filesRepo.findFile(db, fileId)?.relativePath).toBe('Peak/buxton.jpg');

    applyCommand(db, relinked.inverse);
    expect(foldersRepo.findLinkedFolder(db, linked.id)?.realPath).toBe(linked.realPath);
  });

  it('relinking a folder to its own location is not refused as "already linked"', async () => {
    const linked = (await linkPath(join(root, 'Photos'))).result;
    await expect(service.relink(db, { folderId: linked.id, path: join(root, 'Photos'), appDataDir: appData })).resolves.toBeDefined();
  });

  it('relink applies the same refusals', async () => {
    const linked = (await linkPath(join(root, 'Photos'))).result;
    await expect(
      service.relink(db, { folderId: linked.id, path: join(root, 'Library.photoslibrary'), appDataDir: appData }),
    ).rejects.toThrow(REFUSAL.photosLibrary);
  });

  it('undoes Include subfolders', async () => {
    const linked = (await linkPath(join(root, 'Photos'))).result;
    const changed = service.setIncludeSubfolders(db, linked.id, false);
    expect(changed.result.includeSubfolders).toBe(false);
    applyCommand(db, changed.inverse);
    expect(foldersRepo.findLinkedFolder(db, linked.id)?.includeSubfolders).toBe(true);
  });
});

describe('trip duplication', () => {
  it('copies the links, index and metadata under new ids, and leaves the original alone', async () => {
    const linked = (await linkPath(join(root, 'Photos'))).result;
    const fileId = indexPhoto(linked.id, 'a.jpg');

    const copy = tripService.duplicate(db, tripId).result;
    const [copied] = foldersRepo.listLinkedFolders(db, copy.id);
    expect(copied).toMatchObject({ realPath: linked.realPath, name: linked.name });
    expect(copied?.id).not.toBe(linked.id);
    const copiedPhotos = photosRepo.listPhotos(db, copied?.id ?? '');
    expect(copiedPhotos.map((p) => p.relativePath)).toEqual(['a.jpg']);
    expect(copiedPhotos[0]?.id).not.toBe(fileId);
    expect(copiedPhotos[0]?.takenLocal).toBe('2026-06-14T10:00:00');
    expect(photosRepo.listPhotos(db, linked.id)).toHaveLength(1);
  });
});

describe('the write guard', () => {
  it('refuses a new file inside a linked folder, at any depth', async () => {
    await linkPath(join(root, 'Photos'));
    await expect(assertNotInLinkedFolder(db, join(root, 'Photos/export.gpx'))).rejects.toThrow(IN_LINKED_FOLDER('Photos'));
    await expect(assertNotInLinkedFolder(db, join(root, 'Photos/2026/Peak/export.gpx'))).rejects.toThrow(IN_LINKED_FOLDER('Photos'));
  });

  it('refuses through a symlinked spelling, and an existing file', async () => {
    await linkPath(join(root, 'Photos/2026'));
    await expect(assertNotInLinkedFolder(db, join(root, 'Alias/backup.db'))).rejects.toThrow(IN_LINKED_FOLDER('2026'));
    await expect(assertNotInLinkedFolder(db, join(root, 'Photos/2026/Peak/buxton.jpg'))).rejects.toThrow(IN_LINKED_FOLDER('2026'));
  });

  it('allows anywhere else, including the linked folder’s parent', async () => {
    await linkPath(join(root, 'Photos/2026'));
    await expect(assertNotInLinkedFolder(db, join(root, 'Other/export.gpx'))).resolves.toBeUndefined();
    await expect(assertNotInLinkedFolder(db, join(root, 'Photos/export.gpx'))).resolves.toBeUndefined();
  });

  it('guards folders linked to any trip, not only the one being exported', async () => {
    await linkPath(join(root, 'Photos'), otherTripId);
    await expect(assertNotInLinkedFolder(db, join(root, 'Photos/x.ics'))).rejects.toThrow(IN_LINKED_FOLDER('Photos'));
  });
});
