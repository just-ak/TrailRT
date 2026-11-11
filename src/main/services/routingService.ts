import type { LatLon } from '@shared/geo/distance';
import type { RoutePoint } from '@shared/domain/types';
import {
  type ControlRole,
  type DisplacedControlPoint,
  MAX_SNAPPED_POINTS,
  MAX_UNDOABLE_POINTS,
  type RoutingProvider,
  type SnapResult,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import type {
  PreviewedLeg,
  RouteProvenance,
  SnapOutcome,
} from '@shared/routing/results';
import type { Route } from '@shared/domain/types';
import { checkBoundaries, flattenLegsWithBoundaries } from '@shared/routing/splice';
import type { Db } from '../db/client';
import * as controlRepo from '../db/repositories/routeControlPoints';
import * as repo from '../db/repositories/routes';
import { decodeMetadata, encodeMetadata } from '../db/metadata';
import { ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as routeService from './routeService';

/**
 * Snapping a route to the road network.
 *
 * Separate from `routeService` on purpose. Everything here depends on an
 * external provider and can fail for reasons that have nothing to do with the
 * database; keeping it apart means `routeService` stays a pure local-storage
 * module that cannot be broken by a network change.
 *
 * ## The order of operations matters
 *
 * The provider is called **before** the transaction opens. A snap that fails
 * must leave the route exactly as it was, and holding a write transaction open
 * across a 20-second network call would block every other write for the
 * duration.
 *
 * ## Control points versus shape
 *
 * `route_control_points` stores what the user placed; `route_points` stores the
 * shape that is drawn and exported. A route with no control points was
 * hand-drawn, which is how every pre-Phase-4 route keeps behaving exactly as it
 * did without a feature flag anywhere.
 */

export type { RouteProvenance, SnapOutcome } from '@shared/routing/results';

/**
 * Flattens routed legs into one point array.
 *
 * Successive legs share a vertex — leg *n* ends where leg *n+1* begins — so the
 * duplicate is dropped. Keeping it would put a zero-length segment at every
 * control point, which inflates the point count and shows up as a stationary
 * sample in any speed calculation.
 *
 * Takes the legs rather than a whole `SnapResult` so the interactive tool,
 * which accumulates legs one at a time and never builds a `SnapResult`, joins
 * them by exactly the same rule as a whole-route snap.
 */
/**
 * Snaps a whole control-point list, keeping shaping points pass-through.
 *
 * Phase 6, design §10. A route with no shaping points — or a provider with no
 * section routing — is one `snap` call, exactly as before. Otherwise the
 * points are split into runs from one via point to the next; a run with
 * shaping points inside it is routed as one section so the route bends
 * through them rather than turning round at them, and runs without are
 * gathered into ordinary `snap` calls. Leg, unmatched and displaced indices
 * are shifted back into whole-route numbering.
 */
export async function snapControl(
  provider: RoutingProvider,
  control: readonly controlRepo.ControlInput[],
  mode: TransportMode,
): Promise<SnapResult> {
  const points = control.map((p) => ({ lat: p.lat, lon: p.lon }));
  const interiorShaping = control.some(
    (p, i) => i > 0 && i < control.length - 1 && p.role === 'shaping',
  );
  if (!interiorShaping || provider.snapSection === undefined) {
    return provider.snap(points, mode);
  }

  const result: SnapResult = {
    provider: provider.id,
    mode,
    legs: [],
    unmatchedLegs: [],
    displaced: [],
  };
  const take = (part: SnapResult, offset: number): void => {
    result.provider = part.provider;
    for (const leg of part.legs) {
      result.legs.push({
        ...leg,
        fromControlIndex: leg.fromControlIndex + offset,
        toControlIndex: leg.toControlIndex + offset,
      });
    }
    for (const [a, b] of part.unmatchedLegs) result.unmatchedLegs.push([a + offset, b + offset]);
    for (const d of part.displaced) {
      const index = d.index + offset;
      const seen = result.displaced.find((e) => e.index === index);
      if (seen === undefined) result.displaced.push({ index, displacementM: d.displacementM });
      else seen.displacementM = Math.max(seen.displacementM, d.displacementM);
    }
  };

  // Via indices bound the runs; the ends are always via points.
  const vias = control
    .map((p, i) => (i === 0 || i === control.length - 1 || p.role !== 'shaping' ? i : -1))
    .filter((i) => i >= 0);

  let plainStart: number | null = null;
  const flushPlain = async (end: number): Promise<void> => {
    if (plainStart === null || end <= plainStart) return;
    // eslint-disable-next-line no-await-in-loop
    take(await provider.snap(points.slice(plainStart, end + 1), mode), plainStart);
    plainStart = null;
  };

  for (let r = 0; r < vias.length - 1; r += 1) {
    const from = vias[r] as number;
    const to = vias[r + 1] as number;
    if (to - from === 1) {
      plainStart ??= from;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await flushPlain(from);
    const section = control.slice(from, to + 1).map((p, i, all) => ({
      point: { lat: p.lat, lon: p.lon },
      passThrough: i > 0 && i < all.length - 1,
    }));
    // eslint-disable-next-line no-await-in-loop
    take(await provider.snapSection(section, mode), from);
  }
  await flushPlain(control.length - 1);

  result.displaced.sort((a, b) => a.index - b.index);
  return result;
}

/**
 * Pairs control points with their leg boundaries for storage.
 *
 * When the boundaries do not describe the shape — a provider that returned the
 * wrong number of legs — they are stored as unknown rather than wrong. Unknown
 * boundaries cost one whole-route re-snap on the next edit; wrong ones would
 * make that edit replace the wrong stretch of road.
 */
export function withBoundaries(
  control: readonly controlRepo.ControlInput[],
  boundaries: readonly number[],
  pointCount: number,
): controlRepo.ControlInput[] {
  const valid = checkBoundaries(pointCount, boundaries, control.length);
  return control.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    // The start and end are always via points, whatever was supplied.
    role: i === 0 || i === control.length - 1 ? 'via' : (p.role ?? 'via'),
    shapeIndex: valid ? (boundaries[i] ?? null) : null,
  }));
}

