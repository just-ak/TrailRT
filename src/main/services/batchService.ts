import type {
  BatchAssessment,
  BatchKind,
  BatchMember,
  BatchOperation,
  BatchOutcome,
} from '@shared/domain/types';
import type { Db } from '../db/client';
import * as routeRepo from '../db/repositories/routes';
import * as trackRepo from '../db/repositories/tracks';
import * as tripRepo from '../db/repositories/trips';
import * as waypointRepo from '../db/repositories/waypoints';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as routeService from './routeService';
import * as trackService from './trackService';
import * as waypointService from './waypointService';

/**
 * Batch move and delete.
 *
 * Composed from the existing single-object mutations rather than
 * reimplemented: the per-object services already know how to invert
 * themselves, and duplicating that here would give two definitions of what
 * deleting a route means. This module's whole job is to collect those
 * mutations into one transaction, one undo entry, one library notification —
 * see ADR 0014 for why looping an existing channel is not good enough.
 *
 * The assessment is the interesting part. A batch can be partly
 * irreversible — a track deletion cannot be undone, per ADR 0003 — and
 * Requirement 2.5 says that has to be stated *before* the action. So the same
 * function answers the dry run and gates the real one, which is what stops the
 * warning and the outcome from disagreeing.
 */

/**
 * How many objects one batch may touch.
 *
 * Chosen rather than derived: 500 is far past any plausible hand-made
 * selection, keeps one transaction brief, and keeps the refusal message
 * concrete ("that is 1,240 objects") instead of vague. Requirement 2.9 asks
 * for a bound and for it to be stated; this is it.
 */
export const MAX_BATCH_MEMBERS = 500;

/**
 * How many points a single batch undo entry will carry.
 *
 * A deleted route's inverse holds its whole point array, so a batch of 500
 * routes at the 10,000-point cap would be millions of points on one stack
 * entry. Past this the deletion still happens, but it is recorded as not
 * undoable and the assessment says so first. Counting the real cost beats
 * bounding the member count alone, because the member count is a poor proxy.
 */
export const MAX_BATCH_UNDO_POINTS = 250_000;

