import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '../services/errors';
import type { TerrainStore } from '../terrain/terrainStore';
import { embeddedPaths, type EmbeddedPaths } from './embedded';
import { downloadAndBuild, resetCatalogue, type BuildSteps } from './regionCatalogue';

/**
 * The multi-region build, with every step replaced by a fake: no network, no
 * child processes, no tile builder. What is under test is the orchestration —
 * what is refused before downloading, when the merge runs, and that nothing is
 * left behind.
 */

const county = (id: string, name: string, minLon: number, minLat: number) => ({
  type: 'Feature',
  properties: {
    id,
    name,
    parent: 'england',
    urls: { pbf: `https://download.geofabrik.de/europe/united-kingdom/england/${id}-latest.osm.pbf` },
  },
  geometry: {
    type: 'MultiPolygon',
    coordinates: [[[
      [minLon, minLat],
      [minLon + 0.8, minLat],
      [minLon + 0.8, minLat + 0.8],
      [minLon, minLat + 0.8],
      [minLon, minLat],
    ]]],
  },
});

let dir: string;
let paths: EmbeddedPaths;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-regions-'));
  paths = embeddedPaths(join(dir, 'user'), join(dir, 'resources'));
  mkdirSync(join(paths.indexFile, '..'), { recursive: true });
  // A fresh cached index, which `loadCatalogue` reads before the network.
  writeFileSync(
    paths.indexFile,
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        county('derbyshire', 'Derbyshire', -2.0, 52.7),
        county('cheshire', 'Cheshire', -3.0, 52.9),
        county('staffordshire', 'Staffordshire', -2.4, 52.4),
      ],
    }),
  );
  resetCatalogue();
});

afterEach(() => {
  resetCatalogue();
  rmSync(dir, { recursive: true, force: true });
});

interface Calls {
  downloads: string[];
  merges: string[][];
  builtFrom: string[];
  /** Phase 10: what the place build was given. */
  places: { sources: string[]; extract: string; regions: string[]; ringCount: number }[];
}

function fakeSteps(
  calls: Calls,
  overrides: Partial<BuildSteps> = {},
): Partial<BuildSteps> {
  return {
    size: async () => 40 * 1024 * 1024,
    download: async (url, destination) => {
      calls.downloads.push(url);
      writeFileSync(destination, 'pbf');
      return 3;
    },
    merge: async (_tool, inputs, output) => {
      calls.merges.push([...inputs]);
      writeFileSync(output, 'merged');
    },
    build: async ({ extractPath }) => {
      calls.builtFrom.push(extractPath);
      return { regionName: 'ignored', tileCount: 40, builtAt: 1, graphBytes: 2 };
    },
    mergeAvailable: () => true,
    places: async (input) => {
      calls.places.push({
        sources: [...input.sources],
        extract: input.extract,
        regions: input.regions.map((r) => r.name),
        ringCount: input.regions.reduce((n, r) => n + r.rings.length, 0),
      });
      return null;
    },
    ...overrides,
  };
}

const newCalls = (): Calls => ({ downloads: [], merges: [], builtFrom: [], places: [] });

