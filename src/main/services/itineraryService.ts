import {
  DEFAULT_DEPART_TIME,
  DEFAULT_RESERVE_PCT,
  MAX_ITINERARY_STOPS,
  MAX_STAY_DAYS,
  MAX_STOP_MINUTES,
  LEG_MODES,
  MAX_OTHER_MINUTES,
  OTHER_TRANSPORTS,
  type DurationKind,
  type LegMode,
  type OtherTransport,
  type Itinerary,
  type ItineraryPatch,
  type ItineraryStop,
  type ItineraryView,
  type StopLeg,
  type StopPatch,
  type StopView,
  type VehicleEnergy,
} from '@shared/domain/itinerary';
import { haversineDistance } from '@shared/geo/distance';
import { computeTimeline } from '@shared/itinerary/timeline';
import { isTransportMode, type TransportMode } from '@shared/routing/RoutingProvider';
import { resolveTimeZone } from '@shared/time/timeZones';
import { isValidDate, isValidTime, systemZone } from '@shared/time/zoned';
import type { Db } from '../db/client';
import * as repo from '../db/repositories/itineraries';
import * as routeRepo from '../db/repositories/routes';
import * as tripRepo from '../db/repositories/trips';
import * as waypointRepo from '../db/repositories/waypoints';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';

/**
 * A trip's dated itinerary: create, edit, reorder, undo. Phase 10, design §4.
 *
 * Every mutation returns its inverse, like every other service, and every
 * inverse is registered in `commands.ts`.
 *
 * ## Leg links follow the stops
 *
 * A stop's `legRouteId` is the route of the leg **arriving** at it. Adding,
 * removing or moving a stop changes which two stops some legs join, and a
 * link that now joins the wrong pair would show a confident time for a drive
 * nobody planned. So each structural change clears the links it invalidates.
 * Its inverse carries those links back in `restoreLinks`, so undo puts them
 * exactly as they were. Nothing is guessed.
 */

/** A route end within this of its stop counts as joining it. */
const LEG_FIT_M = 1000;

export interface PlanningSettings {
  walkingSpeedKmh: number;
  transportMode: TransportMode;
}

// ----------------------------------------------------------- validation

function invalid(message: string): ServiceError {
  return new ServiceError('INVALID_REQUEST', message);
}

function assertTrip(db: Db, tripId: string): void {
  if (tripRepo.findTrip(db, tripId) === null) throw notFound('That trip');
}

function requireItinerary(db: Db, tripId: string): Itinerary {
  const itinerary = repo.findItinerary(db, tripId);
  if (itinerary === null) throw notFound('That trip’s itinerary');
  return itinerary;
}

function requireStop(db: Db, id: string): ItineraryStop {
  const stop = repo.findStop(db, id);
  if (stop === null) throw notFound('That stop');
  return stop;
}

function assertDate(value: string, what: string): void {
  if (!isValidDate(value)) throw invalid(`${what} must be a real date, written YYYY-MM-DD.`);
}

function assertTime(value: string | null | undefined, what: string): void {
  if (value === null || value === undefined) return;
  if (!isValidTime(value)) throw invalid(`${what} must be a time between 00:00 and 23:59.`);
}

function assertWaypointInTrip(db: Db, waypointId: string, tripId: string): void {
  const waypoint = waypointRepo.findWaypoint(db, waypointId);
  if (waypoint === null) throw notFound('That waypoint');
  if (waypoint.tripId !== tripId) {
    throw invalid('A stop has to be one of this trip’s own waypoints.');
  }
}

function assertRouteInTrip(db: Db, routeId: string, tripId: string): void {
  const route = routeRepo.findRoute(db, routeId);
  if (route === null) throw notFound('That route');
  if (route.tripId !== tripId) throw invalid('A leg has to be one of this trip’s own routes.');
}

