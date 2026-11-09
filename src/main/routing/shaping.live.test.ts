import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { A515_TRACE, ASHBOURNE, BUXTON } from '@fixtures/places';
import type { LatLon } from '@shared/geo/distance';
import { overlap } from '@shared/geo/divergence';
import { reversalAt } from '@shared/geo/reversal';
import { pinCandidate } from '@shared/routing/pin';
import type { RoutingProvider, SectionLocation } from '@shared/routing/RoutingProvider';
import { flattenLegsWithBoundaries } from '@shared/routing/splice';
import { createEmbeddedProvider, embeddedPaths } from './embedded';

/**
 * Phase 6 against the real built-in engine. Task 14.
 *
 * Skipped unless `TRAILRT_LIVE_EMBEDDED` names the application's user-data
 * directory (or is `1` for the macOS default), so the normal suite never needs
 * a routing graph:
 *
 *   TRAILRT_LIVE_EMBEDDED=1 npx vitest run src/main/routing/shaping.live.test.ts
 *
 * The geography is Buxton → Ashbourne, the eastern leg of the test square
 * (ADR 0015), because it lies inside the Derbyshire extract this machine has
 * loaded. The spec named Buxton → Macclesfield; Macclesfield is in Cheshire,
 * outside that graph, and ADR 0016 records what routing there does — the
 * engine drags the end three kilometres to the county boundary. Against a
 * graph that covers Cheshire, set `TRAILRT_LIVE_PAIR=macclesfield`.
 */

const setting = process.env.TRAILRT_LIVE_EMBEDDED;
const userData =
  setting === '1' ? join(homedir(), 'Library/Application Support/trailrt') : (setting ?? '');

const FROM: LatLon = { lat: BUXTON.lat, lon: BUXTON.lon };
const TO: LatLon =
  process.env.TRAILRT_LIVE_PAIR === 'macclesfield'
    ? { lat: 53.2602, lon: -2.1255 }
    : { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon };

const join2 = async (provider: RoutingProvider, section: SectionLocation[]): Promise<LatLon[]> => {
  const result = await (provider.snapSection ?? (() => Promise.reject(new Error('no sections'))))(
    section,
    'auto',
  );
  return flattenLegsWithBoundaries(result.legs).points;
};

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

describe.runIf(setting !== undefined && setting.length > 0)(
  'Phase 6 on the embedded engine',
  () => {
    const provider = createEmbeddedProvider(embeddedPaths(userData, resolve('resources')));

    it('offers more than one route between Buxton and the other end', async () => {
      const candidates = (await provider.alternatives?.(FROM, TO, 'auto', 3)) ?? [];
      console.info(
        `[live] ${candidates.length} candidates:`,
        candidates.map((c) => `${((c.distanceM ?? 0) / 1000).toFixed(1)} km / ${Math.round((c.estimatedDurationS ?? 0) / 60)} min`),
      );
      expect(candidates.length).toBeGreaterThanOrEqual(2);
      // Each a real road route that starts and ends where it was asked to.
      for (const c of candidates) {
        expect(c.shape.length).toBeGreaterThan(50);
        expect(c.startDisplacementM).toBeLessThan(250);
        expect(c.endDisplacementM).toBeLessThan(250);
      }
    }, 60_000);

    it('choosing the non-preferred route and re-routing reproduces it', async () => {
      const candidates = (await provider.alternatives?.(FROM, TO, 'auto', 3)) ?? [];
      const [preferred, chosen] = candidates;
      if (preferred === undefined || chosen === undefined) throw new Error('needs two candidates');

      const pinned = await pinCandidate(chosen.shape, preferred.shape, (section) =>
        join2(provider, section),
      );
      const rerouted = await join2(provider, [
        { point: FROM, passThrough: false },
        ...pinned.shaping.map((point) => ({ point, passThrough: true })),
        { point: TO, passThrough: false },
      ]);
      const agreement = overlap(chosen.shape, rerouted);
      console.info(
        `[live] pinned with ${pinned.shaping.length} shaping point(s); verified=${pinned.verified}; overlap ${agreement.toFixed(3)}`,
      );
      expect(pinned.verified).toBe(true);
      expect(agreement).toBeGreaterThanOrEqual(0.98);
      // And it is genuinely not the preferred route.
      expect(overlap(rerouted, preferred.shape)).toBeLessThan(0.98);
    }, 120_000);

    it('a shaping point on the A515 bends the route without turning it round', async () => {
      const onA515 = A515_TRACE[Math.floor(A515_TRACE.length / 2)] as LatLon;
      const result = await provider.snapSection?.(
        [
          { point: FROM, passThrough: false },
          { point: onA515, passThrough: true },
          { point: TO, passThrough: false },
        ],
        'auto',
      );
      const { points, boundaries } = flattenLegsWithBoundaries(result?.legs ?? []);
      expect(result?.legs).toHaveLength(2);
      expect(reversalAt(points, boundaries[1] as number)).toBe(false);
    }, 60_000);

    it('drag previews meet the latency target (Requirement 9.4)', async () => {
      // A pointer sweeping across the leg's midpoint, as a drag would.
      const mid = A515_TRACE[Math.floor(A515_TRACE.length / 2)] as LatLon;
      const timings: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        const at = { lat: mid.lat + (i - 10) * 0.0008, lon: mid.lon + (i - 10) * 0.0012 };
        const started = performance.now();
        // eslint-disable-next-line no-await-in-loop
        await provider.snapSection?.(
          [
            { point: FROM, passThrough: false },
            { point: at, passThrough: true },
            { point: TO, passThrough: false },
          ],
          'auto',
        );
        timings.push(performance.now() - started);
      }
      const p50 = median(timings);
      console.info(
        `[live] drag preview over ${timings.length} positions: median ${p50.toFixed(0)} ms, max ${Math.max(...timings).toFixed(0)} ms`,
      );
      expect(p50).toBeLessThanOrEqual(300);
    }, 120_000);
  },
);
