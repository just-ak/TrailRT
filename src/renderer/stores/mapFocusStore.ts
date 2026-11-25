import { create } from 'zustand';
import type { Photo } from '@shared/domain/linkedFolders';
import type { Bounds, ObjectRef, Track } from '@shared/domain/types';
import { boundingBox } from '@shared/geo/distance';
import { photoStateText } from '@shared/photos/library';
import { api, callOr } from '../lib/client';
import { useGeometryStore } from './geometryStore';
import { useSelectionStore } from './selectionStore';
import { useUiStore } from './uiStore';

/**
 * What the map was asked to show from the left panel, by a row's arrow.
 *
 * Tracks (Phase 14 Requirement 23): a track, or a year, month or day of the
 * Tracks section. Drawn beside the open trip's geometry rather than in place
 * of it, and kept until cleared or replaced, so the map never loses what the
 * user was working on. `fitSeq` asks the map to fit to them once per request.
 *
 * Routes, waypoints and photos (Requirements 26 and 27): these belong to the
 * trip the selection loads, so nothing extra is drawn. The map is moved to
 * them once, through `target`, and a route or waypoint is drawn even with its
 * layer hidden while it stays selected, through `shown`.
 *
 * On a trip's page (Requirement 29) a track is treated as a route is, since
 * it too belongs to the trip the map draws, and the trip's own arrow fits the
 * map to the whole trip without overriding hidden layers.
 */

export interface MapFocus {
  /** What is shown, in full: "May 2026", "Peak District ride". */
  label: string;
  tracks: Track[];
  bounds: Bounds | null;
}

/** A one-off request to move the map: fit a box, or centre on a point (a zero-size box). */
export interface MapTarget {
  seq: number;
  bounds: Bounds;
}

interface MapFocusState {
  focus: MapFocus | null;
  fitSeq: number;
  target: MapTarget | null;
  /** The route, track or waypoint whose arrow was pressed, drawn even with its layer hidden. */
  shown: ObjectRef | null;
  showTracks(ids: readonly string[], label: string): Promise<void>;
  showRoute(id: string): Promise<void>;
  /** A track of the trip being viewed: selected, fitted, and drawn with its layer hidden. */
  showTrack(id: string): Promise<void>;
  showWaypoint(id: string): Promise<void>;
  /** A whole trip: selected, and the map fitted to its routes, tracks and waypoints. */
  showTrip(id: string): Promise<void>;
  /** Moves the map to a photo, or says why it cannot. */
  goToPhoto(photo: Pick<Photo, 'lat' | 'lon' | 'state' | 'reason'>): void;
  clear(): void;
}

let requestSeq = 0;
let targetSeq = 0;

function toast(message: string): void {
  useUiStore.getState().showToast(message, 'error');
}

export const useMapFocusStore = create<MapFocusState>((set, get) => ({
  focus: null,
  fitSeq: 0,
  target: null,
  shown: null,

  showTracks: async (ids, label) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const seq = ++requestSeq;
    const wanted = new Set(unique);
    const [all, bounds] = await Promise.all([
      callOr(api().tracks.listAll(), []),
      callOr(api().tracks.bounds({ ids: unique }), null),
    ]);
    // A later request replaces this one.
    if (seq !== requestSeq) return;
    const tracks = all.filter((track) => wanted.has(track.id));
    set({ focus: { label, tracks, bounds }, fitSeq: get().fitSeq + 1 });
  },

  showRoute: async (id) => {
    const seq = ++targetSeq;
    const selection = useSelectionStore.getState();
    await selection.select({ kind: 'route', id });
    const route = useSelectionStore.getState().route;
    // Something else was asked for, or selected, while the route loaded.
    if (seq !== targetSeq || route?.id !== id) return;
    const bounds = boundingBox(route.points);
    if (bounds === null) {
      toast('That route has no points to show.');
      return;
    }
    set({ shown: { kind: 'route', id }, target: { seq, bounds } });
  },

  showTrack: async (id) => {
    const seq = ++targetSeq;
    // The box is a SQL aggregate, so a long track's points are never walked here.
    const [, bounds] = await Promise.all([
      useSelectionStore.getState().select({ kind: 'track', id }),
      callOr(api().tracks.bounds({ ids: [id] }), null),
    ]);
    const selected = useSelectionStore.getState().selected;
    if (seq !== targetSeq || selected?.kind !== 'track' || selected.id !== id) return;
    if (bounds === null) {
      toast('That track has no points to show.');
      return;
    }
    set({ shown: { kind: 'track', id }, target: { seq, bounds } });
  },

  showTrip: async (id) => {
    const seq = ++targetSeq;
    await useSelectionStore.getState().select({ kind: 'trip', id });
    if (seq !== targetSeq) return;
    // Selecting the trip loads its geometry unless it is already the trip
    // loaded; make sure what is read is that trip's, and not an earlier one's.
    if (useGeometryStore.getState().geometry?.tripId !== id) await useGeometryStore.getState().load(id);
    const geometry = useGeometryStore.getState().geometry;
    if (seq !== targetSeq || geometry?.tripId !== id) return;
    if (geometry.bounds === null) {
      toast('This trip has nothing to show on the map yet: no routes, tracks or waypoints.');
      return;
    }
    set({ target: { seq, bounds: geometry.bounds } });
  },

  showWaypoint: async (id) => {
    const seq = ++targetSeq;
    await useSelectionStore.getState().select({ kind: 'waypoint', id });
    const waypoint = useSelectionStore.getState().waypoint;
    if (seq !== targetSeq || waypoint?.id !== id) return;
    const at = { lat: waypoint.lat, lon: waypoint.lon };
    set({ shown: { kind: 'waypoint', id }, target: { seq, bounds: { minLat: at.lat, maxLat: at.lat, minLon: at.lon, maxLon: at.lon } } });
  },

  goToPhoto: (photo) => {
    const seq = ++targetSeq;
    if (photo.lat === null || photo.lon === null) {
      const why = photoStateText(photo);
      toast(`This photo is not on the map: ${why === '' ? 'it has no location' : why.charAt(0).toLowerCase() + why.slice(1)}.`);
      return;
    }
    set({ target: { seq, bounds: { minLat: photo.lat, maxLat: photo.lat, minLon: photo.lon, maxLon: photo.lon } } });
  },

  clear: () => {
    requestSeq += 1;
    set({ focus: null });
  },
}));

/*
 * A route or waypoint is drawn with its layer hidden only while it stays
 * selected (Requirement 26.4). Selecting anything else lets the layer
 * setting apply again.
 */
useSelectionStore.subscribe((state, previous) => {
  if (state.selected === previous.selected) return;
  const shown = useMapFocusStore.getState().shown;
  if (shown === null) return;
  if (state.selected?.kind !== shown.kind || state.selected.id !== shown.id) {
    useMapFocusStore.setState({ shown: null });
  }
});
