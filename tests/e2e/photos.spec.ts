import { cpSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { editSelection, cleanup, close, createTripViaUi, launch, makeUserDataDir, openTrip, type Harness } from './helpers';

/**
 * Phase 11, task 9: a folder linked to a trip, seen in the library.
 *
 * The native folder chooser is replaced in the main process, as the import
 * tests replace the file chooser, so everything after it is the real code:
 * the refusals, the token, the link, the scanner, the tree and the list. The
 * folder is a copy of the synthetic fixtures (test-data/README.md), so the
 * originals are never linked. Task 13 extends this with the map, the preview
 * and the byte-identical check.
 */

const PHOTOS = resolve('test-data', 'generated', 'photos');

let userDataDir: string;
let harness: Harness;
let scratch: string;
let folder: string;

test.skip(!existsSync(PHOTOS), 'photo fixtures not generated (npm run fixtures)');

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  scratch = mkdtempSync(join(tmpdir(), 'trailrt-e2e-photos-'));
  folder = join(scratch, 'Peak 2026');
  cpSync(PHOTOS, folder, { recursive: true, verbatimSymlinks: true });
  harness = await launch(userDataDir);
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
  rmSync(scratch, { recursive: true, force: true });
});

/** Makes the next folder chooser return this folder. */
async function stubFolderChooser(path: string): Promise<void> {
  await harness.app.evaluate(({ dialog }, chosen: string) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, path);
}

async function sendMenuAction(action: string): Promise<void> {
  await harness.app.evaluate(({ BrowserWindow }, name: string) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('event:menuAction', name);
  }, action);
}


test.describe.configure({ mode: 'serial' });

test('File › Link Folder to Trip… with no trip selected says what to do', async () => {
  await sendMenuAction('trip:linkFolder');
  await expect(harness.page.getByText('Select a trip to link a folder to.')).toBeVisible();
});

test('links a folder to a trip from the trip’s properties, and scans it', async () => {
  const { page } = harness;
  await createTripViaUi(page, 'Peak District');
  await openTrip(page, /Peak District/);

  await stubFolderChooser(folder);
  await page.getByTestId('trip-header').getByRole('button', { name: 'Link a folder on disk to this trip' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Peak 2026', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Peak District', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Include subfolders' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Link' }).dispatchEvent('click');

  // The folder is selected and listed, and the scan finishes: 29 photos, of
  // which 9 are not on the map (5 with no location, 4 unreadable).
  const row = page.getByRole('treeitem', { name: 'Peak 2026' }).first();
  await expect(row).toContainText('29 photos · 9 without location', { timeout: 20_000 });
  await editSelection(page);
  await expect(page.getByTestId('linked-folder-files')).toContainText('2 GPX and track files');
  await expect(page.getByTestId('linked-folder-files')).toContainText('1 video');
});

test('lists the folder’s photos in taken-time order, with why each is not on the map', async () => {
  const { page } = harness;
  const list = page.getByTestId('photo-list');
  await expect(list).toBeVisible();
  await expect(page.getByTestId('photo-list-count')).toHaveText('29 photos · 9 not on the map');
  await expect(list.locator('[data-state="unreadable"]').first()).toContainText('Unreadable');
  await expect(list.getByText('No location', { exact: false }).first()).toBeVisible();

  const first = list.getByRole('option').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const second = list.getByRole('option').nth(1);
  await second.click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('photo-list-count')).toContainText('2 selected');
});

test('puts the trip’s located photos on the map, clustered, and marks the selected one', async () => {
  const { page } = harness;
  const markers = page.locator('.trailrt-photo-marker, .trailrt-photo-cluster');
  await expect(markers.first()).toBeVisible({ timeout: 10_000 });

  // The first row is buxton.heic, which records it faced 271.25° true.
  await page.getByTestId('photo-list').getByRole('option').first().click();
  await expect(page.locator('[title="Selected photo, facing 271° true"]')).toBeVisible();

  // A burst: the five burst shots and both leek-o6 photos were taken at the
  // same spot in Leek, so zooming can never separate them.
  await expect(page.locator('[title="7 photos taken here"]')).toBeAttached();
});

