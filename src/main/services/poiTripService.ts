import type { ItineraryStop } from '@shared/domain/itinerary';
import type { Route, Waypoint } from '@shared/domain/types';
import { describeAttributes } from '@shared/poi/attributes';
import { categoryById, symbolFor } from '@shared/poi/categories';
import type { Poi } from '@shared/poi/PoiProvider';
import type { RoutingProvider, TransportMode } from '@shared/routing/RoutingProvider';
import type { Db } from '../db/client';
import * as itineraryRepo from '../db/repositories/itineraries';
import { applyCommand } from './commands';
import { batch } from './compose';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as routeService from './routeService';
import * as tripService from './tripService';
import * as routingService from './routingService';
import * as waypointService from './waypointService';

/**
 * Turning a point of interest into part of the trip, and planning legs.
 * Phase 10 Requirement 8, design §9.
 *
 * Takes a `Poi` the caller looked up again from the place data, so the
 * renderer never supplies the coordinates or tags it is made from. Never
 * names a concrete place source: that is the caller's job.
 *
 * Every compound action is one `batch` command, so one undo unwinds it
 * (ADR 0014).
 */


/** The waypoint a POI becomes: name, symbol, plain-text description, provenance. */
export function waypointFromPoi(poi: Poi, tripId: string, dataDate: string | null): Parameters<typeof waypointService.create>[1] {
  const category = categoryById(poi.category);
  const lines = describeAttributes(poi.attributes);
  lines.push('From OpenStreetMap. © OpenStreetMap contributors, ODbL.');
  return {
    tripId,
    name: poi.name ?? category.label,
    lat: poi.lat,
    lon: poi.lon,
    eleM: null,
    description: lines.join('\n'),
    symbol: symbolFor({ category: poi.category, kind: poi.kind }),
    notes: null,
    groupId: null,
    source: 'poi',
    metadata: {
      osm: { element: poi.osm, category: poi.category, kind: poi.kind, dataDate },
    },
  };
}

export function addPoiWaypoint(db: Db, poi: Poi, tripId: string, dataDate: string | null): Mutation<Waypoint> {
  return waypointService.create(db, waypointFromPoi(poi, tripId, dataDate));
}

/** A POI as a stop: the waypoint and the stop, one undo. */
export function addPoiStop(
  db: Db,
  poi: Poi,
  input: { tripId: string; index?: number | undefined; dataDate: string | null },
): Mutation<{ waypoint: Waypoint; stop: ItineraryStop }> {
  return db.transaction(() => {
    const waypoint = addPoiWaypoint(db, poi, input.tripId, input.dataDate);
    const stop = itineraryService.addStop(db, {
      tripId: input.tripId,
      waypointId: waypoint.result.id,
      index: input.index,
      // Somewhere to stay is for the night; anything else is a stop on the way.
      ...(poi.category === 'accommodation'
        ? { durationKind: 'days' as const, durationDays: 1 }
        : { durationKind: 'hours' as const, durationMinutes: 30 }),
    });
    return batch({ waypoint: waypoint.result, stop: stop.result }, waypoint, stop);
  });
}

/** Phase 14 Requirement 12.6: an item in another trip is moved or copied in, as the user chooses. */
export type Transfer = 'move' | 'copy';

function needsTransfer(db: Db, ownerTripId: string, tripId: string, transfer: Transfer | undefined): Transfer | null {
  if (ownerTripId === tripId) return null;
  // Out of "Not in a trip" is always a move: the item has no other home.
  if (tripService.isLoose(db, ownerTripId)) return 'move';
  if (transfer === undefined) {
    throw new ServiceError('INVALID_REQUEST', 'That is in another trip. Choose whether to move it here or copy it.');
  }
  return transfer;
}

/**
 * A waypoint from outside this trip as a stop (Phase 14 Requirement 12.1):
 * moved or copied into the trip, then put in the plan, in one undoable step.
 */
export function addWaypointStop(
  db: Db,
  input: { tripId: string; waypointId: string; index?: number | undefined; transfer?: Transfer | undefined },
): Mutation<{ waypointId: string; stop: ItineraryStop }> {
  return db.transaction(() => {
    const source = waypointService.get(db, input.waypointId);
    const steps: Mutation<unknown>[] = [];
    let waypointId = source.id;
    const how = needsTransfer(db, source.tripId, input.tripId, input.transfer);
    if (how === 'move') {
      steps.push(waypointService.moveToTrip(db, { id: source.id, tripId: input.tripId }));
    } else if (how === 'copy') {
      const copy = waypointService.create(db, {
        tripId: input.tripId,
        name: source.name,
        lat: source.lat,
        lon: source.lon,
        eleM: source.eleM,
        description: source.description,
        symbol: source.symbol ?? 'pin',
        notes: source.notes,
        groupId: null,
        source: source.source,
      });
      steps.push(copy);
      waypointId = copy.result.id;
    }
    const stop = itineraryService.addStop(db, { tripId: input.tripId, waypointId, index: input.index });
    return batch({ waypointId, stop: stop.result }, ...steps, stop);
  });
}

