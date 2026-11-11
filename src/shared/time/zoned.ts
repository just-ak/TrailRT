/**
 * Wall-clock time in a named time zone, without a date library.
 *
 * A road trip plan is written in local time: "leave Buxton at 09:00 on the
 * 26th". Storage and arithmetic need instants. These functions convert between
 * the two using `Intl`, which both Node 26 and Electron 45 ship with full ICU
 * time-zone data.
 *
 * ## The two awkward hours a year
 *
 * - **Spring forward.** In Europe/London, 01:00–01:59 on the last Sunday in
 *   March does not exist. A time asked for in that gap moves **forward by the
 *   gap**: 01:30 becomes the instant that is shown as 02:30. This is what a
 *   person whose alarm was set for 01:30 experiences.
 * - **Fall back.** 01:00–01:59 on the last Sunday in October happens twice.
 *   The **earlier** instant is chosen, so a plan never silently loses an hour.
 *
 * Both are deterministic, so the same plan always gives the same times.
 *
 * Dates are `YYYY-MM-DD` and times are `HH:mm`, both as wall-clock strings.
 * They carry no zone on their own; the zone is always passed alongside.
 */

/** A local date and time with no zone attached. */
export interface WallClock {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm`, 24-hour */
  time: string;
}

export interface ZonedWallClock extends WallClock {
  /** Minutes ahead of UTC at that instant: 60 for BST, 0 for GMT. */
  offsetMinutes: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Parses a `YYYY-MM-DD` string, or null when it is not a real calendar date. */
function parseDate(date: string): [number, number, number] | null {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // Round-trip through UTC so 2026-02-30 is refused rather than rolled over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

function parseTime(time: string): [number, number] | null {
  const match = TIME_PATTERN.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return [hour, minute];
}

/** True for a real calendar date written `YYYY-MM-DD`. */
export function isValidDate(date: string): boolean {
  return parseDate(date) !== null;
}

/** True for a 24-hour time written `HH:mm`. `24:00` is not accepted. */
export function isValidTime(time: string): boolean {
  return parseTime(time) !== null;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Adds whole days to a date.
 *
 * Pure calendar arithmetic, with no time of day involved, so a clock change
 * cannot move the answer. This is what a day-stay is measured with.
 */
export function addDays(date: string, days: number): string {
  const parsed = parseDate(date);
  if (parsed === null) throw new RangeError(`Not a date: ${date}`);
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  const [year, month, day] = parsed;
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return formatDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null) throw new RangeError(`Not a date: ${a === null ? from : to}`);
  return Math.round(
    (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / MS_PER_DAY,
  );
}

/** Day of the week, 0 = Monday … 6 = Sunday, the order OSM and ISO use. */
export function isoWeekday(date: string): number {
  const parsed = parseDate(date);
  if (parsed === null) throw new RangeError(`Not a date: ${date}`);
  const sundayFirst = new Date(Date.UTC(parsed[0], parsed[1] - 1, parsed[2])).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** Minutes since local midnight for an `HH:mm` time. */
export function minutesOfDay(time: string): number {
  const parsed = parseTime(time);
  if (parsed === null) throw new RangeError(`Not a time: ${time}`);
  return parsed[0] * 60 + parsed[1];
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** True when the runtime knows this IANA zone name. */
export function isValidZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function fieldsAt(utcMs: number, zone: string): Fields {
  const parts = formatterFor(zone).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new Error(`Intl gave no ${type} for ${zone}`);
    return Number(part.value);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/**
 * How far ahead of UTC the zone's clocks are at an instant, in milliseconds.
 *
 * Read from `Intl` rather than a table, so it is whatever the runtime's time
 * zone database says, including historical changes.
 */
export function zoneOffsetMs(utcMs: number, zone: string): number {
  // Whole seconds only: Intl does not report milliseconds, so comparing a
  // fractional instant against its own rounded fields would leak the
  // fraction into the offset.
  const whole = Math.floor(utcMs / 1000) * 1000;
  const f = fieldsAt(whole, zone);
  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asIfUtc - whole;
}

/** The local date, time and offset in a zone at an instant. */
export function utcToWallClock(utcMs: number, zone: string): ZonedWallClock {
  const f = fieldsAt(utcMs, zone);
  return {
    date: formatDate(f.year, f.month, f.day),
    time: `${pad(f.hour)}:${pad(f.minute)}`,
    offsetMinutes: Math.round(zoneOffsetMs(utcMs, zone) / MS_PER_MINUTE),
  };
}

/**
 * The instant at which a zone's clocks show a given date and time.
 *
 * See the module comment for the gap and overlap rules.
 */
export function wallClockToUtc(wall: WallClock, zone: string): number {
  const date = parseDate(wall.date);
  const time = parseTime(wall.time);
  if (date === null) throw new RangeError(`Not a date: ${wall.date}`);
  if (time === null) throw new RangeError(`Not a time: ${wall.time}`);

  const naive = Date.UTC(date[0], date[1] - 1, date[2], time[0], time[1]);

  // No zone in the world changes its offset more than once in a day, so the
  // offsets twelve hours either side are the only two that can apply.
  const before = zoneOffsetMs(naive - 12 * MS_PER_HOUR, zone);
  const after = zoneOffsetMs(naive + 12 * MS_PER_HOUR, zone);

  const candidates = [naive - before, naive - after].filter(
    (instant) => zoneOffsetMs(instant, zone) === naive - instant,
  );

  if (candidates.length > 0) {
    // Two valid instants is the autumn overlap; take the earlier.
    return Math.min(...candidates);
  }

  // Neither offset reproduces the wall clock: the time falls in the spring
  // gap. Reading it with the offset in force before the change lands just
  // after the gap, which is "moved forward by the gap".
  return naive - before;
}

/**
 * The zone the computer is set to, for stops whose own zone is unknown.
 *
 * Read once per call rather than cached, because a laptop can change zone
 * while the app is open.
 */
export function systemZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
