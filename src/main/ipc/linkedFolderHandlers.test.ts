import { describe, expect, it, vi } from 'vitest';
import { CHANNELS } from '@shared/ipc/channels';
import type { Result } from '@shared/ipc/result';

/**
 * Phase 11 task 8: every linked-folder and photo handler refuses a malformed
 * payload before any service runs, and never opens a dialog or the shell for
 * one. The real `registerIpcHandlers` is wired against a stubbed Electron, so
 * this tests the handlers as registered, not only their schemas.
 */

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<Result<unknown>>>();
const showOpenDialog = vi.fn();
const openPath = vi.fn();
const showItemInFolder = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload: unknown) => Promise<Result<unknown>>) => {
      handlers.set(channel, fn);
    },
  },
  app: { getVersion: () => '0.0.0', getPath: () => '/nonexistent', isPackaged: false, name: 'TrailRT' },
  dialog: { showOpenDialog, showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  shell: { openPath, showItemInFolder, openExternal: vi.fn() },
  nativeImage: { createThumbnailFromPath: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  screen: { getAllDisplays: () => [] },
}));

const { registerIpcHandlers } = await import('./register');
registerIpcHandlers();

const VALID = '0190c3ae-1f2b-4c4d-9e8f-1a2b3c4d5e6f';

/** Payloads every Phase 11 channel must refuse. */
const MALFORMED: unknown[] = [
  undefined,
  null,
  'a string',
  42,
  [],
  { folderId: 'not-a-uuid', photoId: 'not-a-uuid', tripId: 'not-a-uuid', token: 'not-a-uuid' },
  { path: '/Users/someone/Pictures' },
  { photoId: '../../etc/passwd' },
  { folderId: VALID, photoId: VALID, tripId: VALID, token: VALID, include: true, includeSubfolders: true, extra: 1 },
];

const CHANNELS_UNDER_TEST = [...Object.values(CHANNELS.linkedFolders), ...Object.values(CHANNELS.photos), CHANNELS.trips.overview];

describe('Phase 11 handlers', () => {
  it('registers every linked-folder and photo channel', () => {
    for (const channel of CHANNELS_UNDER_TEST) expect(handlers.has(channel), channel).toBe(true);
  });

  it.each(CHANNELS_UNDER_TEST)('%s refuses every malformed payload', async (channel) => {
    const handler = handlers.get(channel);
    expect(handler).toBeDefined();
    const results = await Promise.all(MALFORMED.map((payload) => handler?.(null, payload)));
    for (const [i, result] of results.entries()) {
      expect(result?.ok, `${channel} accepted ${JSON.stringify(MALFORMED[i])}`).toBe(false);
      if (result?.ok === false) expect(result.error.code).toBe('INVALID_REQUEST');
    }
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('takes a photo only by id: a path in place of one is refused', async () => {
    const channels = [CHANNELS.photos.open, CHANNELS.photos.reveal, CHANNELS.photos.thumbnail];
    const results = await Promise.all(
      channels.map((channel) => handlers.get(channel)?.(null, { photoId: '/Users/someone/Pictures/a.jpg' })),
    );
    for (const result of results) expect(result?.ok).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('refuses a map scope that mixes one trip with all trips, or an impossible year', async () => {
    const mapPoints = handlers.get(CHANNELS.photos.mapPoints);
    const payloads = [
      { tripId: VALID, all: true },
      { all: false },
      { all: true, year: 99_999 },
      { all: true, year: 2024.5 },
      { all: true, year: 'last' },
    ];
    const results = await Promise.all(payloads.map((payload) => mapPoints?.(null, payload)));
    for (const [i, result] of results.entries()) expect(result?.ok, JSON.stringify(payloads[i])).toBe(false);
  });
});
