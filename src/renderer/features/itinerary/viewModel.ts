import type { UnitSystem } from '@shared/domain/types';
import { formatDistance, formatDuration } from '@shared/geo/units';
import type { StopFlag, TimedStop } from '@shared/itinerary/timeline';
import type { ZonedWallClock } from '@shared/time/zoned';
import { isoWeekday } from '@shared/time/zoned';

/**
 * Wording for the itinerary editor and calendar. Pure, so it is tested
 * without React, and so the editor and the calendar say the same things.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Fri 23 Oct` */
export function dayText(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${WEEKDAYS[isoWeekday(date)] ?? ''} ${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`;
}

/** `Fri 23 Oct, 17:00`, or `—` when unknown. Adds the offset when it differs from the calendar's. */
export function whenText(local: ZonedWallClock | null, calendarOffsetMinutes: number | null = null): string {
  if (local === null) return '—';
  const base = `${dayText(local.date)}, ${local.time}`;
  if (calendarOffsetMinutes === null || calendarOffsetMinutes === local.offsetMinutes) return base;
  const sign = local.offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(local.offsetMinutes);
  const zone = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 === 0 ? '' : `:${String(abs % 60).padStart(2, '0')}`}`;
  return `${base} (${zone})`;
}

/** What the drive into a stop is: its length and estimated time, or that it has no route. */
export function legText(timed: TimedStop | undefined, units: UnitSystem): string {
  if (timed === undefined || timed.index === 0) return '';
  if (timed.legKind === 'other') {
    return timed.legDriveSeconds === null ? 'No travel time given' : `${formatDuration(timed.legDriveSeconds)}, as given`;
  }
  if (timed.legDriveSeconds === null) return 'No route planned';
  const parts = [formatDistance(timed.legDistanceM, units), `about ${formatDuration(timed.legDriveSeconds)}`];
  return parts.join(' · ');
}

/** The speed a leg was timed at, for the caption that says it is an estimate. */
export function legBasis(timed: TimedStop | undefined): string | null {
  if (timed === undefined || timed.legSpeedKmh === null) return null;
  return `Estimated at an average of ${timed.legSpeedKmh} km/h.`;
}

export function flagMessage(flag: StopFlag, zone: string): string {
  switch (flag) {
    case 'unplanned-leg':
      return 'No route is planned for the drive here, so this and later times are unknown.';
    case 'unknown-time':
      return 'Times unknown: an earlier drive has no route.';
    case 'location-deleted':
      return 'This stop’s waypoint was deleted. Undo the deletion, or remove the stop.';
    case 'arrive-by-missed':
      return 'Arrives after the arrive-by time.';
    case 'depart-at-too-early':
      return 'The fixed departure leaves less time here than the stop’s duration.';
    case 'no-travel-time':
      return 'This leg is not by road and has no travel time, so this and later times are unknown.';
    case 'zone-unknown':
      return `Time zone not known here; times are shown in ${zone}.`;
  }
}

/** Whether a flag is a problem with the plan, as opposed to a note about it. */
export function isWarning(flag: StopFlag): boolean {
  return flag !== 'zone-unknown' && flag !== 'unknown-time';
}

export function splitMinutes(total: number | null): { hours: number; minutes: number } {
  const value = Math.max(0, total ?? 0);
  return { hours: Math.floor(value / 60), minutes: value % 60 };
}

/** Hours and minutes typed into two boxes, as minutes. Null when either is not a number. */
export function joinMinutes(hours: string, minutes: string): number | null {
  const h = hours.trim() === '' ? 0 : Number(hours);
  const m = minutes.trim() === '' ? 0 : Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Today's local date, `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Tomorrow's date, for a new itinerary's default start. */
export function tomorrow(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}
