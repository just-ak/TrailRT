import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhotoThumbnail } from '@shared/domain/linkedFolders';
import type { Db } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { findPhoto } from '../db/repositories/photoMetadata';
import { checkDataless, type DatalessCheck } from '../linkedFolders/dataless';
import type { ResolvedFile } from '../linkedFolders/resolve';
import { ServiceError } from '../services/errors';

/**
 * Preview thumbnails for linked photos. Phase 11, design §6.
 *
 * `<root>/<folderId>/<photoId>-<size>-<mtime>.jpg`. The photo's size and
 * modified time are in the name, so a changed photo gets a new thumbnail and
 * the old one is removed. The cache is bounded (512 MB by default): a served
 * thumbnail's own modified time is set to now, and when the total passes the
 * bound the least recently served are deleted down to 90%. Deleting the whole
 * directory is always safe; that is what "rebuildable" means.
 *
 * This module writes only below its own root, which is inside TrailRT's data
 * folder, which can never be inside a linked folder (design §4.2). It is not
 * in `main/linkedFolders/`, so the read-only source scan does not cover it,
 * and it never writes to the path it is given a photo at.
 *
 * Thumbnails are made only when the preview asks (Requirement 9.3), and never
 * for a photo that is not downloaded from iCloud, because Quick Look would
 * download it (Requirement 3.6). That is checked against the disk at the time,
 * not only against the last scan.
 */

export const THUMBNAIL_PX = 640;
export const DEFAULT_BOUND_BYTES = 512 * 1024 * 1024;
/** After eviction the cache is at most this share of the bound. */
export const EVICT_TO = 0.9;

export const THUMBNAIL_REFUSAL = {
  notFound: 'That photo is no longer in the folder’s index. Rescan the folder.',
  notPhoto: 'That file is not a photo.',
  notDownloaded:
    'This photo is in iCloud and has not been downloaded to this Mac. TrailRT does not download it. Open it in Finder to download it.',
  failed: 'A preview could not be made for this photo.',
} as const;

export type Thumbnail = PhotoThumbnail;

/** Makes a JPEG thumbnail no larger than `px` on its long side, or `null` if it cannot. */
export type MakeThumbnail = (path: string, px: number) => Promise<Uint8Array | null>;

export interface ThumbnailCacheOptions {
  root: string;
  make: MakeThumbnail;
  boundBytes?: number;
  datalessCheck?: DatalessCheck;
  now?: () => number;
}

/**
 * Width and height from a JPEG's start-of-frame marker, or `null` if there is
 * none. Used to answer the preview's size from a cached file without decoding it.
 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end, or scan data before any frame
    const length = view.getUint16(at + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (at + 9 > bytes.length) return null;
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** The modified time as it appears in a file name: digits, and `_` for the point. */
function mtimeToken(mtimeMs: number): string {
  return String(mtimeMs).replace('.', '_').replace(/[^0-9_]/g, '');
}

export function thumbnailName(photoId: string, sizeBytes: number, mtimeMs: number): string {
  return `${photoId}-${sizeBytes}-${mtimeToken(mtimeMs)}.jpg`;
}

/** The photo id a cached file belongs to, or `null` for anything not made here. */
function photoIdOf(name: string): string | null {
  const match = /^([0-9a-f-]{36})-\d+-[\d_]+\.jpg$/.exec(name);
  return match?.[1] ?? null;
}

interface CachedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export class ThumbnailCache {
  private readonly root: string;
  private readonly make: MakeThumbnail;
  private readonly boundBytes: number;
  private readonly datalessCheck: DatalessCheck;
  private readonly now: () => number;
  /** Bytes in the cache, once counted. `null` until the first count. */
  private total: number | null = null;
  private readonly inFlight = new Map<string, Promise<Thumbnail>>();

  constructor(options: ThumbnailCacheOptions) {
    this.root = options.root;
    this.make = options.make;
    this.boundBytes = options.boundBytes ?? DEFAULT_BOUND_BYTES;
    this.datalessCheck = options.datalessCheck ?? checkDataless;
    this.now = options.now ?? Date.now;
  }

