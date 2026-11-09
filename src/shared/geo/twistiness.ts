import { bearingDelta, initialBearing } from './bearing';
import { haversineDistance, type LatLon } from './distance';

/**
 * Twistiness: how much a line bends, per kilometre, in a form that does not
 * depend on how many points happen to describe it.
 *
 * ## Why not points per kilometre
 *
 * Point density looks like a proxy for bends — a straight road needs two
 * points, a bend needs many. It is not a usable one, for three reasons that
 * all appear in the project's own geography:
 *
 * 1. **Density follows the mapper, not the road.** A carefully mapped straight
 *    road carries a node at every lamp post and bridge joint. Snake Pass, one
 *    of the twistiest roads in the Peak District, comes back from the engine at
 *    28 points per km — the same as the A53 (29) and barely more than the much
 *    straighter A523 (25).
 * 2. **A recording has constant density.** A GPS track logs once a second, so
 *    its points per kilometre measures how *slowly* it was ridden. Every slow
 *    straight would score as twisty.
 * 3. **Junctions are points too.** A town centre is dense with nodes because
 *    roads meet there, not because they bend.
 *
 * So the line is first **resampled** at a fixed spacing, which throws the
 * original point density away entirely, and twistiness is then measured from
 * heading change: how many degrees of genuine bend the road turns through per
 * kilometre. The windy-roads phase, Requirement 3.5, asks for exactly this
 * normalisation.
 *
 * ## The pipeline
 *
 * 1. Refuse to score what cannot be scored: too short, or too sparse to show a
 *    bend at all (a hand-drawn line between clicks). Unknown, not zero —
 *    sparse geometry is not evidence of a straight road.
 * 2. Resample every `RESAMPLE_M` metres along the line.
 * 3. Smooth with a short moving average, so GPS jitter and digitising zigzags
 *    — which alternate left and right — cancel rather than accumulate.
 * 4. Measure the signed heading change at every step.
 * 5. Group consecutive same-direction turning into **bends**, and keep only
 *    those that turn far enough, tightly enough, to be felt from a saddle.
 * 6. Score = degrees of bend per kilometre, mapped onto 0–10.
 *
 * ## What it cannot know
 *
 * Camber, sight lines, surface, traffic, and whether a road is fun. A turn at
 * a junction is measured as a bend, so a route that weaves through a town
 * scores higher than it rides. Pure and dependency-free, so all of this is
 * testable without Electron.
 */

/** Resampling interval. Short enough to resolve a hairpin, long enough to ignore jitter. */
export const RESAMPLE_M = 20;

/** Points averaged either side of each resampled point. */
export const SMOOTH_HALF_WINDOW = 1;

/**
 * Per-step heading change below which the road is treated as straight.
 * 2° per 20 m is a radius of about 570 m — a curve no rider brakes for.
 */
export const STRAIGHT_STEP_DEG = 2;

/** A bend must turn at least this far in total to count. Filters kinks and lane shifts. */
export const MIN_BEND_DEG = 20;

/** And be at least this tight. Wider curves are sweeping, not twisty. */
export const MAX_BEND_RADIUS_M = 400;

/**
 * Bend classification thresholds, by **measured** radius.
 *
 * Measured, not true: at 20 m resampling with smoothing, a turn is spread over
 * at least two or three steps, so the radius estimate has a floor of roughly
 * 25–30 m. A true 12 m hairpin measures about 32 m and a true 25 m one about
 * 45 m. The thresholds are set on the measured scale so that real hairpins,
 * which are 10–25 m, are classed as hairpins.
 */
export const TIGHT_RADIUS_M = 60;
export const HAIRPIN_DEG = 135;
export const HAIRPIN_RADIUS_M = 45;

/** Shorter than this, a score is noise. */
export const MIN_SCORED_LENGTH_M = 500;

/**
 * Median source spacing above which the geometry is too sparse to score.
 *
 * Road geometry from the engine and a once-a-second recording both sit well
 * under 50 m. A route drawn by clicking has spacings in kilometres, and its
 * straight lines say nothing about the roads beneath them.
 */
export const MAX_MEDIAN_SPACING_M = 150;

/** Degrees of bend per kilometre that maps to a score of 10. Calibrated, see below. */
export const SCORE_FULL_DEG_PER_KM = 300;

/** Window length for the twistiness band along the profile. */
export const WINDOW_M = 1000;

export type TwistinessLevel = 'straight' | 'gentle' | 'winding' | 'twisty' | 'very-twisty';

