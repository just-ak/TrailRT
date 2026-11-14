import { describe, expect, it } from 'vitest';
import { addIndex, moveTarget, photoStopIndex, rowStopId, type PlanShape } from './planEdit';

/** Phase 14 task 10: the arithmetic of reordering and adding in the plan. */

describe('dragging a stop', () => {
  it('lands before the stop it is dropped on, counting from where it was', () => {
    // Stops a b c d; drag b (1) before d (3): b ends at index 2.
    expect(moveTarget(1, 3)).toBe(2);
    // Drag d (3) before b (1): d ends at index 1.
    expect(moveTarget(3, 1)).toBe(1);
    // Drag a (0) to the end of four stops.
    expect(moveTarget(0, 4)).toBe(3);
  });

  it('does nothing when dropped where it already is', () => {
    expect(moveTarget(2, 2)).toBeNull();
    expect(moveTarget(2, 3)).toBeNull();
  });
});

describe('adding in a day', () => {
  it('goes after the selected stop when it is that day’s, else after the day’s last stop', () => {
    expect(addIndex([2, 3, 4], 3, 2)).toBe(4);
    expect(addIndex([2, 3, 4], 0, 2)).toBe(5);
    expect(addIndex([2, 3, 4], null, 2)).toBe(5);
  });

  it('puts the first stop of an empty day where the day begins', () => {
    expect(addIndex([], null, 0)).toBe(0);
    expect(addIndex([], null, 3)).toBe(3);
  });
});

describe('the stop a row stands for', () => {
  it('reads it from the row key', () => {
    expect(rowStopId('stop:s1')).toEqual({ stopId: 's1', kind: 'stop' });
    expect(rowStopId('leg:s2')).toEqual({ stopId: 's2', kind: 'leg' });
    expect(rowStopId('track:t1')).toBeNull();
    expect(rowStopId('stop:')).toBeNull();
  });
});

const neverTimed = (): string => 'never';
const dayAfter = (date: string): string => (date === '2026-07-01' ? '2026-07-02' : '2026-07-03');

describe('a photo added to the plan (Phase 14 task 19)', () => {
  // Nothing timed: every entry is on the day it follows in the plan.
  const view: PlanShape = {
    itinerary: { startDate: '2026-07-01' },
    stops: [
      { id: 'a', kind: 'stop' },
      { id: 'd', kind: 'day' },
      { id: 'b', kind: 'stop' },
      { id: 'c', kind: 'route' },
    ],
    timeline: { calendarZone: 'Europe/London', stops: [0, 1, 2, 3].map(() => ({ arrival: null, departure: null })) },
  };

  it('goes after the last entry of the day it was taken', () => {
    expect(photoStopIndex(view, '2026-07-01', neverTimed, dayAfter)).toBe(1);
    expect(photoStopIndex(view, '2026-07-02', neverTimed, dayAfter)).toBe(4);
  });

  it('goes at the end for a day the plan does not have, or no date', () => {
    expect(photoStopIndex(view, '2026-08-01', neverTimed, dayAfter)).toBe(4);
    expect(photoStopIndex(view, null, neverTimed, dayAfter)).toBe(4);
  });
});
