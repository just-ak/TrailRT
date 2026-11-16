import type { SortDirection, TreeNode } from '../domain/types';
import { isoWeekday, utcToWallClock } from '../time/zoned';

/**
 * The Tracks section's arrangements (Phase 14 Requirement 22): a flat list by
 * name or by distance, or a tree of year › month › day by when each track
 * was recorded. Pure, so the grouping is tested without a database.
 */

export type TrackArrangement = 'name' | 'date' | 'distance';

export interface TrackListItem {
  id: string;
  name: string;
  /** The owning trip's name, or "Not in a trip" for the holder (ADR 0022). */
  tripName: string;
  /** True for a track outside any trip, which a flat list puts first. */
  loose: boolean;
  distanceM: number | null;
  /** The first timed point, or null when the recording has no times. */
  startedAt: number | null;
  /** The IANA zone where the track starts, or null when TrailRT does not know it. */
  zone: string | null;
}

export interface ArrangeOptions {
  arrangement: TrackArrangement;
  direction: SortDirection;
  /** The zone a track is dated in when its own is not known: the computer's. */
  fallbackZone: string;
  /** Prefix that makes each row's id unique, such as `view:tracks`. */
  path: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** `isoWeekday` counts from Monday as 0. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDistance(metres: number | null): string | undefined {
  if (metres === null) return undefined;
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

function count(n: number): string {
  return `${n} track${n === 1 ? '' : 's'}`;
}

function trackRow(item: TrackListItem, id: string, detail: string, hint?: string): TreeNode {
  return {
    id,
    ref: { kind: 'track', id: item.id },
    kind: 'track',
    name: item.name,
    detail,
    ...(hint === undefined ? {} : { hint }),
    children: [],
  };
}

const byName = (a: TrackListItem, b: TrackListItem): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** An unknown distance sorts last in either direction: it is not the shortest. */
function byDistance(a: TrackListItem, b: TrackListItem, sign: 1 | -1): number {
  if (a.distanceM === null && b.distanceM === null) return byName(a, b);
  if (a.distanceM === null) return 1;
  if (b.distanceM === null) return -1;
  return (a.distanceM - b.distanceM) * sign || byName(a, b);
}

export function arrangeTracks(items: readonly TrackListItem[], options: ArrangeOptions): TreeNode[] {
  const sign = options.direction === 'asc' ? 1 : -1;
  if (options.arrangement !== 'date') {
    // ADR 0022: items outside a trip come first in a flat cross-trip list.
    const looseFirst = (a: TrackListItem, b: TrackListItem): number => Number(!a.loose) - Number(!b.loose);
    const order =
      options.arrangement === 'distance'
        ? (a: TrackListItem, b: TrackListItem) => looseFirst(a, b) || byDistance(a, b, sign)
        : (a: TrackListItem, b: TrackListItem) => looseFirst(a, b) || byName(a, b) * sign;
    return items.toSorted(order).map((item) => {
      const distance = options.arrangement === 'distance' ? shortDistance(item.distanceM) : undefined;
      return trackRow(item, `${options.path}/track:${item.id}`, distance === undefined ? item.tripName : `${distance} · ${item.tripName}`);
    });
  }
  return byDate(items, options, sign);
}

interface Dated {
  item: TrackListItem;
  at: number;
  date: string;
  time: string;
  /** True when dated in the computer's zone because the track's own is unknown. */
  assumed: boolean;
}

/**
 * Year › month › day, each holding the tracks recorded then, in the chosen
 * direction throughout. A track is dated in the zone where it starts, so a
 * ride that set off at 00:30 in Chamonix belongs to that day there. Where
 * TrailRT does not know the zone, the computer's is used and the row says so.
 * A recording with no times goes under No date, last: it is never given one.
 */
function byDate(items: readonly TrackListItem[], options: ArrangeOptions, sign: 1 | -1): TreeNode[] {
  const dated: Dated[] = [];
  const undated: TrackListItem[] = [];
  for (const item of items) {
    if (item.startedAt === null) {
      undated.push(item);
      continue;
    }
    const zone = item.zone ?? options.fallbackZone;
    const wall = utcToWallClock(item.startedAt, zone);
    dated.push({ item, at: item.startedAt, date: wall.date, time: wall.time, assumed: item.zone === null });
  }
  dated.sort((a, b) => (a.at - b.at) * sign || byName(a.item, b.item));

  const years: TreeNode[] = [];
  // `as`, so the checker does not narrow these to null for the whole loop.
  let year = null as TreeNode | null;
  let month = null as TreeNode | null;
  let day = null as TreeNode | null;
  for (const entry of dated) {
    const [y = '', m = '', d = ''] = entry.date.split('-');
    const yearId = `${options.path}/year:${y}`;
    if (year?.id !== yearId) {
      year = { id: yearId, kind: 'group', name: y, children: [] };
      years.push(year);
      month = null;
    }
    const monthId = `${yearId}/month:${m}`;
    if (month?.id !== monthId) {
      month = { id: monthId, kind: 'group', name: MONTHS[Number(m) - 1] ?? m, children: [] };
      year.children.push(month);
      day = null;
    }
    const dayId = `${monthId}/day:${d}`;
    if (day?.id !== dayId) {
      day = { id: dayId, kind: 'group', name: `${WEEKDAYS[isoWeekday(entry.date)] ?? ''} ${Number(d)} ${MONTHS[Number(m) - 1] ?? m}`.trim(), children: [] };
      month.children.push(day);
    }
    const hint = entry.assumed
      ? `Dated in this computer's time zone (${options.fallbackZone}): TrailRT does not know the zone where this track starts.`
      : undefined;
    day.children.push(trackRow(entry.item, `${dayId}/track:${entry.item.id}`, `${entry.time} · ${entry.item.tripName}`, hint));
  }

  // Counts on every heading. The newest (or oldest) year, its first month and
  // that month's days open the first time, so the latest tracks show at once.
  const tally = (node: TreeNode): number =>
    node.kind === 'track' ? 1 : node.children.reduce((sum, child) => sum + tally(child), 0);
  const label = (node: TreeNode): void => {
    if (node.kind !== 'group') return;
    node.detail = count(tally(node));
    node.children.forEach(label);
  };
  years.forEach(label);
  const [first] = years;
  if (first !== undefined) {
    first.defaultExpanded = true;
    const [firstMonth] = first.children;
    if (firstMonth !== undefined) {
      firstMonth.defaultExpanded = true;
      for (const dayNode of firstMonth.children) dayNode.defaultExpanded = true;
    }
  }

  if (undated.length > 0) {
    years.push({
      id: `${options.path}/undated`,
      kind: 'group',
      name: 'No date',
      detail: count(undated.length),
      hint: 'These recordings have no times, so they have no date.',
      children: undated.toSorted(byName).map((item) => trackRow(item, `${options.path}/undated/track:${item.id}`, item.tripName)),
    });
  }
  return years;
}
