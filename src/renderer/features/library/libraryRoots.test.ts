import { describe, expect, it } from 'vitest';
import type { TripOverview } from '@shared/domain/library';
import type { Photo } from '@shared/domain/linkedFolders';
import type { TreeNode, TripGeometry } from '@shared/domain/types';
import { weekend } from '@shared/itinerary/testViews';
import { defaultOpen, findTrip, objectsRoot, photosByDay, planRoot, sectionRoot, tripListRoot, tripPageRoot } from './libraryRoots';

const NONE = { routes: 0, tracks: 0, waypoints: 0, photos: 0, linkedFolders: 0 };
const overview = (id: string, over: Partial<TripOverview> = {}): TripOverview => ({
  id,
  name: id,
  folderId: null,
  status: 'active',
  startDate: null,
  endDate: null,
  days: null,
  distanceM: null,
  driveSeconds: null,
  startPlace: null,
  startTime: null,
  counts: NONE,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});
const trip = (id: string, children: TreeNode[] = []): TreeNode => ({
  id: `trip:${id}`,
  ref: { kind: 'trip', id },
  kind: 'trip',
  name: id,
  children,
});

const ROUTE: TreeNode = { id: 'trip:idea/route:r', ref: { kind: 'route', id: 'r' }, kind: 'route', name: 'Leek → Lathkill', children: [] };
const TREE: TreeNode = {
  id: 'root',
  kind: 'root',
  name: 'My Collection',
  children: [
    {
      id: 'view:trips',
      kind: 'view',
      viewId: 'trips',
      name: 'Trips',
      children: [
        {
          id: 'folder:f',
          ref: { kind: 'folder', id: 'f' },
          kind: 'folder',
          name: 'Peak District',
          children: [trip('nested')],
        },
        trip('idea', [ROUTE]),
        trip('something'),
        trip('log'),
      ],
    },
    { id: 'view:routes', kind: 'view', viewId: 'routes', name: 'Routes', children: [{ ...ROUTE, id: 'view:routes/route:r' }] },
  ],
};
const OVERVIEWS = [
  overview('idea', { startDate: '2026-11-12', endDate: '2026-11-12', days: 1, distanceM: 33_000 }),
  overview('something'),
  overview('log', { startDate: '2024-06-08', endDate: '2024-06-08', days: 1 }),
  overview('nested', { folderId: 'f' }),
];

describe('the trip list', () => {
  it('groups trips not in a folder, then lists the folders with their own trips', () => {
    const root = tripListRoot(TREE, OVERVIEWS, '2026-11-12');
    expect(root.children.map((g) => [g.name, g.children.map((c) => c.name)])).toEqual([
      ['Coming up', ['idea']],
      ['Ideas · no dates', ['something']],
      ['2024', ['log']],
      ['Folders', ['Peak District']],
    ]);
    expect(root.children.every((g) => g.heading === true)).toBe(true);
    expect(root.children[3]?.children[0]?.children.map((c) => c.name)).toEqual(['nested']);
  });

  it('gives each trip its second line and no children, because selecting it opens it', () => {
    const idea = tripListRoot(TREE, OVERVIEWS, '2026-11-12').children[0]?.children[0];
    expect(idea?.detail).toBe('Today · Thu 12 Nov · 1 day · 33 km');
    expect(idea?.children).toEqual([]);
    expect(idea?.id).toBe('trip:idea');
  });

  it('still lists a trip the overview has not caught up with, as an idea', () => {
    const root = tripListRoot(TREE, OVERVIEWS.filter((o) => o.id !== 'something'), '2026-11-12');
    expect(root.children.find((g) => g.id === 'group:ideas')?.children.map((c) => c.name)).toEqual(['something']);
  });

  it('opens its headings the first time', () => {
    expect(defaultOpen(tripListRoot(TREE, OVERVIEWS, '2026-11-12'))).toEqual([
      'group:coming',
      'group:ideas',
      'group:year:2024',
      'group:folders',
    ]);
  });
});

