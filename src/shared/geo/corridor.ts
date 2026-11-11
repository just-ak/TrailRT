import { haversineDistance, type BoundingBox, type LatLon } from './distance';

/**
 * Finding things along a line: how far along it they are, and how far off it.
 *
 * Used for "fuel along this route" and for the range check (Phase 10
 * Requirements 6 and 9). Pure, so it is tested without Electron.
 *
 * ## Accuracy
 *
 * Distance along the line uses the same haversine sum as route statistics, so
 * "42 km from the start" agrees with the route's own length. Distance off the
 * line is measured in a flat projection centred on the candidate's own
 * latitude. A single projection for a whole 500 km route would get east–west
 * distances wrong by up to 11% at its far end; a local one is accurate to well
 * under 1% for the few kilometres a corridor spans.
 *
 * ## Speed
 *
 * Segments are bucketed into a grid of cells about `cellM` across, so a
 * candidate is tested only against the segments near it. A 20,000-vertex route
 * and 30,000 candidates is tens of milliseconds.
 */

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

export interface LineIndex {
  points: readonly LatLon[];
  /** Distance from the start to each vertex, metres. */
  cumulative: readonly number[];
  totalM: number;
  cellDegLat: number;
  cellDegLon: number;
  cells: ReadonlyMap<string, readonly number[]>;
  /** The grid's extent, so a search never walks cells the line is not in. */
  rows: { min: number; max: number };
  cols: { min: number; max: number };
}

export interface Projection {
  alongM: number;
  offM: number;
  /** Index of the segment's first vertex. */
  segment: number;
}

const key = (row: number, col: number): string => `${row}:${col}`;

export function buildLineIndex(points: readonly LatLon[], cellM = 1000): LineIndex {
  const cumulative: number[] = [];
  let total = 0;
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous !== undefined) total += haversineDistance(previous, point);
    cumulative.push(total);
  }

  // Longitude cells sized at the line's highest latitude, where a degree is
  // narrowest, so no cell is ever narrower than `cellM`.
  let maxAbsLat = 0;
  for (const point of points) maxAbsLat = Math.max(maxAbsLat, Math.abs(point.lat));
  const cosMax = Math.max(Math.cos((Math.min(maxAbsLat, 89) * Math.PI) / 180), 0.01);
  const cellDegLat = cellM / M_PER_DEG_LAT;
  const cellDegLon = cellM / (M_PER_DEG_LAT * cosMax);

  const cells = new Map<string, number[]>();
  const rows = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  const cols = { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    const rowFrom = Math.floor(Math.min(a.lat, b.lat) / cellDegLat);
    const rowTo = Math.floor(Math.max(a.lat, b.lat) / cellDegLat);
    const colFrom = Math.floor(Math.min(a.lon, b.lon) / cellDegLon);
    const colTo = Math.floor(Math.max(a.lon, b.lon) / cellDegLon);
    rows.min = Math.min(rows.min, rowFrom);
    rows.max = Math.max(rows.max, rowTo);
    cols.min = Math.min(cols.min, colFrom);
    cols.max = Math.max(cols.max, colTo);
    for (let row = rowFrom; row <= rowTo; row += 1) {
      for (let col = colFrom; col <= colTo; col += 1) {
        const id = key(row, col);
        const list = cells.get(id);
        if (list === undefined) cells.set(id, [index]);
        else list.push(index);
      }
    }
  }

  return { points, cumulative, totalM: total, cellDegLat, cellDegLon, cells, rows, cols };
}

/** Distance from a point to segment a–b, and where along a–b it lands (0–1). */
function toSegment(point: LatLon, a: LatLon, b: LatLon): { offM: number; t: number } {
  const cos = Math.cos((point.lat * Math.PI) / 180);
  const ax = (a.lon - point.lon) * cos * M_PER_DEG_LAT;
  const ay = (a.lat - point.lat) * M_PER_DEG_LAT;
  const bx = (b.lon - point.lon) * cos * M_PER_DEG_LAT;
  const by = (b.lat - point.lat) * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // The point is the origin, so its projection parameter is -a·d / |d|².
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSq));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { offM: Math.hypot(x, y), t };
}

/**
 * The nearest point on the line, if it is within `maxOffM`.
 *
 * Where the line passes a point twice (a loop's start and end, an out-and-back
 * road), the nearer pass wins; on an exact tie, the earlier one.
 */
