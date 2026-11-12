import { afterEach, describe, expect, it } from 'vitest';
import { usePhotoStore } from '../../stores/photoStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { mapScopeFor, scopeKey } from './photoMapScope';

const TRIP = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f';
const OTHER = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e70';

afterEach(() => {
  usePhotoStore.setState({ allTrips: false });
  useSelectionStore.setState({ selected: null, selectedKeys: new Set(), anchorKey: null });
});

describe('which photos the map shows (design §9.1)', () => {
  it('shows the photos of the trip on the map, or none without one', () => {
    expect(mapScopeFor({ allTrips: false, tripId: TRIP, filter: {}, includeArchived: false })).toEqual({ tripId: TRIP });
    expect(mapScopeFor({ allTrips: false, tripId: null, filter: {}, includeArchived: false })).toBeNull();
  });

  it('shows every trip’s photos in all-trips mode, narrowed by the Photos view’s filters', () => {
    expect(mapScopeFor({ allTrips: true, tripId: TRIP, filter: {}, includeArchived: false })).toEqual({
      all: true,
      includeArchived: false,
    });
    expect(
      mapScopeFor({ allTrips: true, tripId: null, filter: { year: 'none', tripId: OTHER }, includeArchived: true }),
    ).toEqual({ all: true, includeArchived: true, year: 'none', tripId: OTHER });
  });

  it('keys equal scopes alike, so the same points are not fetched twice', () => {
    expect(scopeKey({ tripId: TRIP })).toBe(scopeKey({ tripId: TRIP }));
    expect(scopeKey({ tripId: TRIP })).not.toBe(scopeKey({ all: true, includeArchived: false }));
    expect(scopeKey(null)).toBe('none');
  });
});

describe('the Photos view and all-trips mode', () => {
  it('selecting the Photos view switches to all-trips mode, and selecting anything else switches back', () => {
    // What the library does when the Photos view is clicked.
    useSelectionStore.setState({ selected: null });
    usePhotoStore.getState().setAllTrips(true);
    expect(usePhotoStore.getState().allTrips).toBe(true);

    // Selecting a trip, a route or a folder within the view leaves it.
    useSelectionStore.setState({ selected: { kind: 'linkedFolder', id: TRIP } });
    expect(usePhotoStore.getState().allTrips).toBe(false);
  });

  it('clearing the selection does not leave all-trips mode', () => {
    usePhotoStore.getState().setAllTrips(true);
    useSelectionStore.setState({ selected: null });
    expect(usePhotoStore.getState().allTrips).toBe(true);
  });
});
