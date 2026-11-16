import { copyFileSync, readdirSync, rmSync, statfsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import type { BackupEntry } from '@shared/ipc/api';
import type { DbHandle } from '../db/client';
import { expectedSchemaVersion } from '../db/migrate';
import { ServiceError } from './errors';

/**
 * Backup and restore.
 *
 * Uses SQLite's own backup API rather than copying the file. Under WAL the main
 * database file alone is not a consistent snapshot — recent commits live in the
 * `-wal` sidecar — so `cp` can produce a backup that silently loses data or
 * refuses to open.
 */

const PREFIX = 'trailrt-backup-';
const SUFFIX = '.db';

/** Room left on the disk after a backup, so a backup never fills it. */
export const FREE_SPACE_MARGIN_BYTES = 1024 ** 3;

/** How many backups to keep, and how much space they may use together. */
export interface BackupLimits {
  retention: number;
  maxBytes: number;
}

/**
 * Which backups to remove, newest first in `entries` (Phase 14 Requirement
 * 24). Walking from the newest, a backup is kept while both the count and the
 * total size fit. The newest is always kept, even when it alone is over the
 * size limit, because a library larger than the limit must still have one
 * backup. A protected file, such as the one a restore is reading, is never
 * removed and counts towards both limits.
 */
export function planPrune(
  entries: readonly BackupEntry[],
  limits: BackupLimits,
  protect: ReadonlySet<string> = new Set(),
): string[] {
  const keepCount = Math.max(1, limits.retention);
  let kept = 0;
  let bytes = 0;
  const remove: string[] = [];
  for (const entry of entries) {
    const fits = kept === 0 || (kept < keepCount && bytes + entry.byteSize <= limits.maxBytes);
    if (fits || protect.has(entry.fileName)) {
      kept += 1;
      bytes += entry.byteSize;
    } else {
      remove.push(entry.fileName);
    }
  }
  return remove;
}

function removeFiles(backupsDir: string, fileNames: readonly string[]): string[] {
  const removed: string[] = [];
  for (const fileName of fileNames) {
    try {
      rmSync(join(backupsDir, fileName), { force: true });
      removed.push(fileName);
    } catch {
      // A backup that will not delete is not worth failing the operation over;
      // the next prune will try again.
    }
  }
  return removed;
}

/** The live database's size on disk, with its write-ahead log: what a backup will roughly need. */
function databaseBytes(databaseFile: string): number {
  let total = 0;
  for (const file of [databaseFile, `${databaseFile}-wal`]) {
    try {
      total += statSync(file).size;
    } catch {
      // No WAL yet.
    }
  }
  return total;
}

function freeBytes(dir: string): number | null {
  try {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

function gb(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** Tables a candidate file must have before we will restore over live data. */
const REQUIRED_TABLES = ['trips', 'folders', 'settings', 'schema_migrations'];

function backupFileName(at: Date): string {
  // Sortable, filesystem-safe, no colons.
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  return `${PREFIX}${stamp}${SUFFIX}`;
}

export function listBackups(backupsDir: string): BackupEntry[] {
  let names: string[];
  try {
    names = readdirSync(backupsDir);
  } catch {
    return [];
  }

  return names
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
    .map((fileName) => {
      const stat = statSync(join(backupsDir, fileName));
      return {
        fileName,
        createdAt: stat.mtimeMs,
        byteSize: stat.size,
      };
    })
    .toSorted((a, b) => b.createdAt - a.createdAt);
}

/**
 * Writes a consistent snapshot. `backup()` is async in better-sqlite3 because
 * it yields between pages rather than blocking the event loop on a large file.
 */
export async function createBackup(
  handle: DbHandle,
  backupsDir: string,
  limits: BackupLimits,
  options: { databaseFile?: string; protect?: ReadonlySet<string> } = {},
): Promise<BackupEntry> {
  const fileName = backupFileName(new Date());
  const target = join(backupsDir, fileName);
  const protect = options.protect ?? new Set<string>();

  // Make room first, as if the new backup were already the newest, but keep
  // the newest existing one until the new one is safely written.
  if (options.databaseFile !== undefined) {
    const expected = databaseBytes(options.databaseFile);
    const existing = listBackups(backupsDir);
    const newest = existing[0]?.fileName;
    const planned = planPrune([{ fileName, createdAt: Date.now(), byteSize: expected }, ...existing], limits, protect);
    removeFiles(backupsDir, planned.filter((name) => name !== newest));

    // Never fill the disk: a full disk stops the app saving anything at all.
    const free = freeBytes(backupsDir);
    if (free !== null && free < expected + FREE_SPACE_MARGIN_BYTES) {
      throw new ServiceError(
        'IO_ERROR',
        `There is not enough free disk space for a backup. It needs about ${gb(expected)}, and ${gb(FREE_SPACE_MARGIN_BYTES)} is kept free; ${gb(free)} is free now.`,
      );
    }
  }

  await handle.sqlite.backup(target);
  // The backup just written is never pruned by its own clean-up, whatever the
  // dates on the files around it say (a clock change, a copy from elsewhere).
  pruneBackups(backupsDir, limits, new Set([...protect, fileName]));

  const stat = statSync(target);
  return { fileName, createdAt: stat.mtimeMs, byteSize: stat.size };
}

/** Writes a snapshot to an arbitrary path the user chose. */
export async function createBackupAt(
  handle: DbHandle,
  targetPath: string,
): Promise<void> {
  await handle.sqlite.backup(targetPath);
}

/** Applies `planPrune` to the backups folder. Returns what was removed. */
export function pruneBackups(
  backupsDir: string,
  limits: BackupLimits,
  protect: ReadonlySet<string> = new Set(),
): string[] {
  return removeFiles(backupsDir, planPrune(listBackups(backupsDir), limits, protect));
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  schemaVersion?: number;
}

/**
 * Opens a candidate read-only and checks it looks like a TrailRT database
 * before anything destructive happens. Requirement 9.4.
 */
export function validateBackupFile(filePath: string): ValidationResult {
  let probe: Database.Database | undefined;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });

    const tables = new Set(
      (
        probe
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((r) => r.name),
    );

    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `This file is not a TrailRT backup. Missing: ${missing.join(', ')}.`,
      };
    }

    const row = probe
      .prepare('SELECT max(version) AS v FROM schema_migrations')
      .get() as { v: number | null };
    const version = row.v ?? 0;

    if (version > expectedSchemaVersion()) {
      return {
        valid: false,
        reason: `This backup was made by a newer version of TrailRT (schema ${version}, this build understands ${expectedSchemaVersion()}). Update the app before restoring.`,
        schemaVersion: version,
      };
    }

    return { valid: true, schemaVersion: version };
  } catch (cause) {
    return {
      valid: false,
      reason: `That file could not be opened as a database: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    };
  } finally {
    probe?.close();
  }
}

export interface RestoreOutcome {
  /** Snapshot of the pre-restore database, so the user can undo the restore. */
  safetyBackup: string;
}

/**
 * Restores a backup over the live database.
 *
 * Order matters: validate, snapshot the current database, close it, then swap.
 * A failure at any step leaves the current database untouched.
 *
 * The caller must reopen the database afterwards; this function deliberately
 * leaves it closed rather than returning a half-live handle.
 */
export async function restoreBackup(options: {
  handle: DbHandle;
  databaseFile: string;
  backupsDir: string;
  fileName: string;
  limits: BackupLimits;
}): Promise<RestoreOutcome> {
  const source = join(options.backupsDir, basename(options.fileName));

  const validation = validateBackupFile(source);
  if (!validation.valid) {
    throw new ServiceError(
      'INVALID_REQUEST',
      validation.reason ?? 'That backup file is not valid.',
    );
  }

  // Snapshot first. If anything below fails the user still has this. The
  // backup being restored is protected: making room for the safety copy must
  // never delete the file about to be read.
  const safety = await createBackup(
    options.handle,
    options.backupsDir,
    { retention: options.limits.retention + 1, maxBytes: options.limits.maxBytes },
    { databaseFile: options.databaseFile, protect: new Set([basename(options.fileName)]) },
  );

  options.handle.close();

  try {
    copyFileSync(source, options.databaseFile);
    // The old WAL and shared-memory sidecars describe the replaced file and
    // would corrupt the restored one if SQLite found them.
    rmSync(`${options.databaseFile}-wal`, { force: true });
    rmSync(`${options.databaseFile}-shm`, { force: true });
  } catch (cause) {
    throw new ServiceError(
      'IO_ERROR',
      'The backup could not be written over the current database. Your previous data is still in the backups folder.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  return { safetyBackup: safety.fileName };
}