function assertPlan(patch: ItineraryPatch): void {
  if (patch.startDate !== undefined) assertDate(patch.startDate, 'The start date');
  assertTime(patch.startTime, 'The start time');
  assertTime(patch.defaultDepart, 'The default departure time');
  if (
    patch.maxDriveMinutes !== undefined &&
    patch.maxDriveMinutes !== null &&
    (!Number.isInteger(patch.maxDriveMinutes) || patch.maxDriveMinutes < 30 || patch.maxDriveMinutes > 24 * 60)
  ) {
    throw invalid('A daily driving limit must be between 30 minutes and 24 hours.');
  }
  if (
    patch.rangeKm !== undefined &&
    patch.rangeKm !== null &&
    (!Number.isFinite(patch.rangeKm) || patch.rangeKm <= 0 || patch.rangeKm > 5000)
  ) {
    throw invalid('A vehicle range must be more than 0 and at most 5,000 km.');
  }
  if (
    patch.reservePct !== undefined &&
    (!Number.isInteger(patch.reservePct) || patch.reservePct < 0 || patch.reservePct > 90)
  ) {
    throw invalid('The reserve must be a whole percentage from 0 to 90.');
  }
  if (patch.energy !== undefined && patch.energy !== 'fuel' && patch.energy !== 'electric') {
    throw invalid('The vehicle must be fuel or electric.');
  }
}

/**
 * A stop's duration fields after a patch, made consistent: an hours stop has
 * minutes and no days, a day-stay has days and no minutes, and each kind only
 * keeps the fixed times that apply to it.
 */
function normaliseDuration(
  current: Pick<ItineraryStop, 'durationKind' | 'durationMinutes' | 'durationDays' | 'departTime' | 'departAt'>,
  patch: StopPatch,
): Pick<ItineraryStop, 'durationKind' | 'durationMinutes' | 'durationDays' | 'departTime' | 'departAt'> {
  const kind: DurationKind = patch.durationKind ?? current.durationKind;
  if (kind === 'hours') {
    const minutes = patch.durationMinutes !== undefined ? patch.durationMinutes : current.durationMinutes;
    const value = minutes ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > MAX_STOP_MINUTES) {
      throw invalid('A stop in hours must last from 0 minutes to 24 hours. Use days for longer.');
    }
    const departAt = patch.departAt !== undefined ? patch.departAt : current.departAt;
    assertTime(departAt, 'The departure time');
    return { durationKind: 'hours', durationMinutes: value, durationDays: null, departTime: null, departAt };
  }
  const days = patch.durationDays !== undefined ? patch.durationDays : current.durationDays;
  const value = days ?? 1;
  if (!Number.isInteger(value) || value < 1 || value > MAX_STAY_DAYS) {
    throw invalid(`A stay must be a whole number of days, from 1 to ${MAX_STAY_DAYS}.`);
  }
  const departTime = patch.departTime !== undefined ? patch.departTime : current.departTime;
  assertTime(departTime, 'The departure time');
  return { durationKind: 'days', durationMinutes: null, durationDays: value, departTime, departAt: null };
}

// ------------------------------------------------------------ the view

function legFor(
  db: Db,
  stop: ItineraryStop,
  previous: StopView | undefined,
  place: StopView['place'],
  settings: PlanningSettings,
): StopLeg | null {
  if (stop.legRouteId === null || previous === undefined) return null;
  const route = routeRepo.findRoute(db, stop.legRouteId);
  if (route === null || route.tripId !== stop.tripId) {
    return { routeId: stop.legRouteId, name: null, distanceM: null, mode: settings.transportMode, fits: null };
  }
  const recorded = routeRepo.readRoutingProvenance(db, route.id)?.transportMode ?? null;
  const mode = recorded !== null && isTransportMode(recorded) ? recorded : settings.transportMode;

  let fits: boolean | null = null;
  const ends = routeRepo.routeEndpoints(db, route.id);
  if (ends !== null && previous.place !== null && place !== null) {
    fits =
      haversineDistance(ends.first, previous.place) <= LEG_FIT_M &&
      haversineDistance(ends.last, place) <= LEG_FIT_M;
  }
  return { routeId: route.id, name: route.name, distanceM: route.distanceM, mode, fits };
}

