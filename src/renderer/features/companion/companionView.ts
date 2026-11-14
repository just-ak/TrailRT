import type { ObjectRef } from '@shared/domain/types';

/**
 * Which view the right panel shows. Phase 14, design §4.3.
 *
 * The left panel holds structure and the map holds place; the right panel
 * answers "when" for whatever is selected. Pure, so every case is tested
 * without a window.
 */

export type CompanionView =
  | { kind: 'year' }
  /** A trip whose itinerary has not answered yet: nothing is guessed. */
  | { kind: 'loading'; tripId: string }
  | { kind: 'trip'; tripId: string }
  | { kind: 'undated'; tripId: string }
  | { kind: 'object'; ref: ObjectRef }
  /** A waypoint that is a stop in its trip's plan (design §4.8). */
  | { kind: 'stop'; ref: ObjectRef | null; stopId: string }
  /** The drive arriving at a stop: by its route, or by the stop when it has none. */
  | { kind: 'drive'; ref: ObjectRef | null; stopId: string }
  /** A search result highlighted in a day card's Add (design §4.9). */
  | { kind: 'candidate' }
  | { kind: 'edit'; ref: ObjectRef };

/** What the companion needs to know of the plan on the map. */
export interface PlanIndex {
  stops: readonly { id: string; waypointId: string | null; legRouteId: string | null; legMode: string; entryRouteId?: string | null }[];
}

export interface CompanionInput {
  selected: ObjectRef | null;
  openTripId: string | null;
  editing: boolean;
  /**
   * What the editor was opened for. A trip, a stop and a drive show their
   * details as fields; their editors open only from their own ⋯ menu, so the
   * editor stays on for them only while that same thing is selected.
   */
  editingRef: ObjectRef | null;
  /** The plan of the trip on the map, or null when it has none. */
  plan: PlanIndex | null;
  /** A result is highlighted in a day card's Add. */
  candidate?: boolean | undefined;
  /** A drive with no route, focused in the plan (it has nothing to select). */
  focusedLeg?: string | null | undefined;
  /** A stop that is only a point, focused in the plan. */
  focusedStop?: string | null | undefined;
  /** The trip the itinerary store has answered for, and whether it has dates. */
  itinerary: { tripId: string | null; answered: boolean; dated: boolean };
}

function tripView(tripId: string, itinerary: CompanionInput['itinerary']): CompanionView {
  if (itinerary.tripId !== tripId || (!itinerary.answered && !itinerary.dated)) return { kind: 'loading', tripId };
  return itinerary.dated ? { kind: 'trip', tripId } : { kind: 'undated', tripId };
}

/**
 * The view follows the selection, never the left panel's page: a trip
 * selected in the trip list shows by the hour exactly as an open one does, so
 * trips can be compared without opening each (the trip list flow,
 * `docs/design/library-panel/trip-list-flow/`).
 */
const sameRef = (a: ObjectRef | null, b: ObjectRef): boolean => a !== null && a.kind === b.kind && a.id === b.id;

export function companionView({ selected, openTripId, editing, editingRef, plan, itinerary, candidate, focusedLeg, focusedStop }: CompanionInput): CompanionView {
  if (candidate === true) return { kind: 'candidate' };
  if (focusedStop != null && plan?.stops.some((s) => s.id === focusedStop) === true) return { kind: 'stop', ref: null, stopId: focusedStop };
  // Focusing a drive with no route selects its trip, so the plan stays loaded.
  if (focusedLeg != null && plan?.stops.some((s) => s.id === focusedLeg) === true) {
    return { kind: 'drive', ref: null, stopId: focusedLeg };
  }
  if (selected === null) return openTripId !== null ? tripView(openTripId, itinerary) : { kind: 'year' };

  const pinned = editing && sameRef(editingRef, selected);
  if (selected.kind === 'trip') return pinned ? { kind: 'edit', ref: selected } : tripView(selected.id, itinerary);

  if (plan !== null) {
    const stop = selected.kind === 'waypoint' ? plan.stops.find((s) => s.waypointId === selected.id) : undefined;
    if (stop !== undefined) return pinned ? { kind: 'edit', ref: selected } : { kind: 'stop', ref: selected, stopId: stop.id };
    const leg =
      selected.kind === 'route'
        ? plan.stops.find((s) => s.entryRouteId === selected.id || (s.legRouteId === selected.id && s.legMode !== 'other'))
        : undefined;
    if (leg !== undefined) return pinned ? { kind: 'edit', ref: selected } : { kind: 'drive', ref: selected, stopId: leg.id };
  }

  if (editing) return { kind: 'edit', ref: selected };
  return { kind: 'object', ref: selected };
}
