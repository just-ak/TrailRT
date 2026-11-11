import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ASHBOURNE,
  BUXTON,
  closedLoop,
  LEGS,
  REFERENCE_ROADS,
  TOWNS,
} from '@fixtures/places';
import { haversineDistance, type LatLon } from '@shared/geo/distance';
import { twistiness, type Twistiness } from '@shared/geo/twistiness';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import { flattenLegsWithBoundaries } from '@shared/routing/splice';
import { createTerrainStore } from '../terrain/terrainStore';
import { createEmbeddedProvider, embeddedPaths, mergeToolPresent } from './embedded';
import { downloadAndBuild, resetCatalogue } from './regionCatalogue';

/**
 * Phase 7 against real data. Task 12.
 *
 * Downloads Derbyshire, Cheshire and Staffordshire from Geofabrik (about
 * 110 MB), merges them with the bundled `osmium`, builds one graph, and routes
 * on it. Then scores real roads for twistiness and samples real terrain. Every
 * one of these is a claim a synthetic test cannot make.
 *
 * Opt-in, because it downloads:
 *
 *   npm run verify:regions
 *
 * Builds into a temporary directory, so the app's own graph is untouched.
 */

const enabled = (process.env.TRAILRT_LIVE_REGIONS ?? '').length > 0;

const COUNTIES = ['derbyshire', 'cheshire', 'staffordshire'];

const toLatLon = (p: { lat: number; lon: number }): LatLon => ({ lat: p.lat, lon: p.lon });

describe.runIf(enabled)('Phase 7 on real regions', () => {
  let dir = '';
  let provider: RoutingProvider;
  let paths: ReturnType<typeof embeddedPaths>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'trailrt-live-regions-'));
    paths = embeddedPaths(dir, resolve('resources'));
    resetCatalogue();
    if (!mergeToolPresent(paths)) {
      throw new Error('resources/valhalla/bin/osmium is missing — run scripts/bundle-valhalla.sh');
    }

    const started = Date.now();
    const region = await downloadAndBuild(paths, COUNTIES, {
      terrain: createTerrainStore(paths.terrainDir),
    });
    console.info(
      `[live] built "${region.regionName}": ${region.tileCount} tiles, ${(region.graphBytes / 1e6).toFixed(0)} MB, ${((Date.now() - started) / 1000).toFixed(0)} s` +
        (region.terrainWarning ? ` — ${region.terrainWarning}` : ''),
    );
    expect(region.regionIds).toEqual(COUNTIES);
    provider = createEmbeddedProvider(paths);
  }, 15 * 60_000);

  afterAll(() => {
    if (dir.length > 0) rmSync(dir, { recursive: true, force: true });
  });

  it('routes the whole Buxton square across all three counties', async () => {
    const loop = closedLoop().map(toLatLon);
    const result = await provider.snap(loop, 'auto');
    const km = result.legs.reduce((sum, leg) => sum + (leg.distanceM ?? 0), 0) / 1000;
    console.info(`[live] Buxton square: ${km.toFixed(1)} km in ${result.legs.length} legs`);

    expect(result.legs).toHaveLength(4);
    expect(result.unmatchedLegs).toEqual([]);
    // Before this phase, Macclesfield and Leek were dragged 3 and 10 km to
    // Derbyshire's edge (ADR 0016). On the merged graph they are on a road.
    expect(result.displaced).toEqual([]);
    expect(km).toBeGreaterThan(80);
    expect(km).toBeLessThan(130);
  }, 120_000);

  /** Routes through the given points and scores the result. */
  const scoreOf = async (points: LatLon[]): Promise<{ shape: LatLon[]; t: Twistiness }> => {
    const result = await provider.snap(points, 'auto');
    const shape = flattenLegsWithBoundaries(result.legs).points;
    const scored = twistiness(shape);
    if (!scored.known) throw new Error(`unscorable: ${scored.reason}`);
    return { shape, t: scored.twistiness };
  };

  it('ranks real roads by twistiness the way a rider would', async () => {
    const legOf = (label: string) => {
      const leg = LEGS.find((l) => l.label === label);
      if (leg === undefined) throw new Error(`no leg ${label}`);
      return [TOWNS[leg.from], ...leg.via, TOWNS[leg.to]].map(toLatLon);
    };

    const cat = await scoreOf(legOf('Cat and Fiddle'));
    const a523 = await scoreOf(legOf('Macclesfield to Leek'));
    const a515 = await scoreOf([toLatLon(ASHBOURNE), toLatLon(BUXTON)]);

    const snakeRoad = REFERENCE_ROADS.snakePass;
    const snake = await scoreOf([toLatLon(snakeRoad.from), toLatLon(snakeRoad.to)]);
    const m6Road = REFERENCE_ROADS.m6;
    const m6 = await scoreOf([toLatLon(m6Road.from), toLatLon(m6Road.to)]);

    // Corridor checks, so a route that took another road fails here rather
    // than producing a plausible score for the wrong geometry (ADR 0015).
    const passes = snakeRoad.passes;
    if (passes === undefined) throw new Error('Snake Pass needs its corridor point');
    const nearest = Math.min(...snake.shape.map((p) => haversineDistance(p, passes)));
    expect(nearest, 'Snake Pass route should pass the Snake Pass Inn').toBeLessThan(200);

    const matched = await provider.match(m6.shape, 'auto');
    const motorwayM = matched.edges
      .filter((e) => e.roadClass === 'motorway')
      .reduce((sum, e) => sum + (e.lengthM ?? 0), 0);
    const allM = matched.edges.reduce((sum, e) => sum + (e.lengthM ?? 0), 0);
    expect(motorwayM / allM, 'M6 route should be mostly motorway').toBeGreaterThan(0.8);

    const rows = { cat, snake, a523, a515, m6 };
    for (const [name, { t }] of Object.entries(rows)) {
      console.info(
        `[live] ${name.padEnd(6)} ${t.score.toFixed(1)} ${t.label.padEnd(11)} ${Math.round(t.degPerKm)}°/km ${t.bendsPerKm.toFixed(2)} bends/km, ${t.tightCount} tight, ${t.hairpinCount} hairpins`,
      );
    }

    expect(cat.t.score).toBeGreaterThan(snake.t.score);
    expect(snake.t.score).toBeGreaterThan(a515.t.score);
    for (const other of [cat, snake, a523, a515]) {
      expect(m6.t.score).toBeLessThan(other.t.score);
    }
    expect(['twisty', 'very-twisty']).toContain(cat.t.level);
    expect(m6.t.level).toBe('straight');
  }, 180_000);

  it('samples real terrain at the test towns', () => {
    const terrain = createTerrainStore(paths.terrainDir);
    const { values, missingTiles } = terrain.elevations([BUXTON, ASHBOURNE]);
    console.info(`[live] terrain: Buxton ${values[0]?.toFixed(0)} m, Ashbourne ${values[1]?.toFixed(0)} m`);
    expect(missingTiles).toEqual([]);
    expect(Math.abs((values[0] ?? 0) - BUXTON.eleM)).toBeLessThan(15);
    expect(Math.abs((values[1] ?? 0) - ASHBOURNE.eleM)).toBeLessThan(15);
  });
});
