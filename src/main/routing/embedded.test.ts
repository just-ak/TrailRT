import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildConfig,
  embeddedPaths,
  embeddedState,
  graphPresent,
  readLoadedRegion,
  writeLoadedRegion,
} from './embedded';

/**
 * The embedded engine's presence checks and config generation.
 *
 * Deliberately does not load the addon: that needs 38 MB of dylibs and a built
 * graph, and `scripts/verify-valhalla.mjs` covers it under the real Electron
 * runtime where it belongs. What is tested here is the logic that decides
 * *whether* to load it, which is what the UI's state depends on.
 */

let dir: string;
let userData: string;
let resources: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-embedded-'));
  userData = join(dir, 'userData');
  resources = join(dir, 'resources');
  mkdirSync(join(resources, 'valhalla'), { recursive: true });
  mkdirSync(userData, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const paths = () => embeddedPaths(userData, resources);

const writeAddon = () =>
  writeFileSync(paths().addon, 'not a real addon', 'utf8');

const writeTemplate = (extra: Record<string, unknown> = {}) =>
  writeFileSync(
    paths().configTemplate,
    JSON.stringify({
      mjolnir: {
        tile_dir: '/PLACEHOLDER/tiles',
        tile_extract: '/data/valhalla/tiles.tar',
        traffic_extract: '/data/valhalla/traffic.tar',
        timezone: '/PLACEHOLDER/tz.sqlite',
        admin: '/PLACEHOLDER/admin.sqlite',
        ...extra,
      },
      service_limits: { auto: { max_distance: 5_000_000 } },
    }),
    'utf8',
  );

/** A graph is recognised by its hierarchy level directories. */
const writeGraph = () => {
  mkdirSync(join(paths().tileDir, '0'), { recursive: true });
  writeFileSync(join(paths().tileDir, '0', 'tile.gph'), 'x', 'utf8');
};

describe('embeddedState', () => {
  // A missing addon is a broken build; a missing graph is something the user
  // can fix. Collapsing them would send the user to the wrong place.
  it('reports a missing addon separately from missing map data', () => {
    const withoutAddon = embeddedState(paths());
    expect(withoutAddon.usable).toBe(false);
    if (withoutAddon.usable) return;
    expect(withoutAddon.reason).toBe('no-addon');
    expect(withoutAddon.message).toMatch(/build:valhalla/);

    writeAddon();
    const withoutGraph = embeddedState(paths());
    expect(withoutGraph.usable).toBe(false);
    if (withoutGraph.usable) return;
    expect(withoutGraph.reason).toBe('no-graph');
    expect(withoutGraph.message).toMatch(/Import an OpenStreetMap region/i);
  });

  it('is usable once both the addon and a graph are present', () => {
    writeAddon();
    writeGraph();
    expect(embeddedState(paths()).usable).toBe(true);
  });

  /*
   * valhalla_build_tiles creates its output directory before writing anything,
   * so an empty directory is what a cancelled or failed import leaves behind.
   * Treating it as a graph would produce a provider that claims to work and
   * then matches nothing.
   */
  it('does not treat an empty tile directory as a graph', () => {
    writeAddon();
    mkdirSync(paths().tileDir, { recursive: true });
    expect(graphPresent(paths())).toBe(false);
    expect(embeddedState(paths()).usable).toBe(false);
  });
});

describe('buildConfig', () => {
  it('points the config at this installation and drops the tar extracts', () => {
    writeTemplate();
    const config = JSON.parse(buildConfig(paths())) as {
      mjolnir: Record<string, unknown>;
      service_limits: unknown;
    };

    expect(config.mjolnir.tile_dir).toBe(paths().tileDir);
    // The generated template names a tiles.tar we never produce; leaving it
    // makes Valhalla log an error on every startup.
    expect(config.mjolnir.tile_extract).toBeUndefined();
    expect(config.mjolnir.traffic_extract).toBeUndefined();
    // Everything else from the generated template survives, which is the whole
    // reason for generating it rather than hand-writing one.
    expect(config.service_limits).toEqual({ auto: { max_distance: 5_000_000 } });
  });

  it('drops the optional databases when they were not built', () => {
    writeTemplate();
    const config = JSON.parse(buildConfig(paths())) as {
      mjolnir: Record<string, unknown>;
    };
    // Naming a timezone database that does not exist is a startup error for no
    // benefit; routing works without it.
    expect(config.mjolnir.timezone).toBeUndefined();
    expect(config.mjolnir.admin).toBeUndefined();
  });

  it('refuses when the template is missing rather than inventing one', () => {
    // Valhalla's config surface is large and its defaults affect costing. A
    // hand-rolled minimal config routes subtly wrongly and warns nobody.
    expect(() => buildConfig(paths())).toThrow(/configuration template/i);
  });
});

describe('readLoadedRegion', () => {
  const region = {
    regionName: 'liechtenstein',
    tileCount: 5,
    builtAt: 1_700_000_000_000,
    graphBytes: 4_600_000,
  };

  it('round-trips the region beside the graph', () => {
    writeGraph();
    writeLoadedRegion(paths(), region);
    expect(readLoadedRegion(paths())).toEqual(region);
  });

  /*
   * The label lives next to the graph precisely so it cannot outlive it. A user
   * who deletes the tile directory must not keep being told a region is
   * loaded.
   */
  it('reports nothing once the graph is gone', () => {
    writeGraph();
    writeLoadedRegion(paths(), region);
    rmSync(paths().tileDir, { recursive: true, force: true });
    expect(readLoadedRegion(paths())).toBeNull();
  });

  it('treats an unreadable region file as absent rather than failing', () => {
    writeGraph();
    mkdirSync(join(paths().regionFile, '..'), { recursive: true });
    writeFileSync(paths().regionFile, '{ not json', 'utf8');
    expect(readLoadedRegion(paths())).toBeNull();
  });
});
