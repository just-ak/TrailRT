import { describe, expect, it } from 'vitest';
import type { TripOverview } from '../domain/library';
import { contentsText, groupTrips, shortDay, tripMeta } from './tripGroups';

const NONE = { routes: 0, tracks: 0, waypoints: 0, photos: 0, linkedFolders: 0 };

function trip(name: string, over: Partial<TripOverview> = {}): TripOverview {
  return {
    id: name,
    name,
    folderId: null,
    status: 'active',
    startDate: null,
    endDate: null,
    days: null,
    distanceM: null,
    driveSeconds: null,
    startPlace: null,
    startTime: null,
    counts: NONE,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

// The owner's library on 12 November 2026, with an example three-day trip.
const TODAY = '2026-11-12';
const LIBRARY = [
  trip('Idea1', { startDate: '2026-11-12', endDate: '2026-11-12', days: 1, distanceM: 33_000, counts: { ...NONE, routes: 1, waypoints: 2 } }),
  trip('Peak loop', { startDate: '2026-11-13', endDate: '2026-11-15', days: 3, distanceM: 97_000 }),
  trip('New Trip', { startDate: '2026-11-18' }),
  trip('Something', { updatedAt: 5 }),
  trip('New Trip ', { updatedAt: 9 }),
  trip('Active Log: 08 Jun 2024', { startDate: '2024-06-08', endDate: '2024-06-08', days: 1, distanceM: 24_200, counts: { ...NONE, tracks: 1 } }),
  trip('Peak 2025', { startDate: '2025-06-14', endDate: '2025-06-16', days: 3 }),
];

describe('groupTrips', () => {
  it('groups as Coming up, Ideas, then past years, newest first', () => {
    const groups = groupTrips(LIBRARY, TODAY);
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.trip.name)])).toEqual([
      ['Coming up', ['Idea1', 'Peak loop', 'New Trip']],
      ['Ideas · no dates', ['New Trip ', 'Something']],
      ['2025', ['Peak 2025']],
      ['2024', ['Active Log: 08 Jun 2024']],
    ]);
  });

  it('says Today and Tomorrow', () => {
    const coming = groupTrips(LIBRARY, TODAY)[0]?.rows ?? [];
    expect(coming.map((r) => r.when)).toEqual(['Today', 'Tomorrow', null]);
    expect(coming[0]?.meta).toBe('Today · Thu 12 Nov · 1 day · 33 km');
    expect(coming[1]?.meta).toBe('Tomorrow · 13–15 Nov 2026 · 3 days · 97 km');
  });

  it('keeps a trip that is under way in Coming up until its last day has passed', () => {
    const underway = trip('Underway', { startDate: '2026-11-10', endDate: '2026-11-12', days: 3 });
    expect(groupTrips([underway], TODAY)[0]?.label).toBe('Coming up');
    expect(groupTrips([underway], '2026-11-13')[0]?.label).toBe('2026');
  });

  it('keeps a trip with a date but no stops in Coming up, from its first day', () => {
    const noStops = groupTrips([trip('New Trip', { startDate: '2026-11-18' })], TODAY)[0]?.rows[0];
    expect(noStops?.meta).toBe('From Wed 18 Nov · no stops yet');
  });
});

describe('trip second lines', () => {
  it('says what is in an undated trip, or Empty', () => {
    expect(contentsText(NONE)).toBe('Empty');
    expect(contentsText({ ...NONE, waypoints: 2, routes: 1 })).toBe('1 route · 2 waypoints');
    expect(tripMeta(trip('Active Log', { startDate: '2024-06-08', endDate: '2024-06-08', days: 1, distanceM: 24_200 }), null)).toBe(
      'Sat 8 Jun · 1 day · 24 km',
    );
  });

  it('marks an archived trip', () => {
    expect(tripMeta(trip('Old', { status: 'archived' }), null)).toBe('Empty · archived');
  });

  it('names a short day', () => {
    expect(shortDay('2026-11-12')).toBe('Thu 12 Nov');
  });
});
