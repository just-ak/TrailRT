import type { LatLon } from './distance';

/**
 * How two road lines differ, for choosing and verifying shaping points.
 *
 * Phase 6 (design §7, ADR 0017). When the user picks an alternative, the
 * engine does not remember the choice. The application pins it with shaping
 * points placed where the chosen line is farthest from the line the engine
 * would otherwise produce, then re-routes to check the pins hold. These are the
 * two measurements that process needs: *where* two lines are farthest apart,
 * and *how much* of one lies on the other.
 *
 * Everything is done in a local planar projection in metres — longitude scaled
 * by cos(latitude) at a fixed reference latitude. Over the length of a routing
 * leg the error is far below the 25 m tolerance being tested, and it lets a
 * segment grid make the overlap test linear rather than quadratic.
 */

/** A candidate counts as reproduced when this much of it lies on the re-route. */
export const OVERLAP_THRESHOLD = 0.98;

/** How close a stretch of road must be to count as the same road, in metres. */
export const OVERLAP_TOLERANCE_M = 25;

/**
 * The most shaping points one chosen alternative may receive.
 *
 * Each costs a verification route, and a route that needs more than three to
 * be reproduced is one the engine strongly disagrees with — better to keep the
 * geometry and say so than to carpet it with pins.
 */
export const MAX_SHAPING_POINTS = 3;

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

interface Plane {
  toXY(p: LatLon): [number, number];
  toLatLon(x: number, y: number): LatLon;
}

function planeAt(latitude: number): Plane {
  const k = EARTH_RADIUS_M * DEG;
  const kx = k * Math.cos(latitude * DEG);
  return {
    toXY: (p) => [p.lon * kx, p.lat * k],
    toLatLon: (x, y) => ({ lat: y / k, lon: x / kx }),
  };
}

function referenceLatitude(lines: readonly (readonly LatLon[])[]): number {
  for (const line of lines) {
    const first = line[0];
    if (first !== undefined) return first.lat;
  }
  return 0;
}

type Segment = [number, number, number, number];

function segmentsOf(line: readonly LatLon[], plane: Plane): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = plane.toXY(a);
    const [bx, by] = plane.toXY(b);
    out.push([ax, ay, bx, by]);
  }
  return out;
}

function distanceToSegment(px: number, py: number, s: Segment): number {
  const [ax, ay, bx, by] = s;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Segments bucketed into square cells, so "is anything within r of here" looks
 * at a handful of segments rather than all of them. A 5,000-point leg compared
 * against another would otherwise be 25 million distance tests per check.
 */
class SegmentGrid {
  private readonly cells = new Map<string, Segment[]>();

  constructor(
    segments: readonly Segment[],
    private readonly cell: number,
  ) {
    for (const s of segments) {
      const [ax, ay, bx, by] = s;
      const x0 = Math.floor(Math.min(ax, bx) / cell);
      const x1 = Math.floor(Math.max(ax, bx) / cell);
      const y0 = Math.floor(Math.min(ay, by) / cell);
      const y1 = Math.floor(Math.max(ay, by) / cell);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          const key = `${x}:${y}`;
          const bucket = this.cells.get(key);
          if (bucket === undefined) this.cells.set(key, [s]);
          else bucket.push(s);
        }
      }
    }
  }

  /** True when some segment lies within `radius` of the point. */
  near(px: number, py: number, radius: number): boolean {
    const cx = Math.floor(px / this.cell);
    const cy = Math.floor(py / this.cell);
    const reach = Math.ceil(radius / this.cell);
    for (let x = cx - reach; x <= cx + reach; x += 1) {
      for (let y = cy - reach; y <= cy + reach; y += 1) {
        const bucket = this.cells.get(`${x}:${y}`);
        if (bucket === undefined) continue;
        for (const s of bucket) {
          if (distanceToSegment(px, py, s) <= radius) return true;
        }
      }
    }
    return false;
  }
}

