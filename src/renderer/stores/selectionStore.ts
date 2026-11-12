import { create } from 'zustand';
import type {
  BatchKind,
  BatchMember,
  Folder,
  ObjectRef,
  RouteWithPoints,
  TrackWithPoints,
  TripWithCounts,
  Waypoint,
} from '@shared/domain/types';
import type { LinkedFolderSummary } from '@shared/domain/linkedFolders';
import { api, callOr } from '../lib/client';
import { useGeometryStore } from './geometryStore';

/**
 * What is currently selected, and the loaded detail for it.
 *
 * Selection is a reference plus separately-fetched detail rather than a copy of
 * the object, so the properties panel always shows canonical state after a
 * mutation.
 *
 * Selecting anything also ensures the map has that object's trip geometry
 * loaded — the map and the library are driven by the same selection, so
 * clicking either highlights both (Requirement 6.1).
 *
 * ## Multi-selection
 *
 * Phase 5 adds a set of keys **beside** the single `selected` reference rather
 * than replacing it. `selected` remains the anchor: the last thing clicked,
 * the object the properties panel describes, and the object whose trip the map
 * shows. Three consequences, each a deliberate answer to a constraint rather
 * than a shortcut (see ADR 0014):
 *
 * - **Detail loading stays keyed on the anchor.** `tracks.get` returns every
 *   point — up to 200,000 — paid once per selection. Loading that for every
 *   member of a multi-selection would multiply the payload for no benefit,
 *   because the panel shows one object.
 * - **`ensureGeometry` keeps its one-trip rule.** The map draws a single
 *   trip's geometry. A selection spanning trips follows the anchor, which is
 *   honest about what the map was ever going to show.
 * - **Keys, not refs.** The tree re-renders every row on a selection change,
 *   so membership has to be O(1) per row; a linear scan would be quadratic in
 *   the size of the selection.
 */

/** The selection key for an object. Distinct from `TreeNode.id`, which is a path. */
export function refKey(ref: ObjectRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Splits a key back into a reference. Null for anything malformed. */
export function keyToRef(key: string): ObjectRef | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (id.length === 0) return null;
  if (
    kind !== 'folder' &&
    kind !== 'trip' &&
    kind !== 'route' &&
    kind !== 'track' &&
    kind !== 'waypoint' &&
    kind !== 'linkedFolder'
  ) {
    return null;
  }
  return { kind, id };
}

/**
 * Kinds a batch operation accepts.
 *
 * Trips and folders are excluded on purpose (Requirement 1.3): they are
 * containers whose deletion cascades across tables, and batching a cascade
 * behind one keystroke is not a risk worth offering.
 */
const BATCH_KINDS: ReadonlySet<string> = new Set<BatchKind>([
  'route',
  'track',
  'waypoint',
]);

export function isBatchKind(kind: string): kind is BatchKind {
  return BATCH_KINDS.has(kind);
}

interface SelectionState {
  /** The anchor: last clicked, and the object the properties panel describes. */
  selected: ObjectRef | null;
  /** Every selected object including the anchor, keyed `kind:id`. */
  selectedKeys: ReadonlySet<string>;
  /** Where a Shift-click range starts. Null until something is clicked. */
  anchorKey: string | null;

  trip: TripWithCounts | null;
  folder: Folder | null;
  route: RouteWithPoints | null;
  track: TrackWithPoints | null;
  waypoint: Waypoint | null;
  /** Phase 11: a folder on disk linked to a trip. */
  linkedFolder: LinkedFolderSummary | null;
  loading: boolean;

  /** A plain click: replaces the selection and becomes the anchor. */
  select(ref: ObjectRef | null): Promise<void>;
  /** ⌘-click: adds or removes one object, keeping the rest. */
  toggle(ref: ObjectRef): Promise<void>;
  /** Shift-click or ⌘A: replaces the selection with a computed set. */
  selectMany(refs: readonly ObjectRef[], anchor: ObjectRef | null): Promise<void>;
  /** Escape: back to the anchor alone. */
  collapseToAnchor(): void;
  /** Drops keys whose objects no longer exist. Silent, per Requirement 1.9. */
  prune(surviving: ReadonlySet<string>): void;
  reload(): Promise<void>;
  clear(): void;
}

const EMPTY = {
  trip: null,
  folder: null,
  route: null,
  track: null,
  waypoint: null,
  linkedFolder: null,
} as const;

