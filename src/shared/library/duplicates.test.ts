import { describe, expect, it } from 'vitest';
import { duplicatesText, groupDuplicates, pointsCarried, type DuplicateItem } from './duplicates';

/** Phase 14 Requirement 28: grouping by content and the keep rule. */

const PEAK = 'trip-peak';
const WALES = 'trip-wales';
const LOOSE = 'trip-loose';

function item(id: string, key: string, over: Partial<DuplicateItem> = {}): DuplicateItem & { key: string } {
  return { id, key, name: id, tripId: PEAK, tripName: 'Peak', loose: false, inPlan: false, createdAt: 100, pointCount: 0, ...over };
}

describe('groupDuplicates', () => {
  it('groups by key whatever the names, and leaves single copies out', () => {
    const groups = groupDuplicates([
      item('a', 'k1', { name: 'Cat and Fiddle' }),
      item('b', 'k1', { name: 'Something else entirely', createdAt: 200 }),
      item('c', 'k2'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep.id).toBe('a');
    expect(groups[0]?.remove.map((r) => r.id)).toEqual(['b']);
  });

  it('keeps one a plan uses, then one in a trip, then the oldest', () => {
    const plan = groupDuplicates([item('old', 'k', { createdAt: 1 }), item('planned', 'k', { inPlan: true, createdAt: 9 })]);
    expect(plan[0]?.keep.id).toBe('planned');

    const trip = groupDuplicates([
      item('loose', 'k', { tripId: LOOSE, loose: true, createdAt: 1 }),
      item('inTrip', 'k', { createdAt: 9 }),
    ]);
    expect(trip[0]?.keep.id).toBe('inTrip');

    const oldest = groupDuplicates([item('new', 'k', { createdAt: 9 }), item('old', 'k', { createdAt: 1 })]);
    expect(oldest[0]?.keep.id).toBe('old');
  });

  it('never removes a copy a plan uses, and drops a group left with nothing to remove', () => {
    const groups = groupDuplicates([
      item('p1', 'k', { inPlan: true, createdAt: 1 }),
      item('p2', 'k', { inPlan: true, createdAt: 2 }),
      item('spare', 'k', { createdAt: 3 }),
      item('q1', 'j', { inPlan: true }),
      item('q2', 'j', { inPlan: true }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep.id).toBe('p1');
    expect(groups[0]?.alsoKept.map((r) => r.id)).toEqual(['p2']);
    expect(groups[0]?.remove.map((r) => r.id)).toEqual(['spare']);
  });

  it('marks copies in more than one trip, but not a copy outside any trip', () => {
    const [across] = groupDuplicates([item('a', 'k'), item('b', 'k', { tripId: WALES, createdAt: 200 })]);
    expect(across?.acrossTrips).toBe(true);
    const [loose] = groupDuplicates([item('a', 'k'), item('b', 'k', { tripId: LOOSE, loose: true })]);
    expect(loose?.acrossTrips).toBe(false);
  });

  it('orders groups by the kept name, and counts the route points they carry', () => {
    const groups = groupDuplicates([
      item('z1', 'z', { name: 'Zennor', pointCount: 10 }),
      item('z2', 'z', { name: 'Zennor', pointCount: 10, createdAt: 200 }),
      item('a1', 'a', { name: 'Alport', pointCount: 3 }),
      item('a2', 'a', { name: 'Alport', pointCount: 3, createdAt: 200 }),
      item('a3', 'a', { name: 'Alport', pointCount: 3, createdAt: 300 }),
    ]);
    expect(groups.map((g) => g.keep.name)).toEqual(['Alport', 'Zennor']);
    expect(pointsCarried(groups)).toBe(16);
  });
});

describe('duplicatesText', () => {
  it('counts one and many', () => {
    expect(duplicatesText(1, 'track')).toBe('1 duplicate track');
    expect(duplicatesText(1200, 'waypoint')).toBe('1,200 duplicate waypoints');
  });
});
