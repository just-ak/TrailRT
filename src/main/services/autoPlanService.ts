import { haversineDistance } from '@shared/geo/distance';
import type { RoutingProvider, TransportMode } from '@shared/routing/RoutingProvider';
import type { Db } from '../db/client';
import * as itineraryRepo from '../db/repositories/itineraries';
import * as routeRepo from '../db/repositories/routes';
import * as waypointRepo from '../db/repositories/waypoints';
import type { Mutation } from './folderService';
import * as itineraryService from './itineraryService';
import * as routeService from './routeService';
import * as routingService from './routingService';

/**
 * Joins a trip's stops by road, automatically. Phase 10 Requirement 15,
 * design §15.2, ADR 0019 amendment.
 *
 * Every `road` leg that has no route, or whose route no longer joins its two
 * stops, is routed, saved and linked. Routes made here carry a marker in
 * their metadata, and **only marked routes are ever replaced or removed**. A
 * route the user drew, imported or chose is never touched.
 *
 * Returns the mutations it applied, in order, for the caller to record in one
 * batch with the change that prompted it, so one undo takes both back.
 */

/** The metadata key and value marking a route the itinerary planned. */
export const PLANNED_BY = 'plannedBy';
export const PLANNED_BY_ITINERARY = 'itinerary';

/** A route end within this of its stop counts as joining it (design §4). */
const FIT_M = 1000;

export function isPlannedRoute(db: Db, routeId: string): boolean {
  return routeRepo.readMetadata(db, routeId)[PLANNED_BY] === PLANNED_BY_ITINERARY;
}

function fits(db: Db, routeId: string, from: { lat: number; lon: number }, to: { lat: number; lon: number }): boolean {
  const ends = routeRepo.routeEndpoints(db, routeId);
  return ends !== null && haversineDistance(ends.first, from) <= FIT_M && haversineDistance(ends.last, to) <= FIT_M;
}

export interface AutoPlanResult {
  mutations: Mutation<unknown>[];
  planned: number;
  /** Stop id → why its leg could not be planned. */
  failures: Map<string, string>;
}

export async function autoPlan(
  db: Db,
  provider: RoutingProvider | null,
  mode: TransportMode,
  tripId: string,
  unavailable: string,
): Promise<AutoPlanResult> {
  const result: AutoPlanResult = { mutations: [], planned: 0, failures: new Map() };
  if (itineraryRepo.findItinerary(db, tripId) === null) return result;

  const stops = itineraryRepo.listStops(db, tripId);
  for (let index = 1; index < stops.length; index += 1) {
    const stop = stops[index];
    const previous = stops[index - 1];
    if (stop === undefined || previous === undefined || stop.legMode !== 'road') continue;

    const from = waypointRepo.findWaypoint(db, previous.waypointId);
    const to = waypointRepo.findWaypoint(db, stop.waypointId);
    if (from === null || to === null || from.tripId !== tripId || to.tripId !== tripId) continue;

    const current = stop.legRouteId === null ? null : routeRepo.findRoute(db, stop.legRouteId);
    if (current !== null && current.tripId === tripId && fits(db, current.id, from, to)) continue;

    if (provider === null) {
      result.failures.set(stop.id, unavailable);
      continue;
    }

    let leg: Awaited<ReturnType<typeof routingService.routeLeg>>;
    try {
      // One leg at a time on purpose: the embedded engine routes in-process,
      // and the batch has to apply in stop order.
      // oxlint-disable-next-line no-await-in-loop
      leg = await routingService.routeLeg(provider, from, to, mode);
    } catch (error) {
      result.failures.set(stop.id, error instanceof Error ? error.message : 'Routing failed.');
      continue;
    }
    if (!leg.matched) {
      // A straight line is not a plan, and drawing one would look like one.
      result.failures.set(stop.id, 'No road was found between these stops. Choose a route, or mark the leg as other transport.');
      continue;
    }

    // The stale route goes only if the itinerary made it.
    if (current !== null && current.tripId === tripId && isPlannedRoute(db, current.id)) {
      result.mutations.push(routeService.remove(db, current.id));
    }
    const created = routingService.createSnappedRoute(db, {
      tripId,
      name: `${from.name} → ${to.name}`,
      colour: null,
      controlPoints: [from, to],
      legs: [leg],
      mode,
      provider: provider.id,
    });
    routeRepo.writeMetadata(db, created.result.id, {
      ...routeRepo.readMetadata(db, created.result.id),
      [PLANNED_BY]: PLANNED_BY_ITINERARY,
    });
    result.mutations.push(created);
    result.mutations.push(itineraryService.linkLeg(db, { id: stop.id, routeId: created.result.id, mode: 'road' }));
    result.planned += 1;
  }

  // Routes the itinerary made that no stop uses any more: a stop was removed,
  // or a leg became other transport. The user's own routes are left alone.
  const linked = new Set(itineraryRepo.listStops(db, tripId).map((s) => s.legRouteId));
  for (const route of routeRepo.listRoutesForTrip(db, tripId)) {
    if (!linked.has(route.id) && isPlannedRoute(db, route.id)) {
      result.mutations.push(routeService.remove(db, route.id));
    }
  }

  return result;
}