export function flattenLegs(
  legs: readonly { shape: readonly LatLon[] }[],
): LatLon[] {
  // One rule for joining legs, shared with the boundary bookkeeping, so the
  // two cannot drift apart. See `shared/routing/splice.ts`.
  return flattenLegsWithBoundaries(legs).points;
}

/**
 * Snapped geometry carries no per-point attributes.
 *
 * Elevation is `null` rather than copied from a nearby control point: the road
 * shape is a different set of positions, and carrying over a height measured
 * somewhere else would be inventing data. Name, symbol and notes belong to
 * points the user placed, not to road vertices.
 */
export function toRoutePoints(points: readonly LatLon[]): RoutePoint[] {
  return points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    ele: null,
    name: null,
    symbol: null,
    notes: null,
  }));
}

function assertWithinCap(count: number): void {
  if (count <= MAX_SNAPPED_POINTS) return;
  throw new ServiceError(
    'INVALID_REQUEST',
    `Snapping this route would produce ${count.toLocaleString()} points, more than the ${MAX_SNAPPED_POINTS.toLocaleString()} TrailRT can store. Split the route into shorter sections.`,
  );
}

export interface SnapRouteInput {
  routeId: string;
  provider: RoutingProvider;
  mode: TransportMode;
  /**
   * Points to snap between. Defaults to the route's existing control points,
   * or its current geometry when it has never been snapped.
   */
  controlPoints?: readonly controlRepo.ControlInput[] | undefined;
}

/**
 * Snaps an existing route.
 *
 * The returned mutation's inverse restores the previous geometry **and** the
 * previous control-point state, so undoing a snap returns a hand-drawn route to
 * being hand-drawn rather than leaving orphaned control points behind.
 */
