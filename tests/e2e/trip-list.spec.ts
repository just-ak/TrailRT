import { BUXTON, LEEK } from '@fixtures/places';
import { expect, test } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, showTripList, type Harness } from './helpers';

/**
 * The trip list flow (`docs/design/library-panel/trip-list-flow/`), against
 * the built application. Selecting a trip selects it and nothing more: the
 * list stays, and the right panel shows the trip. Opening its page is its own
 * step, and ‹ Trips comes back to the list as it was left.
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await harness.page.evaluate(
    async ({ from, to }) => {
      const alpha = await window.trailrt.trips.create({ name: 'Alpha', folderId: null });
      await window.trailrt.trips.create({ name: 'Beta', folderId: null });
      if (alpha.ok) {
        await window.trailrt.routes.create({ tripId: alpha.data.id, name: 'Buxton to Leek', points: [from, to] });
      }
    },
    { from: { lat: BUXTON.lat, lon: BUXTON.lon }, to: { lat: LEEK.lat, lon: LEEK.lon } },
  );
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test.describe('the trip list', () => {
  test('selecting a trip shows it on the right and leaves the list where it is', async () => {
    const { page } = harness;
    await showTripList(page);
    const alpha = page.getByRole('treeitem', { name: 'Alpha', exact: true });
    const beta = page.getByRole('treeitem', { name: 'Beta', exact: true });

    await alpha.click();
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('trip-header')).toHaveCount(0);
    await expect(page.getByTestId('companion')).toHaveAttribute('data-view', 'undated');

    await beta.click();
    await expect(beta).toHaveAttribute('aria-selected', 'true');
    await expect(alpha).toBeVisible();
    await expect(page.getByTestId('trip-header')).toHaveCount(0);
    await expect(page.getByTestId('companion')).toHaveAttribute('data-view', 'undated');
  });

  test('a trip opens in place, and what is inside it can be selected from the list', async () => {
    const { page } = harness;
    await showTripList(page);
    const alpha = page.getByRole('treeitem', { name: 'Alpha', exact: true });
    await alpha.click();
    await alpha.press('ArrowRight');
    await expect(alpha).toHaveAttribute('aria-expanded', 'true');

    const route = page.getByRole('treeitem', { name: 'Buxton to Leek' });
    await route.click();
    await expect(page.getByTestId('companion')).toHaveAttribute('data-view', 'object');
    await expect(page.getByTestId('trip-header')).toHaveCount(0);
    await expect(page.getByRole('treeitem', { name: 'Beta', exact: true })).toBeVisible();

    await alpha.click();
    await alpha.press('ArrowLeft');
    await expect(route).toHaveCount(0);
  });

  test('the row’s arrow, Return, a double-click and Open each open the trip; ‹ Trips comes back to it', async () => {
    const { page } = harness;
    const header = page.getByTestId('trip-header');
    const alpha = page.getByRole('treeitem', { name: 'Alpha', exact: true });
    const beta = page.getByRole('treeitem', { name: 'Beta', exact: true });
    const back = page.getByRole('button', { name: 'Back to trips' });

    await showTripList(page);
    await alpha.click();
    await page.getByRole('button', { name: 'Open Alpha' }).click();
    await expect(header.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await back.click();
    await expect(alpha).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('companion')).toHaveAttribute('data-view', 'undated');

    await beta.click();
    await beta.press('Enter');
    await expect(header.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await back.click();
    await expect(beta).toHaveAttribute('aria-selected', 'true');

    await alpha.dblclick();
    await expect(header.getByRole('heading', { name: 'Alpha' })).toBeVisible();
    await back.click();

    await beta.click();
    await page.getByTestId('companion').getByRole('button', { name: 'Open', exact: true }).click();
    await expect(header.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await back.click();
  });
});
