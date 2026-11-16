import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, showTripList, type Harness } from './helpers';

/**
 * Phase 14 task 21: the left panel's search takes a pattern and finds routes
 * as well as trips and waypoints (Requirement 20), against the built app.
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
      ]);
      if (made.some((r) => !r.ok)) throw new Error('could not make the routes');
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

const box = (page: Page) => page.getByRole('searchbox', { name: 'Search trips' });
const results = (page: Page) => page.getByTestId('search-results');

test('says that it takes a pattern', async () => {
  await expect(box(harness.page)).toHaveAttribute('placeholder', /pattern/);
});

test('plain text still finds what it did, ignoring case', async () => {
  const { page } = harness;
  await box(page).fill('MOORLANDS');
  await expect(results(page)).toContainText('1 match');
  await expect(results(page).getByRole('button', { name: /Moorlands weekend/ })).toBeVisible();
});

test('a pattern finds trips, and routes across trips and outside them', async () => {
  const { page } = harness;
  await box(page).fill('^peak 20(24|25)$');
  await expect(results(page)).toContainText('2 matches');
  await expect(results(page).getByRole('button', { name: 'Peak 2024' })).toBeVisible();
  await expect(results(page).getByRole('button', { name: 'Peak 2025' })).toBeVisible();

  await box(page).fill('^day [0-9]:|fiddle');
  await expect(results(page)).toContainText('3 matches');
  await expect(results(page).getByRole('button', { name: /Day 1: Buxton to Leek\s*Peak 2025/ })).toBeVisible();
  await expect(results(page).getByRole('button', { name: /Day 2: Leek to Ashbourne\s*Peak 2025/ })).toBeVisible();
  // ADR 0022: the holder is never named as a trip.
  await expect(results(page).getByRole('button', { name: /Cat and Fiddle\s*Not in a trip/ })).toBeVisible();
});

test('a route found outside a trip opens in the Routes section, selected', async () => {
  const { page } = harness;
  await box(page).fill('fiddle');
  await results(page).getByRole('button', { name: /Cat and Fiddle/ }).click();
  await expect(box(page)).toHaveValue('');
  await expect(page.getByRole('tab', { name: 'Routes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('object-card')).toContainText('Cat and Fiddle');
});

test('a route found in a trip opens that trip, selected', async () => {
  const { page } = harness;
  await showTripList(page);
  await box(page).fill('^day 2');
  await results(page).getByRole('button', { name: /Day 2: Leek to Ashbourne/ }).click();
  await expect(page.getByTestId('trip-header')).toContainText('Peak 2025');
  await expect(page.getByTestId('object-card')).toContainText('Day 2: Leek to Ashbourne');
});

test('a half-typed pattern says what is wrong and shows no results', async () => {
  const { page } = harness;
  await box(page).fill('peak');
  await expect(results(page)).toContainText('2 matches');
  await box(page).fill('peak (');
  await expect(page.getByTestId('search-error')).toContainText('Not a valid pattern');
  await expect(page.getByTestId('search-error')).toContainText('Unterminated group');
  await expect(results(page)).toHaveCount(0);
  // Finishing it brings results back.
  await box(page).fill('peak (2025)');
  await expect(results(page)).toContainText('1 match');
  await box(page).fill('');
});
