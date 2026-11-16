import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, openTrip, showTripList, type Harness } from './helpers';

/**
 * Phase 14 tasks 21 and 23: the left panel's search takes a pattern
 * (Requirement 20.1–20.4) and narrows the list that is open, with a switch to
 * search the whole library instead (20.5–20.7), against the built app.
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async ({ buxton, leek, ashbourne, macclesfield }) => {
      const t = window.trailrt;
      await t.trips.create({ name: 'Peak 2024', folderId: null });
      const peak = await t.trips.create({ name: 'Peak 2025', folderId: null });
      await t.trips.create({ name: 'Moorlands weekend', folderId: null });
      const loose = await t.trips.loose();
      if (!peak.ok || !loose.ok) throw new Error('could not make the trips');
      const made = await Promise.all([
        t.routes.create({ tripId: peak.data.id, name: 'Day 1: Buxton to Leek', points: [buxton, leek] }),
        t.routes.create({ tripId: peak.data.id, name: 'Day 2: Leek to Ashbourne', points: [leek, ashbourne] }),
        t.routes.create({ tripId: loose.data.id, name: 'Cat and Fiddle', points: [buxton, macclesfield] }),
        t.waypoints.create({ tripId: peak.data.id, name: 'Leek market', lat: leek.lat, lon: leek.lon, eleM: null, description: null, symbol: 'pin', notes: null, groupId: null }),
      ]);
      if (made.some((r) => !r.ok)) throw new Error('could not make the routes and waypoints');
    },
    {
      buxton: { lat: BUXTON.lat, lon: BUXTON.lon },
      leek: { lat: LEEK.lat, lon: LEEK.lon },
      ashbourne: { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon },
      macclesfield: { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon },
    },
  );
  // The library loads before the data above; show it.
  await harness.page.reload();
  await harness.page.waitForSelector('[role="tree"], [data-testid="plan-cards"]');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test.afterEach(async () => {
  await box(harness.page).fill('');
});

const box = (page: Page) => page.getByRole('searchbox', { name: 'Search trips' });
const results = (page: Page) => page.getByTestId('search-results');
const scope = (page: Page, name: string | RegExp) => page.getByRole('radiogroup', { name: 'Search in' }).getByRole('radio', { name });
const rows = (page: Page) => page.getByTestId('left-panel').getByRole('treeitem');

async function showSection(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByRole('tree', { name }).waitFor();
}

test('says that it takes a pattern, and offers where to search only while searching', async () => {
  const { page } = harness;
  await expect(box(page)).toHaveAttribute('placeholder', /pattern/);
  await expect(page.getByRole('radiogroup', { name: 'Search in' })).toHaveCount(0);
  await box(page).fill('peak');
  await expect(page.getByRole('radiogroup', { name: 'Search in' })).toBeVisible();
});

test('in Routes, narrows the routes in place, outside a trip included', async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  await box(page).fill('^day [0-9]:|fiddle');
  await expect(scope(page, 'In Routes')).toHaveAttribute('aria-checked', 'true');
  await expect(results(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
  await box(page).fill('^day 2');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Day 2: Leek to Ashbourne');
  // A narrowed row is still a row: selecting it works as ever.
  await rows(page).first().click();
  await expect(page.getByTestId('object-card')).toContainText('Day 2: Leek to Ashbourne');
});

test('in Waypoints, narrows the waypoints, not the routes', async () => {
  const { page } = harness;
  await showSection(page, 'Waypoints');
  await box(page).fill('leek');
  await expect(scope(page, 'In Waypoints')).toHaveAttribute('aria-checked', 'true');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Leek market');
});

test('in the trip list, narrows the trips, plain text ignoring case', async () => {
  const { page } = harness;
  await showTripList(page);
  await box(page).fill('PEAK');
  await expect(scope(page, 'In Trips')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('treeitem', { name: /Peak 2024/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Peak 2025/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Moorlands weekend/ })).toHaveCount(0);
  await box(page).fill('^peak 2025$');
  await expect(page.getByRole('treeitem', { name: /Peak 2024/ })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /Peak 2025/ })).toBeVisible();
});

test("on a trip's page, narrows that trip's routes and waypoints", async () => {
  const { page } = harness;
  await openTrip(page, /Peak 2025/);
  await box(page).fill('^day|market');
  await expect(scope(page, 'In this trip')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('trip-header')).toContainText('Peak 2025');
  await expect(rows(page).filter({ hasText: 'Day 1: Buxton to Leek' })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Day 2: Leek to Ashbourne' })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Leek market' })).toBeVisible();
  // The route outside any trip is not this trip's.
  await expect(rows(page).filter({ hasText: 'Cat and Fiddle' })).toHaveCount(0);
  await box(page).fill('');
  await expect(page.getByTestId('trip-tabs')).toBeVisible();
});

test('nothing here says so and offers everywhere, which finds it', async () => {
  const { page } = harness;
  await showSection(page, 'Waypoints');
  await box(page).fill('fiddle');
  await expect(page.getByTestId('search-nothing-here')).toContainText('Nothing in Waypoints matches.');
  await page.getByTestId('search-nothing-here').getByRole('button', { name: 'Search everywhere' }).click();
  await expect(scope(page, 'Everywhere')).toHaveAttribute('aria-checked', 'true');
  await expect(results(page).getByRole('button', { name: /Cat and Fiddle\s*Not in a trip/ })).toBeVisible();
});

test('everywhere finds trips, and routes across trips and outside them', async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  await box(page).fill('^peak 20(24|25)$');
  await scope(page, 'Everywhere').click();
  await expect(results(page)).toContainText('2 matches');
  await expect(results(page).getByRole('button', { name: 'Peak 2024' })).toBeVisible();

  await box(page).fill('^day [0-9]:|fiddle');
  await expect(results(page)).toContainText('3 matches');
  await expect(results(page).getByRole('button', { name: /Day 1: Buxton to Leek\s*Peak 2025/ })).toBeVisible();
  // ADR 0022: the holder is never named as a trip.
  await expect(results(page).getByRole('button', { name: /Cat and Fiddle\s*Not in a trip/ })).toBeVisible();

  // Back to the open list, which is narrowed again.
  await scope(page, 'In Routes').click();
  await expect(results(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
});

test('clearing the search goes back to searching the open list', async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  await box(page).fill('fiddle');
  await scope(page, 'Everywhere').click();
  await box(page).fill('');
  await box(page).fill('fiddle');
  await expect(scope(page, 'In Routes')).toHaveAttribute('aria-checked', 'true');
});

test('a route found everywhere opens in its trip, selected', async () => {
  const { page } = harness;
  await showTripList(page);
  await box(page).fill('^day 2');
  await scope(page, 'Everywhere').click();
  await results(page).getByRole('button', { name: /Day 2: Leek to Ashbourne/ }).click();
  await expect(page.getByTestId('trip-header')).toContainText('Peak 2025');
  await expect(page.getByTestId('object-card')).toContainText('Day 2: Leek to Ashbourne');
});

test('a half-typed pattern says what is wrong, here or everywhere, and shows nothing', async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  await box(page).fill('day (');
  await expect(page.getByTestId('search-error')).toContainText('Unterminated group');
  await expect(rows(page)).toHaveCount(0);
  await scope(page, 'Everywhere').click();
  await expect(page.getByTestId('search-error')).toContainText('Unterminated group');
  await expect(results(page)).toHaveCount(0);
  // Finishing it brings results back.
  await box(page).fill('day (2)');
  await expect(results(page)).toContainText('1 match');
});