/** The itinerary with its places, legs and timeline, or null when the trip has none. */
/**
 * The itinerary with its places, legs and timeline, or null when the trip has
 * none. `planIssue` says why a by-road leg has no route; the caller supplies
 * it because only the caller knows the routing provider's state.
 */
export function get(
  db: Db,
  tripId: string,
  settings: PlanningSettings,
  planIssue: (stop: ItineraryStop) => string | null = () => null,
): ItineraryView | null {
  assertTrip(db, tripId);
  const itinerary = repo.findItinerary(db, tripId);
  if (itinerary === null) return null;

  const views: StopView[] = [];
  for (const stop of repo.listStops(db, tripId)) {
    const waypoint = waypointRepo.findWaypoint(db, stop.waypointId);
    const place =
      waypoint === null || waypoint.tripId !== tripId
        ? null
        : { id: waypoint.id, name: waypoint.name, lat: waypoint.lat, lon: waypoint.lon, symbol: waypoint.symbol };
    const previous = views.at(-1);
    const leg = stop.legMode === 'other' ? null : legFor(db, stop, previous, place, settings);
    const unplanned = previous !== undefined && stop.legMode === 'road' && (leg === null || leg.name === null || leg.fits === false);
    views.push({ ...stop, place, leg, planIssue: unplanned ? planIssue(stop) : null });
  }

  const timeline = computeTimeline(
    {
      itinerary,
      stops: views.map((view) => ({
        stop: view,
        position: view.place,
        // Other transport is timed by what the user gave; a route that is
        // gone, or does not join its stops, is not a plan.
        leg:
          view.legMode === 'other'
            ? { routeId: null, distanceM: null, mode: settings.transportMode, kind: 'other' as const, minutes: view.legMinutes }
            : view.leg === null || view.leg.name === null || view.leg.fits === false
              ? null
              : { routeId: view.leg.routeId, distanceM: view.leg.distanceM, mode: view.leg.mode },
      })),
      walkingSpeedKmh: settings.walkingSpeedKmh,
      fallbackZone: systemZone(),
    },
    resolveTimeZone,
  );

  return { itinerary, stops: views, timeline };
}

/** Trip id → itinerary, for the library tree. */
export function listAll(db: Db): Map<string, Itinerary> {
  return new Map(repo.listItineraries(db).map((itinerary) => [itinerary.tripId, itinerary]));
}

// -------------------------------------------------------- the itinerary

export function create(
  db: Db,
  input: { tripId: string; startDate: string; startTime: string },
): Mutation<Itinerary> {
  assertTrip(db, input.tripId);
  assertDate(input.startDate, 'The start date');
  assertTime(input.startTime, 'The start time');
  if (repo.findItinerary(db, input.tripId) !== null) {
    throw invalid('This trip already has an itinerary.');
  }
  const created = repo.insertItinerary(db, {
    tripId: input.tripId,
    startDate: input.startDate,
    startTime: input.startTime,
    defaultDepart: DEFAULT_DEPART_TIME,
    maxDriveMinutes: null,
    rangeKm: null,
    reservePct: DEFAULT_RESERVE_PCT,
    energy: 'fuel',
    now: Date.now(),
  });
  return { result: created, inverse: { kind: 'itinerary:remove', payload: { tripId: input.tripId } } };
}

/** A whole itinerary, as the inverse of removing it carries. */
export interface ItinerarySnapshot {
  itinerary: Itinerary;
  stops: ItineraryStop[];
}

/**
 * Removes the itinerary. Waypoints and routes are untouched (Requirement 1.2).
 * Undoable: the inverse carries every stop, which is bounded at 100.
 */
export function remove(db: Db, tripId: string): Mutation<{ tripId: string }> {
  const itinerary = requireItinerary(db, tripId);
  const snapshot: ItinerarySnapshot = { itinerary, stops: repo.listStops(db, tripId) };
  repo.deleteItinerary(db, tripId);
  return {
    result: { tripId },
    inverse: { kind: 'itinerary:restore', payload: snapshot as unknown as Record<string, unknown> },
  };
}

