import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import { useNavStore } from './navStore';
import { usePhotoStore } from './photoStore';
import { useSelectionStore } from './selectionStore';

/** Phase 14 Requirement 1.2: the section, the open trip and its tab persist. */

const TRIP = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f';
let writes: { key: string; value: unknown }[];
const none = () => Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'none' } });

beforeEach(() => {
  writes = [];
  vi.stubGlobal('window', {
    trailrt: {
      settings: {
        set: (entry: { key: string; value: unknown }) => {
          writes.push(entry);
          return Promise.resolve({ ok: true, data: DEFAULT_SETTINGS });
        },
      },
      trips: { get: none },
      geometry: { forTrip: none },
    },
  });
  useNavStore.setState({ section: 'trips', openTripId: null, tripTab: 'plan', request: null });
  usePhotoStore.setState({ allTrips: false });
  useSelectionStore.setState({ selected: null, selectedKeys: new Set(), anchorKey: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('navigation', () => {
  it('persists the section, the open trip and the tab', () => {
    const nav = useNavStore.getState();
    nav.setSection('routes');
    nav.openTrip(TRIP);
    nav.setTab('objects');
    nav.closeTrip();
    expect(writes).toEqual([
      { key: 'librarySection', value: 'routes' },
      { key: 'openTripId', value: TRIP },
      { key: 'librarySection', value: 'trips' },
      { key: 'tripTab', value: 'objects' },
      { key: 'openTripId', value: null },
    ]);
  });

  it('opening a trip shows the Trips section and selects the trip, so the map loads it', () => {
    useNavStore.getState().setSection('waypoints');
    useNavStore.getState().openTrip(TRIP);
    expect(useNavStore.getState().section).toBe('trips');
    expect(useSelectionStore.getState().selected).toEqual({ kind: 'trip', id: TRIP });
  });

  it('restores where it was left, and the Photos section is all-trips mode', () => {
    useNavStore.getState().hydrate({ ...DEFAULT_SETTINGS, librarySection: 'photos', openTripId: TRIP, tripTab: 'photos' });
    expect(useNavStore.getState()).toMatchObject({ section: 'photos', openTripId: TRIP, tripTab: 'photos' });
    expect(usePhotoStore.getState().allTrips).toBe(true);
  });

  it('leaving the Photos section leaves all-trips mode', () => {
    usePhotoStore.setState({ allTrips: true });
    useNavStore.setState({ section: 'photos' });
    useNavStore.getState().setSection('tracks');
    expect(usePhotoStore.getState().allTrips).toBe(false);
  });

  it('a request is held until a list takes it', () => {
    useNavStore.getState().ask('newTrip');
    expect(useNavStore.getState().request?.kind).toBe('newTrip');
  });
});
