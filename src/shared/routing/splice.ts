import type { LatLon } from '../geo/distance';

/**
 * Leg boundaries in a snapped route's flat shape, and replacing legs in place.
 *
 * Phase 6 (design §2, ADR 0017). A snapped route is stored as one flat point
 * array. To re-route the legs either side of a dragged point and leave every
 * other leg exactly as it was, the system has to know where each leg sits in
 * that array. These are the rules for that, in one place, as pure functions.
 *
 * ## The invariant
 *
 * For control points `c[0..n]` (so `n` legs) and shape `p`, the boundaries
 * `b[0..n]` satisfy:
 *
 * - `b[0] = 0` and `b[n] = p.length - 1`
 * - `b` is non-decreasing
 * - for `k >= 1`, `b[k]` is the index of the **last vertex of leg `k - 1`**
 * - leg `k` is the *inclusive* slice `p[b[k] ..= b[k + 1]]`
 *
 * Adjacent legs therefore always share the vertex at their boundary. Where two
 * engine legs met at the same vertex, that vertex appears once and both legs
 * own it. Where they did not quite meet — an unmatched straight leg beside a
 * road leg the engine nudged a few metres — both vertices are kept and the
 * short connecting step belongs to the later leg.
 *
 * Inclusive, rather than half-open, on purpose. With half-open legs, the
 * vertex at a boundary is either shared (the join was de-duplicated) or the
 * later leg's own first vertex (it was not), and nothing records which. A
 * splice then silently drops or duplicates a vertex depending on a fact it
 * cannot see. Making the boundary always the earlier leg's last vertex removes
 * the ambiguity.
 */

/** Six decimals is about 11 cm; anything closer is the same vertex twice. */
const SAME_VERTEX = 1e-6;

function same(a: LatLon | undefined, b: LatLon | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    Math.abs(a.lat - b.lat) < SAME_VERTEX &&
    Math.abs(a.lon - b.lon) < SAME_VERTEX
  );
}

function copy(p: LatLon): LatLon {
  return { lat: p.lat, lon: p.lon };
}

/** Appends `shape` to `out`, dropping its first vertex when it repeats the last. */
function appendJoined(out: LatLon[], shape: readonly LatLon[]): void {
  for (const [index, point] of shape.entries()) {
    if (index === 0 && same(out.at(-1), point)) continue;
    out.push(copy(point));
  }
}

export interface Flattened {
  points: LatLon[];
  /** One per control point: `legs.length + 1` entries. */
  boundaries: number[];
}

/**
 * Joins legs into one shape and records where each leg sits in it.
 *
 * The points are exactly what Phase 4's `flattenLegs` produced, so existing
 * routes and this phase's routes have the same geometry for the same legs.
 * The boundaries come out of the same pass that removes duplicate joins, so
 * they cannot drift from it.
 */
export function flattenLegsWithBoundaries(
  legs: readonly { shape: readonly LatLon[] }[],
): Flattened {
  const points: LatLon[] = [];
  const boundaries: number[] = [0];

  for (const [k, leg] of legs.entries()) {
    if (k > 0) boundaries.push(Math.max(0, points.length - 1));
    appendJoined(points, leg.shape);
  }
  if (legs.length > 0) boundaries.push(Math.max(0, points.length - 1));

  return { points, boundaries };
}

/**
 * True when `boundaries` describe a valid division of a shape of
 * `pointCount` points among `controlCount` control points.
 */
export function checkBoundaries(
  pointCount: number,
  boundaries: readonly (number | null)[],
  controlCount: number,
): boolean {
  if (controlCount < 2 || pointCount < 2) return false;
  if (boundaries.length !== controlCount) return false;
  if (boundaries[0] !== 0 || boundaries.at(-1) !== pointCount - 1) return false;

  let previous = -1;
  for (const b of boundaries) {
    if (b === null || !Number.isInteger(b) || b < previous || b >= pointCount) {
      return false;
    }
    previous = b;
  }
  return true;
}

/** Leg `k`'s geometry: the inclusive slice between its two boundaries. */
export function legShape<T extends LatLon>(
  points: readonly T[],
  boundaries: readonly number[],
  k: number,
): T[] {
  const start = boundaries[k];
  const end = boundaries[k + 1];
  if (start === undefined || end === undefined) return [];
  return points.slice(start, end + 1);
}