export function restore(db: Db, snapshot: ItinerarySnapshot): Mutation<Itinerary> {
  const { itinerary, stops } = snapshot;
  assertTrip(db, itinerary.tripId);
  const restored = db.transaction((): Itinerary => {
    const now = Date.now();
    const created = repo.insertItinerary(db, { ...itinerary, createdAt: itinerary.createdAt, now });
    for (const stop of stops) repo.insertStop(db, { ...stop, createdAt: stop.createdAt, now });
    return created;
  });
  return { result: restored, inverse: { kind: 'itinerary:remove', payload: { tripId: itinerary.tripId } } };
}

export function update(db: Db, tripId: string, patch: ItineraryPatch): Mutation<Itinerary> {
  const before = requireItinerary(db, tripId);
  assertPlan(patch);
  repo.updateItinerary(db, tripId, patch, Date.now());
  const previous: Record<string, unknown> = { tripId };
  for (const key of Object.keys(patch) as (keyof ItineraryPatch)[]) previous[key] = before[key];
  return { result: requireItinerary(db, tripId), inverse: { kind: 'itinerary:update', payload: previous } };
}

// ------------------------------------------------------------- the stops

/** A leg as an inverse has to put it back: its route and how it is travelled. */
interface LegState {
  routeId: string | null;
  mode: LegMode;
  transport: OtherTransport | null;
  minutes: number | null;
  label: string | null;
}

type Links = Record<string, LegState>;

function legStateOf(stop: ItineraryStop): LegState {
  return {
    routeId: stop.legRouteId,
    mode: stop.legMode,
    transport: stop.legTransport,
    minutes: stop.legMinutes,
    label: stop.legLabel,
  };
}

function legPatch(state: LegState): Parameters<typeof repo.updateStop>[2] {
  return {
    legRouteId: state.routeId,
    legMode: state.mode,
    legTransport: state.transport,
    legMinutes: state.minutes,
    legLabel: state.label,
  };
}

/** A leg reset by a structural change: no route, planned by road. */
const RESET_LEG: LegState = { routeId: null, mode: 'road', transport: null, minutes: null, label: null };

/** The current legs of the given stops, so an inverse can put them back. */
function linksOf(stops: readonly ItineraryStop[], ids: readonly (string | undefined)[]): Links {
  const links: Links = {};
  for (const id of ids) {
    if (id === undefined) continue;
    const stop = stops.find((s) => s.id === id);
    if (stop !== undefined) links[id] = legStateOf(stop);
  }
  return links;
}

/**
 * After a structural change: restore the given legs exactly if there are
 * any, otherwise reset the legs of the affected stops to "by road", which
 * automatic planning then fills (design §15.2). A ferry or a chosen route
 * between two stops says nothing about the new pair, so it is reset too; undo
 * brings it back. The first stop never keeps a leg: nothing arrives at it.
 */
function settleLinks(db: Db, tripId: string, affected: readonly (string | undefined)[], restoreLinks: Links | null): void {
  const now = Date.now();
  const stops = repo.listStops(db, tripId);
  repo.resequence(db, stops.map((s) => s.id));
  if (restoreLinks !== null) {
    for (const [id, state] of Object.entries(restoreLinks)) {
      if (stops.some((s) => s.id === id)) repo.updateStop(db, id, legPatch(state), now);
    }
  } else {
    for (const id of affected) {
      if (id !== undefined && stops.some((s) => s.id === id)) repo.updateStop(db, id, legPatch(RESET_LEG), now);
    }
  }
  const first = repo.listStops(db, tripId)[0];
  if (first !== undefined && (first.legRouteId !== null || first.legMode !== 'road')) {
    repo.updateStop(db, first.id, legPatch(RESET_LEG), now);
  }
}

export interface AddStopInput {
  tripId: string;
  waypointId: string;
  /** Position to insert at; the end when absent. */
  index?: number | undefined;
  durationKind?: DurationKind | undefined;
  durationMinutes?: number | null | undefined;
  durationDays?: number | null | undefined;
  notes?: string | null | undefined;
  /** Supplied when undo restores a removed stop, so its id comes back. */
  id?: string | undefined;
  restoreLinks?: Links | null | undefined;
}

