import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  SortDirection,
  Trip,
  TripSortKey,
  TripStatus,
  TripWithCounts,
} from '@shared/domain/types';
import type { Db } from '../client';
import { encodeMetadata } from '../metadata';
import { trips } from '../schema';

export function rowToTrip(row: typeof trips.$inferSelect): Trip {
  return {
    id: row.id,
    folderId: row.folderId ?? null,
    name: row.name,
    description: row.description ?? null,
    notes: row.notes ?? null,
    status: row.status as TripStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Correlated child counts.
 *
 * Written with explicit table aliases rather than interpolated drizzle column
 * objects. Interpolating `${waypoints.tripId}` renders an *unqualified*
 * `"trip_id"`, which inside the subquery resolves against `waypoints` itself —
 * producing `where "trip_id" = "id"`, a comparison of a waypoint's trip to its
 * own id, which is never true and silently yields 0. Aliasing removes the
 * ambiguity entirely.
 */
const countsSelect = {
  routeCount: sql<number>`(select count(*) from routes r where r.trip_id = trips.id)`,
  trackCount: sql<number>`(select count(*) from tracks tr where tr.trip_id = trips.id)`,
  waypointCount: sql<number>`(select count(*) from waypoints w where w.trip_id = trips.id)`,
};

function orderFor(key: TripSortKey, direction: SortDirection) {
  const column =
    key === 'name'
      ? trips.name
      : key === 'createdAt'
        ? trips.createdAt
        : trips.updatedAt;
  return direction === 'asc' ? asc(column) : desc(column);
}

export interface ListTripsOptions {
  folderId?: string | null | undefined;
  /** ADR 0022: the holder of items outside a trip is left out unless asked for. */
  includeLoose?: boolean | undefined;
  includeArchived: boolean;
  sortKey: TripSortKey;
  sortDirection: SortDirection;
}

export function listTrips(db: Db, options: ListTripsOptions): TripWithCounts[] {
  const filters = [];
  if (options.includeLoose !== true) filters.push(eq(trips.role, 'trip'));
  if (!options.includeArchived) filters.push(eq(trips.status, 'active'));
  if (options.folderId !== undefined) {
    filters.push(
      options.folderId === null
        ? isNull(trips.folderId)
        : eq(trips.folderId, options.folderId),
    );
  }

  const rows = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(orderFor(options.sortKey, options.sortDirection))
    .all();

  return rows.map((r) => ({
    ...rowToTrip(r.trip),
    routeCount: r.routeCount,
    trackCount: r.trackCount,
    waypointCount: r.waypointCount,
  }));
}

export function findTrip(db: Db, id: string): Trip | null {
  const row = db.select().from(trips).where(eq(trips.id, id)).get();
  return row ? rowToTrip(row) : null;
}

export function findTripWithCounts(db: Db, id: string): TripWithCounts | null {
  const row = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(eq(trips.id, id))
    .get();
  if (!row) return null;
  return {
    ...rowToTrip(row.trip),
    routeCount: row.routeCount,
    trackCount: row.trackCount,
    waypointCount: row.waypointCount,
  };
}

/**
 * Phase 14 Requirement 20: `pattern` is a regular expression, matched anywhere
 * in the name and ignoring case, by the `regexp` function `createDatabase`
 * registers. It has been checked with `compileNamePattern` already.
 */
export function searchTrips(db: Db, pattern: string): TripWithCounts[] {
  const rows = db
    .select({ trip: trips, ...countsSelect })
    .from(trips)
    .where(and(eq(trips.role, 'trip'), sql`${trips.name} REGEXP ${pattern}`))
    .orderBy(asc(trips.name))
    .all();
  return rows.map((r) => ({
    ...rowToTrip(r.trip),
    routeCount: r.routeCount,
    trackCount: r.trackCount,
    waypointCount: r.waypointCount,
  }));
}

/** ADR 0022: the id of the holder of items outside a trip, or null before it is first needed. */
export function findLooseTripId(db: Db): string | null {
  const row = db.select({ id: trips.id }).from(trips).where(eq(trips.role, 'loose')).get();
  return row?.id ?? null;
}

export interface InsertTripValues {
  /** ADR 0022. Defaults to an ordinary trip. */
  role?: 'trip' | 'loose' | undefined;
  id: string;
  folderId: string | null;
  name: string;
  description: string | null;
  notes: string | null;
  status?: TripStatus;
  /** Imported fields with no column of their own. See db/metadata.ts. */
  metadata?: Record<string, unknown> | undefined;
  now: number;
}

export function insertTrip(db: Db, values: InsertTripValues): Trip {
  db.insert(trips)
    .values({
      id: values.id,
      folderId: values.folderId,
      name: values.name,
      description: values.description,
      notes: values.notes,
      status: values.status ?? 'active',
      // Written only for the holder, so the column's default does the rest and
      // an upgrade test on a pre-0007 database can still insert a trip.
      ...(values.role === undefined ? {} : { role: values.role }),
      metadata: encodeMetadata(values.metadata),
      createdAt: values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findTrip(db, values.id);
  if (created === null) {
    throw new Error(`Trip ${values.id} vanished immediately after insert`);
  }
  return created;
}

export interface TripPatch {
  name?: string;
  description?: string | null;
  notes?: string | null;
  folderId?: string | null;
  status?: TripStatus;
}

export function updateTrip(
  db: Db,
  id: string,
  patch: TripPatch,
  now: number,
): void {
  const set: Record<string, unknown> = { updatedAt: now };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.folderId !== undefined) set.folderId = patch.folderId;
  if (patch.status !== undefined) set.status = patch.status;
  db.update(trips).set(set).where(eq(trips.id, id)).run();
}

export function deleteTrip(db: Db, id: string): void {
  db.delete(trips).where(eq(trips.id, id)).run();
}

export function tripChildCounts(
  db: Db,
  id: string,
): { routeCount: number; trackCount: number; waypointCount: number } {
  const row = db
    .select(countsSelect)
    .from(trips)
    .where(eq(trips.id, id))
    .get();
  return {
    routeCount: row?.routeCount ?? 0,
    trackCount: row?.trackCount ?? 0,
    waypointCount: row?.waypointCount ?? 0,
  };
}
