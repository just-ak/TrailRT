import { resolve, join } from 'node:path';
import { ASHBOURNE, BUXTON, LEEK } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, showTripList, type Harness } from './helpers';

/**
 * Phase 14 task 8: items outside a trip (Requirement 9, ADR 0022), against
 * the built application. A route can stand on its own, be worked on from the
 * Routes section, move into a trip and back out, each one undo step, and the
 * holder that keeps it is never shown as a trip.
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async ({ from, to }) => {
      await window.trailrt.trips.create({ name: 'Peak loop', folderId: null });
      const loose = await window.trailrt.trips.loose();
      if (loose.ok) await window.trailrt.routes.create({ tripId: loose.data.id, name: 'Wincle back roads', points: [from, to] });
    },
    { from: { lat: BUXTON.lat, lon: BUXTON.lon }, to: { lat: LEEK.lat, lon: LEEK.lon } },
  );
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

async function showRoutes(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Routes', exact: true }).click();
  await page.getByRole('tree', { name: 'Routes' }).waitFor();
}

const row = (page: Page) => page.getByRole('treeitem', { name: 'Wincle back roads' });

test('a route outside a trip is listed in its section, and never as a trip', async () => {
  const { page } = harness;
  await showTripList(page);
  await expect(page.getByRole('treeitem', { name: 'Peak loop', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Not in a trip' })).toHaveCount(0);

  await showRoutes(page);
  await expect(row(page)).toContainText('Not in a trip');
  await row(page).click();
  await expect(page.getByTestId('companion')).toHaveAttribute('data-view', 'object');
  await expect(page.getByTestId('object-card')).toContainText('Not in a trip');
  await expect(page.getByTestId('trip-header')).toHaveCount(0);
});

test('moves into a trip and back out, each one undo step', async () => {
  const { page } = harness;
  await showRoutes(page);
  await row(page).click({ button: 'right' });
  // Requirement 21: through Move to Trip…'s list, not a row in the menu.
  await page.getByRole('menuitem', { name: 'Move to Trip…' }).click();
  await page.keyboard.type('peak');
  await page.keyboard.press('Enter');
  await expect(row(page)).toContainText('Peak loop');

  await page.evaluate(() => window.trailrt.undo.undo());
  await expect(row(page)).toContainText('Not in a trip');
});

test('importing from a section puts the files outside any trip by default', async () => {
  const { app, page } = harness;
  await showRoutes(page);
  await app.evaluate(({ dialog }, filePaths: string[]) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, [join(resolve('test-data'), 'generated', 'peak-district-loop.gpx')]);
  await page.getByRole('button', { name: 'Import files' }).click();
  await expect(page.getByLabel('Destination trip')).toHaveValue('loose');
  await page.getByRole('button', { name: 'Cancel import' }).dispatchEvent('click');
});

test.describe('things made outside a plan (Phase 14 task 11)', () => {
  test.beforeAll(async () => {
    // Peak loop gains a plan from Buxton to Leek, and a second route waits outside any trip.
    await harness.page.evaluate(
      async ({ from, to }) => {
        const trips = await window.trailrt.trips.list({});
        const peak = trips.ok ? trips.data.find((t) => t.name === 'Peak loop') : undefined;
        const loose = await window.trailrt.trips.loose();
        if (peak === undefined || !loose.ok) return;
        await window.trailrt.itinerary.create({ tripId: peak.id, startDate: '2026-11-20', startTime: '09:00' });
        for (const [name, at] of [['Buxton', from], ['Leek', to]] as const) {
          const w = await window.trailrt.waypoints.create({ tripId: peak.id, name, lat: at.lat, lon: at.lon, eleM: null, description: null, symbol: 'pin', notes: null, groupId: null });
          if (w.ok) await window.trailrt.itinerary.addStop({ tripId: peak.id, waypointId: w.data.id });
        }
        await window.trailrt.routes.create({ tripId: loose.data.id, name: 'Goyt Valley run', points: [from, to] });
      },
      { from: { lat: BUXTON.lat, lon: BUXTON.lon }, to: { lat: LEEK.lat, lon: LEEK.lon } },
    );
  });

  test('Add in a day card finds a route outside any trip and uses it as the drive', async () => {
    const { page } = harness;
    await showTripList(page);
    await page.getByRole('treeitem', { name: 'Peak loop', exact: true }).dblclick();
    const cards = page.getByTestId('plan-cards');
    // Between Buxton and Leek: select Buxton, then Add puts the new stop after it.
    await cards.getByRole('button', { name: 'Buxton', exact: true }).click();
    await cards.getByRole('button', { name: /^Add a stop to/ }).first().click();
    await cards.getByRole('textbox', { name: 'Find a stop' }).fill('Wincle');
    const candidate = page.getByTestId('candidate-details');
    await expect(candidate).toContainText('Route, not in a trip');
    await expect(candidate.getByTestId('route-fit')).toContainText('It starts at Buxton.');
    await expect(candidate.getByTestId('route-fit')).toContainText('Leek is where it ends.');
    await candidate.getByRole('button', { name: 'Put it in the plan' }).click();
    // A route is an entry of its own, shown once, between Buxton and Leek.
    await expect(cards.getByTestId('plan-drive')).toHaveText([/Wincle back roads/]);
    await expect(page.getByTestId('drive-details').getByTestId('entry-joins')).toContainText('It starts where Buxton is.');
  });

  test('a route outside any trip is put into a plan from its own details', async () => {
    const { page } = harness;
    await showRoutes(page);
    await page.getByRole('treeitem', { name: 'Goyt Valley run' }).click();
    const put = page.getByTestId('put-in-plan');
    await put.getByRole('combobox', { name: 'Trip to put it in' }).selectOption({ label: 'Peak loop' });
    await expect(put.getByTestId('put-fit')).toContainText('It starts at Buxton.');
    await put.getByRole('button', { name: 'Put it in the plan' }).click();
    await expect(page.getByTestId('trip-header')).toContainText('Peak loop');
    await expect(page.getByTestId('plan-cards').getByRole('button', { name: 'Goyt Valley run', exact: true })).toBeVisible();
  });

  test('a plan can be just a route, and routes and waypoints are dragged in and reordered freely', async () => {
    const { page } = harness;
    await page.evaluate(
      async ({ at }) => {
        const trip = await window.trailrt.trips.create({ name: 'Lanes only', folderId: null });
        if (!trip.ok) return;
        await window.trailrt.itinerary.create({ tripId: trip.data.id, startDate: '2026-11-21', startTime: '10:00' });
        await window.trailrt.waypoints.create({ tripId: trip.data.id, name: 'Monsal Head', lat: at.lat, lon: at.lon });
      },
      { at: { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon } },
    );
    await showTripList(page);
    await page.getByRole('treeitem', { name: 'Lanes only', exact: true }).dblclick();
    const cards = page.getByTestId('plan-cards');
    await cards.getByRole('button', { name: /^Add a stop to/ }).click();
    await cards.getByRole('textbox', { name: 'Find a stop' }).fill('Wincle');
    const candidate = page.getByTestId('candidate-details');
    await expect(candidate.getByTestId('route-fit')).toContainText('It starts the plan.');
    await candidate.getByRole('button', { name: 'Put it in the plan' }).click();
    // Nothing starts or ends it: the plan is the route alone.
    await expect(cards.getByTestId('plan-drive')).toHaveText([/Wincle back roads/]);
    await expect(cards.getByTestId('plan-stop')).toHaveCount(0);
    await expect(page.getByTestId('drive-details').getByTestId('entry-joins')).toContainText('It starts the plan.');

    // A waypoint dragged from Not in the plan onto the route goes in before it.
    const route = cards.getByRole('button', { name: 'Wincle back roads', exact: true });
    await cards.getByTestId('not-in-plan').filter({ hasText: 'Monsal Head' }).dragTo(route, { targetPosition: { x: 20, y: 2 } });
    await expect(cards.getByRole('button', { name: /^(Monsal Head|Wincle back roads)$/ })).toHaveText([/Monsal Head/, /Wincle back roads/]);
    // And the route dragged above it reorders them.
    await route.dragTo(cards.getByRole('button', { name: 'Monsal Head', exact: true }), { targetPosition: { x: 20, y: 2 } });
    await expect(cards.getByRole('button', { name: /^(Monsal Head|Wincle back roads)$/ })).toHaveText([/Wincle back roads/, /Monsal Head/]);
  });

  test('a day is added, filled by dragging, and removed with its entries going to Not in the plan', async () => {
    const { page } = harness;
    const cards = page.getByTestId('plan-cards');
    const days = cards.getByTestId('day-card');
    await expect(days).toHaveCount(1);
    await cards.getByRole('button', { name: 'Add a day', exact: true }).click();
    await expect(days).toHaveCount(2);
    // Monsal Head dragged onto the new, empty day.
    await cards.getByRole('button', { name: 'Monsal Head', exact: true }).dragTo(days.nth(1));
    await expect(days.nth(1)).toContainText('Monsal Head');
    await expect(days.nth(0)).not.toContainText('Monsal Head');
    // Removing the day takes it out of the plan; it stays in the trip.
    const label = (await days.nth(1).getByRole('heading').textContent()) ?? '';
    await days.nth(1).getByRole('button', { name: `Remove ${label}` }).click();
    await expect(days).toHaveCount(1);
    await expect(cards.getByTestId('not-in-plan').filter({ hasText: 'Monsal Head' })).toBeVisible();
    await page.evaluate(() => window.trailrt.undo.undo());
    await expect(days).toHaveCount(2);
    await expect(days.nth(1)).toContainText('Monsal Head');
  });

  test('entries swap within a day by dragging one onto the other, and menus take them out or delete them', async () => {
    const { page } = harness;
    const cards = page.getByTestId('plan-cards');
    const day = cards.getByTestId('day-card').nth(0);
    const entry = (name: string) => cards.getByRole('button', { name, exact: true });
    const order = () => day.getByRole('button', { name: /^(Monsal Head|Wincle back roads)$/ });
    // Bring Monsal Head up into the first day, ahead of the route.
    await entry('Monsal Head').dragTo(entry('Wincle back roads'));
    await expect(order()).toHaveText([/Monsal Head/, /Wincle back roads/]);
    // Dropped on the entry below, it takes that one's place: a swap in one drag.
    await entry('Monsal Head').dragTo(entry('Wincle back roads'));
    await expect(order()).toHaveText([/Wincle back roads/, /Monsal Head/]);

    // An entry's menu takes it out of the plan; it stays in the trip.
    await entry('Monsal Head').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Delete Waypoint' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Take Out of the Plan' }).click();
    const loose = cards.getByTestId('not-in-plan').filter({ hasText: 'Monsal Head' });
    await expect(loose).toBeVisible();

    // Not in the plan has its own menu: put it back, move it out, or delete it.
    await loose.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Add to the End of the Plan' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Move Out of the Trip' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete Waypoint' }).click();
    await expect(loose).toHaveCount(0);
    await page.evaluate(() => window.trailrt.undo.undo());
    await expect(loose).toBeVisible();
  });
});
