import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { embeddedPaths, type EmbeddedPaths } from './embedded';

/**
 * Locates the embedded routing engine on this installation.
 *
 * Kept apart from `embedded.ts` because it is the only part that needs
 * `electron.app`, and keeping that import out of `embedded.ts` is what lets the
 * engine logic be unit tested without an Electron runtime.
 *
 * ## The packaged and development layouts differ, and not in the obvious way
 *
 * Packaged, `process.resourcesPath` is `TrailRT.app/Contents/Resources`, where
 * electron-builder puts the engine via `extraResources`. Simple.
 *
 * In development it is tempting to use `app.getAppPath()`, but that returns
 * **`out/main`**, not the project root: electron-vite emits a `package.json`
 * alongside the bundled main process, and Electron anchors the app path to the
 * nearest one. So `join(app.getAppPath(), 'resources')` resolves to
 * `out/main/resources`, which never exists — the engine then reports itself
 * missing from a checkout where it is sitting right there, and the message
 * tells you to rebuild something you already built.
 *
 * Rather than hard-code `../..`, which breaks the moment the bundle layout
 * changes, this searches a few levels up for a directory that actually contains
 * the engine.
 */

/** How far to look up from the app path before giving up. */
const MAX_LEVELS = 4;

function developmentResourcesDir(): string {
  const base = app.getAppPath();

  for (let level = 0; level <= MAX_LEVELS; level += 1) {
    const candidate = resolve(base, ...Array.from({ length: level }, () => '..'), 'resources');
    if (existsSync(join(candidate, 'valhalla', 'valhalla_node.node'))) {
      return candidate;
    }
  }

  /*
   * Nothing found. Returning the project-root guess rather than the app path
   * means the "engine is missing" message names the directory a developer would
   * actually put it in, instead of a bundle subdirectory they have never heard
   * of.
   */
  return resolve(base, '..', '..', 'resources');
}

export function currentEmbeddedPaths(): EmbeddedPaths {
  const resources = app.isPackaged
    ? process.resourcesPath
    : developmentResourcesDir();

  return embeddedPaths(app.getPath('userData'), resources);
}
