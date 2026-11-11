import { describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import { escapeText, foldLine, transitionsBetween, vtimezone, writeIcs, type IcsStop } from './write';

const LONDON = 'Europe/London';

function stop(overrides: Partial<IcsStop> & Pick<IcsStop, 'id' | 'name'>): IcsStop {
  return {
    lat: BUXTON.lat,
    lon: BUXTON.lon,
    arrival: null,
    departure: null,
    zone: LONDON,
    zoneKnown: true,
    description: '',
    ...overrides,
  };
}

/** Unfolds and splits, as a calendar reader would. */
function lines(text: string): string[] {
  return text.replaceAll('\r\n ', '').split('\r\n').filter((l) => l.length > 0);
}

const trip = {
  calendarName: 'Peak weekend',
  now: Date.UTC(2026, 9, 1, 12),
  stops: [
    stop({ id: 's1', name: 'Macclesfield', departure: Date.UTC(2026, 9, 23, 15) }),
    stop({
      id: 's2',
      name: 'Buxton',
      arrival: Date.UTC(2026, 9, 23, 16),
      departure: Date.UTC(2026, 9, 25, 9),
      description: '2 days',
    }),
    stop({ id: 's3', name: 'Leek', lat: LEEK.lat, lon: LEEK.lon, arrival: Date.UTC(2026, 9, 25, 10) }),
  ],
  legs: [
    {
      id: 'leg-s2',
      summary: 'Drive: Macclesfield → Buxton',
      departure: Date.UTC(2026, 9, 23, 15),
      arrival: Date.UTC(2026, 9, 23, 16),
      zone: LONDON,
      zoneKnown: true,
      description: '19 km, about 21 min (estimate)',
    },
  ],
};

describe('writeIcs', () => {
  const out = writeIcs(trip);
  const all = lines(out.text);

  it('is a well-formed VCALENDAR with CRLF line endings', () => {
    expect(all[0]).toBe('BEGIN:VCALENDAR');
    expect(all.at(-1)).toBe('END:VCALENDAR');
    expect(all).toContain('VERSION:2.0');
    expect(all).toContain('PRODID:-//TrailRT//Road trip//EN');
    expect(out.text.endsWith('\r\n')).toBe(true);
    expect(out.text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    // Every BEGIN has its END.
    const opened = all.filter((l) => l.startsWith('BEGIN:')).map((l) => l.slice(6));
    const closed = all.filter((l) => l.startsWith('END:')).map((l) => l.slice(4));
    expect(opened.toSorted()).toEqual(closed.toSorted());
  });

  it('writes one event per stop and per leg, with stable UIDs', () => {
    expect(out.eventCount).toBe(4);
    expect(all.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(4);
    expect(all).toEqual(expect.arrayContaining(['UID:s1@trailrt', 'UID:s2@trailrt', 'UID:leg-s2@trailrt']));
    expect(all).toContain('SUMMARY:Leave Macclesfield');
    expect(all).toContain('SUMMARY:Arrive Leek');
  });

  it('writes stop times in local time with their zone', () => {
    // 16:00 UTC on 23 October is 17:00 BST; 09:00 UTC on the 25th is 09:00 GMT.
    expect(all).toContain('DTSTART;TZID=Europe/London:20261023T170000');
    expect(all).toContain('DTEND;TZID=Europe/London:20261025T090000');
    expect(all).toContain(`GEO:${BUXTON.lat};${BUXTON.lon}`);
  });

  it('includes a VTIMEZONE with both offsets for a trip across the clock change', () => {
    const start = all.indexOf('BEGIN:VTIMEZONE');
    const end = all.indexOf('END:VTIMEZONE');
    const zone = all.slice(start, end + 1);
    expect(zone).toContain('TZID:Europe/London');
    expect(zone).toContain('BEGIN:DAYLIGHT');
    expect(zone).toContain('BEGIN:STANDARD');
    // BST ends at 02:00 BST on 25 October 2026, read in the offset before it.
    expect(zone).toContain('DTSTART:20261025T020000');
    expect(zone).toContain('TZOFFSETFROM:+0100');
    expect(zone).toContain('TZOFFSETTO:+0000');
    // The zone is declared before the events that use it.
    expect(start).toBeLessThan(all.indexOf('BEGIN:VEVENT'));
  });

  it('leaves out stops whose times are unknown and says which', () => {
    const partial = writeIcs({
      ...trip,
      stops: [trip.stops[0] as IcsStop, stop({ id: 's9', name: 'Ashbourne' })],
      legs: [{ ...trip.legs[0]!, arrival: null, summary: 'Drive: unknown' }],
    });
    expect(partial.omitted).toEqual(['Ashbourne', 'Drive: unknown']);
    expect(partial.eventCount).toBe(1);
  });

  it('writes a stop in an unknown zone as UTC', () => {
    const utc = writeIcs({
      ...trip,
      stops: [stop({ id: 'x', name: 'Somewhere', departure: Date.UTC(2026, 6, 1, 8), zoneKnown: false, zone: 'UTC' })],
      legs: [],
    });
    const all2 = lines(utc.text);
    expect(all2).toContain('DTSTART:20260701T080000Z');
    expect(all2).not.toContain('BEGIN:VTIMEZONE');
  });
});

describe('escapeText and foldLine', () => {
  it('escapes the four characters RFC 5545 reserves', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds at 75 octets without splitting a UTF-8 character', () => {
    const line = `DESCRIPTION:${'Ynys Môn, '.repeat(20)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    const encoder = new TextEncoder();
    for (const part of parts) {
      expect(encoder.encode(part).length).toBeLessThanOrEqual(75);
      // A split character would decode to U+FFFD.
      expect(new TextDecoder().decode(encoder.encode(part))).not.toContain('�');
    }
    for (const part of parts.slice(1)) expect(part.startsWith(' ')).toBe(true);
    expect(folded.replaceAll('\r\n ', '')).toBe(line);
  });

  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Buxton')).toBe('SUMMARY:Buxton');
  });
});

describe('transitionsBetween and vtimezone', () => {
  it('finds both 2026 UK changes to the minute', () => {
    const found = transitionsBetween(LONDON, Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31));
    expect(found).toEqual([
      { at: Date.UTC(2026, 2, 29, 1), from: 0, to: 3_600_000 },
      { at: Date.UTC(2026, 9, 25, 1), from: 3_600_000, to: 0 },
    ]);
  });

  it('a span with no change still declares the offset in force', () => {
    const zone = vtimezone(LONDON, Date.UTC(2026, 6, 1), Date.UTC(2026, 6, 5));
    expect(zone).toContain('BEGIN:DAYLIGHT');
    expect(zone.filter((l) => l.startsWith('TZOFFSETTO'))).toEqual(['TZOFFSETTO:+0100']);
  });
});
