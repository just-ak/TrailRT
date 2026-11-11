import type { LatLon } from '@shared/geo/distance';
import type { RoutePoint } from '@shared/domain/types';
import {
  EditRefused,
  planEdit,
  remapRecords,
  type EditPlan,
  type PlannedControl,
  type RouteEdit,
} from '@shared/routing/edit';
import {
  MAX_SNAP_DISPLACEMENT_M,
  MAX_SNAPPED_POINTS,
  MAX_UNDOABLE_POINTS,
  type DisplacedControlPoint,
  type RoutingProvider,
  type SectionLocation,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import type {
  Candidate,
  EditOutcome,
  PreviewedLeg,
  ProvenanceControlPoint,
} from '@shared/routing/results';
import { checkBoundaries, legShapes, spliceLegs } from '@shared/routing/splice';
import type { Db } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import * as repo from '../db/repositories/routes';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as routeService from './routeService';
import { toRoutePoints, withBoundaries } from './routingService';

/**
 * Shaping a snapped route: route a section, offer alternatives, and apply an
 * edit to one or two legs without touching the rest. Phase 6, design §3 and §8.
 *
 * ## Preview, then apply
 *
 * Routing and writing are separate calls, as in Phase 4's snap routing tool.
 * `routeSection` and `alternatives` touch no database; the renderer shows the
 * result, and only when the user lets go does `applyEdit` write it. What is
 * stored is what the user saw — re-routing on write could legitimately return
 * something else.
 *
 * `applyEdit` re-plans the edit from the database rather than trusting the
 * renderer's plan, and refuses if the route has changed since the renderer
 * planned against it. A preview computed against a different route describes
 * neither version.
 */

// ------------------------------------------------------------- routing

/** Turns a routed result into what the renderer previews, one entry per leg. */
function toPreviewed(
  legs: readonly { matched: boolean; shape: readonly LatLon[]; distanceM: number | null }[],
  displaced: readonly DisplacedControlPoint[],
): PreviewedLeg[] {
  return legs.map((leg, k) => ({
    matched: leg.matched,
    shape: leg.shape.map((p) => ({ lat: p.lat, lon: p.lon })),
    distanceM: leg.distanceM,
    // The far end of leg k is location k + 1. Reported per leg so the
    // renderer can say which point is off the map as soon as it is placed.
    displacementM: displaced.find((d) => d.index === k + 1)?.displacementM ?? null,
  }));
}

/**
 * Routes a section of two or more locations and writes nothing.
 *
 * Uses the provider's pass-through section routing when it has one, so a
 * shaping point bends the route instead of becoming a turn-round. Without it,
 * each leg is routed alone and the renderer checks for reversals.
 */
export async function routeSection(
  provider: RoutingProvider,
  locations: readonly SectionLocation[],
  mode: TransportMode,
): Promise<PreviewedLeg[]> {
  if (locations.length < 2) {
    throw new ServiceError('INVALID_REQUEST', 'A section needs at least two points.');
  }
  const result =
    provider.snapSection === undefined
      ? await provider.snap(
          locations.map((l) => l.point),
          mode,
        )
      : await provider.snapSection(locations, mode);
  return toPreviewed(result.legs, result.displaced);
}

/**
 * The routes the engine offers between two points, preferred first.
 *
 * An empty list means there is no believable road route, which the caller
 * treats exactly as an unmatched leg.
 */
export async function alternatives(
  provider: RoutingProvider,
  from: LatLon,
  to: LatLon,
  mode: TransportMode,
  count: number,
): Promise<Candidate[]> {
  if (provider.alternatives === undefined) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'This routing service cannot offer alternative routes.',
    );
  }
  const candidates = await provider.alternatives(from, to, mode, count);
  return candidates.map((c) => ({
    matched: true,
    shape: c.shape.map((p) => ({ lat: p.lat, lon: p.lon })),
    distanceM: c.distanceM,
    displacementM: c.endDisplacementM,
    estimatedDurationS: c.estimatedDurationS,
  }));
}

// ------------------------------------------------------------- applying

export interface ApplyEditInput {
  routeId: string;
  /**
   * The control points the renderer planned against. Compared exactly with
   * the database before anything is written.
   */
  expected: readonly ProvenanceControlPoint[];
  edit: RouteEdit;
  /** The previewed legs, when the edit needed routing. Null otherwise. */
  legs: readonly PreviewedLeg[] | null;
}

const SAME = 1e-9;

function sameControl(
  stored: readonly controlRepo.ControlRow[],
  expected: readonly ProvenanceControlPoint[],
): boolean {
  return (
    stored.length === expected.length &&
    stored.every((row, i) => {
      const e = expected[i] as ProvenanceControlPoint;
      return (
        Math.abs(row.lat - e.lat) < SAME &&
        Math.abs(row.lon - e.lon) < SAME &&
        row.role === e.role &&
        row.shapeIndex === e.shapeIndex
      );
    })
  );
}

