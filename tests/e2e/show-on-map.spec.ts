import { join, resolve } from 'node:path';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, openTrip, showTripList, type Harness } from './helpers';

/**
 * Phase 14 task 29 (Requirement 26), against the built application: the
 * arrow on a route in the Routes section and on a waypoint in the Waypoints
 * section selects it and moves the map to it, and a waypoint asked for is
 * drawn with the Waypoints layer hidden.
 *
 * Task 32 (Requirement 29): on a trip's page, the trip's arrow fits the map
 * to the whole trip, and its route, track and waypoint rows have the arrow too.
 */

let userDataDir: string;
let harness: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async ({ from, to, at }) => {
      const trip = await window.trailrt.trips.create({ name: 'Peak loop', folderId: null });
      if (!trip.ok) return;
      await window.trailrt.routes.create({ tripId: trip.data.id, name: 'Cat and Fiddle', points: [from, to] });
      await window.trailrt.waypoints.create({ tripId: trip.data.id, name: 'Ashbourne market', lat: at.lat, lon: at.lon, eleM: null, description: null, symbol: 'pin', notes: null, groupId: null });
    },
    {
      from: { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon },
      to: { lat: BUXTON.lat, lon: BUXTON.lon },
      at: { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon },
    },
  );
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

async function showSection(page: Page, name: 'Routes' | 'Waypoints'): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByRole('tree', { name }).waitFor();
}

/** Where the map is, as it persists it after each move. */
async function mapPosition(page: Page): Promise<{ lat: number; lon: number; zoom: number } | null> {
  return page.evaluate(async () => {
    const result = await window.trailrt.settings.all();
    return result.ok ? result.data.mapPosition : null;
  });
}

test("a route's arrow selects it and fits the map to it", async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  const before = await mapPosition(page);
  await page.getByRole('treeitem', { name: 'Cat and Fiddle' }).hover();
  await page.getByRole('button', { name: 'Show Cat and Fiddle on the map' }).click();
  await expect(page.getByTestId('object-card')).toContainText('Cat and Fiddle');

  // The map's centre moves inside the route's box, between Macclesfield and Buxton.
  await expect
    .poll(async () => {
      const at = await mapPosition(page);
      if (at === null || (at.lat === before?.lat && at.lon === before.lon)) return false;
      const lats = [MACCLESFIELD.lat, BUXTON.lat];
      const lons = [MACCLESFIELD.lon, BUXTON.lon];
      return at.lat >= Math.min(...lats) && at.lat <= Math.max(...lats) && at.lon >= Math.min(...lons) && at.lon <= Math.max(...lons);
    }, { timeout: 10_000 })
    .toBe(true);

  // Selected, the arrow stays without hovering.
  await page.mouse.move(0, 0);
  await expect(page.getByRole('button', { name: 'Show Cat and Fiddle on the map' })).toHaveCSS('opacity', '1');
});

test("a waypoint's arrow centres the map on it, zoomed in", async () => {
  const { page } = harness;
  await showSection(page, 'Waypoints');
  await page.getByRole('treeitem', { name: 'Ashbourne market' }).hover();
  await page.getByRole('button', { name: 'Show Ashbourne market on the map' }).click();
  await expect(page.getByTestId('object-card')).toContainText('Ashbourne market');
  await expect
    .poll(async () => {
      const at = await mapPosition(page);
      return at !== null && Math.abs(at.lat - ASHBOURNE.lat) < 1e-4 && Math.abs(at.lon - ASHBOURNE.lon) < 1e-4 && at.zoom >= 15;
    }, { timeout: 10_000 })
    .toBe(true);
});

test('a waypoint asked for is drawn with the Waypoints layer hidden, until something else is selected', async () => {
  const { page } = harness;
  const markers = page.locator('.leaflet-marker-pane > *');
  await page.getByTestId('waypoints-on-map').click();
  await expect(page.getByTestId('waypoints-on-map')).toHaveAttribute('aria-pressed', 'true');
  // Still selected from its arrow, so still drawn.
  await expect(markers).not.toHaveCount(0);

  // A click on the list's empty space clears the selection, and the layer
  // setting applies again.
  const tree = page.getByRole('tree', { name: 'Waypoints' });
  const box = await tree.boundingBox();
  if (box === null) throw new Error('the Waypoints list has no box');
  await tree.click({ position: { x: 20, y: box.height - 10 } });
  await expect(page.getByTestId('object-card')).toHaveCount(0);
  await expect(markers).toHaveCount(0);

  await page.getByRole('treeitem', { name: 'Ashbourne market' }).hover();
  await page.getByRole('button', { name: 'Show Ashbourne market on the map' }).click();
  await expect(markers).not.toHaveCount(0);
  await page.getByTestId('waypoints-on-map').click();
});

