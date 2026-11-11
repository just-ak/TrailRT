/**
 * Stretches of a trip longer than the vehicle can go without refuelling.
 *
 * Phase 10 Requirement 9. Pure: it takes positions along the line, not POIs,
 * so it knows nothing about where the stations came from.
 *
 * Three answers are kept apart, because each means something different:
 *
 * - **No range set**: no check ran. That is not "fine" (Requirement 9.1).
 * - **Warning**: a stretch longer than the usable range with no station
 *   *mapped* in the corridor. The station may exist; OpenStreetMap may not
 *   have it (Requirement 9.4).
 * - **Not checked**: a long stretch that runs outside the loaded place data.
 *   There is nothing to say about it either way.
 *
 * It **assumes a full tank at the start**, and the UI says so. Nothing else is
 * assumed.
 */

export interface RangeCheckInput {
  /** Length of the whole line, metres. */
  totalM: number;
  /** Distance along the line of every refuelling point in the corridor. */
  refuelAlongM: readonly number[];
  /** Stretches outside the loaded place data. */
  uncovered: readonly { fromM: number; toM: number }[];
  rangeKm: number | null;
  /** 0–90. */
  reservePct: number;
}

export interface RangeGap {
  fromM: number;
  toM: number;
  lengthM: number;
  status: 'warning' | 'not-checked';
}

export type RangeCheckResult =
  | { checked: false; reason: 'no-range' }
  | {
      checked: true;
      /** Range less the reserve, metres. */
      usableM: number;
      gaps: RangeGap[];
      assumesFullTankAtStart: true;
    };

export function checkRange(input: RangeCheckInput): RangeCheckResult {
  if (input.rangeKm === null || !(input.rangeKm > 0)) {
    return { checked: false, reason: 'no-range' };
  }

  const reserve = Math.min(Math.max(input.reservePct, 0), 90) / 100;
  const usableM = input.rangeKm * 1000 * (1 - reserve);

  const stops = [
    0,
    ...input.refuelAlongM.filter((m) => m > 0 && m < input.totalM).toSorted((a, b) => a - b),
    input.totalM,
  ];

  const gaps: RangeGap[] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const fromM = stops[index] ?? 0;
    const toM = stops[index + 1] ?? fromM;
    const lengthM = toM - fromM;
    if (lengthM <= usableM) continue;
    // Inclusive at a point: a zero-length stretch (a ferry crossing between
    // two road legs) inside this gap still means the gap cannot be checked.
    const touchesUncovered = input.uncovered.some((stretch) =>
      stretch.fromM === stretch.toM
        ? stretch.fromM > fromM && stretch.fromM < toM
        : stretch.fromM < toM && stretch.toM > fromM,
    );
    gaps.push({ fromM, toM, lengthM, status: touchesUncovered ? 'not-checked' : 'warning' });
  }

  return { checked: true, usableM, gaps, assumesFullTankAtStart: true };
}
