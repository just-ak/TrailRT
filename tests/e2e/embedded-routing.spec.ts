import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { A515_TRACE, LOCAL_TEST_REGION, closedLoop } from '@fixtures/places';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
  editSelection,
  openTrip,
  tripAction } from './helpers';

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
 *
 * ## The graph has to cover the geography
 *
 * Everything here happens on the **A515 between Buxton and Ashbourne**, which
 * is the one leg of the test loop that stays inside a single county. So the
 * graph needs only the Geofabrik `derbyshire` extract — 44 MB, under a minute
 * to build. The A537 over the Cat and Fiddle would be the better road to
 * demonstrate snapping on, and it is what the live adapter tests use, but it
 * crosses into Cheshire and would turn the setup into a two-extract job for
 * no extra coverage.
 */

const ENGINE = join(process.cwd(), 'resources/valhalla/valhalla_node.node');
const TEST_GRAPH = join(homedir(), '.cache/trailrt-valhalla/work/tiles');

const enginePresent = existsSync(ENGINE);
const graphPresent = existsSync(TEST_GRAPH);

/**
 * Three points along the A515, as if drawn by hand on the map.
 *
 * Taken from the shared trace so they are on the carriageway: a snap that is
 * handed points in a field is testing the snapping radius, not the routing.
 */
function tracePoint(index: number): { lat: number; lon: number } {
  const point = A515_TRACE[index];
  if (point === undefined) {
    throw new Error(`the A515 trace has no point ${index}`);
  }
  return point;
}

const DRAWN: [
  { lat: number; lon: number },
  { lat: number; lon: number },
  { lat: number; lon: number },
] = [tracePoint(0), tracePoint(9), tracePoint(18)];

/**
 * The four corners, closed. Two of them are outside a Derbyshire-only graph,
 * which is the point — see the displacement test below.
 */
const LOOP = closedLoop().map((point) => ({
  lat: point.lat,
  lon: point.lon,
}));

let userDataDir: string;
let harness: Harness;

/**
 * Whether the seeded graph actually covers the test geography.
 *
 * Probed once after launch rather than assumed, because the graph is whatever
 * the developer last built. A graph for a different region loads fine and
 * reports itself available, then fails every route with "no path" — which
 * looks like a broken engine rather than a graph that does not contain
 * Derbyshire. Skipping with the reason is the honest outcome.
 */
let graphCoversGeography = false;

