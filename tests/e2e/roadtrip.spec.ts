import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { A515_TRACE } from '@fixtures/places';
import { cleanup, close, createTripViaUi, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 10 in the running app: road trip planning, places along the route,
 * and offline postcode and place search (Requirements 13.8 and 13.12).
 *
 * The app's data folder is seeded with place data and postcodes built from
 * the committed real-data excerpts (`test-data/places-excerpt/`,
 * `test-data/codepoint/`) by the app's own ingest code. Every network request
 * is refused, in the renderer and in the main process, so anything that works
 * here works offline.
 */

const TRIP = 'Peak Road Trip';
let userDataDir: string;
let harness: Harness;

function seed(dir: string): void {
  const result = spawnSync('npx', ['vitest', 'run', '--config', 'tests/seed/vitest.seed.config.ts'], {
    env: { ...process.env, TRAILRT_SEED_DIR: dir },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`Seeding failed:\n${result.stdout}\n${result.stderr}`);
}

async function blockNetwork(h: Harness): Promise<void> {
  // Renderer: map tiles and anything else over the network.
  await h.page.route(/^https?:\/\//, (route) => route.abort());
  // Main process: every fetch fails, as with the cable pulled out.
  await h.app.evaluate(() => {
    globalThis.fetch = () => Promise.reject(new Error('Network blocked by the test'));
  });
}

async function start(): Promise<void> {
  harness = await launch(userDataDir);
  await blockNetwork(harness);
}

/** The search results, and only them: the page has other option lists. */
function results(page: Page) {
  return page.getByRole('listbox', { name: 'Places found' }).getByRole('option');
}

async function search(page: Page, text: string): Promise<void> {
  const box = page.getByRole('combobox', { name: 'Search for a postcode or place' });
  await box.fill(text);
  await expect(results(page).first()).toBeVisible();
}

async function tripId(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    const result = await window.trailrt.trips.list({ includeArchived: true, sortKey: 'name', sortDirection: 'asc' });
    if (!result.ok) throw new Error(result.error.message);
    const trip = result.data.find((t) => t.name === name);
    if (trip === undefined) throw new Error('trip not found');
    return trip.id;
  }, TRIP);
}

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  seed(userDataDir);
  await start();
  await createTripViaUi(harness.page, TRIP);
  await harness.page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test('finds a postcode offline and adds it as a waypoint', async () => {
  const { page } = harness;
  await search(page, 'sk17 6aa');
  const option = results(page).first();
  await expect(option).toContainText('SK17 6AA');
  await expect(option).toContainText('not an address');
  await expect(page.getByText('Nothing was sent anywhere.')).toBeVisible();
  await option.click();
  await page.getByTestId('search-chosen').getByRole('button', { name: 'Add as a waypoint' }).click();
  // Waypoints are children of their trip, so the trip has to be expanded.
  await page.getByRole('treeitem', { name: new RegExp(TRIP) }).dblclick();
  await expect(page.getByRole('treeitem', { name: /SK17 6AA/ })).toBeVisible();
});

test('says an uncovered postcode is not included, rather than not found', async () => {
  const { page } = harness;
  await page.getByRole('combobox', { name: 'Search for a postcode or place' }).fill('BT1 1AA');
  await expect(page.getByTestId('search-message')).toHaveText(
    'Postcodes in Northern Ireland are not included. The postcode data covers Great Britain only.',
  );
});

test('finds a place by name and a street by its abbreviation', async () => {
  const { page } = harness;
  await search(page, 'Harpur');
  await expect(results(page).first()).toContainText('Harpur Hill');
  await search(page, 'spring gdns');
  await expect(results(page).filter({ hasText: 'Spring Gardens' }).first()).toContainText('Buxton');
  await page.getByRole('combobox', { name: 'Search for a postcode or place' }).press('Escape');
});

test('plans a trip by date, with a timed leg', async () => {
  const { page } = harness;
  const id = await tripId(page);
  // Setup through the API: the end of the A515 trace as a waypoint, and the
  // road itself as a route. Building the itinerary is done through the UI.
  await page.evaluate(
    async ({ trip, trace }) => {
      const end = trace.at(-1);
      if (end === undefined) throw new Error('empty trace');
      await window.trailrt.waypoints.create({
        tripId: trip,
        name: 'South of Buxton',
        lat: end.lat,
        lon: end.lon,
        eleM: null,
        description: null,
        symbol: 'pin',
        notes: null,
        groupId: null,
      });
      await window.trailrt.routes.create({
        tripId: trip,
        name: 'A515 south',
        colour: null,
        points: trace.map((p) => ({ lat: p.lat, lon: p.lon, ele: null, name: null, symbol: null, notes: null })),
      });
    },
    { trip: id, trace: A515_TRACE },
  );
  await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();

  await page.getByRole('textbox', { name: 'Start date' }).fill('2026-10-23');
  await page.getByRole('button', { name: 'Plan by date' }).click();
  const itinerary = page.getByTestId('itinerary');
  await expect(itinerary).toBeVisible();

  for (const name of ['SK17 6AA', 'South of Buxton']) {
    await itinerary.getByRole('combobox', { name: 'Waypoint to add' }).selectOption({ label: name });
    await itinerary.getByRole('button', { name: 'Add stop' }).click();
  }
  await expect(itinerary.getByTestId('stop')).toHaveCount(2);
  await expect(itinerary.getByTestId('stop').nth(1)).toContainText('Arrive —');
  // The drive is planned by road automatically. This app has no map regions,
  // so it says why it could not be, and draws no straight line instead.
  await expect(itinerary.getByTestId('plan-issue')).toContainText('no map data yet');

  await itinerary.getByRole('combobox', { name: 'How you travel to South of Buxton' }).selectOption({ label: 'A route I choose' });
  await itinerary.getByRole('combobox', { name: 'Route to South of Buxton' }).selectOption({ label: 'A515 south' });
  await expect(itinerary.getByTestId('plan-issue')).toHaveCount(0);
  await expect(itinerary.getByTestId('stop').nth(1)).toContainText('Arrive Fri 23 Oct, 09:');
  await expect(itinerary.getByTestId('itinerary-dates')).toHaveText('23 Oct 2026');
  await expect(page.getByRole('treeitem', { name: new RegExp(TRIP) })).toContainText('23 Oct 2026');
});

test('the library summarises a dated trip by day', async () => {
  const { page } = harness;
  const day = page.getByRole('treeitem', { name: /Fri 23 Oct/ });
  await expect(day).toBeVisible();
  // The day opens by itself, holding the stops and the drive in order.
  const rows = page.getByRole('treeitem').filter({ hasText: /SK17 6AA|A515 south|South of Buxton/ });
  await expect(rows).toHaveText([/SK17 6AA.*leave/, /A515 south/, /South of Buxton.*arrive/]);
});

test('shows the plan as a calendar, and selecting a drive selects its route', async () => {
  const { page } = harness;
  await page.getByTestId('itinerary').getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendar = page.getByTestId('calendar');
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('[data-date="2026-10-23"]').first()).toBeVisible();
  await expect(calendar.getByTestId('block-leg')).toHaveCount(1);
  await calendar.getByRole('button', { name: 'Month' }).click();
  await expect(calendar.getByTestId('calendar-range')).toHaveText('October 2026');
  await calendar.getByRole('button', { name: 'Week' }).click();
  await calendar.getByTestId('block-leg').click();
  await expect(page.getByRole('treeitem', { name: /A515 south/ })).toHaveAttribute('aria-selected', 'true');
  await calendar.getByRole('button', { name: 'Close calendar' }).click();
});

