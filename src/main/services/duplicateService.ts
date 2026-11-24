import {
  DUPLICATE_UNDO_POINTS,
  groupDuplicates,
  type DuplicateItem,
  type DuplicateKind,
  type DuplicateOutcome,
  type DuplicateReport,
} from '@shared/library/duplicates';
import type { Db } from '../db/client';
import * as itineraryRepo from '../db/repositories/itineraries';
import * as routeRepo from '../db/repositories/routes';
import * as trackRepo from '../db/repositories/tracks';
import * as tripRepo from '../db/repositories/trips';
import * as waypointRepo from '../db/repositories/waypoints';
import { routeKey, trackKey, waypointKey } from './contentKeys';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as routeService from './routeService';
import { LOOSE_TRIP_NAME } from './tripService';
import * as waypointService from './waypointService';

/**
 * Remove duplicates by content (Phase 14 Requirement 28, ADR 0027).
 *
 * `find` compares every route, track or waypoint in the trips the library
 * shows and returns groups with the same content, choosing the copy that
 * stays. `remove` removes chosen copies as one undo step, checking each pair
 * again first, because the library may have changed while the dialog was
 * open. A removed track is undone by rebuilding it from the copy kept, which
 * is what makes it undoable where an ordinary track deletion is not.
 */

/** How many copies one removal may take: past any library seen, and one transaction. */
export const MAX_DUPLICATE_REMOVALS = 10_000;

interface Listed {
  id: string;
  name: string;
  tripId: string;
  createdAt: number;
  pointCount: number;
}

/** The trips the library shows, by id, with the holder of items outside a trip. */
function shownTrips(db: Db, includeArchived: boolean): { names: Map<string, string>; looseId: string | null } {
  const names = new Map(
    tripRepo
      .listTrips(db, { includeArchived, sortKey: 'name', sortDirection: 'asc' })
      .map((trip) => [trip.id, trip.name] as const),
  );
  const looseId = tripRepo.findLooseTripId(db);
  if (looseId !== null) names.set(looseId, LOOSE_TRIP_NAME);
  return { names, looseId };
}

/**
 * Tracks with the same content, read in full only where they could match:
 * the same real point count, and the same first and last point.
 */
function trackKeys(db: Db, tracks: readonly Listed[]): Map<string, string> {
  const counts = trackRepo.pointCounts(db);
  const byCount = new Map<number, string[]>();
  for (const track of tracks) {
    const n = counts.get(track.id) ?? 0;
    byCount.set(n, [...(byCount.get(n) ?? []), track.id]);
  }
  const keys = new Map<string, string>();
  for (const [n, ids] of byCount) {
    if (ids.length < 2) continue;
    const byEnds = new Map<string, string[]>();
    for (const id of ids) {
      const start = trackRepo.startPoint(db, id);
      const end = trackRepo.endPoint(db, id);
      const ends = `${n}|${start?.lat},${start?.lon}|${end?.lat},${end?.lon}`;
      byEnds.set(ends, [...(byEnds.get(ends) ?? []), id]);
    }
    for (const candidates of byEnds.values()) {
      if (candidates.length < 2) continue;
      for (const id of candidates) keys.set(id, trackKey(db, id));
    }
  }
  return keys;
}

export function find(db: Db, kind: DuplicateKind, includeArchived: boolean): DuplicateReport {
  const { names, looseId } = shownTrips(db, includeArchived);
  const plans = itineraryRepo.idsInPlans(db);

  const listed: Listed[] = (() => {
    switch (kind) {
      case 'route':
        return routeRepo.listAllRoutes(db).map((r) => ({ id: r.id, name: r.name, tripId: r.tripId, createdAt: r.createdAt, pointCount: r.pointCount }));
      case 'track':
        return trackRepo.listAllTracks(db).map((t) => ({ id: t.id, name: t.name, tripId: t.tripId, createdAt: t.createdAt, pointCount: 0 }));
      case 'waypoint':
        return waypointRepo.listAllWaypoints(db).map((w) => ({ id: w.id, name: w.name, tripId: w.tripId, createdAt: w.createdAt, pointCount: 0 }));
    }
  })().filter((item) => names.has(item.tripId));

  const keyOf = ((): ((id: string) => string) => {
    switch (kind) {
      case 'route':
        return (id) => routeKey(db, id);
      case 'track': {
        const keys = trackKeys(db, listed);
        // A track with no possible match keys as itself.
        return (id) => keys.get(id) ?? `only:${id}`;
      }
      case 'waypoint': {
        const all = new Map(waypointRepo.listAllWaypoints(db).map((w) => [w.id, w]));
        return (id) => {
          const w = all.get(id);
          return w === undefined ? `only:${id}` : waypointKey(w);
        };
      }
    }
  })();

  const used = kind === 'waypoint' ? plans.waypoints : kind === 'route' ? plans.routes : new Set<string>();
  const items = listed.map(
    (item): DuplicateItem & { key: string } => ({
      ...item,
      key: keyOf(item.id),
      tripName: names.get(item.tripId) ?? '',
      loose: item.tripId === looseId,
      inPlan: used.has(item.id),
    }),
  );
  return { kind, compared: items.length, groups: groupDuplicates(items) };
}

