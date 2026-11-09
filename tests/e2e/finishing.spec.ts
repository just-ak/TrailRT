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
 * Finishing a new route, every way a user can start and finish one.
 *
 * Regression for "Enter or double-click does not finish the route", reported
 * after Phase 7 made New Route the road-following tool. Two separate causes:
 *
 * 1. Keeping route A in the alternatives list stored the candidate object as
 *    the leg, duration estimate included, and the strict leg schema refused
 *    the save ("That request was not valid"). Phase 6's test only ever chose
 *    route B, whose leg is rebuilt, so it never saw this.
 * 2. The first click of a double-click puts a point handle under the pointer,
 *    so the `dblclick` landed on the handle and the map never heard it.
 *
 * Needs the embedded engine and the Derbyshire test graph, like the shaping
 * spec; skipped without them.
 */

const ENGINE = join(process.cwd(), 'resources/valhalla/valhalla_node.node');
const TEST_GRAPH = join(homedir(), '.cache/trailrt-valhalla/work/tiles');

const TRACE = A515_TRACE as readonly { lat: number; lon: number }[];
const at = (i: number) => TRACE[i] as { lat: number; lon: number };
const VIEW = {
  lat: Number(((at(0).lat + at(TRACE.length - 1).lat) / 2).toFixed(6)),
  lon: Number(((at(0).lon + at(TRACE.length - 1).lon) / 2).toFixed(6)),
  zoom: 11,
};
const TRIP = 'Finishing Trip';

let userDataDir: string;
let harness: Harness;

async function pixelOf(page: Page, point: { lat: number; lon: number }) {
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
  const target = project(point);
  return {
    x: box.x + box.width / 2 + (target.x - centre.x),
    y: box.y + box.height / 2 + (target.y - centre.y),
  };
}

const routeCount = (page: Page) =>
  page.evaluate(async () => {
    const list = await window.trailrt.routes.listAll();
    return list.ok ? list.data.length : -1;
  });

async function clickAt(page: Page, index: number): Promise<void> {
  const { x, y } = await pixelOf(page, at(index));
  await page.mouse.click(x, y);
}

/** Starts New Route from the trip's properties panel. */
async function newRoute(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
  await page.getByRole('button', { name: 'New Route', exact: true }).click();
  await expect(page.getByText(/Click to extend along the roads/)).toBeVisible();
}

test.describe('finishing a new route', () => {
  test.skip(!existsSync(ENGINE), 'engine not built — run "npm run build:valhalla"');
  test.skip(!existsSync(TEST_GRAPH), 'no test graph — see ADR 0013');

  test.beforeAll(async () => {
    userDataDir = makeUserDataDir();
    mkdirSync(join(userDataDir, 'valhalla'), { recursive: true });
    cpSync(TEST_GRAPH, join(userDataDir, 'valhalla', 'tiles'), { recursive: true });
    writeFileSync(
      join(userDataDir, 'valhalla', 'region.json'),
      JSON.stringify({ regionName: LOCAL_TEST_REGION, tileCount: 5, builtAt: Date.now(), graphBytes: 0 }),
      'utf8',
    );
    harness = await launch(userDataDir);
    await createTripViaUi(harness.page, TRIP);
    await harness.page.evaluate(
      (view) => window.trailrt.settings.set({ key: 'mapPosition', value: view }),
      VIEW,
    );
    await harness.page.reload();
    await harness.page.waitForSelector('[role="tree"]');
  });

  test.afterAll(async () => {
    await close(harness);
    cleanup(userDataDir);
  });

  test('Enter saves the route, keeping the engine’s own choice', async () => {
    const { page } = harness;
    const before = await routeCount(page);

    await newRoute(page);
    await clickAt(page, 0);
    await clickAt(page, 10);
    // Alternatives are on offer and route A is selected: the case that failed.
    await expect(
      page.getByRole('group', { name: 'Routes on offer for this section' }),
    ).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Enter');

    await expect(page.getByText(/Route saved, following roads/)).toBeVisible();
    await expect(page.getByText(/not valid/)).toHaveCount(0);
    expect(await routeCount(page)).toBe(before + 1);
  });

  test('Enter straight after the last click waits for that leg', async () => {
    const { page } = harness;
    const before = await routeCount(page);

    await newRoute(page);
    await clickAt(page, 1);
    await clickAt(page, 11);
    await page.keyboard.press('Enter');

    await expect.poll(() => routeCount(page)).toBe(before + 1);
  });

  test('double-clicking finishes, even though the click lands on a point handle', async () => {
    const { page } = harness;
    const before = await routeCount(page);

    await newRoute(page);
    await clickAt(page, 2);
    const { x, y } = await pixelOf(page, at(14));
    await page.mouse.dblclick(x, y);

    await expect.poll(() => routeCount(page)).toBe(before + 1);
    await expect(page.getByText(/Click to extend along the roads/)).toHaveCount(0);
  });

  test('a double-click on a straight-line route adds its last point once', async () => {
    const { page } = harness;

    await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Straight-Line Route' }).click();
    await clickAt(page, 3);
    const { x, y } = await pixelOf(page, at(13));
    await page.mouse.dblclick(x, y);

    await expect(page.getByText('Route saved with 2 points.')).toBeVisible();
  });
});
