import type { RoutePoint, TrackPoint } from '@shared/domain/types';
import { haversineDistance } from '@shared/geo/distance';

/**
 * The normalised row model behind the point table.
 *
 * One table component serves routes and tracks, but the data behind them is
 * deliberately different (ADR 0003): a route is a short array loaded whole, a
 * track is up to 200,000 points read a window at a time. So the normalisation
 * happens here, as pure functions, and the component stays ignorant of which
 * it is showing.
 *
 * Two columns differ because the underlying facts differ, not for want of
 * consistency:
 *
 * - A **route** gets cumulative distance from its start. It is a plan, the
 *   whole array is in hand, and "how far in is this point" is the useful
 *   question.
 * - A **track** gets the step distance and the speed from the previous point.
 *   Cumulative distance would require every point before the window, which is
 *   exactly the read the paging exists to avoid — and for a recording the
 *   useful question is whether *this* sample is plausible.
 */

export interface PointRow {
  /** Flat, 0-based. Displayed 1-based; see `displayIndex`. */
  index: number;
  lat: number;
  lon: number;
  ele: number | null;
  /** Route only. */
  name: string | null;
  symbol: string | null;
  notes: string | null;
  /** Track only. Null when the recording is untimed. */
  time: number | null;
  /** Route only: metres from the first point. */
  cumulativeM: number | null;
  /** Track only: metres from the previous point. */
  stepM: number | null;
  /**
   * Track only: km/h from the previous point.
   *
   * Null where either sample is untimed, or where no time passed. **Never 0** —
   * a stationary second and an unknown interval are different facts, and only
   * one of them means "not moving".
   */
  speedKmh: number | null;
  /** True when a segment break follows this row. Track only. */
  segmentEnd: boolean;
}

/** The user-facing number: "point 1 of 240", not "point 0". */
export function displayIndex(index: number): number {
  return index + 1;
}

export function routeRows(points: readonly RoutePoint[]): PointRow[] {
  const rows: PointRow[] = [];
  let cumulative = 0;

  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous !== undefined) {
      cumulative += haversineDistance(previous, point);
    }

    rows.push({
      index,
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      name: point.name,
      symbol: point.symbol,
      notes: point.notes,
      time: null,
      cumulativeM: cumulative,
      stepM: null,
      speedKmh: null,
      segmentEnd: false,
    });
  }

  return rows;
}

/**
 * Rows for one window of a track.
 *
 * `leading` is the point immediately before the window, when there is one. The
 * first row of a window still has a step and a speed, which it could not have
 * if the window were read in isolation — so the hook requests one extra point
 * and passes it here rather than showing an unexplained blank.
 */
export function trackRows(input: {
  points: readonly TrackPoint[];
  /** Flat index of `points[0]`. */
  offset: number;
  /** Whole-track break indices. See `shared/geo/segments.ts`. */
  segmentBreaks: readonly number[];
  leading: TrackPoint | null;
}): PointRow[] {
  const breaks = new Set(input.segmentBreaks);
  const rows: PointRow[] = [];

  for (const [position, point] of input.points.entries()) {
    const index = input.offset + position;
    // Nullish, not just undefined: `leading` is null for the first window,
    // where there genuinely is no preceding point.
    const previous =
      (position === 0 ? input.leading : input.points[position - 1]) ?? null;

    /*
     * A step across a segment break is not travel.
     *
     * The gap between two segments is a pause or a lost fix, so measuring
     * distance and speed across it would invent movement the recording does
     * not claim happened — the same reasoning `computeStats` uses for the
     * total distance.
     */
    const crossesBreak = previous !== null && breaks.has(index - 1);

    const stepM =
      previous === null || crossesBreak
        ? null
        : haversineDistance(previous, point);

    const speedKmh = (() => {
      if (stepM === null || previous === null) return null;
      if (previous.time === null || point.time === null) return null;
      const seconds = (point.time - previous.time) / 1000;
      // Null rather than 0 or Infinity: no elapsed time means the speed is
      // unknown, not zero and not instantaneous.
      if (!Number.isFinite(seconds) || seconds <= 0) return null;
      return (stepM / seconds) * 3.6;
    })();

    rows.push({
      index,
      lat: point.lat,
      lon: point.lon,
      ele: point.ele,
      name: null,
      symbol: null,
      notes: null,
      time: point.time,
      cumulativeM: null,
      stepM,
      speedKmh,
      segmentEnd: breaks.has(index),
    });
  }

  return rows;
}

/**
 * Remaps a pending row selection after indices have shifted.
 *
 * `replacePoints` re-UUIDs every row, so there is no stable point identity to
 * key on and the table keys on index — which means a delete or insert
 * invalidates every index after it. Reinterpreting an old selection against
 * the new indices would select, and then potentially delete, the wrong points.
 *
 * So a deletion remaps survivors by subtracting the number of removed points
 * that preceded them, and anything else clears the selection rather than
 * guessing.
 */
export function remapAfterDelete(
  selected: Iterable<number>,
  deleted: readonly number[],
): number[] {
  const removed = deleted.toSorted((a, b) => a - b);
  const gone = new Set(removed);
  const remapped: number[] = [];

  for (const index of selected) {
    if (gone.has(index)) continue;
    const before = removed.filter((candidate) => candidate < index).length;
    remapped.push(index - before);
  }

  return remapped.toSorted((a, b) => a - b);
}

/** Contiguous runs in a sorted index list, for a readable summary. */
export function describeIndices(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].toSorted((a, b) => a - b);
  if (sorted.length === 0) return 'none';

  const runs: string[] = [];
  let start = sorted[0] as number;
  let end = start;

  for (const index of sorted.slice(1)) {
    if (index === end + 1) {
      end = index;
      continue;
    }
    runs.push(
      start === end
        ? `${displayIndex(start)}`
        : `${displayIndex(start)}–${displayIndex(end)}`,
    );
    start = index;
    end = index;
  }
  runs.push(
    start === end
      ? `${displayIndex(start)}`
      : `${displayIndex(start)}–${displayIndex(end)}`,
  );

  return runs.join(', ');
}

/**
 * The slice of rows a scroll position needs, plus padding to size the
 * scrollbar.
 *
 * Virtualisation by arithmetic rather than a library: rows are a fixed height,
 * so which ones are on screen is a division. Requirement 4.2 only asks that
 * 200,000 rows do not all become DOM nodes.
 */
export function visibleWindow(input: {
  total: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  /** Rows rendered beyond the viewport, so a fast scroll is not blank. */
  overscan?: number;
}): { first: number; count: number; padTop: number; padBottom: number } {
  const overscan = input.overscan ?? 8;
  const rowHeight = Math.max(1, input.rowHeight);

  if (input.total <= 0) {
    return { first: 0, count: 0, padTop: 0, padBottom: 0 };
  }

  const firstVisible = Math.floor(Math.max(0, input.scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight) + 1;

  const first = Math.max(0, firstVisible - overscan);
  const count = Math.min(input.total - first, visible + overscan * 2);

  return {
    first,
    count,
    padTop: first * rowHeight,
    padBottom: Math.max(0, (input.total - first - count) * rowHeight),
  };
}