test('finds fuel and a hotel along the way, and adds the hotel as a stop', async () => {
  const { page } = harness;
  await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
  await page.getByTestId('itinerary').getByRole('button', { name: 'Find places along the way' }).click();
  const panel = page.getByTestId('poi-panel');
  await expect(panel.getByTestId('poi-row').first()).toBeVisible();
  // Within the default 2 km, in the order they are reached: Essar Rockbay at
  // 0.6 km (1.74 km off the road), Morrisons at 1.0 km, Esso at 1.1 km.
  await expect(panel.getByTestId('poi-row').nth(0)).toContainText('Essar Rockbay Service Station');
  await expect(panel.getByTestId('poi-row').nth(1)).toContainText('Morrisons');
  await expect(panel.getByTestId('poi-row').nth(2)).toContainText('Esso Buxton Express');
  // Narrowing the corridor to 1 km drops the one 1.74 km away.
  await panel.getByRole('combobox', { name: 'Corridor width' }).selectOption({ label: '1.00 km' });
  await expect(panel.getByTestId('poi-row')).toHaveCount(2);
  await expect(panel.getByTestId('poi-row').nth(0)).toContainText('Morrisons');
  await expect(panel).toContainText('© OpenStreetMap contributors');

  await panel.getByRole('checkbox', { name: 'Fuel' }).uncheck();
  await panel.getByRole('checkbox', { name: 'Accommodation' }).check();
  const palace = panel.getByTestId('poi-row').filter({ hasText: 'Palace Hotel' });
  await expect(palace).toBeVisible();
  await palace.getByRole('button', { name: 'Add as a stop' }).click();
  await expect(palace).toContainText('Added as a stop');
  await expect(page.getByTestId('itinerary').getByTestId('stop')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Close' }).click();
});

test('a leg marked as other transport is not planned by road', async () => {
  const { page } = harness;
  const itinerary = page.getByTestId('itinerary');
  const issues = itinerary.getByTestId('plan-issue');
  const before = await issues.count();
  expect(before).toBeGreaterThan(0);
  // Pin the leg by position: the plan issue it is found by goes away.
  const legs = itinerary.getByTestId('leg');
  let index = 0;
  while ((await legs.nth(index).getByTestId('plan-issue').count()) === 0) index += 1;
  const leg = legs.nth(index);
  await leg.getByRole('combobox', { name: /How you travel to/ }).selectOption({ label: 'Other transport' });
  await leg.getByRole('combobox', { name: 'Kind of transport' }).selectOption({ label: 'Train' });
  await expect(issues).toHaveCount(before - 1);
  await expect(page.getByRole('treeitem', { name: /Train/ })).toBeVisible();
});

test('icon buttons say what they do, on hover and on focus', async () => {
  const { page } = harness;
  const calendar = page.getByTestId('itinerary').getByRole('button', { name: 'Calendar', exact: true });
  await calendar.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Calendar');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Keyboard focus shows it at once; a mouse click's focus does not.
  await page.keyboard.press('Shift');
  await calendar.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Calendar');
  await calendar.blur();
});

test('the library, properties and the panel below the map can be hidden and shown', async () => {
  const { page } = harness;
  const tree = page.getByRole('tree');
  await page.getByRole('button', { name: 'Hide the library' }).click();
  await expect(tree).toBeHidden();
  await page.getByRole('button', { name: 'Show the library' }).click();
  await expect(tree).toBeVisible();

  const itinerary = page.getByTestId('itinerary');
  await page.getByRole('button', { name: 'Hide the properties' }).click();
  await expect(itinerary).toBeHidden();
  await page.getByRole('button', { name: 'Show the properties' }).click();
  await expect(itinerary).toBeVisible();

  await itinerary.getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendar = page.getByTestId('calendar');
  await expect(calendar).toBeVisible();
  await page.getByRole('button', { name: 'Hide the panel below the map' }).click();
  await expect(calendar).toBeHidden();
  await page.getByRole('button', { name: 'Show the panel below the map' }).click();
  await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: 'Close calendar' }).click();
});

test('everything is still there after a restart', async () => {
  await close(harness);
  await start();
  const { page } = harness;
  await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
  const itinerary = page.getByTestId('itinerary');
  await expect(itinerary.getByTestId('stop')).toHaveCount(3);
  await expect(itinerary).toContainText('Palace Hotel');
  await expect(page.getByRole('treeitem', { name: /Palace Hotel/ })).toBeVisible();
  await search(page, 'SK17 6AA');
  await expect(results(page).first()).toContainText('SK17 6AA');
});

test.describe('without place data', () => {
  let bare: string;
  let other: Harness;

  test.beforeAll(async () => {
    bare = mkdtempSync(join(tmpdir(), 'trailrt-e2e-bare-'));
    other = await launch(bare);
  });

  test.afterAll(async () => {
    await close(other);
    rmSync(bare, { recursive: true, force: true });
  });

  test('search says what data it needs rather than finding nothing', async () => {
    await other.page.getByRole('combobox', { name: 'Search for a postcode or place' }).fill('SK17 6AA');
    await expect(other.page.getByTestId('search-message')).toContainText('Download it in Settings');
  });
});
