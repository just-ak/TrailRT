import type { LatLon } from './distance';
import type { BoundingBox } from './polygon';

/**
 * Reading terrain heights from SRTM-style HGT tiles.
 *
 * An HGT tile covers one degree of latitude by one of longitude and is named
 * after its **south-west** corner: `N53W002` spans 53–54°N and 2–1°W. The file
 * is a square grid of big-endian signed 16-bit metres, row by row from the
 * **north-west** corner, with the edge rows and columns shared with the
 * neighbouring tiles. Two sizes exist: 3601 × 3601 at one arc-second (about
 * 30 m, which is what the UK gets) and 1201 × 1201 at three.
 *
 * Pure: the caller supplies the bytes, so sampling is testable on a synthetic
 * grid and nothing here touches the filesystem or the network. ADR 0018.
 */

/** The value HGT uses for "no data". Never a height. */
export const HGT_VOID = -32768;

/**
 * Hysteresis for gain and loss from terrain heights, in metres.
 *
 * SRTM's vertical noise is a few metres. Sampled every 20–30 m along a road,
 * the grid's cell-to-cell noise would otherwise be counted as climbing, and a
 * flat road would accumulate tens of metres of imaginary ascent per kilometre.
 * A climb is counted only once it has gone this far past the last turning
 * point. Recorded elevation does not use this — it keeps its own unthresholded
 * figures, so no existing number changes.
 */
export const TERRAIN_GAIN_THRESHOLD_M = 3;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** The name of the tile containing a point, e.g. `N53W002`. */
export function tileNameFor(lat: number, lon: number): string {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const ns = latFloor >= 0 ? 'N' : 'S';
  const ew = lonFloor >= 0 ? 'E' : 'W';
  return `${ns}${pad(Math.abs(latFloor), 2)}${ew}${pad(Math.abs(lonFloor), 3)}`;
}

/** The south-west corner a tile name refers to. Null for a malformed name. */
export function tileOrigin(name: string): { lat: number; lon: number } | null {
  const match = /^([NS])(\d{2})([EW])(\d{3})$/.exec(name);
  if (match === null) return null;
  const [, ns, latText, ew, lonText] = match;
  const lat = Number(latText) * (ns === 'S' ? -1 : 1);
  const lon = Number(lonText) * (ew === 'W' ? -1 : 1);
  if (lat < -90 || lat >= 90 || lon < -180 || lon >= 180) return null;
  return { lat, lon };
}

/** Every tile a bounding box touches. */
export function tilesCovering(box: BoundingBox): string[] {
  const names: string[] = [];
  for (let lat = Math.floor(box.minLat); lat <= Math.floor(box.maxLat); lat += 1) {
    for (let lon = Math.floor(box.minLon); lon <= Math.floor(box.maxLon); lon += 1) {
      names.push(tileNameFor(lat, lon));
    }
  }
  return names;
}

/** The tiles a set of points needs, without duplicates. */
export function tilesFor(points: readonly LatLon[]): string[] {
  const names = new Set<string>();
  for (const p of points) names.add(tileNameFor(p.lat, p.lon));
  return [...names];
}

/**
 * Grid size implied by a file's length, or null when it is not a valid tile.
 *
 * The only validation an HGT file has: no header, no checksum. A truncated
 * download is the wrong length, and sampling it would read heights from the
 * wrong rows without any error at all.
 */
export function hgtSize(byteLength: number): 3601 | 1201 | null {
  if (byteLength === 3601 * 3601 * 2) return 3601;
  if (byteLength === 1201 * 1201 * 2) return 1201;
  return null;
}

/**
 * The height at a point, interpolated between the four surrounding samples.
 *
 * Null when the point is outside this tile, or when any of the four samples is
 * a void. Blending a void's −32768 into a neighbour would produce a crater;
 * dropping it and averaging the other three would invent a value at exactly
 * the place the survey failed. A gap is the honest answer.
 */
export function sampleHgt(
  view: DataView,
  size: number,
  origin: { lat: number; lon: number },
  point: LatLon,
): number | null {
  const fy = (origin.lat + 1 - point.lat) * (size - 1);
  const fx = (point.lon - origin.lon) * (size - 1);
  if (fx < 0 || fy < 0 || fx > size - 1 || fy > size - 1) return null;

  const x0 = Math.min(size - 2, Math.floor(fx));
  const y0 = Math.min(size - 2, Math.floor(fy));
  const dx = fx - x0;
  const dy = fy - y0;

  const read = (x: number, y: number): number =>
    view.getInt16((y * size + x) * 2, false);

  const a = read(x0, y0);
  const b = read(x0 + 1, y0);
  const c = read(x0, y0 + 1);
  const d = read(x0 + 1, y0 + 1);
  if (a === HGT_VOID || b === HGT_VOID || c === HGT_VOID || d === HGT_VOID) {
    return null;
  }

  const top = a + (b - a) * dx;
  const bottom = c + (d - c) * dx;
  return top + (bottom - top) * dy;
}

/**
 * Gain and loss with hysteresis.
 *
 * Tracks the last turning point and commits a climb or descent only once the
 * height has moved `thresholdM` beyond it. Nulls are skipped rather than
 * treated as zero, so a void in the model is a gap, not a cliff.
 */
export function gainLoss(
  values: readonly (number | null)[],
  thresholdM: number,
): { gainM: number; lossM: number } | null {
  let reference: number | null = null;
  let gain = 0;
  let loss = 0;

  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (reference === null) {
      reference = value;
      continue;
    }
    const delta = value - reference;
    if (delta >= thresholdM) {
      gain += delta;
      reference = value;
    } else if (delta <= -thresholdM) {
      loss -= delta;
      reference = value;
    }
  }

  return reference === null ? null : { gainM: gain, lossM: loss };
}
