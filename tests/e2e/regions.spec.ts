import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { BUXTON } from '@fixtures/places';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Phase 7 in the running app (ADR 0018): the UK county map, the assumed-limits
 * setting, and the twisty score in a profile.
 *
 * No network. The region index is seeded from `test-data/geofabrik-uk.json`
 * before launch, and the app reads a fresh cached index before it would fetch
 * one. Every download URL in that fixture is a `.invalid` host, so nothing
 * here can start a real download — sizes come back unknown, which the picker
 * handles and which is asserted below.
 */

const TRIP = 'Regions Trip';
let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  mkdirSync(join(userDataDir, 'valhalla'), { recursive: true });
  copyFileSync(
    resolve('test-data/geofabrik-uk.json'),
    join(userDataDir, 'valhalla', 'geofabrik-index.json'),
  );
  harness = await launch(userDataDir);
  await createTripViaUi(harness.page, TRIP);
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test.describe('the region picker', () => {
  test('opens on a UK county map and selects several regions', async () => {
    const { page } = harness;

    // Reached the way a first-time user reaches it: New Route, no map yet.
    await page.getByRole('treeitem', { name: new RegExp(TRIP) }).click();
    await page.getByRole('button', { name: 'New Route', exact: true }).click();
    await page.getByRole('button', { name: 'Add map regions…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Map regions for road routing' });
    await expect(dialog).toBeVisible();
    const map = dialog.getByRole('group', { name: 'Map of downloadable UK regions' });
    await expect(map).toBeVisible();

    // Fifty regions: England's 47, Scotland, Wales, and the island of Ireland.
    expect(await map.getByRole('checkbox').count()).toBe(50);

    // From the keyboard, which a map of fifty shapes must support.
    const derbyshire = map.getByRole('checkbox', { name: 'Derbyshire' });
    await derbyshire.focus();
    await page.keyboard.press(' ');
    await expect(derbyshire).toHaveAttribute('aria-checked', 'true');

    // And by pointer.
    const cheshire = map.getByRole('checkbox', { name: 'Cheshire' });
    await cheshire.dispatchEvent('click');
    await expect(cheshire).toHaveAttribute('aria-checked', 'true');

    const selected = dialog.getByRole('list', { name: 'Selected regions' });
    await expect(selected.getByText('Derbyshire')).toBeVisible();
    await expect(selected.getByText('Cheshire')).toBeVisible();
    // No network in tests, so the sizes are honestly unknown rather than 0.
    await expect(dialog.getByText(/2 regions · size unknown/)).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Download and build 2 regions' }),
    ).toBeEnabled();

    // Northern Ireland only comes with the Republic, and the picker says so.
    const ireland = map.getByRole('checkbox', { name: 'Ireland and Northern Ireland' });
    await ireland.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(/only published together with the Republic/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove Ireland and Northern Ireland' }).click();
    await expect(ireland).toHaveAttribute('aria-checked', 'false');

    // What pressing the button does is stated before it is pressed.
    await expect(dialog.getByText(/replaces the map that is loaded now/)).toBeVisible();

    // Elsewhere keeps the view-based list for the rest of the world.
    await dialog.getByRole('tab', { name: 'Elsewhere' }).click();
    await expect(dialog.getByText(/For places outside the UK/)).toBeVisible();
    // Switching back keeps the selection.
    await dialog.getByRole('tab', { name: 'United Kingdom' }).click();
    await expect(map.getByRole('checkbox', { name: 'Derbyshire' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});

test.describe('assumed UK limits', () => {
  test('are on by default, and can be turned off in Settings', async () => {
    const { app, page } = harness;
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('event:menuAction', 'settings:open');
    });

    const toggle = page.getByRole('checkbox', { name: 'Assume UK default speed limits' });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const all = await window.trailrt.settings.all();
          return all.ok ? all.data.ukDefaultSpeedLimits : null;
        }),
      )
      .toBe(false);
    await toggle.check();
    await page.keyboard.press('Escape');
  });
});

test.describe('the twisty score', () => {
  test('appears in the profile of a route that follows a winding line', async () => {
    const { page } = harness;

    // A 3 km line snaking every 20 m out of Buxton: road-like density, so it can
    // be scored, without needing a routing graph.
    const routeId = await page.evaluate(async (start) => {
      const trips = await window.trailrt.trips.list({});
      const tripId = trips.ok ? trips.data[0]?.id : undefined;
      if (tripId === undefined) return null;
      const points = Array.from({ length: 150 }, (_, i) => ({
        lat: start.lat + i * 0.00018,
        lon: start.lon + 0.0006 * Math.sin(i / 3),
        ele: null,
        name: null,
        symbol: null,
        notes: null,
      }));
      const created = await window.trailrt.routes.create({ tripId, name: 'Winding', points });
      return created.ok ? created.data.id : null;
    }, BUXTON);
    expect(routeId).not.toBeNull();

    await page.reload();
    await page.waitForSelector('[role="tree"]');
    await page.getByRole('treeitem', { name: new RegExp(TRIP) }).dblclick();
    await page.getByRole('treeitem', { name: /Winding/ }).first().click();
    await page.getByRole('button', { name: 'Profile' }).click();

    const drawer = page.getByRole('region', { name: 'Route profile' });
    await expect(drawer.getByText(/Twisty score \d+\.\d \/ 10/)).toBeVisible();
    await expect(drawer.getByText(/°\/km of bends/)).toBeVisible();
    await page.getByRole('button', { name: 'Close profile' }).click();
  });
});
