import { exifReader } from '@shared/photos/exifReader';
import type { Db } from '../db/client';
import { FolderScanner, type ScannerEvent } from './folderScanner';

/**
 * The app's one folder scanner. Phase 11, design §5.6.
 *
 * Started after the main window has shown, so launch never waits on a scan
 * (Requirement 9.5): the map reads the index already in the database. Other
 * modules call `reconcileFolders()` after anything that may have added,
 * removed or moved a folder row; it does nothing before the scanner starts.
 */

let scanner: FolderScanner | null = null;

export function startFolderScanner(options: { db: () => Db; emit?: (event: ScannerEvent) => void }): FolderScanner {
  scanner?.stop();
  scanner = new FolderScanner({ db: options.db, reader: exifReader, ...(options.emit === undefined ? {} : { emit: options.emit }) });
  scanner.reconcile();
  return scanner;
}

export function folderScanner(): FolderScanner | null {
  return scanner;
}

export function reconcileFolders(): void {
  scanner?.reconcile();
}

export function stopFolderScanner(): void {
  scanner?.stop();
  scanner = null;
}
