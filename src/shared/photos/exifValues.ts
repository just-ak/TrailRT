import { EXIF_TAGS, GPS_TAGS, IFD0_TAGS, type Rational, type SubIfd, type TagMap, type TiffValue } from './tiff';

/**
 * EXIF values to domain values. Phase 11, design §3.3 and §3.4.
 *
 * Three rules from the requirements run through all of it:
 *
 * - **No location is not location zero.** A geotag that cannot be trusted is
 *   rejected with a reason the user can read. It is never repaired by
 *   guessing a hemisphere or clamping a value (Requirement 2.5).
 * - **Missing stays missing.** Absent altitude, accuracy and direction are
 *   `null`, never 0 (Requirement 2.4).
 * - **Camera time is not clock time.** A capture time without an offset keeps
 *   no zone. Nothing here converts it as if it were UTC (Requirement 2.6).
 *
 * Pure. The tags come from `parseTiff`.
 */

export type CompassReference = 'T' | 'M';

export interface Geotag {
  /** Decimal degrees. South is negative. */
  lat: number;
  /** Decimal degrees. West is negative. */
  lon: number;
  /** Metres. Negative below sea level. `null` when the photo records none. */
  altitudeM: number | null;
  /** Horizontal positioning error, metres. `null` when not recorded. */
  accuracyM: number | null;
  /** Which way the camera faced, `null` when not recorded. */
  direction: { degrees: number; ref: CompassReference } | null;
}

export type LocationResult =
  /** No geotag at all. */
  | { kind: 'none' }
  | { kind: 'located'; geotag: Geotag }
  /** A geotag was recorded, but it cannot be trusted. */
  | { kind: 'rejected'; reason: string };

export interface TakenTime {
  /** `YYYY-MM-DDTHH:MM:SS`: the wall clock as the camera recorded it. */
  local: string;
  /** Minutes east of UTC when the photo records an offset, otherwise `null` (camera time). */
  offsetMinutes: number | null;
}

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const REASON = {
  zeroZero: 'Location recorded as 0°, 0° — usually a camera with no GPS fix',
  noReference: 'Location is malformed: no hemisphere recorded',
  badReference: 'Location is malformed: the hemisphere is not N, S, E or W',
  zeroDenominator: 'Location is malformed: a value divides by zero',
  badValue: 'Location is malformed: a value is not a number of degrees',
  latitudeOnly: 'Location is malformed: latitude without longitude',
  longitudeOnly: 'Location is malformed: longitude without latitude',
  outOfRange: 'Location is outside the valid range',
} as const;

function ascii(value: TiffValue | undefined): string | null {
  return value?.kind === 'ascii' ? value.text.trim() : null;
}

function rationals(value: TiffValue | undefined): readonly Rational[] | null {
  return value?.kind === 'rational' ? value.values : null;
}

/** A single rational as a number, or `null` when absent, the wrong type, or over zero. */
function single(value: TiffValue | undefined): number | null {
  const values = rationals(value);
  const first = values?.[0];
  if (first === undefined || first[1] === 0) return null;
  return first[0] / first[1];
}

type Degrees = { ok: true; value: number } | { ok: false; reason: string };

/**
 * Degrees, minutes and seconds to unsigned decimal degrees. One to three
 * components are accepted, because some writers put the whole angle in the
 * degrees with the rest zero or absent.
 */
export function dmsToDegrees(values: readonly Rational[]): Degrees {
  if (values.length === 0 || values.length > 3) return { ok: false, reason: REASON.badValue };
  let total = 0;
  const scale = [1, 60, 3600];
  for (const [i, [numerator, denominator]] of values.entries()) {
    if (denominator === 0) return { ok: false, reason: REASON.zeroDenominator };
    total += numerator / denominator / (scale[i] ?? 1);
  }
  return Number.isFinite(total) ? { ok: true, value: total } : { ok: false, reason: REASON.badValue };
}

function axis(
  gps: TagMap,
  refTag: number,
  valueTag: number,
  positive: string,
  negative: string,
): { ok: true; value: number } | { ok: false; reason: string } | null {
  const raw = gps.get(valueTag);
  const refRaw = gps.get(refTag);
  if (raw === undefined) return null;
  const values = rationals(raw);
  if (values === null) return { ok: false, reason: REASON.badValue };
  if (refRaw === undefined) return { ok: false, reason: REASON.noReference };
  const ref = ascii(refRaw)?.toUpperCase();
  if (ref !== positive && ref !== negative) return { ok: false, reason: REASON.badReference };
  const degrees = dmsToDegrees(values);
  if (!degrees.ok) return degrees;
  return { ok: true, value: ref === negative ? -degrees.value : degrees.value };
}

