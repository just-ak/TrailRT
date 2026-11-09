import type { RoutePoint, TrackPoint } from '@shared/domain/types';
import type { Db } from '../db/client';
import { ServiceError } from './errors';
import * as folderService from './folderService';
import type { Mutation } from './folderService';
import * as routeService from './routeService';
import type { ControlInput } from '../db/repositories/routeControlPoints';
import * as shapingService from './shapingService';
import * as routingService from './routingService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as waypointService from './waypointService';

/**
 * The command registry: a `kind` string to the service call that applies it.
 *
 * This is what makes undo work without hand-written inverses. Every service
 * mutation returns `{ result, inverse: { kind, payload } }`, and because
 * applying a command here itself returns a `Mutation`, the inverse of the
 * inverse comes back for free. See the Phase 2 design.
 *
 * Payloads are produced by our own services and never arrive from the renderer
 * — undo and redo take no arguments — so they are trusted internal data rather
 * than user input. They are still shape-checked below, because a malformed
 * payload would otherwise corrupt data silently rather than failing loudly.
 */

export type CommandKind =
  | 'none'
  /**
   * Several commands applied as one. Its inverse is a batch of their inverses
   * in reverse order, so one ⌘Z unwinds the whole thing. See ADR 0014.
   */
  | 'batch'
  | 'trip:update'
  | 'trip:move'
  | 'trip:setStatus'
  | 'folder:rename'
  | 'folder:move'
  | 'route:update'
  | 'route:setGeometry'
  | 'route:reverse'
  | 'route:move'
  | 'route:delete'
  | 'route:restore'
  | 'route:restoreSnap'
  /**
   * Puts back the stretch of a snapped route that a shaping edit replaced,
   * with its control points. Symmetric: its inverse is another splice. Phase 6.
   */
  | 'route:spliceLegs'
  | 'waypoint:update'
  | 'waypoint:restorePosition'
  | 'waypoint:moveBack'
  | 'waypoint:delete'
  | 'waypoint:restore'
  /*
   * Track handlers.
   *
   * These were missing until Phase 5, and their absence was a live defect
   * rather than a decision: `trackService` has always returned these inverses,
   * `commit()` has always passed them to `record()`, and `record()` discarded
   * every one because `isUndoable` tests membership of this registry. So no
   * track rename, move, reverse or point deletion could be undone, while
   * `deletePointRange`'s own comment claimed its inverse was cheap to carry.
   *
   * Two kinds are deliberately **not** registered, so they stay honestly
   * non-undoable rather than appearing to work:
   *
   * - `track:delete`, per ADR 0003 — the point array is far too large to carry,
   *   and the retained original file is the recovery path.
   * - `track:join`, the inverse `split` emits. Join's own inverse is 'none', so
   *   registering it would make an undo succeed and the matching redo silently
   *   do nothing, which is worse than refusing both.
   */
  | 'track:update'
  | 'track:move'
  | 'track:reverse'
  | 'track:restorePoints'
  | 'track:deleteRange'
  | 'track:restorePointsAt'
  | 'track:deletePointsAt'
  | 'track:editPoint';

export interface Command {
  kind: string;
  payload: Record<string, unknown>;
}

type Handler = (db: Db, payload: Record<string, unknown>) => Mutation<unknown>;

/** Human labels for the Edit menu: "Undo move waypoint". */
const LABELS: Record<CommandKind, string> = {
  none: 'change',
  // A batch knows its own count and composition, which a flat record keyed by
  // kind cannot express. Callers pass an explicit label to `record()`; this is
  // only the fallback when one was not supplied.
  batch: 'batch change',
  'trip:update': 'trip edit',
  'trip:move': 'trip move',
  'trip:setStatus': 'trip archive',
  'folder:rename': 'folder rename',
  'folder:move': 'folder move',
  'route:update': 'route edit',
  'route:setGeometry': 'route edit',
  'route:reverse': 'route reverse',
  'route:move': 'route move',
  'route:delete': 'route delete',
  'route:restore': 'route delete',
  // Named for what undoing it does, which is what the Edit menu shows.
  'route:restoreSnap': 'snap to roads',
  'route:spliceLegs': 'route shaping',
  'waypoint:update': 'waypoint edit',
  'waypoint:restorePosition': 'waypoint move',
  'waypoint:moveBack': 'waypoint move',
  'waypoint:delete': 'waypoint delete',
  'waypoint:restore': 'waypoint delete',
  'track:update': 'track edit',
  'track:move': 'track move',
  'track:reverse': 'track reverse',
  // Both directions of a range deletion are named for the user's action, which
  // is what the Edit menu shows, not for the mechanism that reverses it.
  'track:restorePoints': 'point deletion',
  'track:deleteRange': 'point restore',
  'track:restorePointsAt': 'point deletion',
  'track:deletePointsAt': 'point restore',
  'track:editPoint': 'point edit',
};

