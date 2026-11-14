import type {
  LinkedFolderSummary,
  Photo,
  PhotoDetails,
  PhotoMapPoints,
  PhotoMapScope,
  PhotoYears,
} from '@shared/domain/linkedFolders';
import type { Db } from '../db/client';
import * as filesRepo from '../db/repositories/folderFiles';
import * as foldersRepo from '../db/repositories/linkedFolders';
import * as photosRepo from '../db/repositories/photoMetadata';
import type { FolderRuntime } from '../linkedFolders/folderScanner';
import { notFound } from './errors';

/**
 * Reading linked folders and their photos for the renderer. Phase 11, design
 * §7.1. Nothing here touches the disk: it answers from the index, so the
 * library and the map never wait on a scan (Requirement 9.5).
 */

export type RuntimeOf = (folderId: string) => FolderRuntime | null;

export function folderSummaries(db: Db, tripId: string | undefined, runtimeOf: RuntimeOf): LinkedFolderSummary[] {
  return foldersRepo.listLinkedFolders(db, tripId).map((folder) => {
    const runtime = runtimeOf(folder.id);
    return {
      id: folder.id,
      tripId: folder.tripId,
      name: folder.name,
      displayPath: folder.realPath,
      includeSubfolders: folder.includeSubfolders,
      lastScanAt: folder.lastScanAt,
      files: filesRepo.countsByKind(db, folder.id),
      photos: photosRepo.countsByState(db, folder.id),
      state: runtime?.state ?? null,
      progress: runtime?.progress ?? null,
      lastOutcome: runtime?.lastOutcome ?? null,
    };
  });
}

/** A folder's photos in taken-time order, undated last (design §8.3). */
export function listPhotos(db: Db, folderId: string): Photo[] {
  if (foldersRepo.findLinkedFolder(db, folderId) === null) throw notFound('That linked folder');
  return photosRepo.listPhotos(db, folderId);
}

/** Every photo of a trip's linked folders, in taken order (Phase 14). */
export function listForTrip(db: Db, tripId: string): Photo[] {
  return photosRepo.listPhotosForTrip(db, tripId);
}

export function details(db: Db, photoId: string): PhotoDetails {
  const photo = photosRepo.findPhoto(db, photoId);
  if (photo === null) throw notFound('That photo');
  const folder = foldersRepo.findLinkedFolder(db, photo.folderId);
  if (folder === null) throw notFound('That photo');
  return { photo, folderName: folder.name, tripId: folder.tripId };
}

export function mapPoints(db: Db, scope: PhotoMapScope): PhotoMapPoints {
  return photosRepo.mapPoints(db, scope);
}

export function years(db: Db, includeArchived: boolean): PhotoYears {
  return photosRepo.photoYears(db, includeArchived);
}
