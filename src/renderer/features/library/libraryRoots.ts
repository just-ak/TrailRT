import type { ItineraryView } from '@shared/domain/itinerary';
import type { TripOverview } from '@shared/domain/library';
import type { Photo } from '@shared/domain/linkedFolders';
import type { TreeNode, TripGeometry, ViewId } from '@shared/domain/types';
import { dayCards, durationText, type DayRow } from '@shared/itinerary/dayCards';
import { distanceText, groupTrips, tripMeta } from '@shared/library/tripGroups';
import { dayPhotoText } from '@shared/photos/library';

/**
 * The roots the left panel's lists are drawn from. Phase 14, design §4.2.
 *
 * Each section shows a different root, but every list is drawn by the same
 * `LibraryList`, so selection, the keyboard model, drag, rename and the
 * context menus behave the same everywhere (Phase 5). Pure, so the grouping
 * is tested without a window.
 */

export const TRIP_LIST_ROOT = 'triplist';
export const TRIP_PAGE_ROOT = 'trippage';

function viewNode(tree: TreeNode | null, id: ViewId): TreeNode | null {
  return tree?.children.find((c) => c.kind === 'view' && c.viewId === id) ?? null;
}

/** A trip as a row of the list: its second line, and no children, because selecting it opens it. */
function tripRow(node: TreeNode, overview: Map<string, TripOverview>, today: string): TreeNode {
  const trip = node.ref === undefined ? undefined : overview.get(node.ref.id);
  const detail = trip === undefined ? node.detail : tripMeta(trip, trip.startDate === today ? 'Today' : null);
  return { ...node, children: [], ...(detail === undefined ? {} : { detail }) };
}

function folderRow(node: TreeNode, overview: Map<string, TripOverview>, today: string): TreeNode {
  const trips = node.children.filter((c) => c.kind === 'trip').length;
  return {
    ...node,
    detail: trips === 0 ? 'empty' : `${trips} trip${trips === 1 ? '' : 's'}`,
    children: node.children.map((c) => (c.kind === 'folder' ? folderRow(c, overview, today) : tripRow(c, overview, today))),
  };
}

/**
 * The Trips section (Requirement 2.1): trips not in a folder, grouped as
 * Coming up, Ideas and past years; then the folders, holding their own trips.
 * Group headings start open.
 */
export function tripListRoot(tree: TreeNode | null, overviews: readonly TripOverview[], today: string): TreeNode {
  const trips = viewNode(tree, 'trips');
  const overview = new Map(overviews.map((t) => [t.id, t]));
  const topTrips = (trips?.children ?? []).filter((c) => c.kind === 'trip');
  const folders = (trips?.children ?? []).filter((c) => c.kind === 'folder');
  const nodeById = new Map(topTrips.map((n) => [n.ref?.id ?? '', n]));
  const visible = overviews.filter((t) => nodeById.has(t.id));
  // A trip the overview has not caught up with yet still appears, as an idea.
  const missing = topTrips.filter((n) => !overview.has(n.ref?.id ?? ''));

  const groups: TreeNode[] = groupTrips(visible, today).map((group) => ({
    id: `group:${group.key}`,
    kind: 'group',
    heading: true,
    name: group.label,
    defaultExpanded: true,
    children: group.rows.flatMap((row) => {
      const node = nodeById.get(row.trip.id);
      return node === undefined ? [] : [{ ...node, children: [], detail: row.meta }];
    }),
  }));
  if (missing.length > 0) {
    const ideas = groups.find((g) => g.id === 'group:ideas');
    const rows = missing.map((n) => tripRow(n, overview, today));
    if (ideas === undefined) {
      groups.push({ id: 'group:ideas', kind: 'group', heading: true, name: 'Ideas · no dates', defaultExpanded: true, children: rows });
    } else {
      ideas.children.unshift(...rows);
    }
  }
  if (folders.length > 0) {
    groups.push({
      id: 'group:folders',
      kind: 'group',
      heading: true,
      name: 'Folders',
      defaultExpanded: true,
      children: folders.map((f) => folderRow(f, overview, today)),
    });
  }
  return { id: TRIP_LIST_ROOT, kind: 'root', name: 'Trips', children: groups };
}

