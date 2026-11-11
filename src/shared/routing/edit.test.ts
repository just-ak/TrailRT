import { describe, expect, it } from 'vitest';
import type { LatLon } from '../geo/distance';
import { EditRefused, planEdit, remapRecords, splitShapeAt, type PlannedControl } from './edit';

const p = (lat: number, lon: number): LatLon => ({ lat, lon });
const via = (lat: number, lon: number): PlannedControl => ({ point: p(lat, lon), role: 'via' });
const shaping = (lat: number, lon: number): PlannedControl => ({
  point: p(lat, lon),
  role: 'shaping',
});

/** Four control points, the third a shaping point; three straight legs. */
const CONTROL = [via(0, 0), via(0, 1), shaping(0, 2), via(0, 3)];
const LEGS = [
  [p(0, 0), p(0, 0.5), p(0, 1)],
  [p(0, 1), p(0, 1.5), p(0, 2)],
  [p(0, 2), p(0, 2.5), p(0, 3)],
];

describe('planEdit', () => {
  it('append: adds a via point and routes one new leg from the last point', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'append', at: p(0, 4) });
    expect(plan.control).toHaveLength(5);
    expect(plan.control[4]?.role).toBe('via');
    expect(plan.replace).toEqual({ from: 3, to: 3, count: 1 });
    expect(plan.section?.map((s) => s.point)).toEqual([p(0, 3), p(0, 4)]);
    expect(plan.sectionStart).toBe(3);
  });

  it('move start or end: re-routes the one leg it touches', () => {
    const start = planEdit(CONTROL, LEGS, { kind: 'move', index: 0, to: p(1, 0) });
    expect(start.replace).toEqual({ from: 0, to: 1, count: 1 });
    expect(start.section?.map((s) => s.point)).toEqual([p(1, 0), p(0, 1)]);

    const end = planEdit(CONTROL, LEGS, { kind: 'move', index: 3, to: p(1, 3) });
    expect(end.replace).toEqual({ from: 2, to: 3, count: 1 });
    expect(end.section?.map((s) => s.point)).toEqual([p(0, 2), p(1, 3)]);
  });

  it('move middle: re-routes both legs, pass-through only for a shaping point', () => {
    const viaMove = planEdit(CONTROL, LEGS, { kind: 'move', index: 1, to: p(1, 1) });
    expect(viaMove.replace).toEqual({ from: 0, to: 2, count: 2 });
    expect(viaMove.section?.map((s) => s.passThrough)).toEqual([false, false, false]);

    const shapingMove = planEdit(CONTROL, LEGS, { kind: 'move', index: 2, to: p(1, 2) });
    expect(shapingMove.replace).toEqual({ from: 1, to: 3, count: 2 });
    expect(shapingMove.section?.map((s) => s.passThrough)).toEqual([false, true, false]);
    // Section ends are never pass-through, even when they are shaping points.
    const beside = planEdit(CONTROL, LEGS, { kind: 'move', index: 1, to: p(1, 1) });
    expect(beside.section?.at(-1)?.passThrough).toBe(false);
  });

  it('insert (drag the line): a pass-through shaping point splits the leg', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'insert', leg: 0, at: p(0.2, 0.5) });
    expect(plan.control.map((c) => c.role)).toEqual(['via', 'shaping', 'via', 'shaping', 'via']);
    expect(plan.replace).toEqual({ from: 0, to: 1, count: 2 });
    expect(plan.section?.map((s) => s.passThrough)).toEqual([false, true, false]);
    expect(plan.remapLeg(0)).toBeNull();
    expect(plan.remapLeg(1)).toBe(2);
    expect(plan.remapControl(1)).toBe(2);
  });

  it('insertOnLine (click the line): splits the leg with no routing and no change in shape', () => {
    const plan = planEdit(CONTROL, LEGS, {
      kind: 'insertOnLine',
      leg: 1,
      segmentEnd: 2,
      at: p(0, 1.75),
    });
    expect(plan.section).toBeNull();
    expect(plan.knownLegs).toEqual([
      [p(0, 1), p(0, 1.5), p(0, 1.75)],
      [p(0, 1.75), p(0, 2)],
    ]);
    expect(plan.control[2]).toEqual({ point: p(0, 1.75), role: 'shaping' });
  });

  it('remove middle: merges the two legs and routes one', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'remove', index: 1 });
    expect(plan.control).toHaveLength(3);
    expect(plan.replace).toEqual({ from: 0, to: 2, count: 1 });
    expect(plan.section?.map((s) => s.point)).toEqual([p(0, 0), p(0, 2)]);
    expect(plan.remapControl(2)).toBe(1);
    expect(plan.remapLeg(2)).toBe(1);
  });

  it('remove start or end: drops that leg without routing, and the new end is a via point', () => {
    const plan = planEdit([via(0, 0), shaping(0, 1), via(0, 2)], LEGS.slice(0, 2), {
      kind: 'remove',
      index: 2,
    });
    expect(plan.replace).toEqual({ from: 1, to: 2, count: 0 });
    expect(plan.knownLegs).toEqual([]);
    expect(plan.section).toBeNull();
    expect(plan.control.at(-1)?.role).toBe('via');

    const start = planEdit(CONTROL, LEGS, { kind: 'remove', index: 0 });
    expect(start.replace).toEqual({ from: 0, to: 1, count: 0 });
    expect(start.remapLeg(1)).toBe(0);
  });

  it('setRole: changes no geometry', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'setRole', index: 1, role: 'shaping' });
    expect(plan.replace).toBeNull();
    expect(plan.section).toBeNull();
    expect(plan.control[1]?.role).toBe('shaping');
  });

  it('choose: the candidate becomes the geometry, split at its shaping points', () => {
    const candidate = [p(0, 1), p(1, 1.5), p(0, 2)];
    const plan = planEdit(CONTROL, LEGS, {
      kind: 'choose',
      leg: 1,
      candidate,
      shaping: [p(0.5, 1.25)],
    });
    expect(plan.section).toBeNull();
    expect(plan.replace).toEqual({ from: 1, to: 2, count: 2 });
    expect(plan.knownLegs).toEqual([
      [p(0, 1), p(0.5, 1.25)],
      [p(0.5, 1.25), p(1, 1.5), p(0, 2)],
    ]);
    expect(plan.control[2]).toEqual({ point: p(0.5, 1.25), role: 'shaping' });
    expect(plan.remapLeg(2)).toBe(3);
  });

  it('refuses edits that would break the rules', () => {
    const two = [via(0, 0), via(0, 1)];
    expect(() => planEdit(two, [LEGS[0] ?? []], { kind: 'remove', index: 0 })).toThrow(EditRefused);
    expect(() => planEdit(CONTROL, LEGS, { kind: 'setRole', index: 0, role: 'shaping' })).toThrow(
      EditRefused,
    );
    expect(() => planEdit(CONTROL, LEGS, { kind: 'move', index: 9, to: p(0, 0) })).toThrow(
      EditRefused,
    );
    expect(() => planEdit(CONTROL, LEGS, { kind: 'insert', leg: 3, at: p(0, 0) })).toThrow(
      EditRefused,
    );
  });
});

