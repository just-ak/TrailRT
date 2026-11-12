import type { FolderFileKind, FolderState, Photo, PhotoState } from '../domain/linkedFolders';

/**
 * What the library, the properties panel and the photo list say about linked
 * folders and their photos. Phase 11, design §8. Pure, so every wording is
 * tested without a window.
 */

export const LINKED_FOLDERS_GROUP = 'Linked folders';

/** Explains a day count that relied on the camera's clock (design §8.4). */
export const CAMERA_TIME_HINT =
  'Some of these photos record no time zone, so they are counted on the date their camera showed. That assumes the camera clock was set to local time.';

export const STATE_TEXT: Record<FolderState, string> = {
  available: 'Available',
  scanning: 'Scanning…',
  missing: 'Unavailable: it may have been moved, renamed or disconnected',
  denied: 'No access: allow it in System Settings › Privacy & Security',
};

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}

export function totalPhotos(counts: Record<PhotoState, number>): number {
  return counts.located + counts.unlocated + counts.unreadable + counts['not-downloaded'];
}

/**
 * A linked folder's tree row detail: "312 photos · 18 without location",
 * "· unavailable" or "· no access" when the folder is not there, and
 * "· scanning" while it is read. Files this phase does not read (GPX, video)
 * are left to the properties panel, so the tree stays short.
 */
export function folderDetail(counts: Record<PhotoState, number>, state: FolderState | null): string {
  const total = totalPhotos(counts);
  const parts = [total === 0 ? 'no photos' : plural(total, 'photo')];
  const unplaced = total - counts.located;
  if (unplaced > 0) parts.push(`${unplaced.toLocaleString('en-GB')} without location`);
  if (state === 'missing') parts.push('unavailable');
  else if (state === 'denied') parts.push('no access');
  else if (state === 'scanning') parts.push('scanning');
  return parts.join(' · ');
}

/** What each kind of file is called in the properties panel, and whether this phase reads it. */
export const KIND_TEXT: Record<FolderFileKind, { one: string; many: string; read: boolean }> = {
  photo: { one: 'photo', many: 'photos', read: true },
  geodata: { one: 'GPX or track file', many: 'GPX and track files', read: false },
  video: { one: 'video', many: 'videos', read: false },
};

/**
 * The properties panel's file counts, one line per kind present. Kinds read
 * by a later phase say so, rather than looking like they were ignored
 * (Requirement 3.8).
 */
export function fileCountLines(files: Record<FolderFileKind, number>): string[] {
  const lines: string[] = [];
  for (const kind of ['photo', 'geodata', 'video'] as const) {
    const n = files[kind];
    if (n === 0) continue;
    const text = KIND_TEXT[kind];
    const later = kind === 'geodata' ? ' (listed, read in a later version)' : kind === 'video' ? ' (listed, not shown yet)' : '';
    lines.push(`${plural(n, text.one, text.many)}${text.read ? '' : later}`);
  }
  return lines.length === 0 ? ['No files TrailRT recognises yet'] : lines;
}

/** The photos-by-state lines of the properties panel. Only states with photos are listed. */
export function photoStateLines(counts: Record<PhotoState, number>): string[] {
  const lines: string[] = [];
  if (counts.located > 0) lines.push(`${counts.located.toLocaleString('en-GB')} on the map`);
  if (counts.unlocated > 0) lines.push(`${counts.unlocated.toLocaleString('en-GB')} with no location`);
  if (counts['not-downloaded'] > 0) lines.push(`${counts['not-downloaded'].toLocaleString('en-GB')} not downloaded from iCloud`);
  if (counts.unreadable > 0) lines.push(`${counts.unreadable.toLocaleString('en-GB')} unreadable`);
  return lines;
}

/** A day row's photo count, "23 photos (camera time)" when any had no zone (design §8.4). */
export function dayPhotoText(day: { count: number; cameraTime: number }): string {
  return `${plural(day.count, 'photo')}${day.cameraTime > 0 ? ' (camera time)' : ''}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function offsetText(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

/**
 * When a photo was taken, as recorded: the wall clock, then the zone, or
 * "camera time" when none was recorded. Never converted, because the wall
 * clock where the photo was taken is what a traveller remembers.
 */
export function takenText(photo: Pick<Photo, 'takenLocal' | 'takenOffsetMin'>): string {
  if (photo.takenLocal === null) return 'No date';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(photo.takenLocal);
  if (match === null) return 'No date';
  const [, year, month, day, hour, minute] = match;
  const when = `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}, ${hour ?? ''}:${minute ?? ''}`;
  return `${when} ${photo.takenOffsetMin === null ? '(camera time)' : `(${offsetText(photo.takenOffsetMin)})`}`;
}

/**
 * A photo's state in the list (design §8.3). Located photos say nothing; the
 * others say why, with the reason recorded when the photo was read.
 */
export function photoStateText(photo: Pick<Photo, 'state' | 'reason'>, folderState: FolderState | null = null): string {
  if (folderState === 'missing' || folderState === 'denied') return 'Unavailable';
  switch (photo.state) {
    case 'located':
      return '';
    case 'unlocated':
      if (photo.reason === null || photo.reason.startsWith('No location')) return 'No location';
      return `No location — ${lowerFirst(photo.reason)}`;
    case 'not-downloaded':
      return 'Not downloaded from iCloud';
    case 'unreadable':
      return photo.reason === null ? 'Unreadable' : `Unreadable — ${lowerFirst(photo.reason)}`;
  }
}

function lowerFirst(text: string): string {
  // "Not a HEIC image" → "not a HEIC image", but leave "HEIC …" alone.
  return /^[A-Z][a-z]/.test(text) ? text[0]?.toLowerCase() + text.slice(1) : text;
}

/** The file name a list row shows: the last part of the path within the folder. */
export function fileName(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash < 0 ? relativePath : relativePath.slice(slash + 1);
}

/** The subfolder a list row shows under the name, or `null` at the top level. */
export function subfolder(relativePath: string): string | null {
  const slash = relativePath.lastIndexOf('/');
  return slash < 0 ? null : relativePath.slice(0, slash);
}
