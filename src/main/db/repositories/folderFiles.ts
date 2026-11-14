import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FolderFileFormat, FolderFileKind, IndexedFile } from '@shared/domain/linkedFolders';
import type { Db } from '../client';
import { folderFiles } from '../schema';

/**
 * Storage for the file index. Phase 11, design §2 and §5.2.
 *
 * The scanner compares what it finds on disk with `indexOf`, writes what
 * changed with `upsertFile`, and only after a complete walk removes what is
 * gone with `deleteMissing`.
 */

function rowToFile(row: typeof folderFiles.$inferSelect): IndexedFile {
  return {
    id: row.id,
    folderId: row.folderId,
    relativePath: row.relativePath,
    kind: row.kind as FolderFileKind,
    format: row.format as FolderFileFormat,
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs,
    fingerprint: row.fingerprint ?? null,
  };
}

/** A folder's index keyed by relative path, for the scanner's comparison. */
export function indexOf(db: Db, folderId: string): Map<string, IndexedFile> {
  const rows = db.select().from(folderFiles).where(eq(folderFiles.folderId, folderId)).all();
  return new Map(rows.map((row) => [row.relativePath, rowToFile(row)]));
}

export function findFile(db: Db, id: string): IndexedFile | null {
  const row = db.select().from(folderFiles).where(eq(folderFiles.id, id)).get();
  return row === undefined ? null : rowToFile(row);
}

export interface UpsertFileValues {
  folderId: string;
  relativePath: string;
  kind: FolderFileKind;
  format: FolderFileFormat;
  sizeBytes: number;
  mtimeMs: number;
  fingerprint: string | null;
}

/**
 * Inserts or updates the row for `(folderId, relativePath)`. An existing row
 * keeps its id, so its metadata and thumbnail stay attached to it.
 */
export function upsertFile(db: Db, values: UpsertFileValues): IndexedFile {
  const row = db
    .insert(folderFiles)
    .values({ id: randomUUID(), ...values })
    .onConflictDoUpdate({
      target: [folderFiles.folderId, folderFiles.relativePath],
      set: {
        kind: values.kind,
        format: values.format,
        sizeBytes: values.sizeBytes,
        mtimeMs: values.mtimeMs,
        fingerprint: values.fingerprint,
      },
    })
    .returning()
    .get();
  return rowToFile(row);
}

/** SQLite's default limit on bound parameters is far above this; it keeps statements small. */
const BATCH = 500;

/**
 * Deletes every row of the folder whose path is not in `keepPaths`, in one
 * transaction. Only a walk that finished may call this: a partial walk would
 * delete files it never reached (design §5.2). Returns the number deleted.
 */
export function deleteMissing(db: Db, folderId: string, keepPaths: ReadonlySet<string>): number {
  const gone = db
    .select({ id: folderFiles.id, relativePath: folderFiles.relativePath })
    .from(folderFiles)
    .where(eq(folderFiles.folderId, folderId))
    .all()
    .filter((row) => !keepPaths.has(row.relativePath))
    .map((row) => row.id);
  if (gone.length === 0) return 0;
  db.transaction((tx) => {
    for (let i = 0; i < gone.length; i += BATCH) {
      tx.delete(folderFiles).where(inArray(folderFiles.id, gone.slice(i, i + BATCH))).run();
    }
  });
  return gone.length;
}

/**
 * Moves a row to a new path within its folder, keeping its id, metadata and
 * thumbnail: a photo the scanner recognised as moved or renamed (design §5.3).
 */
export function movePath(db: Db, id: string, relativePath: string, sizeBytes: number, mtimeMs: number): boolean {
  return (
    db.update(folderFiles).set({ relativePath, sizeBytes, mtimeMs }).where(eq(folderFiles.id, id)).run().changes > 0
  );
}

export function deleteFile(db: Db, id: string): boolean {
  return db.delete(folderFiles).where(eq(folderFiles.id, id)).run().changes > 0;
}

/** Rows in any of `folderIds` with this fingerprint. */
export function findByFingerprint(db: Db, folderIds: readonly string[], fingerprint: string): IndexedFile[] {
  if (folderIds.length === 0) return [];
  return db
    .select()
    .from(folderFiles)
    .where(and(inArray(folderFiles.folderId, [...folderIds]), eq(folderFiles.fingerprint, fingerprint)))
    .all()
    .map(rowToFile);
}

export function countsByKind(db: Db, folderId: string): Record<FolderFileKind, number> {
  const counts: Record<FolderFileKind, number> = { photo: 0, geodata: 0, video: 0 };
  const rows = db
    .select({ kind: folderFiles.kind, n: sql<number>`count(*)` })
    .from(folderFiles)
    .where(eq(folderFiles.folderId, folderId))
    .groupBy(folderFiles.kind)
    .all();
  for (const row of rows) counts[row.kind as FolderFileKind] = row.n;
  return counts;
}
