import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type {
  DurationKind,
  LegMode,
  OtherTransport,
  Itinerary,
  ItineraryPatch,
  ItineraryStop,
  StopPatch,
  VehicleEnergy,
} from '@shared/domain/itinerary';
import type { Db } from '../client';
import { itineraries, itineraryStops } from '../schema';

/**
 * Storage for a trip's itinerary and its stops. Phase 10, ADR 0019 §2.
 *
 * Plain reads and writes. Validation, ordering rules and undo live in
 * `services/itineraryService.ts`.
 */

function rowToItinerary(row: typeof itineraries.$inferSelect): Itinerary {
  return {
    tripId: row.tripId,
    startDate: row.startDate,
    startTime: row.startTime,
    defaultDepart: row.defaultDepart,
    maxDriveMinutes: row.maxDriveMinutes ?? null,
    rangeKm: row.rangeKm ?? null,
    reservePct: row.reservePct,
    energy: row.energy as VehicleEnergy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToStop(row: typeof itineraryStops.$inferSelect): ItineraryStop {
  return {
    id: row.id,
    tripId: row.tripId,
    seq: row.seq,
    waypointId: row.waypointId,
    legRouteId: row.legRouteId ?? null,
    legMode: row.legMode as LegMode,
    legTransport: (row.legTransport ?? null) as OtherTransport | null,
    legMinutes: row.legMinutes ?? null,
    legLabel: row.legLabel ?? null,
    durationKind: row.durationKind as DurationKind,
    durationMinutes: row.durationMinutes ?? null,
    durationDays: row.durationDays ?? null,
    departTime: row.departTime ?? null,
    arriveBy: row.arriveBy ?? null,
    departAt: row.departAt ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function findItinerary(db: Db, tripId: string): Itinerary | null {
  const row = db.select().from(itineraries).where(eq(itineraries.tripId, tripId)).get();
  return row === undefined ? null : rowToItinerary(row);
}

/** Every itinerary, for the library tree's date ranges. */
export function listItineraries(db: Db): Itinerary[] {
  return db.select().from(itineraries).all().map(rowToItinerary);
}

export interface InsertItineraryValues {
  tripId: string;
  startDate: string;
  startTime: string;
  defaultDepart: string;
  maxDriveMinutes: number | null;
  rangeKm: number | null;
  reservePct: number;
  energy: VehicleEnergy;
  /** Kept on restore, so an undone removal is indistinguishable from none. */
  createdAt?: number;
  now: number;
}

export function insertItinerary(db: Db, values: InsertItineraryValues): Itinerary {
  db.insert(itineraries)
    .values({
      tripId: values.tripId,
      startDate: values.startDate,
      startTime: values.startTime,
      defaultDepart: values.defaultDepart,
      maxDriveMinutes: values.maxDriveMinutes,
      rangeKm: values.rangeKm,
      reservePct: values.reservePct,
      energy: values.energy,
      createdAt: values.createdAt ?? values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findItinerary(db, values.tripId);
  if (created === null) throw new Error('Itinerary insert did not persist');
  return created;
}

export function updateItinerary(db: Db, tripId: string, patch: ItineraryPatch, now: number): void {
  db.update(itineraries)
    .set({ ...patch, updatedAt: now })
    .where(eq(itineraries.tripId, tripId))
    .run();
}

/** Deletes the itinerary; its stops go with it by cascade. */
export function deleteItinerary(db: Db, tripId: string): void {
  db.delete(itineraries).where(eq(itineraries.tripId, tripId)).run();
}

export function listStops(db: Db, tripId: string): ItineraryStop[] {
  return db
    .select()
    .from(itineraryStops)
    .where(eq(itineraryStops.tripId, tripId))
    .orderBy(asc(itineraryStops.seq))
    .all()
    .map(rowToStop);
}

export function findStop(db: Db, id: string): ItineraryStop | null {
  const row = db.select().from(itineraryStops).where(eq(itineraryStops.id, id)).get();
  return row === undefined ? null : rowToStop(row);
}

export interface InsertStopValues {
  id?: string;
  tripId: string;
  seq: number;
  waypointId: string;
  legRouteId: string | null;
  legMode?: LegMode;
  legTransport?: OtherTransport | null;
  legMinutes?: number | null;
  legLabel?: string | null;
  durationKind: DurationKind;
  durationMinutes: number | null;
  durationDays: number | null;
  departTime: string | null;
  arriveBy: string | null;
  departAt: string | null;
  notes: string | null;
  createdAt?: number;
  now: number;
}

export function insertStop(db: Db, values: InsertStopValues): ItineraryStop {
  const id = values.id ?? randomUUID();
  db.insert(itineraryStops)
    .values({
      id,
      tripId: values.tripId,
      seq: values.seq,
      waypointId: values.waypointId,
      legRouteId: values.legRouteId,
      legMode: values.legMode ?? 'road',
      legTransport: values.legTransport ?? null,
      legMinutes: values.legMinutes ?? null,
      legLabel: values.legLabel ?? null,
      durationKind: values.durationKind,
      durationMinutes: values.durationMinutes,
      durationDays: values.durationDays,
      departTime: values.departTime,
      arriveBy: values.arriveBy,
      departAt: values.departAt,
      notes: values.notes,
      createdAt: values.createdAt ?? values.now,
      updatedAt: values.now,
    })
    .run();
  const created = findStop(db, id);
  if (created === null) throw new Error('Stop insert did not persist');
  return created;
}

export function updateStop(
  db: Db,
  id: string,
  patch: StopPatch & {
    legRouteId?: string | null;
    seq?: number;
    legMode?: LegMode;
    legTransport?: OtherTransport | null;
    legMinutes?: number | null;
    legLabel?: string | null;
  },
  now: number,
): void {
  db.update(itineraryStops)
    .set({ ...patch, updatedAt: now })
    .where(eq(itineraryStops.id, id))
    .run();
}

/** Trips whose itinerary uses a waypoint as a stop. */
export function tripIdsForWaypoint(db: Db, waypointId: string): string[] {
  const rows = db
    .select({ tripId: itineraryStops.tripId })
    .from(itineraryStops)
    .where(eq(itineraryStops.waypointId, waypointId))
    .all();
  return [...new Set(rows.map((row) => row.tripId))];
}

export function deleteStop(db: Db, id: string): void {
  db.delete(itineraryStops).where(eq(itineraryStops.id, id)).run();
}

/** Rewrites `seq` to 0…n−1 in the given order. Ids not in the trip are ignored. */
export function resequence(db: Db, orderedIds: readonly string[]): void {
  for (const [seq, id] of orderedIds.entries()) {
    db.update(itineraryStops).set({ seq }).where(eq(itineraryStops.id, id)).run();
  }
}