export function addStop(db: Db, input: AddStopInput): Mutation<ItineraryStop> {
  requireItinerary(db, input.tripId);
  assertWaypointInTrip(db, input.waypointId, input.tripId);

  const stops = repo.listStops(db, input.tripId);
  if (stops.length >= MAX_ITINERARY_STOPS) {
    throw invalid(`An itinerary can have at most ${MAX_ITINERARY_STOPS} stops.`);
  }
  const index = Math.min(Math.max(input.index ?? stops.length, 0), stops.length);
  const duration = normaliseDuration(
    { durationKind: 'hours', durationMinutes: 0, durationDays: null, departTime: null, departAt: null },
    {
      ...(input.durationKind === undefined ? {} : { durationKind: input.durationKind }),
      ...(input.durationMinutes === undefined ? {} : { durationMinutes: input.durationMinutes }),
      ...(input.durationDays === undefined ? {} : { durationDays: input.durationDays }),
    },
  );

  // The stop that used to follow this position now arrives from somewhere else.
  const displaced = stops[index]?.id;
  const inverseLinks = linksOf(stops, [displaced]);

  const created = db.transaction((): ItineraryStop => {
    const stop = repo.insertStop(db, {
      ...(input.id === undefined ? {} : { id: input.id }),
      tripId: input.tripId,
      // Placed just before `index`, then everything is renumbered.
      seq: index - 0.5,
      waypointId: input.waypointId,
      legRouteId: null,
      ...duration,
      arriveBy: null,
      notes: input.notes ?? null,
      now: Date.now(),
    });
    settleLinks(db, input.tripId, [displaced], input.restoreLinks ?? null);
    return requireStop(db, stop.id);
  });

  return {
    result: created,
    inverse: { kind: 'itinerary:removeStop', payload: { id: created.id, restoreLinks: inverseLinks } },
  };
}

export function removeStop(db: Db, input: { id: string; restoreLinks?: Links | null }): Mutation<{ id: string }> {
  const stop = requireStop(db, input.id);
  const stops = repo.listStops(db, stop.tripId);
  const index = stops.findIndex((s) => s.id === stop.id);
  const next = stops[index + 1]?.id;
  const inverseLinks = linksOf(stops, [stop.id, next]);

  db.transaction(() => {
    repo.deleteStop(db, stop.id);
    settleLinks(db, stop.tripId, [next], input.restoreLinks ?? null);
  });

  return {
    result: { id: stop.id },
    inverse: {
      kind: 'itinerary:restoreStop',
      payload: { stop: stop as unknown as Record<string, unknown>, index, restoreLinks: inverseLinks },
    },
  };
}

/** Only reached through undo of a removal: the stop returns with its id and fields. */
export function restoreStop(
  db: Db,
  input: { stop: ItineraryStop; index: number; restoreLinks: Links },
): Mutation<ItineraryStop> {
  const { stop } = input;
  requireItinerary(db, stop.tripId);
  const stops = repo.listStops(db, stop.tripId);
  if (stops.length >= MAX_ITINERARY_STOPS) {
    throw invalid(`An itinerary can have at most ${MAX_ITINERARY_STOPS} stops.`);
  }
  const index = Math.min(Math.max(input.index, 0), stops.length);
  const displaced = stops[index]?.id;
  const inverseLinks = linksOf(stops, [displaced]);

  const restored = db.transaction((): ItineraryStop => {
    repo.insertStop(db, { ...stop, seq: index - 0.5, createdAt: stop.createdAt, now: Date.now() });
    settleLinks(db, stop.tripId, [], input.restoreLinks);
    return requireStop(db, stop.id);
  });

  return {
    result: restored,
    inverse: { kind: 'itinerary:removeStop', payload: { id: stop.id, restoreLinks: inverseLinks } },
  };
}