/**
 * Score bands.
 *
 * Calibrated against real roads in the test geography, routed on a
 * three-county graph (Derbyshire, Cheshire, Staffordshire). See
 * `twistiness.test.ts` for the synthetic cases and the live test for the
 * measured ones; the recorded values are in the regions-and-profile design.
 */
export const LEVELS: readonly { level: TwistinessLevel; minScore: number; label: string }[] = [
  { level: 'straight', minScore: 0, label: 'Straight' },
  { level: 'gentle', minScore: 1.5, label: 'Gentle' },
  { level: 'winding', minScore: 2.5, label: 'Winding' },
  { level: 'twisty', minScore: 5, label: 'Twisty' },
  { level: 'very-twisty', minScore: 7.5, label: 'Very twisty' },
];

export function levelFor(score: number): (typeof LEVELS)[number] {
  let found = LEVELS[0];
  for (const entry of LEVELS) if (score >= entry.minScore) found = entry;
  // LEVELS is non-empty, so `found` is always set.
  return found as (typeof LEVELS)[number];
}

export interface Bend {
  /** Distance along the line, metres, at the middle of the bend. */
  atM: number;
  /** Total turn, degrees, unsigned. */
  angleDeg: number;
  /** Estimated radius, metres. */
  radiusM: number;
  direction: 'left' | 'right';
  kind: 'sweeping' | 'bend' | 'tight' | 'hairpin';
}

export interface TwistinessWindow {
  startM: number;
  endM: number;
  degPerKm: number;
  score: number;
}

export interface Twistiness {
  /** 0–10. */
  score: number;
  level: TwistinessLevel;
  label: string;
  /** Degrees of counted bend per kilometre. */
  degPerKm: number;
  /** Counted bends per kilometre. */
  bendsPerKm: number;
  bendCount: number;
  tightCount: number;
  hairpinCount: number;
  lengthM: number;
  windows: TwistinessWindow[];
}

export type TwistinessResult =
  | { known: true; twistiness: Twistiness }
  | { known: false; reason: string };

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Points every `spacingM` along the line, by linear interpolation.
 *
 * Linear in latitude and longitude is accurate to well under a metre over a
 * 20 m step, which is all it is ever asked to span. Zero-length segments are
 * skipped, so duplicate points cost nothing.
 */
export function resample(points: readonly LatLon[], spacingM: number): LatLon[] {
  const first = points[0];
  if (first === undefined) return [];
  const out: LatLon[] = [{ lat: first.lat, lon: first.lon }];
  let carried = 0; // distance travelled since the last emitted point

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const length = haversineDistance(a, b);
    if (length === 0) continue;

    let along = spacingM - carried;
    while (along <= length) {
      const f = along / length;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      along += spacingM;
    }
    carried = length - (along - spacingM);
  }
  return out;
}

function smooth(points: readonly LatLon[], half: number): LatLon[] {
  if (half <= 0) return [...points];
  return points.map((_, i) => {
    let lat = 0;
    let lon = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j += 1) {
      const p = points[j];
      if (p === undefined) continue;
      lat += p.lat;
      lon += p.lon;
      n += 1;
    }
    return { lat: lat / n, lon: lon / n };
  });
}

function classify(angleDeg: number, radiusM: number): Bend['kind'] {
  if (angleDeg >= HAIRPIN_DEG && radiusM <= HAIRPIN_RADIUS_M) return 'hairpin';
  if (radiusM <= TIGHT_RADIUS_M) return 'tight';
  if (radiusM <= 150) return 'bend';
  return 'sweeping';
}

/**
 * The bends along a line, after resampling and smoothing.
 *
 * A bend is a run of steps turning the same way by more than
 * `STRAIGHT_STEP_DEG`. One quieter step inside the run is tolerated, because a
 * long bend often has a near-straight moment in the middle that the rider does
 * not experience as two bends. Exported for tests.
 */
