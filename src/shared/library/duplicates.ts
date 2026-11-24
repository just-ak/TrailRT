/**
 * Duplicates by content (Phase 14 Requirement 28, ADR 0027).
 *
 * The main process gives each route, track or waypoint a content key; this
 * module groups items by that key and chooses which copy stays. Pure, so the
 * rule is tested without a database.
 */

export type DuplicateKind = 'route' | 'track' | 'waypoint';

export interface DuplicateItem {
  id: string;
  name: string;
  tripId: string;
  /** "Not in a trip" for an item outside one (ADR 0022). */
  tripName: string;
  /** Outside any trip: does not count as another trip. */
  loose: boolean;
  /** A trip's plan uses it, so it is never removed. */
  inPlan: boolean;
  createdAt: number;
  /** Points a route's undo step would carry; 0 for tracks and waypoints. */
  pointCount: number;
}

export interface DuplicateGroup {
  /** The copy that stays. */
  keep: DuplicateItem;
  /** The copies to remove. Never one a plan uses. */
  remove: DuplicateItem[];
  /** Other copies kept because a plan uses them. */
  alsoKept: DuplicateItem[];
  /** Its copies in trips are in more than one trip: offered unticked. */
  acrossTrips: boolean;
}

export interface DuplicateReport {
  kind: DuplicateKind;
  /** How many items were compared. */
  compared: number;
  groups: DuplicateGroup[];
}

export interface DuplicateOutcome {
  removed: number;
  /** Pairs that changed after the dialog opened, so were left alone. */
  skipped: number;
  undoable: boolean;
}

/**
 * Route points one undo step may carry, as for a batch delete
 * (`batchService.MAX_BATCH_UNDO_POINTS`). Past it the removal still happens,
 * recorded as not undoable, and the dialog says so first.
 */
export const DUPLICATE_UNDO_POINTS = 250_000;

/** Which copy stays: one a plan uses, then one in a trip, then the oldest, then by id. */
function keepOrder(a: DuplicateItem, b: DuplicateItem): number {
  return (
    Number(b.inPlan) - Number(a.inPlan) ||
    Number(a.loose) - Number(b.loose) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Groups items with the same key and keeps one of each group. Groups with
 * nothing to remove, because every other copy is in a plan, are left out.
 * Ordered by the kept copy's name.
 */
export function groupDuplicates(items: readonly (DuplicateItem & { key: string })[]): DuplicateGroup[] {
  const byKey = new Map<string, DuplicateItem[]>();
  for (const { key, ...item } of items) {
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [item]);
    else list.push(item);
  }
  const groups: DuplicateGroup[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const [keep, ...others] = list.toSorted(keepOrder);
    if (keep === undefined) continue;
    const remove = others.filter((item) => !item.inPlan);
    if (remove.length === 0) continue;
    const trips = new Set([keep, ...remove].filter((item) => !item.loose).map((item) => item.tripId));
    groups.push({ keep, remove, alsoKept: others.filter((item) => item.inPlan), acrossTrips: trips.size > 1 });
  }
  return groups.toSorted((a, b) => a.keep.name.localeCompare(b.keep.name) || a.keep.id.localeCompare(b.keep.id));
}

/** Route points the chosen groups would carry on the undo stack. */
export function pointsCarried(groups: readonly DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.remove.reduce((n, item) => n + item.pointCount, 0), 0);
}

/** "1 duplicate track", "12 duplicate waypoints". */
export function duplicatesText(n: number, kind: DuplicateKind): string {
  return `${n.toLocaleString('en-GB')} duplicate ${kind}${n === 1 ? '' : 's'}`;
}
