import type { LatLon } from '../geo/distance';

/**
 * Waze hand-off — Requirement 7.
 *
 * ## Waze takes one destination, and that is the whole feature
 *
 * The documented deep link accepts a single `ll` pair. There is no public
 * parameter for intermediate stops, so a multi-waypoint hand-off cannot be
 * built, and the honesty rule in `.kiro/steering/architecture.md` says to state
 * that rather than ship a control that silently drops most of the route.
 *
 * Consequently:
 *
 * - A waypoint hands off its own position.
 * - A route or track offers its **start** and its **end**, as two separate
 *   hand-offs, and every label says which one is being sent. The start is for
 *   driving to where the route begins; the end is for heading straight to where
 *   it finishes. Either way it is one point per hand-off.
 * - There is no "send whole route to Waze" action anywhere, because there is no
 *   way to implement one.
 *
 * `navigate=yes` asks Waze to begin navigating rather than only dropping a pin,
 * which is what a user pressing this expects.
 */

export const WAZE_LIMITATION =
  'Waze accepts a single destination, so only one point can be sent. There is no way to hand over a whole route.';

export interface WazeTarget {
  /** Shown on the button and in the confirmation. */
  label: string;
  point: LatLon;
}

/**
 * Builds the deep link.
 *
 * Coordinates are rounded to six decimals — about 11 cm, far finer than any
 * road — because a full double prints seventeen digits of noise into a URL that
 * ends up in a log.
 */
export function wazeNavigateUrl(point: LatLon): string {
  const lat = point.lat.toFixed(6);
  const lon = point.lon.toFixed(6);
  return `https://www.waze.com/ul?ll=${lat}%2C${lon}&navigate=yes`;
}

/**
 * Resolves what a selection can hand off: one target for a waypoint, the start
 * and the end for a route or track, in that order.
 *
 * An empty array when there is no geometry, so the caller can disable its
 * control with a reason rather than handle an error.
 */
export function wazeTargetsFor(
  selection:
    | { kind: 'waypoint'; name: string; point: LatLon }
    | { kind: 'route' | 'track'; name: string; points: readonly LatLon[] },
): WazeTarget[] {
  if (selection.kind === 'waypoint') {
    return [{ label: selection.name, point: selection.point }];
  }

  const start = selection.points.at(0);
  const end = selection.points.at(-1);
  if (start === undefined || end === undefined) return [];

  return [
    // Which end is in the label itself, so the user cannot mistake either for
    // sending the whole route.
    { label: 'Start', point: { lat: start.lat, lon: start.lon } },
    { label: 'End', point: { lat: end.lat, lon: end.lon } },
  ];
}
