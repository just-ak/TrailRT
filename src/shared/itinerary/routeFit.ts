import { haversineDistance, type LatLon } from '../geo/distance';

/**
 * Whether a route joins two stops (Phase 14 Requirement 12.3, design §5.5):
 * each of its ends within this distance of the stop beside it. The same rule
 * decides whether a linked leg is used for timing, so a route offered as
 * matching is never then refused.
 */
export const ROUTE_FIT_M = 1000;

export interface RouteFit {
  /** How far the route's start is from the stop before, and its end from the stop after. Null where there is no stop. */
  startM: number | null;
  endM: number | null;
  fits: boolean;
}

export function routeFit(ends: { start: LatLon; end: LatLon }, before: LatLon | null, after: LatLon | null): RouteFit {
  const startM = before === null ? null : haversineDistance(ends.start, before);
  const endM = after === null ? null : haversineDistance(ends.end, after);
  return { startM, endM, fits: startM !== null && endM !== null && startM <= ROUTE_FIT_M && endM <= ROUTE_FIT_M };
}

/** Whether one end is close enough to join the stop beside it. */
export function isNear(m: number | null): boolean {
  return m !== null && m <= ROUTE_FIT_M;
}