describe('splitShapeAt', () => {
  it('splits in order along the line, inserting each point as a shared vertex', () => {
    const pieces = splitShapeAt(
      [p(0, 0), p(0, 1), p(0, 2), p(0, 3)],
      [p(0, 0.5), p(0, 2.5)],
    );
    expect(pieces).toEqual([
      [p(0, 0), p(0, 0.5)],
      [p(0, 0.5), p(0, 1), p(0, 2), p(0, 2.5)],
      [p(0, 2.5), p(0, 3)],
    ]);
  });
});

describe('remapRecords', () => {
  it('moves records with their points and replaces those of re-routed legs', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'insert', leg: 0, at: p(0.2, 0.5) });
    const records = remapRecords(
      plan,
      {
        unmatchedLegs: [[0, 1], [2, 3]],
        displaced: [{ index: 3, displacementM: 900 }],
      },
      // The two new legs: the second did not match.
      [true, false],
      // The section's far end (old point 1) displaced 400 m.
      [{ index: 2, displacementM: 400 }],
    );
    // Old leg 0 was replaced; old leg 2 is now leg 3; new leg 1 is unmatched.
    expect(records.unmatchedLegs).toEqual([[1, 2], [3, 4]]);
    // Old point 3 is now point 4; the section's index 2 is new point 2.
    expect(records.displaced).toEqual([
      { index: 2, displacementM: 400 },
      { index: 4, displacementM: 900 },
    ]);
  });

  it('drops the record of a moved point until routing measures it again', () => {
    const plan = planEdit(CONTROL, LEGS, { kind: 'move', index: 3, to: p(1, 3) });
    const records = remapRecords(
      plan,
      { unmatchedLegs: [], displaced: [{ index: 3, displacementM: 5000 }] },
      [true],
      [],
    );
    expect(records.displaced).toEqual([]);
  });
});
