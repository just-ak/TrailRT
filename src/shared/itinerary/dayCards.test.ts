import { describe, expect, it } from 'vitest';
import { BUXTON, LEEK } from '@fixtures/places';
import type { TreeNode } from '../domain/types';
import { wallClockToUtc } from '../time/zoned';
import { dayCards, durationText } from './dayCards';
import { itineraryTreeChildren } from './treeSummary';
import { stop, viewOf, weekend, ZONE } from './testViews';

const ROUTES = [
  { id: 'r-b', name: 'A53 to Leek', distanceM: 55_000 },
  { id: 'r-c', name: 'A523 to Ashbourne', distanceM: 55_000 },
];
const WAYPOINTS = [
  { id: 'wp-a', name: 'Buxton' },
  { id: 'wp-b', name: 'Leek' },
  { id: 'wp-c', name: 'Ashbourne' },
];
const node = (n: TreeNode): TreeNode => ({ ...n, children: [] });
const at = (date: string, time: string): number => wallClockToUtc({ date, time }, ZONE);

describe('dayCards', () => {
  it('lays a dated trip out day by day, with local times', () => {
    const plan = dayCards(weekend, { routes: ROUTES, tracks: [], waypoints: WAYPOINTS });
    expect(plan.days.map((d) => d.label)).toEqual(['Fri 23 Oct', 'Sat 24 Oct', 'Sun 25 Oct']);
    expect(plan.days[0]?.rows.map((r) => [r.name, r.time])).toEqual([
      ['Buxton', 'leave 16:00'],
      ['A53 to Leek', '16:00 · 1 h'],
      ['Leek', '17:00 · 2 nights'],
    ]);
    expect(plan.days[1]?.rows).toEqual([]);
    expect(plan.days[2]?.rows.map((r) => [r.name, r.time])).toEqual([
      ['A523 to Ashbourne', '09:00 · 1 h'],
      ['Ashbourne', 'arrive 10:00'],
    ]);
    expect(plan.unknown).toEqual([]);
    expect(plan.notInPlan).toEqual([]);
  });

  it('groups exactly as the library tree did for a dated trip (Phase 10 Requirement 14)', () => {
    const contents = { routes: ROUTES, tracks: [], waypoints: WAYPOINTS };
    const plan = dayCards(weekend, contents);
    const tree = itineraryTreeChildren(weekend, contents, 'trip:t', {
      route: (r, path) => node({ id: `${path}/route:${r.id}`, kind: 'route', name: r.name, children: [] }),
      track: (t, path) => node({ id: `${path}/track:${t.id}`, kind: 'track', name: t.name, children: [] }),
      waypoint: (w, path) => node({ id: `${path}/waypoint:${w.id}`, kind: 'waypoint', name: w.name, children: [] }),
    });
    const treeDays = tree.filter((n) => n.glyph === '📅').map((n) => [n.name, n.children.map((c) => c.name)]);
    expect(plan.days.map((d) => [d.label, d.rows.map((r) => r.name)])).toEqual(treeDays);
  });

  it('points each row at what selecting it selects', () => {
    const plan = dayCards(weekend, { routes: ROUTES, tracks: [], waypoints: WAYPOINTS });
    expect(plan.days[0]?.rows.map((r) => r.ref)).toEqual([
      { kind: 'waypoint', id: 'wp-a' },
      { kind: 'route', id: 'r-b' },
      { kind: 'waypoint', id: 'wp-b' },
    ]);
  });

  it('shows a drive with no route as not planned, and lists what has no time', () => {
    const unplanned = viewOf([stop('a', 'Buxton', BUXTON, {}, null), stop('b', 'Leek', LEEK, {}, null)]);
    const plan = dayCards(unplanned, { routes: [], tracks: [], waypoints: [] });
    // The drive leaves at a known time, so it sits on that day, marked not planned;
    // the arrival has no time, so it waits under Unknown times. As the tree did.
    expect(plan.days[0]?.rows.map((r) => [r.kind, r.name, r.time])).toEqual([
      ['stop', 'Buxton', 'leave 16:00'],
      ['unplanned', 'Drive to Leek', 'not planned'],
    ]);
    expect(plan.unknown.map((r) => [r.kind, r.name, r.time])).toEqual([['stop', 'Leek', 'arrive —']]);
  });

  it('puts a recorded track on the day it was recorded, and one without times outside the plan', () => {
    const plan = dayCards(weekend, {
      routes: ROUTES,
      tracks: [
        { id: 'walk', name: 'Walk by the Churnet', startedAt: at('2026-10-24', '11:00'), endedAt: at('2026-10-24', '13:05') },
        { id: 'old', name: 'Old log', startedAt: null, endedAt: null },
        { id: 'before', name: 'Last year', startedAt: at('2025-06-08', '18:00'), endedAt: at('2025-06-08', '19:00') },
      ],
      waypoints: WAYPOINTS,
    });
    expect(plan.days[1]?.rows.map((r) => [r.name, r.time])).toEqual([['Walk by the Churnet', '11:00–13:05 recorded']]);
    expect(plan.notInPlan.map((r) => [r.name, r.time])).toEqual([
      ['Old log', ''],
      ['Last year', 'recorded outside the trip'],
    ]);
  });

  it('lists routes and waypoints that are not in the plan', () => {
    const plan = dayCards(weekend, {
      routes: [...ROUTES, { id: 'spare', name: 'Spare route', distanceM: 1000 }],
      tracks: [],
      waypoints: [...WAYPOINTS, { id: 'ilam', name: 'Ilam Hall' }],
    });
    expect(plan.notInPlan.map((r) => r.name)).toEqual(['Spare route', 'Ilam Hall']);
  });

  it('words a duration', () => {
    expect([durationText(35 * 60), durationText(3600), durationText(5400)]).toEqual(['35 min', '1 h', '1 h 30 min']);
  });
});
