import { describe, expect, it } from 'vitest';
import type { LatLon } from '../geo/distance';
import { distanceToLineM, MAX_SHAPING_POINTS } from '../geo/divergence';
import { planEdit } from './edit';
import { pinCandidate, type SectionRouter } from './pin';

/** Buxton, as the origin for metre offsets. */
const ORIGIN = { lat: 53.2588, lon: -1.9115 };
function at(east: number, north: number): LatLon {
  const k = 6_371_008.8 * (Math.PI / 180);
  return {
    lat: ORIGIN.lat + north / k,
    lon: ORIGIN.lon + east / (k * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}
const line = (pts: [number, number][]): LatLon[] => pts.map(([e, n]) => at(e, n));

/** The preferred route: straight east for 10 km. */
const PREFERRED = line([[0, 0], [2500, 0], [5000, 0], [7500, 0], [10_000, 0]]);
/** The chosen alternative: a northern loop up to 1.5 km off the direct road. */
const NORTHERN = line([[0, 0], [2000, 1000], [5000, 1500], [8000, 1000], [10_000, 0]]);

/**
 * A fake engine. With enough pins on the northern road it takes that road;
 * with fewer, it passes through the pins it was given by the most direct line,
 * as a real engine honouring pass-through does. Counts its calls.
 */
function engine(pinsNeeded = 1): { route: SectionRouter; calls: () => number } {
  let calls = 0;
  return {
    route: async (locations) => {
      calls += 1;
      const pins = locations.slice(1, -1);
      const onNorth = pins.filter((l) => distanceToLineM(l.point, NORTHERN) < 30).length;
      if (onNorth >= pinsNeeded) return NORTHERN;
      return pins.length === 0 ? PREFERRED : locations.map((l) => l.point);
    },
    calls: () => calls,
  };
}

describe('pinCandidate', () => {
  it('pins the candidate where it is farthest from the preferred route, and verifies in one pass', async () => {
    const fake = engine(1);
    const result = await pinCandidate(NORTHERN, PREFERRED, fake.route);

    expect(result.verified).toBe(true);
    expect(result.shaping).toHaveLength(1);
    expect(fake.calls()).toBe(1);
    // The pin lies on the chosen road, and well away from the preferred one.
    const pin = result.shaping[0] as LatLon;
    expect(distanceToLineM(pin, NORTHERN)).toBeLessThan(1);
    expect(distanceToLineM(pin, PREFERRED)).toBeGreaterThan(1000);
  });

  it('adds a second pin when the engine needs two to be persuaded', async () => {
    const fake = engine(2);
    // An engine that needs two pins returns the preferred route after one, so
    // the second pin goes where the re-route disagrees most — still the north.
    const result = await pinCandidate(NORTHERN, PREFERRED, fake.route);
    expect(result.shaping.length).toBeGreaterThanOrEqual(2);
    expect(result.verified).toBe(true);
  });

  it('stops at the bound and reports an unverified pin rather than looping', async () => {
    const stubborn: SectionRouter = async () => PREFERRED;
    const result = await pinCandidate(NORTHERN, PREFERRED, stubborn);
    expect(result.verified).toBe(false);
    expect(result.shaping.length).toBeLessThanOrEqual(MAX_SHAPING_POINTS);
    expect(result.shaping.length).toBeGreaterThan(0);
  });

  it('adds nothing when the candidate is the preferred road', async () => {
    const fake = engine(1);
    const result = await pinCandidate(PREFERRED, PREFERRED, fake.route);
    expect(result).toEqual({ shaping: [], verified: true, overlap: 1 });
    expect(fake.calls()).toBe(0);
  });

  it('stored geometry is the candidate with only on-line vertices added', async () => {
    const { shaping } = await pinCandidate(NORTHERN, PREFERRED, engine(1).route);
    const plan = planEdit(
      [
        { point: at(0, 0), role: 'via' },
        { point: at(10_000, 0), role: 'via' },
      ],
      [PREFERRED],
      { kind: 'choose', leg: 0, candidate: NORTHERN, shaping },
    );
    const stored = (plan.knownLegs ?? []).flat();
    // Every original vertex is still there, in order...
    const originals = stored.filter((p) => NORTHERN.some((q) => q.lat === p.lat && q.lon === p.lon));
    expect(new Set(originals.map((p) => `${p.lat},${p.lon}`)).size).toBe(NORTHERN.length);
    // ...and everything added lies on the candidate.
    for (const p of stored) expect(distanceToLineM(p, NORTHERN)).toBeLessThan(0.5);
  });
});
