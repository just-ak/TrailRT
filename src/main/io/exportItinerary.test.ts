import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import type { LatLon } from '@shared/geo/distance';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import * as itineraryService from '../services/itineraryService';
import * as routeService from '../services/routeService';
import * as tripService from '../services/tripService';
import * as waypointService from '../services/waypointService';
import { exportScope, planExport } from './exportService';
import { icsFromItinerary } from './ics/fromItinerary';
import { writeIcs } from './ics/write';

/** Phase 10 Requirements 10.1–10.4 and 13.6: a scheduled trip's exports. */

let dir: string;
let handle: DbHandle;
let db: Db;

const SETTINGS = { walkingSpeedKmh: 4.5, transportMode: 'auto' as const };
const vertex = (at: LatLon) => ({ lat: at.lat, lon: at.lon, ele: null, name: null, symbol: null, notes: null });

function trip(name: string): string {
  return tripService.create(db, { name, folderId: null, description: null, notes: null }).result.id;
}

function place(tripId: string, name: string, at: LatLon): string {
  return waypointService.create(db, {
    tripId,
    name,
    lat: at.lat,
    lon: at.lon,
    eleM: null,
    description: null,
    symbol: 'pin',
    notes: null,
    groupId: null,
  }).result.id;
}

function road(tripId: string, name: string, from: LatLon, to: LatLon): string {
  return routeService.create(db, { tripId, name, colour: null, points: [vertex(from), vertex(to)] }).result.id;
}

/** Waypoints named so that alphabetical order is the reverse of the plan's. */
function scheduledTrip(): string {
  const id = trip('Peak weekend');
  const zebra = place(id, 'Zebra Inn', BUXTON);
  const middle = place(id, 'Middle Farm', LEEK);
  const alpha = place(id, 'Alpha Hotel', ASHBOURNE);
  place(id, 'Not a stop', MACCLESFIELD);
  const first = road(id, 'Z road', BUXTON, LEEK);
  const second = road(id, 'A road', LEEK, ASHBOURNE);
  itineraryService.create(db, { tripId: id, startDate: '2026-10-23', startTime: '16:00' });
  itineraryService.addStop(db, { tripId: id, waypointId: zebra });
  const b = itineraryService.addStop(db, { tripId: id, waypointId: middle, durationKind: 'days', durationDays: 2 }).result;
  const c = itineraryService.addStop(db, { tripId: id, waypointId: alpha }).result;
  itineraryService.linkLeg(db, { id: b.id, routeId: first });
  itineraryService.linkLeg(db, { id: c.id, routeId: second });
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-p10-export-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const names = (gpx: string, element: 'wpt' | 'rte'): string[] =>
  [...gpx.matchAll(new RegExp(`<${element}[^>]*>\\s*<name>([^<]*)</name>`, 'g'))].map((m) => m[1] ?? '');

describe('GPX for a scheduled trip', () => {
  it('writes stops and legs first, in itinerary order, then everything else', async () => {
    const id = scheduledTrip();
    const { text = '' } = await exportScope(db, { kind: 'trips', tripIds: [id] }, 'gpx');
    expect(names(text, 'wpt')).toEqual(['Zebra Inn', 'Middle Farm', 'Alpha Hotel', 'Not a stop']);
    expect(names(text, 'rte')).toEqual(['Z road', 'A road']);
  });

  it('writes no planned time as a GPX time', async () => {
    const id = scheduledTrip();
    const { text = '' } = await exportScope(db, { kind: 'trips', tripIds: [id] }, 'gpx');
    expect(text).not.toContain('<time>');
  });

  it('says the itinerary itself is not part of the file', () => {
    const plan = planExport(db, { kind: 'trips', tripIds: [scheduledTrip()] }, 'gpx');
    expect(plan.losses.some((loss) => loss.startsWith('Itinerary details'))).toBe(true);
  });

  it('exports a trip with no itinerary exactly as before', async () => {
    const plain = trip('No dates');
    place(plain, 'Zebra Inn', BUXTON);
    place(plain, 'Alpha Hotel', ASHBOURNE);
    road(plain, 'Z road', BUXTON, LEEK);
    road(plain, 'A road', LEEK, ASHBOURNE);
    const before = await exportScope(db, { kind: 'trips', tripIds: [plain] }, 'gpx');

    scheduledTrip();
    const after = await exportScope(db, { kind: 'trips', tripIds: [plain] }, 'gpx');
    expect(after.text).toBe(before.text);
    expect(after.plan.losses).toEqual(before.plan.losses);
    expect(names(after.text ?? '', 'wpt')).toEqual(['Alpha Hotel', 'Zebra Inn']);
  });
});

describe('iCalendar for a scheduled trip', () => {
  it('writes a stop for each place and a drive for each leg, in the trip’s local time', () => {
    const id = scheduledTrip();
    const view = itineraryService.get(db, id, SETTINGS);
    if (view === null) throw new Error('no itinerary');
    const output = writeIcs(icsFromItinerary(view, 'Peak weekend', { includeLegs: true, now: Date.UTC(2026, 9, 1) }));
    const lines = output.text.replaceAll('\r\n ', '').split('\r\n');
    expect(output.omitted).toEqual([]);
    expect(output.eventCount).toBe(5);
    expect(lines).toContain('SUMMARY:Leave Zebra Inn');
    expect(lines).toContain('SUMMARY:Middle Farm');
    expect(lines).toContain('DESCRIPTION:Stay: 2 days');
    expect(lines.some((l) => l.startsWith('SUMMARY:Drive: Zebra Inn → Middle Farm'))).toBe(true);
    // Leaves Middle Farm at 09:00 on Sunday 25 October, after BST has ended.
    expect(lines).toContain('DTEND;TZID=Europe/London:20261025T090000');
    expect(lines).toContain('BEGIN:VTIMEZONE');
  });

  it('leaves out what follows an unplanned leg and says so', () => {
    const id = scheduledTrip();
    const stops = itineraryService.get(db, id, SETTINGS)?.stops ?? [];
    itineraryService.linkLeg(db, { id: stops[1]?.id ?? '', routeId: null });
    const view = itineraryService.get(db, id, SETTINGS);
    if (view === null) throw new Error('no itinerary');
    const output = writeIcs(icsFromItinerary(view, 'Peak weekend', { includeLegs: false, now: 0 }));
    expect(output.omitted).toEqual(['Middle Farm', 'Alpha Hotel']);
    expect(output.eventCount).toBe(1);
  });
});