// ------------------------------------------------------------- removing

/** The key of an item still in the library, or null when it has gone. */
function currentKey(db: Db, kind: DuplicateKind, id: string): string | null {
  switch (kind) {
    case 'route':
      return routeRepo.findRoute(db, id) === null ? null : routeKey(db, id);
    case 'track':
      return trackRepo.findTrack(db, id) === null ? null : trackKey(db, id);
    case 'waypoint': {
      const waypoint = waypointRepo.findWaypoint(db, id);
      return waypoint === null ? null : waypointKey(waypoint);
    }
  }
}

/**
 * Removes the chosen copies as one undo step. Each pair is checked again
 * inside the transaction: both still there, still the same, the copy not used
 * by a plan and not itself kept by another pair. A pair that fails is skipped
 * and counted, never removed (Requirement 28.7).
 */
export function remove(
  db: Db,
  kind: DuplicateKind,
  removals: readonly { id: string; keepId: string }[],
): Mutation<DuplicateOutcome> {
  if (removals.length > MAX_DUPLICATE_REMOVALS) {
    throw new ServiceError('INVALID_REQUEST', `That is ${removals.length.toLocaleString('en-GB')} copies; at most ${MAX_DUPLICATE_REMOVALS.toLocaleString('en-GB')} can be removed at once.`);
  }
  const plans = itineraryRepo.idsInPlans(db);
  const used = kind === 'waypoint' ? plans.waypoints : kind === 'route' ? plans.routes : new Set<string>();
  const removing = new Set(removals.map((r) => r.id));

  return db.transaction(() => {
    const keys = new Map<string, string | null>();
    const key = (id: string): string | null => {
      if (!keys.has(id)) keys.set(id, currentKey(db, kind, id));
      return keys.get(id) ?? null;
    };

    let skipped = 0;
    let carried = 0;
    const done = new Set<string>();
    const inverses: Mutation<unknown>['inverse'][] = [];
    for (const { id, keepId } of removals) {
      const own = key(id);
      if (id === keepId || done.has(id) || removing.has(keepId) || used.has(id) || own === null || own !== key(keepId)) {
        skipped += 1;
        continue;
      }
      done.add(id);
      switch (kind) {
        case 'route':
          carried += routeRepo.findRoute(db, id)?.pointCount ?? 0;
          inverses.push(routeService.remove(db, id).inverse);
          break;
        case 'waypoint':
          inverses.push(waypointService.remove(db, id).inverse);
          break;
        case 'track':
          inverses.push(removeTrackCopy(db, id, keepId, own).inverse);
          break;
      }
    }

    // As for a batch delete: past the bound the step is not undoable at all,
    // rather than undoing a part of what the user confirmed as one action.
    const undoable = inverses.length > 0 && carried <= DUPLICATE_UNDO_POINTS;
    return {
      result: { removed: done.size, skipped, undoable },
      inverse: undoable ? { kind: 'batch', payload: { commands: inverses.toReversed() } } : { kind: 'none', payload: {} },
    };
  });
}

// -------------------------------------------------- tracks, undoably

/** A file a removed track was read from, with its bytes only when the removal deletes it. */
interface CarriedSource {
  hash: string;
  file: { format: string; bytes: Uint8Array } | null;
}

/**
 * Removes a track that is a copy of `keepId`, whose key the caller checked.
 * The inverse carries the row, not the points: undo copies them from the kept
 * track (ADR 0027).
 */
function removeTrackCopy(db: Db, id: string, keepId: string, key: string): Mutation<{ id: string }> {
  const raw = trackRepo.rawTrack(db, id);
  if (raw === null) throw new ServiceError('NOT_FOUND', 'That track no longer exists.');
  // The file goes with its last track (migration 0011's trigger), so its bytes
  // ride along only then. Copies imported from one file share it.
  const sources: CarriedSource[] = trackRepo.sourceHashes(db, id).map((hash) => ({
    hash,
    file: trackRepo.sourceLinkCount(db, hash) === 1 ? trackRepo.sourceFile(db, hash) : null,
  }));
  const { renderGeometry: _cache, ...row } = raw;
  trackRepo.deleteTrack(db, id);
  return {
    result: { id },
    inverse: { kind: 'track:restoreDuplicate', payload: { row, keepId, key, sources } },
  };
}

