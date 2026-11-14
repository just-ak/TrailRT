import type { ItineraryView } from '@shared/domain/itinerary';
import { formatStopDuration } from '@shared/itinerary/format';
import { addDays, isoWeekday, utcToWallClock, wallClockToUtc } from '@shared/time/zoned';

/**
 * Where things go on the calendar. Phase 10 Requirement 4, design §11.2.
 *
 * Pure, so placement is tested without React. Everything is laid out on the
 * calendar zone's own days, so a 23- or 25-hour day at a clock change is drawn
 * as the day it is, not squashed into 24 equal hours.
 */

export type BlockKind = 'stop' | 'leg';

export interface CalendarBlock {
  key: string;
  kind: BlockKind;
  /** Index of the stop: the stop itself, or the one the leg arrives at. */
  stopIndex: number;
  stopId: string;
  label: string;
  detail: string;
  /** What selecting the block selects. Null when the thing is gone. */
  ref: { kind: 'waypoint' | 'route'; id: string } | null;
  start: number | null;
  end: number | null;
  /** Only intermediate stops have a duration to drag. */
  resizable: boolean;
}

export function calendarBlocks(view: ItineraryView): CalendarBlock[] {
  const { stops, timeline } = view;
  const blocks: CalendarBlock[] = [];
  for (const [index, stop] of stops.entries()) {
    const timed = timeline.stops[index];
    const name = stop.place?.name ?? 'Place deleted';
    const isFirst = index === 0;
    const isLast = index === stops.length - 1;

    if (!isFirst) {
      const before = timeline.stops[index - 1];
      blocks.push({
        key: `leg:${stop.id}`,
        kind: 'leg',
        stopIndex: index,
        stopId: stop.id,
        label: `Drive to ${name}`,
        detail:
          timed?.legDriveSeconds === null || timed?.legDriveSeconds === undefined
            ? 'No route planned'
            : `about ${Math.round(timed.legDriveSeconds / 60)} min, estimate`,
        ref: stop.leg !== null && stop.leg.name !== null ? { kind: 'route', id: stop.leg.routeId } : null,
        start: before?.departure ?? null,
        end: timed?.arrival ?? null,
        resizable: false,
      });
    }

    const start = isFirst ? (timed?.departure ?? null) : (timed?.arrival ?? null);
    const end = isFirst || isLast ? start : (timed?.departure ?? null);
    blocks.push({
      key: `stop:${stop.id}`,
      kind: 'stop',
      stopIndex: index,
      stopId: stop.id,
      label: isFirst ? `Leave ${name}` : isLast ? `Arrive ${name}` : name,
      detail: isFirst || isLast ? '' : formatStopDuration(stop),
      ref: stop.place === null ? null : { kind: 'waypoint', id: stop.place.id },
      start,
      end,
      resizable: !isFirst && !isLast,
    });
  }
  return blocks;
}

/** Blocks whose times are unknown: listed, never placed at a guessed position (4.6). */
export function unknownBlocks(blocks: readonly CalendarBlock[]): CalendarBlock[] {
  return blocks.filter((block) => block.start === null || block.end === null);
}

export interface PlacedBlock {
  block: CalendarBlock;
  /** 0–1 down the day. */
  top: number;
  /** 0–1 of the day; at least a sliver, so an instant is still visible. */
  height: number;
  lane: number;
  lanes: number;
  /** The block starts before or ends after this day. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** The instants a local date begins and ends in a zone. */
export function dayBounds(date: string, zone: string): { start: number; end: number } {
  return {
    start: wallClockToUtc({ date, time: '00:00' }, zone),
    end: wallClockToUtc({ date: addDays(date, 1), time: '00:00' }, zone),
  };
}

/**
 * The least time a block is drawn as, so a 10-minute drive or an arrival
 * still has room for its label. Lanes are allocated on this drawn length,
 * not the real one, so two short blocks never print over each other.
 */
export const MIN_VISIBLE_MS = 45 * 60_000;

/** The known blocks that touch a day, clipped to it, in side-by-side lanes where they overlap. */
export function placeDay(
  blocks: readonly CalendarBlock[],
  date: string,
  zone: string,
  minVisibleMs: number = MIN_VISIBLE_MS,
): PlacedBlock[] {
  const { start: dayStart, end: dayEnd } = dayBounds(date, zone);
  const length = dayEnd - dayStart;
  const touching = blocks
    .filter((b): b is CalendarBlock & { start: number; end: number } => b.start !== null && b.end !== null)
    .filter((b) => b.end >= dayStart && b.start < dayEnd)
    // A zero-length block exactly at midnight belongs to the day it starts.
    .filter((b) => !(b.end === dayStart && b.start < dayStart))
    .toSorted((a, b) => a.start - b.start || a.end - b.end);

  const placed: PlacedBlock[] = [];
  const laneEnds: number[] = [];
  for (const block of touching) {
    const from = Math.max(block.start, dayStart);
    const to = Math.min(block.end, dayEnd);
    // Drawn at least `minVisibleMs` long, but never past the end of the day.
    const drawnTo = Math.min(Math.max(to, from + minVisibleMs), dayEnd);
    // A short block near midnight grows upwards instead, but not above the day.
    const drawnFrom = Math.max(dayStart, Math.min(from, drawnTo - minVisibleMs));
    let lane = laneEnds.findIndex((end) => end <= drawnFrom);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(drawnTo);
    } else {
      laneEnds[lane] = drawnTo;
    }
    placed.push({
      block,
      top: (drawnFrom - dayStart) / length,
      height: (drawnTo - drawnFrom) / length,
      lane,
      lanes: 0,
      continuesBefore: block.start < dayStart,
      continuesAfter: block.end > dayEnd,
    });
  }
  const lanes = Math.max(laneEnds.length, 1);
  for (const p of placed) p.lanes = lanes;
  return placed;
}

/** The Monday of a date's week. */
export function weekStart(date: string): string {
  return addDays(date, -isoWeekday(date));
}

/** The seven dates of a date's week, Monday first. */
export function weekDates(date: string): string[] {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Whole weeks covering a date's month, Monday first, for the month grid. */
export function monthGrid(date: string): string[][] {
  const first = `${date.slice(0, 7)}-01`;
  const month = date.slice(5, 7);
  const weeks: string[][] = [];
  for (let monday = weekStart(first); ; monday = addDays(monday, 7)) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    if (week.every((d) => d.slice(5, 7) !== month) && weeks.length > 0) break;
    weeks.push(week);
    if (weeks.length > 6) break;
  }
  return weeks;
}

/** The local date a block starts on, in the calendar zone; null when unknown. */
export function blockDate(block: CalendarBlock, zone: string): string | null {
  return block.start === null ? null : utcToWallClock(block.start, zone).date;
}

/**
 * A dragged duration, snapped: 15-minute steps for an hours stop, whole days
 * for a day-stay (Requirement 4.5). Never below the kind's minimum.
 */
export function snapDuration(
  stop: { durationKind: 'hours' | 'days'; durationMinutes: number | null; durationDays: number | null },
  deltaMinutes: number,
): { durationMinutes: number } | { durationDays: number } {
  if (stop.durationKind === 'days') {
    const days = (stop.durationDays ?? 1) + Math.round(deltaMinutes / (24 * 60));
    return { durationDays: Math.min(60, Math.max(1, days)) };
  }
  const minutes = (stop.durationMinutes ?? 0) + Math.round(deltaMinutes / 15) * 15;
  return { durationMinutes: Math.min(24 * 60, Math.max(0, minutes)) };
}