const EMPTY_COUNTS: Record<BatchKind, number> = {
  route: 0,
  track: 0,
  waypoint: 0,
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "3 routes and 1 track", for a message or a menu label. */
export function describeCounts(counts: Record<BatchKind, number>): string {
  const parts = (['route', 'track', 'waypoint'] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => plural(counts[kind], kind));

  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`;
}

/** The Edit-menu label for a batch: "Undo delete 3 routes and 1 track". */
export function labelFor(
  operation: BatchOperation,
  counts: Record<BatchKind, number>,
): string {
  return `${operation === 'delete' ? 'delete' : 'move'} ${describeCounts(counts)}`;
}

function dedupe(members: readonly BatchMember[]): BatchMember[] {
  const seen = new Set<string>();
  const unique: BatchMember[] = [];
  for (const member of members) {
    const key = `${member.kind}:${member.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(member);
  }
  return unique;
}

interface Resolved {
  member: BatchMember;
  /** Points the object holds. Drives both bounds. */
  pointCount: number;
}

/**
 * Looks each member up, cheaply.
 *
 * Row reads, not full objects: `pointCount` is a cached column on both routes
 * and tracks, so assessing 500 members costs 500 indexed lookups rather than
 * reading every point of every one of them.
 */
function resolve(
  db: Db,
  members: readonly BatchMember[],
): { present: Resolved[]; missing: BatchMember[] } {
  const present: Resolved[] = [];
  const missing: BatchMember[] = [];

  for (const member of members) {
    switch (member.kind) {
      case 'route': {
        const row = routeRepo.findRoute(db, member.id);
        if (row === null) missing.push(member);
        else present.push({ member, pointCount: row.pointCount });
        break;
      }
      case 'track': {
        const row = trackRepo.findTrack(db, member.id);
        if (row === null) missing.push(member);
        else present.push({ member, pointCount: row.pointCount });
        break;
      }
      case 'waypoint': {
        const row = waypointRepo.findWaypoint(db, member.id);
        if (row === null) missing.push(member);
        // A waypoint is a single position; it carries no point array.
        else present.push({ member, pointCount: 0 });
        break;
      }
    }
  }

  return { present, missing };
}

function countsOf(resolved: readonly Resolved[]): Record<BatchKind, number> {
  const counts = { ...EMPTY_COUNTS };
  for (const entry of resolved) counts[entry.member.kind] += 1;
  return counts;
}

function assertWithinBound(total: number): void {
  if (total <= MAX_BATCH_MEMBERS) return;
  throw new ServiceError(
    'INVALID_REQUEST',
    `That is ${total} objects, and a single batch is limited to ${MAX_BATCH_MEMBERS}. Select fewer and repeat.`,
  );
}

interface Plan {
  assessment: BatchAssessment;
  present: Resolved[];
  /**
   * True when the inverse was dropped because of its size rather than because
   * of what it contained. Kept out of the public assessment: the UI only needs
   * "not undoable, and here is why", while the mutation needs to know whether
   * to record a partial inverse or none at all.
   */
  tooHeavy: boolean;
}

function plan(
  db: Db,
  members: readonly BatchMember[],
  operation: BatchOperation,
): Plan {
  const unique = dedupe(members);
  assertWithinBound(unique.length);

  const { present, missing } = resolve(db, unique);
  const counts = countsOf(present);

  // Moves are always reversible: every kind has a registered move inverse that
  // carries only the previous parent id.
  if (operation === 'move') {
    return {
      present,
      tooHeavy: false,
      assessment: {
        operation,
        counts,
        total: present.length,
        undoable: present.length > 0,
        notUndoable: [],
        irreversiblePoints: null,
        reason: null,
        missing,
      },
    };
  }

  // A track deletion is not undoable, by ADR 0003: the point array is too
  // large to carry on the stack, and the retained original file is the
  // recovery path when there is one.
  const notUndoable = present
    .filter((entry) => entry.member.kind === 'track')
    .map((entry) => entry.member);

  const irreversiblePoints = present
    .filter((entry) => entry.member.kind === 'track')
    .reduce((sum, entry) => sum + entry.pointCount, 0);

  const carriedPoints = present
    .filter((entry) => entry.member.kind === 'route')
    .reduce((sum, entry) => sum + entry.pointCount, 0);

  const tooHeavy = carriedPoints > MAX_BATCH_UNDO_POINTS;
  const reversible = present.length - notUndoable.length;

  const reason = (() => {
    if (tooHeavy) {
      return `These objects hold ${carriedPoints.toLocaleString()} points, past the ${MAX_BATCH_UNDO_POINTS.toLocaleString()} a single undo step carries, so this deletion cannot be reversed.`;
    }
    if (notUndoable.length === 0) return null;
    const tracks = plural(notUndoable.length, 'track');
    const points = irreversiblePoints.toLocaleString();
    return reversible === 0
      ? `Deleting ${tracks} cannot be undone. ${points} recorded points will be removed.`
      : `${reversible} of these can be restored by undoing. Deleting ${tracks} cannot be undone, and will remove ${points} recorded points.`;
  })();

  return {
    present,
    tooHeavy,
    assessment: {
      operation,
      counts,
      total: present.length,
      undoable: !tooHeavy && reversible > 0,
      notUndoable,
      irreversiblePoints: irreversiblePoints === 0 ? null : irreversiblePoints,
      reason,
      missing,
    },
  };
}

/**
 * What a batch would do. Reads only; records nothing.
 *
 * Backs the confirmation dialog, and the same calculation gates the real
 * mutation, which is what stops the warning and the outcome from disagreeing.
 * Deliberately **not** an error when a member has vanished — Requirement 1.9
 * makes that silent, because a library refresh racing a selection is ordinary
 * rather than exceptional.
 */
export function assess(
  db: Db,
  members: readonly BatchMember[],
  operation: BatchOperation,
): BatchAssessment {
  return plan(db, members, operation).assessment;
}

/**
 * Collects per-object mutations into one composite.
 *
 * Every child runs through the service that owns it, so a batch cannot apply a
 * mutation the single-object path would have refused, and the children invert
 * themselves exactly as they do singly.
 */
function compose(
  db: Db,
  built: Plan,
  apply: (db: Db, member: BatchMember) => Mutation<unknown>,
  verb: string,
): Mutation<BatchOutcome> {
  const { present, assessment, tooHeavy } = built;

  if (present.length === 0) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `None of those objects still exist, so nothing was ${verb}.`,
    );
  }

  // One transaction: a member that fails rolls the whole batch back, so it is
  // never half-applied (Requirement 2.4).
  const applied = db.transaction(() =>
    present.map((entry) => apply(db, entry.member)),
  );

  const inverses = applied
    .map((mutation) => mutation.inverse)
    .filter((inverse) => inverse.kind !== 'none')
    .toReversed();

  return {
    result: { ...assessment, applied: applied.length },
    inverse:
      // Recorded as entirely non-undoable when the payload would be too
      // heavy, rather than silently recording the light half: a partial undo
      // of a batch the user confirmed as one action is worse than none.
      tooHeavy || inverses.length === 0
        ? { kind: 'none', payload: {} }
        : { kind: 'batch', payload: { commands: inverses } },
  };
}

export function remove(
  db: Db,
  members: readonly BatchMember[],
): Mutation<BatchOutcome> {
  return compose(
    db,
    plan(db, members, 'delete'),
    (handle, member) => {
      switch (member.kind) {
        case 'route':
          return routeService.remove(handle, member.id);
        case 'track':
          return trackService.remove(handle, member.id);
        case 'waypoint':
          return waypointService.remove(handle, member.id);
      }
    },
    'deleted',
  );
}

export function moveToTrip(
  db: Db,
  members: readonly BatchMember[],
  tripId: string,
): Mutation<BatchOutcome> {
  if (tripRepo.findTrip(db, tripId) === null) throw notFound('That trip');

  return compose(
    db,
    plan(db, members, 'move'),
    (handle, member) => {
      switch (member.kind) {
        case 'route':
          return routeService.moveToTrip(handle, { id: member.id, tripId });
        case 'track':
          return trackService.moveToTrip(handle, { id: member.id, tripId });
        case 'waypoint':
          return waypointService.moveToTrip(handle, { id: member.id, tripId });
      }
    },
    'moved',
  );
}
