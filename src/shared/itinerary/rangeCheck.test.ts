import { describe, expect, it } from 'vitest';
import { checkRange } from './rangeCheck';

const KM = 1000;

describe('checkRange', () => {
  it('runs no check when no range is set, which is not a pass', () => {
    expect(
      checkRange({ totalM: 900 * KM, refuelAlongM: [], uncovered: [], rangeKm: null, reservePct: 20 }),
    ).toEqual({ checked: false, reason: 'no-range' });
  });

  it('flags a stretch longer than the usable range with no station mapped', () => {
    // 200 km range, 20% reserve: 160 km usable.
    const result = checkRange({
      totalM: 300 * KM,
      refuelAlongM: [120 * KM],
      uncovered: [],
      rangeKm: 200,
      reservePct: 20,
    });
    if (!result.checked) throw new Error('expected a check');
    expect(result.usableM).toBe(160 * KM);
    expect(result.assumesFullTankAtStart).toBe(true);
    expect(result.gaps).toEqual([
      { fromM: 120 * KM, toM: 300 * KM, lengthM: 180 * KM, status: 'warning' },
    ]);
  });

  it('a station in the middle of the stretch clears it', () => {
    const result = checkRange({
      totalM: 300 * KM,
      refuelAlongM: [120 * KM, 210 * KM],
      uncovered: [],
      rangeKm: 200,
      reservePct: 20,
    });
    expect(result.checked && result.gaps).toEqual([]);
  });

  it('the reserve shrinks the usable range', () => {
    const base = { totalM: 170 * KM, refuelAlongM: [], uncovered: [], rangeKm: 200 };
    expect(checkRange({ ...base, reservePct: 0 }).checked).toBe(true);
    const none = checkRange({ ...base, reservePct: 0 });
    const some = checkRange({ ...base, reservePct: 20 });
    expect(none.checked && none.gaps).toEqual([]);
    expect(some.checked && some.gaps.map((g) => g.status)).toEqual(['warning']);
  });

  it('a long stretch through uncovered data is not checked, not a warning', () => {
    const result = checkRange({
      totalM: 400 * KM,
      refuelAlongM: [],
      uncovered: [{ fromM: 250 * KM, toM: 400 * KM }],
      rangeKm: 200,
      reservePct: 20,
    });
    expect(result.checked && result.gaps.map((g) => g.status)).toEqual(['not-checked']);
  });

  it('a gap across a ferry crossing is not checked', () => {
    const result = checkRange({
      totalM: 300 * KM,
      refuelAlongM: [],
      uncovered: [{ fromM: 120 * KM, toM: 120 * KM }],
      rangeKm: 200,
      reservePct: 20,
    });
    expect(result.checked && result.gaps.map((g) => g.status)).toEqual(['not-checked']);
  });

  it('ignores stations exactly at either end and sorts the rest', () => {
    const result = checkRange({
      totalM: 300 * KM,
      refuelAlongM: [300 * KM, 150 * KM, 0],
      uncovered: [],
      rangeKm: 200,
      reservePct: 20,
    });
    expect(result.checked && result.gaps).toEqual([]);
  });
});
