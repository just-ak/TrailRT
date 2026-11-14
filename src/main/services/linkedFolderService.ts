import { randomUUID } from 'node:crypto';
import { opendir, realpath, stat } from 'node:fs/promises';
import { basename, sep } from 'node:path';
import type { ChosenFolder, LinkedFolder } from '@shared/domain/linkedFolders';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/linkedFolders';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as tripService from './tripService';

/**
 * Linking a folder on disk to a trip. Phase 11, design §4 and ADR 0020.
 *
 * Choosing is two steps, like import staging (design §4.1): the main process
 * checks the folder the user picked and holds it under a short-lived token,
 * and the renderer confirms with that token. The renderer only ever sees a
 * path for display, never one it could ask to be read.
 *
 * Every refusal in design §4.2 is checked against **real** paths
 * (`realpath`, which on macOS also returns the on-disk case) normalised to
 * NFC, so a symlinked or differently-cased spelling of a folder is still
 * recognised.
 *
 * Scanning is not done here. After a link, unlink, restore or relink, the
 * scanner's `reconcile()` (task 7) brings its state into line with the rows.
 */

export const REFUSAL = {
  photosLibrary:
    'This is an Apple Photos library. Its layout is private to Photos and changes between versions, so TrailRT does not read it. Export the photos to a folder (Photos › File › Export) and link that.',
  denied:
    'macOS has not given TrailRT access to this folder. Allow it in System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then try again.',
  missing: 'That folder could not be found. It may have been moved, renamed or disconnected.',
  notFolder: 'Choose a folder, not a file.',
  appData: 'This folder contains TrailRT’s own data, so it cannot be linked.',
  tokenExpired: 'That folder choice has expired. Choose the folder again.',
} as const;

export const alreadyLinked = (trip: string): string => `This folder is already linked to ${trip}.`;
export const insideLinked = (name: string, trip: string): string =>
  `This folder is inside ${name}, which is already linked to ${trip}, so its photos are already shown.`;
export const containsLinked = (name: string, trip: string): string =>
  `This folder contains ${name}, which is already linked to ${trip}, so its photos would be shown twice.`;

const refuse = (message: string): ServiceError => new ServiceError('BLOCKED', message);

