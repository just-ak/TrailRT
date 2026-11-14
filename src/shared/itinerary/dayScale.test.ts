import { describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import { utcToWallClock, wallClockToUtc } from '../time/zoned';
import { dayScale, photoInstant, tripHours } from './dayScale';
import { stop, viewOf, weekend, ZONE } from './testViews';

/*
 * The same weekend the calendar's tests use: leave Buxton at 16:00 on Friday
 * 23 October 2026, an hour to Leek, two days there across the end of British
 * Summer Time, then an hour to Ashbourne on Sunday.
 */

const local = (at: number): string => utcToWallClock(at, ZONE).time.slice(0, 5);
const at = (date: string, time: string): number => wallClockToUtc({ date, time }, ZONE);

describe('the range of a day', () => {
  it('runs from an hour before the first event to an hour after the last, on whole hours', () => {
    const friday = dayScale({ view: weekend, date: '2026-10-23' });
    expect(local(friday.start)).toBe('15:00');
    expect(local(friday.end)).toBe('18:00');
    expect(friday.hours.map((h) => h.label)).toEqual(['15:00', '16:00', '17:00', '18:00']);
    expect(friday.hours[0]?.top).toBe(0);
    expect(friday.hours.at(-1)?.top).toBe(1);
  });

  it('does not stretch to midnight for a stay that carries on overnight; the stay runs to the end of the scale', () => {
    const friday = dayScale({ view: weekend, date: '2026-10-23' });
    const stay = friday.plan.find((p) => p.block.label === 'Leek');
    expect(stay?.continuesAfter).toBe(true);
    expect((stay?.top ?? 0) + (stay?.height ?? 0)).toBeCloseTo(1, 9);
  });

  it('shows the usual hours on a day spent entirely in one place', () => {
    const saturday = dayScale({ view: weekend, date: '2026-10-24' });
    expect([local(saturday.start), local(saturday.end)]).toEqual(['08:00', '18:00']);
    const stay = saturday.plan.find((p) => p.block.label === 'Leek');
    expect(stay?.top).toBe(0);
    expect(stay?.height).toBeCloseTo(1, 9);
  });

  it('handles the day the clocks go back: the stay ends at 09:00 GMT', () => {
    const sunday = dayScale({ view: weekend, date: '2026-10-25' });
    expect(local(sunday.start)).toBe('08:00');
    expect(local(sunday.end)).toBe('12:00');
    const stay = sunday.plan.find((p) => p.block.label === 'Leek');
    expect(stay?.continuesBefore).toBe(true);
    expect(stay?.top).toBe(0);
    expect(stay?.height).toBeCloseTo(1 / 4, 9);
  });

  it('shows 08:00 to 18:00 for a day with nothing in it', () => {
    const empty = dayScale({ view: weekend, date: '2026-11-02' });
    expect([local(empty.start), local(empty.end)]).toEqual(['08:00', '18:00']);
    expect(empty.plan).toEqual([]);
  });
});

describe('what is missing stays missing', () => {
  it('lists a drive with no route as untimed, and never places it', () => {
    const unplanned = viewOf([stop('a', 'Buxton', BUXTON, {}, null), stop('b', 'Leek', LEEK, {}, null)]);
    const day = dayScale({ view: unplanned, date: '2026-10-23' });
    expect(day.untimed.map((b) => b.label)).toEqual(['Drive to Leek', 'Arrive Leek']);
    expect(day.plan.some((p) => p.block.kind === 'leg')).toBe(false);
  });

  it('does not place a track without timestamps, and says which', () => {
    const day = dayScale({
      view: weekend,
      date: '2026-10-23',
      tracks: [{ id: 'k', name: 'Old log', startedAt: null, endedAt: null }],
    });
    expect(day.recorded).toEqual([]);
    expect(day.unplaceable).toEqual([{ id: 'k', name: 'Old log' }]);
  });
});

describe('the Recorded lane', () => {
  it('places tracks by their recorded times, and gives overlapping ones their own lanes', () => {
    const day = dayScale({
      view: weekend,
      date: '2026-10-23',
      tracks: [
        { id: 'walk', name: 'Walk', startedAt: at('2026-10-23', '17:15'), endedAt: at('2026-10-23', '18:40') },
        { id: 'ride', name: 'Ride', startedAt: at('2026-10-23', '18:00'), endedAt: at('2026-10-23', '19:00') },
        { id: 'other', name: 'Another day', startedAt: at('2026-10-21', '10:00'), endedAt: at('2026-10-21', '11:00') },
      ],
    });
    expect(day.recorded.map((r) => [r.trackId, r.lane])).toEqual([
      ['walk', 0],
      ['ride', 1],
    ]);
    expect(day.recorded.every((r) => r.lanes === 2)).toBe(true);
    // The range grows to hold them: an hour after 19:00.
    expect(local(day.end)).toBe('20:00');
  });
});

describe('photo times', () => {
  it('reads a photo with a zone exactly, and one without as camera time in the day’s zone', () => {
    const withZone = photoInstant({ id: 'p', takenLocal: '2026-10-23T17:30:00', takenOffsetMin: 60 }, ZONE);
    const camera = photoInstant({ id: 'q', takenLocal: '2026-10-23T17:30:00', takenOffsetMin: null }, ZONE);
    expect(withZone).toEqual({ at: at('2026-10-23', '17:30'), cameraTime: false });
    expect(camera).toEqual({ at: at('2026-10-23', '17:30'), cameraTime: true });
    // Taken in Tokyo at 17:30 is 08:30 UTC, whatever zone the trip is in.
    expect(photoInstant({ id: 'r', takenLocal: '2026-10-23T17:30:00', takenOffsetMin: 540 }, ZONE)?.at).toBe(Date.UTC(2026, 9, 23, 8, 30));
    expect(photoInstant({ id: 's', takenLocal: null, takenOffsetMin: null }, ZONE)).toBeNull();
  });

  it('puts the day’s photos on the scale in time order, and leaves out other days’', () => {
    const day = dayScale({
      view: weekend,
      date: '2026-10-23',
      photos: [
        { id: 'late', takenLocal: '2026-10-23T17:40:00', takenOffsetMin: 60 },
        { id: 'early', takenLocal: '2026-10-23T16:20:00', takenOffsetMin: null },
        { id: 'tomorrow', takenLocal: '2026-10-24T10:00:00', takenOffsetMin: 60 },
        { id: 'undated', takenLocal: null, takenOffsetMin: null },
      ],
    });
    expect(day.photos.map((p) => [p.id, p.cameraTime])).toEqual([
      ['early', true],
      ['late', false],
    ]);
    expect(day.photos[0]?.top).toBeGreaterThan(0);
    expect(day.photos[1]?.top).toBeLessThan(1);
  });
});

describe('the trip by the hour', () => {
  it('lines every day up on the widest of their own ranges', () => {
    const trip = tripHours({ view: weekend });
    expect(trip.window).toEqual({ fromHour: 8, toHour: 18 });
    expect(trip.days.map((d) => d.date)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25']);
    for (const day of trip.days) {
      expect([day.hours[0]?.label, day.hours.at(-1)?.label]).toEqual(['08:00', '18:00']);
    }
    // Friday's drive is still at 16:00, eight hours into ten, and an hour long.
    const drive = trip.days[0]?.plan.find((p) => p.block.kind === 'leg');
    expect(drive?.top).toBeCloseTo(8 / 10, 9);
    expect(drive?.exactTop).toBeCloseTo(8 / 10, 9);
    expect(drive?.exactHeight).toBeCloseTo(1 / 10, 9);
    // Leaving Buxton is an instant: it has a place on the scale and no length.
    const leave = trip.days[0]?.plan.find((p) => p.block.label === 'Leave Buxton');
    expect(leave?.exactHeight).toBe(0);
    expect(leave?.height).toBeGreaterThan(0);
  });

  it('has no days, and the usual hours, when the timeline has none', () => {
    const empty = { ...weekend, timeline: { ...weekend.timeline, days: [] } };
    expect(tripHours({ view: empty })).toEqual({ window: { fromHour: 8, toHour: 18 }, days: [] });
  });
});