/** The Buxton square: the box the trip's route, track and waypoints span. */
const SQUARE = [BUXTON, MACCLESFIELD, LEEK, ASHBOURNE];
const inSquare = (at: { lat: number; lon: number }): boolean =>
  at.lat >= Math.min(...SQUARE.map((p) => p.lat)) &&
  at.lat <= Math.max(...SQUARE.map((p) => p.lat)) &&
  at.lon >= Math.min(...SQUARE.map((p) => p.lon)) &&
  at.lon <= Math.max(...SQUARE.map((p) => p.lon));

/** Zooms right in on one waypoint, so a later fit to something larger is seen to move the map. */
async function zoomInOnAshbourne(page: Page): Promise<void> {
  await page.getByRole('treeitem', { name: 'Ashbourne' }).hover();
  await page.getByRole('button', { name: 'Show Ashbourne on the map' }).click();
  await expect.poll(async () => (await mapPosition(page))?.zoom ?? 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(15);
}

/** The map has fitted something the size of the square: zoomed out, centred inside it. */
async function expectSquareFitted(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const at = await mapPosition(page);
      return at !== null && at.zoom <= 13 && inSquare(at);
    }, { timeout: 10_000 })
    .toBe(true);
}

test.describe("on a trip's page (Requirement 29)", () => {
  let tripName = '';

  test.beforeAll(async () => {
    // The loop round the four towns, imported as a user would: one route, one
    // track, four waypoints, in a new trip named after the file.
    const { app, page } = harness;
    await app.evaluate(({ dialog }, filePaths: string[]) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    }, [join(resolve('test-data'), 'generated', 'peak-district-loop.gpx')]);
    await showTripList(page);
    await page.getByRole('button', { name: 'Import files' }).click();
    await page.getByRole('heading', { name: /^Import \d+ file/ }).waitFor({ timeout: 20_000 });
    await page.getByLabel('Destination trip').selectOption('');
    // Dispatched, not clicked: see the import spec on native dialogs.
    await page.getByRole('button', { name: 'Confirm import' }).dispatchEvent('click');
    await page.getByRole('heading', { name: 'Import report' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Close import report' }).dispatchEvent('click');
    tripName = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({});
      return (trips.ok ? trips.data.find((t) => t.trackCount > 0)?.name : undefined) ?? '';
    });
    expect(tripName).not.toBe('');
    await openTrip(page, tripName);
    await page.getByRole('tab', { name: /^Objects/ }).click();
  });

  test("the trip's arrow selects the trip and fits the map to all of it", async () => {
    const { page } = harness;
    await zoomInOnAshbourne(page);
    await page.getByTestId('show-trip-on-map').click();
    // The trip is selected: the companion shows the trip, which for one with no dates is its prompt.
    await expect(page.getByTestId('companion')).toHaveAttribute('data-view', /^(trip|undated)$/);
    await expectSquareFitted(page);
  });

  test("a track's arrow selects it and fits the map to it", async () => {
    const { page } = harness;
    await zoomInOnAshbourne(page);
    await page.getByRole('treeitem', { name: 'Peak District ride' }).hover();
    await page.getByRole('button', { name: 'Show Peak District ride on the map' }).click();
    await expect(page.getByTestId('object-card')).toContainText('Peak District ride');
    await expectSquareFitted(page);
    // Selected, the arrow stays without hovering.
    await page.mouse.move(0, 0);
    await expect(page.getByRole('button', { name: 'Show Peak District ride on the map' })).toHaveCSS('opacity', '1');
  });

  test("a route's arrow selects it and fits the map to it", async () => {
    const { page } = harness;
    await zoomInOnAshbourne(page);
    await page.getByRole('treeitem', { name: 'Buxton square' }).hover();
    await page.getByRole('button', { name: 'Show Buxton square on the map' }).click();
    await expect(page.getByTestId('object-card')).toContainText('Buxton square');
    await expectSquareFitted(page);
  });
});