test('the preview box shows the selected photo above the panel toggles, and the keys step and close it', async () => {
  const { page } = harness;
  const preview = page.getByTestId('photo-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('photo-preview-image')).toBeVisible();
  await expect(preview).toContainText('buxton.heic');
  await expect(preview.getByTestId('photo-preview-taken')).toHaveText('14 Jun 2026, 10:32 (UTC+01:00)');
  await expect(preview.getByTestId('photo-preview-location')).toContainText('301 m');
  await expect(preview.getByTestId('photo-preview-location')).toContainText('±8 m');

  // Above the toggles, not over them (Requirement 6.1).
  const box = await preview.boundingBox();
  const toggles = await page.getByTestId('panel-toggles').boundingBox();
  expect(box !== null && toggles !== null && box.y + box.height <= toggles.y).toBe(true);

  // At the smallest window the app allows (1024 × 700), with the library,
  // the properties and the photo list all open, the map is shorter than the
  // preview's natural height. It shrinks to fit, and never reaches the search
  // box or runs off the map (Requirement 6.2).
  const size = await harness.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const before = window?.getContentSize() ?? [1280, 800];
    window?.setContentSize(1024, 700);
    return before;
  });
  try {
    await expect(async () => {
      const map = await page.locator('.leaflet-container').boundingBox();
      const small = await preview.boundingBox();
      const search = await page.getByPlaceholder('Postcode, town or street').boundingBox();
      expect(map !== null && small !== null && search !== null).toBe(true);
      if (map === null || small === null || search === null) return;
      expect(map.height).toBeLessThan(500);
      expect(small.y).toBeGreaterThanOrEqual(search.y + search.height);
      expect(small.y + small.height).toBeLessThanOrEqual(map.y + map.height);
      expect(small.x + small.width).toBeLessThanOrEqual(map.x + map.width);
    }).toPass({ timeout: 5000 });
  } finally {
    await harness.app.evaluate(({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(w ?? 1280, h ?? 800);
    }, size);
  }

  // The picture is the thumbnail, served as a blob: URL, never a file: path.
  const src = await preview.getByTestId('photo-preview-image').getAttribute('src');
  expect(src?.startsWith('blob:')).toBe(true);

  await preview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(preview).toContainText('buxton.jpg');
  await expect(preview.getByTestId('photo-preview-position')).toHaveText('2 of 29');
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
});

test('a burst opens at its first photo, and the preview steps through it', async () => {
  const { page } = harness;
  await page.locator('[title="7 photos taken here"]').click();
  const preview = page.getByTestId('photo-preview');
  await expect(preview.getByTestId('photo-preview-position')).toHaveText('1 of 7 here');
  await preview.getByRole('button', { name: 'Next photo' }).click();
  await expect(preview.getByTestId('photo-preview-position')).toHaveText('2 of 7 here');
  await preview.getByRole('button', { name: 'Close the preview' }).click();
  await expect(preview).toHaveCount(0);
});