export function project(index: LineIndex, point: LatLon, maxOffM: number): Projection | null {
  if (index.points.length === 0) return null;
  if (index.points.length === 1) {
    const only = index.points[0];
    if (only === undefined) return null;
    const offM = haversineDistance(only, point);
    return offM <= maxOffM ? { alongM: 0, offM, segment: 0 } : null;
  }

  const reachLat = Math.ceil(maxOffM / (index.cellDegLat * M_PER_DEG_LAT));
  const reachLon = Math.ceil(
    maxOffM /
      (index.cellDegLon * M_PER_DEG_LAT * Math.max(Math.cos((point.lat * Math.PI) / 180), 0.01)),
  );
  const row = Math.floor(point.lat / index.cellDegLat);
  const col = Math.floor(point.lon / index.cellDegLon);

  const seen = new Set<number>();
  let best: Projection | null = null;

  // Clamped to the line's own cells, so a large or infinite reach is a bounded walk.
  const rowFrom = Math.max(row - reachLat, index.rows.min);
  const rowTo = Math.min(row + reachLat, index.rows.max);
  const colFrom = Math.max(col - reachLon, index.cols.min);
  const colTo = Math.min(col + reachLon, index.cols.max);
  for (let r = rowFrom; r <= rowTo; r += 1) {
    for (let c = colFrom; c <= colTo; c += 1) {
      for (const segment of index.cells.get(key(r, c)) ?? []) {
        if (seen.has(segment)) continue;
        seen.add(segment);
        const a = index.points[segment];
        const b = index.points[segment + 1];
        if (a === undefined || b === undefined) continue;
        const { offM, t } = toSegment(point, a, b);
        if (offM > maxOffM) continue;
        if (best !== null && (offM > best.offM || (offM === best.offM && segment > best.segment))) {
          continue;
        }
        const start = index.cumulative[segment] ?? 0;
        const end = index.cumulative[segment + 1] ?? start;
        best = { alongM: start + t * (end - start), offM, segment };
      }
    }
  }

  return best;
}

/** The line's bounding box grown by `widthM` on every side, for a candidate query. */
export function corridorBox(points: readonly LatLon[], widthM: number): BoundingBox | null {
  if (points.length === 0) return null;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  const dLat = widthM / M_PER_DEG_LAT;
  const widest = Math.max(Math.abs(minLat), Math.abs(maxLat));
  const dLon = widthM / (M_PER_DEG_LAT * Math.max(Math.cos((Math.min(widest, 89) * Math.PI) / 180), 0.01));
  return {
    minLat: minLat - dLat,
    maxLat: maxLat + dLat,
    minLon: minLon - dLon,
    maxLon: maxLon + dLon,
  };
}

/** Which part of the line to search. */
export type CorridorSection =
  | { kind: 'all' }
  /** Between two distances from the start, inclusive. */
  | { kind: 'range'; fromM: number; toM: number }
  /** Within `radiusM` of a point, which is normally on the line. */
  | { kind: 'near'; point: LatLon; radiusM: number };

export interface CorridorHit<T> {
  item: T;
  alongM: number;
  offM: number;
}

/**
 * Candidates within `widthM` of the line, in the order they are reached.
 *
 * For a `near` section the radius replaces the width: "hotels within 10 km of
 * where day 2 ends" should not also have to be within 2 km of the road.
 */
export function searchCorridor<T extends LatLon>(
  index: LineIndex,
  candidates: Iterable<T>,
  widthM: number,
  section: CorridorSection = { kind: 'all' },
): CorridorHit<T>[] {
  const hits: CorridorHit<T>[] = [];
  const maxOffM = section.kind === 'near' ? section.radiusM : widthM;

  for (const item of candidates) {
    if (section.kind === 'near' && haversineDistance(section.point, item) > section.radiusM) {
      continue;
    }
    const projection = project(index, item, maxOffM);
    if (projection === null) continue;
    if (
      section.kind === 'range' &&
      (projection.alongM < section.fromM || projection.alongM > section.toM)
    ) {
      continue;
    }
    hits.push({ item, alongM: projection.alongM, offM: projection.offM });
  }

  hits.sort((a, b) => a.alongM - b.alongM || a.offM - b.offM);
  return hits;
}

/**
 * Stretches of the line outside every coverage ring, as distance ranges.
 *
 * "Covered" means the place data was built for that area, so a search there
 * can honestly say what is or is not mapped. A stretch outside it is reported
 * as not checked, never as empty. Judged vertex by vertex: a segment is
 * uncovered when either end is.
 */
export function uncoveredStretches(
  index: LineIndex,
  covered: (point: LatLon) => boolean,
): { fromM: number; toM: number }[] {
  const stretches: { fromM: number; toM: number }[] = [];
  const inside = index.points.map((point) => covered(point));
  let open: number | null = null;

  for (let segment = 0; segment < index.points.length - 1; segment += 1) {
    const bad = inside[segment] !== true || inside[segment + 1] !== true;
    const from = index.cumulative[segment] ?? 0;
    const to = index.cumulative[segment + 1] ?? from;
    if (bad && open === null) open = from;
    if (!bad && open !== null) {
      stretches.push({ fromM: open, toM: from });
      open = null;
    }
    if (bad && segment === index.points.length - 2 && open !== null) {
      stretches.push({ fromM: open, toM: to });
      open = null;
    }
  }

  if (index.points.length === 1 && inside[0] !== true) stretches.push({ fromM: 0, toM: 0 });
  return stretches;
}
