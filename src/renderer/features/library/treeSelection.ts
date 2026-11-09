import type { ObjectRef, TreeNode } from '@shared/domain/types';
import { isBatchKind, refKey } from '../../stores/selectionStore';

/**
 * Selection and keyboard navigation over the library tree.
 *
 * Pure functions, separated from the panel so the two keyspaces the tree uses
 * can be reasoned about — and tested — without a DOM.
 *
 * ## Two keyspaces that must not be conflated
 *
 * `TreeNode.id` is a **path** (`view:routes/route:abc`), deliberately distinct
 * from the object reference, because ADR 0004 puts the same route under its
 * trip *and* in the cross-trip Routes view. Expansion state, React keys and
 * focus all use the path. Selection uses `kind:id`.
 *
 * A Shift-click range is therefore computed over the flattened **visible rows
 * keyed by path**, and produces members keyed by `kind:id`. Requirement 1.8 —
 * one object appearing twice is one member of the selection — falls out of
 * that asymmetry rather than needing special handling.
 */

export interface FlatRow {
  node: TreeNode;
  depth: number;
  /** `TreeNode.id`: the row's position in the tree. */
  path: string;
  /** The object this row stands for, or null for the root and views. */
  ref: ObjectRef | null;
  /** Whether this row can join a multi-selection. */
  selectable: boolean;
}

/**
 * The rows currently on screen, in order.
 *
 * Only expanded branches are walked, which is what makes Requirement 1.1
 * true: a Shift-click range cannot silently include a collapsed trip's
 * children, because they are not here.
 */
export function flattenVisible(
  root: TreeNode | null,
  isExpanded: (path: string) => boolean,
): FlatRow[] {
  if (root === null) return [];

  const rows: FlatRow[] = [];

  const walk = (node: TreeNode, depth: number): void => {
    const ref = node.ref ?? null;
    rows.push({
      node,
      depth,
      path: node.id,
      ref,
      // Trips and folders are navigable and singly selectable, but excluded
      // from multi-selection per Requirement 1.3.
      selectable: ref !== null && isBatchKind(ref.kind),
    });

    if (node.children.length > 0 && isExpanded(node.id)) {
      for (const child of node.children) walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return rows;
}

/**
 * Where the anchor sits among the visible rows.
 *
 * The anchor is a selection key, and one object can occupy two rows. The
 * occurrence **nearest the clicked row** is used, so a range does not leap
 * across the tree because the same route also happens to be listed in a view
 * further down.
 */
function anchorIndex(
  rows: readonly FlatRow[],
  anchorKey: string | null,
  towards: number,
): number {
  if (anchorKey === null) return -1;

  let best = -1;
  for (const [index, row] of rows.entries()) {
    if (row.ref === null || refKey(row.ref) !== anchorKey) continue;
    if (best === -1 || Math.abs(index - towards) < Math.abs(best - towards)) {
      best = index;
    }
  }
  return best;
}

/** Unique refs, keyed by `kind:id`, in order. */
function dedupe(refs: readonly ObjectRef[]): ObjectRef[] {
  const seen = new Set<string>();
  const unique: ObjectRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

/**
 * The inclusive range of selectable objects between the anchor and a row.
 *
 * Returns just the clicked row when there is no anchor to measure from, which
 * makes a Shift-click with nothing selected behave like a plain click rather
 * than selecting the whole tree.
 */
export function rangeTo(
  rows: readonly FlatRow[],
  anchorKey: string | null,
  toPath: string,
): ObjectRef[] {
  const to = rows.findIndex((row) => row.path === toPath);
  if (to === -1) return [];

  const target = rows[to];
  if (target === undefined) return [];

  const from = anchorIndex(rows, anchorKey, to);
  if (from === -1) {
    return target.ref !== null && target.selectable ? [target.ref] : [];
  }

  const start = Math.min(from, to);
  const end = Math.max(from, to);

  return dedupe(
    rows
      .slice(start, end + 1)
      .filter((row) => row.selectable && row.ref !== null)
      .map((row) => row.ref as ObjectRef),
  );
}

/** Every selectable object currently visible, for ⌘A. */
export function allSelectable(rows: readonly FlatRow[]): ObjectRef[] {
  return dedupe(
    rows
      .filter((row) => row.selectable && row.ref !== null)
      .map((row) => row.ref as ObjectRef),
  );
}

/**
 * The row an arrow key should move focus to.
 *
 * Focus moves over **every** row, including trips and views, because a tree
 * you cannot walk into is a tree you cannot reach the bottom of. Selection is
 * a separate question, answered by `selectable`.
 */
export function moveFocus(
  rows: readonly FlatRow[],
  currentPath: string | null,
  delta: number,
): FlatRow | null {
  if (rows.length === 0) return null;

  const current = rows.findIndex((row) => row.path === currentPath);
  if (current === -1) return rows[delta < 0 ? rows.length - 1 : 0] ?? null;

  const next = Math.min(rows.length - 1, Math.max(0, current + delta));
  return rows[next] ?? null;
}

/** The row holding the keyboard focus, used to seed a roving tabIndex. */
export function focusablePath(
  rows: readonly FlatRow[],
  focusPath: string | null,
  anchorKey: string | null,
): string | null {
  if (focusPath !== null && rows.some((row) => row.path === focusPath)) {
    return focusPath;
  }
  // Falls back to the anchor so tabbing into the tree lands on what the user
  // last selected rather than at the top.
  const anchor = anchorIndex(rows, anchorKey, 0);
  if (anchor !== -1) return rows[anchor]?.path ?? null;
  return rows[0]?.path ?? null;
}

/** Describes a multi-selection: "3 routes and 1 track selected". */
export function describeSelection(refs: readonly ObjectRef[]): string {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    counts.set(ref.kind, (counts.get(ref.kind) ?? 0) + 1);
  }

  const parts = ['route', 'track', 'waypoint']
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => {
      const n = counts.get(kind) ?? 0;
      return `${n} ${kind}${n === 1 ? '' : 's'}`;
    });

  if (parts.length === 0) return 'Nothing selected';
  const list =
    parts.length === 1
      ? (parts[0] as string)
      : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`;
  return `${list} selected`;
}
