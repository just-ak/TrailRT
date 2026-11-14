import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { A515_TRACE } from '@fixtures/places';
import { cleanup, close, closeEditor, createTripViaUi, launch, makeUserDataDir, type Harness, openTrip, showTripList } from './helpers';

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
  await openTrip(harness.page, new RegExp(TRIP));
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
  await openTrip(page, new RegExp(TRIP));
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
  await openTrip(page, new RegExp(TRIP));

  await page.getByRole('textbox', { name: 'Start date' }).fill('2026-10-23');
  await page.getByRole('button', { name: 'Plan by date' }).click();
  // The trip now has dates, so the right panel shows its details, and its
  // stops are added in the day card on the left (Phase 14 task 10).
  await expect(page.getByTestId('trip-details')).toBeVisible();
  const cards = page.getByTestId('plan-cards');
  for (const name of ['SK17 6AA', 'South of Buxton']) {
    await cards.getByRole('button', { name: /^Add a stop to/ }).last().click();
    const find = cards.getByRole('textbox', { name: 'Find a stop' });
    await find.fill(name);
    // What adding it would do is shown before it is added.
    await expect(page.getByTestId('candidate-details')).toContainText(name);
    await find.press('Enter');
    await expect(cards.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(cards.getByTestId('plan-stop')).toHaveCount(2);
  // The drive is planned by road automatically. This app has no map regions,
  // so it says why it could not be, and draws no straight line instead.
  await cards.getByTestId('plan-leg').filter({ hasText: 'not planned' }).click();
  const drive = page.getByTestId('drive-details');
  await expect(drive.getByTestId('plan-issue')).toContainText('no map data yet');

  await drive.getByRole('combobox', { name: 'How you travel to South of Buxton' }).selectOption({ label: 'A route I choose' });
  await drive.getByRole('combobox', { name: 'Route to South of Buxton' }).selectOption({ label: 'A515 south' });
  await expect(cards.getByRole('button', { name: 'South of Buxton', exact: true })).toContainText('arrive 09:');
  // Phase 14: the trip's page header gives its dates.
  await expect(page.getByTestId('trip-header')).toContainText('Fri 23 Oct');
});

test('the library summarises a dated trip by day', async () => {
  const { page } = harness;
  const day = page.getByTestId('day-card').filter({ hasText: /Fri 23 Oct/i });
  await expect(day).toBeVisible();
  // The day's card holds the stops and the drive in order, with their times.
  const rows = day.getByRole('button').filter({ hasText: /SK17 6AA|A515 south|South of Buxton/ });
  await expect(rows).toHaveText([/SK17 6AA.*leave/, /A515 south/, /South of Buxton.*arrive/]);
});

test('shows the trip’s details on the right, and a drive’s when its route is selected', async () => {
  const { page } = harness;
  // Phase 14 Requirement 4.2 and 4.5: only what the left panel does not show.
  await openTrip(page, new RegExp(TRIP));
  await closeEditor(page);
  const trip = page.getByTestId('trip-details');
  await expect(trip).toBeVisible();
  await expect(trip.getByLabel('Leave on')).toHaveValue('2026-10-23');
  await expect(trip).not.toContainText(TRIP);
  await page.getByTestId('plan-cards').getByRole('button', { name: 'A515 south', exact: true }).click();
  await expect(page.getByTestId('drive-details')).toContainText('SK17 6AA → South of Buxton');
  await expect(page.getByTestId('drive-details').getByRole('combobox', { name: 'How you travel to South of Buxton' })).toHaveValue('route');
});

test('with no trip open, the right panel shows the year with the trip’s day marked', async () => {
  const { page } = harness;
  await showTripList(page);
  // Back leaves the trip selected, which the right panel shows; Escape clears it.
  await page.locator('[role="tree"]').press('Escape');
  const year = page.getByTestId('year-view');
  await expect(year).toBeVisible();
  await year.getByRole('button', { name: 'The year before' }).click();
  await year.getByRole('button', { name: 'The year after' }).click();
  await expect(year.getByTestId('year')).toHaveText('2026');
  const day = year.getByRole('button', { name: `${TRIP}, Fri 23 Oct` });
  await expect(day).toBeVisible();
  // Selecting a marked day opens its trip.
  await day.click();
  await expect(page.getByTestId('trip-header')).toContainText(TRIP);
  await expect(page.getByTestId('trip-details')).toBeVisible();
});

