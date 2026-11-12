import { lstat, opendir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type {
  FolderFileFormat,
  FolderFileKind,
  IndexedFile,
  LinkedFolder,
  PhotoMetadata,
  ScanOutcome,
  ScanProgress,
  SkippedCounts,
} from '@shared/domain/linkedFolders';
import type { PhotoMetadataReader, PhotoReadResult } from '@shared/photos/PhotoMetadataReader';
import type { Db } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as photosRepo from '../db/repositories/photoMetadata';
import { classify, icloudPlaceholderFor, isPackage, unsupportedImage } from './classify';
import { checkDataless, type DatalessCheck } from './dataless';
import { readPhotoFile, type PhotoFileRead } from './fileReader';

/**
 * One scan of one linked folder. Phase 11, design §5.
 *
 * 1. **Walk** the folder asynchronously, skipping hidden entries, macOS
 *    packages, symbolic links of every kind, and subfolders when they are
 *    off. Nothing is followed out of the folder (Requirement 8.2).
 * 2. **Compare** each file with the index. A file whose size and modified time
 *    match its row is not opened (Requirement 3.2).
 * 3. **Read** new and changed photos, except those iCloud has not downloaded,
 *    which are never opened (Requirement 3.6). GPX and video are indexed by
 *    size and time only (Requirement 3.8).
 * 4. **Pair moves** by fingerprint, so a renamed photo keeps its row
 *    (Requirement 3.7, design §5.3).
 * 5. **Remove** rows for files that are gone, but only after a walk that
 *    finished. An interrupted or partial walk deletes nothing.
 *
 * Asynchronous throughout, yielding every 200 files so IPC handlers interleave
 * (Requirement 9.1). Writes are batched in transactions.
 */

// The shapes the renderer sees too live in the shared domain (task 8).
export type { ScanOutcome, ScanPhase, ScanProgress, SkippedCounts } from '@shared/domain/linkedFolders';

export interface ScanDeps {
  db: Db;
  reader: PhotoMetadataReader;
  /** Injectable for tests: spies on what is opened. */
  readFile?: (path: string, format: 'jpeg' | 'heic', reader: PhotoMetadataReader) => Promise<PhotoFileRead>;
  datalessCheck?: DatalessCheck;
  now?: () => number;
  onProgress?: (progress: ScanProgress) => void;
  /** Minimum interval between progress reports. Default 250 ms. */
  progressMs?: number;
}

export const NOT_DOWNLOADED = 'Not downloaded from iCloud. Open it in Finder to download it.';
export const NO_LOCATION = 'No location recorded in this photo';

interface Found {
  relativePath: string;
  absolutePath: string;
  kind: FolderFileKind;
  format: FolderFileFormat;
  sizeBytes: number;
  mtimeMs: number;
  blocks: number;
  /** An iCloud `.icloud` placeholder standing for this file. */
  placeholder: boolean;
}

const YIELD_EVERY = 200;
const WRITE_BATCH = 200;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * A function, not an inline check: cancellation can arrive across any
 * `await`, and TypeScript would otherwise narrow `aborted` to false after the
 * first check.
 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

function emptySkipped(): SkippedCounts {
  return { hidden: 0, packages: 0, symlinks: 0, subfolders: 0, unsupported: {}, unreadableFolders: 0 };
}

/** What is stored for a photo, from what its reader found. */
export function metadataFrom(result: PhotoReadResult): PhotoMetadata {
  const blank: PhotoMetadata = {
    state: 'unreadable',
    reason: null,
    lat: null,
    lon: null,
    altitudeM: null,
    accuracyM: null,
    directionDeg: null,
    directionRef: null,
    takenLocal: null,
    takenOffsetMin: null,
    orientation: null,
  };
  if (!result.ok) return { ...blank, reason: result.reason };
  const common = {
    takenLocal: result.taken?.local ?? null,
    takenOffsetMin: result.taken?.offsetMinutes ?? null,
    orientation: result.orientation,
  };
  const location = result.location;
  if (location === null) {
    return { ...blank, ...common, state: 'unlocated', reason: result.locationRejected ?? NO_LOCATION };
  }
  return {
    ...blank,
    ...common,
    state: 'located',
    lat: location.lat,
    lon: location.lon,
    altitudeM: location.altitudeM,
    accuracyM: location.accuracyM,
    directionDeg: location.direction?.degrees ?? null,
    directionRef: location.direction?.ref ?? null,
  };
}

function notDownloaded(): PhotoMetadata {
  return { ...metadataFrom({ ok: false, reason: NOT_DOWNLOADED }), state: 'not-downloaded' };
}

/** Is the folder there, and may it be listed? */
export async function folderAvailability(path: string): Promise<'available' | 'missing' | 'denied'> {
  try {
    if (!(await stat(path)).isDirectory()) return 'missing';
    const dir = await opendir(path);
    await dir.close();
    return 'available';
  } catch (error) {
    const code = codeOf(error);
    return code === 'EPERM' || code === 'EACCES' ? 'denied' : 'missing';
  }
}

async function walk(
  folder: LinkedFolder,
  signal: AbortSignal | undefined,
  report: (seen: number) => void,
): Promise<{ found: Map<string, Found>; skipped: SkippedCounts; complete: boolean } | 'cancelled'> {
  const found = new Map<string, Found>();
  const placeholders: Found[] = [];
  const skipped = emptySkipped();
  const stack: string[] = [''];
  let complete = true;
  let entries = 0;

  while (stack.length > 0) {
    const relativeDir = stack.pop() ?? '';
    let dir;
    try {
      dir = await opendir(join(folder.path, relativeDir));
    } catch (error) {
      if (relativeDir === '') throw error;
      skipped.unreadableFolders += 1;
      complete = false;
      continue;
    }
    try {
      for await (const entry of dir) {
        entries += 1;
        if (entries % YIELD_EVERY === 0) {
          if (isAborted(signal)) {
            await dir.close().catch(() => undefined);
            return 'cancelled';
          }
          report(found.size);
          await yieldToEventLoop();
        }
        const name = entry.name.normalize('NFC');
        const relativePath = relativeDir === '' ? name : posix.join(relativeDir, name);

        if (entry.isSymbolicLink()) {
          skipped.symlinks += 1;
          continue;
        }
        if (name.startsWith('.')) {
          const realName = entry.isFile() ? icloudPlaceholderFor(name) : null;
          const kind = realName === null ? null : classify(realName);
          if (realName !== null && kind?.kind === 'photo') {
            const stats = await lstat(join(folder.path, relativePath)).catch(() => null);
            if (stats !== null) {
              const realPath = relativeDir === '' ? realName : posix.join(relativeDir, realName);
              placeholders.push({ relativePath: realPath, absolutePath: join(folder.path, realPath), ...kind, sizeBytes: 0, mtimeMs: stats.mtimeMs, blocks: 0, placeholder: true });
            }
          } else {
            skipped.hidden += 1;
          }
          continue;
        }
        if (entry.isDirectory()) {
          if (isPackage(name)) skipped.packages += 1;
          else if (folder.includeSubfolders) stack.push(relativePath);
          else skipped.subfolders += 1;
          continue;
        }
        if (!entry.isFile()) continue;
        const kind = classify(name);
        if (kind === null) {
          const unsupported = unsupportedImage(name);
          if (unsupported !== null) skipped.unsupported[unsupported] = (skipped.unsupported[unsupported] ?? 0) + 1;
          continue;
        }
        // lstat, not stat: the entry was not a link when listed, and must not be
        // followed if it became one since.
        const stats = await lstat(join(folder.path, relativePath)).catch(() => null);
        if (stats === null || !stats.isFile()) continue;
        found.set(relativePath, {
          relativePath,
          absolutePath: join(folder.path, relativePath),
          ...kind,
          sizeBytes: stats.size,
          mtimeMs: stats.mtimeMs,
          blocks: stats.blocks,
          placeholder: false,
        });
      }
    } catch (error) {
      // A folder that fails part-way through listing. For the top folder that
      // is the folder failing; for a subfolder, the walk is partial.
      if (relativeDir === '') throw error;
      skipped.unreadableFolders += 1;
      complete = false;
    }
  }
  // A real file wins over a placeholder for the same name.
  for (const placeholder of placeholders) {
    if (!found.has(placeholder.relativePath)) found.set(placeholder.relativePath, placeholder);
  }
  return { found, skipped, complete };
}

interface Read {
  file: Found;
  metadata: PhotoMetadata | null;
  fingerprint: string | null;
}

/** Scans `folder` once. Never throws for a file; a folder-level failure is an outcome. */
export async function scanFolder(deps: ScanDeps, folder: LinkedFolder, signal?: AbortSignal): Promise<ScanOutcome> {
  const { db, reader } = deps;
  const readFile = deps.readFile ?? readPhotoFile;
  const datalessCheck = deps.datalessCheck ?? checkDataless;
  const now = deps.now ?? Date.now;
  const progressMs = deps.progressMs ?? 250;
  let lastReport = 0;
  const report = (progress: Omit<ScanProgress, 'folderId'>, force = false): void => {
    const time = Date.now();
    if (!force && time - lastReport < progressMs) return;
    lastReport = time;
    deps.onProgress?.({ folderId: folder.id, ...progress });
  };

  if (isAborted(signal)) return { status: 'cancelled' };
  const availability = await folderAvailability(folder.path);
  if (availability !== 'available') return { status: availability };
  foldersRepo.updateLinkedFolder(db, folder.id, { lastSeenAt: now() }, now());

  let walked;
  try {
    walked = await walk(folder, signal, (seen) => report({ phase: 'walking', seen, read: 0 }));
  } catch (error) {
    const code = codeOf(error);
    return code === 'EPERM' || code === 'EACCES' ? { status: 'denied' } : { status: 'missing' };
  }
  if (walked === 'cancelled') return { status: 'cancelled' };
  const { found, skipped } = walked;

  // ---- compare with the index
  const index = filesRepo.indexOf(db, folder.id);
  const toUpdate: Found[] = [];
  let unchanged = 0;
  for (const file of found.values()) {
    const row = index.get(file.relativePath);
    if (row !== undefined && row.sizeBytes === file.sizeBytes && row.mtimeMs === file.mtimeMs && row.kind === file.kind) {
      unchanged += 1;
    } else {
      toUpdate.push(file);
    }
  }

  // ---- iCloud: never open what is not downloaded
  const candidates = toUpdate.filter((f) => f.kind === 'photo' && !f.placeholder && f.sizeBytes > 0 && f.blocks === 0).map((f) => f.absolutePath);
  const dataless = candidates.length > 0 ? await datalessCheck(candidates) : new Set<string>();

  // ---- read
  const photosToRead = toUpdate.filter((f) => f.kind === 'photo' && !f.placeholder && !dataless.has(f.absolutePath));
  const total = photosToRead.length;
  let readCount = 0;
  report({ phase: 'reading', seen: found.size, read: 0, total }, true);

  const reads: Read[] = [];
  for (const file of toUpdate) {
    if (isAborted(signal)) {
      flush(db, folder.id, reads, index);
      return { status: 'cancelled' };
    }
    if (file.kind !== 'photo') {
      reads.push({ file, metadata: null, fingerprint: null });
    } else if (file.placeholder || dataless.has(file.absolutePath)) {
      reads.push({ file, metadata: notDownloaded(), fingerprint: null });
    } else {
      const read = await readFile(file.absolutePath, file.format as 'jpeg' | 'heic', reader);
      reads.push({ file, metadata: metadataFrom(read.result), fingerprint: read.fingerprint });
      readCount += 1;
      report({ phase: 'reading', seen: found.size, read: readCount, total });
    }
    if (reads.length >= WRITE_BATCH) {
      flush(db, folder.id, reads, index);
      await yieldToEventLoop();
    }
  }
  flush(db, folder.id, reads, index);
  report({ phase: 'reading', seen: found.size, read: readCount, total }, true);

  const added = toUpdate.filter((f) => !index.has(f.relativePath)).length;
  const changed = toUpdate.length - added;

  if (!walked.complete) {
    return { status: 'partial', reason: 'Some subfolders could not be read, so nothing was removed.', skipped };
  }
  // Checked here whatever else happened: removing rows is the one step a
  // cancelled scan must never reach, and a rescan with nothing to read would
  // otherwise never look at the signal.
  if (isAborted(signal)) return { status: 'cancelled' };

  // ---- moves, then removals, in one transaction: only a finished walk may say a file is gone
  let moved = 0;
  let removed = 0;
  db.transaction(() => {
    moved = pairMoves(db, folder.id, index, found);
    removed = filesRepo.deleteMissing(db, folder.id, new Set(found.keys()));
    foldersRepo.updateLinkedFolder(db, folder.id, { lastScanAt: now() }, now());
  });
  return { status: 'complete', added: added - moved, changed, removed, moved, unchanged, skipped };
}

function photoMetadataOf(photo: PhotoMetadata): PhotoMetadata {
  return {
    state: photo.state,
    reason: photo.reason,
    lat: photo.lat,
    lon: photo.lon,
    altitudeM: photo.altitudeM,
    accuracyM: photo.accuracyM,
    directionDeg: photo.directionDeg,
    directionRef: photo.directionRef,
    takenLocal: photo.takenLocal,
    takenOffsetMin: photo.takenOffsetMin,
    orientation: photo.orientation,
  };
}

/** Writes the reads so far in one transaction, and clears the list. */
function flush(db: Db, folderId: string, reads: Read[], index: Map<string, IndexedFile>): void {
  if (reads.length === 0) return;
  db.transaction(() => {
    for (const { file, metadata, fingerprint } of reads) {
      const previous = index.get(file.relativePath);
      const row = filesRepo.upsertFile(db, {
        folderId,
        relativePath: file.relativePath,
        kind: file.kind,
        format: file.format,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        // A not-downloaded photo keeps the fingerprint it had, if it was read before.
        fingerprint: fingerprint ?? (metadata?.state === 'not-downloaded' ? (previous?.fingerprint ?? null) : null),
      });
      if (metadata !== null) photosRepo.upsertPhotoMetadata(db, row.id, metadata);
    }
  });
  reads.length = 0;
}

/** Rows grouped by size and fingerprint: what makes two rows the same photo. */
function groupBySizeAndFingerprint(rows: readonly IndexedFile[]): Map<string, IndexedFile[]> {
  const map = new Map<string, IndexedFile[]>();
  for (const row of rows) {
    const key = `${row.sizeBytes}:${row.fingerprint ?? ''}`;
    const list = map.get(key);
    if (list === undefined) map.set(key, [row]);
    else list.push(row);
  }
  return map;
}

/**
 * Pairs rows whose path vanished with rows added in this scan, by size and
 * fingerprint, when exactly one of each matches (design §5.3). The old row is
 * moved to the new path, keeping its id, and takes the fresh metadata; the
 * row the scan inserted for the new path is removed. Returns the number moved.
 */
function pairMoves(db: Db, folderId: string, before: Map<string, IndexedFile>, found: Map<string, Found>): number {
  const vanished = [...before.values()].filter((row) => !found.has(row.relativePath) && row.fingerprint !== null);
  if (vanished.length === 0) return 0;
  const after = filesRepo.indexOf(db, folderId);
  const added = [...after.values()].filter((row) => !before.has(row.relativePath) && row.fingerprint !== null);
  if (added.length === 0) return 0;

  const vanishedByKey = groupBySizeAndFingerprint(vanished);
  const addedByKey = groupBySizeAndFingerprint(added);

  let moved = 0;
  for (const [k, olds] of vanishedByKey) {
    const news = addedByKey.get(k);
    if (olds.length !== 1 || news?.length !== 1) continue; // ambiguous: not paired
    const [oldRow] = olds;
    const [newRow] = news;
    if (oldRow === undefined || newRow === undefined || oldRow.kind !== 'photo') continue;
    const fresh = photosRepo.findPhoto(db, newRow.id);
    // The new path's row goes first: paths are unique within a folder.
    filesRepo.deleteFile(db, newRow.id);
    filesRepo.movePath(db, oldRow.id, newRow.relativePath, newRow.sizeBytes, newRow.mtimeMs);
    if (fresh !== null) photosRepo.upsertPhotoMetadata(db, oldRow.id, photoMetadataOf(fresh));
    moved += 1;
  }
  return moved;
}
