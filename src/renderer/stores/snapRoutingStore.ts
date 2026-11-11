import { create } from 'zustand';
import { pathDistance, type LatLon } from '@shared/geo/distance';
import type { EditPlan } from '@shared/routing/edit';
import type { ControlRole } from '@shared/routing/RoutingProvider';
import { asPreviewedLeg, type Candidate, type PreviewedLeg } from '@shared/routing/results';

/**
 * State for the interactive snap routing tool.
 *
 * Its own store rather than more fields on `editorStore`, because this is the
 * only editing state with a network call in the middle of it. The ordering and
 * staleness machinery below exists for that reason and does not belong next to
 * the straight-line draw state, which cannot fail or arrive late.
 *
 * ## The invariant
 *
 * `legs.length === max(0, controlPoints.length - 1)`, and `legs[i]` is always
 * the leg from `controlPoints[i]` to `controlPoints[i + 1]` — or `null` while
 * it still needs routing. Phase 4 kept `legs` as a prefix that only grew at
 * the end; Phase 6 lets a point in the middle be dragged, which invalidates
 * two legs that are not at the end, so the array is now sparse and
 * `nextGap()` returns the first hole. Everything here keeps that true while
 * legs arrive asynchronously:
 *
 * - Holes are filled **in order, one request at a time** (`drainSnapLegs`).
 * - `generation` is bumped whenever the shape changes out from under an
 *   in-flight request. A reply tagged with a stale generation is dropped
 *   rather than written into a hole it no longer describes.
 *
 * ## Undo inside the tool
 *
 * Nothing is in the database until the route is saved, so the tool keeps its
 * own bounded history of snapshots and ⌘Z pops it (Requirement 8.7).
 * Backspace keeps its Phase 4 meaning of removing the last point.
 */

type Leg = PreviewedLeg | null;

interface Snapshot {
  controlPoints: LatLon[];
  roles: ControlRole[];
  legs: Leg[];
}

/** Routes on offer for the leg to the most recently placed point. */
export interface DraftCandidates {
  leg: number;
  items: Candidate[];
  selected: number;
  hovered: number | null;
}

/** As deep as the database undo stack, for the same reason. */
const HISTORY_LIMIT = 50;

interface SnapRoutingState {
  /** The points the user placed. */
  controlPoints: LatLon[];
  /** Parallel to `controlPoints`. */
  roles: ControlRole[];
  /** Routed legs; null where a leg still needs routing. */
  legs: Leg[];
  /** True while a leg is being routed. */
  routing: boolean;
  /** Set when a leg could not be routed at all, as opposed to being unmatched. */
  error: string | null;
  /**
   * Incremented whenever an in-flight reply would no longer be valid. Callers
   * capture it before awaiting and discard their result if it has moved.
   */
  generation: number;
  candidates: DraftCandidates | null;
  history: Snapshot[];

  reset(): void;
  appendPoint(point: LatLon): void;
  /** Removes the last control point and the leg that reached it. */
  undoLastPoint(): void;
  /** Applies a planned shaping edit to the draft. */
  applyPlan(plan: EditPlan, routed: readonly PreviewedLeg[] | null): void;
  /** Pops the draft's history. False when there is nothing to undo. */
  undo(): boolean;
  setRouting(routing: boolean): void;
  setError(error: string | null): void;
  /**
   * Fills hole `index` if it is still the one we were routing.
   *
   * Returns false when the reply was stale, so the caller can stop draining
   * rather than loop against state that has moved on.
   */
  acceptLeg(generation: number, index: number, leg: PreviewedLeg): boolean;
  /** Fills a hole with candidate A and offers the rest. */
  acceptCandidates(generation: number, index: number, items: Candidate[]): boolean;
  selectCandidate(index: number): void;
  hoverCandidate(index: number | null): void;
  clearCandidates(): void;
  /** The first leg that needs routing, or null when the line is complete. */
  nextGap(): { index: number; from: LatLon; to: LatLon } | null;
}

const EMPTY = {
  controlPoints: [] as LatLon[],
  roles: [] as ControlRole[],
  legs: [] as Leg[],
  routing: false,
  error: null,
  candidates: null,
  history: [] as Snapshot[],
};

function snapshotOf(state: SnapRoutingState): Snapshot {
  return { controlPoints: state.controlPoints, roles: state.roles, legs: state.legs };
}

function pushHistory(state: SnapRoutingState): Snapshot[] {
  return [...state.history, snapshotOf(state)].slice(-HISTORY_LIMIT);
}

/** A known shape becomes a previewed leg: a split piece or a chosen candidate. */
function knownLeg(shape: readonly LatLon[], matched: boolean): PreviewedLeg {
  return {
    matched,
    shape: shape.map((p) => ({ lat: p.lat, lon: p.lon })),
    distanceM: pathDistance(shape),
    displacementM: null,
  };
}