/** Ensures the map is showing the trip that owns the selected object. */
async function ensureGeometry(tripId: string | null): Promise<void> {
  if (tripId === null) return;
  const geometry = useGeometryStore.getState();
  if (geometry.tripId === tripId) return;
  await geometry.load(tripId);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: null,
  selectedKeys: new Set<string>(),
  anchorKey: null,
  ...EMPTY,
  loading: false,

  select: async (ref) => {
    set({
      selected: ref,
      selectedKeys: ref === null ? new Set() : new Set([refKey(ref)]),
      anchorKey: ref === null ? null : refKey(ref),
      ...EMPTY,
    });
    if (ref === null) {
      useGeometryStore.getState().clear();
      return;
    }
    await get().reload();
  },

  toggle: async (ref) => {
    const key = refKey(ref);
    const next = new Set(get().selectedKeys);

    if (next.has(key)) {
      next.delete(key);
      // Removing the anchor hands the role to whatever is left, taking the
      // most recently added — Sets keep insertion order, so this is the last
      // thing the user ⌘-clicked rather than an arbitrary member.
      if (get().anchorKey !== key) {
        set({ selectedKeys: next });
        return;
      }
      const fallback = [...next].at(-1) ?? null;
      const fallbackRef = fallback === null ? null : keyToRef(fallback);
      set({ selectedKeys: next, anchorKey: fallback, ...EMPTY, selected: fallbackRef });
      if (fallbackRef !== null) await get().reload();
      return;
    }

    next.add(key);
    set({ selectedKeys: next, anchorKey: key, selected: ref, ...EMPTY });
    await get().reload();
  },

  selectMany: async (refs, anchor) => {
    const keys = new Set(refs.map(refKey));
    // The anchor stays where the range started, so a second Shift-click
    // extends from the same origin rather than ratcheting.
    const anchorRef = anchor ?? refs.at(-1) ?? null;

    set({
      selectedKeys: keys,
      anchorKey: anchorRef === null ? null : refKey(anchorRef),
      selected: anchorRef,
      ...EMPTY,
    });
    if (anchorRef !== null) await get().reload();
  },

  collapseToAnchor: () => {
    const { selected } = get();
    set({
      selectedKeys: selected === null ? new Set() : new Set([refKey(selected)]),
    });
  },

  prune: (surviving) => {
    const { selectedKeys, selected, anchorKey } = get();

    const kept = new Set<string>();
    for (const key of selectedKeys) {
      if (surviving.has(key)) kept.add(key);
    }

    const anchorSurvives = anchorKey !== null && surviving.has(anchorKey);

    // Nothing changed: return without setting state, so a library refresh does
    // not re-render every tree row for no reason.
    if (kept.size === selectedKeys.size && anchorSurvives) return;

    set({
      selectedKeys: kept,
      ...(anchorSurvives
        ? {}
        : {
            selected: null,
            anchorKey: null,
            ...EMPTY,
          }),
    });
    if (selected !== null && !anchorSurvives) {
      useGeometryStore.getState().clear();
    }
  },

  reload: async () => {
    const ref = get().selected;
    if (ref === null) return;

    set({ loading: true });

    /**
     * Drops the anchor when its object has vanished.
     *
     * The key leaves `selectedKeys` with it, so a deleted object cannot linger
     * as an invisible member that a later batch would try to act on.
     */
    const forget = (): Partial<SelectionState> => {
      const next = new Set(get().selectedKeys);
      next.delete(refKey(ref));
      return { selected: null, anchorKey: null, selectedKeys: next };
    };

    switch (ref.kind) {
      case 'trip': {
        const trip = await callOr(api().trips.get({ id: ref.id }), null);
        // A deleted object clears the selection rather than showing stale data.
        set({
          ...EMPTY,
          trip,
          loading: false,
          ...(trip === null ? forget() : {}),
        });
        await ensureGeometry(trip?.id ?? null);
        return;
      }
      case 'folder': {
        const folder = await callOr(api().folders.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          folder,
          loading: false,
          ...(folder === null ? forget() : {}),
        });
        return;
      }
      case 'route': {
        const route = await callOr(api().routes.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          route,
          loading: false,
          ...(route === null ? forget() : {}),
        });
        await ensureGeometry(route?.tripId ?? null);
        return;
      }
      case 'waypoint': {
        const waypoint = await callOr(api().waypoints.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          waypoint,
          loading: false,
          ...(waypoint === null ? forget() : {}),
        });
        await ensureGeometry(waypoint?.tripId ?? null);
        return;
      }
      case 'track': {
        // `tracks.get` returns the points as well as the statistics. For a
        // 200,000-point track that is a large payload, which is why the map
        // does not use this path — it fetches drawing geometry by zoom. The
        // properties panel needs real counts and timestamps, so it pays for it
        // once per selection rather than per render.
        const track = await callOr(api().tracks.get({ id: ref.id }), null);
        set({
          ...EMPTY,
          track,
          loading: false,
          ...(track === null ? forget() : {}),
        });
        await ensureGeometry(track?.tripId ?? null);
        return;
      }
      case 'linkedFolder': {
        // Selecting a folder loads its trip on the map, as selecting a route
        // in the Routes view does (design §8.2).
        const linkedFolder = await callOr(api().linkedFolders.get({ folderId: ref.id }), null);
        set({
          ...EMPTY,
          linkedFolder,
          loading: false,
          ...(linkedFolder === null ? forget() : {}),
        });
        await ensureGeometry(linkedFolder?.tripId ?? null);
        return;
      }
      default: {
        set({ ...EMPTY, loading: false });
        return;
      }
    }
  },

  clear: () =>
    set({
      selected: null,
      selectedKeys: new Set(),
      anchorKey: null,
      ...EMPTY,
      loading: false,
    }),
}));

/**
 * The selection as batch members, in selection order.
 *
 * Trips and folders are filtered out rather than refused later: a selection
 * containing a trip is a legitimate single selection, and only the batch
 * actions need to care.
 */
export function batchMembers(keys: ReadonlySet<string>): BatchMember[] {
  const members: BatchMember[] = [];
  for (const key of keys) {
    const ref = keyToRef(key);
    if (ref === null || !isBatchKind(ref.kind)) continue;
    members.push({ kind: ref.kind, id: ref.id });
  }
  return members;
}
