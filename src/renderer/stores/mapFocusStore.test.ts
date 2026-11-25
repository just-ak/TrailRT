import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { useGeometryStore } from './geometryStore';
import { useMapFocusStore } from './mapFocusStore';
import { useSelectionStore } from './selectionStore';
import { useUiStore } from './uiStore';

/**
 * Phase 14 Requirements 26 and 27: a route's, waypoint's or photo's arrow
 * moves the map once, and a route or waypoint asked for is drawn with its
 * layer hidden only while it stays selected. Requirement 29: on a trip's
 * page, a track's arrow does the same, and the trip's own arrow fits the map
 * to the whole trip.
 */

const TRIP = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f';
const ROUTE = '0190c3ae-1f2b-4c4d-9e8f-000000000001';
const EMPTY_ROUTE = '0190c3ae-1f2b-4c4d-9e8f-000000000002';
const WAYPOINT = '0190c3ae-1f2b-4c4d-9e8f-000000000003';
const TRACK = '0190c3ae-1f2b-4c4d-9e8f-000000000004';
const EMPTY_TRACK = '0190c3ae-1f2b-4c4d-9e8f-000000000005';
const EMPTY_TRIP = '0190c3ae-1f2b-4c4d-9e8f-000000000006';

const TRACK_BOX = { minLat: ASHBOURNE.lat, maxLat: BUXTON.lat, minLon: BUXTON.lon, maxLon: ASHBOURNE.lon };
const TRIP_BOX = { minLat: LEEK.lat, maxLat: BUXTON.lat, minLon: LEEK.lon, maxLon: ASHBOURNE.lon };
const geometryFor = (tripId: string, bounds: unknown) => ({ tripId, routes: [], tracks: [], waypoints: [], bounds });

const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data });
const none = () => Promise.resolve({ ok: false as const, error: { code: 'NOT_FOUND', message: 'none' } });
const routePoint = (at: { lat: number; lon: number }) => ({ lat: at.lat, lon: at.lon, eleM: null });

let toasts: string[];

beforeEach(() => {
  toasts = [];
  vi.stubGlobal('window', {
    trailrt: {
      routes: {
        get: ({ id }: { id: string }) =>
          id === ROUTE
            ? ok({ id: ROUTE, tripId: TRIP, name: 'Leek road', points: [routePoint(BUXTON), routePoint(LEEK)] })
            : id === EMPTY_ROUTE
              ? ok({ id: EMPTY_ROUTE, tripId: TRIP, name: 'Nothing yet', points: [] })
              : none(),
      },
      waypoints: { get: () => ok({ id: WAYPOINT, tripId: TRIP, name: 'Buxton', lat: BUXTON.lat, lon: BUXTON.lon }) },
      tracks: {
        get: ({ id }: { id: string }) => ok({ id, tripId: TRIP, name: id === TRACK ? 'Ashbourne ride' : 'Empty ride', points: [] }),
        bounds: ({ ids }: { ids: string[] }) => ok(ids.includes(TRACK) ? TRACK_BOX : null),
      },
      trips: { get: ({ id }: { id: string }) => ok({ id, name: id === TRIP ? 'Peak loop' : 'Nothing yet' }) },
      geometry: { forTrip: ({ tripId }: { tripId: string }) => ok(geometryFor(tripId, tripId === TRIP ? TRIP_BOX : null)) },
    },
  });
  useUiStore.setState({ showToast: (message: string) => void toasts.push(message) } as never);
  useMapFocusStore.setState({ focus: null, target: null, shown: null });
  useSelectionStore.setState({ selected: null, selectedKeys: new Set(), anchorKey: null });
  useGeometryStore.getState().clear();
});

afterEach(() => vi.unstubAllGlobals());

