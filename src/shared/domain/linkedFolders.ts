/**
 * Linked folders, their file index and the photos read from them. Phase 11,
 * design §2 and ADR 0020.
 *
 * A linked folder is the trip's folder on disk. The app indexes every file of a
 * kind it recognises. In Phase 11 it reads only photos, and later phases add
 * GPX (Phase 12) and video (Phase 13) on the same index.
 */

export type FolderFileKind = 'photo' | 'geodata' | 'video';

export type FolderFileFormat =
  | 'jpeg'
  | 'heic'
  | 'gpx'
  | 'kml'
  | 'kmz'
  | 'tcx'
  | 'fit'
  | 'mov'
  | 'mp4'
  | 'm4v';

export type PhotoState = 'located' | 'unlocated' | 'unreadable' | 'not-downloaded';

export const PHOTO_STATES: readonly PhotoState[] = ['located', 'unlocated', 'unreadable', 'not-downloaded'];

export interface LinkedFolder {
  id: string;
  tripId: string;
  /** Absolute, as chosen. Main process only: never sent to the renderer to be read. */
  path: string;
  /** `realpath`, NFC. For containment checks and all-trips de-duplication. */
  realPath: string;
  /** Basename at link time, for display. */
  name: string;
  includeSubfolders: boolean;
  lastScanAt: number | null;
  lastSeenAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** One row of a folder's file index. */
export interface IndexedFile {
  id: string;
  folderId: string;
  /** POSIX separators, NFC. The file's identity within its folder. */
  relativePath: string;
  kind: FolderFileKind;
  format: FolderFileFormat;
  sizeBytes: number;
  mtimeMs: number;
  /** Design §5.3. `null` until the file has been read. */
  fingerprint: string | null;
}

/** What was read from a photo. A cache, rebuilt from the file. */
export interface PhotoMetadata {
  state: PhotoState;
  /** Why unlocated, unreadable or not downloaded; `null` when located. */
  reason: string | null;
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  accuracyM: number | null;
  directionDeg: number | null;
  directionRef: 'T' | 'M' | null;
  /** `YYYY-MM-DDTHH:MM:SS`, the wall clock as recorded. */
  takenLocal: string | null;
  /** Minutes east of UTC; `null` is camera time with no zone. */
  takenOffsetMin: number | null;
  orientation: number | null;
}

/** A photo as the list and the preview see it: its index row and its metadata. */
export interface Photo extends IndexedFile, PhotoMetadata {
  kind: 'photo';
}

/**
 * Located photos for the map, column by column so 50,000 of them stay small
 * over IPC (design §9.1). `folder[i]` indexes `folders`. A missing direction is
 * `null`, never a sentinel number.
 */
export interface PhotoMapPoints {
  ids: string[];
  lat: Float64Array;
  lon: Float64Array;
  folder: Uint32Array;
  folders: string[];
  dir: (number | null)[];
}

/** Which located photos the map wants (design §9.1). */
export type PhotoMapScope =
  | { tripId: string }
  | { all: true; includeArchived: boolean; year?: number | 'none'; tripId?: string };

// ------------------------------------------------------------ scanning

export type ScanPhase = 'walking' | 'reading';

export interface ScanProgress {
  folderId: string;
  phase: ScanPhase;
  /** Files found so far. */
  seen: number;
  /** Photos read so far, in the reading phase. */
  read: number;
  /** Photos to read, once the walk has finished. */
  total?: number;
}

export interface SkippedCounts {
  hidden: number;
  packages: number;
  symlinks: number;
  /** Subfolders left out because Include subfolders is off. */
  subfolders: number;
  /** Image formats not read yet, by upper-case extension. */
  unsupported: Record<string, number>;
  /** Subfolders macOS would not list. Their files are kept as they were. */
  unreadableFolders: number;
}

export type ScanOutcome =
  | {
      status: 'complete';
      added: number;
      changed: number;
      removed: number;
      moved: number;
      unchanged: number;
      skipped: SkippedCounts;
    }
  /** The walk could not finish. Nothing was deleted; what was read was kept. */
  | { status: 'partial'; reason: string; skipped: SkippedCounts }
  | { status: 'missing' }
  | { status: 'denied' }
  | { status: 'cancelled' };

/** A folder's state at runtime. Never stored: it would be wrong the moment a drive came back. */
export type FolderState = 'available' | 'scanning' | 'missing' | 'denied';

/**
 * A linked folder as the library and properties see it (design §7.1). The
 * path is for display only; the renderer never sends a path back.
 */
export interface LinkedFolderSummary {
  id: string;
  tripId: string;
  name: string;
  displayPath: string;
  includeSubfolders: boolean;
  lastScanAt: number | null;
  /** Files indexed, by kind. GPX and video are counted, not read, in Phase 11. */
  files: Record<FolderFileKind, number>;
  photos: Record<PhotoState, number>;
  /** `null` before the scanner has started. */
  state: FolderState | null;
  progress: ScanProgress | null;
  lastOutcome: ScanOutcome | null;
}

/** One photo for the preview: its row, and where it belongs. */
export interface PhotoDetails {
  photo: Photo;
  folderName: string;
  tripId: string;
}

/** Years with photos for the Photos view filter (design §8.2). */
export interface PhotoYears {
  years: { year: number; count: number }[];
  noDate: number;
}

/** A folder the user picked, checked and held under a token (design §4.1). */
export interface ChosenFolder {
  token: string;
  name: string;
  /** For display only. */
  displayPath: string;
  warnings: string[];
}

/** A preview thumbnail as bytes; the renderer makes a `blob:` URL (design §6.3). */
export interface PhotoThumbnail {
  bytes: Uint8Array;
  width: number;
  height: number;
  /**
   * Served from the cache because the photo itself could not be reached
   * (unavailable, or not downloaded). It may be of an older version.
   */
  fromCache?: true;
}
