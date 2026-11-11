import { expect, test, type Page } from '@playwright/test';
import { BUXTON } from '@fixtures/places';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Switching base map while zoomed in.
 *
 * Regression for "the map goes blank": zoomed to 19 on OpenStreetMap, a switch
 * to OpenTopoMap (which serves only to 17) left the map at 19 with a tile layer
 * that drew nothing past its own limit, and left OpenStreetMap's credit behind
 * because the layer's listeners were cleared before it was removed.
 *
 * Asserts on the tiles the map asks for, not on whether they load: the suite
 * does not depend on the tile servers being reachable.
 */

let userDataDir: string;
let harness: Harness;

/** Zoom levels of the tiles currently in the map, from their URLs. */
const tileZooms = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('img.leaflet-tile')].map(
      (img) => Number(/\/(\d+)\/\d+\/\d+\.png/.exec((img as HTMLImageElement).src)?.[1]),
    ),
  );

const attribution = (page: Page) =>
  page.locator('.leaflet-control-attribution').innerText();

async function chooseBaseMap(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Map layers' }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async (view) => {
      await window.trailrt.settings.set({ key: 'mapProviderId', value: 'osm' });
      await window.trailrt.settings.set({ key: 'mapPosition', value: view });
    },
    { lat: BUXTON.lat, lon: BUXTON.lon, zoom: 19 },
  );
  await harness.page.reload();
  await harness.page.waitForSelector('[role="tree"]');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test('switching to OpenTopoMap at zoom 19 enlarges its zoom-17 tiles instead of going blank', async () => {
  const { page } = harness;
  await expect.poll(() => tileZooms(page)).toContain(19);

  await chooseBaseMap(page, 'OpenTopoMap (terrain)');

  // Tiles are still requested, at the deepest level OpenTopoMap serves.
  await expect.poll(async () => (await tileZooms(page)).length).toBeGreaterThan(0);
  expect(new Set(await tileZooms(page))).toEqual(new Set([17]));

  // Credited once, and only to the map on screen.
  const credit = await attribution(page);
  expect(credit).toMatch(/OpenTopoMap/);
  expect(credit.match(/OpenStreetMap contributors/g)).toHaveLength(1);
});

test('switching back credits only OpenStreetMap again', async () => {
  const { page } = harness;
  await chooseBaseMap(page, 'OpenStreetMap');

  await expect.poll(() => tileZooms(page)).toContain(19);
  const credit = await attribution(page);
  expect(credit).not.toMatch(/OpenTopoMap/);
  expect(credit.match(/OpenStreetMap contributors/g)).toHaveLength(1);
});