/** Distance from a point to a polyline, in metres. Infinity for an empty line. */
export function distanceToLineM(point: LatLon, line: readonly LatLon[]): number {
  const plane = planeAt(point.lat);
  const [px, py] = plane.toXY(point);
  if (line.length === 1) {
    const only = line[0] as LatLon;
    const [x, y] = plane.toXY(only);
    return Math.hypot(px - x, py - y);
  }
  let best = Number.POSITIVE_INFINITY;
  for (const s of segmentsOf(line, plane)) {
    best = Math.min(best, distanceToSegment(px, py, s));
  }
  return best;
}

export interface FarthestSegment {
  /** Index of the segment's first vertex in the candidate. */
  segmentIndex: number;
  /** The segment's midpoint, which lies on the candidate by construction. */
  midpoint: LatLon;
  /** How far that midpoint is from the reference line, in metres. */
  distanceM: number;
}

/**
 * The segment of `candidate` whose midpoint is farthest from `reference`.
 *
 * A segment midpoint rather than a vertex, deliberately. Road vertices sit at
 * junctions as often as not, and a shaping point on a junction can snap onto
 * the crossing road — pinning the route to exactly the road it was meant to
 * avoid. A midpoint is unambiguously on one road.
 *
 * Null when the candidate has no segments.
 */
export function farthestFrom(
  candidate: readonly LatLon[],
  reference: readonly LatLon[],
): FarthestSegment | null {
  const plane = planeAt(referenceLatitude([candidate, reference]));
  const refSegments = segmentsOf(reference, plane);
  let best: FarthestSegment | null = null;

  for (let i = 1; i < candidate.length; i += 1) {
    const a = candidate[i - 1];
    const b = candidate[i];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = plane.toXY(a);
    const [bx, by] = plane.toXY(b);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;

    let distance = Number.POSITIVE_INFINITY;
    for (const s of refSegments) distance = Math.min(distance, distanceToSegment(mx, my, s));
    if (refSegments.length === 0) distance = 0;

    if (best === null || distance > best.distanceM) {
      best = { segmentIndex: i - 1, midpoint: plane.toLatLon(mx, my), distanceM: distance };
    }
  }

  return best;
}

/** Fraction of `a`'s length lying within `toleranceM` of `b`. One direction. */
function coverage(
  a: readonly LatLon[],
  b: readonly LatLon[],
  toleranceM: number,
  plane: Plane,
): number {
  const aSegments = segmentsOf(a, plane);
  const bSegments = segmentsOf(b, plane);
  if (aSegments.length === 0) return 1;
  if (bSegments.length === 0) return 0;

  const grid = new SegmentGrid(bSegments, Math.max(toleranceM * 2, 1));
  // Sample each segment in pieces no longer than half the tolerance, so a short
  // departure from `b` cannot hide between two samples that are both on it.
  const step = Math.max(toleranceM / 2, 0.5);

  let total = 0;
  let within = 0;
  for (const [ax, ay, bx, by] of aSegments) {
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) continue;
    const pieces = Math.max(1, Math.ceil(length / step));
    const piece = length / pieces;
    for (let k = 0; k < pieces; k += 1) {
      const t = (k + 0.5) / pieces;
      total += piece;
      if (grid.near(ax + t * (bx - ax), ay + t * (by - ay), toleranceM)) within += piece;
    }
  }
  return total === 0 ? 1 : within / total;
}

/**
 * How much two lines agree: the fraction of length within `toleranceM` of the
 * other line, taking the lower of the two directions.
 *
 * Both directions, because one alone is fooled by containment: a short line
 * lying along part of a long one is 100% covered by it, and the long one is
 * not covered by the short one at all. The minimum is the honest answer to
 * "are these the same road".
 */
export function overlap(
  a: readonly LatLon[],
  b: readonly LatLon[],
  toleranceM: number = OVERLAP_TOLERANCE_M,
): number {
  const plane = planeAt(referenceLatitude([a, b]));
  return Math.min(coverage(a, b, toleranceM, plane), coverage(b, a, toleranceM, plane));
}
