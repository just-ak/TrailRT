import { describe, expect, it } from 'vitest';
import type { TripOverview } from '../domain/library';
import { daysInMonth, tripsOn, yearMarks } from './yearMarks';

const NONE = { routes: 0, tracks: 0, waypoints: 0, photos: 0, linkedFolders: 0 };
const trip = (id: string, over: Partial<TripOverview> = {}): TripOverview => ({
  id,
  name: id,
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
});

const TRIPS = [
  trip('peak', { startDate: '2026-11-13', endDate: '2026-11-15', days: 3 }),
  trip('idea1', { startDate: '2026-11-12', endDate: '2026-11-12', days: 1 }),
  trip('half', { startDate: '2026-11-18' }),
  trip('new-year', { startDate: '2026-12-31', endDate: '2027-01-02', days: 3 }),
  trip('log', { startDate: '2024-06-08', endDate: '2024-06-08', days: 1 }),
  trip('something'),
];

describe('the year view', () => {
  it('marks each trip from its start to its end, and only the start when the end is unknown', () => {
    const marks = yearMarks(TRIPS, 2026);
    expect([...marks.days.keys()]).toEqual(['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-18', '2026-12-31']);
    expect(marks.trips.map((t) => t.id)).toEqual(['idea1', 'peak', 'half', 'new-year']);
  });

  it('carries a trip across the new year, and gives each trip one colour', () => {
    const next = yearMarks(TRIPS, 2027);
    expect([...next.days.keys()]).toEqual(['2027-01-01', '2027-01-02']);
    const marks = yearMarks(TRIPS, 2026);
    expect(new Set(marks.colours.values()).size).toBe(4);
  });

  it('finds what is on today and tomorrow, and leaves undated trips out', () => {
    expect(tripsOn(TRIPS, '2026-11-14').map((t) => t.id)).toEqual(['peak']);
    expect(tripsOn(TRIPS, '2026-11-16')).toEqual([]);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});