test('finds fuel and a hotel along the way, and adds the hotel as a stop', async () => {
  const { page } = harness;
  await openTrip(page, new RegExp(TRIP));
  await closeEditor(page);
  await page.getByTestId('trip-details').getByRole('button', { name: 'Places along the trip' }).click();
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
  await expect(page.getByTestId('plan-cards').getByTestId('plan-stop')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Close' }).click();
});

test('a stop’s details set its stay and say what a change would move', async () => {
  const { page } = harness;
  await openTrip(page, new RegExp(TRIP));
  await closeEditor(page);
  await page.getByTestId('plan-cards').getByRole('button', { name: 'Palace Hotel', exact: true }).click();
  const stop = page.getByTestId('stop-details');
  await expect(stop).toBeVisible();
  await expect(stop).toContainText('Stop 2');
  // A hotel is a night's stay: its stay is in days. Typing shows what the
  // change would move before anything is saved; putting it back saves nothing.
  const days = stop.getByRole('textbox', { name: 'Days' });
  const was = await days.inputValue();
  await days.fill(String(Number(was) + 1));
  await expect(stop.getByTestId('consequence')).toBeVisible();
  await days.fill(was);
  await days.press('Tab');
  await expect(stop.getByTestId('consequence')).toHaveCount(0);
});

test('stops are reordered on the left, by drag and by Alt and an arrow key', async () => {
  const { page } = harness;
  await openTrip(page, new RegExp(TRIP));
  const cards = page.getByTestId('plan-cards');
  const order = () => cards.getByTestId('plan-stop');
  await expect(order()).toHaveText([/SK17 6AA/, /Palace Hotel/, /South of Buxton/]);
  // Dropped on the upper half of Palace Hotel's row: before it.
  await cards.getByRole('button', { name: 'South of Buxton', exact: true }).dragTo(cards.getByRole('button', { name: 'Palace Hotel', exact: true }));
  await expect(order()).toHaveText([/SK17 6AA/, /South of Buxton/, /Palace Hotel/]);
  // And back without a pointer.
  await cards.getByRole('button', { name: 'South of Buxton', exact: true }).focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(order()).toHaveText([/SK17 6AA/, /Palace Hotel/, /South of Buxton/]);
});

test('a leg marked as other transport is not planned by road', async () => {
  const { page } = harness;
  await openTrip(page, new RegExp(TRIP));
  await closeEditor(page);
  const cards = page.getByTestId('plan-cards');
  const unplanned = cards.getByTestId('plan-leg').filter({ hasText: 'not planned' });
  const before = await unplanned.count();
  expect(before).toBeGreaterThan(0);
  // A drive with no route has nothing to select; the right panel shows it anyway.
  await unplanned.first().click();
  const drive = page.getByTestId('drive-details');
  await drive.getByRole('combobox', { name: /How you travel to/ }).selectOption({ label: 'Other transport' });
  await drive.getByRole('combobox', { name: 'Kind of transport' }).selectOption({ label: 'Train' });
  await expect(unplanned).toHaveCount(before - 1);
  await expect(cards.getByRole('button', { name: /Train/ })).toBeVisible();
});

test('icon buttons say what they do, on hover and on focus', async () => {
  const { page } = harness;
  const button = page.getByTestId('trip-header').getByRole('button', { name: 'Export the trip' });
  await button.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Export the trip');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Keyboard focus shows it at once; a mouse click's focus does not.
  await page.keyboard.press('Shift');
  await button.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Export the trip');
  await button.blur();
});

test('the library, properties and the panel below the map can be hidden and shown', async () => {
  const { page } = harness;
  const tree = page.getByTestId('left-panel');
  await page.getByRole('button', { name: 'Hide the library' }).click();
  await expect(tree).toBeHidden();
  await page.getByRole('button', { name: 'Show the library' }).click();
  await expect(tree).toBeVisible();

  await openTrip(page, new RegExp(TRIP));
  await closeEditor(page);
  const companion = page.getByTestId('companion');
  await page.getByRole('button', { name: 'Hide the properties' }).click();
  await expect(companion).toBeHidden();
  await page.getByRole('button', { name: 'Show the properties' }).click();
  await expect(companion).toBeVisible();

  await companion.getByRole('button', { name: 'Places along the trip' }).click();
  const panel = page.getByTestId('poi-panel');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: 'Hide the panel below the map' }).click();
  await expect(panel).toBeHidden();
  await page.getByRole('button', { name: 'Show the panel below the map' }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
});

test('everything is still there after a restart', async () => {
  await close(harness);
  await start();
  const { page } = harness;
  await openTrip(page, new RegExp(TRIP));
  const cards = page.getByTestId('plan-cards');
  await expect(cards.getByTestId('plan-stop')).toHaveCount(3);
  await expect(cards.getByRole('button', { name: 'Palace Hotel', exact: true })).toBeVisible();
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