/** The message both the skip and the reader get. */
const WRONG_REGION =
  `the seeded graph does not cover the test geography — rebuild it from the ` +
  `Geofabrik "${LOCAL_TEST_REGION}" extract (see ADR 0013)`;

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
        regionName: LOCAL_TEST_REGION,
        tileCount: 5,
        builtAt: Date.now(),
        graphBytes: 44_000_000,
      }),
      'utf8',
    );

    harness = await launch(userDataDir);
    await createTripViaUi(harness.page, 'Embedded Routing Trip');

    // One cheap probe along the A515. If this cannot route, nothing that
    // follows can, and the reason is the graph rather than the code.
    graphCoversGeography = await harness.page.evaluate(async (drawn) => {
      const result = await window.trailrt.routing.routeLeg({
        from: drawn[0],
        to: drawn[1],
      });
      return result.ok && result.data.matched;
    }, DRAWN);

    if (!graphCoversGeography) {
      console.warn(`[embedded-routing] ${WRONG_REGION}`);
    }
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

    // Asserted against the same constant the setup wrote, so the two cannot
    // drift apart when the test extract changes.
    expect(region?.regionName).toBe(LOCAL_TEST_REGION);
    expect(region?.tileCount).toBeGreaterThan(0);
  });

  test('routes a single leg in-process', async () => {
    test.skip(!graphCoversGeography, WRONG_REGION);

    const leg = await harness.page.evaluate(async (drawn) => {
      const result = await window.trailrt.routing.routeLeg({
        from: drawn[0],
        to: drawn[1],
      });
      return result.ok ? result.data : null;
    }, DRAWN);

    expect(leg?.matched).toBe(true);
    // Road geometry, not the straight line between the two points.
    expect(leg?.shape.length ?? 0).toBeGreaterThan(2);
    expect(leg?.distanceM ?? 0).toBeGreaterThan(0);
  });

  test('snaps a drawn route onto roads and keeps the control points', async () => {
    test.skip(!graphCoversGeography, WRONG_REGION);

    const { page } = harness;

    const routeId = await page.evaluate(async (drawn) => {
      const trip = await window.trailrt.trips.list({});
      const tripId = trip.ok ? trip.data[0]?.id : undefined;
      if (tripId === undefined) return null;

      const created = await window.trailrt.routes.create({
        tripId,
        name: 'To snap',
        points: drawn,
      });
      return created.ok ? created.data.id : null;
    }, DRAWN);

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
    test.skip(!graphCoversGeography, WRONG_REGION);

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

  /**
   * The failure a screenshot caught, reproduced against the real engine.
   *
   * The loaded graph is Derbyshire only, and the four-corner loop reaches
   * Macclesfield (Cheshire) and Leek (Staffordshire). Valhalla does **not**
   * refuse those points: it snaps them to the nearest road it has — measured
   * at 3,111 m and 10,670 m away — routes to there, and reports success while
   * echoing the original coordinates back in `trip.locations`. The result was
   * a confident road route that went nowhere near two of the four towns, with
   * no warning anywhere.
   *
   * So the adapter measures the displacement itself and treats a badly moved
   * control point as an unmatched leg. See ADR 0016.
   */
  test('reports control points the graph cannot reach, and keeps them straight', async () => {
    test.skip(!graphCoversGeography, WRONG_REGION);

    const { page } = harness;

    const outcome = await page.evaluate(async (loop) => {
      const trip = await window.trailrt.trips.list({});
      const tripId = trip.ok ? trip.data[0]?.id : undefined;
      if (tripId === undefined) return null;

      const created = await window.trailrt.routes.create({
        tripId,
        name: 'Four corners',
        points: loop,
      });
      if (!created.ok) return null;

      const snapped = await window.trailrt.routing.snap({
        routeId: created.data.id,
      });
      if (!snapped.ok) return { error: snapped.error.message };

      const provenance = await window.trailrt.routing.provenance({
        routeId: created.data.id,
      });

      return {
        displaced: snapped.data.displaced,
        unmatchedLegs: snapped.data.unmatchedLegs,
        persisted: provenance.ok ? provenance.data.displaced : null,
      };
    }, LOOP);

    expect(outcome).not.toBeNull();
    if (outcome === null || 'error' in outcome) {
      throw new Error(`snap failed: ${outcome?.error ?? 'no result'}`);
    }

    // Macclesfield and Leek are outside Derbyshire, so both are reported.
    expect(outcome.displaced.length).toBeGreaterThanOrEqual(2);
    const worst = Math.max(
      ...outcome.displaced.map((entry) => entry.displacementM),
    );
    // Leek was measured at 10.7 km out. Asserting kilometres rather than the
    // exact figure: it depends on where Derbyshire's roads stop.
    expect(worst).toBeGreaterThan(2_000);

    // Every leg touching a displaced point stays a visible straight line
    // rather than a confident road route to the wrong place.
    expect(outcome.unmatchedLegs.length).toBeGreaterThanOrEqual(2);

    // And it survives a reload, because the route is wrong until re-snapped.
    expect(outcome.persisted?.length).toBe(outcome.displaced.length);
  });

  test('New Route follows roads when the engine is ready', async () => {
    const { page } = harness;

    // Following roads is the default (ADR 0018): no separate tool, no toggle.
    await expect(page.getByRole('button', { name: 'Snap routing' })).toHaveCount(0);

    await tripAction(page, 'Embedded Routing Trip', 'New Route');
    // The direct answer to "is the UI wired to the engine": the road tool,
    // not straight lines.
    await expect(page.getByText(/Click to extend along the roads/)).toBeVisible();
    await expect(page.getByText(/Straight lines/)).toHaveCount(0);

    await page.keyboard.press('Escape');
  });

  test('the properties panel names the engine, and offers snapping only to a straight route', async () => {
    test.skip(!graphCoversGeography, WRONG_REGION);

    const { page } = harness;

    // A route that does not follow roads, beside the one snapped above.
    await page.evaluate(async (drawn) => {
      const trip = await window.trailrt.trips.list({});
      const tripId = trip.ok ? trip.data[0]?.id : undefined;
      if (tripId === undefined) return;
      await window.trailrt.routes.create({ tripId, name: 'Still straight', points: drawn });
    }, DRAWN);
    await page.reload();
    await page.waitForSelector('[role="tree"]');

    // Routes are on their trip's page (Phase 14).
    await openTrip(page, 'Embedded Routing Trip');

    // Already following roads: it re-routes itself when edited, so there is no
    // button to press (ADR 0018).
    await page.getByRole('treeitem', { name: /To snap/ }).first().click();
    // The route's editor, behind the right panel's pencil (Phase 14).
    await editSelection(page);
    await expect(page.getByRole('button', { name: 'Route details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Follow roads' })).toHaveCount(0);

    // Looked up on selection with no button pressed: the engine is local, so
    // there is no consent to ask for. Phase 7 Requirement 6.
    await expect(
      page.getByRole('img', { name: /Share of distance by speed band/ }),
    ).toBeVisible({ timeout: 30_000 });

    // The engine and the provenance are in the Details popup.
    await page.getByRole('button', { name: 'Route details' }).click();
    const details = page.getByRole('dialog');
    await expect(details.getByText(/Built-in engine/i)).toBeVisible();
    await expect(details.getByText(/nothing is sent anywhere/i)).toBeVisible();
    await expect(details.getByText(/made with valhalla-embedded/)).toBeVisible();
    await details.getByRole('button', { name: 'Done' }).click();

    // Straight lines: the one place converting to roads is offered.
    await page.getByRole('treeitem', { name: /Still straight/ }).first().click();
    await expect(page.getByRole('button', { name: 'Follow roads' })).toBeEnabled();
  });
});

/** Unused in the skipped case, but keeps the import honest. */
export type { Page };
