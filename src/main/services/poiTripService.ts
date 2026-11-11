import type { ItineraryStop } from '@shared/domain/itinerary';
import type { Route, Waypoint } from '@shared/domain/types';
import { describeAttributes } from '@shared/poi/attributes';
import { categoryById, symbolFor } from '@shared/poi/categories';
import type { Poi } from '@shared/poi/PoiProvider';
import type { RoutingProvider, TransportMode } from '@shared/routing/RoutingProvider';
import type { Db } from '../db/client';
import * as itineraryRepo from '../db/repositories/itineraries';
import * as waypointRepo from '../db/repositories/waypoints';
import { applyCommand } from './commands';
import { batch } from './compose';
import { notFound, ServiceError } from './errors';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
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
  const previous = stops[index - 1];
  if (previous === undefined) {
    throw new ServiceError('INVALID_REQUEST', 'The first stop is where the trip starts; there is no leg to plan.');
  }
  const from = waypointRepo.findWaypoint(db, previous.waypointId);
  const to = waypointRepo.findWaypoint(db, stop.waypointId);
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
