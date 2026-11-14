import { create } from 'zustand';
import { useSelectionStore } from './selectionStore';

/**
 * The plan's editing state on the left (Phase 14 Requirement 11, design §4.9).
 *
 * - `adding`: a day card's Add is open, and where the new stop would go.
 * - `candidate`: the search result highlighted there. The companion shows
 *   what adding it would do, before it is added.
 * - `focusedLeg`: a drive with no route of its own, which has nothing to
 *   select, so the companion shows it from here.
 */

/** Where an item found by Add lives, when it is not this trip (Requirement 12.1). */
export interface Elsewhere {
  tripId: string;
  /** "Not in a trip" for the holder. */
  tripName: string;
  loose: boolean;
}

export type Candidate =
  | { kind: 'waypoint'; id: string; name: string; lat: number; lon: number; from: Elsewhere | null }
  | { kind: 'place'; name: string; detail: string | null; lat: number; lon: number }
  | {
      kind: 'route';
      id: string;
      name: string;
      distanceM: number | null;
      from: Elsewhere | null;
      /** Fetched when highlighted: a route's list row does not carry its line. */
      ends: { start: { lat: number; lon: number }; end: { lat: number; lon: number } } | null;
    }
  | { kind: 'track'; id: string; name: string; startedAt: number | null; from: Elsewhere | null };

export interface Adding {
  tripId: string;
  /** The stop index the new stop takes. */
  index: number;
  /** The day card it was opened from. */
  day: string;
}

interface PlanState {
  adding: Adding | null;
  candidate: Candidate | null;
  /** For an item in another trip: copy it in (the default) or move it. */
  transfer: 'move' | 'copy';
  setTransfer(transfer: 'move' | 'copy'): void;
  focusedLeg: string | null;
  /** A stop that is only a point, which likewise has no object of its own (Requirement 13.3). */
  focusedStop: string | null;
  focusStop(stopId: string | null): void;
  startAdding(adding: Adding): void;
  stopAdding(): void;
  setCandidate(candidate: Candidate | null): void;
  focusLeg(stopId: string | null): void;
}

export const usePlanStore = create<PlanState>((set) => ({
  adding: null,
  candidate: null,
  transfer: 'copy',
  setTransfer: (transfer) => set({ transfer }),
  focusedLeg: null,
  focusedStop: null,
  focusStop: (focusedStop) => set({ focusedStop, focusedLeg: null }),
  startAdding: (adding) => set({ adding, candidate: null, focusedLeg: null, focusedStop: null, transfer: 'copy' }),
  stopAdding: () => set({ adding: null, candidate: null }),
  setCandidate: (candidate) => set({ candidate }),
  focusLeg: (focusedLeg) => set({ focusedLeg, focusedStop: null }),
}));

// Selecting something else ends a drive's focus; the selection speaks for itself.
useSelectionStore.subscribe((state, previous) => {
  const plan = usePlanStore.getState();
  if (state.selected !== previous.selected && state.selected !== null && (plan.focusedLeg !== null || plan.focusedStop !== null)) {
    usePlanStore.setState({ focusedLeg: null, focusedStop: null });
  }
});
