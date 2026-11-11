import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { LatLon } from '@shared/geo/distance';
import { isControlRole, type ControlRole } from '@shared/routing/RoutingProvider';
import type { Db } from '../client';
import { routeControlPoints } from '../schema';

/**
 * The points the user placed, as opposed to the shape that gets drawn.
 *
 * Kept apart from `route_points` because they answer different questions.
 * `route_points` is "what geometry does this route have" — the road shape after
 * a snap. This table is "what did the user ask for", which is what lets a
 * single moved control point re-snap one leg rather than the whole route.
 *
 * **Absence is meaningful.** No rows means the route was hand-drawn and never
 * snapped, and in that case `route_points` already is the user's own intent.
 * That is what keeps every route created before Phase 4 behaving exactly as it
 * did.
 */

export function listControlPoints(db: Db, routeId: string): LatLon[] {
  return db
    .select({ lat: routeControlPoints.lat, lon: routeControlPoints.lon })
    .from(routeControlPoints)
    .where(eq(routeControlPoints.routeId, routeId))
    .orderBy(asc(routeControlPoints.seq))
    .all();
}

/** A stored control point with its role and leg boundary. Phase 6. */
export interface ControlRow {
  lat: number;
  lon: number;
  role: ControlRole;
  /** Null for routes snapped before Phase 6: boundaries unknown. */
  shapeIndex: number | null;
}

/** What a writer supplies. Role defaults to `via`, boundary to unknown. */
export type ControlInput = LatLon & {
  role?: ControlRole | undefined;
  shapeIndex?: number | null | undefined;
};

export function listControlRows(db: Db, routeId: string): ControlRow[] {
  return db
    .select({
      lat: routeControlPoints.lat,
      lon: routeControlPoints.lon,
      role: routeControlPoints.role,
      shapeIndex: routeControlPoints.shapeIndex,
    })
    .from(routeControlPoints)
    .where(eq(routeControlPoints.routeId, routeId))
    .orderBy(asc(routeControlPoints.seq))
    .all()
    .map((row) => ({
      lat: row.lat,
      lon: row.lon,
      // A value this build does not recognise is read as `via`: the safe
      // reading, since a via point is routed as an ordinary stop.
      role: isControlRole(row.role) ? row.role : 'via',
      shapeIndex: row.shapeIndex,
    }));
}

export function hasControlPoints(db: Db, routeId: string): boolean {
  return (
    db
      .select({ seq: routeControlPoints.seq })
      .from(routeControlPoints)
      .where(eq(routeControlPoints.routeId, routeId))
      .limit(1)
      .get() !== undefined
  );
}

/**
 * Replaces a route's control points.
 *
 * Delete-then-insert rather than a diff: the sequence is dense and
 * unique-constrained, so an in-place update would have to juggle temporary
 * `seq` values to avoid tripping the constraint mid-way. Control-point counts
 * are tens, not thousands, so there is nothing to gain from being clever.
 *
 * Must run inside the caller's transaction.
 */
export function replaceControlPoints(
  db: Db,
  routeId: string,
  points: readonly ControlInput[],
): void {
  db.delete(routeControlPoints)
    .where(eq(routeControlPoints.routeId, routeId))
    .run();

  if (points.length === 0) return;

  const rows = points.map((point, seq) => ({
    id: randomUUID(),
    routeId,
    seq,
    lat: point.lat,
    lon: point.lon,
    role: point.role ?? 'via',
    shapeIndex: point.shapeIndex ?? null,
  }));

  // Chunked for the same reason as replaceTrackPoints and replacePoints:
  // SQLite bounds bound variables per statement (`SQLITE_MAX_VARIABLE_NUMBER`,
  // 32,766 by default), and seven columns times a long control-point list
  // exceeds it.
  const CHUNK = 1000;
  for (let start = 0; start < rows.length; start += CHUNK) {
    db.insert(routeControlPoints)
      .values(rows.slice(start, start + CHUNK))
      .run();
  }
}

/** Drops the control points, returning a snapped route to hand-drawn status. */
export function clearControlPoints(db: Db, routeId: string): void {
  db.delete(routeControlPoints)
    .where(eq(routeControlPoints.routeId, routeId))
    .run();
}
