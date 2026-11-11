import { utcToWallClock, zoneOffsetMs } from '@shared/time/zoned';

/**
 * iCalendar (RFC 5545) for a scheduled trip.
 *
 * One event per stop and, optionally, one per driving leg (Phase 10
 * Requirement 10.1). Written by hand, as the GPX writer is: the format is
 * small, and a dependency would add more than it saves (ADR 0019 §7).
 *
 * ## Time zones
 *
 * Each zone used gets a `VTIMEZONE` built from the zone's **actual**
 * transitions within the trip's dates, found by scanning `Intl`'s offsets and
 * bisecting to the minute. Every observance has an explicit `DTSTART`, so no
 * recurrence rule has to be right for years nobody asked about. A stop whose
 * zone is unknown is written in UTC, which every calendar reads correctly.
 *
 * ## What is left out
 *
 * A stop or leg whose times are unknown — an unplanned leg upstream — is not
 * written, and its name is returned in `omitted` so the export can say so. A
 * calendar event at a guessed time would be worse than none.
 */

export interface IcsStop {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  /** Null for the first stop. */
  arrival: number | null;
  /** Null for the last stop. */
  departure: number | null;
  zone: string;
  zoneKnown: boolean;
  /** Plain text: duration, notes and so on. */
  description: string;
}

export interface IcsLeg {
  id: string;
  summary: string;
  departure: number | null;
  arrival: number | null;
  zone: string;
  zoneKnown: boolean;
  description: string;
}

export interface IcsInput {
  calendarName: string;
  stops: readonly IcsStop[];
  legs: readonly IcsLeg[];
  /** For DTSTAMP. */
  now: number;
}

export interface IcsOutput {
  text: string;
  /** Names of stops and legs not written because their times are unknown. */
  omitted: string[];
  eventCount: number;
}

const CRLF = '\r\n';
const MAX_OCTETS = 75;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
export function escapeText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF and a
 * space. Folding counts UTF-8 octets and never splits a character, which a
 * naive `slice(0, 75)` on a string with "Môn" in it would.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let octets = 0;
  // The first line may hold 75 octets; continuation lines start with a space.
  let limit = MAX_OCTETS;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      out.push(current);
      current = ' ';
      octets = 1;
      limit = MAX_OCTETS;
    }
    current += char;
    octets += size;
  }
  out.push(current);
  return out.join(CRLF);
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