export function moveStop(
  db: Db,
  input: { id: string; toIndex: number; restoreLinks?: Links | null },
): Mutation<ItineraryStop> {
  const stop = requireStop(db, input.id);
  const stops = repo.listStops(db, stop.tripId);
  const from = stops.findIndex((s) => s.id === stop.id);
  const to = Math.min(Math.max(input.toIndex, 0), stops.length - 1);
  if (from === to) {
    return { result: stop, inverse: { kind: 'none', payload: {} } };
  }

  const order = stops.map((s) => s.id);
  order.splice(from, 1);
  order.splice(to, 0, stop.id);

  // The moved stop, the one that followed it, and the one it now precedes all
  // arrive from somewhere new.
  const affected = [stop.id, stops[from + 1]?.id, order[to + 1]];
  const inverseLinks = linksOf(stops, affected);

  db.transaction(() => {
    repo.resequence(db, order);
    settleLinks(db, stop.tripId, affected, input.restoreLinks ?? null);
  });

  return {
    result: requireStop(db, stop.id),
    inverse: { kind: 'itinerary:moveStop', payload: { id: stop.id, toIndex: from, restoreLinks: inverseLinks } },
  };
}

export function updateStop(db: Db, id: string, patch: StopPatch): Mutation<ItineraryStop> {
  const before = requireStop(db, id);
  assertTime(patch.arriveBy, 'The arrive-by time');
  const duration = normaliseDuration(before, patch);
  const next: StopPatch = { ...duration };
  if (patch.arriveBy !== undefined) next.arriveBy = patch.arriveBy;
  if (patch.notes !== undefined) next.notes = patch.notes;
  repo.updateStop(db, id, next, Date.now());

  const previous: Record<string, unknown> = {
    id,
    durationKind: before.durationKind,
    durationMinutes: before.durationMinutes,
    durationDays: before.durationDays,
    departTime: before.departTime,
    departAt: before.departAt,
    arriveBy: before.arriveBy,
    notes: before.notes,
  };
  return { result: requireStop(db, id), inverse: { kind: 'itinerary:updateStop', payload: previous } };
}

/**
 * Links a route to the leg arriving at a stop. Choosing a route makes it the
 * user's choice (`route`), which automatic planning never replaces; clearing
 * it returns the leg to `road` (Requirement 15.6). `mode` is given only when
 * undo puts a leg back exactly as it was.
 */
export function linkLeg(
  db: Db,
  input: { id: string; routeId: string | null; mode?: LegMode | undefined },
): Mutation<ItineraryStop> {
  const stop = requireStop(db, input.id);
  if (input.routeId !== null) {
    assertRouteInTrip(db, input.routeId, stop.tripId);
    const first = repo.listStops(db, stop.tripId)[0];
    if (first?.id === stop.id) throw invalid('The first stop is where the trip starts; no leg arrives at it.');
  }
  const mode: LegMode = input.mode ?? (input.routeId === null ? 'road' : 'route');
  repo.updateStop(db, stop.id, { legRouteId: input.routeId, legMode: mode }, Date.now());
  return {
    result: requireStop(db, stop.id),
    inverse: { kind: 'itinerary:linkLeg', payload: { id: stop.id, routeId: stop.legRouteId, mode: stop.legMode } },
  };
}

/**
 * Sets how the leg arriving at a stop is travelled: by road (planned
 * automatically) or by other transport ("don't link"). A chosen route is set
 * with `linkLeg`, since it needs the route. Undo restores the whole leg.
 */
