import { expect, test, type Page } from '@playwright/test';
import { cleanup, close, launch, makeUserDataDir, type Harness } from './helpers';

/**
 * Phase 14 task 28: backups roll within a space limit, 2 GB by default, and
 * Settings says what they use and what is not in them (Requirement 24),
 * against the built application.
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

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).waitFor();
}

async function closeSettings(page: Page): Promise<void> {
  // dispatchEvent: see import.spec.ts on buttons that close a native <dialog>.
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).dispatchEvent('click');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
}

test('the limit is 2 GB to start with, and Settings says what is and is not backed up', async () => {
  const { page } = harness;
  await openSettings(page);
  await expect(page.getByRole('spinbutton', { name: 'Backup space in GB' })).toHaveValue('2');
  const usage = page.getByTestId('backup-usage');
  await expect(usage).toContainText('No backups yet.');
  await expect(usage).toContainText('Map regions, terrain, place and postcode search and photo thumbnails are not backed up.');
  await closeSettings(page);
});

test('a backup shows in the usage against the limit', async () => {
  const { page } = harness;
  const made = await page.evaluate(async () => {
    const result = await window.trailrt.backup.create();
    return result.ok;
  });
  expect(made).toBe(true);
  await openSettings(page);
  await expect(page.getByTestId('backup-usage')).toContainText(/^1 backup using \d+ MB of 2\.0 GB\./);
  await closeSettings(page);
});

test('the limit can be changed, and is kept', async () => {
  await openSettings(harness.page);
  await harness.page.getByRole('spinbutton', { name: 'Backup space in GB' }).fill('5');
  await expect(harness.page.getByTestId('backup-usage')).toContainText('of 5.0 GB');
  await closeSettings(harness.page);
  await close(harness);
  harness = await launch(userDataDir);
  await openSettings(harness.page);
  await expect(harness.page.getByRole('spinbutton', { name: 'Backup space in GB' })).toHaveValue('5');
  await closeSettings(harness.page);
});