export function labelFor(kind: string): string {
  return LABELS[kind as CommandKind] ?? 'change';
}

// ---------------------------------------------------------- payload readers

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected string at "${key}", got ${typeof value}`,
    );
  }
  return value;
}

function strOrNull(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected string or null at "${key}"`,
    );
  }
  return value;
}

function num(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      `expected finite number at "${key}"`,
    );
  }
  return value;
}

function numOrNull(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];
  if (value === null || value === undefined) return null;
  return num(payload, key);
}

function points(payload: Record<string, unknown>): RoutePoint[] {
  const value = payload.points;
  if (!Array.isArray(value)) {
    throw new ServiceError(
      'UNKNOWN',
      'An undo step was malformed and was not applied.',
      'expected a points array',
    );
  }
  return value as RoutePoint[];
}

function source(payload: Record<string, unknown>): 'user' | 'import' {
  return payload.source === 'import' ? 'import' : 'user';
}

function malformed(detail: string): ServiceError {
  return new ServiceError(
    'UNKNOWN',
    'An undo step was malformed and was not applied.',
    detail,
  );
}

function finiteOrNull(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(`expected finite number or null for ${what}`);
  }
  return value;
}

function trackPointOf(value: unknown): TrackPoint {
  if (typeof value !== 'object' || value === null) {
    throw malformed('expected a track point object');
  }
  const point = value as Record<string, unknown>;
  const lat = point.lat;
  const lon = point.lon;
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    typeof lon !== 'number' ||
    !Number.isFinite(lon)
  ) {
    throw malformed('a track point needs finite lat and lon');
  }
  return {
    lat,
    lon,
    // Absent stays absent: coercing a missing elevation to 0 would invent a
    // sea-level reading the recording never made.
    ele: finiteOrNull(point.ele, 'ele'),
    time: finiteOrNull(point.time, 'time'),
  };
}

function trackPoints(payload: Record<string, unknown>): TrackPoint[] {
  const value = payload.points;
  if (!Array.isArray(value)) throw malformed('expected a points array');
  return value.map(trackPointOf);
}

/** Saved points with the flat indices they occupied, ascending. */
function indexedTrackPoints(
  payload: Record<string, unknown>,
): (TrackPoint & { index: number })[] {
  const value = payload.points;
  if (!Array.isArray(value)) throw malformed('expected a points array');
  return value
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        throw malformed('expected an indexed point object');
      }
      const record = entry as Record<string, unknown>;
      return { index: num(record, 'index'), ...trackPointOf(record) };
    })
    .toSorted((a, b) => a.index - b.index);
}

function intArray(payload: Record<string, unknown>, key: string): number[] {
  const value = payload[key];
  if (!Array.isArray(value)) throw malformed(`expected an array at "${key}"`);
  return value.map((entry) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) {
      throw malformed(`expected integers at "${key}"`);
    }
    return entry;
  });
}

/**
 * The child commands of a batch.
 *
 * Shape-checked rather than trusted even though these are our own inverses:
 * a malformed child would otherwise be discovered half way through applying a
 * transaction, and the point of validating here is that nothing is applied.
 */
function commandList(payload: Record<string, unknown>): Command[] {
  const value = payload.commands;
  if (!Array.isArray(value)) throw malformed('expected a commands array');
  return value.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw malformed('expected a command object');
    }
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== 'string') throw malformed('a command needs a kind');
    const nested = record.payload;
    if (
      typeof nested !== 'object' ||
      nested === null ||
      Array.isArray(nested)
    ) {
      throw malformed('a command needs an object payload');
    }
    return { kind, payload: nested as Record<string, unknown> };
  });
}