describe('a route or waypoint asked for from the list', () => {
  it('selects the route and asks the map for the box around its points', async () => {
    await useMapFocusStore.getState().showRoute(ROUTE);
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'route', id: ROUTE });
    expect(useMapFocusStore.getState().target?.bounds).toEqual({
      minLat: Math.min(BUXTON.lat, LEEK.lat),
      maxLat: Math.max(BUXTON.lat, LEEK.lat),
      minLon: Math.min(BUXTON.lon, LEEK.lon),
      maxLon: Math.max(BUXTON.lon, LEEK.lon),
    });
    expect(useMapFocusStore.getState().shown).toEqual({ kind: 'route', id: ROUTE });
  });

  it('says so for a route with no points, and leaves the map alone', async () => {
    await useMapFocusStore.getState().showRoute(EMPTY_ROUTE);
    expect(useMapFocusStore.getState().target).toBeNull();
    expect(toasts).toEqual(['That route has no points to show.']);
  });

  it('asks the map for the waypoint as a point', async () => {
    await useMapFocusStore.getState().showWaypoint(WAYPOINT);
    expect(useMapFocusStore.getState().target?.bounds).toEqual({ minLat: BUXTON.lat, maxLat: BUXTON.lat, minLon: BUXTON.lon, maxLon: BUXTON.lon });
    expect(useMapFocusStore.getState().shown).toEqual({ kind: 'waypoint', id: WAYPOINT });
  });

  it('is forgotten once something else is selected, so a hidden layer applies again', async () => {
    await useMapFocusStore.getState().showRoute(ROUTE);
    await useSelectionStore.getState().select({ kind: 'route', id: ROUTE });
    expect(useMapFocusStore.getState().shown).not.toBeNull();
    await useSelectionStore.getState().select({ kind: 'waypoint', id: WAYPOINT });
    expect(useMapFocusStore.getState().shown).toBeNull();
  });

  it('gives each request its own number, so asking twice moves the map twice', async () => {
    await useMapFocusStore.getState().showWaypoint(WAYPOINT);
    const first = useMapFocusStore.getState().target?.seq;
    await useMapFocusStore.getState().showWaypoint(WAYPOINT);
    expect(useMapFocusStore.getState().target?.seq).not.toBe(first);
  });
});

describe("a track asked for from its trip's page", () => {
  it('selects the track and asks the map for its box, drawn with its layer hidden', async () => {
    await useMapFocusStore.getState().showTrack(TRACK);
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'track', id: TRACK });
    expect(useMapFocusStore.getState().target?.bounds).toEqual(TRACK_BOX);
    expect(useMapFocusStore.getState().shown).toEqual({ kind: 'track', id: TRACK });
  });

  it('says so for a track with no points, and leaves the map alone', async () => {
    await useMapFocusStore.getState().showTrack(EMPTY_TRACK);
    expect(useMapFocusStore.getState().target).toBeNull();
    expect(toasts).toEqual(['That track has no points to show.']);
  });
});

describe("a trip asked for from its page's header", () => {
  it("selects the trip and asks the map for its geometry's box", async () => {
    await useMapFocusStore.getState().showTrip(TRIP);
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'trip', id: TRIP });
    expect(useMapFocusStore.getState().target?.bounds).toEqual(TRIP_BOX);
  });

  it('leaves hidden layers hidden: it asks for the trip, not one object in it', async () => {
    await useMapFocusStore.getState().showRoute(ROUTE);
    expect(useMapFocusStore.getState().shown).not.toBeNull();
    await useMapFocusStore.getState().showTrip(TRIP);
    expect(useMapFocusStore.getState().shown).toBeNull();
  });

  it("reads the trip's own geometry, not an earlier trip's still loaded", async () => {
    useGeometryStore.setState({ tripId: EMPTY_TRIP, geometry: geometryFor(EMPTY_TRIP, null) as never });
    await useMapFocusStore.getState().showTrip(TRIP);
    expect(useMapFocusStore.getState().target?.bounds).toEqual(TRIP_BOX);
  });

  it('says so for a trip with nothing in it, and leaves the map alone', async () => {
    await useMapFocusStore.getState().showTrip(EMPTY_TRIP);
    expect(useMapFocusStore.getState().target).toBeNull();
    expect(toasts).toEqual(['This trip has nothing to show on the map yet: no routes, tracks or waypoints.']);
  });
});

describe('a photo asked for from the grid', () => {
  it('moves the map to where it was taken', () => {
    useMapFocusStore.getState().goToPhoto({ lat: LEEK.lat, lon: LEEK.lon, state: 'located', reason: null });
    expect(useMapFocusStore.getState().target?.bounds).toEqual({ minLat: LEEK.lat, maxLat: LEEK.lat, minLon: LEEK.lon, maxLon: LEEK.lon });
  });

  it('says why a photo with no location cannot be shown', () => {
    useMapFocusStore.getState().goToPhoto({ lat: null, lon: null, state: 'unlocated', reason: null });
    expect(useMapFocusStore.getState().target).toBeNull();
    expect(toasts).toEqual(['This photo is not on the map: no location.']);
  });
});
