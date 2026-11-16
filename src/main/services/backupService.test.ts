import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupEntry } from '@shared/ipc/api';
import { createDatabase, type DbHandle } from '../db/client';
import * as backupService from './backupService';
import * as tripService from './tripService';

/**
 * Phase 14 Requirement 24: backups roll within a count and a size limit, the
 * newest is always kept, and a restore never deletes the file it is reading.
 */

const MB = 1024 ** 2;
const entry = (fileName: string, byteSize: number): BackupEntry => ({ fileName, createdAt: 0, byteSize });

describe('planPrune', () => {
  const newestFirst = [entry('d', 300 * MB), entry('c', 300 * MB), entry('b', 300 * MB), entry('a', 300 * MB)];

  it('keeps the newest that fit in the space, oldest removed first', () => {
    expect(backupService.planPrune(newestFirst, { retention: 7, maxBytes: 700 * MB })).toEqual(['b', 'a']);
  });

  it('keeps no more than the count, even with space to spare', () => {
    expect(backupService.planPrune(newestFirst, { retention: 2, maxBytes: 10_000 * MB })).toEqual(['b', 'a']);
  });

  it('applies whichever limit is stricter', () => {
    expect(backupService.planPrune(newestFirst, { retention: 3, maxBytes: 350 * MB })).toEqual(['c', 'b', 'a']);
  });

  it('always keeps the newest, even when it alone is over the limit', () => {
    const big = [entry('new', 8 * 1024 * MB), entry('old', 8 * 1024 * MB)];
    expect(backupService.planPrune(big, { retention: 7, maxBytes: 2 * 1024 * MB })).toEqual(['old']);
  });

  it('never removes a protected backup, and counts it', () => {
    expect(backupService.planPrune(newestFirst, { retention: 7, maxBytes: 300 * MB }, new Set(['a']))).toEqual(['c', 'b']);
  });

  it('removes nothing from an empty folder', () => {
    expect(backupService.planPrune([], { retention: 7, maxBytes: 1 })).toEqual([]);
  });
});

describe('backups on disk', () => {
  let dir: string;
  let backups: string;
  let handle: DbHandle;
  let databaseFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'trailrt-backups-'));
    backups = join(dir, 'backups');
    mkdirSync(backups);
    databaseFile = join(dir, 'trailrt.db');
    handle = createDatabase({ file: databaseFile });
    tripService.create(handle.db, { name: 'Peak', folderId: null, description: null, notes: null });
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** An older backup, dated so the folder's order is known. */
  function older(name: string, minutesAgo: number, bytes: number): void {
    const file = join(backups, `trailrt-backup-${name}.db`);
    writeFileSync(file, Buffer.alloc(bytes));
    const when = new Date(Date.now() - minutesAgo * 60_000);
    utimesSync(file, when, when);
  }

  it('rolls: a new backup removes the oldest that no longer fit', async () => {
    older('a', 30, 400_000);
    older('b', 20, 400_000);
    older('c', 10, 400_000);
    const made = await backupService.createBackup(handle, backups, { retention: 7, maxBytes: 1_000_000 }, { databaseFile });
    const left = backupService.listBackups(backups).map((b) => b.fileName);
    expect(left[0]).toBe(made.fileName);
    expect(left).toContain('trailrt-backup-c.db');
    expect(left).not.toContain('trailrt-backup-a.db');
    expect(backupService.listBackups(backups).reduce((sum, b) => sum + b.byteSize, 0)).toBeLessThanOrEqual(1_000_000);
  });

  it('keeps the new backup when it alone is over the limit, and only that one', async () => {
    older('a', 10, 50_000);
    const made = await backupService.createBackup(handle, backups, { retention: 7, maxBytes: 1 }, { databaseFile });
    expect(backupService.listBackups(backups).map((b) => b.fileName)).toEqual([made.fileName]);
  });

  it('never removes the backup it has just written, whatever the dates around it', async () => {
    // A file dated in the future, as a clock change or a copy can leave.
    older('future', -60, 100_000);
    const made = await backupService.createBackup(handle, backups, { retention: 1, maxBytes: 1 }, { databaseFile });
    expect(backupService.listBackups(backups).map((b) => b.fileName)).toContain(made.fileName);
  });

  it('a restore keeps the file it restores from, even when the limit would remove it', async () => {
    const source = await backupService.createBackup(handle, backups, { retention: 7, maxBytes: 10 * MB }, { databaseFile });
    // A newer backup since: the source is now the oldest, and the limit leaves room for one.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    utimesSync(join(backups, source.fileName), tenMinutesAgo, tenMinutesAgo);
    older('newer', 5, 100_000);
    await backupService.restoreBackup({
      handle,
      databaseFile,
      backupsDir: backups,
      fileName: source.fileName,
      limits: { retention: 1, maxBytes: 1 },
    });
    expect(backupService.listBackups(backups).map((b) => b.fileName)).toContain(source.fileName);
    handle = createDatabase({ file: databaseFile });
    expect(tripService.list(handle.db, { includeArchived: true, sortKey: 'name', sortDirection: 'asc' }).map((t) => t.name)).toEqual(['Peak']);
  });
});
