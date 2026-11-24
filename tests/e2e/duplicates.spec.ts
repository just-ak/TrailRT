import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 14 task 31 (Requirement 28, ADR 0027), against the built application:
 * duplicates by content, whatever their names. The same ride is imported
 * twice under two names, a route is drawn twice, and a waypoint is copied
 * into a second trip.
 */

let userDataDir: string;
let harness: Harness;
let scratch: string;

test.describe.configure({ mode: 'serial' });

/** One synthetic ride, with heights and times, under a given track name. */
function ride(name: string): string {
  const points = [BUXTON, LEEK, ASHBOURNE]
    .map((p, i) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${300 - i * 50}</ele><time>2026-05-16T09:0${i}:00Z</time></trkpt>`)
    .join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="TrailRT tests" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>${points}</trkseg></trk></gpx>`;
}

test.beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'trailrt-duplicates-'));
  const files = [join(scratch, 'morning.gpx'), join(scratch, 'export.gpx')];
  writeFileSync(files[0] ?? '', ride('Morning ride'));
  writeFileSync(files[1] ?? '', ride('Garmin export 0516'));

  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  const { app, page } = harness;
  await page.evaluate(
    async ({ from, to, at }) => {
      const peak = await window.trailrt.trips.create({ name: 'Peak loop', folderId: null });
      const wales = await window.trailrt.trips.create({ name: 'Wales', folderId: null });
      if (!peak.ok || !wales.ok) return;
      await window.trailrt.routes.create({ tripId: peak.data.id, name: 'Cat and Fiddle', points: [from, to] });
      await window.trailrt.routes.create({ tripId: peak.data.id, name: 'A537', points: [from, to] });
      for (const tripId of [peak.data.id, wales.data.id]) {
        await window.trailrt.waypoints.create({ tripId, name: 'Ashbourne market', lat: at.lat, lon: at.lon, eleM: null, description: null, symbol: 'pin', notes: null, groupId: null });
      }
    },
    {
      from: { lat: MACCLESFIELD.lat, lon: MACCLESFIELD.lon },
      to: { lat: BUXTON.lat, lon: BUXTON.lon },
      at: { lat: ASHBOURNE.lat, lon: ASHBOURNE.lon },
    },
  );

  // Both files, imported from the Tracks section, land outside any trip.
  await page.getByRole('tab', { name: 'Tracks', exact: true }).click();
  await app.evaluate(({ dialog }, filePaths: string[]) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, files);
  await page.getByRole('button', { name: 'Import files' }).click();
  await page.getByRole('heading', { name: /^Import \d+ file/ }).waitFor({ timeout: 20_000 });
  // dispatchEvent: see import.spec.ts on buttons that close a native <dialog>.
  await page.getByRole('button', { name: 'Confirm import' }).dispatchEvent('click');
  await page.getByRole('heading', { name: 'Import report' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Close import report' }).dispatchEvent('click');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
  rmSync(scratch, { recursive: true, force: true });
});

async function showSection(page: Page, name: 'Tracks' | 'Routes' | 'Waypoints'): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByRole('tree', { name }).waitFor();
}

/** From the panel's More menu. */
async function openFromMore(page: Page, item: string): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('finds the same ride imported under two names, removes the copy, and undo puts it back', async () => {
  const { page } = harness;
  await showSection(page, 'Tracks');
  const tracks = page.getByRole('tree', { name: 'Tracks' }).getByRole('treeitem');
  await expect(tracks).toHaveCount(2);

  await openFromMore(page, 'Remove Duplicate Tracks…');
  const dialog = page.getByTestId('remove-duplicates');
  await expect(dialog).toContainText('Compared 2 tracks');
  const group = dialog.getByTestId('duplicate-group');
  await expect(group).toHaveCount(1);
  await expect(group.getByRole('checkbox')).toBeChecked();
  await expect(group).toContainText('Not in a trip');
  await page.getByRole('button', { name: 'Remove 1 copy' }).dispatchEvent('click');

  await expect(page.getByText('Removed 1 duplicate track. Undo puts them back.')).toBeVisible();
  await expect(tracks).toHaveCount(1);

  await page.evaluate(() => window.trailrt.undo.undo());
  await expect(tracks).toHaveCount(2);
  await expect(page.getByRole('treeitem', { name: /Morning ride/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Garmin export 0516/ })).toBeVisible();
});

test('finds routes with the same line under different names, from the list’s right-click menu', async () => {
  const { page } = harness;
  await showSection(page, 'Routes');
  const tree = page.getByRole('tree', { name: 'Routes' });
  const box = await tree.boundingBox();
  if (box === null) throw new Error('the Routes list has no box');
  await tree.click({ button: 'right', position: { x: 20, y: box.height - 10 } });
  await page.getByRole('menuitem', { name: 'Remove Duplicate Routes…' }).click();

  const group = page.getByTestId('duplicate-group');
  await expect(group).toContainText('Keep Cat and Fiddle');
  await expect(group).toContainText('Remove A537');
  await page.getByRole('button', { name: 'Remove 1 copy' }).dispatchEvent('click');
  await expect(page.getByRole('treeitem', { name: /A537/ })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /Cat and Fiddle/ })).toBeVisible();

  // Once there are none, the dialog says how many it compared.
  await openFromMore(page, 'Remove Duplicate Routes…');
  await expect(page.getByTestId('no-duplicates')).toHaveText('Compared 1 route. None have the same points along the line as another.');
  await page.getByRole('button', { name: 'Close' }).dispatchEvent('click');
});

test('offers a waypoint copied into another trip unticked', async () => {
  const { page } = harness;
  await showSection(page, 'Waypoints');
  await openFromMore(page, 'Remove Duplicate Waypoints…');
  const group = page.getByTestId('duplicate-group');
  await expect(group).toContainText('In more than one trip, so not ticked');
  await expect(group.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Remove 0 copies' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).dispatchEvent('click');
});
