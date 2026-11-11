import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isoWeekday,
  isValidDate,
  isValidTime,
  isValidZone,
  minutesOfDay,
  utcToWallClock,
  wallClockToUtc,
  zoneOffsetMs,
} from './zoned';

const LONDON = 'Europe/London';
const HOUR = 3_600_000;

describe('isValidDate / isValidTime', () => {
  it.each(['2026-10-25', '2028-02-29', '2026-12-31'])('accepts %s', (date) => {
    expect(isValidDate(date)).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-01', '26-10-25', ''])(
    'refuses %s',
    (date) => {
      expect(isValidDate(date)).toBe(false);
    },
  );

  it.each(['00:00', '09:00', '23:59'])('accepts %s', (time) => {
    expect(isValidTime(time)).toBe(true);
  });

  it.each(['24:00', '25:00', '9:00', '09:60', '0900'])('refuses %s', (time) => {
    expect(isValidTime(time)).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is unaffected by the clock change', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('refuses a fractional count', () => {
    expect(() => addDays('2026-10-24', 1.5)).toThrow(RangeError);
  });

  it('daysBetween is its inverse', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-26', '2026-10-24')).toBe(-2);
  });
});

describe('isoWeekday and minutesOfDay', () => {
  it('counts Monday as 0 and Sunday as 6', () => {
    // 25 October 2026 is the last Sunday of October.
    expect(isoWeekday('2026-10-25')).toBe(6);
    expect(isoWeekday('2026-10-26')).toBe(0);
  });

  it('converts HH:mm to minutes', () => {
    expect(minutesOfDay('09:30')).toBe(570);
  });
});

describe('zoneOffsetMs', () => {
  it('is an hour in British Summer Time and zero in winter', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 6, 1, 12), LONDON)).toBe(HOUR);
    expect(zoneOffsetMs(Date.UTC(2026, 11, 1, 12), LONDON)).toBe(0);
  });

  it('ignores milliseconds rather than leaking them into the offset', () => {
    expect(zoneOffsetMs(Date.UTC(2026, 11, 1, 12) + 999, LONDON)).toBe(0);
  });
});

describe('wallClockToUtc', () => {
  it('reads a summer time as BST', () => {
    expect(wallClockToUtc({ date: '2026-07-01', time: '09:00' }, LONDON)).toBe(
      Date.UTC(2026, 6, 1, 8),
    );
  });

  it('reads a winter time as GMT', () => {
    expect(wallClockToUtc({ date: '2026-12-01', time: '09:00' }, LONDON)).toBe(
      Date.UTC(2026, 11, 1, 9),
    );
  });

  it('09:00 the morning after BST ends is 09:00 GMT, not 08:00', () => {
    // BST ends at 02:00 BST (01:00 UTC) on Sunday 25 October 2026.
    expect(wallClockToUtc({ date: '2026-10-24', time: '09:00' }, LONDON)).toBe(
      Date.UTC(2026, 9, 24, 8),
    );
    expect(wallClockToUtc({ date: '2026-10-26', time: '09:00' }, LONDON)).toBe(
      Date.UTC(2026, 9, 26, 9),
    );
  });

  it('moves a time in the spring gap forward by the gap', () => {
    // 01:30 on 29 March 2026 never happens in London.
    const instant = wallClockToUtc({ date: '2026-03-29', time: '01:30' }, LONDON);
    expect(instant).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(utcToWallClock(instant, LONDON).time).toBe('02:30');
  });

  it('takes the earlier instant in the autumn overlap', () => {
    // 01:30 on 25 October 2026 happens twice: once in BST, once in GMT.
    const instant = wallClockToUtc({ date: '2026-10-25', time: '01:30' }, LONDON);
    expect(instant).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(utcToWallClock(instant, LONDON)).toEqual({
      date: '2026-10-25',
      time: '01:30',
      offsetMinutes: 60,
    });
  });

  it('round-trips every quarter hour across both clock changes', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        const instant = wallClockToUtc({ date, time }, LONDON);
        const back = utcToWallClock(instant, LONDON);
        const inGap = date === '2026-03-29' && time.startsWith('01:');
        if (inGap) {
          expect(back.time.startsWith('02:')).toBe(true);
        } else {
          expect({ date: back.date, time: back.time }).toEqual({ date, time });
        }
      }
    }
  });

  it('refuses a date or time that does not exist on any calendar', () => {
    expect(() => wallClockToUtc({ date: '2026-02-30', time: '09:00' }, LONDON)).toThrow(
      RangeError,
    );
    expect(() => wallClockToUtc({ date: '2026-02-01', time: '24:00' }, LONDON)).toThrow(
      RangeError,
    );
  });

  it('works in a zone well away from UTC', () => {
    expect(wallClockToUtc({ date: '2026-07-01', time: '09:00' }, 'Asia/Kolkata')).toBe(
      Date.UTC(2026, 6, 1, 3, 30),
    );
  });
});

describe('isValidZone', () => {
  it('knows London and refuses nonsense', () => {
    expect(isValidZone(LONDON)).toBe(true);
    expect(isValidZone('Mars/Olympus_Mons')).toBe(false);
  });
});
