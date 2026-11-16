import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 14 task 22: Move to Trip… lists every trip, under a filter, and works
 * from the keyboard (Requirement 21), against the built application. There
 * are more trips here than the old menu's cap of eight or nine, and the one
 * wanted sorts last.
 */

let userDataDir: string;
let harness: Harness;
const TRIP_COUNT = 15;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async ({ count, buxton, leek, ashbourne }) => {
      const t = window.trailrt;
      const home = await t.trips.create({ name: 'Home', folderId: null });
      for (let i = 1; i <= count; i++) {
        // In order, so the list's order is known.
        // eslint-disable-next-line no-await-in-loop
        await t.trips.create({ name: `Trip ${String(i).padStart(2, '0')}`, folderId: null });
      }
      await t.trips.create({ name: 'Zennor weekend', folderId: null });
      if (!home.ok) throw new Error('could not make Home');
      await t.routes.create({ tripId: home.data.id, name: 'Leek loop', points: [buxton, leek] });
      await t.routes.create({ tripId: home.data.id, name: 'Dovedale run', points: [leek, ashbourne] });
    },
    {
      count: TRIP_COUNT,
      buxton: { lat: BUXTON.lat, lon: BUXTON.lon },
      leek: { lat: LEEK.lat, lon: LEEK.lon },
      ashbourne: { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon },
    },
  );
  await harness.page.reload();
  await harness.page.waitForSelector('[role="tree"], [data-testid="plan-cards"]');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

async function showRoutes(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Routes', exact: true }).click();
  await page.getByRole('tree', { name: 'Routes' }).waitFor();
}

const route = (page: Page, name: string) => page.getByRole('treeitem', { name: new RegExp(name) });
const picker = (page: Page) => page.getByRole('dialog');
const options = (page: Page) => picker(page).getByRole('option');

/** The name of the trip each route is in now, from the main process. */
async function tripsOf(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const routes = await window.trailrt.routes.listAll();
    if (!routes.ok) throw new Error(routes.error.message);
    return Object.fromEntries(routes.data.map((r) => [r.name, r.tripName]));
  });
}

test('lists every trip, with "Not in a trip" first, and opens with the focus in the filter', async () => {
  const { page } = harness;
  await showRoutes(page);
  await route(page, 'Leek loop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();

  await expect(picker(page)).toBeVisible();
  await expect(picker(page)).toContainText('Move the route to a trip');
  // Home, the fifteen and Zennor, plus "Not in a trip".
  await expect(options(page)).toHaveCount(TRIP_COUNT + 3);
  await expect(options(page).first()).toHaveText('Not in a trip');
  await expect(options(page).last()).toHaveText('Zennor weekend');
  await expect(picker(page).getByRole('combobox', { name: 'Filter trips' })).toBeFocused();

  // Escape closes it and moves nothing.
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  expect((await tripsOf(page))['Leek loop']).toBe('Home');
});

test('a trip beyond the old cap is reached through the filter and Return, in one undo step', async () => {
  const { page } = harness;
  await showRoutes(page);
  await route(page, 'Leek loop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();

  await page.keyboard.type('zen');
  await expect(options(page)).toHaveCount(1);
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');

  await expect(picker(page)).toHaveCount(0);
  await expect.poll(async () => (await tripsOf(page))['Leek loop']).toBe('Zennor weekend');

  await page.evaluate(() => window.trailrt.undo.undo());
  await expect.poll(async () => (await tripsOf(page))['Leek loop']).toBe('Home');
});

test('a bad pattern in the filter says why', async () => {
  const { page } = harness;
  await showRoutes(page);
  await route(page, 'Leek loop').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();
  await page.keyboard.type('trip (');
  await expect(picker(page).getByRole('alert')).toContainText('Unterminated group');
  await expect(options(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('a multi-selection moves only once a trip is picked, by the arrow keys, in one undo step', async () => {
  const { page } = harness;
  await showRoutes(page);
  await route(page, 'Leek loop').click();
  await route(page, 'Dovedale run').click({ modifiers: ['Meta'] });
  await route(page, 'Dovedale run').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();

  // Choosing the item moved nothing (it moved to the first trip before).
  await expect(picker(page)).toContainText('Move 2 routes to a trip');
  expect(await tripsOf(page)).toMatchObject({ 'Leek loop': 'Home', 'Dovedale run': 'Home' });

  await page.keyboard.type('^trip 1[0-9]$');
  await expect(options(page)).toHaveCount(6);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(options(page).nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(options(page).nth(2)).toHaveText('Trip 12');
  await page.keyboard.press('Enter');

  await expect.poll(async () => tripsOf(page)).toMatchObject({ 'Leek loop': 'Trip 12', 'Dovedale run': 'Trip 12' });
  await page.evaluate(() => window.trailrt.undo.undo());
  await expect.poll(async () => tripsOf(page)).toMatchObject({ 'Leek loop': 'Home', 'Dovedale run': 'Home' });
});

test('a trip can be picked with the pointer', async () => {
  const { page } = harness;
  await showRoutes(page);
  await page.keyboard.press('Escape');
  await route(page, 'Dovedale run').click();
  await route(page, 'Dovedale run').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();
  // dispatchEvent: a real click inside a native <dialog> that unmounts it
  // hangs Playwright's post-click wait (see import.spec.ts).
  await options(page).filter({ hasText: 'Trip 15' }).dispatchEvent('click');
  await expect.poll(async () => (await tripsOf(page))['Dovedale run']).toBe('Trip 15');
});
