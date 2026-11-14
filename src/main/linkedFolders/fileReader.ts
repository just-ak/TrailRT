import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { PhotoFormat, PhotoMetadataReader, PhotoReadResult, RangeReader } from '@shared/photos/PhotoMetadataReader';

/**
 * The one place that opens a file in a linked folder. Phase 11, design §5.2
 * and §7.3.
 *
 * Files are opened **read-only and without following a symbolic link**
 * (`O_RDONLY | O_NOFOLLOW`), and the descriptor is closed in a `finally`
 * whatever happens. Nothing in this module writes, and a test fails the build
 * if a write call appears anywhere in `src/main/linkedFolders/` (task 8).
 *
 * Reading never throws. A file that cannot be opened is a result with a
 * reason, so one bad file never stops a folder being read (Requirement 2.8).
 */

export const OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;

export const FILE_REASON = {
  gone: 'The file is no longer there',
  denied: 'macOS did not allow TrailRT to read this file',
  symlink: 'The file is a symbolic link, which TrailRT does not follow',
  directory: 'This is a folder, not a photo',
  other: 'The file could not be read',
} as const;

function reasonFor(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'ENOENT':
      return FILE_REASON.gone;
    case 'EACCES':
    case 'EPERM':
      return FILE_REASON.denied;
    case 'ELOOP': // what O_NOFOLLOW gives for a symbolic link
      return FILE_REASON.symlink;
    case 'EISDIR':
      return FILE_REASON.directory;
    default:
      return FILE_REASON.other;
  }
}

export interface PhotoFileRead {
  result: PhotoReadResult;
  /**
   * `SHA-256(size as 8 bytes ‖ first 64 KB)`, hex (design §5.3), from the
   * bytes the metadata read already fetched. `null` when nothing was read.
   */
  fingerprint: string | null;
}

/** The first read every container makes. Smaller files are read whole. */
const HEAD_BYTES = 64 * 1024;

function fingerprintOf(size: number, head: Uint8Array): string {
  const prefix = new Uint8Array(8);
  new DataView(prefix.buffer).setBigUint64(0, BigInt(size), false);
  return createHash('sha256').update(prefix).update(head).digest('hex');
}

function fail(reason: string): PhotoFileRead {
  return { result: { ok: false, reason }, fingerprint: null };
}

/**
 * Reads a photo's metadata through `reader`, from the file at `path`. `path`
 * must already have been resolved and checked to lie inside a linked folder
 * by the caller (the scanner, or `resolve.ts` from task 8).
 */
export async function readPhotoFile(path: string, format: PhotoFormat, reader: PhotoMetadataReader): Promise<PhotoFileRead> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(path, OPEN_FLAGS);
    const stats = await handle.stat();
    if (!stats.isFile()) return fail(FILE_REASON.directory);
    const file = handle;
    let head: Uint8Array | null = null;
    const ranges: RangeReader = {
      size: stats.size,
      async read(offset, length) {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, stats.size - offset)));
        let filled = 0;
        // `read` may return fewer bytes than asked; keep going until the range
        // is full or the file ends.
        while (filled < buffer.length) {
          const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, offset + filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        const bytes = buffer.subarray(0, filled);
        if (offset === 0 && head === null) head = bytes.subarray(0, Math.min(HEAD_BYTES, bytes.length));
        return bytes;
      },
    };
    const result = await reader.read(ranges, format);
    return { result, fingerprint: head === null ? null : fingerprintOf(stats.size, head) };
  } catch (error) {
    return fail(reasonFor(error));
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