/** Every leg's geometry, in order. */
export function legShapes<T extends LatLon>(
  points: readonly T[],
  boundaries: readonly number[],
): T[][] {
  const out: T[][] = [];
  for (let k = 0; k < boundaries.length - 1; k += 1) {
    out.push(legShape(points, boundaries, k));
  }
  return out;
}

/**
 * The leg containing the segment from `p[endIndex - 1]` to `p[endIndex]`.
 *
 * `endIndex` is what `closestSegment` reports as `insertIndex`, so a click on
 * the line can be turned into a leg without a second search.
 */
export function legOfSegment(
  boundaries: readonly number[],
  endIndex: number,
): number {
  const legCount = boundaries.length - 1;
  for (let k = legCount - 1; k >= 0; k -= 1) {
    if ((boundaries[k] ?? 0) <= endIndex - 1) return k;
  }
  return 0;
}

/**
 * Replaces legs `[fromLeg, toLeg)` with `replacement`, leaving every other leg
 * point-for-point identical.
 *
 * The result is exactly what `flattenLegsWithBoundaries` would give for the
 * legs before, the replacement, and the legs after, flattened together. The
 * tests check that equivalence rather than approximate it, because Requirement
 * 5.1 promises the untouched legs do not move at all.
 *
 * An empty replacement drops legs, which is only meaningful at either end of
 * the route (removing the start or end point). Dropping legs from the middle
 * would leave a gap with no leg across it, and is refused.
 */
export function spliceLegs(
  points: readonly LatLon[],
  boundaries: readonly number[],
  fromLeg: number,
  toLeg: number,
  replacement: readonly { shape: readonly LatLon[] }[],
): Flattened {
  const legCount = boundaries.length - 1;
  if (fromLeg < 0 || toLeg > legCount || fromLeg > toLeg) {
    throw new RangeError(`Cannot replace legs [${fromLeg}, ${toLeg}) of ${legCount}.`);
  }

  if (replacement.length === 0) {
    if (fromLeg === 0 && toLeg === legCount) {
      throw new RangeError('Cannot remove every leg of a route.');
    }
    if (fromLeg === 0) {
      const start = boundaries[toLeg] as number;
      return {
        points: points.slice(start).map(copy),
        boundaries: boundaries.slice(toLeg).map((b) => b - start),
      };
    }
    if (toLeg === legCount) {
      const end = boundaries[fromLeg] as number;
      return {
        points: points.slice(0, end + 1).map(copy),
        boundaries: boundaries.slice(0, fromLeg + 1),
      };
    }
    throw new RangeError('Cannot remove legs from the middle of a route without replacing them.');
  }

  const middle = flattenLegsWithBoundaries(replacement);

  // Everything up to and including the last vertex of the leg before.
  const prefix = fromLeg === 0 ? [] : points.slice(0, (boundaries[fromLeg] as number) + 1);
  const out = prefix.map(copy);
  const dropFirst = same(out.at(-1), middle.points[0]);
  const offset = out.length - (dropFirst ? 1 : 0);
  appendJoined(out, middle.points);

  const next: number[] = boundaries.slice(0, fromLeg + 1);
  if (fromLeg === 0) next[0] = 0;
  for (let i = 1; i < middle.boundaries.length - 1; i += 1) {
    next.push(offset + (middle.boundaries[i] as number));
  }
  // The replacement's last vertex is the last vertex of its final leg, which is
  // exactly what the next boundary records.
  const middleEnd = out.length - 1;
  next.push(middleEnd);

  if (toLeg < legCount) {
    const suffixStart = boundaries[toLeg] as number;
    const suffix = points.slice(suffixStart);
    const dropSuffixFirst = same(out.at(-1), suffix[0]);
    const suffixOffset = out.length - (dropSuffixFirst ? 1 : 0);
    appendJoined(out, suffix);
    for (let j = toLeg + 1; j <= legCount; j += 1) {
      next.push(suffixOffset + (boundaries[j] as number) - suffixStart);
    }
  }

  return { points: out, boundaries: next };
}
