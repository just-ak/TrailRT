import { describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import type { Itinerary, ItineraryStop, ItineraryView, StopView } from '@shared/domain/itinerary';
import type { LatLon } from '@shared/geo/distance';
import { computeTimeline } from '@shared/itinerary/timeline';
import { resolveTimeZone } from '@shared/time/timeZones';
import {
  calendarBlocks,
  dayBounds,
  monthGrid,
  placeDay,
  snapDuration,
  unknownBlocks,
  weekDates,
} from './calendarLayout';

const ZONE = 'Europe/London';
const HOUR_BY_CAR = 55_000;

function stop(id: string, name: string, at: LatLon, overrides: Partial<ItineraryStop>, routeKm: number | null): StopView {
  return {
    id,
    tripId: 't',
    seq: 0,
    waypointId: `wp-${id}`,
    legRouteId: routeKm === null ? null : `r-${id}`,
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
    leg: routeKm === null ? null : { routeId: `r-${id}`, name: 'Road', distanceM: routeKm, mode: 'auto', fits: true },
  };
}

function viewOf(stops: StopView[], start = { startDate: '2026-10-23', startTime: '16:00' }): ItineraryView {
  const itinerary: Itinerary = {
    tripId: 't',
    ...start,
    defaultDepart: '09:00',
    maxDriveMinutes: null,
    rangeKm: null,
    reservePct: 20,
    energy: 'fuel',
    createdAt: 0,
    updatedAt: 0,
  };
  const timeline = computeTimeline(
    {
      itinerary,
      stops: stops.map((s) => ({ stop: s, position: s.place, leg: s.leg })),
      walkingSpeedKmh: 4.5,
      fallbackZone: 'UTC',
    },
    resolveTimeZone,
  );
  return { itinerary, stops, timeline };
}

/** Friday 23 October 2026, a two-day stay across the end of BST. */
const weekend = viewOf([
  stop('a', 'Buxton', BUXTON, {}, null),
  stop('b', 'Leek', LEEK, { durationKind: 'days', durationDays: 2, durationMinutes: null }, HOUR_BY_CAR),
  stop('c', 'Ashbourne', ASHBOURNE, {}, HOUR_BY_CAR),
]);

describe('calendarBlocks', () => {
  it('makes a block for each stop and each drive, pointing at what to select', () => {
    const blocks = calendarBlocks(weekend);
    expect(blocks.map((b) => [b.kind, b.label])).toEqual([
      ['stop', 'Leave Buxton'],
      ['leg', 'Drive to Leek'],
      ['stop', 'Leek'],
      ['leg', 'Drive to Ashbourne'],
      ['stop', 'Arrive Ashbourne'],
    ]);
    expect(blocks[1]?.ref).toEqual({ kind: 'route', id: 'r-b' });
    expect(blocks[2]?.ref).toEqual({ kind: 'waypoint', id: 'wp-b' });
    expect(blocks[2]).toMatchObject({ detail: '2 days', resizable: true });
    expect(blocks[0]?.resizable).toBe(false);
  });

  it('lists blocks after an unplanned drive as unknown rather than placing them', () => {
    const gap = viewOf([stop('a', 'Buxton', BUXTON, {}, null), stop('b', 'Leek', LEEK, {}, null)]);
    expect(unknownBlocks(calendarBlocks(gap)).map((b) => b.label)).toEqual(['Drive to Leek', 'Arrive Leek']);
  });
});

describe('placeDay', () => {
  it('places the evening drive and the start of the stay on the first day', () => {
    const placed = placeDay(calendarBlocks(weekend), '2026-10-23', ZONE);
    expect(placed.map((p) => p.block.label)).toEqual(['Leave Buxton', 'Drive to Leek', 'Leek']);
    const drive = placed[1];
    // Leaves at 16:00 BST, an hour's drive, on a 24-hour day.
    expect(drive?.top).toBeCloseTo(16 / 24, 6);
    expect(drive?.height).toBeCloseTo(1 / 24, 6);
    // The departure is an instant, drawn 45 minutes tall beside the drive
    // rather than on top of it.
    expect(placed[0]?.height).toBeCloseTo(0.75 / 24, 6);
    expect(placed[0]?.lane).not.toBe(drive?.lane);
    expect(placed[2]?.continuesAfter).toBe(true);
  });

  it('measures the clock-change day as 25 hours', () => {
    const { start, end } = dayBounds('2026-10-25', ZONE);
    expect((end - start) / 3_600_000).toBe(25);
    const placed = placeDay(calendarBlocks(weekend), '2026-10-25', ZONE);
    const stay = placed.find((p) => p.block.label === 'Leek');
    // The stay ends at 09:00 GMT, which is 10 hours into a 25-hour day.
    expect(stay?.continuesBefore).toBe(true);
    expect(stay?.height).toBeCloseTo(10 / 25, 6);
  });

  it('puts overlapping blocks side by side', () => {
    const blocks = calendarBlocks(weekend);
    const overlapping = [...blocks, { ...blocks[1]!, key: 'copy' }];
    const placed = placeDay(overlapping, '2026-10-23', ZONE);
    const drives = placed.filter((p) => p.block.kind === 'leg');
    expect(new Set(drives.map((p) => p.lane)).size).toBe(2);
    expect(placed.every((p) => p.lanes >= 2)).toBe(true);
  });

  it('never draws a short block past the end of its day', () => {
    // Arrival at Ashbourne is 10:00 GMT on the 25th: an instant, drawn 45 min.
    const placed = placeDay(calendarBlocks(weekend), '2026-10-25', ZONE);
    for (const p of placed) expect(p.top + p.height).toBeLessThanOrEqual(1 + 1e-9);
    const late = placeDay(calendarBlocks(weekend), '2026-10-25', ZONE, 30 * 3_600_000);
    for (const p of late) expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe('weeks and months', () => {
  it('starts weeks on Monday', () => {
    expect(weekDates('2026-10-25')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('covers a month in whole weeks', () => {
    const grid = monthGrid('2026-10-23');
    expect(grid[0]?.[0]).toBe('2026-09-28');
    expect(grid.at(-1)?.at(-1)).toBe('2026-11-01');
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });
});

describe('snapDuration', () => {
  const hours = { durationKind: 'hours' as const, durationMinutes: 60, durationDays: null };
  const days = { durationKind: 'days' as const, durationMinutes: null, durationDays: 2 };

  it('snaps an hours stop to 15 minutes, never below zero', () => {
    expect(snapDuration(hours, 22)).toEqual({ durationMinutes: 75 });
    expect(snapDuration(hours, 7)).toEqual({ durationMinutes: 60 });
    expect(snapDuration(hours, -500)).toEqual({ durationMinutes: 0 });
  });

  it('snaps a day-stay to whole days, never below one', () => {
    expect(snapDuration(days, 26 * 60)).toEqual({ durationDays: 3 });
    expect(snapDuration(days, -5 * 24 * 60)).toEqual({ durationDays: 1 });
  });
});