/** `a` is `b`, or inside it. Both real and NFC-normalised. */
export function isWithin(a: string, b: string): boolean {
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/** The real, NFC-normalised path of `path`, or a refusal saying why there is none. */
export async function realPathOf(path: string): Promise<string> {
  try {
    return (await realpath(path)).normalize('NFC');
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EPERM' || code === 'EACCES') throw refuse(REFUSAL.denied);
    throw refuse(REFUSAL.missing);
  }
}

export interface CheckedFolder {
  path: string;
  realPath: string;
  name: string;
}

/**
 * The refusals of design §4.2, in order. `excludeFolderId` leaves a folder
 * out of the comparison, for relinking it.
 */
export async function checkFolder(
  db: Db,
  options: { tripId: string; path: string; appDataDir: string; excludeFolderId?: string },
): Promise<CheckedFolder> {
  const real = await realPathOf(options.path);

  // A Photos library, or a folder inside one, chosen directly.
  if (real.split(sep).some((part) => part.toLowerCase().endsWith('.photoslibrary'))) {
    throw refuse(REFUSAL.photosLibrary);
  }

  try {
    if (!(await stat(real)).isDirectory()) throw refuse(REFUSAL.notFolder);
    // Listing is what macOS's privacy controls refuse, so try it now rather
    // than report the folder as empty later (Requirement 1.7).
    const dir = await opendir(real);
    await dir.read();
    await dir.close();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    const code = codeOf(error);
    throw refuse(code === 'EPERM' || code === 'EACCES' ? REFUSAL.denied : REFUSAL.missing);
  }

  // TrailRT's own data, which also keeps the thumbnail cache out of every
  // linked folder (design §7.3).
  const appData = await realPathOf(options.appDataDir).catch(() => options.appDataDir.normalize('NFC'));
  if (isWithin(real, appData) || isWithin(appData, real)) throw refuse(REFUSAL.appData);

  const trip = tripService.get(db, options.tripId);
  for (const other of repo.listLinkedFolders(db, options.tripId)) {
    if (other.id === options.excludeFolderId) continue;
    if (real === other.realPath) throw refuse(alreadyLinked(trip.name));
    if (isWithin(real, other.realPath)) throw refuse(insideLinked(other.name, trip.name));
    if (isWithin(other.realPath, real)) throw refuse(containsLinked(other.name, trip.name));
  }

  return { path: options.path, realPath: real, name: basename(real) };
}

// ------------------------------------------------------------ choosing

interface Pending {
  tripId: string;
  folder: CheckedFolder;
  expires: number;
}

/** Long enough to read a dialog; short enough that a stale choice is not linked. */
const TOKEN_LIFETIME_MS = 10 * 60 * 1000;
const pending = new Map<string, Pending>();

export type { ChosenFolder } from '@shared/domain/linkedFolders';

/**
 * Checks a folder the user picked in the native chooser (design §4.1) and
 * holds it under a token. The IPC layer opens the chooser and passes the
 * path; nothing from the renderer reaches here as a path.
 */
export async function chooseFolder(
  db: Db,
  options: { tripId: string; path: string; appDataDir: string; now?: number },
): Promise<ChosenFolder> {
  const folder = await checkFolder(db, options);
  const now = options.now ?? Date.now();
  for (const [token, entry] of pending) if (entry.expires < now) pending.delete(token);
  const token = randomUUID();
  pending.set(token, { tripId: options.tripId, folder, expires: now + TOKEN_LIFETIME_MS });
  return { token, name: folder.name, displayPath: folder.realPath, warnings: [] };
}

// ------------------------------------------------------------ mutations

/** Links the folder held under `token` (Requirement 1.1). Undoable. */
export function link(db: Db, options: { token: string; includeSubfolders: boolean; now?: number }): Mutation<LinkedFolder> {
  const now = options.now ?? Date.now();
  const entry = pending.get(options.token);
  if (entry === undefined || entry.expires < now) throw refuse(REFUSAL.tokenExpired);
  pending.delete(options.token);

  // Checked again here: another link may have been made since the choice.
  const trip = tripService.get(db, entry.tripId);
  for (const other of repo.listLinkedFolders(db, entry.tripId)) {
    if (entry.folder.realPath === other.realPath) throw refuse(alreadyLinked(trip.name));
    if (isWithin(entry.folder.realPath, other.realPath)) throw refuse(insideLinked(other.name, trip.name));
    if (isWithin(other.realPath, entry.folder.realPath)) throw refuse(containsLinked(other.name, trip.name));
  }

  const folder = repo.insertLinkedFolder(db, {
    tripId: entry.tripId,
    path: entry.folder.path,
    realPath: entry.folder.realPath,
    name: entry.folder.name,
    includeSubfolders: options.includeSubfolders,
    now,
  });
  return { result: folder, inverse: { kind: 'linkedFolder:unlink', payload: { id: folder.id } } };
}

/**
 * Unlinks a folder (Requirement 1.8). The files on disk are not touched; the
 * folder's index and metadata go by cascade, and its thumbnails are removed by
 * the cache (task 8). The inverse restores the same row, with the same id, so
 * anything made from its photos finds them again after a rescan (design §4.4).
 */
export function unlink(db: Db, id: string): Mutation<{ id: string }> {
  const folder = repo.findLinkedFolder(db, id);
  if (folder === null) throw notFound('That linked folder');
  repo.deleteLinkedFolder(db, id);
  return { result: { id }, inverse: { kind: 'linkedFolder:restore', payload: { folder: { ...folder } } } };
}

/** Puts an unlinked folder back under its old id. The scanner rebuilds its index. */
export function restore(db: Db, folder: LinkedFolder, now = Date.now()): Mutation<LinkedFolder> {
  tripService.get(db, folder.tripId);
  const restored = repo.insertLinkedFolder(db, {
    id: folder.id,
    tripId: folder.tripId,
    path: folder.path,
    realPath: folder.realPath,
    name: folder.name,
    includeSubfolders: folder.includeSubfolders,
    // The index is gone, so it has not been scanned; when it was last seen still holds.
    lastScanAt: null,
    lastSeenAt: folder.lastSeenAt,
    createdAt: folder.createdAt,
    now,
  });
  return { result: restored, inverse: { kind: 'linkedFolder:unlink', payload: { id: folder.id } } };
}

/**
 * Points a folder row at a new location, with no checks. This is the command
 * undo replays; `relink` is what the user does, and it checks first.
 */
export function setLocation(
  db: Db,
  id: string,
  location: { path: string; realPath: string; name: string },
  now = Date.now(),
): Mutation<LinkedFolder> {
  const before = repo.findLinkedFolder(db, id);
  if (before === null) throw notFound('That linked folder');
  const after = repo.updateLinkedFolder(db, id, location, now);
  if (after === null) throw notFound('That linked folder');
  return {
    result: after,
    inverse: {
      kind: 'linkedFolder:relink',
      payload: { id, path: before.path, realPath: before.realPath, name: before.name },
    },
  };
}

/**
 * Relinks a moved folder to its new location (Requirement 3.5). Every index
 * row is kept: files are matched by their path within the folder, so a moved
 * folder comes back whole after the rescan.
 */
export async function relink(
  db: Db,
  options: { folderId: string; path: string; appDataDir: string; now?: number },
): Promise<Mutation<LinkedFolder>> {
  const folder = repo.findLinkedFolder(db, options.folderId);
  if (folder === null) throw notFound('That linked folder');
  const checked = await checkFolder(db, {
    tripId: folder.tripId,
    path: options.path,
    appDataDir: options.appDataDir,
    excludeFolderId: folder.id,
  });
  return setLocation(db, folder.id, { path: checked.path, realPath: checked.realPath, name: checked.name }, options.now);
}

/** Includes or leaves out subfolders (Requirement 1.3). The next scan applies it. */
export function setIncludeSubfolders(db: Db, id: string, include: boolean, now = Date.now()): Mutation<LinkedFolder> {
  const before = repo.findLinkedFolder(db, id);
  if (before === null) throw notFound('That linked folder');
  const after = repo.updateLinkedFolder(db, id, { includeSubfolders: include }, now);
  if (after === null) throw notFound('That linked folder');
  return {
    result: after,
    inverse: { kind: 'linkedFolder:setIncludeSubfolders', payload: { id, include: before.includeSubfolders } },
  };
}

export function list(db: Db, tripId?: string): LinkedFolder[] {
  return repo.listLinkedFolders(db, tripId);
}

export function get(db: Db, id: string): LinkedFolder {
  const folder = repo.findLinkedFolder(db, id);
  if (folder === null) throw notFound('That linked folder');
  return folder;
}

/** Test seam: forget every pending choice. */
export function clearPendingChoices(): void {
  pending.clear();
}
