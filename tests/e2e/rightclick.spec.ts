import { ASHBOURNE, LEEK } from '@fixtures/places';
import { expect, test } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 14 task 12 (Requirement 13.1 and 13.2): a right-click offers what can
 * be made where it lands, in a list's empty space and on the map's ground.
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test('the Routes section’s empty space offers a new route, not a new trip', async () => {
  const { page } = harness;
  await page.getByRole('tab', { name: 'Routes', exact: true }).click();
  const list = page.getByRole('tree', { name: 'Routes' });
  await list.click({ button: 'right', position: { x: 40, y: 40 } });
  await expect(page.getByRole('menuitem', { name: 'New Route', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New Trip' })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('the map’s ground offers a waypoint or a route, and the waypoint is made where it was opened', async () => {
  const { page } = harness;
  const map = page.locator('.leaflet-container');
  await map.click({ button: 'right', position: { x: 260, y: 260 } });
  await expect(page.getByRole('menuitem', { name: 'Start a New Route Here' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add a Waypoint Here' }).click();
  // From the Routes section, it is made outside any trip (Requirement 9.2).
  await expect(page.getByTestId('object-card')).toContainText('New Waypoint');
  await expect(page.getByTestId('object-card')).toContainText('Not in a trip');
});

test('two waypoints selected can be joined with a new route, or a straight line without routing', async () => {
  const { page } = harness;
  await page.evaluate(
    async (places) => {
      const loose = await window.trailrt.trips.loose();
      if (!loose.ok) return;
      for (const p of places) await window.trailrt.waypoints.create({ tripId: loose.data.id, name: p.name, lat: p.lat, lon: p.lon });
    },
    [LEEK, ASHBOURNE].map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
  );
  await page.getByRole('tab', { name: 'Waypoints', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Leek', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Ashbourne', exact: true }).click({ modifiers: ['Meta'] });
  await page.getByRole('treeitem', { name: 'Ashbourne', exact: true }).click({ button: 'right' });
  // This test app has no map regions, so by road says why and points to the straight line.
  await page.getByRole('menuitem', { name: 'Join with a New Route' }).click();
  await expect(page.getByText(/Join with a straight line instead/)).toBeVisible();
  await page.getByRole('treeitem', { name: 'Ashbourne', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Join with a Straight Line' }).click();
  await expect(page.getByTestId('object-card')).toContainText(/Leek → Ashbourne|Ashbourne → Leek/);
});
