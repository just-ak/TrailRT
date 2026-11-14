import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Db } from '../db/client';
import { allRealPaths } from '../db/repositories/linkedFolders';
import { ServiceError } from '../services/errors';
import { isWithin } from '../services/linkedFolderService';

/**
 * TrailRT never writes into a linked folder (Phase 11 Requirement 8.1, design
 * §7.3, ADR 0020 §5). Every handler that writes to a path the user chose calls
 * this first: export, Save a Copy, calendar export and Save image.
 *
 * The target usually does not exist yet, so its parent folder is resolved
 * instead, which also catches a symlinked or differently-cased spelling of a
 * linked folder. Nothing here writes: it only reads paths.
 */
export const IN_LINKED_FOLDER = (name: string): string =>
  `That folder is linked to a trip (${name}), and TrailRT never writes into a linked folder. Choose somewhere else.`;

async function resolveTarget(target: string): Promise<string> {
  try {
    return (await realpath(target)).normalize('NFC');
  } catch {
    // Not there yet: resolve its folder and put the name back.
    try {
      return join(await realpath(dirname(target)), basename(target)).normalize('NFC');
    } catch {
      return target.normalize('NFC');
    }
  }
}

export async function assertNotInLinkedFolder(db: Db, target: string): Promise<void> {
  const real = await resolveTarget(target);
  for (const folder of allRealPaths(db)) {
    if (isWithin(real, folder.realPath)) throw new ServiceError('BLOCKED', IN_LINKED_FOLDER(folder.name));
  }
}
