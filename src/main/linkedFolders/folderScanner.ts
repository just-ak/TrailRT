import { watch as fsWatch } from 'node:fs';
import type { FolderState, LinkedFolder } from '@shared/domain/linkedFolders';
import type { PhotoMetadataReader } from '@shared/photos/PhotoMetadataReader';
import type { Db } from '../db/client';
import * as foldersRepo from '../db/repositories/linkedFolders';
import { folderAvailability, scanFolder, type ScanDeps, type ScanOutcome, type ScanProgress } from './scanner';

/**
 * Keeps every linked folder's index in step with the disk. Phase 11, design
 * §5.5 to §5.8.
 *
 * - One scan per folder at a time. A rescan asked for while one runs sets a
 *   "run again" flag instead of starting a second walk. At most two folders
 *   scan at once, so a library of a hundred folders is worked through in turn.
 * - A folder's state (`available`, `scanning`, `missing`, `denied`) is held
 *   here, at runtime, and never stored: it would be wrong the moment a drive
 *   came back.
 * - The file watcher is a **hint** that triggers an incremental rescan, never
 *   the record of what changed, so a missed or coalesced event is harmless.
 * - While any folder is missing, each is checked every 30 s, and scanned when
 *   it reappears (Requirement 3.4).
 */

export type { FolderState } from '@shared/domain/linkedFolders';

export interface FolderRuntime {
  state: FolderState;
  progress: ScanProgress | null;
  lastOutcome: ScanOutcome | null;
}

export type ScannerEvent = { type: 'progress'; progress: ScanProgress } | { type: 'changed'; folderId: string };

export interface WatchHandle {
  close(): void;
}

export type WatchFn = (path: string, onChange: () => void, onError: () => void) => WatchHandle;

/** `fs.watch` recursive: FSEvents on macOS, for internal and attached drives. */
export const fsWatchRecursive: WatchFn = (path, onChange, onError) => {
  const watcher = fsWatch(path, { recursive: true, persistent: false }, () => onChange());
  watcher.on('error', () => onError());
  return { close: () => watcher.close() };
};

export interface FolderScannerOptions {
  db: () => Db;
  reader: PhotoMetadataReader;
  emit?: (event: ScannerEvent) => void;
  watch?: WatchFn;
  /** Test seams passed to each scan. */
  scanDeps?: Pick<ScanDeps, 'readFile' | 'datalessCheck' | 'progressMs'>;
  debounceMs?: number;
  missingPollMs?: number;
  maxConcurrent?: number;
  /** A folder last scanned longer ago than this is rescanned when the app regains focus. */
  staleAfterMs?: number;
  now?: () => number;
}

interface Entry {
  runtime: FolderRuntime;
  /** Path and subfolder setting the entry was set up for; a change means rescan. */
  signature: string;
  running: AbortController | null;
  again: boolean;
  queued: boolean;
  watcher: WatchHandle | null;
  debounce: ReturnType<typeof setTimeout> | null;
}

function signatureOf(folder: LinkedFolder): string {
  return `${folder.path}\u0000${folder.includeSubfolders ? 1 : 0}`;
}

export class FolderScanner {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private active = 0;
  private poll: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private idleWaiters: (() => void)[] = [];

  private readonly debounceMs: number;
  private readonly missingPollMs: number;
  private readonly maxConcurrent: number;
  private readonly staleAfterMs: number;
  private readonly watch: WatchFn;
  private readonly now: () => number;

  constructor(private readonly options: FolderScannerOptions) {
    this.debounceMs = options.debounceMs ?? 2000;
    this.missingPollMs = options.missingPollMs ?? 30_000;
    this.maxConcurrent = options.maxConcurrent ?? 2;
    this.staleAfterMs = options.staleAfterMs ?? 10 * 60 * 1000;
    this.watch = options.watch ?? fsWatchRecursive;
    this.now = options.now ?? Date.now;
  }

  /** This folder's runtime state, or `null` if it is not linked. */
  runtime(folderId: string): FolderRuntime | null {
    return this.entries.get(folderId)?.runtime ?? null;
  }