/** Redo of a restore: removes the copy again, if it is still the same as the kept track. */
export function removeDuplicateTrack(db: Db, id: string, keepId: string): Mutation<{ id: string }> {
  const own = trackRepo.findTrack(db, id) === null ? null : trackKey(db, id);
  if (own === null) throw new ServiceError('NOT_FOUND', 'That track no longer exists.');
  if (trackRepo.findTrack(db, keepId) === null || trackKey(db, keepId) !== own) {
    throw new ServiceError('BLOCKED', 'That track is no longer the same as the copy that was kept, so it was not removed again.');
  }
  return db.transaction(() => removeTrackCopy(db, id, keepId, own));
}

export interface TrackCopyPayload {
  row: Omit<trackRepo.RawTrackRow, 'renderGeometry'>;
  keepId: string;
  key: string;
  sources: CarriedSource[];
}

function bad(detail: string): ServiceError {
  return new ServiceError('UNKNOWN', 'An undo step was malformed and was not applied.', detail);
}

/** Reads a restore payload this process built, checking its shape before anything is written. */
export function readTrackCopy(payload: Record<string, unknown>): TrackCopyPayload {
  const row = payload.row;
  if (typeof row !== 'object' || row === null) throw bad('expected a track row');
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.tripId !== 'string' || typeof r.name !== 'string') throw bad('a track row needs an id, trip and name');
  if (typeof payload.keepId !== 'string' || typeof payload.key !== 'string') throw bad('expected keepId and key');
  if (!Array.isArray(payload.sources)) throw bad('expected sources');
  const sources = payload.sources.map((entry): CarriedSource => {
    const s = entry as Record<string, unknown>;
    if (typeof s.hash !== 'string') throw bad('a source needs a hash');
    const file = s.file as { format?: unknown; bytes?: unknown } | null;
    if (file === null || file === undefined) return { hash: s.hash, file: null };
    if (typeof file.format !== 'string' || !(file.bytes instanceof Uint8Array)) throw bad('a carried file needs a format and bytes');
    return { hash: s.hash, file: { format: file.format, bytes: file.bytes } };
  });
  return { row: row as TrackCopyPayload['row'], keepId: payload.keepId, key: payload.key, sources };
}

/**
 * Undo of a duplicate track's removal: the row as it was, the kept track's
 * points copied with their segment and sequence numbers, its render cache,
 * and the original file linked again. Refuses with a reason when the kept
 * track has gone or changed, since its points would no longer be this copy's.
 */
export function restoreDuplicateTrack(db: Db, input: TrackCopyPayload): Mutation<{ id: string }> {
  const { row, keepId, key, sources } = input;
  const keep = trackRepo.rawTrack(db, keepId);
  if (keep === null) {
    throw new ServiceError('BLOCKED', `"${row.name}" cannot be put back: the copy that was kept in its place has since been deleted.`);
  }
  if (trackKey(db, keepId) !== key) {
    throw new ServiceError('BLOCKED', `"${row.name}" cannot be put back: the copy that was kept in its place has changed since, so its points are no longer the same.`);
  }
  if (tripRepo.findTrip(db, row.tripId) === null) {
    throw new ServiceError('BLOCKED', `"${row.name}" cannot be put back: its trip has been deleted.`);
  }
  if (trackRepo.findTrack(db, row.id) !== null) {
    throw new ServiceError('BLOCKED', `"${row.name}" is already back.`);
  }
  db.transaction(() => {
    trackRepo.insertRawTrack(db, { ...row, renderGeometry: keep.renderGeometry });
    trackRepo.copyTrackPoints(db, keepId, row.id);
    const now = Date.now();
    for (const source of sources) {
      if (trackRepo.sourceFile(db, source.hash) !== null) {
        trackRepo.linkTrackSource(db, row.id, source.hash, now);
      } else if (source.file !== null) {
        trackRepo.insertTrackSource(db, { trackId: row.id, format: source.file.format, contentHash: source.hash, bytes: source.file.bytes, now });
      }
    }
  });
  return {
    result: { id: row.id },
    inverse: { kind: 'track:removeDuplicate', payload: { id: row.id, keepId } },
  };
}
