import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

/**
 * Launch helper for the Electron end-to-end tests.
 *
 * Every launch gets its own application support directory via
 * TRAILRT_USER_DATA, so the tests never touch a real user's collection and
 * cannot interfere with each other. Requirement 13.4.
 */

export interface Harness {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'trailrt-e2e-'));
}

/**
 * Launches the development build by default.
 *
 * Set TRAILRT_E2E_APP to the executable inside a packaged .app bundle to run
 * the same suite against a real DMG install:
 *
 *   TRAILRT_E2E_APP="/Applications/TrailRT.app/Contents/MacOS/TrailRT" \
 *     npx playwright test
 *
 * Phase 1's acceptance criteria are about the shipped application, so they are
 * verified against the packaged bundle too, not only the dev output.
 */
export async function launch(userDataDir: string): Promise<Harness> {
  const packaged = process.env.TRAILRT_E2E_APP;
  const env = {
    ...process.env,
    TRAILRT_USER_DATA: userDataDir,
    NODE_ENV: 'production',
  };

  const app = await electron.launch(
    packaged !== undefined && packaged.length > 0
      ? { executablePath: packaged, args: [], env }
      : { args: ['out/main/index.js'], env },
  );

  const page = await app.firstWindow();
  // The app renders a loading state until settings arrive, so wait for the
  // real workspace rather than merely a painted window.
  await page.waitForSelector('[role="tree"]', { timeout: 30_000 });
  return { app, page, userDataDir };
}

export async function close(harness: Harness): Promise<void> {
  await harness.app.close();
}

export function cleanup(userDataDir: string): void {
  rmSync(userDataDir, { recursive: true, force: true });
}

/** Shows the trip list: the rail's Trips section, with no trip open (Phase 14). */
export async function showTripList(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Trips' }).click();
  const back = page.getByRole('button', { name: 'Back to trips' });
  if (await back.isVisible()) await back.click();
}

/** Opens a trip's page by selecting it in the trip list (Phase 14). Nothing to do if it is open. */
export async function openTrip(page: Page, name: string | RegExp): Promise<void> {
  const heading = page.getByTestId('trip-header').getByRole('heading', { name });
  if ((await heading.count()) > 0 && (await page.getByRole('tab', { name: 'Trips' }).getAttribute('aria-selected')) === 'true') {
    // Already open: select the trip itself, as clicking its row used to.
    await heading.click();
    return;
  }
  await showTripList(page);
  await page.getByRole('treeitem', { name }).first().click();
  await page.getByTestId('trip-header').waitFor();
}

/** Creates a trip from the header's More menu, as a user would, and names it in place. */
export async function createTripViaUi(page: Page, name: string): Promise<void> {
  await showTripList(page);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'New Trip' }).click();

  // Creation drops straight into an inline rename with the text selected.
  const input = page.locator('[role="treeitem"] input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(name);
  await input.press('Enter');
  await page.getByRole('treeitem', { name: new RegExp(name) }).waitFor();
}

/** Opens a trip and chooses an item from its page's More menu (Phase 14). */
export async function tripAction(page: Page, trip: string | RegExp, item: string): Promise<void> {
  await openTrip(page, trip);
  await page.getByRole('button', { name: 'More for this trip' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/**
 * Opens the right panel's editor for what is selected: the pencil on its card
 * (Phase 14 Requirement 5.1). Nothing to do if the editor is already open; it
 * stays open while the selection moves between objects.
 */
export async function editSelection(page: Page): Promise<void> {
  const companion = page.getByTestId('companion');
  await companion.waitFor();
  if ((await companion.getAttribute('data-view')) === 'edit') return;
  await companion.getByRole('button', { name: /^Edit/ }).first().click();
  await page.locator('[data-testid="companion"][data-view="edit"]').waitFor();
}

/** Puts the editor away, back to the companion's reading view. */
export async function closeEditor(page: Page): Promise<void> {
  const back = page.getByRole('button', { name: 'Close the editor' });
  if (await back.isVisible()) await back.click();
}
