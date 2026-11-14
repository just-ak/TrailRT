/**
 * A photo as a waypoint (Phase 14 Requirement 18.3, design §5.11). Pure, so
 * what a photo gives a waypoint is tested without a database.
 */

export interface PhotoForWaypoint {
  relativePath: string;
  lat: number | null;
  lon: number | null;
  altitudeM: number | null;
  /** `YYYY-MM-DDTHH:MM:SS`, the wall clock as recorded. */
  takenLocal: string | null;
}

export interface PhotoWaypointFields {
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string;
  symbol: 'photo';
}

/** Why a photo cannot be a waypoint, for the one case there is. */
export const NO_LOCATION_TEXT = 'This photo has no location, so it cannot be a waypoint.';

const NAME_MAX = 200;

/** The file's name without its folders or its extension. */
export function photoName(relativePath: string): string {
  const file = relativePath.split('/').at(-1) ?? relativePath;
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const name = base.trim().length > 0 ? base.trim() : file.trim();
  return name.length > 0 ? name.slice(0, NAME_MAX) : 'Photo';
}

/**
 * What the waypoint holds: the photo's location, its altitude when it has
 * one (missing stays missing), and where it came from as plain text. Null
 * without a location.
 */
export function photoWaypointFields(photo: PhotoForWaypoint): PhotoWaypointFields | null {
  if (photo.lat === null || photo.lon === null) return null;
  const taken =
    photo.takenLocal === null ? '' : `, taken ${photo.takenLocal.slice(0, 10)} at ${photo.takenLocal.slice(11, 16)}`;
  return {
    name: photoName(photo.relativePath),
    lat: photo.lat,
    lon: photo.lon,
    eleM: photo.altitudeM,
    description: `From the photo ${photo.relativePath}${taken}`,
    symbol: 'photo',
  };
}

/** The day a photo was taken, `YYYY-MM-DD`, or null. */
export function photoDay(takenLocal: string | null): string | null {
  return takenLocal !== null && /^\d{4}-\d{2}-\d{2}/.test(takenLocal) ? takenLocal.slice(0, 10) : null;
}
