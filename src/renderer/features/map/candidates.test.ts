import { describe, expect, it } from 'vitest';
import type { Candidate } from '@shared/routing/results';
import { candidateSummaries, legAlternativesAvailability } from './candidates';

const candidate = (distanceM: number | null, estimatedDurationS: number | null): Candidate => ({
  matched: true,
  shape: [
    { lat: 53.2588, lon: -1.9115 },
    { lat: 53.2602, lon: -2.1255 },
  ],
  distanceM,
  displacementM: null,
  estimatedDurationS,
});

describe('candidateSummaries', () => {
  it('describes each candidate and its difference from the first, durations marked as estimates', () => {
    const [a, b, c] = candidateSummaries(
      [candidate(19_600, 1500), candidate(22_800, 1860), candidate(18_100, 1620)],
      'metric',
    );

    expect(a).toMatchObject({ letter: 'A', distance: '19.6 km', duration: '25 min (est.)', delta: null });
    expect(b).toMatchObject({ letter: 'B', delta: '+3.20 km · +6 min (est.)' });
    expect(c).toMatchObject({ letter: 'C', delta: '−1.50 km · +2 min (est.)' });
    expect(b?.mapLabel).toBe('B · +3.20 km · +6 min (est.)');
  });

  it('uses the user’s units', () => {
    const [, b] = candidateSummaries([candidate(16_093, null), candidate(32_187, null)], 'imperial');
    expect(b?.delta).toBe('+10.0 mi');
  });

  it('says nothing it does not know rather than inventing a figure', () => {
    const [a, b] = candidateSummaries([candidate(null, null), candidate(1000, 60)], 'metric');
    expect(a?.duration).toBe('—');
    expect(b?.delta).toBe('—');
  });
});

describe('legAlternativesAvailability', () => {
  const snapped = {
    controlPoints: [
      { lat: 53.2588, lon: -1.9115, role: 'via' as const, shapeIndex: 0 },
      { lat: 53.2578, lon: -2.0327, role: 'via' as const, shapeIndex: 10 },
      { lat: 53.2602, lon: -2.1255, role: 'via' as const, shapeIndex: 20 },
    ],
    unmatchedLegs: [[1, 2]] as [number, number][],
  };
  const capable = { alternatives: true, passThrough: true };

  it('is available for a matched leg of a snapped route on a capable provider', () => {
    expect(legAlternativesAvailability(snapped, 0, capable)).toEqual({ available: true });
  });

  it('is not offered for a hand-drawn route', () => {
    const result = legAlternativesAvailability({ controlPoints: [], unmatchedLegs: [] }, 0, capable);
    expect(result.available).toBe(false);
  });

  it('is not offered for an unmatched leg, and says why', () => {
    const result = legAlternativesAvailability(snapped, 1, capable);
    expect(result).toMatchObject({ available: false });
    expect(result.available === false && result.reason).toMatch(/no road route/);
  });

  it('is not offered when the provider cannot offer alternatives', () => {
    expect(
      legAlternativesAvailability(snapped, 0, { alternatives: false, passThrough: false }).available,
    ).toBe(false);
  });
});
