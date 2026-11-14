import { join } from 'node:path';
import { app, dialog, nativeTheme } from 'electron';
import { EVENTS } from '@shared/ipc/channels';
import { closeContext, ctx, initContext } from './context';
import { configureUserDataPath } from './paths';
import { MigrationError } from './db/migrate';
import { folderScanner, startFolderScanner, stopFolderScanner } from './linkedFolders/runtime';
import { thumbnailCache } from './photoCache/runtime';
import { registerIpcHandlers } from './ipc/register';
import { installApplicationMenu } from './menu/appMenu';
import {
  denyAllPermissions,
  installContentSecurityPolicy,
  installTileUserAgent,
} from './security/csp';
import { currentEmbeddedPaths } from './routing/embeddedLocation';
import * as backupService from './services/backupService';
import * as providerService from './services/providerService';
import * as settingsService from './services/settingsService';
import {
  createMainWindow,
  focusMainWindow,
  getMainWindow,
  sendToRenderer,
  watchSystemTheme,
} from './window';

/**
 * Application entry point.
 *
 * Order of operations matters here: a single-instance lock before anything
 * touches the database, then the database, then security, then the window.
 */

const isDev = !app.isPackaged;

// Before the lock and before Chromium initialises its caches. See paths.ts.
configureUserDataPath();

// Two processes writing one SQLite file is a corruption risk, so a second
// launch focuses the existing window instead. Requirement 1.5.
// A failure during startup must be visible. Without these, a rejected promise
// in `start()` leaves the process alive with no window and no message, which is
// indistinguishable from a hang.
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
  reportFatal(
    'TrailRT hit an unexpected error',
    'An operation failed unexpectedly.',
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error);
  reportFatal(
    'TrailRT hit an unexpected error',
    error.message,
    error.stack ?? undefined,
  );
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);
  void start().catch((cause: unknown) => {
    console.error('[main] startup failed:', cause);
    reportFatal(
      'TrailRT could not start',
      cause instanceof Error ? cause.message : String(cause),
      cause instanceof Error ? cause.stack : undefined,
    );
    app.exit(1);
  });
}

function rendererTarget(): string {
  // electron-vite sets this in development.
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (isDev && devServer !== undefined && devServer.length > 0) {
    return devServer;
  }
  return join(import.meta.dirname, '../renderer/index.html');
}

function reportFatal(title: string, message: string, detail?: string): void {
  // The window may not exist yet, so this uses the module-level dialog.
  dialog.showErrorBox(title, detail === undefined ? message : `${message}\n\n${detail}`);
}

async function start(): Promise<void> {
  await app.whenReady();

  // --- database, before anything that reads settings
  try {
    initContext();
  } catch (cause) {
    if (cause instanceof MigrationError) {
      // Loud and actionable, per Requirement 6.3. A half-migrated database is
      // worse than refusing to start.
      reportFatal(
        'TrailRT could not start',
        `The database could not be upgraded, and no changes were made.\n\nMigration ${cause.version} failed: ${cause.message}`,
        cause.statement,
      );
    } else {
      reportFatal(
        'TrailRT could not start',
        'The local database could not be opened.',
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    app.exit(1);
    return;
  }

  // --- security, before any content loads
  //
  // The surface is read per request rather than captured, so changing the
  // routing endpoint or a custom tile URL in settings takes effect on the next
  // navigation instead of requiring a restart.
  installContentSecurityPolicy(isDev, () => {
    const current = settingsService.all(ctx().handle.db);
    return {
      customTileUrl: current.customTileUrl,
      customOverlayUrl: current.customOverlayUrl,
      routingEndpoint: current.routingEndpoint,
    };
  });
  installTileUserAgent(app.getVersion());
  denyAllPermissions();

  /*
   * Tell the provider layer where the built-in routing engine lives.
   *
   * Injected here rather than imported there, because resolving it needs
   * `app.getPath` and `app.isPackaged`, and `providerService` is unit tested
   * without an Electron runtime. Installed before any IPC handler can run, so
   * the first `routing:status` call already sees the engine.
   */
  providerService.setEmbeddedLocator(currentEmbeddedPaths);

  // --- IPC and menus
  registerIpcHandlers();
  installApplicationMenu();

  // --- theme
  const settings = settingsService.all(ctx().handle.db);
  nativeTheme.themeSource = settings.theme;
  watchSystemTheme();

  // --- window
  const target = rendererTarget();
  const preloadPath = join(import.meta.dirname, '../preload/index.cjs');
  createMainWindow({ rendererTarget: target, preloadPath });

  ctx().notifyLibraryChanged = () => {
    sendToRenderer(EVENTS.libraryChanged);
  };

  scheduleAutomaticBackups();

  // Phase 11: keep linked folders in step with the disk. Started after the
  // window, so launch never waits on a scan (Requirement 9.5).
  startFolderScanner({
    db: () => ctx().handle.db,
    emit: (event) => {
      if (event.type === 'progress') sendToRenderer(EVENTS.linkedFolderScanProgress, event.progress);
      else sendToRenderer(EVENTS.linkedFoldersChanged, { folderId: event.folderId });
    },
  });
  // Thumbnails of folders no longer linked, or files no longer indexed, and
  // the cache bound (design §6.2). Not awaited: launch never waits on it.
  void thumbnailCache(ctx().paths.photoThumbnailsDir)
    .sweep(ctx().handle.db)
    .catch((cause: unknown) => console.error('[photos] thumbnail sweep failed:', cause));
  app.on('browser-window-focus', () => folderScanner()?.onFocus());
  app.on('before-quit', () => stopFolderScanner());

  app.on('activate', () => {
    if (getMainWindow() === null) {
      createMainWindow({ rendererTarget: target, preloadPath });
    }
  });
}

/**
 * Rolling automatic backups on a timer plus one at clean shutdown.
 *
 * Failures are logged, not surfaced: a backup that cannot be written should not
 * interrupt the user's work, and the next tick will try again.
 */
async function runBackup(): Promise<void> {
  try {
    const current = ctx();
    const { backupRetention } = settingsService.all(current.handle.db);
    await backupService.createBackup(
      current.handle,
      current.paths.backupsDir,
      backupRetention,
    );
  } catch (cause) {
    // A backup that cannot be written must not interrupt the user's work; the
    // next tick will try again.
    console.error('[backup] automatic backup failed:', cause);
  }
}

function scheduleAutomaticBackups(): void {
  const intervalHours = settingsService.all(ctx().handle.db).backupIntervalHours;
  const timer = setInterval(
    () => void runBackup(),
    Math.max(1, intervalHours) * 60 * 60 * 1000,
  );
  timer.unref?.();

  let shuttingDown = false;
  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    void runBackup().finally(() => {
      closeContext();
      app.quit();
    });
  });
}

// Closing the only window quits, which is conventional for a single-window
// document-less Mac app. Requirement 1.3.
app.on('window-all-closed', () => {
  app.quit();
});