  /**
   * The thumbnail for a photo, made if need be. `resolve` is the path guard of
   * design §7.2: the cache never builds a path itself.
   */
  async get(db: Db, photoId: string, resolve: (fileId: string) => Promise<ResolvedFile>): Promise<Thumbnail> {
    const photo = findPhoto(db, photoId);
    if (photo === null) {
      const file = filesRepo.findFile(db, photoId);
      throw new ServiceError(file === null ? 'NOT_FOUND' : 'INVALID_REQUEST', file === null ? THUMBNAIL_REFUSAL.notFound : THUMBNAIL_REFUSAL.notPhoto);
    }
    // When the source cannot be reached, a thumbnail made earlier is still
    // shown (design §10.4, Requirement 6.7): it needs no path, so it works
    // while the drive is unplugged. Only when there is none is the reason
    // passed on.
    const orCached = async (refusal: unknown): Promise<Thumbnail> => {
      const cached = await this.cached(photo.folderId, photoId);
      if (cached !== null) return { ...cached, fromCache: true };
      throw refusal;
    };
    const notDownloaded = new ServiceError('BLOCKED', THUMBNAIL_REFUSAL.notDownloaded);
    if (photo.state === 'not-downloaded') return orCached(notDownloaded);

    let resolved: ResolvedFile;
    try {
      resolved = await resolve(photoId);
    } catch (refusal) {
      return orCached(refusal);
    }
    // The disk now, not the last scan: the file may have changed, or been
    // evicted to iCloud, since.
    const info = await stat(resolved.path).catch(() => null);
    if (info === null || !info.isFile()) return orCached(new ServiceError('NOT_FOUND', THUMBNAIL_REFUSAL.notFound));
    if (info.size > 0 && info.blocks === 0 && (await this.datalessCheck([resolved.path])).has(resolved.path)) {
      return orCached(notDownloaded);
    }

    const dir = join(this.root, resolved.folder.id);
    const name = thumbnailName(photoId, info.size, info.mtimeMs);
    const target = join(dir, name);
    const pending = this.inFlight.get(target);
    if (pending !== undefined) return pending;

    const work = this.serveOrMake(resolved.path, dir, name, photoId).finally(() => this.inFlight.delete(target));
    this.inFlight.set(target, work);
    return work;
  }

  /**
   * The newest thumbnail already made for a photo, whatever version of the
   * file it was made from, or `null`. Reads only the cache.
   */
  async cached(folderId: string, photoId: string): Promise<Thumbnail | null> {
    if (!/^[0-9a-f-]{36}$/.test(folderId)) return null;
    const dir = join(this.root, folderId);
    let newest: { path: string; mtimeMs: number } | null = null;
    for (const entry of await this.list(dir)) {
      if (!entry.isFile() || photoIdOf(entry.name) !== photoId) continue;
      const path = join(dir, entry.name);
      // oxlint-disable-next-line no-await-in-loop
      const info = await lstat(path).catch(() => null);
      if (info !== null && (newest === null || info.mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs: info.mtimeMs };
    }
    if (newest === null) return null;
    const bytes = await readFile(newest.path).then((b) => new Uint8Array(b)).catch(() => null);
    const size = bytes === null ? null : jpegSize(bytes);
    return bytes === null || size === null ? null : { bytes, ...size };
  }

  /** Removes a folder's thumbnails, when it is unlinked (design §4.4). */
  async removeFolder(folderId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(folderId)) return;
    await rm(join(this.root, folderId), { recursive: true, force: true });
    this.total = null;
  }

  /**
   * Removes the directories of folders that are no longer linked. Cheap: one
   * listing of the root. Run after undo and redo, which can unlink.
   */
  async removeOrphanFolders(db: Db): Promise<number> {
    const linked = new Set(foldersRepo.listLinkedFolders(db).map((f) => f.id));
    let removed = 0;
    for (const entry of await this.list(this.root)) {
      if (!entry.isDirectory() || linked.has(entry.name)) continue;
      // oxlint-disable-next-line no-await-in-loop
      await rm(join(this.root, entry.name), { recursive: true, force: true });
      removed += 1;
    }
    if (removed > 0) this.total = null;
    return removed;
  }