describe('the trip page and the sections', () => {
  it('finds a trip anywhere, even inside a folder, and lists its contents', () => {
    expect(findTrip(TREE, 'nested')?.name).toBe('nested');
    expect(findTrip(TREE, 'gone')).toBeNull();
    const idea = findTrip(TREE, 'idea');
    expect(idea === null ? [] : tripPageRoot(idea).children.map((c) => c.name)).toEqual(['Leek → Lathkill']);
  });

  it('draws a cross-trip section from its view, which stays a view', () => {
    expect(sectionRoot(TREE, 'routes').children.map((c) => c.id)).toEqual(['view:routes/route:r']);
    expect(sectionRoot(TREE, 'tracks').children).toEqual([]);
  });
});

// ------------------------------------------------------------ the trip page

const route = (id: string, name: string) => ({
  id, tripId: 't', name, colour: null, source: 'drawn', distanceM: 55_000, points: [], createdAt: 0, updatedAt: 0,
});
const photo = (id: string, takenLocal: string | null, takenOffsetMin: number | null = 60) => ({ id, takenLocal, takenOffsetMin }) as Photo;

describe('the trip page tabs', () => {
  const geometry = {
    tripId: 't',
    routes: [route('r-b', 'A53 to Leek'), route('r-c', 'A523 to Ashbourne'), route('spare', 'Spare')],
    tracks: [{ id: 'walk', tripId: 't', name: 'Walk by the Churnet', startedAt: Date.UTC(2026, 9, 24, 10), endedAt: Date.UTC(2026, 9, 24, 12), distanceM: 6000 }],
    waypoints: [
      { id: 'wp-a', tripId: 't', name: 'Buxton' },
      { id: 'wp-b', tripId: 't', name: 'Leek' },
      { id: 'wp-c', tripId: 't', name: 'Ashbourne' },
    ],
    bounds: null,
  } as unknown as TripGeometry;

  it('lays a dated trip out by day, with each day’s driving and photos, then what is not in the plan', () => {
    const root = planRoot('t', weekend, geometry, [photo('p1', '2026-10-23T16:30:00'), photo('p2', '2026-10-23T17:10:00', null)]);
    expect(root.children.map((c) => [c.name, c.detail])).toEqual([
      ['Fri 23 Oct', '1 h driving · 2 photos (camera time)'],
      ['Sat 24 Oct', 'no travel'],
      ['Sun 25 Oct', '1 h driving'],
      ['Not in the plan', '1'],
    ]);
    expect(root.children[1]?.children.map((c) => [c.kind, c.name])).toEqual([['track', 'Walk by the Churnet']]);
    expect(root.children[0]?.children.map((c) => c.ref?.kind)).toEqual(['waypoint', 'route', 'waypoint']);
  });

  it('lists an undated trip’s objects flat, with nothing invented', () => {
    const root = planRoot('t', null, geometry, []);
    expect(root.children.map((c) => c.name)).toEqual(['A53 to Leek', 'A523 to Ashbourne', 'Spare', 'Walk by the Churnet', 'Buxton', 'Leek', 'Ashbourne']);
  });

  it('shows nothing from another trip while the right one loads', () => {
    expect(planRoot('other', weekend, geometry, []).children).toEqual([]);
  });

  it('groups the Objects tab under headings with counts', () => {
    const root = objectsRoot('t', geometry);
    expect(root.children.map((c) => [c.name, c.detail, c.heading])).toEqual([
      ['Routes', '3', true],
      ['Tracks', '1', true],
      ['Waypoints', '3', true],
    ]);
    expect(root.children[0]?.children[0]?.detail).toBe('55 km');
  });

  it('counts photos by the wall-clock day they were taken, and which used camera time', () => {
    const days = photosByDay([photo('a', '2026-10-23T23:30:00'), photo('b', '2026-10-24T00:10:00', null), photo('c', null)]);
    expect([...days.entries()]).toEqual([
      ['2026-10-23', { count: 1, cameraTime: 0 }],
      ['2026-10-24', { count: 1, cameraTime: 1 }],
    ]);
  });
});