export function findBends(points: readonly LatLon[]): Bend[] {
  const line = smooth(resample(points, RESAMPLE_M), SMOOTH_HALF_WINDOW);
  const headings: (number | null)[] = [];
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    headings.push(a === undefined || b === undefined ? null : initialBearing(a, b));
  }

  // turns[k] is the change between step k and k+1, located at resampled point k+1.
  const turns: number[] = [];
  for (let k = 1; k < headings.length; k += 1) {
    const h0 = headings[k - 1];
    const h1 = headings[k];
    turns.push(
      h0 === null || h0 === undefined || h1 === null || h1 === undefined
        ? 0
        : bearingDelta(h0, h1),
    );
  }

  const bends: Bend[] = [];
  let k = 0;
  while (k < turns.length) {
    const t = turns[k] ?? 0;
    if (Math.abs(t) < STRAIGHT_STEP_DEG) {
      k += 1;
      continue;
    }
    const sign = Math.sign(t);
    let sum = 0;
    let steps = 0;
    let quiet = 0;
    let end = k;
    for (let j = k; j < turns.length; j += 1) {
      const tj = turns[j] ?? 0;
      if (Math.abs(tj) >= STRAIGHT_STEP_DEG && Math.sign(tj) === sign) {
        sum += tj;
        steps += 1 + quiet;
        quiet = 0;
        end = j;
      } else if (Math.abs(tj) < STRAIGHT_STEP_DEG && quiet === 0) {
        quiet = 1;
      } else {
        break;
      }
    }

    const angleDeg = Math.abs(sum);
    const arcM = Math.max(1, steps) * RESAMPLE_M;
    const radiusM = arcM / (angleDeg * (Math.PI / 180));
    if (angleDeg >= MIN_BEND_DEG && radiusM <= MAX_BEND_RADIUS_M) {
      const midIndex = Math.round((k + end) / 2) + 1;
      bends.push({
        atM: midIndex * RESAMPLE_M,
        angleDeg,
        radiusM,
        direction: sign > 0 ? 'right' : 'left',
        kind: classify(angleDeg, radiusM),
      });
    }
    k = end + 1;
  }
  return bends;
}

function toScore(degPerKm: number): number {
  return Math.min(10, Math.round((degPerKm / SCORE_FULL_DEG_PER_KM) * 100) / 10);
}

/**
 * Scores a line.
 *
 * The line is whatever the profile is drawn from: a route's stored points or a
 * track's recorded ones. Nothing is written back — the resampled line is
 * thrown away once measured, so the stored geometry is untouched.
 */
export function twistiness(points: readonly LatLon[]): TwistinessResult {
  const spacings: number[] = [];
  let lengthM = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const d = haversineDistance(a, b);
    if (d === 0) continue;
    spacings.push(d);
    lengthM += d;
  }

  if (lengthM < MIN_SCORED_LENGTH_M) {
    return {
      known: false,
      reason: 'Too short to score — twistiness needs at least half a kilometre.',
    };
  }
  if (median(spacings) > MAX_MEDIAN_SPACING_M) {
    return {
      known: false,
      reason:
        'The points are too far apart to show bends. Straight lines between clicked points say nothing about the roads beneath them.',
    };
  }

  const bends = findBends(points);
  const km = lengthM / 1000;
  const totalDeg = bends.reduce((sum, bend) => sum + bend.angleDeg, 0);
  const degPerKm = totalDeg / km;
  const score = toScore(degPerKm);
  const level = levelFor(score);

  const windows: TwistinessWindow[] = [];
  for (let start = 0; start < lengthM; start += WINDOW_M) {
    const end = Math.min(lengthM, start + WINDOW_M);
    // A short tail is folded into the previous window rather than scored on
    // its own, where one bend would read as a very twisty kilometre.
    if (end - start < WINDOW_M / 2 && windows.length > 0) {
      const last = windows.at(-1);
      if (last !== undefined) {
        const deg = bends
          .filter((b) => b.atM >= last.startM && b.atM < end)
          .reduce((s, b) => s + b.angleDeg, 0);
        last.endM = end;
        last.degPerKm = deg / ((end - last.startM) / 1000);
        last.score = toScore(last.degPerKm);
      }
      break;
    }
    const deg = bends
      .filter((b) => b.atM >= start && b.atM < end)
      .reduce((s, b) => s + b.angleDeg, 0);
    const perKm = deg / ((end - start) / 1000);
    windows.push({ startM: start, endM: end, degPerKm: perKm, score: toScore(perKm) });
  }

  return {
    known: true,
    twistiness: {
      score,
      level: level.level,
      label: level.label,
      degPerKm,
      bendsPerKm: bends.length / km,
      bendCount: bends.length,
      tightCount: bends.filter((b) => b.kind === 'tight' || b.kind === 'hairpin').length,
      hairpinCount: bends.filter((b) => b.kind === 'hairpin').length,
      lengthM,
      windows,
    },
  };
}
