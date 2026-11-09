import { describe, expect, it } from 'vitest';
import type { LatLon } from './distance';
import { findBends, resample, twistiness, type Twistiness } from './twistiness';

/**
 * Synthetic roads, laid out in metres around Buxton and converted to latitude
 * and longitude. The shapes are invented on purpose: each one isolates a single
 * property of the scorer. The real-road calibration is the live test.
 */
const ORIGIN = { lat: 53.2588, lon: -1.911 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

function at(x: number, y: number): LatLon {
  return { lat: ORIGIN.lat + y / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

/** A path built from straights and arcs, sampled every `step` metres. */
class Pen {
  x = 0;
  y = 0;
  /** Heading in radians, 0 = east, counter-clockwise positive. */
  heading = 0;
  points: LatLon[] = [at(0, 0)];

  constructor(private readonly step: number) {}

  straight(length: number): this {
    for (let d = this.step; d <= length + 1e-9; d += this.step) {
      this.points.push(
        at(this.x + Math.cos(this.heading) * d, this.y + Math.sin(this.heading) * d),
      );
    }
    this.x += Math.cos(this.heading) * length;
    this.y += Math.sin(this.heading) * length;
    return this;
  }

  /** Positive degrees turn left. */
  arc(radius: number, degrees: number): this {
    const sweep = (degrees * Math.PI) / 180;
    const sign = Math.sign(sweep);
    const cx = this.x - Math.sin(this.heading) * radius * sign;
    const cy = this.y + Math.cos(this.heading) * radius * sign;
    const start = this.heading - (sign * Math.PI) / 2;
    const length = Math.abs(sweep) * radius;
    for (let d = this.step; d <= length + 1e-9; d += this.step) {
      const a = start + (sign * d) / radius;
      this.points.push(at(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius));
    }
    this.heading += sweep;
    this.x = cx + Math.cos(start + sweep) * radius;
    this.y = cy + Math.sin(start + sweep) * radius;
    return this;
  }
}

/** A road snaking either side of a straight line: amplitude and wavelength in metres. */
function sineRoad(lengthM: number, amplitude: number, wavelength: number, step: number): LatLon[] {
  const out: LatLon[] = [];
  for (let x = 0; x <= lengthM; x += step) {
    out.push(at(x, amplitude * Math.sin((2 * Math.PI * x) / wavelength)));
  }
  return out;
}

function known(points: LatLon[]): Twistiness {
  const result = twistiness(points);
  if (!result.known) throw new Error(`expected a score, got: ${result.reason}`);
  return result.twistiness;
}

describe('resample', () => {
  it('spaces points evenly regardless of the input spacing', () => {
    const dense = new Pen(2).straight(1000).points;
    const sparse = new Pen(250).straight(1000).points;
    const fromDense = resample(dense, 20);
    expect(fromDense.length).toBeGreaterThanOrEqual(50);
    expect(resample(sparse, 20)).toHaveLength(fromDense.length);
  });
});

describe('twistiness', () => {
  it('scores a straight road as zero', () => {
    const t = known(new Pen(20).straight(2000).points);
    expect(t.score).toBe(0);
    expect(t.level).toBe('straight');
    expect(t.bendCount).toBe(0);
  });

  it('counts and classes a single 90° bend of 100 m radius', () => {
    const bends = findBends(new Pen(5).straight(500).arc(100, 90).straight(500).points);
    expect(bends).toHaveLength(1);
    const [bend] = bends;
    expect(bend?.angleDeg).toBeGreaterThan(80);
    expect(bend?.angleDeg).toBeLessThan(100);
    expect(bend?.radiusM).toBeGreaterThan(70);
    expect(bend?.radiusM).toBeLessThan(140);
    expect(bend?.kind).toBe('bend');
    expect(bend?.direction).toBe('left');
  });

  it('identifies a hairpin, and does not call a 90° corner one', () => {
    for (const radius of [8, 12, 20]) {
      const t = known(new Pen(3).straight(400).arc(-radius, -180).straight(400).points);
      expect(t.hairpinCount, `radius ${radius} m`).toBe(1);
      expect(t.tightCount).toBe(1);
    }
    const corner = known(new Pen(3).straight(400).arc(12, 90).straight(400).points);
    expect(corner.hairpinCount).toBe(0);
    expect(corner.tightCount).toBe(1);
  });

  it('does not count digitising or GPS jitter as bends', () => {
    // ±3 m alternating either side of a straight line, every 10 m.
    const jitter: LatLon[] = [];
    for (let i = 0; i <= 200; i += 1) jitter.push(at(i * 10, i % 2 === 0 ? 3 : -3));
    const t = known(jitter);
    expect(t.level).toBe('straight');
    expect(t.hairpinCount).toBe(0);
  });

  it('is not moved by point density', () => {
    // The owner's suggestion was points per kilometre; this is the case it
    // gets wrong. The same road at 5 m and at 40 m spacing is the same road.
    const dense = known(sineRoad(3000, 40, 400, 5));
    const sparse = known(sineRoad(3000, 40, 400, 40));
    expect(Math.abs(dense.score - sparse.score)).toBeLessThan(0.3);
    expect(dense.score).toBeGreaterThan(2.5);
  });

  it('ranks a winding road above a gently curving one above a straight one', () => {
    const straight = known(new Pen(20).straight(3000).points);
    const gentle = known(sineRoad(3000, 15, 1500, 10));
    const winding = known(sineRoad(3000, 40, 300, 10));
    expect(winding.score).toBeGreaterThan(gentle.score);
    expect(gentle.score).toBeGreaterThanOrEqual(straight.score);
    expect(winding.level === 'twisty' || winding.level === 'very-twisty').toBe(true);
  });

  it('is unknown, not zero, for straight lines between clicked points', () => {
    const clicked = [at(0, 0), at(700, 200), at(1400, -100), at(2100, 300)];
    const result = twistiness(clicked);
    expect(result.known).toBe(false);
    if (!result.known) expect(result.reason).toMatch(/too far apart/);
  });

  it('is unknown for a line too short to score', () => {
    const result = twistiness(new Pen(10).straight(300).points);
    expect(result.known).toBe(false);
  });

  it('splits the line into kilometre windows and folds a short tail', () => {
    const t = known(new Pen(20).straight(3300).points);
    expect(t.windows).toHaveLength(3);
    expect(t.windows[0]?.startM).toBe(0);
    expect(t.windows.at(-1)?.endM).toBeCloseTo(t.lengthM, 0);
  });

  it('locates the twisty kilometre', () => {
    const points = new Pen(5)
      .straight(1000)
      .arc(30, 120)
      .arc(-30, -120)
      .arc(30, 120)
      .straight(1500).points;
    const t = known(points);
    const busiest = t.windows.toSorted((a, b) => b.degPerKm - a.degPerKm)[0];
    expect(busiest?.startM).toBe(1000);
  });
});