function recordsOf(metadata: Record<string, unknown>): {
  unmatchedLegs: [number, number][];
  displaced: DisplacedControlPoint[];
} {
  return {
    unmatchedLegs: Array.isArray(metadata.unmatchedLegs)
      ? (metadata.unmatchedLegs as [number, number][])
      : [],
    displaced: Array.isArray(metadata.displacedControlPoints)
      ? (metadata.displacedControlPoints as DisplacedControlPoint[])
      : [],
  };
}

/** Which replacement legs are road-matched, and which points were displaced. */
function routingFacts(
  plan: EditPlan,
  edit: RouteEdit,
  legs: readonly PreviewedLeg[] | null,
  previousUnmatched: readonly [number, number][],
): { matched: boolean[]; displaced: DisplacedControlPoint[] } {
  if (plan.replace === null) return { matched: [], displaced: [] };

  if (plan.section !== null) {
    const routed = legs ?? [];
    return {
      matched: routed.map((l) => l.matched),
      displaced: routed.flatMap((l, k) =>
        l.displacementM !== null && l.displacementM > MAX_SNAP_DISPLACEMENT_M
          ? [{ index: k + 1, displacementM: l.displacementM }]
          : [],
      ),
    };
  }

  // Known geometry. Splitting a leg on its own line keeps whatever it was:
  // halves of an unmatched straight line are still unmatched. A chosen
  // candidate is road geometry by construction.
  const wasUnmatched = previousUnmatched.some(([a]) => a === plan.replace?.from);
  const inherits = edit.kind === 'insertOnLine' && wasUnmatched;
  return {
    matched: Array.from({ length: plan.replace.count }, () => !inherits),
    displaced: [],
  };
}

/** Exact equality: an undo entry must put back precisely what was there. */
function samePoint(a: LatLon | undefined, b: LatLon | undefined): boolean {
  return a !== undefined && b !== undefined && a.lat === b.lat && a.lon === b.lon;
}

/**
 * The smallest stretch that differs between two point arrays, so an undo
 * entry carries only what changed.
 *
 * Computed by comparison rather than from the plan's leg numbers. That makes
 * it correct for every edit kind by construction — the inverse is "put back
 * exactly the points that are different" — and it is never larger than the
 * plan's own estimate would be.
 */
export function changedStretch(
  before: readonly LatLon[],
  after: readonly LatLon[],
): { from: number; afterTo: number; beforeTo: number } {
  let from = 0;
  const limit = Math.min(before.length, after.length);
  while (from < limit && samePoint(before[from], after[from])) from += 1;

  let tail = 0;
  while (
    tail < limit - from &&
    samePoint(before[before.length - 1 - tail], after[after.length - 1 - tail])
  ) {
    tail += 1;
  }

  return { from, beforeTo: before.length - tail, afterTo: after.length - tail };
}

function rowsToInput(rows: readonly controlRepo.ControlRow[]): controlRepo.ControlInput[] {
  return rows.map((r) => ({ lat: r.lat, lon: r.lon, role: r.role, shapeIndex: r.shapeIndex }));
}

/**
 * Applies a planned shaping edit to a saved snapped route.
 *
 * The inverse is a `route:spliceLegs` carrying only the points that changed,
 * so dragging one point on a 20,000-point route is undoable when the legs it
 * touched are small (Requirement 8.2).
 */
