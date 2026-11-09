import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { A515_TRACE, LOCAL_TEST_REGION } from '@fixtures/places';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Phase 6 end to end: routes on offer, choosing one, shaping, undo, restart.
 *
 * Driven through the UI against the **embedded** engine, because the feature
 * is an interaction — a candidate list, a drag on the line — and a fake
 * provider would test none of the parts that can go wrong. Same prerequisites
 * and the same skip-with-a-reason rule as `embedded-routing.spec.ts`.
 *
 * The geography is Buxton → Ashbourne along the A515, the one leg of the test
 * square inside the Derbyshire extract (ADR 0015). Measured live, the engine
 * offers three routes for it.
 */

const ENGINE = join(process.cwd(), 'resources/valhalla/valhalla_node.node');
const TEST_GRAPH = join(homedir(), '.cache/trailrt-valhalla/work/tiles');

const START = A515_TRACE[0] as { lat: number; lon: number };
const END = A515_TRACE[A515_TRACE.length - 1] as { lat: number; lon: number };
const VIEW = {
  lat: Number(((START.lat + END.lat) / 2).toFixed(6)),
  lon: Number(((START.lon + END.lon) / 2).toFixed(6)),
  zoom: 11,
};
const TRIP = 'Shaping Trip';

let userDataDir: string;
let harness: Harness;

/**
 * Screen position of a coordinate, by the Web Mercator projection Leaflet
 * uses, relative to the map centre — which is `VIEW`, set before the map was
 * created, so nothing has to be read back from Leaflet itself.
 */
async function pixelOf(page: Page, at: { lat: number; lon: number }): Promise<{ x: number; y: number }> {
  const box = await page.locator('.leaflet-container').boundingBox();
  if (box === null) throw new Error('no map');
  const scale = 256 * 2 ** VIEW.zoom;
  const project = (p: { lat: number; lon: number }) => {
    const sin = Math.sin((p.lat * Math.PI) / 180);
    return {
      x: (scale * (p.lon + 180)) / 360,
      y: scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
    };
  };
  const centre = project(VIEW);
  const point = project(at);
  return {
    x: box.x + box.width / 2 + (point.x - centre.x),
    y: box.y + box.height / 2 + (point.y - centre.y),
  };
}

async function routeState(page: Page) {
  return page.evaluate(async () => {
    const list = await window.trailrt.routes.listAll();
    const route = list.ok ? list.data[0] : undefined;
    if (route === undefined) return null;
    const [provenance, full] = await Promise.all([
      window.trailrt.routing.provenance({ routeId: route.id }),
      window.trailrt.routes.get({ id: route.id }),
    ]);
    return {
      id: route.id,
      control: provenance.ok ? provenance.data.controlPoints : [],
      points: full.ok ? full.data.points.map((p) => [p.lat, p.lon]) : [],
    };
  });
}

test.describe('route alternatives and shaping', () => {
  test.skip(!existsSync(ENGINE), 'engine not built — run "npm run build:valhalla"');
  test.skip(!existsSync(TEST_GRAPH), 'no test graph — see ADR 0013');

  test.beforeAll(async () => {
    userDataDir = makeUserDataDir();
    const tileDir = join(userDataDir, 'valhalla', 'tiles');
    mkdirSync(join(userDataDir, 'valhalla'), { recursive: true });
    cpSync(TEST_GRAPH, tileDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'valhalla', 'region.json'),
      JSON.stringify({ regionName: LOCAL_TEST_REGION, tileCount: 5, builtAt: Date.now(), graphBytes: 0 }),
      'utf8',
    );

    harness = await launch(userDataDir);
    await createTripViaUi(harness.page, TRIP);
    // Centre the map on the A515 before the map is created, so coordinates
    // can be turned into clicks without asking Leaflet.
    await harness.page.evaluate(
      (view) => window.trailrt.settings.set({ key: 'mapPosition', value: view }),
      VIEW,
    );
    await harness.page.reload();
    await harness.page.waitForSelector('[role="tree"]');
    await harness.page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
  });

  test.afterAll(async () => {
    await close(harness);
    cleanup(userDataDir);
  });

  test('offers the routes on offer between two places, and saves the one chosen', async () => {
    const { page } = harness;

    // Following roads is the default (ADR 0018): New Route is the tool.
    await page.getByRole('button', { name: 'New Route', exact: true }).click();
    for (const at of [START, END]) {
      const { x, y } = await pixelOf(page, at);
      await page.mouse.click(x, y);
    }

    const list = page.getByRole('group', { name: 'Routes on offer for this section' });
    await expect(list).toBeVisible({ timeout: 20_000 });
    const options = list.getByRole('radio');
    expect(await options.count()).toBeGreaterThanOrEqual(2);
    await expect(list.getByText(/\(est\.\)/).first()).toBeVisible();

    // Choose B from the keyboard, then finish.
    await page.keyboard.press('2');
    await expect(options.nth(1)).toBeChecked();
    await page.keyboard.press('Enter');

    await expect
      .poll(async () => (await routeState(page))?.control.length ?? 0, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
    const saved = await routeState(page);
    // B was pinned with shaping points between the two via points.
    expect(saved?.control[0]?.role).toBe('via');
    expect(saved?.control.at(-1)?.role).toBe('via');
    expect(saved?.control.slice(1, -1).every((c) => c.role === 'shaping')).toBe(true);
    expect(saved?.control.every((c) => c.shapeIndex !== null)).toBe(true);
  });

  test('dragging the line adds a shaping point, and undo puts the route back', async () => {
    const { page } = harness;
    const before = await routeState(page);
    if (before === null) throw new Error('no route');

    // Grab the line a third of the way along and pull it sideways.
    const grab = before.points[Math.floor(before.points.length / 3)] as [number, number];
    const from = await pixelOf(page, { lat: grab[0], lon: grab[1] });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(from.x + i * 6, from.y + i * 4);
    await page.mouse.up();

    await expect
      .poll(async () => (await routeState(page))?.control.length ?? 0, { timeout: 20_000 })
      .toBe(before.control.length + 1);

    // One undo entry for the whole drag.
    await page.evaluate(() => window.trailrt.undo.undo());
    const after = await routeState(page);
    expect(after?.control).toEqual(before.control);
    expect(after?.points).toEqual(before.points);
  });

  test('shaping points survive a restart', async () => {
    const before = await routeState(harness.page);
    await close(harness);
    harness = await launch(userDataDir);
    const after = await routeState(harness.page);
    expect(after?.control).toEqual(before?.control);
  });
});
