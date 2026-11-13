import type { ItineraryView } from '../domain/itinerary';
import { utcToWallClock, wallClockToUtc } from '../time/zoned';
import { calendarBlocks, dayBounds, placeDay, type CalendarBlock } from './calendarLayout';

/**
 * One day by the hour, for the right panel. Phase 14, design §3.1.
 *
 * Built on the Phase 10 calendar's layout: the Plan lane is `placeDay`, so
 * zones, overlaps and the minimum drawn length behave exactly as the calendar
 * did. Added here: the range that fits the day, the Recorded lane for tracks
 * that carry times, and photos at the times they were taken.
 *
 * Positions are 0–1 of the range, not of the whole day, so a short day is not
 * mostly empty. Nothing missing is invented: a leg with no time is returned
 * as untimed, and a track without timestamps is not placed.
 */

const HOUR = 3_600_000;
/** The range when the day has nothing in it. */
const EMPTY_FROM = 8;
const EMPTY_TO = 18;

export interface DayScaleTrack {
  id: string;
  name: string;
  startedAt: number | null;
  endedAt: number | null;
}

export interface DayScalePhoto {
  id: string;
  /** `YYYY-MM-DDTHH:MM:SS`, the wall clock where it was taken. */
  takenLocal: string | null;
  /** Minutes east of UTC, or null for camera time. */
  takenOffsetMin: number | null;
}

export interface ScaleHour {
  at: number;
  /** `HH:00` in the day's zone. */
  label: string;
  /** 0–1 down the range. */
  top: number;
}

export interface ScaleBlock {
  block: CalendarBlock;
  /** Drawn extent, stretched to the calendar's minimum so a short block stays visible. */
  top: number;
  height: number;
  /** Its real times on the scale, with no minimum: the right panel draws these. Zero height for an instant. */
  exactTop: number;
  exactHeight: number;
  lane: number;
  lanes: number;
  /** The block began on an earlier day, or carries on past this one. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface RecordedBlock {
  trackId: string;
  name: string;
  start: number;
  end: number;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

export interface PhotoTime {
  id: string;
  at: number;
  top: number;
  /** No zone was recorded: read as the day's local time. */
  cameraTime: boolean;
}

export interface DayScale {
  date: string;
  zone: string;
  start: number;
  end: number;
  hours: ScaleHour[];
  plan: ScaleBlock[];
  /** Blocks of this trip whose times are unknown, listed under the scale. */
  untimed: CalendarBlock[];
  recorded: RecordedBlock[];
  /** Tracks with times that do not touch this day are left out; these have none at all. */
  unplaceable: { id: string; name: string }[];
  photos: PhotoTime[];
}