/**
 * A route placed in the plan as an entry of its own (Phase 14 Requirement 14,
 * design §5.7), in one undoable step: brought into the trip if it is
 * elsewhere, then put at `index`. It needs no stop at either end.
 */
export function addRouteLeg(
  db: Db,
  input: { tripId: string; routeId: string; index: number; transfer?: Transfer | undefined },
): Mutation<{ routeId: string; stopId: string }> {
  return db.transaction(() => {
    const source = routeService.get(db, input.routeId);
    const first = source.points[0];
    const last = source.points.at(-1);
    if (first === undefined || last === undefined || source.points.length < 2) {
      throw new ServiceError('INVALID_REQUEST', 'That route has no line to follow.');
    }
    const steps: Mutation<unknown>[] = [];
    let routeId = source.id;
    const how = needsTransfer(db, source.tripId, input.tripId, input.transfer);
    if (how === 'move') {
      steps.push(routeService.moveToTrip(db, { id: source.id, tripId: input.tripId }));
    } else if (how === 'copy') {
      const copy = routeService.create(db, { tripId: input.tripId, name: source.name, colour: source.colour, points: source.points, source: source.source });
      steps.push(copy);
      routeId = copy.result.id;
    }

    // Requirement 14: the route is an entry of its own, wherever it is put.
    // What joins it to its neighbours is worked out on read, and any gap is
    // planned by road like the gap between two stops.
    const entry = itineraryService.addStop(db, { tripId: input.tripId, waypointId: null, entryRouteId: routeId, index: input.index });
    return batch({ routeId, stopId: entry.result.id }, ...steps, entry);
  });
}

const vertex = (p: { lat: number; lon: number }) => ({ lat: p.lat, lon: p.lon, ele: null, name: null, symbol: null, notes: null });

/**
 * Delete from a trip's plan (Phase 14 Requirement 16.2): a route or waypoint
 * is deleted with every entry of the plan that uses it, and a drive that
 * followed it as a leg is unlinked, so nothing in the plan points at
 * something gone. One undo step brings all of it back.
 */
export function deleteItem(db: Db, ref: { kind: 'route' | 'waypoint'; id: string }): Mutation<{ id: string; entries: number }> {
  return db.transaction(() => {
    const tripId = ref.kind === 'route' ? routeService.get(db, ref.id).tripId : waypointService.get(db, ref.id).tripId;
    const steps: Mutation<unknown>[] = [];
    let entries = 0;
    for (const stop of itineraryRepo.listStops(db, tripId)) {
      const uses = ref.kind === 'route' ? stop.entryRouteId === ref.id : stop.waypointId === ref.id;
      if (uses) {
        steps.push(itineraryService.removeStop(db, { id: stop.id }));
        entries += 1;
      } else if (ref.kind === 'route' && stop.legRouteId === ref.id) {
        steps.push(itineraryService.linkLeg(db, { id: stop.id, routeId: null }));
      }
    }
    steps.push(ref.kind === 'route' ? routeService.remove(db, ref.id) : waypointService.remove(db, ref.id));
    return batch({ id: ref.id, entries }, ...steps);
  });
}

/** One side of a join: a route or a waypoint (Phase 14 Requirement 13.5). */
export interface JoinEnd {
  kind: 'route' | 'waypoint';
  id: string;
}

/** Where a join leaves from (`end`) or arrives at (`start`), and what it is called. */
function joinPoint(db: Db, ref: JoinEnd, which: 'start' | 'end'): { lat: number; lon: number; name: string; tripId: string } {
  if (ref.kind === 'waypoint') {
    const waypoint = waypointService.get(db, ref.id);
    return { lat: waypoint.lat, lon: waypoint.lon, name: waypoint.name, tripId: waypoint.tripId };
  }
  const route = routeService.get(db, ref.id);
  const point = which === 'end' ? route.points.at(-1) : route.points[0];
  if (point === undefined) throw new ServiceError('INVALID_REQUEST', `${route.name} has no line to join.`);
  return { lat: point.lat, lon: point.lon, name: route.name, tripId: route.tripId };
}

/**
 * Join with a New Route (Phase 14 Requirement 13.5, design §5.6): a route from
 * the first one's end to the second one's start, by road, or as a straight
 * line when asked. Made in the trip they share, or the first one's (a trip
 * rather than Not in a trip, when only one is in a trip). One undo step.
 */
