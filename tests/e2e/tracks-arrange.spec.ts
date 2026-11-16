import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 14 task 24: the Tracks section by name, by date as a tree of year ›
 * month › day, or by distance, either way, kept across a restart
 * (Requirement 22), against the built application.
 *
 * The fixtures: Peak District ride (16 May 2026, Buxton), Legacy Track
 * (2 May 2026, Zürich), Extended Track (2 September 2026) and Untimed Track,
 * which has no times at all.
 */

const FIXTURES = resolve('test-data');
const FILES = [
  join(FIXTURES, 'generated', 'peak-district-loop.gpx'),
  join(FIXTURES, 'legacy-1.0.gpx'),
  join(FIXTURES, 'with-extensions.gpx'),
  join(FIXTURES, 'no-time.gpx'),
];

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  const { app, page } = harness;
  await app.evaluate(({ dialog }, filePaths: string[]) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
  }, FILES);
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
});

async function showTracks(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Tracks', exact: true }).click();
  await page.getByRole('tree', { name: 'Tracks' }).waitFor();
}

const arrange = (page: Page) => page.getByRole('combobox', { name: 'Arrange tracks by' });
const order = (page: Page) => page.getByRole('button', { name: /^Order: / });
/** The visible rows, top to bottom, by their own names. */
async function rowNames(page: Page): Promise<string[]> {
  const rows = page.getByRole('tree', { name: 'Tracks' }).getByRole('treeitem');
  return rows.evaluateAll((items) => items.map((item) => (item.getAttribute('aria-label') ?? item.textContent ?? '').trim()));
}
const row = (page: Page, name: string | RegExp) => page.getByRole('tree', { name: 'Tracks' }).getByRole('treeitem', { name });

/** Opens a group row if it is closed. A double-click toggles a row that has children. */
async function openRow(page: Page, name: RegExp): Promise<void> {
  const target = row(page, name);
  if ((await target.getAttribute('aria-expanded')) === 'false') await target.dblclick();
  await expect(target).toHaveAttribute('aria-expanded', 'true');
}

test('starts as a flat list by name, A to Z', async () => {
  const { page } = harness;
  await showTracks(page);
  await expect(arrange(page)).toHaveValue('name');
  await expect(order(page)).toHaveText('A to Z');
  await expect(row(page, /Extended Track/)).toBeVisible();
  expect(await rowNames(page)).toEqual(['Extended Track', 'Legacy Track', 'Peak District ride', 'Untimed Track']);
});

test('by date: year › month › day, newest first, the latest month open, undated last', async () => {
  const { page } = harness;
  await showTracks(page);
  await arrange(page).selectOption('date');
  await expect(order(page)).toHaveText('Newest first');

  // 2026 and September open at once, with its day and track showing.
  await expect(row(page, /^2026/)).toBeVisible();
  await expect(row(page, /^September/)).toBeVisible();
  await expect(row(page, /2 September/)).toBeVisible();
  await expect(row(page, /Extended Track/)).toBeVisible();
  // May is there, closed; its days appear when it is opened.
  await expect(row(page, /^May/)).toBeVisible();
  await expect(row(page, /16 May/)).toHaveCount(0);
  await openRow(page, /^May/);
  await expect(row(page, /16 May/)).toBeVisible();
  await expect(row(page, /2 May/)).toBeVisible();
  const names = await rowNames(page);
  expect(names.findIndex((n) => /16 May/.test(n))).toBeLessThan(names.findIndex((n) => /2 May/.test(n)));
  // No date comes last, and never pretends to a date.
  expect(names.at(-1)).toMatch(/^No date/);
});

test('oldest first turns the whole tree round, No date still last', async () => {
  const { page } = harness;
  await showTracks(page);
  await order(page).click();
  await expect(order(page)).toHaveText('Oldest first');
  const names = await rowNames(page);
  const may = names.findIndex((n) => n.startsWith('May'));
  const september = names.findIndex((n) => n.startsWith('September'));
  expect(may).toBeGreaterThanOrEqual(0);
  expect(may).toBeLessThan(september);
  expect(names.at(-1)).toMatch(/^No date/);
});

test('a track in a zone TrailRT does not know says how it was dated', async () => {
  const { page } = harness;
  await showTracks(page);
  await openRow(page, /^May/);
  await openRow(page, /2 May/);
  await expect(row(page, /Legacy Track/)).toHaveAttribute('title', /computer's time zone/);
  await openRow(page, /16 May/);
  await expect(row(page, /Peak District ride/)).not.toHaveAttribute('title', /computer's time zone/);
});

test('search narrows inside the tree, opening the way to a match', async () => {
  const { page } = harness;
  await showTracks(page);
  await page.getByRole('searchbox', { name: 'Search trips' }).fill('legacy');
  await expect(row(page, /^2026/)).toBeVisible();
  await expect(row(page, /^May/)).toBeVisible();
  await expect(row(page, /Legacy Track/)).toBeVisible();
  await expect(row(page, /Extended Track/)).toHaveCount(0);
  await expect(row(page, /^September/)).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search trips' }).fill('');
});

test('by distance, longest first, with each length shown', async () => {
  const { page } = harness;
  await showTracks(page);
  await arrange(page).selectOption('distance');
  await expect(order(page)).toHaveText('Longest first');
  await expect(row(page, /^2026/)).toHaveCount(0);
  await expect(row(page, /Peak District ride/)).toContainText(/km/);
});

test('the arrangement and its direction survive a restart', async () => {
  await showTracks(harness.page);
  await arrange(harness.page).selectOption('date');
  await order(harness.page).click();
  await expect(order(harness.page)).toHaveText('Oldest first');
  await close(harness);
  harness = await launch(userDataDir);
  await showTracks(harness.page);
  await expect(arrange(harness.page)).toHaveValue('date');
  await expect(order(harness.page)).toHaveText('Oldest first');
  await expect(row(harness.page, /^2026/)).toBeVisible();
});