export async function snapRoute(
  db: Db,
  input: SnapRouteInput,
): Promise<Mutation<SnapOutcome>> {
  const existing = routeService.get(db, input.routeId);

  const stored = controlRepo.listControlRows(db, input.routeId);
  /*
   * Roles survive a re-snap. Supplied points without a role take the role of
   * the stored point at the same position when the count matches — a moved
   * point is still the kind of point it was — and are via points otherwise.
   */
  const control: controlRepo.ControlInput[] =
    input.controlPoints === undefined
      ? stored.length > 0
        ? stored
        : existing.points.map((p) => ({ lat: p.lat, lon: p.lon }))
      : input.controlPoints.map((p, i) => ({
          lat: p.lat,
          lon: p.lon,
          role:
            p.role ??
            (stored.length === input.controlPoints?.length ? stored[i]?.role : undefined),
        }));

  if (control.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'A route needs at least two points before it can be snapped to roads.',
    );
  }

  // Outside the transaction: a network call must not hold a write lock, and a
  // failure here must leave the route untouched.
  const snapped = await snapControl(input.provider, control, input.mode);
  const { points: shape, boundaries } = flattenLegsWithBoundaries(snapped.legs);

  if (shape.length < 2) {
    throw new ServiceError(
      'PROVIDER_ERROR',
      'The routing service returned no usable road geometry for this route.',
    );
  }

  assertWithinCap(shape.length);

  const previousPoints = existing.points;
  const previousControl = stored.length > 0 ? stored : null;
  const previousMeta = repo.readMetadata(db, input.routeId);

  /*
   * Undo is offered only when the previous geometry is small enough to carry.
   *
   * The inverse of a geometry change is the whole previous array, and the undo
   * stack holds up to 50 entries. A multi-megabyte entry would be a memory
   * problem disguised as a convenience. Above the bound the operation declares
   * itself non-undoable and the UI says so — the same honesty
   * `trackService.restoreOriginal` applies.
   */
  const undoable = previousPoints.length <= MAX_UNDOABLE_POINTS;

  db.transaction(() => {
    const now = Date.now();
    controlRepo.replaceControlPoints(
      db,
      input.routeId,
      withBoundaries(control, boundaries, shape.length),
    );
    repo.replacePoints(db, input.routeId, toRoutePoints(shape));
    repo.writeStats(
      db,
      input.routeId,
      routeService.computeStats(toRoutePoints(shape)),
      now,
    );
    repo.writeRoutingProvenance(db, input.routeId, {
      routingProvider: snapped.provider,
      transportMode: snapped.mode,
      snappedAt: now,
    });
    // Unmatched legs live in metadata rather than a column: they are a list
    // whose length varies, only ever read back whole, and already the kind of
    // thing `metadata` exists for.
    repo.writeMetadata(db, input.routeId, {
      ...previousMeta,
      unmatchedLegs: snapped.unmatchedLegs,
      // Persisted, not shown once: a route snapped against a region that did
      // not reach it stays wrong until it is re-snapped, so the panel should
      // keep saying so rather than relying on the user remembering a toast.
      displacedControlPoints: snapped.displaced,
    });
  });

  const outcome: SnapOutcome = {
    routeId: input.routeId,
    provider: snapped.provider,
    mode: snapped.mode,
    pointCount: shape.length,
    unmatchedLegs: snapped.unmatchedLegs,
    undoable,
    displaced: snapped.displaced,
  };

  return {
    result: outcome,
    inverse: undoable
      ? {
          kind: 'route:restoreSnap',
          payload: {
            id: input.routeId,
            points: previousPoints,
            controlPoints: previousControl,
            metadata: previousMeta,
          },
        }
      : // Declared rather than faked. A snap of a very large route is not
        // reversible from the stack, and saying so beats an inverse that would
        // not fit.
        { kind: 'none', payload: {} },
  };
}

/**
 * Restores a route's pre-snap state. Only reached through undo.
 *
 * Restores the control points too, including their absence: a route that was
 * hand-drawn before the snap must be hand-drawn again afterwards, not a snapped
 * route that happens to have the old geometry.
 */
