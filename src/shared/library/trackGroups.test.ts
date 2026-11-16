import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../domain/types';
import { arrangeTracks, type ArrangeOptions, type TrackListItem } from './trackGroups';

const at = (iso: string): number => Date.parse(iso);
const track = (id: string, over: Partial<TrackListItem> = {}): TrackListItem => ({
  id,
  name: id,
  tripName: 'Peak 2025',
  loose: false,
  distanceM: null,
  startedAt: null,
  zone: 'Europe/London',
  ...over,
});
const options = (over: Partial<ArrangeOptions> = {}): ArrangeOptions => ({
  arrangement: 'date',
  direction: 'desc',
  fallbackZone: 'Europe/London',
  path: 'view:tracks',
  ...over,
});

/** The tree as indented text, so a whole arrangement reads at a glance. */
function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.name}${n.detail === undefined ? '' : ` (${n.detail})`}`, ...outline(n.children, depth + 1)]);
}

const TRACKS: TrackListItem[] = [
  track('Morning loop', { startedAt: at('2025-05-16T08:10:00Z'), distanceM: 42_000 }),
  track('Evening spin', { startedAt: at('2025-05-16T17:45:00Z'), distanceM: 18_500 }),
  track('Cat and Fiddle', { startedAt: at('2025-05-03T09:00:00Z'), distanceM: 61_000 }),
  track('Winter test', { startedAt: at('2024-12-29T11:00:00Z'), distanceM: 900 }),
  track('No clock', { startedAt: null }),
  track('Snake Pass', { startedAt: at('2025-06-01T10:00:00Z'), loose: true, tripName: 'Not in a trip' }),
];

describe('arrangeTracks by date', () => {
  it('groups year › month › day, newest first, with counts on every heading', () => {
    expect(outline(arrangeTracks(TRACKS, options()))).toEqual([
      '2025 (4 tracks)',
      '  June (1 track)',
      '    Sun 1 June (1 track)',
      '      Snake Pass (11:00 · Not in a trip)',
      '  May (3 tracks)',
      '    Fri 16 May (2 tracks)',
      '      Evening spin (18:45 · Peak 2025)',
      '      Morning loop (09:10 · Peak 2025)',
      '    Sat 3 May (1 track)',
      '      Cat and Fiddle (10:00 · Peak 2025)',
      '2024 (1 track)',
      '  December (1 track)',
      '    Sun 29 December (1 track)',
      '      Winter test (11:00 · Peak 2025)',
      'No date (1 track)',
      '  No clock (Peak 2025)',
    ]);
  });

  it('runs oldest first throughout when asked, and keeps No date last', () => {
    const names = outline(arrangeTracks(TRACKS, options({ direction: 'asc' })));
    expect(names[0]).toBe('2024 (1 track)');
    expect(names.indexOf('      Morning loop (09:10 · Peak 2025)')).toBeLessThan(names.indexOf('      Evening spin (18:45 · Peak 2025)'));
    expect(names.at(-2)).toBe('No date (1 track)');
  });

  it('dates a track in the zone where it starts, not in UTC', () => {
    // 23:30 UTC on 31 May is 00:30 on 1 June in London (BST) and 01:30 in Chamonix.
    const late = [track('Night ride', { startedAt: at('2025-05-31T23:30:00Z'), zone: 'Europe/Paris' })];
    expect(outline(arrangeTracks(late, options()))).toEqual(['2025 (1 track)', '  June (1 track)', '    Sun 1 June (1 track)', '      Night ride (01:30 · Peak 2025)']);
  });

  it("uses the computer's zone where the track's own is unknown, and says so on the row", () => {
    const abroad = [track('Somewhere', { startedAt: at('2025-05-31T23:30:00Z'), zone: null })];
    const [year] = arrangeTracks(abroad, options({ fallbackZone: 'America/New_York' }));
    const row = year?.children[0]?.children[0]?.children[0];
    expect(row?.detail).toBe('19:30 · Peak 2025');
    expect(year?.children[0]?.name).toBe('May');
    expect(row?.hint).toMatch(/computer's time zone \(America\/New_York\)/);
    // A known zone carries no such note.
    const [known] = arrangeTracks([track('Home', { startedAt: at('2025-05-31T10:00:00Z') })], options());
    expect(known?.children[0]?.children[0]?.children[0]?.hint).toBeUndefined();
  });

  it("opens the first year, its first month and that month's days, and nothing else", () => {
    const [first, second] = arrangeTracks(TRACKS, options());
    expect(first?.defaultExpanded).toBe(true);
    expect(first?.children[0]?.defaultExpanded).toBe(true);
    expect(first?.children[0]?.children.every((day) => day.defaultExpanded === true)).toBe(true);
    expect(first?.children[1]?.defaultExpanded).toBeUndefined();
    expect(first?.children[1]?.children.some((day) => day.defaultExpanded === true)).toBe(false);
    expect(second?.defaultExpanded).toBeUndefined();
  });

  it('gives every row a unique id that keeps the track as its object', () => {
    const ids: string[] = [];
    const walk = (nodes: readonly TreeNode[]): void => nodes.forEach((n) => (ids.push(n.id), walk(n.children)));
    const tree = arrangeTracks(TRACKS, options());
    walk(tree);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('view:tracks/year:2025/month:05/day:16/track:Morning loop');
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.ref).toEqual({ kind: 'track', id: 'Snake Pass' });
  });

  it('never invents a date: a list of undated recordings is one No date group', () => {
    expect(outline(arrangeTracks([track('A'), track('B')], options()))).toEqual(['No date (2 tracks)', '  A (Peak 2025)', '  B (Peak 2025)']);
  });

  it('draws nothing for no tracks', () => {
    expect(arrangeTracks([], options())).toEqual([]);
  });
});

describe('arrangeTracks as a flat list', () => {
  it('by name, A to Z or Z to A, with items outside a trip first', () => {
    const az = arrangeTracks(TRACKS, options({ arrangement: 'name', direction: 'asc' })).map((n) => n.name);
    expect(az).toEqual(['Snake Pass', 'Cat and Fiddle', 'Evening spin', 'Morning loop', 'No clock', 'Winter test']);
    const za = arrangeTracks(TRACKS, options({ arrangement: 'name', direction: 'desc' })).map((n) => n.name);
    expect(za).toEqual(['Snake Pass', 'Winter test', 'No clock', 'Morning loop', 'Evening spin', 'Cat and Fiddle']);
  });

  it('by distance, with an unknown distance last either way, and the distance shown', () => {
    const longest = arrangeTracks(TRACKS, options({ arrangement: 'distance', direction: 'desc' }));
    expect(longest.map((n) => n.name)).toEqual(['Snake Pass', 'Cat and Fiddle', 'Morning loop', 'Evening spin', 'Winter test', 'No clock']);
    expect(longest[1]?.detail).toBe('61.0 km · Peak 2025');
    expect(longest[4]?.detail).toBe('900 m · Peak 2025');
    const shortest = arrangeTracks(TRACKS, options({ arrangement: 'distance', direction: 'asc' }));
    expect(shortest.map((n) => n.name).at(-1)).toBe('No clock');
  });

  it('names the trip on each row, as the list did before', () => {
    const [row] = arrangeTracks([track('A')], options({ arrangement: 'name', direction: 'asc' }));
    expect(row).toMatchObject({ id: 'view:tracks/track:A', kind: 'track', detail: 'Peak 2025', children: [] });
  });
});