function utcStamp(instant: number): string {
  const d = new Date(instant);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** `20261023T170000`, the zone's wall clock at an instant. */
function localStamp(instant: number, zone: string): string {
  const wall = utcToWallClock(instant, zone);
  return `${wall.date.replaceAll('-', '')}T${wall.time.replace(':', '')}00`;
}

/** Local wall clock at an instant, read with a given offset rather than the zone's. */
function stampAtOffset(instant: number, offsetMs: number): string {
  return utcStamp(instant + offsetMs).slice(0, -1);
}

function offsetText(offsetMs: number): string {
  const minutes = Math.round(offsetMs / MINUTE);
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}${pad(Math.abs(minutes) % 60)}`;
}

function dateTime(name: string, instant: number, zone: string, zoneKnown: boolean): string {
  return zoneKnown ? `${name};TZID=${zone}:${localStamp(instant, zone)}` : `${name}:${utcStamp(instant)}`;
}

interface Transition {
  at: number;
  from: number;
  to: number;
}

/** Offset changes in [start, end], each located to the minute. */
export function transitionsBetween(zone: string, start: number, end: number): Transition[] {
  const step = 6 * HOUR;
  const found: Transition[] = [];
  // Minute-aligned, so the bisection lands on the minute the change happens.
  let t = Math.floor(start / MINUTE) * MINUTE;
  let offset = zoneOffsetMs(t, zone);
  while (t < end) {
    const next = t + step;
    const nextOffset = zoneOffsetMs(next, zone);
    if (nextOffset !== offset) {
      // Invariant: lo has the old offset, hi the new; both whole minutes.
      let lo = t;
      let hi = next;
      while (hi - lo > MINUTE) {
        const mid = lo + Math.floor((hi - lo) / (2 * MINUTE)) * MINUTE;
        if (zoneOffsetMs(mid, zone) === offset) lo = mid;
        else hi = mid;
      }
      found.push({ at: hi, from: offset, to: nextOffset });
      offset = nextOffset;
    }
    t = next;
  }
  return found;
}

/** A VTIMEZONE covering [start, end] for one zone. */
export function vtimezone(zone: string, start: number, end: number): string[] {
  const from = start - DAY;
  const to = end + DAY;
  const transitions = transitionsBetween(zone, from, to);

  // The zone's standard offset is the lowest it uses in the year: anything
  // above it is daylight time. Both solstices are sampled.
  const year = new Date(from).getUTCFullYear();
  const standard = Math.min(
    zoneOffsetMs(Date.UTC(year, 0, 15), zone),
    zoneOffsetMs(Date.UTC(year, 6, 15), zone),
  );
  const kind = (offset: number): string => (offset > standard ? 'DAYLIGHT' : 'STANDARD');

  const initial = zoneOffsetMs(from, zone);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
  // The observance in force when the span opens.
  lines.push(
    `BEGIN:${kind(initial)}`,
    `DTSTART:${stampAtOffset(from - DAY, initial)}`,
    `TZOFFSETFROM:${offsetText(initial)}`,
    `TZOFFSETTO:${offsetText(initial)}`,
    `END:${kind(initial)}`,
  );
  for (const transition of transitions) {
    // DTSTART is the onset in local time, read with the offset before it.
    lines.push(
      `BEGIN:${kind(transition.to)}`,
      `DTSTART:${stampAtOffset(transition.at, transition.from)}`,
      `TZOFFSETFROM:${offsetText(transition.from)}`,
      `TZOFFSETTO:${offsetText(transition.to)}`,
      `END:${kind(transition.to)}`,
    );
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

export function writeIcs(input: IcsInput): IcsOutput {
  const omitted: string[] = [];
  const events: string[][] = [];
  const spans = new Map<string, { start: number; end: number }>();

  const note = (zone: string, known: boolean, ...instants: number[]): void => {
    if (!known) return;
    const span = spans.get(zone) ?? { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY };
    for (const instant of instants) {
      span.start = Math.min(span.start, instant);
      span.end = Math.max(span.end, instant);
    }
    spans.set(zone, span);
  };

  for (const [index, stop] of input.stops.entries()) {
    const isFirst = index === 0;
    const isLast = index === input.stops.length - 1;
    // The first stop is the moment of leaving; the last, the moment of arriving.
    const start = isFirst ? stop.departure : stop.arrival;
    const end = isLast || isFirst ? start : stop.departure;
    if (start === null || end === null) {
      omitted.push(stop.name);
      continue;
    }
    note(stop.zone, stop.zoneKnown, start, end);
    const summary = isFirst ? `Leave ${stop.name}` : isLast ? `Arrive ${stop.name}` : stop.name;
    const event = [
      'BEGIN:VEVENT',
      `UID:${stop.id}@trailrt`,
      `DTSTAMP:${utcStamp(input.now)}`,
      dateTime('DTSTART', start, stop.zone, stop.zoneKnown),
      dateTime('DTEND', end, stop.zone, stop.zoneKnown),
      `SUMMARY:${escapeText(summary)}`,
      `LOCATION:${escapeText(stop.name)}`,
    ];
    if (stop.lat !== null && stop.lon !== null) event.push(`GEO:${stop.lat};${stop.lon}`);
    if (stop.description.length > 0) event.push(`DESCRIPTION:${escapeText(stop.description)}`);
    event.push('TRANSP:OPAQUE', 'END:VEVENT');
    events.push(event);
  }

  for (const leg of input.legs) {
    if (leg.departure === null || leg.arrival === null) {
      omitted.push(leg.summary);
      continue;
    }
    note(leg.zone, leg.zoneKnown, leg.departure, leg.arrival);
    const event = [
      'BEGIN:VEVENT',
      `UID:${leg.id}@trailrt`,
      `DTSTAMP:${utcStamp(input.now)}`,
      dateTime('DTSTART', leg.departure, leg.zone, leg.zoneKnown),
      dateTime('DTEND', leg.arrival, leg.zone, leg.zoneKnown),
      `SUMMARY:${escapeText(leg.summary)}`,
    ];
    if (leg.description.length > 0) event.push(`DESCRIPTION:${escapeText(leg.description)}`);
    event.push('TRANSP:OPAQUE', 'END:VEVENT');
    events.push(event);
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrailRT//Road trip//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(input.calendarName)}`,
  ];
  for (const [zone, span] of [...spans.entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    lines.push(...vtimezone(zone, span.start, span.end));
  }
  for (const event of events) lines.push(...event);
  lines.push('END:VCALENDAR');

  return {
    text: lines.map(foldLine).join(CRLF) + CRLF,
    omitted,
    eventCount: events.length,
  };
}
