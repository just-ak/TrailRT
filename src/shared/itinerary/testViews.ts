import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { Itinerary, ItineraryStop, ItineraryView, StopView } from '../domain/itinerary';
import type { LatLon } from '../geo/distance';
import { resolveTimeZone } from '../time/timeZones';
import { computeTimeline } from './timeline';

/**
 * Itinerary views for tests: stops built round the Buxton square and timed by
 * the real timeline. Imported only by tests.
 */

export const ZONE = 'Europe/London';
export const HOUR_BY_CAR = 55_000;

export function stop(id: string, name: string, at: LatLon, overrides: Partial<ItineraryStop>, routeM: number | null): StopView {
  return {
    id,
    tripId: 't',
    seq: 0,
    waypointId: `wp-${id}`,
    legRouteId: routeM === null ? null : `r-${id}`,
    legMode: 'road',
    legTransport: null,
    legMinutes: null,
    legLabel: null,
    durationKind: 'hours',
    durationMinutes: 0,
    durationDays: null,
    departTime: null,
    arriveBy: null,
    departAt: null,
    notes: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
    place: { id: `wp-${id}`, name, lat: at.lat, lon: at.lon, symbol: null },
    planIssue: null,
    leg: routeM === null ? null : { routeId: `r-${id}`, name: 'Road', distanceM: routeM, mode: 'auto', fits: true },
  };
}

export function viewOf(stops: StopView[]): ItineraryView {
  const itinerary: Itinerary = {
    tripId: 't',
    startDate: '2026-10-23',
    startTime: '16:00',
    defaultDepart: '09:00',
    maxDriveMinutes: null,
    rangeKm: null,
    reservePct: 20,
    energy: 'fuel',
    createdAt: 0,
    updatedAt: 0,
  };
  const timeline = computeTimeline(
    { itinerary, stops: stops.map((s) => ({ stop: s, position: s.place, leg: s.leg })), walkingSpeedKmh: 4.5, fallbackZone: 'UTC' },
    resolveTimeZone,
  );
  return { itinerary, stops, timeline };
}

/** Leave Buxton 16:00 Fri 23 Oct 2026, two days at Leek across the end of BST, then Ashbourne. */
export const weekend = viewOf([
  stop('a', 'Buxton', BUXTON, {}, null),
  stop('b', 'Leek', LEEK, { durationKind: 'days', durationDays: 2, durationMinutes: null }, HOUR_BY_CAR),
  stop('c', 'Ashbourne', ASHBOURNE, {}, HOUR_BY_CAR),
]);