  /**
   * Brings runtime state into line with the folder rows: a new or restored
   * folder is scanned, and a removed one is forgotten, its watcher closed and
   * its scan cancelled. Cheap when there is nothing to do. Called at launch,
   * after every undo and redo, and after link, unlink, restore and relink.
   */
  reconcile(): void {
    if (this.stopped) return;
    const folders = foldersRepo.listLinkedFolders(this.options.db());
    const ids = new Set(folders.map((f) => f.id));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) this.forget(id, entry);
    }
    for (const folder of folders) {
      const entry = this.entries.get(folder.id);
      if (entry === undefined) {
        this.track(folder);
      } else if (entry.signature !== signatureOf(folder)) {
        // Relinked to a new path, or subfolders switched: watch the new place and rescan.
        entry.signature = signatureOf(folder);
        entry.watcher?.close();
        entry.watcher = null;
        this.rescan(folder.id);
      }
    }
  }

  /** Scans a folder now, or again as soon as its current scan finishes. */
  rescan(folderId: string): void {
    const entry = this.entries.get(folderId);
    if (entry === undefined || this.stopped) return;
    if (entry.running !== null) {
      entry.again = true;
      return;
    }
    if (entry.queued) return;
    entry.queued = true;
    this.queue.push(folderId);
    this.pump();
  }

  /** Cancels a running scan. What it had already written is kept. */
  cancel(folderId: string): void {
    const entry = this.entries.get(folderId);
    if (entry === undefined) return;
    entry.again = false;
    entry.running?.abort();
    if (entry.queued) {
      entry.queued = false;
      this.queue.splice(this.queue.indexOf(folderId), 1);
    }
  }

  /** The app regained focus: rescan missing folders and any not scanned for a while. */
  onFocus(): void {
    const db = this.options.db();
    for (const [id, entry] of this.entries) {
      const folder = foldersRepo.findLinkedFolder(db, id);
      if (folder === null) continue;
      const stale = folder.lastScanAt === null || this.now() - folder.lastScanAt > this.staleAfterMs;
      if (entry.runtime.state === 'missing' || entry.runtime.state === 'denied' || stale) this.rescan(id);
    }
  }

  /** Resolves when no scan is running or queued. For tests and shutdown. */
  idle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    for (const [id, entry] of this.entries) this.forget(id, entry);
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }

  // ------------------------------------------------------------- internals

  private track(folder: LinkedFolder): void {
    const folderId = folder.id;
    this.entries.set(folderId, {
      runtime: { state: 'available', progress: null, lastOutcome: null },
      signature: signatureOf(folder),
      running: null,
      again: false,
      queued: false,
      watcher: null,
      debounce: null,
    });
    this.rescan(folderId);
  }

  private forget(folderId: string, entry: Entry): void {
    entry.running?.abort();
    entry.watcher?.close();
    if (entry.debounce !== null) clearTimeout(entry.debounce);
    if (entry.queued) this.queue.splice(this.queue.indexOf(folderId), 1);
    this.entries.delete(folderId);
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift();
      const entry = id === undefined ? undefined : this.entries.get(id);
      if (id === undefined || entry === undefined) continue;
      entry.queued = false;
      this.active += 1;
      void this.run(id, entry).finally(() => {
        this.active -= 1;
        this.pump();
        if (this.active === 0 && this.queue.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          for (const resolve of waiters) resolve();
        }
      });
    }
  }

  private async run(folderId: string, entry: Entry): Promise<void> {
    const folder = foldersRepo.findLinkedFolder(this.options.db(), folderId);
    if (folder === null) return;
    const controller = new AbortController();
    entry.running = controller;
    entry.again = false;
    entry.runtime = { ...entry.runtime, state: 'scanning', progress: null };

    let outcome: ScanOutcome;
    try {
      outcome = await scanFolder(
        {
          db: this.options.db(),
          reader: this.options.reader,
          ...this.options.scanDeps,
          now: this.now,
          onProgress: (progress) => {
            entry.runtime = { ...entry.runtime, progress };
            this.options.emit?.({ type: 'progress', progress });
          },
        },
        folder,
        controller.signal,
      );
    } catch {
      // A scan never throws for a file; anything else leaves the folder as it was.
      outcome = { status: 'partial', reason: 'The scan stopped unexpectedly.', skipped: { hidden: 0, packages: 0, symlinks: 0, subfolders: 0, unsupported: {}, unreadableFolders: 0 } };
    }
    entry.running = null;
    if (!this.entries.has(folderId)) return; // unlinked while scanning

    const state: FolderState = outcome.status === 'missing' ? 'missing' : outcome.status === 'denied' ? 'denied' : 'available';
    entry.runtime = { state, progress: null, lastOutcome: outcome };
    this.updateWatcher(folder, entry);
    this.updatePoll();

    // Always: the renderer clears its progress and reloads the folder's counts.
    this.options.emit?.({ type: 'changed', folderId });
    if (entry.again) this.rescan(folderId);
  }

  private updateWatcher(folder: LinkedFolder, entry: Entry): void {
    if (entry.runtime.state !== 'available') {
      entry.watcher?.close();
      entry.watcher = null;
      return;
    }
    if (entry.watcher !== null) return;
    try {
      entry.watcher = this.watch(
        folder.path,
        () => {
          if (entry.debounce !== null) clearTimeout(entry.debounce);
          entry.debounce = setTimeout(() => {
            entry.debounce = null;
            this.rescan(folder.id);
          }, this.debounceMs);
        },
        () => {
          // The volume went away under the watcher.
          entry.watcher?.close();
          entry.watcher = null;
          entry.runtime = { ...entry.runtime, state: 'missing' };
          this.options.emit?.({ type: 'changed', folderId: folder.id });
          this.updatePoll();
        },
      );
    } catch {
      entry.watcher = null; // rescans on focus and on request still work
    }
  }

  private updatePoll(): void {
    const anyMissing = [...this.entries.values()].some((e) => e.runtime.state === 'missing' || e.runtime.state === 'denied');
    if (anyMissing && this.poll === null && !this.stopped) {
      this.poll = setInterval(() => void this.checkMissing(), this.missingPollMs);
      this.poll.unref?.();
    } else if (!anyMissing && this.poll !== null) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  private async checkMissing(): Promise<void> {
    const db = this.options.db();
    for (const [id, entry] of this.entries) {
      if (entry.runtime.state !== 'missing' && entry.runtime.state !== 'denied') continue;
      const folder = foldersRepo.findLinkedFolder(db, id);
      if (folder !== null && (await folderAvailability(folder.path)) === 'available') this.rescan(id);
    }
  }
}
