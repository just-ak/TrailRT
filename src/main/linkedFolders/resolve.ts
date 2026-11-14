import { realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize, sep } from 'node:path';
import type { IndexedFile, LinkedFolder } from '@shared/domain/linkedFolders';
import type { Db } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { ServiceError } from '../services/errors';
import { isWithin } from '../services/linkedFolderService';

/**
 * The only way a file in a linked folder becomes a path the app acts on.
 * Phase 11, design §7.2.
 *
 * Thumbnails, "Open" and "Show in Finder" all start from a file id the
 * renderer sent, never a path, and come through here. The path is rebuilt from
 * the folder row and the index, then both are resolved on disk, and the file
 * must still be inside the folder. A relative path is written only by the
 * scanner, but an escape with `..` is refused anyway, as is a symbolic link
 * that has appeared since the scan and points out (Requirement 8.2).
 *
 * Nothing here writes. It only reads paths, which the source scan in
 * `readOnly.test.ts` checks.
 */

export const RESOLVE_REFUSAL = {
  notFound: 'That file is no longer in the folder’s index. Rescan the folder.',
  outside: 'That file is outside its linked folder, so TrailRT will not open it.',
  gone: 'That file is no longer in the folder. It may have been moved or deleted. Rescan the folder.',
  denied:
    'macOS has not given TrailRT access to this folder. Allow it in System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then rescan.',
  folderUnavailable: (name: string): string =>
    `${name} is not available. It may have been moved, renamed or disconnected.`,
} as const;

/** The folder's state at runtime, from the scanner. `null` when it is not tracking the folder. */
export type FolderStateOf = (folderId: string) => 'available' | 'scanning' | 'missing' | 'denied' | null;

export interface ResolvedFile {
  /** Real, NFC. Safe to hand to Quick Look and the shell. */
  path: string;
  file: IndexedFile;
  folder: LinkedFolder;
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/**
 * Refuses a relative path that is absolute, or that leaves its folder once
 * normalised. Pure, so it is tested on its own.
 */
export function safeRelative(relativePath: string): string | null {
  if (relativePath.length === 0 || relativePath.includes('\u0000')) return null;
  if (isAbsolute(relativePath)) return null;
  const normal = normalize(relativePath);
  if (normal === '..' || normal.startsWith(`..${sep}`) || normal === '.') return null;
  return normal;
}

export async function resolveFilePath(db: Db, fileId: string, stateOf: FolderStateOf = () => null): Promise<ResolvedFile> {
  const file = filesRepo.findFile(db, fileId);
  if (file === null) throw new ServiceError('NOT_FOUND', RESOLVE_REFUSAL.notFound);
  const folder = foldersRepo.findLinkedFolder(db, file.folderId);
  if (folder === null) throw new ServiceError('NOT_FOUND', RESOLVE_REFUSAL.notFound);

  const state = stateOf(folder.id);
  if (state === 'missing') throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.folderUnavailable(folder.name));
  if (state === 'denied') throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.denied);

  const relative = safeRelative(file.relativePath);
  if (relative === null) throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.outside);

  let folderReal: string;
  try {
    folderReal = (await realpath(folder.path)).normalize('NFC');
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EPERM' || code === 'EACCES') throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.denied);
    throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.folderUnavailable(folder.name));
  }

  let fileReal: string;
  try {
    fileReal = (await realpath(join(folder.path, relative))).normalize('NFC');
  } catch (error) {
    const code = codeOf(error);
    if (code === 'EPERM' || code === 'EACCES') throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.denied);
    throw new ServiceError('NOT_FOUND', RESOLVE_REFUSAL.gone);
  }

  // `isWithin` accepts the folder itself; a file id never names the folder.
  if (fileReal === folderReal || !isWithin(fileReal, folderReal)) {
    throw new ServiceError('BLOCKED', RESOLVE_REFUSAL.outside);
  }
  return { path: fileReal, file, folder };
}
