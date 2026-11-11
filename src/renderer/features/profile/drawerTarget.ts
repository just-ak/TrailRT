/**
 * What the profile drawer should show after the selection changes.
 *
 * The drawer is a view of the current selection. Before this existed it kept
 * showing the geometry it was opened for, so picking another route in the
 * library left the profile describing a route that was no longer selected.
 *
 * - Selecting another route or track retargets the drawer to it, and keeps
 *   the point list open if it was open. Point highlights are always cleared,
 *   because indices only mean anything against the geometry they came from.
 * - Selecting something with no profile (a trip, folder or waypoint), or
 *   clearing the selection, closes the drawer.
 * - A closed drawer stays closed: selection never opens it.
 *
 * Pure, so the rule is tested without React or a store.
 */

export interface DrawerOwner {
  ownerType: 'route' | 'track';
  ownerId: string;
}

export interface DrawerState {
  profile: DrawerOwner | null;
  pointTable: DrawerOwner | null;
}

export interface DrawerPatch extends DrawerState {
  highlightedPoints: readonly number[];
}

/** Null when nothing needs to change. */
export function drawerAfterSelection(
  state: DrawerState,
  selected: { kind: string; id: string } | null,
): DrawerPatch | null {
  const { profile, pointTable } = state;
  if (profile === null) return null;

  if (
    selected === null ||
    (selected.kind !== 'route' && selected.kind !== 'track')
  ) {
    return { profile: null, pointTable: null, highlightedPoints: [] };
  }

  if (profile.ownerType === selected.kind && profile.ownerId === selected.id) {
    return null;
  }

  const next: DrawerOwner = { ownerType: selected.kind, ownerId: selected.id };
  return {
    profile: next,
    pointTable: pointTable === null ? null : next,
    highlightedPoints: [],
  };
}
