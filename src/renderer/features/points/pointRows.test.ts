import { describe, expect, it } from 'vitest';
import type { RoutePoint, TrackPoint } from '@shared/domain/types';
import {
  describeIndices,
  displayIndex,
  remapAfterDelete,
  routeRows,
  trackRows,
  visibleWindow,
} from './pointRows';

const rp = (lat: number, lon: number, ele: number | null = null): RoutePoint => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

const tp = (
  lat: number,
  lon: number,
  ele: number | null = null,
  time: number | null = null,
): TrackPoint => ({ lat, lon, ele, time });

describe('routeRows', () => {
  it('starts cumulative distance at zero', () => {
    const rows = routeRows([rp(50, 6), rp(50, 6.01)]);
    expect(rows[0]?.cumulativeM).toBe(0);
    expect(rows[1]?.cumulativeM).toBeGreaterThan(500);
  });

  it('accumulates rather than reporting each step', () => {
    const rows = routeRows([rp(50, 6), rp(50, 6.01), rp(50, 6.02)]);
    const second = rows[1]?.cumulativeM ?? 0;
    const third = rows[2]?.cumulativeM ?? 0;
    expect(third).toBeGreaterThan(second);
    expect(third / second).toBeCloseTo(2, 1);
  });

  it('keeps an absent elevation absent', () => {
    expect(routeRows([rp(50, 6, null)])[0]?.ele).toBeNull();
  });

  it('carries the route-only fields and leaves the track ones null', () => {
    const rows = routeRows([
      { ...rp(50, 6), name: 'Summit', symbol: 'peak', notes: 'steep' },
    ]);
    expect(rows[0]).toMatchObject({
      name: 'Summit',
      symbol: 'peak',
      notes: 'steep',
      time: null,
      stepM: null,
      speedKmh: null,
    });
  });

  it('is empty for no points', () => {
    expect(routeRows([])).toEqual([]);
  });
});

describe('trackRows', () => {
  it('has no step for the very first point of a track', () => {
    const rows = trackRows({
      points: [tp(50, 6), tp(50, 6.01)],
      offset: 0,
      segmentBreaks: [],
      leading: null,
    });
    expect(rows[0]?.stepM).toBeNull();
    expect(rows[1]?.stepM).toBeGreaterThan(500);
  });

  it('uses the leading point so a window\u2019s first row still has a step', () => {
    const rows = trackRows({
      points: [tp(50, 6.01)],
      offset: 1,
      segmentBreaks: [],
      leading: tp(50, 6),
    });
    expect(rows[0]?.index).toBe(1);
    expect(rows[0]?.stepM).toBeGreaterThan(500);
  });

  it('derives speed from the elapsed time', () => {
    // ~1113 m in 100 s is about 40 km/h.
    const rows = trackRows({
      points: [tp(50, 6, null, 0), tp(50, 6.01, null, 100_000)],
      offset: 0,
      segmentBreaks: [],
      leading: null,
    });
    expect(rows[1]?.speedKmh).toBeGreaterThan(20);
    expect(rows[1]?.speedKmh).toBeLessThan(60);
  });

  it('reports speed as null, not zero, when a sample is untimed', () => {
    const rows = trackRows({
      points: [tp(50, 6, null, null), tp(50, 6.01, null, 1000)],
      offset: 0,
      segmentBreaks: [],
      leading: null,
    });
    expect(rows[1]?.speedKmh).toBeNull();
  });

  it('reports speed as null when no time elapsed', () => {
    // Zero would claim the recorder was stationary; the truth is that the
    // interval cannot be measured.
    const rows = trackRows({
      points: [tp(50, 6, null, 5000), tp(50, 6.01, null, 5000)],
      offset: 0,
      segmentBreaks: [],
      leading: null,
    });
    expect(rows[1]?.speedKmh).toBeNull();
  });

  it('does not measure travel across a segment break', () => {
    // Index 0 ends a segment, so the step into index 1 is a gap in the
    // recording rather than movement.
    const rows = trackRows({
      points: [tp(50, 6, null, 0), tp(51, 7, null, 100_000)],
      offset: 0,
      segmentBreaks: [0],
      leading: null,
    });
    expect(rows[0]?.segmentEnd).toBe(true);
    expect(rows[1]?.stepM).toBeNull();
    expect(rows[1]?.speedKmh).toBeNull();
  });

  it('marks a break that falls outside the window on neither row', () => {
    const rows = trackRows({
      points: [tp(50, 6), tp(50, 6.01)],
      offset: 0,
      segmentBreaks: [7],
      leading: null,
    });
    expect(rows.map((row) => row.segmentEnd)).toEqual([false, false]);
  });
});