export async function joinWithRoute(
  db: Db,
  routing: { provider: RoutingProvider | null; mode: TransportMode; unavailable: string },
  input: { from: JoinEnd; to: JoinEnd; straight: boolean },
): Promise<Mutation<Route>> {
  const from = joinPoint(db, input.from, 'end');
  const to = joinPoint(db, input.to, 'start');
  const tripId = from.tripId === to.tripId || !tripService.isLoose(db, from.tripId) ? from.tripId : to.tripId;
  const name = `${from.name} → ${to.name}`;
  if (input.straight) {
    return routeService.create(db, { tripId, name, colour: null, points: [vertex(from), vertex(to)] });
  }
  if (routing.provider === null) {
    throw new ServiceError('PROVIDER_UNAVAILABLE', `${routing.unavailable} Join with a straight line instead.`);
  }
  const leg = await routingService.routeLeg(routing.provider, from, to, routing.mode);
  return routingService.createSnappedRoute(db, {
    tripId,
    name,
    colour: null,
    controlPoints: [from, to],
    legs: [leg],
    mode: routing.mode,
    provider: routing.provider.id,
  });
}

/**
 * A place or postcode as a stop (Phase 14 Requirement 11.4): a waypoint made
 * at it, then a stop, in one undoable step. Nothing has to exist first.
 */
export function addPlaceStop(
  db: Db,
  input: { tripId: string; name: string; lat: number; lon: number; index?: number | undefined },
): Mutation<{ waypoint: Waypoint; stop: ItineraryStop }> {
  return db.transaction(() => {
    const waypoint = waypointService.create(db, {
      tripId: input.tripId,
      name: input.name,
      lat: input.lat,
      lon: input.lon,
      eleM: null,
      description: null,
      symbol: 'pin',
      notes: null,
      groupId: null,
    });
    const stop = itineraryService.addStop(db, {
      tripId: input.tripId,
      waypointId: waypoint.result.id,
      index: input.index,
      durationKind: 'hours',
      durationMinutes: 60,
    });
    return batch({ waypoint: waypoint.result, stop: stop.result }, waypoint, stop);
  });
}

/**
 * Plans the leg arriving at a stop: routes it with the provider, saves the
 * route, links it. One undo removes both.
 */
export async function planLeg(
  db: Db,
  provider: RoutingProvider,
  mode: TransportMode,
  stopId: string,
): Promise<Mutation<{ route: Route; stop: ItineraryStop }>> {
  const stop = itineraryRepo.findStop(db, stopId);
  if (stop === null) throw notFound('That stop');
  const stops = itineraryRepo.listStops(db, stop.tripId);
  const index = stops.findIndex((s) => s.id === stopId);
  const previous = stops.slice(0, index).findLast((s) => s.kind !== 'day');
  if (previous === undefined) {
    throw new ServiceError('INVALID_REQUEST', 'The first stop is where the trip starts; there is no leg to plan.');
  }
  const from = itineraryService.stopPlaceOut(db, previous, stop.tripId);
  const to = itineraryService.stopPlace(db, stop, stop.tripId);
  if (from === null || to === null) {
    throw new ServiceError('INVALID_REQUEST', 'Both stops need a place before the leg between them can be planned.');
  }

  const leg = await routingService.routeLeg(provider, from, to, mode);

  return db.transaction(() => {
    const route = routingService.createSnappedRoute(db, {
      tripId: stop.tripId,
      name: `${from.name} → ${to.name}`,
      colour: null,
      controlPoints: [from, to],
      legs: [leg],
      mode,
      provider: provider.id,
    });
    const link = itineraryService.linkLeg(db, { id: stopId, routeId: route.result.id });
    return batch({ route: route.result, stop: link.result }, route, link);
  });
}

/**
 * Re-routes through a stop that was inserted between two others
 * (Requirement 8.4): plans the leg into it and the leg out of it.
 *
 * The route that used to join the stops either side is **not modified and
 * not deleted**. It stays in the trip, unlinked, so nothing is edited
 * silently.
 */
export async function planAround(
  db: Db,
  provider: RoutingProvider,
  mode: TransportMode,
  stopId: string,
): Promise<Mutation<{ routes: Route[] }>> {
  const stop = itineraryRepo.findStop(db, stopId);
  if (stop === null) throw notFound('That stop');
  const stops = itineraryRepo.listStops(db, stop.tripId);
  const index = stops.findIndex((s) => s.id === stopId);
  const next = stops[index + 1];
  if (index <= 0 || next === undefined) {
    throw new ServiceError('INVALID_REQUEST', 'Only a stop between two others can be routed through.');
  }
  const into = await planLeg(db, provider, mode, stopId);
  try {
    const out = await planLeg(db, provider, mode, next.id);
    return batch({ routes: [into.result.route, out.result.route] }, into, out);
  } catch (error) {
    // The second leg failed: take the first back out, so the trip is as it was.
    applyCommand(db, into.inverse);
    throw error;
  }
}