export function applyEdit(db: Db, input: ApplyEditInput): Mutation<EditOutcome> {
  const existing = routeService.get(db, input.routeId);
  const rows = controlRepo.listControlRows(db, input.routeId);

  if (rows.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'Only a route that follows the roads can be shaped. Snap it to roads first.',
    );
  }
  const boundaries = rows.map((r) => r.shapeIndex);
  if (!checkBoundaries(existing.points.length, boundaries, rows.length)) {
    // Requirement 8.8: the renderer re-snaps the whole route once and retries.
    throw new ServiceError(
      'INVALID_REQUEST',
      'This route was snapped before section editing existed. Re-route it once to enable shaping.',
      'boundaries unknown',
    );
  }
  if (!sameControl(rows, input.expected)) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'The route changed while you were editing it. Nothing was written.',
    );
  }

  const b = boundaries as number[];
  const control: PlannedControl[] = rows.map((r) => ({
    point: { lat: r.lat, lon: r.lon },
    role: r.role,
  }));

  let plan: EditPlan;
  try {
    plan = planEdit(control, legShapes(existing.points, b), input.edit);
  } catch (cause) {
    if (cause instanceof EditRefused) {
      throw new ServiceError('INVALID_REQUEST', cause.message);
    }
    throw cause;
  }

  let replacement: readonly { shape: readonly LatLon[] }[] | null = null;
  if (plan.replace !== null) {
    if (plan.section !== null) {
      const legs = input.legs ?? [];
      if (legs.length !== plan.replace.count || legs.some((l) => l.shape.length < 2)) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'That edit could not be saved because its routed sections did not match. Nothing was written.',
          `${legs.length} legs for ${plan.replace.count}`,
        );
      }
      replacement = legs;
    } else {
      replacement = (plan.knownLegs ?? []).map((shape) => ({ shape }));
    }
  }

  const before = existing.points;
  const spliced =
    plan.replace === null || replacement === null
      ? { points: before.map((p) => ({ lat: p.lat, lon: p.lon })), boundaries: b }
      : spliceLegs(before, b, plan.replace.from, plan.replace.to, replacement);

  if (spliced.points.length > MAX_SNAPPED_POINTS) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `That edit would make the route ${spliced.points.length.toLocaleString()} points, more than the ${MAX_SNAPPED_POINTS.toLocaleString()} TrailRT can store. Nothing was changed.`,
    );
  }

  const previousMeta = repo.readMetadata(db, input.routeId);
  const previousRecords = recordsOf(previousMeta);
  const facts = routingFacts(plan, input.edit, input.legs, previousRecords.unmatchedLegs);
  const records = remapRecords(plan, previousRecords, facts.matched, facts.displaced);

  // Geometry unchanged (a role change) keeps the stored points exactly,
  // elevation and all; otherwise snapped geometry carries no attributes.
  const geometryChanged = plan.replace !== null;
  const nextPoints: RoutePoint[] = geometryChanged ? toRoutePoints(spliced.points) : [...before];
  const stretch = changedStretch(before, nextPoints);
  const undoable = stretch.beforeTo - stretch.from <= MAX_UNDOABLE_POINTS;

  db.transaction(() => {
    const now = Date.now();
    if (geometryChanged) {
      repo.replacePoints(db, input.routeId, nextPoints);
      repo.writeStats(db, input.routeId, routeService.computeStats(nextPoints), now);
    }
    controlRepo.replaceControlPoints(
      db,
      input.routeId,
      withBoundaries(
        plan.control.map((c) => ({ lat: c.point.lat, lon: c.point.lon, role: c.role })),
        spliced.boundaries,
        nextPoints.length,
      ),
    );
    repo.writeMetadata(db, input.routeId, {
      ...previousMeta,
      unmatchedLegs: records.unmatchedLegs,
      displacedControlPoints: records.displaced,
    });
  });

  return {
    result: {
      routeId: input.routeId,
      pointCount: nextPoints.length,
      undoable,
      unmatchedLegs: records.unmatchedLegs,
      displaced: records.displaced,
    },
    inverse: undoable
      ? {
          kind: 'route:spliceLegs',
          payload: {
            id: input.routeId,
            fromShape: stretch.from,
            toShape: stretch.afterTo,
            points: before.slice(stretch.from, stretch.beforeTo),
            control: rowsToInput(rows),
            metadata: previousMeta,
          },
        }
      : { kind: 'none', payload: {} },
  };
}

/**
 * Puts back a stretch of points with the control points and records that went
 * with it. Only reached through undo and redo.
 *
 * Symmetric by construction: its own inverse is computed by the same
 * comparison, so redo is exactly the edit and undo is exactly the original.
 */
export function restoreSplice(
  db: Db,
  input: {
    id: string;
    fromShape: number;
    toShape: number;
    points: readonly RoutePoint[];
    control: readonly controlRepo.ControlInput[];
    metadata: Record<string, unknown>;
  },
): Mutation<EditOutcome> {
  const existing = routeService.get(db, input.id);
  const current = existing.points;
  if (
    !Number.isInteger(input.fromShape) ||
    !Number.isInteger(input.toShape) ||
    input.fromShape < 0 ||
    input.toShape < input.fromShape ||
    input.toShape > current.length
  ) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That route has changed since this edit, so it cannot be undone.',
    );
  }

  const restored: RoutePoint[] = [
    ...current.slice(0, input.fromShape),
    ...input.points,
    ...current.slice(input.toShape),
  ];
  const rows = controlRepo.listControlRows(db, input.id);
  const currentMeta = repo.readMetadata(db, input.id);
  const stretch = changedStretch(current, restored);

  db.transaction(() => {
    const now = Date.now();
    repo.replacePoints(db, input.id, restored);
    repo.writeStats(db, input.id, routeService.computeStats(restored), now);
    controlRepo.replaceControlPoints(db, input.id, input.control);
    repo.writeMetadata(db, input.id, input.metadata);
  });

  const records = recordsOf(input.metadata);
  return {
    result: {
      routeId: input.id,
      pointCount: restored.length,
      undoable: true,
      unmatchedLegs: records.unmatchedLegs,
      displaced: records.displaced,
    },
    inverse: {
      kind: 'route:spliceLegs',
      payload: {
        id: input.id,
        fromShape: stretch.from,
        toShape: stretch.afterTo,
        points: current.slice(stretch.from, stretch.beforeTo),
        control: rowsToInput(rows),
        metadata: currentMeta,
      },
    },
  };
}
