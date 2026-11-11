import { describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import type { Itinerary, ItineraryStop } from '../domain/itinerary';
import type { LatLon } from '../geo/distance';
import { resolveTimeZone } from '../time/timeZones';
import {
  computeTimeline,
  stopAt,
  timeAlongLeg,
  type TimelineLeg,
  type TimelineStopInput,
} from './timeline';

/*
 * Leg lengths are chosen to make the arithmetic legible: by car the timeline
 * uses the 55 km/h average from `travelTime.ts`, so 55 km is exactly an hour.
 */
const HOUR_BY_CAR = 55_000;

function itinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  return {
    tripId: 'trip',
    startDate: '2026-07-01',
    startTime: '09:00',
    defaultDepart: '09:00',
    maxDriveMinutes: null,
    rangeKm: null,
    reservePct: 20,
    energy: 'fuel',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

let nextId = 0;
function stop(overrides: Partial<ItineraryStop> = {}): ItineraryStop {
  nextId += 1;
  return {
    id: `stop-${nextId}`,
    tripId: 'trip',
    seq: nextId,
    waypointId: `wp-${nextId}`,
    legRouteId: null,
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
  };
}

function leg(distanceM: number | null, mode: TimelineLeg['mode'] = 'auto'): TimelineLeg {
  return { routeId: `route-${distanceM}`, distanceM, mode };
}

function entry(
  position: LatLon | null,
  legIn: TimelineLeg | null,
  overrides: Partial<ItineraryStop> = {},
): TimelineStopInput {
  return { stop: stop(overrides), position, leg: legIn };
}

function run(stops: TimelineStopInput[], plan: Partial<Itinerary> = {}, walkingSpeedKmh = 4.5) {
  return computeTimeline(
    { itinerary: itinerary(plan), stops, walkingSpeedKmh, fallbackZone: 'UTC' },
    resolveTimeZone,
  );
}

const at = (y: number, m: number, d: number, h: number, min = 0): number =>
  Date.UTC(y, m - 1, d, h, min);

describe('computeTimeline', () => {
  it('times an hours stop: arrive, stay, leave', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationMinutes: 90 }),
      entry(ASHBOURNE, leg(2 * HOUR_BY_CAR)),
    ]);

    const [start, lunch, end] = timeline.stops;
    // 09:00 BST is 08:00 UTC.
    expect(start?.departure).toBe(at(2026, 7, 1, 8));
    expect(lunch?.arrivalLocal?.time).toBe('10:00');
    expect(lunch?.departureLocal?.time).toBe('11:30');
    expect(end?.arrivalLocal?.time).toBe('13:30');
    expect(end?.departure).toBeNull();
    expect(timeline.complete).toBe(true);
    expect(timeline.endDate).toBe('2026-07-01');
    expect(lunch?.legSpeedKmh).toBe(55);
    expect(lunch?.flags).toEqual([]);
  });

  it('a two-day stay across the clock change leaves at 09:00 GMT', () => {
    // Arrive Friday 23 October 2026 at 17:00 BST; BST ends early on Sunday.
    const timeline = run(
      [
        entry(MACCLESFIELD, null),
        entry(BUXTON, leg(HOUR_BY_CAR), { durationKind: 'days', durationDays: 2 }),
        entry(ASHBOURNE, leg(HOUR_BY_CAR)),
      ],
      { startDate: '2026-10-23', startTime: '16:00' },
    );

    const stay = timeline.stops[1];
    expect(stay?.arrival).toBe(at(2026, 10, 23, 16)); // 17:00 BST
    expect(stay?.departure).toBe(at(2026, 10, 25, 9)); // 09:00 GMT
    expect(stay?.departureLocal).toEqual({ date: '2026-10-25', time: '09:00', offsetMinutes: 0 });
    // A 48-hour stay would have left at 16:00 UTC on the 25th instead.
    expect(stay?.departure).not.toBe((stay?.arrival ?? 0) + 48 * 3_600_000);
  });

  it('a day-stay uses its own departure time over the default', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationKind: 'days', durationDays: 1, departTime: '11:15' }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    expect(timeline.stops[1]?.departureLocal).toMatchObject({ date: '2026-07-02', time: '11:15' });
  });

  it('flags a missed arrive-by and moves nothing', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { arriveBy: '09:30', durationMinutes: 30 }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    const missed = timeline.stops[1];
    expect(missed?.flags).toContain('arrive-by-missed');
    expect(missed?.arrivalLocal?.time).toBe('10:00');
    expect(missed?.departureLocal?.time).toBe('10:30');
  });

  it('an arrive-by that is met raises nothing', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { arriveBy: '10:00' }),
    ]);
    expect(timeline.stops[1]?.flags).toEqual([]);
  });

  it('depart-at waits when arrival is early', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationMinutes: 30, departAt: '11:00' }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    expect(timeline.stops[1]?.departureLocal?.time).toBe('11:00');
    expect(timeline.stops[1]?.flags).toEqual([]);
    expect(timeline.stops[2]?.arrivalLocal?.time).toBe('12:00');
  });

  it('depart-at that is too early is flagged and kept', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationMinutes: 30, departAt: '10:15' }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    expect(timeline.stops[1]?.flags).toContain('depart-at-too-early');
    expect(timeline.stops[1]?.departureLocal?.time).toBe('10:15');
    expect(timeline.stops[2]?.arrivalLocal?.time).toBe('11:15');
  });

  it('an unplanned leg makes it and every later time unknown, not zero', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationMinutes: 60 }),
      entry(MACCLESFIELD, null, { durationMinutes: 60 }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);

    const [, known, gap, after] = timeline.stops;
    expect(known?.arrival).not.toBeNull();
    expect(gap?.flags).toContain('unplanned-leg');
    expect(gap?.arrival).toBeNull();
    expect(gap?.departure).toBeNull();
    expect(gap?.legDriveSeconds).toBeNull();
    expect(after?.flags).toEqual(['unknown-time']);
    expect(after?.arrival).toBeNull();
    expect(timeline.complete).toBe(false);
    expect(timeline.endDate).toBeNull();
  });

  it('times other transport by the time given, and does not count it as driving', () => {
    const ferry: TimelineLeg = { routeId: null, distanceM: null, mode: 'auto', kind: 'other', minutes: 120 };
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, ferry, { durationMinutes: 30 }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    expect(timeline.stops[1]?.arrivalLocal?.time).toBe('11:00');
    expect(timeline.stops[1]?.legKind).toBe('other');
    expect(timeline.stops[1]?.legSpeedKmh).toBeNull();
    expect(timeline.stops[2]?.arrivalLocal?.time).toBe('12:30');
    expect(timeline.days[0]?.otherSeconds).toBe(7200);
    expect(Math.round(timeline.days[0]?.driveSeconds ?? 0)).toBe(3600);
  });

  it('other transport with no time makes the rest unknown, and says why', () => {
    const ferry: TimelineLeg = { routeId: null, distanceM: null, mode: 'auto', kind: 'other', minutes: null };
    const timeline = run([entry(BUXTON, null), entry(LEEK, ferry), entry(ASHBOURNE, leg(HOUR_BY_CAR))]);
    expect(timeline.stops[1]?.flags).toEqual(['no-travel-time']);
    expect(timeline.stops[1]?.arrival).toBeNull();
    expect(timeline.stops[2]?.flags).toEqual(['unknown-time']);
  });

  it('a route with no length is unplanned, not instant', () => {
    const timeline = run([entry(BUXTON, null), entry(LEEK, leg(null))]);
    expect(timeline.stops[1]?.flags).toContain('unplanned-leg');
    expect(timeline.stops[1]?.arrival).toBeNull();
  });

  it('flags a deleted location but still times its leg', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(null, leg(HOUR_BY_CAR), { durationMinutes: 30 }),
      entry(ASHBOURNE, leg(HOUR_BY_CAR)),
    ]);
    const lost = timeline.stops[1];
    expect(lost?.flags).toEqual(['location-deleted', 'zone-unknown']);
    expect(lost?.arrival).toBe(at(2026, 7, 1, 9));
    expect(lost?.zone).toBe('UTC');
  });

  it('a stop outside the zone table is shown in the fallback zone and flagged', () => {
    const dublin = { lat: 53.35, lon: -6.26 };
    const timeline = run([entry(BUXTON, null), entry(dublin, leg(HOUR_BY_CAR))]);
    expect(timeline.stops[1]?.zoneKnown).toBe(false);
    expect(timeline.stops[1]?.flags).toEqual(['zone-unknown']);
    expect(timeline.stops[1]?.arrivalLocal?.time).toBe('09:00'); // UTC fallback
  });

  it('flags a day over the driving cap and re-plans nothing', () => {
    const timeline = run(
      [
        entry(BUXTON, null),
        entry(LEEK, leg(HOUR_BY_CAR * 1.5), { durationMinutes: 30 }),
        entry(ASHBOURNE, leg(HOUR_BY_CAR * 1.5)),
      ],
      { maxDriveMinutes: 120 },
    );
    expect(timeline.days).toHaveLength(1);
    expect(timeline.days[0]?.driveSeconds).toBeCloseTo(3 * 3600, 6);
    expect(timeline.days[0]?.driveDistanceM).toBeCloseTo(165_000, 6);
    expect(timeline.days[0]?.overDailyCap).toBe(true);
    expect(timeline.stops[2]?.arrivalLocal?.time).toBe('12:30');
  });

  it('times a walking leg at the planning speed and a driving leg never', () => {
    const walking = run([entry(BUXTON, null), entry(LEEK, leg(9000, 'pedestrian'))], {}, 4.5);
    expect(walking.stops[1]?.legSpeedKmh).toBe(4.5);
    expect(walking.stops[1]?.legDriveSeconds).toBeCloseTo(2 * 3600, 6);

    const driving = run([entry(BUXTON, null), entry(LEEK, leg(9000, 'auto'))], {}, 4.5);
    expect(driving.stops[1]?.legSpeedKmh).toBe(55);
  });

  it('spends each night at the right stop and counts driving on its departure date', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationKind: 'days', durationDays: 2 }),
      entry(BUXTON, leg(HOUR_BY_CAR)),
    ]);
    const [startStop, stay, home] = timeline.stops;
    expect(timeline.days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(timeline.days.map((d) => d.nightStopId)).toEqual([
      stay?.stopId,
      stay?.stopId,
      home?.stopId,
    ]);
    expect(timeline.days.map((d) => Math.round(d.driveSeconds))).toEqual([3600, 0, 3600]);
    expect(startStop?.arrival).toBeNull();
    expect(timeline.endDate).toBe('2026-07-03');
  });

  it('marks days after an unknown time as incomplete', () => {
    const timeline = run([
      entry(BUXTON, null),
      entry(LEEK, leg(HOUR_BY_CAR), { durationKind: 'days', durationDays: 1 }),
      entry(ASHBOURNE, null),
    ]);
    expect(timeline.days.map((d) => [d.date, d.incomplete])).toEqual([
      ['2026-07-01', false],
      ['2026-07-02', true],
    ]);
  });

  it('copes with a single stop and with none', () => {
    const one = run([entry(BUXTON, null)]);
    expect(one.endDate).toBe('2026-07-01');
    expect(one.complete).toBe(true);
    const none = run([]);
    expect(none.stops).toEqual([]);
    expect(none.days).toEqual([]);
    expect(none.endDate).toBeNull();
  });
});

describe('stopAt and timeAlongLeg', () => {
  const timeline = run([
    entry(BUXTON, null),
    entry(LEEK, leg(HOUR_BY_CAR), { durationMinutes: 60 }),
    entry(ASHBOURNE, leg(HOUR_BY_CAR)),
  ]);

  it('is at the first stop before leaving, on the road between, and at the end after', () => {
    const ids = timeline.stops.map((s) => s.stopId);
    expect(stopAt(timeline.stops, at(2026, 7, 1, 7))).toBe(ids[0]);
    expect(stopAt(timeline.stops, at(2026, 7, 1, 8, 30))).toBeNull();
    expect(stopAt(timeline.stops, at(2026, 7, 1, 9, 30))).toBe(ids[1]);
    expect(stopAt(timeline.stops, at(2026, 7, 2, 0))).toBe(ids[2]);
  });

  it('estimates when a point partway along a leg is passed', () => {
    expect(timeAlongLeg(timeline, 1, HOUR_BY_CAR / 2)).toBe(at(2026, 7, 1, 8, 30));
    expect(timeAlongLeg(timeline, 0, 1000)).toBeNull();
  });
});
