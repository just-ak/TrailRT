import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Snapping against the **embedded** routing engine — ADR 0013.
 *
 * This is the test that answers "does the UI actually work with the engine we
 * built". Everything else about routing is exercised with a fake provider or
 * against the refusal path; this drives the real thing, in the real app, with a
 * real OpenStreetMap graph, and checks that geometry changes and speed limits
 * come back.
 *
 * ## Why it skips rather than fails when unprepared
 *
 * It needs two build artefacts that are not part of a plain checkout: the
 * compiled engine in `resources/valhalla` (`npm run build:valhalla`) and a test
 * graph. Failing without them would make a clean clone look broken, so the
 * suite reports the reason and skips. Run the prerequisites and it engages.
 */

const ENGINE = join(process.cwd(), 'resources/valhalla/valhalla_node.node');
const TEST_GRAPH = join(homedir(), '.cache/trailrt-valhalla/work/tiles');

const enginePresent = existsSync(ENGINE);
const graphPresent = existsSync(TEST_GRAPH);

/** Vaduz, inside the Liechtenstein test extract. */
const VADUZ = { lat: 47.1402, lon: 9.5222 };

let userDataDir: string;
let harness: Harness;

test.describe('embedded routing engine', () => {
  test.skip(
    !enginePresent,
    'engine not built — run "npm run build:valhalla" then "scripts/bundle-valhalla.sh"',
  );
  test.skip(
    !graphPresent,
    'no test graph — build one with valhalla_build_tiles (see ADR 0013)',
  );

  test.beforeAll(async () => {
    userDataDir = makeUserDataDir();

    /*
     * Seed a graph before launch.
     *
     * The app looks for one under its user-data directory, and the harness
     * gives every launch a fresh one, so without this the engine would
     * correctly report "no map data" and there would be nothing to snap
     * against.
     */
    const tileDir = join(userDataDir, 'valhalla', 'tiles');
    mkdirSync(join(userDataDir, 'valhalla'), { recursive: true });
    cpSync(TEST_GRAPH, tileDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'valhalla', 'region.json'),
      JSON.stringify({
        regionName: 'liechtenstein',
        tileCount: 5,
        builtAt: Date.now(),
        graphBytes: 4_600_000,
      }),
      'utf8',
    );

    harness = await launch(userDataDir);
    await createTripViaUi(harness.page, 'Embedded Routing Trip');
  });

  test.afterAll(async () => {
    await close(harness);
    cleanup(userDataDir);
  });

  test('reports itself available with no endpoint and no consent', async () => {
    const status = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });

    expect(status?.available).toBe(true);
    expect(status?.kind).toBe('embedded');
    expect(status?.providerId).toBe('valhalla-embedded');
    expect(status?.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);

    // The whole point of embedding it: no host, so nothing to consent to and
    // nothing to allowlist.
    expect(status?.origin).toBeNull();
    expect(status?.reason).toBe('available');

    const settings = await harness.page.evaluate(async () => {
      const result = await window.trailrt.settings.all();
      return result.ok ? result.data : null;
    });
    expect(settings?.routingEndpoint).toBe('');
    expect(settings?.routingConsentAccepted).toBe(false);
  });

  test('names the loaded region', async () => {
    const region = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.region();
      return result.ok ? result.data : null;
    });

    expect(region?.regionName).toBe('liechtenstein');
    expect(region?.tileCount).toBeGreaterThan(0);
  });

  test('routes a single leg in-process', async () => {
    const leg = await harness.page.evaluate(async (vaduz) => {
      const result = await window.trailrt.routing.routeLeg({
        from: { lat: 47.1385, lon: 9.5215 },
        to: { lat: vaduz.lat + 0.004, lon: vaduz.lon + 0.002 },
      });
      return result.ok ? result.data : null;
    }, VADUZ);

    expect(leg?.matched).toBe(true);
    // Road geometry, not the straight line between the two points.
    expect(leg?.shape.length ?? 0).toBeGreaterThan(2);
    expect(leg?.distanceM ?? 0).toBeGreaterThan(0);
  });

  test('snaps a drawn route onto roads and keeps the control points', async () => {
    const { page } = harness;

    const routeId = await page.evaluate(async (vaduz) => {
      const trip = await window.trailrt.trips.list({});
      const tripId = trip.ok ? trip.data[0]?.id : undefined;
      if (tripId === undefined) return null;

      // Three points roughly along a road, as if drawn by hand.
      const created = await window.trailrt.routes.create({
        tripId,
        name: 'To snap',
        points: [
          { lat: 47.1385, lon: 9.5215 },
          { lat: vaduz.lat, lon: vaduz.lon },
          { lat: 47.144, lon: 9.524 },
        ],
      });
      return created.ok ? created.data.id : null;
    }, VADUZ);

    expect(routeId).not.toBeNull();
    if (routeId === null) return;

    const outcome = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.snap({ routeId: id });
      return result.ok ? result.data : { error: result.error.message };
    }, routeId);

    expect(outcome).not.toHaveProperty('error');
    if ('error' in outcome) return;

    // Road geometry has far more vertices than the three points drawn.
    expect(outcome.pointCount).toBeGreaterThan(10);
    expect(outcome.unmatchedLegs).toEqual([]);

    const provenance = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.provenance({ routeId: id });
      return result.ok ? result.data : null;
    }, routeId);

    expect(provenance?.routingProvider).toBe('valhalla-embedded');
    // The points the user placed survive, so the route can be re-snapped in a
    // different mode without being redrawn.
    expect(provenance?.controlPointCount).toBe(3);
  });

  test('returns posted speed limits from the local graph', async () => {
    const { page } = harness;

    const routeId = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      return list.ok ? (list.data[0]?.id ?? null) : null;
    });
    if (routeId === null) return;

    const status = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.match({
        ownerType: 'route',
        ownerId: id,
      });
      return result.ok ? result.data : { error: result.error.message };
    }, routeId);

    expect(status).not.toHaveProperty('error');
    if ('error' in status) return;
    expect(status.edgeCount).toBeGreaterThan(0);

    const distribution = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.speedDistribution({
        ownerType: 'route',
        ownerId: id,
        source: 'posted',
      });
      return result.ok ? result.data : null;
    }, routeId);

    expect(distribution).not.toBeNull();
    // The requirement this whole exercise existed for: real posted limits off
    // a local graph, not an all-Unknown distribution.
    expect(distribution?.distribution.allUnknown).toBe(false);
    const known = (distribution?.distribution.bands ?? []).filter(
      (band) => band.percent > 0,
    );
    expect(known.length).toBeGreaterThan(0);
  });

  test('the snap tool is enabled in the toolbar', async () => {
    const tool = harness.page.getByRole('button', { name: 'Snap routing' });

    await expect(tool).toBeVisible();
    // The direct answer to "is the UI wired to the engine": with the engine
    // ready and no endpoint configured, the tool is usable.
    await expect(tool).toBeEnabled();
  });

  test('the properties panel offers snapping and names the engine', async () => {
    const { page } = harness;

    // Routes are children of their trip, so the trip has to be expanded
    // before the route exists as a tree row to click.
    await page
      .getByRole('treeitem', { name: 'Embedded Routing Trip' })
      .dblclick();
    await page
      .getByRole('treeitem', { name: /To snap/ })
      .first()
      .click();

    await expect(page.getByText(/Built-in engine/i)).toBeVisible();
    await expect(page.getByText(/nothing is sent anywhere/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Snap to roads' }),
    ).toBeEnabled();
  });
});

/** Unused in the skipped case, but keeps the import honest. */
export type { Page };