export const useSnapRoutingStore = create<SnapRoutingState>((set, get) => ({
  ...EMPTY,
  generation: 0,

  reset: () =>
    set((state) => ({
      ...EMPTY,
      // Bumped, not zeroed: a request in flight from the previous session must
      // not be able to land in the new one.
      generation: state.generation + 1,
    })),

  appendPoint: (point) =>
    set((state) => ({
      history: pushHistory(state),
      controlPoints: [...state.controlPoints, point],
      roles: [...state.roles, 'via'],
      legs: state.controlPoints.length === 0 ? [] : [...state.legs, null],
      error: null,
    })),

  undoLastPoint: () =>
    set((state) => {
      if (state.controlPoints.length === 0) return {};
      const roles = state.roles.slice(0, -1);
      // The new last point is an end, and ends are always via points.
      if (roles.length > 0) roles[roles.length - 1] = 'via';
      const legs = state.legs.slice(0, Math.max(0, state.controlPoints.length - 2));
      return {
        history: pushHistory(state),
        controlPoints: state.controlPoints.slice(0, -1),
        roles,
        legs,
        candidates:
          state.candidates !== null && state.candidates.leg < legs.length ? state.candidates : null,
        error: null,
        generation: state.generation + 1,
        routing: false,
      };
    }),

  applyPlan: (plan, routed) =>
    set((state) => {
      let legs = state.legs;
      if (plan.replace !== null) {
        const { from, to, count } = plan.replace;
        const wasMatched = state.legs[from]?.matched ?? true;
        let replacement: Leg[];
        if (routed !== null) {
          replacement = routed.map((l) => ({ ...l, shape: l.shape.map((p) => ({ ...p })) }));
        } else if (plan.knownLegs !== null) {
          // A click on a still-unrouted leg has no shape to split: leave both
          // halves for the drain to route.
          replacement =
            state.legs[from] === null
              ? Array.from({ length: count }, () => null)
              : plan.knownLegs.map((shape) => knownLeg(shape, wasMatched));
        } else {
          replacement = Array.from({ length: count }, () => null);
        }
        legs = [...state.legs.slice(0, from), ...replacement, ...state.legs.slice(to)];
      }
      return {
        history: pushHistory(state),
        controlPoints: plan.control.map((c) => ({ lat: c.point.lat, lon: c.point.lon })),
        roles: plan.control.map((c) => c.role),
        legs,
        // Candidates describe one leg as it was; any edit may have moved it.
        candidates: null,
        error: null,
        generation: state.generation + 1,
      };
    }),

  undo: () => {
    const state = get();
    const previous = state.history.at(-1);
    if (previous === undefined) return false;
    set({
      ...previous,
      history: state.history.slice(0, -1),
      candidates: null,
      error: null,
      routing: false,
      generation: state.generation + 1,
    });
    return true;
  },

  setRouting: (routing) => set({ routing }),
  setError: (error) => set({ error }),

  acceptLeg: (generation, index, leg) => {
    const state = get();
    if (state.generation !== generation) return false;
    // The leg must be a hole that is still waiting. Anything else means two
    // drains ran concurrently, and writing would corrupt the alignment.
    if (index < 0 || index >= state.legs.length || state.legs[index] !== null) return false;
    const legs = [...state.legs];
    legs[index] = leg;
    set({ legs });
    return true;
  },

  acceptCandidates: (generation, index, items) => {
    const first = items[0];
    if (first === undefined) return false;
    // The leg is the candidate's geometry, not the candidate: its duration
    // estimate is for the list, and would make the saved leg invalid.
    if (!get().acceptLeg(generation, index, asPreviewedLeg(first))) return false;
    set({
      candidates: items.length > 0 ? { leg: index, items, selected: 0, hovered: null } : null,
    });
    return true;
  },

  selectCandidate: (index) => {
    const { candidates, legs } = get();
    const item = candidates?.items[index];
    if (candidates === null || item === undefined) return;
    // Swaps the leg's geometry and routes nothing: every candidate is already
    // a complete road route between the same two points.
    const next = [...legs];
    next[candidates.leg] = asPreviewedLeg(item);
    set({ legs: next, candidates: { ...candidates, selected: index } });
  },

  hoverCandidate: (index) => {
    const { candidates } = get();
    if (candidates === null || candidates.hovered === index) return;
    set({ candidates: { ...candidates, hovered: index } });
  },

  clearCandidates: () => set({ candidates: null }),

  nextGap: () => {
    const { controlPoints, legs } = get();
    const index = legs.indexOf(null);
    if (index < 0) return null;
    const from = controlPoints[index];
    const to = controlPoints[index + 1];
    if (from === undefined || to === undefined) return null;
    return { index, from, to };
  },
}));

/** True when every leg has been routed. */
export function snapComplete(legs: readonly Leg[]): legs is PreviewedLeg[] {
  return legs.every((leg) => leg !== null);
}

/**
 * Total metres over the routed legs. Null until a leg has landed, and null if
 * any routed leg's length is unknown.
 */
export function snapRoutedDistanceM(legs: readonly Leg[]): number | null {
  const routed = legs.filter((leg): leg is PreviewedLeg => leg !== null);
  if (routed.length === 0) return null;
  let total = 0;
  for (const leg of routed) {
    // A provider that reported no distance makes the total unknown rather than
    // short. Understating a route's length is worse than declining to state it.
    if (leg.distanceM === null) return null;
    total += leg.distanceM;
  }
  return total;
}

export function snapPointCount(legs: readonly Leg[]): number {
  const routed = legs.filter((leg): leg is PreviewedLeg => leg !== null);
  if (routed.length === 0) return 0;
  // Shared vertices are dropped on save, so count them that way here too —
  // the number shown must be the number that gets stored.
  return routed.reduce((sum, leg) => sum + leg.shape.length, 0) - (routed.length - 1);
}

/** Each leg's shape, or the straight line between its points while unrouted. */
export function draftLegShapes(controlPoints: readonly LatLon[], legs: readonly Leg[]): LatLon[][] {
  return legs.map((leg, i) =>
    leg === null
      ? [controlPoints[i] as LatLon, controlPoints[i + 1] as LatLon]
      : leg.shape.map((p) => ({ lat: p.lat, lon: p.lon })),
  );
}
