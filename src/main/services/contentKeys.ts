import { createHash } from 'node:crypto';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import * as trackRepo from '../db/repositories/tracks';

/**
 * Content keys for finding duplicates (Phase 14 Requirement 28, ADR 0027).
 *
 * Two items with the same key have exactly the same content. Numbers are
 * written as JavaScript's shortest round-trip text, so equal doubles give equal
 * text and different doubles never do: nothing is rounded. Names and other
 * labels are not part of a key.
 */

/** "n" for a missing value, so a missing elevation never equals a recorded 0. */
function text(value: number | null): string {
  return value === null ? 'n' : String(value);
}

/** A waypoint's position and elevation. */
export function waypointKey(waypoint: { lat: number; lon: number; eleM: number | null }): string {
  return `${text(waypoint.lat)},${text(waypoint.lon)},${text(waypoint.eleM)}`;
}

/** A route's drawn points in order, with position and elevation. */
export function routeKey(db: Db, routeId: string): string {
  const hash = createHash('sha256');
  for (const point of routeRepo.listPoints(db, routeId)) {
    hash.update(`${text(point.lat)},${text(point.lon)},${text(point.ele)};`);
  }
  return hash.digest('hex');
}

/**
 * A track's recorded points in order, with position, elevation and time, and
 * a mark where a segment breaks. The segment and sequence numbers themselves
 * are not part of it, so a gap in them, left by an edit, changes nothing.
 */
export function trackKey(db: Db, trackId: string): string {
  const hash = createHash('sha256');
  let segment: number | null = null;
  for (const point of trackRepo.listTrackPoints(db, trackId)) {
    if (segment !== null && point.segmentIndex !== segment) hash.update('|');
    segment = point.segmentIndex;
    hash.update(`${text(point.lat)},${text(point.lon)},${text(point.eleM)},${text(point.recordedAt)};`);
  }
  return hash.digest('hex');
}
