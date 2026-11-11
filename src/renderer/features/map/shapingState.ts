import type { LatLon } from '@shared/geo/distance';
import { reversalAt } from '@shared/geo/reversal';
import type { PlannedControl } from '@shared/routing/edit';
import type { ProvenanceControlPoint } from '@shared/routing/results';
import { checkBoundaries, legShapes } from '@shared/routing/splice';

/**
 * What shaping needs to know about a saved snapped route, derived from its
 * points and its stored control points. Pure, so the map and the action that
 * commits an edit derive it identically.
 */
export interface ShapingState {
  control: PlannedControl[];
  /** One shape per leg. */
  legs: LatLon[][];
  /** The control points exactly as stored, for the service's staleness check. */
  expected: ProvenanceControlPoint[];
  /** False for a route snapped before Phase 6. */
  boundariesKnown: boolean;
  /** Shaping points where the route turns back on itself (design §5). */
  reversals: number[];
}

export function shapingStateFrom(
  points: readonly LatLon[],
  controlPoints: readonly ProvenanceControlPoint[],
): ShapingState | null {
  if (controlPoints.length < 2 || points.length < 2) return null;

  const control: PlannedControl[] = controlPoints.map((c) => ({
    point: { lat: c.lat, lon: c.lon },
    role: c.role,
  }));
  const boundaries = controlPoints.map((c) => c.shapeIndex);
  const boundariesKnown = checkBoundaries(points.length, boundaries, control.length);
  const plain = points.map((p) => ({ lat: p.lat, lon: p.lon }));

  // Without boundaries the legs are unknown. Straight lines between the points
  // still give the map something to grab, and the first edit establishes the
  // real ones (Requirement 8.8).
  const legs = boundariesKnown
    ? legShapes(plain, boundaries as number[])
    : control.slice(1).map((c, i) => [(control[i] as PlannedControl).point, c.point]);

  const reversals: number[] = [];
  if (boundariesKnown) {
    for (const [i, c] of control.entries()) {
      if (c.role !== 'shaping') continue;
      if (reversalAt(plain, boundaries[i] as number)) reversals.push(i);
    }
  }

  return { control, legs, expected: [...controlPoints], boundariesKnown, reversals };
}
