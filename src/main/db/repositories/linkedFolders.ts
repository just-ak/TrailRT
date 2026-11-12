import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import type { LinkedFolder } from '@shared/domain/linkedFolders';
import type { Db } from '../client';
import { folderFiles, linkedFolders, photoMetadata } from '../schema';

/**
 * Storage for linked folders. Phase 11, design §2.
 *
 * Plain reads and writes. Refusals, undo and scanning live in
 * `services/linkedFolderService.ts` and `linkedFolders/` (tasks 6 and 7).
 */

function rowToFolder(row: typeof linkedFolders.$inferSelect): LinkedFolder {
  return {
    id: row.id,
    tripId: row.tripId,
    path: row.path,
    realPath: row.realPath,
    name: row.name,
    includeSubfolders: row.includeSubfolders,
    lastScanAt: row.lastScanAt ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface InsertLinkedFolderValues {
  /** Given when undo restores a folder under its old id (design §4.4). */
  id?: string;
  tripId: string;
  path: string;
  realPath: string;
  name: string;
  includeSubfolders: boolean;
  lastScanAt?: number | null;
  lastSeenAt?: number | null;
  createdAt?: number;
  now: number;
}

export function insertLinkedFolder(db: Db, values: InsertLinkedFolderValues): LinkedFolder {
  const row = db
    .insert(linkedFolders)
    .values({
      id: values.id ?? randomUUID(),
      tripId: values.tripId,
      path: values.path,
      realPath: values.realPath,
      name: values.name,
      includeSubfolders: values.includeSubfolders,
      lastScanAt: values.lastScanAt ?? null,
      lastSeenAt: values.lastSeenAt ?? null,
      createdAt: values.createdAt ?? values.now,
      updatedAt: values.now,
    })
    .returning()
    .get();
  return rowToFolder(row);
}

export function findLinkedFolder(db: Db, id: string): LinkedFolder | null {
  const row = db.select().from(linkedFolders).where(eq(linkedFolders.id, id)).get();
  return row === undefined ? null : rowToFolder(row);
}

/** Every linked folder, or one trip's, oldest link first. */
export function listLinkedFolders(db: Db, tripId?: string): LinkedFolder[] {
  const query = db.select().from(linkedFolders);
  const rows = (tripId === undefined ? query : query.where(eq(linkedFolders.tripId, tripId)))
    .orderBy(asc(linkedFolders.createdAt), asc(linkedFolders.id))
    .all();
  return rows.map(rowToFolder);
}

export interface LinkedFolderPatch {
  path?: string;
  realPath?: string;
  name?: string;
  includeSubfolders?: boolean;
  lastScanAt?: number | null;
  lastSeenAt?: number | null;
}

export function updateLinkedFolder(db: Db, id: string, patch: LinkedFolderPatch, now: number): LinkedFolder | null {
  const row = db
    .update(linkedFolders)
    .set({ ...patch, updatedAt: now })
    .where(eq(linkedFolders.id, id))
    .returning()
    .get();
  return row === undefined ? null : rowToFolder(row);
}

/** Deletes the folder row; its index and metadata go with it by cascade. */
export function deleteLinkedFolder(db: Db, id: string): boolean {
  return db.delete(linkedFolders).where(eq(linkedFolders.id, id)).run().changes > 0;
}

/** Every linked folder's real path and name, for the write guard. */
export function allRealPaths(db: Db): { realPath: string; name: string }[] {
  return db.select({ realPath: linkedFolders.realPath, name: linkedFolders.name }).from(linkedFolders).all();
}

/**
 * Copies a trip's folder links, file index and photo metadata to another
 * trip, under new ids (design §4.4). For trip duplication, inside its
 * transaction. No file is touched.
 */
export function copyLinkedFoldersForTrip(db: Db, fromTripId: string, toTripId: string, now: number): void {
  for (const folder of listLinkedFolders(db, fromTripId)) {
    const copy = insertLinkedFolder(db, {
      tripId: toTripId,
      path: folder.path,
      realPath: folder.realPath,
      name: folder.name,
      includeSubfolders: folder.includeSubfolders,
      lastScanAt: folder.lastScanAt,
      lastSeenAt: folder.lastSeenAt,
      now,
    });
    const files = db.select().from(folderFiles).where(eq(folderFiles.folderId, folder.id)).all();
    const newId = new Map(files.map((file) => [file.id, randomUUID()]));
    for (let i = 0; i < files.length; i += 500) {
      const batch = files.slice(i, i + 500);
      // Read the originals' metadata before the rows are re-pointed below.
      const metadata = db
        .select()
        .from(photoMetadata)
        .where(inArray(photoMetadata.fileId, batch.map((file) => file.id)))
        .all();
      // The rows are fresh query results, so they are re-pointed in place.
      for (const file of batch) {
        file.id = newId.get(file.id) ?? randomUUID();
        file.folderId = copy.id;
      }
      db.insert(folderFiles).values(batch).run();
      for (const row of metadata) row.fileId = newId.get(row.fileId) ?? row.fileId;
      if (metadata.length > 0) db.insert(photoMetadata).values(metadata).run();
    }
  }
}
