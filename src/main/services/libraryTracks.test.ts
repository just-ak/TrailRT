import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import type { TreeNode } from '@shared/domain/types';
import type { ParsedTrackPoint } from '@shared/io/types';
import { systemZone, utcToWallClock } from '@shared/time/zoned';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as libraryService from './libraryService';
import * as trackService from './trackService';
import * as tripService from './tripService';

/**
 * Phase 14 Requirement 22: the Tracks section by date, through the real
 * database, so the start-point lookup and the zone it resolves are covered as
 * well as the pure grouping in `shared/library/trackGroups.test.ts`.
 */

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-tracks-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  tripId = tripService.create(db, { name: 'Peak 2025', folderId: null, description: null, notes: null }).result.id;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string): number => Date.parse(iso);
const point = (place: { lat: number; lon: number }, time: number | null): ParsedTrackPoint => ({ lat: place.lat, lon: place.lon, ele: null, time });

function newTrack(name: string, points: ParsedTrackPoint[]): void {
  trackService.createFromParsed(db, { tripId, parsed: { name, segments: [{ points }], metadata: {} }, source: 'user' });
}

function tracksView(options: Parameters<typeof libraryService.tree>[1]): TreeNode {
  const view = libraryService.tree(db, options).children.find((c) => c.viewId === 'tracks');
  if (view === undefined) throw new Error('no Tracks view');
  return view;
}

function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.name}`, ...outline(n.children, depth + 1)]);
}

describe('the Tracks section by date', () => {
  beforeEach(() => {
    // 23:30 UTC on 31 May is 00:30 on 1 June at Buxton (BST).
    newTrack('Late ride', [point(BUXTON, at('2025-05-31T23:30:00Z')), point(LEEK, at('2025-06-01T00:40:00Z'))]);
    newTrack('Morning ride', [point(LEEK, at('2025-05-31T08:00:00Z')), point(BUXTON, at('2025-05-31T09:00:00Z'))]);
    // Outside every zone TrailRT knows, so it is dated in the computer's.
    newTrack('Far away', [point({ lat: 0, lon: 0 }, at('2025-07-10T12:00:00Z')), point({ lat: 0.01, lon: 0 }, at('2025-07-10T12:30:00Z'))]);
    newTrack('Untimed', [point(BUXTON, null), point(LEEK, null)]);
  });

  it('dates each track in the zone where it starts, newest first, undated last', () => {
    const view = tracksView({ includeArchived: true, trackArrangement: 'date', trackSortDirection: 'desc' });
    const far = utcToWallClock(at('2025-07-10T12:00:00Z'), systemZone());
    expect(outline(view.children)).toEqual([
      '2025',
      '  July',
      `    ${far.date === '2025-07-10' ? 'Thu 10 July' : 'Fri 11 July'}`,
      '      Far away',
      '  June',
      '    Sun 1 June',
      '      Late ride',
      '  May',
      '    Sat 31 May',
      '      Morning ride',
      'No date',
      '  Untimed',
    ]);
    const late = view.children[0]?.children[1]?.children[0]?.children[0];
    expect(late?.detail).toBe('00:30 · Peak 2025');
    expect(late?.hint).toBeUndefined();
    const farRow = view.children[0]?.children[0]?.children[0]?.children[0];
    expect(farRow?.hint).toMatch(/computer's time zone/);
  });

  it('keeps the flat list by name when nothing else is asked for', () => {
    const view = tracksView({ includeArchived: true });
    expect(view.children.map((c) => c.name)).toEqual(['Far away', 'Late ride', 'Morning ride', 'Untimed']);
    expect(view.children.every((c) => c.kind === 'track' && c.detail === 'Peak 2025')).toBe(true);
  });

  it('orders by name the other way, and by distance with the length shown', () => {
    expect(tracksView({ includeArchived: true, trackArrangement: 'name', trackSortDirection: 'desc' }).children.map((c) => c.name)).toEqual([
      'Untimed',
      'Morning ride',
      'Late ride',
      'Far away',
    ]);
    const byDistance = tracksView({ includeArchived: true, trackArrangement: 'distance', trackSortDirection: 'desc' }).children;
    expect(byDistance.at(-1)?.name).toBe('Far away');
    expect(byDistance[0]?.detail).toMatch(/km · Peak 2025$/);
  });
});
