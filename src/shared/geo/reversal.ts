import { bearingDelta, initialBearing } from './bearing';
import { haversineDistance, type LatLon } from './distance';

/**
 * Detects a route turning round at a point: an out-and-back spur.
 *
 * Phase 6 (design §5, Requirement 4.7). A shaping point should *bend* a route.
 * When each leg is routed on its own, the engine treats every point as a
 * destination, so a point placed just off the road produces a route that
 * arrives, turns round and leaves the way it came. With a provider that
 * supports pass-through this cannot happen; without one, this check is how the
 * user finds out.
 */

/** How far along the route each side of the point to look, in metres. */
export const REVERSAL_WINDOW_M = 150;

/** Heading change, in degrees, beyond which the route has turned back. */
const REVERSAL_ANGLE = 150;

/**
 * How close the two arms must end up for the turn to be a retrace.
 *
 * The angle alone would flag a mountain hairpin, which is a real road and
 * exactly what a rider may be shaping a route onto. An out-and-back retraces
 * the same carriageway, so the points a window's distance before and after
 * the apex nearly coincide; a hairpin's arms are separated by the hillside.
 */
const RETRACE_SEPARATION_M = 25;

/** The point `distanceM` along the line from `index`, walking by `step`. */
function walk(
  shape: readonly LatLon[],
  index: number,
  distanceM: number,
  step: 1 | -1,
): LatLon | null {
  let remaining = distanceM;
  let i = index;
  while (true) {
    const here = shape[i];
    const next = shape[i + step];
    // Ran off the end before covering the distance: too short to judge.
    if (here === undefined || next === undefined) return null;
    const length = haversineDistance(here, next);
    if (length >= remaining) {
      const t = length === 0 ? 0 : remaining / length;
      return {
        lat: here.lat + (next.lat - here.lat) * t,
        lon: here.lon + (next.lon - here.lon) * t,
      };
    }
    remaining -= length;
    i += step;
  }
}

/**
 * True when the route turns back on itself at `shape[index]`.
 *
 * False at either end of the shape, where there is nothing on one side to
 * compare, and when the route is too short on either side to judge.
 */
export function reversalAt(
  shape: readonly LatLon[],
  index: number,
  windowM: number = REVERSAL_WINDOW_M,
): boolean {
  const apex = shape[index];
  if (apex === undefined || index === 0 || index === shape.length - 1) return false;

  const before = walk(shape, index, windowM, -1);
  const after = walk(shape, index, windowM, 1);
  if (before === null || after === null) return false;

  const inbound = initialBearing(before, apex);
  const outbound = initialBearing(apex, after);
  if (inbound === null || outbound === null) return false;

  return (
    Math.abs(bearingDelta(inbound, outbound)) > REVERSAL_ANGLE &&
    haversineDistance(before, after) < RETRACE_SEPARATION_M
  );
}
