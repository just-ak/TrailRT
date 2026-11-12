import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LinkedFolder } from '@shared/domain/linkedFolders';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as tripRepo from '../db/repositories/trips';
import { ServiceError } from '../services/errors';
import { RESOLVE_REFUSAL, resolveFilePath, safeRelative } from './resolve';

let root: string;
let handle: DbHandle;
let db: Db;
let folder: LinkedFolder;

/** An index row, as the scanner would write it, for any relative path. */
function row(relativePath: string): string {
  return filesRepo.upsertFile(db, {
    folderId: folder.id,
    relativePath,
    kind: 'photo',
    format: 'jpeg',
    sizeBytes: 3,
    mtimeMs: 1,
    fingerprint: null,
  }).id;
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
  root = mkdtempSync(join(tmpdir(), 'trailrt-p11-resolve-'));
  handle = createDatabase({ file: join(root, 'test.db') });
  db = handle.db;
  const tripId = tripRepo.insertTrip(db, { id: 'trip', folderId: null, name: 'Peak', description: null, notes: null, now: 1 }).id;
  const path = join(root, 'Peak 2026');
  mkdirSync(join(path, 'Day 1'), { recursive: true });
  writeFileSync(join(path, 'Day 1', 'a.jpg'), 'abc');
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside', 'secret.jpg'), 'xyz');
  folder = foldersRepo.insertLinkedFolder(db, { tripId, path, realPath: path, name: 'Peak 2026', includeSubfolders: true, now: 1 });
});

afterEach(() => {
  handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe('safeRelative', () => {
  it('keeps a path inside the folder', () => {
    expect(safeRelative('Day 1/a.jpg')).toBe(join('Day 1', 'a.jpg'));
    expect(safeRelative('a/../b.jpg')).toBe('b.jpg');
  });

  it('refuses a path that leaves the folder, is absolute, or names the folder itself', () => {
    for (const bad of ['..', '../x.jpg', 'a/../../x.jpg', '/etc/passwd', '', '.', 'a/..', 'a\u0000b.jpg']) {
      expect(safeRelative(bad), bad).toBeNull();
    }
  });
});

describe('resolveFilePath', () => {
  it('resolves an indexed file to its real path inside the folder', async () => {
    const id = row('Day 1/a.jpg');
    const resolved = await resolveFilePath(db, id);
    expect(resolved.path.endsWith(join('Peak 2026', 'Day 1', 'a.jpg'))).toBe(true);
    expect(resolved.folder.id).toBe(folder.id);
  });

  it('refuses a relative path that escapes with ..', async () => {
    const id = row('../outside/secret.jpg');
    const error = await refusal(resolveFilePath(db, id));
    expect(error.code).toBe('BLOCKED');
    expect(error.message).toBe(RESOLVE_REFUSAL.outside);
  });

  it('refuses a symbolic link that has appeared since the scan and points out', async () => {
    const id = row('Day 1/a.jpg');
    rmSync(join(folder.path, 'Day 1', 'a.jpg'));
    symlinkSync(join(root, 'outside', 'secret.jpg'), join(folder.path, 'Day 1', 'a.jpg'));
    const error = await refusal(resolveFilePath(db, id));
    expect(error.code).toBe('BLOCKED');
    expect(error.message).toBe(RESOLVE_REFUSAL.outside);
  });

  it('refuses a subfolder replaced by a link out', async () => {
    const id = row('Day 1/a.jpg');
    rmSync(join(folder.path, 'Day 1'), { recursive: true });
    mkdirSync(join(root, 'outside', 'Day 1'));
    writeFileSync(join(root, 'outside', 'Day 1', 'a.jpg'), 'abc');
    symlinkSync(join(root, 'outside', 'Day 1'), join(folder.path, 'Day 1'));
    const error = await refusal(resolveFilePath(db, id));
    expect(error.message).toBe(RESOLVE_REFUSAL.outside);
  });

  it('follows the folder itself through a link, since the user chose it', async () => {
    const id = row('Day 1/a.jpg');
    const alias = join(root, 'alias');
    symlinkSync(folder.path, alias);
    foldersRepo.updateLinkedFolder(db, folder.id, { path: alias }, 2);
    const resolved = await resolveFilePath(db, id);
    expect(resolved.path.endsWith(join('Peak 2026', 'Day 1', 'a.jpg'))).toBe(true);
  });

  it('says a file has gone rather than resolving it', async () => {
    const id = row('Day 1/gone.jpg');
    const error = await refusal(resolveFilePath(db, id));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe(RESOLVE_REFUSAL.gone);
  });

  it('refuses an id that is not in the index', async () => {
    const error = await refusal(resolveFilePath(db, '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f'));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('refuses while the folder is missing or denied, without touching the disk', async () => {
    const id = row('Day 1/a.jpg');
    const missing = await refusal(resolveFilePath(db, id, () => 'missing'));
    expect(missing.message).toBe(RESOLVE_REFUSAL.folderUnavailable('Peak 2026'));
    const denied = await refusal(resolveFilePath(db, id, () => 'denied'));
    expect(denied.message).toBe(RESOLVE_REFUSAL.denied);
    // Scanning is not a reason to refuse: the folder is there.
    await expect(resolveFilePath(db, id, () => 'scanning')).resolves.toBeDefined();
  });

  it('says the folder is unavailable when it has gone from disk', async () => {
    const id = row('Day 1/a.jpg');
    rmSync(folder.path, { recursive: true });
    const error = await refusal(resolveFilePath(db, id));
    expect(error.message).toBe(RESOLVE_REFUSAL.folderUnavailable('Peak 2026'));
  });
});
