import type { FolderFileFormat, FolderFileKind } from '@shared/domain/linkedFolders';

/**
 * Which files in a linked folder the index records. Phase 11, design §3.1.
 *
 * By extension, case-insensitively. A photo's signature is checked when it is
 * read (`containers.ts`), so a misnamed file is listed as unreadable rather
 * than trusted. GPX, other track files and video are recorded for Phases 12
 * and 13 and never opened in this phase (Requirement 3.8). This is the one
 * place those phases extend.
 */

const KNOWN: Readonly<Record<string, { kind: FolderFileKind; format: FolderFileFormat }>> = {
  jpg: { kind: 'photo', format: 'jpeg' },
  jpeg: { kind: 'photo', format: 'jpeg' },
  heic: { kind: 'photo', format: 'heic' },
  gpx: { kind: 'geodata', format: 'gpx' },
  kml: { kind: 'geodata', format: 'kml' },
  kmz: { kind: 'geodata', format: 'kmz' },
  tcx: { kind: 'geodata', format: 'tcx' },
  fit: { kind: 'geodata', format: 'fit' },
  mov: { kind: 'video', format: 'mov' },
  mp4: { kind: 'video', format: 'mp4' },
  m4v: { kind: 'video', format: 'm4v' },
};

/**
 * Image formats that are counted and named but not read until they have been
 * tested against real files (Requirement 2.2), so the folder can say what it
 * left out rather than hide it.
 */
const UNSUPPORTED_IMAGES = new Set(['png', 'tif', 'tiff', 'heif', 'webp', 'gif', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf']);

/** macOS package directories: walked by nobody, and one of them is a Photos library. */
const PACKAGE_SUFFIXES = ['.app', '.photoslibrary', '.photolibrary', '.aplibrary', '.bundle', '.pkg', '.lrdata', '.framework'];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function classify(name: string): { kind: FolderFileKind; format: FolderFileFormat } | null {
  return KNOWN[extensionOf(name)] ?? null;
}

/** The extension, upper case, when `name` is an image format not read yet. */
export function unsupportedImage(name: string): string | null {
  const ext = extensionOf(name);
  return UNSUPPORTED_IMAGES.has(ext) ? ext.toUpperCase() : null;
}

export function isPackage(directoryName: string): boolean {
  const lower = directoryName.toLowerCase();
  return PACKAGE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * iCloud Drive's legacy placeholder for a file not on this Mac:
 * `.IMG_0001.HEIC.icloud` stands for `IMG_0001.HEIC`. Returns the real name.
 */
export function icloudPlaceholderFor(name: string): string | null {
  if (!name.startsWith('.') || !name.endsWith('.icloud') || name.length <= '..icloud'.length) return null;
  return name.slice(1, -'.icloud'.length);
}