/** The open trip's node anywhere in the Trips view, or null when it has gone. */
export function findTrip(tree: TreeNode | null, tripId: string): TreeNode | null {
  const walk = (node: TreeNode): TreeNode | null => {
    if (node.kind === 'trip' && node.ref?.id === tripId) return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found !== null) return found;
    }
    return null;
  };
  const trips = viewNode(tree, 'trips');
  return trips === null ? null : walk(trips);
}

/** One trip's contents, as the trip page lists them. */
export function tripPageRoot(trip: TreeNode): TreeNode {
  return { id: TRIP_PAGE_ROOT, kind: 'root', name: trip.name, children: trip.children };
}

/** A cross-trip section's list: Routes, Tracks, Waypoints, Imported, Photos (ADR 0004 views). */
export function sectionRoot(tree: TreeNode | null, id: ViewId): TreeNode {
  const view = viewNode(tree, id);
  return { id: `section:${id}`, kind: 'root', name: view?.name ?? id, children: view?.children ?? [], ...(view?.hint === undefined ? {} : { hint: view.hint }) };
}

/** Headings and groups that start open the first time they appear. */
export function defaultOpen(root: TreeNode): string[] {
  const ids: string[] = [];
  const walk = (node: TreeNode): void => {
    if (node.defaultExpanded === true) ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return ids;
}

// ------------------------------------------------------------ the trip page

export const PLAN_ROOT = 'plan';
export const OBJECTS_ROOT = 'objects';

/** Photos per wall-clock day (Phase 11 design §8.4). */
export function photosByDay(photos: readonly Photo[]): Map<string, { count: number; cameraTime: number }> {
  const days = new Map<string, { count: number; cameraTime: number }>();
  for (const photo of photos) {
    if (photo.takenLocal === null) continue;
    const date = photo.takenLocal.slice(0, 10);
    const day = days.get(date) ?? { count: 0, cameraTime: 0 };
    day.count += 1;
    if (photo.takenOffsetMin === null) day.cameraTime += 1;
    days.set(date, day);
  }
  return days;
}

const GLYPH: Partial<Record<DayRow['kind'], string>> = { missing: '⚠️', unplanned: '⚠️', other: '↔️' };

function rowNode(row: DayRow, path: string): TreeNode {
  const id = `${path}/${row.key}`;
  const detail = row.time === '' ? {} : { detail: row.time };
  if (row.ref === null) {
    return { id, kind: 'group', glyph: GLYPH[row.kind] ?? '▫️', name: row.name, children: [], ...detail };
  }
  const kind = row.ref.kind === 'route' ? 'route' : row.ref.kind === 'track' ? 'track' : 'waypoint';
  return { id, ref: { kind, id: row.ref.id }, kind, name: row.name, children: [], ...detail };
}

function withDistance(m: number | null): { detail?: string } {
  return m === null ? {} : { detail: distanceText(m) };
}

function objectNodes(tripId: string, geometry: TripGeometry | null, path: string): { routes: TreeNode[]; tracks: TreeNode[]; waypoints: TreeNode[] } {
  if (geometry === null || geometry.tripId !== tripId) return { routes: [], tracks: [], waypoints: [] };
  return {
    routes: geometry.routes.map((r) => ({ id: `${path}/route:${r.id}`, ref: { kind: 'route', id: r.id }, kind: 'route', name: r.name, children: [], ...withDistance(r.distanceM) })),
    tracks: geometry.tracks.map((t) => ({ id: `${path}/track:${t.id}`, ref: { kind: 'track', id: t.id }, kind: 'track', name: t.name, children: [], ...withDistance(t.distanceM) })),
    waypoints: geometry.waypoints.map((w) => ({ id: `${path}/waypoint:${w.id}`, ref: { kind: 'waypoint', id: w.id }, kind: 'waypoint', name: w.name, children: [] })),
  };
}

/**
 * The Plan tab (Requirement 3.2 and 3.3). A dated trip: one group per day,
 * its stops, drives and recorded tracks with their times, and the day's
 * driving and photos; then what has no time, then what is not in the plan.
 * An undated trip: its objects, flat.
 */
export function planRoot(tripId: string, view: ItineraryView | null, geometry: TripGeometry | null, photos: readonly Photo[]): TreeNode {
  const path = `${PLAN_ROOT}:${tripId}`;
  const objects = objectNodes(tripId, geometry, path);
  if (view === null || view.itinerary.tripId !== tripId || geometry === null || geometry.tripId !== tripId) {
    return { id: PLAN_ROOT, kind: 'root', name: 'Plan', children: [...objects.routes, ...objects.tracks, ...objects.waypoints] };
  }
  const plan = dayCards(view, {
    routes: geometry.routes.map((r) => ({ id: r.id, name: r.name, distanceM: r.distanceM })),
    tracks: geometry.tracks.map((t) => ({ id: t.id, name: t.name, startedAt: t.startedAt, endedAt: t.endedAt })),
    waypoints: geometry.waypoints.map((w) => ({ id: w.id, name: w.name })),
  });
  const byDay = photosByDay(photos);
  const children: TreeNode[] = plan.days.map((day) => {
    const dayPath = `${path}/day:${day.date}`;
    const parts: string[] = [];
    if (day.driveSeconds > 0) parts.push(`${durationText(day.driveSeconds)} driving`);
    if (day.otherSeconds > 0) parts.push(`${durationText(day.otherSeconds)} other transport`);
    if (day.driveSeconds === 0 && day.otherSeconds === 0) parts.push('no travel');
    const photosToday = byDay.get(day.date);
    if (photosToday !== undefined) parts.push(dayPhotoText(photosToday));
    return {
      id: dayPath,
      kind: 'group',
      glyph: '📅',
      name: day.label,
      detail: parts.join(' · '),
      defaultExpanded: true,
      children: day.rows.map((row) => rowNode(row, dayPath)),
    };
  });
  if (plan.unknown.length > 0) {
    const p = `${path}/unknown`;
    children.push({ id: p, kind: 'group', glyph: '❔', name: 'Unknown times', detail: 'until every drive is planned', defaultExpanded: true, children: plan.unknown.map((r) => rowNode(r, p)) });
  }
  if (plan.notInPlan.length > 0) {
    const p = `${path}/not-in-plan`;
    children.push({ id: p, kind: 'group', glyph: '🗂️', name: 'Not in the plan', detail: String(plan.notInPlan.length), children: plan.notInPlan.map((r) => rowNode(r, p)) });
  }
  return { id: PLAN_ROOT, kind: 'root', name: 'Plan', children };
}

/** The Objects tab (Requirement 3.4): routes, tracks and waypoints under headings. */
export function objectsRoot(tripId: string, geometry: TripGeometry | null): TreeNode {
  const path = `${OBJECTS_ROOT}:${tripId}`;
  const objects = objectNodes(tripId, geometry, path);
  const group = (key: string, name: string, children: TreeNode[]): TreeNode[] =>
    children.length === 0 ? [] : [{ id: `${path}/${key}`, kind: 'group', heading: true, name, detail: String(children.length), defaultExpanded: true, children }];
  return {
    id: OBJECTS_ROOT,
    kind: 'root',
    name: 'Objects',
    children: [...group('routes', 'Routes', objects.routes), ...group('tracks', 'Tracks', objects.tracks), ...group('waypoints', 'Waypoints', objects.waypoints)],
  };
}

/** The trip's linked folders, from its tree node (Phase 11 §8.1), for the Photos tab. */
export function linkedFoldersRoot(trip: TreeNode): TreeNode {
  const group = trip.children.find((c) => c.id.endsWith('/linked-folders'));
  return { id: `folders:${trip.id}`, kind: 'root', name: 'Linked folders', children: group?.children ?? [] };
}