/** When a photo was taken, as an instant. Camera time is read in `zone`. */
export function photoInstant(photo: DayScalePhoto, zone: string): { at: number; cameraTime: boolean } | null {
  if (photo.takenLocal === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/.exec(photo.takenLocal);
  if (match === null) return null;
  const [, date, time, seconds] = match;
  if (date === undefined || time === undefined) return null;
  const secondsMs = (Number(seconds ?? 0) || 0) * 1000;
  if (photo.takenOffsetMin === null) {
    return { at: wallClockToUtc({ date, time }, zone) + secondsMs, cameraTime: true };
  }
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  return { at: asUtc - photo.takenOffsetMin * 60_000 + secondsMs, cameraTime: false };
}

function hh(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function floorHour(at: number, zone: string): number {
  const wall = utcToWallClock(at, zone);
  return wallClockToUtc({ date: wall.date, time: `${wall.time.slice(0, 2)}:00` }, zone);
}

/** Lanes for blocks that overlap in time, earliest first. */
function lanesFor<T extends { start: number; end: number }>(items: readonly T[]): { item: T; lane: number }[] {
  const ends: number[] = [];
  return items
    .toSorted((a, b) => a.start - b.start || a.end - b.end)
    .map((item) => {
      let lane = ends.findIndex((end) => end <= item.start);
      if (lane === -1) {
        lane = ends.length;
        ends.push(item.end);
      } else {
        ends[lane] = item.end;
      }
      return { item, lane };
    });
}

/** Whole hours of the day's wall clock, `toHour` up to 24. */
export interface HourWindow {
  fromHour: number;
  toHour: number;
}

export function dayScale(input: {
  view: ItineraryView;
  date: string;
  tracks?: readonly DayScaleTrack[];
  photos?: readonly DayScalePhoto[];
  /** Draw this window rather than the day's own range: the trip view lines its days up. */
  window?: HourWindow;
}): DayScale {
  const zone = input.view.timeline.calendarZone;
  const { start: dayStart, end: dayEnd } = dayBounds(input.date, zone);
  const dayLength = dayEnd - dayStart;
  const blocks = calendarBlocks(input.view);
  const placed = placeDay(blocks, input.date, zone);

  // Every event of the day as instants: the drawn extent of each plan block.
  const planSpans = placed.map((p) => ({
    p,
    from: dayStart + p.top * dayLength,
    to: dayStart + (p.top + p.height) * dayLength,
  }));

  const timedTracks = (input.tracks ?? []).filter(
    (t): t is DayScaleTrack & { startedAt: number; endedAt: number } => t.startedAt !== null && t.endedAt !== null,
  );
  const touching = timedTracks
    .filter((t) => t.endedAt > dayStart && t.startedAt < dayEnd)
    .map((t) => ({ id: t.id, name: t.name, start: Math.max(t.startedAt, dayStart), end: Math.min(t.endedAt, dayEnd) }));

  const photoTimes = (input.photos ?? [])
    .map((photo) => ({ photo, when: photoInstant(photo, zone) }))
    .filter((x): x is { photo: DayScalePhoto; when: { at: number; cameraTime: boolean } } => x.when !== null)
    .filter((x) => x.when.at >= dayStart && x.when.at < dayEnd);

  // The range: an hour either side of what happens, on whole hours, within
  // the day. A stay that carries on past the day counts from its start, and
  // one that began earlier counts at its end, so an overnight does not
  // stretch every scale to midnight.
  const marks: number[] = [];
  for (const { p, from, to } of planSpans) {
    // A stay that fills the whole day marks nothing: the day shows its usual hours.
    if (!p.continuesBefore) marks.push(from);
    if (!p.continuesAfter) marks.push(to);
  }
  for (const t of touching) marks.push(t.start, t.end);
  for (const x of photoTimes) marks.push(x.when.at);

  let start: number;
  let end: number;
  if (input.window !== undefined) {
    start = Math.max(dayStart, wallClockToUtc({ date: input.date, time: hh(input.window.fromHour) }, zone));
    end = input.window.toHour >= 24 ? dayEnd : Math.min(dayEnd, wallClockToUtc({ date: input.date, time: hh(input.window.toHour) }, zone));
  } else if (marks.length === 0) {
    start = wallClockToUtc({ date: input.date, time: `${String(EMPTY_FROM).padStart(2, '0')}:00` }, zone);
    end = wallClockToUtc({ date: input.date, time: `${EMPTY_TO}:00` }, zone);
  } else {
    const first = Math.min(...marks);
    const last = Math.max(...marks);
    start = Math.max(dayStart, floorHour(first, zone) - HOUR);
    const lastHour = floorHour(last, zone);
    end = Math.min(dayEnd, (lastHour === last ? last : lastHour + HOUR) + HOUR);
    if (end - start < 2 * HOUR) end = Math.min(dayEnd, start + 2 * HOUR);
  }
  const length = end - start;
  const rel = (at: number): number => (Math.min(Math.max(at, start), end) - start) / length;

  const hours: ScaleHour[] = [];
  for (let at = start; at <= end; at += HOUR) {
    hours.push({ at, label: utcToWallClock(at, zone).time.slice(0, 5), top: rel(at) });
  }

  const plan: ScaleBlock[] = planSpans
    .filter(({ from, to }) => to > start && from < end)
    .map(({ p, from, to }) => {
      // A stay that carries on past the day runs to the end of the scale.
      const drawnTo = p.continuesAfter ? end : to;
      const drawnFrom = p.continuesBefore ? start : from;
      const exactFrom = p.continuesBefore ? start : (p.block.start ?? from);
      const exactTo = p.continuesAfter ? end : (p.block.end ?? to);
      return {
        block: p.block,
        top: rel(drawnFrom),
        height: rel(drawnTo) - rel(drawnFrom),
        exactTop: rel(exactFrom),
        exactHeight: rel(exactTo) - rel(exactFrom),
        lane: p.lane,
        lanes: p.lanes,
        continuesBefore: p.continuesBefore,
        continuesAfter: p.continuesAfter,
      };
    });

  const laned = lanesFor(touching);
  const recordedLanes = Math.max(1, ...laned.map((x) => x.lane + 1));
  const recorded: RecordedBlock[] = laned.map(({ item, lane }) => ({
    trackId: item.id,
    name: item.name,
    start: item.start,
    end: item.end,
    top: rel(item.start),
    height: rel(item.end) - rel(item.start),
    lane,
    lanes: recordedLanes,
  }));

  return {
    date: input.date,
    zone,
    start,
    end,
    hours,
    plan,
    untimed: blocks.filter((b) => b.start === null || b.end === null),
    recorded,
    unplaceable: (input.tracks ?? []).filter((t) => t.startedAt === null || t.endedAt === null).map((t) => ({ id: t.id, name: t.name })),
    photos: photoTimes
      .map((x) => ({ id: x.photo.id, at: x.when.at, top: rel(x.when.at), cameraTime: x.when.cameraTime }))
      .toSorted((a, b) => a.at - b.at),
  };
}

/** The wall-clock hour of an instant, or 24 when it is the day's end. */
function hourOf(at: number, dayEnd: number, zone: string): number {
  if (at >= dayEnd) return 24;
  const wall = utcToWallClock(at, zone);
  return Number(wall.time.slice(0, 2)) + (wall.time.slice(3, 5) === '00' ? 0 : 1);
}

/**
 * Every day of a dated trip on one window of hours, so they can stand side by
 * side (Phase 14 Requirement 4.2). The window is the widest of the days' own
 * ranges, which keep their rule: an hour either side of what happens.
 */
export function tripHours(input: {
  view: ItineraryView;
  tracks?: readonly DayScaleTrack[];
  photos?: readonly DayScalePhoto[];
}): { window: HourWindow; days: DayScale[] } {
  const zone = input.view.timeline.calendarZone;
  const dates = input.view.timeline.days.map((d) => d.date);
  const extra = { ...(input.tracks === undefined ? {} : { tracks: input.tracks }), ...(input.photos === undefined ? {} : { photos: input.photos }) };
  const natural = dates.map((date) => dayScale({ view: input.view, date, ...extra }));
  if (natural.length === 0) return { window: { fromHour: EMPTY_FROM, toHour: EMPTY_TO }, days: [] };
  const window = {
    fromHour: Math.min(...natural.map((d) => Number(utcToWallClock(d.start, zone).time.slice(0, 2)))),
    toHour: Math.max(...natural.map((d) => hourOf(d.end, dayBounds(d.date, zone).end, zone))),
  };
  return { window, days: dates.map((date) => dayScale({ view: input.view, date, ...extra, window })) };
}
