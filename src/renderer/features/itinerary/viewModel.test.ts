import { describe, expect, it } from 'vitest';
import type { TimedStop } from '@shared/itinerary/timeline';
import { dayText, flagMessage, isWarning, joinMinutes, legBasis, legText, splitMinutes, tomorrow, whenText } from './viewModel';

const timed = (overrides: Partial<TimedStop>): TimedStop => ({
  stopId: 's',
  index: 1,
  zone: 'Europe/London',
  zoneKnown: true,
  arrival: null,
  departure: null,
  arrivalLocal: null,
  departureLocal: null,
  legDriveSeconds: null,
  legDistanceM: null,
  legSpeedKmh: null,
  legMode: null,
  legKind: 'road',
  flags: [],
  ...overrides,
});

describe('itinerary wording', () => {
  it('names days and times', () => {
    expect(dayText('2026-10-23')).toBe('Fri 23 Oct');
    expect(whenText({ date: '2026-10-23', time: '17:00', offsetMinutes: 60 })).toBe('Fri 23 Oct, 17:00');
    expect(whenText(null)).toBe('—');
  });

  it('shows the offset only when a stop is in a different zone from the calendar', () => {
    const paris = { date: '2026-07-01', time: '10:00', offsetMinutes: 120 };
    expect(whenText(paris, 60)).toBe('Wed 1 Jul, 10:00 (UTC+2)');
    expect(whenText(paris, 120)).toBe('Wed 1 Jul, 10:00');
    expect(whenText({ ...paris, offsetMinutes: 330 }, 60)).toBe('Wed 1 Jul, 10:00 (UTC+5:30)');
  });

  it('describes a leg, or says it has no route', () => {
    expect(legText(timed({ legDriveSeconds: 1260, legDistanceM: 19_000, legSpeedKmh: 55 }), 'metric')).toBe('19.0 km · about 21 min');
    expect(legText(timed({}), 'metric')).toBe('No route planned');
    expect(legText(timed({ index: 0 }), 'metric')).toBe('');
    expect(legBasis(timed({ legSpeedKmh: 55 }))).toBe('Estimated at an average of 55 km/h.');
    expect(legBasis(timed({}))).toBeNull();
  });

  it('explains every flag, and names the zone shown', () => {
    expect(flagMessage('zone-unknown', 'Europe/Paris')).toContain('Europe/Paris');
    expect(isWarning('arrive-by-missed')).toBe(true);
    expect(isWarning('zone-unknown')).toBe(false);
  });

  it('splits and joins hours and minutes, refusing nonsense', () => {
    expect(splitMinutes(95)).toEqual({ hours: 1, minutes: 35 });
    expect(splitMinutes(null)).toEqual({ hours: 0, minutes: 0 });
    expect(joinMinutes('1', '35')).toBe(95);
    expect(joinMinutes('', '45')).toBe(45);
    expect(joinMinutes('1', '75')).toBeNull();
    expect(joinMinutes('x', '0')).toBeNull();
  });

  it('defaults a new plan to tomorrow', () => {
    expect(tomorrow(new Date(2026, 11, 31, 15))).toBe('2027-01-01');
  });
});