export function setLegMode(
  db: Db,
  input: {
    id: string;
    mode: LegMode;
    transport?: OtherTransport | null | undefined;
    minutes?: number | null | undefined;
    label?: string | null | undefined;
    /** Undo only: the route the leg had. */
    routeId?: string | null | undefined;
  },
): Mutation<ItineraryStop> {
  const stop = requireStop(db, input.id);
  const first = repo.listStops(db, stop.tripId)[0];
  if (first?.id === stop.id) throw invalid('The first stop is where the trip starts; no leg arrives at it.');
  if (!LEG_MODES.includes(input.mode)) throw invalid('A leg is by road, a chosen route, or other transport.');
  if (input.mode === 'route' && (input.routeId === undefined || input.routeId === null)) {
    throw invalid('Choose the route for this leg.');
  }
  const transport = input.transport ?? null;
  if (transport !== null && !OTHER_TRANSPORTS.includes(transport)) throw invalid('That is not a kind of transport TrailRT knows.');
  const minutes = input.minutes ?? null;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_OTHER_MINUTES)) {
    throw invalid('A travel time is a whole number of minutes, up to two days.');
  }
  const label = input.label ?? null;
  if (label !== null && label.length > 200) throw invalid('A transport name can be at most 200 characters.');

  const next: LegState =
    input.mode === 'other'
      ? { routeId: null, mode: 'other', transport: transport ?? 'other', minutes, label }
      : // By road keeps no route of its own: automatic planning provides one.
        { routeId: input.routeId ?? null, mode: input.mode, transport: null, minutes: null, label: null };
  repo.updateStop(db, stop.id, legPatch(next), Date.now());

  const before = legStateOf(stop);
  return {
    result: requireStop(db, stop.id),
    inverse: {
      kind: 'itinerary:setLegMode',
      payload: {
        id: stop.id,
        mode: before.mode,
        transport: before.transport,
        minutes: before.minutes,
        label: before.label,
        routeId: before.routeId,
      },
    },
  };
}

// ------------------------------------------------------- undo payloads

/**
 * Reads an inverse payload back into typed input.
 *
 * Payloads are our own and never come from the renderer, but they are shape
 * checked anyway, as `commands.ts` does for every other kind: a malformed one
 * should fail loudly, not write half a stop.
 */
export function readLinks(value: unknown): Links | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw malformed('restoreLinks');
  const links: Links = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) throw malformed('restoreLinks entry');
    const e = entry as Record<string, unknown>;
    const nullableString = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'string') throw malformed('restoreLinks field');
      return v;
    };
    if (!LEG_MODES.includes(e.mode as LegMode)) throw malformed('restoreLinks mode');
    const minutes = e.minutes === null || e.minutes === undefined ? null : Number(e.minutes);
    if (minutes !== null && !Number.isFinite(minutes)) throw malformed('restoreLinks minutes');
    links[key] = {
      routeId: nullableString(e.routeId),
      mode: e.mode as LegMode,
      transport: nullableString(e.transport) as OtherTransport | null,
      minutes,
      label: nullableString(e.label),
    };
  }
  return links;
}

function malformed(what: string): ServiceError {
  return new ServiceError('UNKNOWN', 'An undo step was malformed and was not applied.', `bad ${what}`);
}

const STOP_KEYS: (keyof ItineraryStop)[] = [
  'id',
  'tripId',
  'seq',
  'waypointId',
  'legRouteId',
  'legMode',
  'legTransport',
  'legMinutes',
  'legLabel',
  'durationKind',
  'durationMinutes',
  'durationDays',
  'departTime',
  'arriveBy',
  'departAt',
  'notes',
  'createdAt',
  'updatedAt',
];

export function readStop(value: unknown): ItineraryStop {
  if (typeof value !== 'object' || value === null) throw malformed('stop');
  const record = value as Record<string, unknown>;
  for (const key of STOP_KEYS) if (!(key in record)) throw malformed(`stop.${key}`);
  if (typeof record.id !== 'string' || typeof record.tripId !== 'string' || typeof record.waypointId !== 'string') {
    throw malformed('stop ids');
  }
  if (record.durationKind !== 'hours' && record.durationKind !== 'days') throw malformed('stop.durationKind');
  return record as unknown as ItineraryStop;
}

export function readSnapshot(value: Record<string, unknown>): ItinerarySnapshot {
  const itinerary = value.itinerary as Record<string, unknown> | undefined;
  const stops = value.stops;
  if (typeof itinerary !== 'object' || itinerary === null || typeof itinerary.tripId !== 'string') {
    throw malformed('itinerary');
  }
  if (!Array.isArray(stops)) throw malformed('stops');
  const energy = itinerary.energy as VehicleEnergy;
  if (energy !== 'fuel' && energy !== 'electric') throw malformed('itinerary.energy');
  return { itinerary: itinerary as unknown as Itinerary, stops: stops.map(readStop) };
}