function altitude(gps: TagMap): number | null {
  const metres = single(gps.get(GPS_TAGS.alt));
  if (metres === null) return null;
  const ref = gps.get(GPS_TAGS.altRef);
  // Reference 1 is below sea level. An absent reference means above, the EXIF default.
  const below = ref?.kind === 'uint' && ref.values[0] === 1;
  return below ? -metres : metres;
}

function direction(gps: TagMap): Geotag['direction'] {
  const degrees = single(gps.get(GPS_TAGS.dir));
  if (degrees === null) return null;
  const ref = ascii(gps.get(GPS_TAGS.dirRef))?.toUpperCase();
  // Without a reference there is no saying which north it is measured from.
  if (ref !== 'T' && ref !== 'M') return null;
  return { degrees: ((degrees % 360) + 360) % 360, ref };
}

/** The photo's geotag from its GPS IFD (Requirements 2.1, 2.3–2.5). */
export function readLocation(gps: SubIfd): LocationResult {
  if (gps.status === 'absent') return { kind: 'none' };
  if (gps.status === 'damaged') return { kind: 'rejected', reason: gps.reason };

  const lat = axis(gps.tags, GPS_TAGS.latRef, GPS_TAGS.lat, 'N', 'S');
  const lon = axis(gps.tags, GPS_TAGS.lonRef, GPS_TAGS.lon, 'E', 'W');
  if (lat === null && lon === null) return { kind: 'none' };
  if (lon === null) return { kind: 'rejected', reason: REASON.latitudeOnly };
  if (lat === null) return { kind: 'rejected', reason: REASON.longitudeOnly };
  if (!lat.ok) return { kind: 'rejected', reason: lat.reason };
  if (!lon.ok) return { kind: 'rejected', reason: lon.reason };
  if (lat.value === 0 && lon.value === 0) return { kind: 'rejected', reason: REASON.zeroZero };
  if (Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) {
    return { kind: 'rejected', reason: `${REASON.outOfRange} (${lat.value}°, ${lon.value}°)` };
  }

  const accuracy = single(gps.tags.get(GPS_TAGS.hPositioningError));
  return {
    kind: 'located',
    geotag: {
      lat: lat.value,
      lon: lon.value,
      altitudeM: altitude(gps.tags),
      accuracyM: accuracy !== null && accuracy >= 0 ? accuracy : null,
      direction: direction(gps.tags),
    },
  };
}

const DATE_TIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `YYYY:MM:DD HH:MM:SS` as a validated `YYYY-MM-DDTHH:MM:SS`, or `null`. */
export function parseExifDateTime(text: string | null): string | null {
  const match = text === null ? null : DATE_TIME.exec(text);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  // "0000:00:00 00:00:00" is what many cameras write when the clock was never set.
  if (year < 1800 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** `±HH:MM` as minutes east of UTC, or `null` when absent or not a real offset. */
export function parseExifOffset(text: string | null): number | null {
  const match = text === null ? null : OFFSET.exec(text);
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (minutes > 59) return null;
  const total = (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
  // Real zones run from UTC−12:00 to UTC+14:00.
  return total >= -12 * 60 && total <= 14 * 60 ? total : null;
}

/**
 * When the photo was taken (Requirement 2.6). `DateTimeOriginal`, with
 * `OffsetTimeOriginal` when present and valid. The GPS timestamp is
 * deliberately not used to infer a zone (ADR 0020 §4).
 */
export function readTaken(exif: SubIfd): TakenTime | null {
  if (exif.status !== 'ok') return null;
  const local = parseExifDateTime(ascii(exif.tags.get(EXIF_TAGS.dateTimeOriginal)));
  if (local === null) return null;
  return { local, offsetMinutes: parseExifOffset(ascii(exif.tags.get(EXIF_TAGS.offsetTimeOriginal))) };
}

/** The orientation tag, 1–8, or `null` when absent or out of range. */
export function readOrientation(ifd0: TagMap): Orientation | null {
  const value = ifd0.get(IFD0_TAGS.orientation);
  const n = value?.kind === 'uint' ? value.values[0] : undefined;
  return n !== undefined && n >= 1 && n <= 8 ? (n as Orientation) : null;
}