export function restoreSnap(
  db: Db,
  input: {
    id: string;
    points: readonly RoutePoint[];
    controlPoints: readonly controlRepo.ControlInput[] | null;
    metadata: Record<string, unknown>;
  },
): Mutation<SnapOutcome> {
  const existing = routeService.get(db, input.id);
  const rows = controlRepo.listControlRows(db, input.id);
  const currentControl = rows.length > 0 ? rows : null;
  const currentMeta = repo.readMetadata(db, input.id);

  db.transaction(() => {
    const now = Date.now();
    repo.replacePoints(db, input.id, input.points);
    repo.writeStats(
      db,
      input.id,
      routeService.computeStats(input.points),
      now,
    );

    if (input.controlPoints === null) {
      controlRepo.clearControlPoints(db, input.id);
      repo.writeRoutingProvenance(db, input.id, {
        routingProvider: null,
        transportMode: null,
        snappedAt: null,
      });
    } else {
      controlRepo.replaceControlPoints(db, input.id, input.controlPoints);
    }

    repo.writeMetadata(db, input.id, input.metadata);
  });

  return {
    result: {
      routeId: input.id,
      provider: 'none',
      mode: 'auto',
      pointCount: input.points.length,
      unmatchedLegs: [],
      undoable: true,
      // Undoing a snap restores the geometry from before it, so whatever the
      // engine did to the control points is undone with it.
      displaced: [],
    },
    inverse: {
      kind: 'route:restoreSnap',
      payload: {
        id: input.id,
        points: existing.points,
        controlPoints: currentControl,
        metadata: currentMeta,
      },
    },
  };
}

export function provenance(db: Db, routeId: string): RouteProvenance {
  const row = repo.readRoutingProvenance(db, routeId);
  const metadata = decodeMetadata(encodeMetadata(repo.readMetadata(db, routeId)));
  const unmatched = metadata.unmatchedLegs;
  const controlPoints = controlRepo.listControlRows(db, routeId);

  return {
    routingProvider: row?.routingProvider ?? null,
    transportMode: (row?.transportMode as TransportMode | null) ?? null,
    snappedAt: row?.snappedAt ?? null,
    controlPointCount: controlPoints.length,
    controlPoints: controlPoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      role: p.role,
      shapeIndex: p.shapeIndex,
    })),
    unmatchedLegs: Array.isArray(unmatched)
      ? (unmatched as [number, number][])
      : [],
    // Absent for a route snapped before displacement was measured, which is
    // not the same as "measured and found clean" — but an empty list is the
    // only honest default, and re-snapping produces the real answer.
    displaced: Array.isArray(metadata.displacedControlPoints)
      ? (metadata.displacedControlPoints as DisplacedControlPoint[])
      : [],
  };
}

// ------------------------------------------- the interactive snap routing tool

/**
 * Routes a single leg, touching no database.
 *
 * This is what makes the tool interactive: a click routes the one new leg
 * instead of re-routing the whole line, so the cost of the tenth click is the
 * same as the cost of the first. Re-snapping the whole route on every click
 * would be quadratic in provider calls and would make a ten-point route
 * fifty-five requests instead of ten.
 *
 * Expressed through the existing `RoutingProvider.snap` rather than a new
 * `routeLeg` method on the interface. A two-point snap is already exactly one
 * `/route` call in the Valhalla adapter, so the interface gains no obligation
 * and a second provider has nothing extra to implement.
 */
export async function routeLeg(
  provider: RoutingProvider,
  from: LatLon,
  to: LatLon,
  mode: TransportMode,
): Promise<PreviewedLeg> {
  const result = await provider.snap([from, to], mode);
  const leg = result.legs[0];

  // An adapter that returns no leg at all is treated as an unmatched leg, not
  // an error. The user gets a straight line and is told, which is the same
  // outcome Requirement 3.6 specifies for a leg with no road path.
  if (leg === undefined || leg.shape.length < 2) {
    return {
      matched: false,
      shape: [
        { lat: from.lat, lon: from.lon },
        { lat: to.lat, lon: to.lon },
      ],
      distanceM: null,
      displacementM: null,
    };
  }

  /*
   * How far the far end had to move to reach a road.
   *
   * Reported per click so a point outside the loaded region is obvious
   * immediately, rather than after the whole route is drawn. The adapter
   * already measured it for the whole snap; here there is exactly one leg, so
   * the displacement of control point 1 is this leg's end displacement.
   */
  // `?? []` because `displaced` is a provider's report, and a provider that
  // does not measure displacement is a provider with nothing to say about it —
  // not a reason to fail the leg.
  const displacementM =
    (result.displaced ?? []).find((entry) => entry.index === 1)
      ?.displacementM ?? null;

  return {
    matched: leg.matched,
    shape: leg.shape.map((p) => ({ lat: p.lat, lon: p.lon })),
    distanceM: leg.distanceM,
    displacementM,
  };
}

