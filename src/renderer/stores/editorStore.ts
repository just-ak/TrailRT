import { create } from 'zustand';
import type { RoutePoint } from '@shared/domain/types';
import type { LatLon } from '@shared/geo/distance';

/**
 * Transient map editing state: what mode the map is in and what is being drawn.
 *
 * Nothing here is persisted. A route under construction only becomes a database
 * row when the user finishes it, so cancelling leaves no trace (Requirement
 * 1.4). The measure tool goes further and never writes at all.
 */

/**
 * Why a route is being drawn as straight lines. ADR 0018: following roads is
 * the default, so straight lines are either a choice or a fallback, and the
 * hint bar says which.
 */
export type StraightBecause = 'chosen' | 'unavailable';

export type EditorMode =
  | 'idle'
  /** Straight lines between clicks. See `straightBecause`. */
  | 'drawRoute'
  | 'placeWaypoint'
  | 'measure'
  /**
   * The interactive snap routing tool. Its geometry lives in
   * `snapRoutingStore`, because unlike every other mode it is filled in
   * asynchronously by a provider and needs ordering and staleness handling.
   */
  | 'snapRoute'
  /** Phase 6: each click appends a via point to a saved snapped route. */
  | 'extendRoute';

interface EditorState {
  mode: EditorMode;
  /** Points placed so far in draw mode. */
  pending: RoutePoint[];
  /** The trip a new object will belong to. */
  targetTripId: string | null;
  /** The saved route being extended, in `extendRoute` mode. */
  targetRouteId: string | null;
  /** In `drawRoute` mode, why the lines are straight. */
  straightBecause: StraightBecause | null;
  /** Scratch points for the measure tool. Never written anywhere. */
  measurePoints: LatLon[];

  startDrawRoute(tripId: string, because: StraightBecause): void;
  startPlaceWaypoint(tripId: string): void;
  startMeasure(): void;
  startSnapRoute(tripId: string): void;
  startExtendRoute(routeId: string): void;
  appendPending(point: RoutePoint): void;
  undoLastPending(): void;
  appendMeasure(point: LatLon): void;
  undoLastMeasure(): void;
  clearMeasure(): void;
  cancel(): void;
  finish(): RoutePoint[];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  mode: 'idle',
  pending: [],
  targetTripId: null,
  targetRouteId: null,
  straightBecause: null,
  measurePoints: [],

  startDrawRoute: (tripId, because) =>
    set({
      mode: 'drawRoute',
      pending: [],
      targetTripId: tripId,
      straightBecause: because,
    }),

  startPlaceWaypoint: (tripId) =>
    set({ mode: 'placeWaypoint', pending: [], targetTripId: tripId }),

  // No trip id: a measurement belongs to nothing.
  startMeasure: () =>
    set({ mode: 'measure', measurePoints: [], targetTripId: null }),

  startSnapRoute: (tripId) =>
    set({ mode: 'snapRoute', pending: [], targetTripId: tripId }),

  startExtendRoute: (routeId) =>
    set({ mode: 'extendRoute', pending: [], targetTripId: null, targetRouteId: routeId }),

  appendPending: (point) => set({ pending: [...get().pending, point] }),

  /** Backspace during drawing removes the last placed point. */
  undoLastPending: () => set({ pending: get().pending.slice(0, -1) }),

  appendMeasure: (point) =>
    set({ measurePoints: [...get().measurePoints, point] }),

  undoLastMeasure: () =>
    set({ measurePoints: get().measurePoints.slice(0, -1) }),

  clearMeasure: () => set({ measurePoints: [] }),

  cancel: () =>
    set({
      mode: 'idle',
      pending: [],
      targetTripId: null,
      targetRouteId: null,
      straightBecause: null,
      measurePoints: [],
    }),

  finish: () => {
    const points = get().pending;
    set({ mode: 'idle', pending: [], targetTripId: null, straightBecause: null });
    return points;
  },
}));