describe('remapAfterDelete', () => {
  it('shifts survivors down by the deletions before them', () => {
    expect(remapAfterDelete([0, 3, 5], [1])).toEqual([0, 2, 4]);
  });

  it('drops indices that were deleted', () => {
    expect(remapAfterDelete([1, 2, 3], [2])).toEqual([1, 2]);
  });

  it('handles several non-contiguous deletions', () => {
    expect(remapAfterDelete([0, 1, 6, 7], [2, 4])).toEqual([0, 1, 4, 5]);
  });

  it('is empty when everything selected was deleted', () => {
    expect(remapAfterDelete([2, 3], [2, 3])).toEqual([]);
  });

  it('leaves the selection alone when nothing was deleted', () => {
    expect(remapAfterDelete([4, 9], [])).toEqual([4, 9]);
  });
});

describe('describeIndices', () => {
  it('is 1-based, matching what the table shows', () => {
    expect(describeIndices([0])).toBe('1');
  });

  it('collapses a contiguous run', () => {
    expect(describeIndices([2, 3, 4])).toBe('3\u20135');
  });

  it('lists separate runs', () => {
    expect(describeIndices([0, 1, 5])).toBe('1\u20132, 6');
  });

  it('sorts and dedupes', () => {
    expect(describeIndices([5, 0, 5, 1])).toBe('1\u20132, 6');
  });

  it('says so when there is nothing', () => {
    expect(describeIndices([])).toBe('none');
  });
});

describe('visibleWindow', () => {
  it('renders a window, not 200,000 rows', () => {
    const window = visibleWindow({
      total: 200_000,
      rowHeight: 24,
      viewportHeight: 480,
      scrollTop: 0,
    });
    expect(window.first).toBe(0);
    // Twenty-one visible plus overscan, nowhere near the total.
    expect(window.count).toBeLessThan(60);
    expect(window.padTop).toBe(0);
    expect(window.padBottom).toBe((200_000 - window.count) * 24);
  });

  it('follows the scroll position', () => {
    const window = visibleWindow({
      total: 1000,
      rowHeight: 20,
      viewportHeight: 200,
      scrollTop: 4000,
      overscan: 0,
    });
    expect(window.first).toBe(200);
    expect(window.padTop).toBe(4000);
  });

  it('does not run past the end', () => {
    const window = visibleWindow({
      total: 10,
      rowHeight: 20,
      viewportHeight: 400,
      scrollTop: 0,
    });
    expect(window.first + window.count).toBe(10);
    expect(window.padBottom).toBe(0);
  });

  it('is empty for no rows', () => {
    expect(
      visibleWindow({
        total: 0,
        rowHeight: 20,
        viewportHeight: 400,
        scrollTop: 0,
      }),
    ).toEqual({ first: 0, count: 0, padTop: 0, padBottom: 0 });
  });

  it('clamps a negative scroll position rather than producing a negative pad', () => {
    // Elastic scrolling on macOS reports one.
    const window = visibleWindow({
      total: 100,
      rowHeight: 20,
      viewportHeight: 200,
      scrollTop: -80,
    });
    expect(window.first).toBe(0);
    expect(window.padTop).toBe(0);
  });
});

describe('displayIndex', () => {
  it('is 1-based', () => {
    expect(displayIndex(0)).toBe(1);
    expect(displayIndex(239)).toBe(240);
  });
});