  /**
   * The launch sweep (design §6.2): folders no longer linked, thumbnails of
   * files no longer indexed, and leftovers of an interrupted write, then the
   * bound. Never blocks launch; the caller does not wait on it.
   */
  async sweep(db: Db): Promise<void> {
    await this.removeOrphanFolders(db);
    for (const entry of await this.list(this.root)) {
      if (!entry.isDirectory()) continue;
      const dir = join(this.root, entry.name);
      const indexed = new Set([...filesRepo.indexOf(db, entry.name).values()].map((f) => f.id));
      // oxlint-disable-next-line no-await-in-loop
      for (const file of await this.list(dir)) {
        const id = photoIdOf(file.name);
        // oxlint-disable-next-line no-await-in-loop
        if (id === null || !indexed.has(id)) await rm(join(dir, file.name), { force: true });
      }
    }
    this.total = null;
    await this.enforceBound();
  }

  /** Deletes the least recently served thumbnails until the cache is within the bound. */
  async enforceBound(): Promise<void> {
    const files = await this.allFiles();
    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > this.boundBytes) {
      const target = this.boundBytes * EVICT_TO;
      for (const file of files.toSorted((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (total <= target) break;
        // oxlint-disable-next-line no-await-in-loop
        await rm(file.path, { force: true });
        total -= file.size;
      }
    }
    this.total = total;
  }

  /** Bytes in the cache now. For tests and the bound. */
  async size(): Promise<number> {
    return (await this.allFiles()).reduce((sum, f) => sum + f.size, 0);
  }

  // ------------------------------------------------------------- internals

  private async serveOrMake(source: string, dir: string, name: string, photoId: string): Promise<Thumbnail> {
    const target = join(dir, name);
    const cached = await readFile(target).catch(() => null);
    if (cached !== null) {
      const bytes = new Uint8Array(cached);
      const size = jpegSize(bytes);
      if (size !== null) {
        const now = new Date(this.now());
        await utimes(target, now, now).catch(() => undefined);
        return { bytes, ...size };
      }
      await rm(target, { force: true }); // damaged: make it again
    }

    const made = await this.make(source, THUMBNAIL_PX).catch(() => null);
    const size = made === null || made.length === 0 ? null : jpegSize(made);
    if (made === null || size === null) throw new ServiceError('IO_ERROR', THUMBNAIL_REFUSAL.failed);

    await mkdir(dir, { recursive: true });
    // Written beside its final name and renamed, so a reader never sees half a file.
    const temp = join(dir, `.${name}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(temp, made);
    await rename(temp, target);
    const now = new Date(this.now());
    await utimes(target, now, now).catch(() => undefined);

    // An older thumbnail of the same photo is now stale.
    let freed = 0;
    for (const entry of await this.list(dir)) {
      if (entry.name === name || photoIdOf(entry.name) !== photoId) continue;
      const path = join(dir, entry.name);
      // oxlint-disable-next-line no-await-in-loop
      const old = await lstat(path).catch(() => null);
      // oxlint-disable-next-line no-await-in-loop
      await unlink(path).catch(() => undefined);
      freed += old?.size ?? 0;
    }

    if (this.total === null) {
      await this.enforceBound();
    } else {
      this.total += made.length - freed;
      if (this.total > this.boundBytes) await this.enforceBound();
    }
    return { bytes: made, ...size };
  }

  private async list(dir: string) {
    return readdir(dir, { withFileTypes: true }).catch(() => []);
  }

  private async allFiles(): Promise<CachedFile[]> {
    const files: CachedFile[] = [];
    for (const folder of await this.list(this.root)) {
      if (!folder.isDirectory()) continue;
      const dir = join(this.root, folder.name);
      // oxlint-disable-next-line no-await-in-loop
      for (const entry of await this.list(dir)) {
        if (!entry.isFile()) continue;
        const path = join(dir, entry.name);
        // oxlint-disable-next-line no-await-in-loop
        const info = await lstat(path).catch(() => null);
        if (info !== null) files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    return files;
  }
}