// --------------------------------------------------------------- registry

const HANDLERS: Record<CommandKind, Handler> = {
  none: () => ({ result: null, inverse: { kind: 'none', payload: {} } }),

  /**
   * Applies several commands as one.
   *
   * Because `applyCommand` itself returns a `Mutation`, the inverse of a batch
   * is a batch — the same self-inverting trick single commands use, one level
   * up. Three details carry the weight:
   *
   * - **One transaction.** A member that fails rolls the whole thing back, so
   *   a batch is never half-applied (Requirement 2.4).
   * - **Reversed.** Undoing must unwind in the opposite order it applied, or a
   *   restore can run before the delete that made room for it.
   * - **'none' children are dropped from the inverse.** A track deletion
   *   cannot be reversed, so carrying a no-op for it would put a step on the
   *   stack that silently does nothing. The honest result is a batch that
   *   restores what it can, and an assessment that said so before the action.
   */
  batch: (db, p) => {
    const commands = commandList(p);

    const applied = db.transaction(() =>
      commands.map((command) => applyCommand(db, command)),
    );

    const inverses = applied
      .map((mutation) => mutation.inverse)
      .filter((inverse) => inverse.kind !== 'none')
      .toReversed();

    return {
      result: applied.map((mutation) => mutation.result),
      inverse:
        inverses.length === 0
          ? { kind: 'none', payload: {} }
          : { kind: 'batch', payload: { commands: inverses } },
    };
  },

  'trip:update': (db, p) =>
    tripService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      description: strOrNull(p, 'description'),
      notes: strOrNull(p, 'notes'),
    }),

  'trip:move': (db, p) =>
    tripService.move(db, { id: str(p, 'id'), folderId: strOrNull(p, 'folderId') }),

  'trip:setStatus': (db, p) =>
    tripService.setStatus(db, {
      id: str(p, 'id'),
      status: p.status === 'archived' ? 'archived' : 'active',
    }),

  'folder:rename': (db, p) =>
    folderService.rename(db, { id: str(p, 'id'), name: str(p, 'name') }),

  'folder:move': (db, p) =>
    folderService.move(db, {
      id: str(p, 'id'),
      parentId: strOrNull(p, 'parentId'),
    }),

  'route:update': (db, p) =>
    routeService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      colour: strOrNull(p, 'colour'),
    }),

  'route:setGeometry': (db, p) =>
    routeService.setGeometry(db, { id: str(p, 'id'), points: points(p) }),

  'route:reverse': (db, p) => routeService.reverse(db, str(p, 'id')),

  'route:move': (db, p) =>
    routeService.moveToTrip(db, { id: str(p, 'id'), tripId: str(p, 'tripId') }),

  'route:delete': (db, p) => routeService.remove(db, str(p, 'id')),

  /*
   * Restores a route's pre-snap geometry *and* its control-point state.
   *
   * `controlPoints: null` means the route was hand-drawn before the snap, and
   * restoring it must clear the control points rather than leave orphans — a
   * route with control points but no provider is a state no reader expects.
   */
  'route:restoreSnap': (db, p) =>
    routingService.restoreSnap(db, {
      id: str(p, 'id'),
      points: points(p),
      // Role and boundary ride along when the inverse recorded them (every
      // snap since Phase 6), so undo restores them exactly.
      controlPoints: Array.isArray(p.controlPoints)
        ? (p.controlPoints as ControlInput[])
        : null,
      metadata:
        typeof p.metadata === 'object' &&
        p.metadata !== null &&
        !Array.isArray(p.metadata)
          ? (p.metadata as Record<string, unknown>)
          : {},
    }),

  /*
   * Undo and redo of a shaping edit. The payload is one this process built in
   * `shapingService`, so the casts describe its own output rather than trust
   * anything from the renderer.
   */
  'route:spliceLegs': (db, p) =>
    shapingService.restoreSplice(db, {
      id: str(p, 'id'),
      fromShape: typeof p.fromShape === 'number' ? p.fromShape : -1,
      toShape: typeof p.toShape === 'number' ? p.toShape : -1,
      points: points(p),
      control: Array.isArray(p.control) ? (p.control as ControlInput[]) : [],
      metadata:
        typeof p.metadata === 'object' && p.metadata !== null && !Array.isArray(p.metadata)
          ? (p.metadata as Record<string, unknown>)
          : {},
    }),

  'route:restore': (db, p) =>
    routeService.restore(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      name: str(p, 'name'),
      colour: strOrNull(p, 'colour'),
      source: source(p),
      points: points(p),
    }),

  'waypoint:update': (db, p) =>
    waypointService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
      description: strOrNull(p, 'description'),
      symbol: str(p, 'symbol'),
      notes: strOrNull(p, 'notes'),
      groupId: strOrNull(p, 'groupId'),
    }),

  'waypoint:restorePosition': (db, p) =>
    waypointService.restorePosition(db, {
      id: str(p, 'id'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
    }),

  'waypoint:moveBack': (db, p) =>
    waypointService.moveBack(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      groupId: strOrNull(p, 'groupId'),
    }),

  'waypoint:delete': (db, p) => waypointService.remove(db, str(p, 'id')),

  'waypoint:restore': (db, p) =>
    waypointService.restore(db, {
      id: str(p, 'id'),
      tripId: str(p, 'tripId'),
      name: str(p, 'name'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      eleM: numOrNull(p, 'eleM'),
      description: strOrNull(p, 'description'),
      symbol: str(p, 'symbol'),
      notes: strOrNull(p, 'notes'),
      groupId: strOrNull(p, 'groupId'),
      source: source(p),
    }),

  // ----------------------------------------------------------- tracks

  'track:update': (db, p) =>
    trackService.update(db, {
      id: str(p, 'id'),
      name: str(p, 'name'),
      colour: strOrNull(p, 'colour'),
      width: numOrNull(p, 'width'),
    }),

  'track:move': (db, p) =>
    trackService.moveToTrip(db, { id: str(p, 'id'), tripId: str(p, 'tripId') }),

  'track:reverse': (db, p) => trackService.reverse(db, str(p, 'id')),

  'track:restorePoints': (db, p) =>
    trackService.restorePoints(db, {
      id: str(p, 'id'),
      index: num(p, 'index'),
      points: trackPoints(p),
      // Absent for an inverse recorded before segment structure was carried;
      // the service falls back to a single segment, which is what the old
      // behaviour produced anyway.
      ...(Array.isArray(p.breaks) ? { breaks: intArray(p, 'breaks') } : {}),
    }),

  'track:deleteRange': (db, p) =>
    trackService.deletePointRange(db, str(p, 'id'), num(p, 'from'), num(p, 'to')),

  'track:restorePointsAt': (db, p) =>
    trackService.restorePointsAt(db, {
      id: str(p, 'id'),
      points: indexedTrackPoints(p),
      breaks: intArray(p, 'breaks'),
    }),

  'track:deletePointsAt': (db, p) =>
    trackService.deletePointsAt(db, str(p, 'id'), intArray(p, 'indices')),

  'track:editPoint': (db, p) =>
    trackService.editPointAt(db, {
      id: str(p, 'id'),
      index: num(p, 'index'),
      lat: num(p, 'lat'),
      lon: num(p, 'lon'),
      ele: numOrNull(p, 'ele'),
      time: numOrNull(p, 'time'),
    }),
};

/**
 * Whether a command can be put on the undo stack.
 *
 * Takes the whole command rather than just its kind, because a batch's
 * undoability is a property of its children: a batch of track deletions is a
 * batch of no-ops, and recording it would give the user an Undo item that does
 * nothing when clicked.
 */
export function isUndoable(command: Command): boolean {
  if (command.kind === 'none') return false;
  if (!(command.kind in HANDLERS)) return false;

  if (command.kind === 'batch') {
    let children: Command[];
    try {
      children = commandList(command.payload);
    } catch {
      // A malformed batch is not undoable. Refusing it here means the failure
      // surfaces as "nothing to undo" rather than as an exception the moment
      // the user reaches for the Edit menu.
      return false;
    }
    return children.some((child) => isUndoable(child));
  }

  return true;
}

export function applyCommand(db: Db, command: Command): Mutation<unknown> {
  const handler = HANDLERS[command.kind as CommandKind];
  if (handler === undefined) {
    throw new ServiceError(
      'UNKNOWN',
      'That change cannot be undone.',
      `no handler for command "${command.kind}"`,
    );
  }
  return handler(db, command.payload);
}