test('an unplugged folder’s photo says so and still shows its saved thumbnail', async () => {
  const { page } = harness;
  // Select buxton.heic, whose thumbnail has been made, then "unplug" the drive.
  await page.getByTestId('photo-list').getByRole('option').first().click();
  await expect(page.getByTestId('photo-preview-image')).toBeVisible();
  renameSync(folder, `${folder}-unplugged`);
  try {
    await editSelection(page);
    await page.getByTestId('linked-folder-actions').getByRole('button', { name: /Rescan/ }).click();
    const preview = page.getByTestId('photo-preview');
    await expect(preview.getByTestId('photo-preview-status')).toHaveText('Unavailable — Peak 2026 is not connected', {
      timeout: 10_000,
    });
    await expect(preview.getByRole('button', { name: /Unavailable/ }).first()).toBeDisabled();
    // Step away and back: the thumbnail comes from the cache, with no path.
    await preview.getByRole('button', { name: 'Next photo' }).click();
    await preview.getByRole('button', { name: 'Previous photo' }).click();
    await expect(preview.getByTestId('photo-preview-image')).toBeVisible();
  } finally {
    renameSync(`${folder}-unplugged`, folder);
  }
  await page.getByTestId('linked-folder-actions').getByRole('button', { name: /Rescan/ }).click();
  await expect(page.getByTestId('photo-preview-status')).toHaveCount(0, { timeout: 10_000 });
  await page.getByTestId('photo-preview').getByRole('button', { name: 'Close the preview' }).click();
});

test('the Layers menu hides and shows the photos', async () => {
  const { page } = harness;
  const markers = page.locator('.trailrt-photo-marker, .trailrt-photo-cluster');
  await page.getByRole('button', { name: 'Map layers' }).click();
  const toggle = page.getByRole('checkbox', { name: 'Photos', exact: true });
  await toggle.uncheck();
  await expect(markers).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Show unavailable photos' })).toBeDisabled();
  await toggle.check();
  await expect(markers.first()).toBeVisible();
  await page.getByRole('button', { name: 'Map layers' }).click();
});

test('selecting the Photos view shows every trip’s photos, and selecting a trip goes back', async () => {
  const { page } = harness;
  // Phase 14: the rail's Photos section is all-trips mode.
  const view = page.getByRole('tab', { name: 'Photos', exact: true });
  await view.click();
  await expect(view).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.trailrt-photo-marker, .trailrt-photo-cluster').first()).toBeVisible();
  await openTrip(page, /Peak District/);
  await expect(view).toHaveAttribute('aria-selected', 'false');
});

test('refuses the same folder twice for one trip, with its reason', async () => {
  const { page } = harness;
  await openTrip(page, /Peak District/);
  await stubFolderChooser(folder);
  await page.getByTestId('trip-header').getByRole('button', { name: 'Link a folder on disk to this trip' }).click();
  await expect(page.getByText('This folder is already linked to Peak District.')).toBeVisible();
});

test('shows every linked folder in the Photos view, annotated with its trip, with filters', async () => {
  const { page } = harness;
  await page.getByRole('tab', { name: 'Photos', exact: true }).click();
  await expect(page.getByTestId('photo-view-filters')).toBeVisible();
  const rows = page.locator('[data-path^="view:photos/linkedFolder:"]');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Peak District · 29 photos');

  // A year with no photos is not offered; "No date" only when some photo lacks one.
  const years = await page.getByRole('combobox', { name: 'Year' }).locator('option').allTextContents();
  expect(years[0]).toBe('All years');
  expect(years.some((y) => /^\d{4} \(\d+\)$/.test(y))).toBe(true);
});

test('unlinks after confirmation, and undo brings the folder back', async () => {
  const { page } = harness;
  await page.getByRole('treeitem', { name: 'Peak 2026' }).first().click();
  await editSelection(page);
  await page.getByRole('button', { name: /Unlink the folder/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The files stay where they are on disk.');
  await dialog.getByRole('button', { name: 'Unlink' }).dispatchEvent('click');
  // Phase 14: the trip's linked folders are on its page's Photos tab.
  await openTrip(page, /Peak District/);
  await page.getByTestId('trip-tabs').getByRole('tab', { name: /^Photos/ }).click();
  const folders = page.getByRole('tree', { name: 'Peak District linked folders' });
  await expect(folders).toBeVisible();
  await expect(folders.getByRole('treeitem')).toHaveCount(0);

  await page.evaluate(() => window.trailrt.undo.undo());
  const row = page.getByRole('treeitem', { name: 'Peak 2026' }).first();
  await expect(row).toContainText('29 photos', { timeout: 20_000 });
});