export interface CreateSnappedInput {
  tripId: string;
  name: string;
  colour: string | null;
  /** The points the user clicked. */
  controlPoints: readonly LatLon[];
  /** The previewed legs, one fewer than the control points. */
  legs: readonly PreviewedLeg[];
  /**
   * The role of each control point, parallel to `controlPoints`. Absent from a
   * caller that predates Phase 6, in which case every point is a via point.
   */
  roles?: readonly ControlRole[] | undefined;
  mode: TransportMode;
  provider: string;
}

/**
 * Saves a route built with the interactive tool.
 *
 * Writes the **previewed** geometry rather than re-routing, for the reason
 * given on `PreviewedLeg`: the user accepted a specific line and must get it.
 *
 * The inverse is a plain route deletion, exactly as for any other route
 * creation, which is why this is undoable where a whole-route snap of a large
 * existing route is not — there is no previous geometry to carry, only a row to
 * remove.
 */
export function createSnappedRoute(
  db: Db,
  input: CreateSnappedInput,
): Mutation<Route> {
  if (input.controlPoints.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'A snapped route needs at least two points.',
    );
  }

  if (input.legs.length !== input.controlPoints.length - 1) {
    /*
     * A mismatch means the renderer's preview and its control points had drifted
     * apart, so neither is trustworthy. Refusing is the only safe answer:
     * writing the legs anyway would store a route whose control points do not
     * describe it, and a later re-snap would silently produce a different line.
     */
    throw new ServiceError(
      'INVALID_REQUEST',
      'That route could not be saved because its legs and points did not match. Nothing was written.',
      `${input.legs.length} legs for ${input.controlPoints.length} control points`,
    );
  }

  const { points: shape, boundaries } = flattenLegsWithBoundaries(input.legs);

  if (shape.length < 2) {
    throw new ServiceError(
      'INVALID_REQUEST',
      'That route has no usable geometry to save.',
    );
  }

  /*
   * Bounded by the undo limit, not the higher snapped-route limit.
   *
   * A route built click by click is undoable by construction, and keeping it
   * under `MAX_UNDOABLE_POINTS` means it also satisfies `routePointsSchema`, so
   * every later edit through `route:setGeometry` keeps working. Letting the tool
   * produce 25,000 points would create routes this application can store but
   * not subsequently edit, which is a worse outcome than refusing the last leg.
   */
  if (shape.length > MAX_UNDOABLE_POINTS) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `This route has reached ${shape.length.toLocaleString()} points, past the ${MAX_UNDOABLE_POINTS.toLocaleString()} TrailRT can keep editable. Finish it here and start another route, or remove the last leg.`,
    );
  }

  const unmatchedLegs: [number, number][] = [];
  for (const [index, leg] of input.legs.entries()) {
    if (!leg.matched) unmatchedLegs.push([index, index + 1]);
  }

  const created = db.transaction((): Route => {
    const now = Date.now();
    const mutation = routeService.create(db, {
      tripId: input.tripId,
      name: input.name,
      colour: input.colour,
      points: toRoutePoints(shape),
    });

    controlRepo.replaceControlPoints(
      db,
      mutation.result.id,
      withBoundaries(
        input.controlPoints.map((p, i) => ({
          lat: p.lat,
          lon: p.lon,
          role: input.roles?.[i],
        })),
        boundaries,
        shape.length,
      ),
    );
    repo.writeRoutingProvenance(db, mutation.result.id, {
      routingProvider: input.provider,
      transportMode: input.mode,
      snappedAt: now,
    });
    repo.writeMetadata(db, mutation.result.id, { unmatchedLegs });

    return mutation.result;
  });

  return {
    result: created,
    // Deleting the route takes its control points and provenance with it: both
    // tables cascade on `route_id`, so there is nothing left behind to clean up
    // and no second inverse to get wrong.
    inverse: { kind: 'route:delete', payload: { id: created.id } },
  };
}