describe('downloadAndBuild', () => {
  it('builds a single region directly, with no merge', async () => {
    const calls = newCalls();
    const region = await downloadAndBuild(paths, ['derbyshire'], { steps: fakeSteps(calls) });
    expect(calls.merges).toEqual([]);
    expect(calls.builtFrom).toEqual([join(paths.downloadDir, 'derbyshire.osm.pbf')]);
    expect(region.regionIds).toEqual(['derbyshire']);
    expect(region.regionName).toBe('Derbyshire');
  });

  it('merges several regions into one file and builds that', async () => {
    const calls = newCalls();
    const progress: string[] = [];
    const region = await downloadAndBuild(paths, ['derbyshire', 'cheshire', 'staffordshire'], {
      steps: fakeSteps(calls),
      onProgress: (p) => progress.push(p.phase),
    });
    expect(calls.downloads).toHaveLength(3);
    expect(calls.merges).toEqual([
      ['derbyshire', 'cheshire', 'staffordshire'].map((id) =>
        join(paths.downloadDir, `${id}.osm.pbf`),
      ),
    ]);
    expect(calls.builtFrom).toEqual([join(paths.downloadDir, 'merged.osm.pbf')]);
    expect(region.regionName).toBe('Derbyshire, Cheshire and Staffordshire');
    // 'building' is the place step's "Reading places"; the fake graph build reports nothing.
    expect(new Set(progress)).toEqual(new Set(['downloading', 'merging', 'building']));
  });

  it('builds place data from the merged file, dated from the source extracts', async () => {
    const calls = newCalls();
    const region = await downloadAndBuild(paths, ['derbyshire', 'cheshire'], { steps: fakeSteps(calls) });
    expect(calls.places).toEqual([
      {
        // The merge drops the PBF timestamp, so the date is read from these.
        sources: ['derbyshire', 'cheshire'].map((id) => join(paths.downloadDir, `${id}.osm.pbf`)),
        extract: join(paths.downloadDir, 'merged.osm.pbf'),
        regions: ['Derbyshire', 'Cheshire'],
        ringCount: 2,
      },
    ]);
    expect(region.placesWarning).toBeNull();
  });

  it('reports a place failure as a warning and still returns the graph', async () => {
    const calls = newCalls();
    const region = await downloadAndBuild(paths, ['derbyshire'], {
      steps: fakeSteps(calls, { places: async () => 'Routing is ready, but place data could not be built.' }),
    });
    expect(region.tileCount).toBe(40);
    expect(region.placesWarning).toMatch(/place data could not be built/);
  });

  it('refuses several regions when this build has no merge tool', async () => {
    const calls = newCalls();
    await expect(
      downloadAndBuild(paths, ['derbyshire', 'cheshire'], {
        steps: fakeSteps(calls, { mergeAvailable: () => false }),
      }),
    ).rejects.toThrow(/cannot combine regions/i);
    expect(calls.downloads).toEqual([]);
  });

  it('refuses a selection over the build limit before downloading anything', async () => {
    const calls = newCalls();
    await expect(
      downloadAndBuild(paths, ['derbyshire', 'cheshire'], {
        steps: fakeSteps(calls, { size: async () => 1.5 * 1024 ** 3 }),
      }),
    ).rejects.toThrow(/choose fewer regions/i);
    expect(calls.downloads).toEqual([]);
  });

  it('names a region that is not in the index', async () => {
    await expect(
      downloadAndBuild(paths, ['derbyshire', 'atlantis'], { steps: fakeSteps(newCalls()) }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('removes every extract and the merged file, even when the build fails', async () => {
    const calls = newCalls();
    await expect(
      downloadAndBuild(paths, ['derbyshire', 'cheshire'], {
        steps: fakeSteps(calls, {
          build: async () => {
            throw new ServiceError('PROVIDER_ERROR', 'boom');
          },
        }),
      }),
    ).rejects.toThrow('boom');
    for (const file of ['derbyshire.osm.pbf', 'cheshire.osm.pbf', 'merged.osm.pbf']) {
      expect(existsSync(join(paths.downloadDir, file)), file).toBe(false);
    }
  });

  it('fetches terrain for the regions and reports a failure without failing the build', async () => {
    const asked: string[][] = [];
    const terrain: TerrainStore = {
      elevations: () => ({ values: [], missingTiles: [] }),
      missing: (names) => [...names],
      download: async (names) => {
        asked.push([...names]);
        return { downloaded: [], sea: [], failed: [...names] };
      },
    };
    const region = await downloadAndBuild(paths, ['derbyshire'], {
      steps: fakeSteps(newCalls()),
      terrain,
    });
    // The fake Derbyshire spans -2.0..-1.2 lon, one tile column, and
    // 52.7..53.5 lat, two rows.
    expect(asked[0]?.toSorted()).toEqual(['N52W002', 'N53W002']);
    expect(region.terrainWarning).toMatch(/2 of 2 terrain tiles/);
    expect(region.tileCount).toBe(40);
  });
});
