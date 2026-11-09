import type { LatLon } from '../geo/distance';
import {
  farthestFrom,
  MAX_SHAPING_POINTS,
  overlap,
  OVERLAP_THRESHOLD,
  OVERLAP_TOLERANCE_M,
} from '../geo/divergence';
import type { SectionLocation } from './RoutingProvider';

/**
 * Pins a chosen alternative with shaping points. Phase 6, design §7.
 *
 * The engine does not remember which of its routes the user picked. If the leg
 * is ever re-routed — a neighbouring point dragged, the transport mode
 * changed — it would return its preferred route and silently undo the choice.
 * So the choice is expressed in the only terms the engine understands: points
 * the route must pass through.
 *
 * Shaping points go where the chosen route is farthest from the one the engine
 * would otherwise produce, and the result is checked by actually re-routing
 * through them. Pure apart from the injected `route`, so the renderer can run
 * it against the real engine and the tests against a fake.
 */

export interface PinResult {
  /** Shaping points on the candidate, in order along it. */
  shaping: LatLon[];
  /** True when re-routing through `shaping` reproduced the candidate. */
  verified: boolean;
  /** How much of the candidate the last re-route reproduced, 0–1. */
  overlap: number;
}

/** Routes a section and returns the joined geometry. */
export type SectionRouter = (locations: SectionLocation[]) => Promise<LatLon[]>;

interface Pin {
  point: LatLon;
  /** Segment index on the candidate, which orders the pins along it. */
  segment: number;
}

/**
 * Chooses and verifies shaping points that make `candidate` reproducible.
 *
 * `preferred` is the route the engine returns unprompted — candidate 1. When
 * the candidate is, within tolerance, the same road as the preferred one, no
 * pins are needed and none are added.
 */
export async function pinCandidate(
  candidate: readonly LatLon[],
  preferred: readonly LatLon[],
  route: SectionRouter,
): Promise<PinResult> {
  const from = candidate[0];
  const to = candidate.at(-1);
  if (from === undefined || to === undefined || candidate.length < 2) {
    return { shaping: [], verified: false, overlap: 0 };
  }

  const first = farthestFrom(candidate, preferred);
  if (first === null || first.distanceM <= OVERLAP_TOLERANCE_M) {
    return { shaping: [], verified: true, overlap: 1 };
  }

  const pins: Pin[] = [{ point: first.midpoint, segment: first.segmentIndex }];
  let agreement = 0;

  for (;;) {
    const ordered = pins.toSorted((a, b) => a.segment - b.segment);
    // eslint-disable-next-line no-await-in-loop
    const rerouted = await route([
      { point: from, passThrough: false },
      ...ordered.map((p) => ({ point: p.point, passThrough: true })),
      { point: to, passThrough: false },
    ]);

    agreement = overlap(candidate, rerouted);
    if (agreement >= OVERLAP_THRESHOLD) {
      return { shaping: ordered.map((p) => p.point), verified: true, overlap: agreement };
    }
    if (pins.length >= MAX_SHAPING_POINTS) break;

    // Pin the stretch the engine still disagrees about most.
    const next = farthestFrom(candidate, rerouted);
    if (
      next === null ||
      next.distanceM <= OVERLAP_TOLERANCE_M ||
      pins.some((p) => p.segment === next.segmentIndex)
    ) {
      break;
    }
    pins.push({ point: next.midpoint, segment: next.segmentIndex });
  }

  return {
    shaping: pins.toSorted((a, b) => a.segment - b.segment).map((p) => p.point),
    verified: false,
    overlap: agreement,
  };
}
