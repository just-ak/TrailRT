import { create } from 'zustand';
import type { Bounds, Track } from '@shared/domain/types';
import { api, callOr } from '../lib/client';

/**
 * Tracks shown on the map on request, across trips (Phase 14 Requirement
 * 23): a track, or a year, month or day of the Tracks section, by its arrow.
 *
 * Drawn beside the open trip's geometry rather than in place of it, and kept
 * until cleared or replaced, so the map never loses what the user was
 * working on. `fitSeq` asks the map to fit to them once per request.
 */

export interface MapFocus {
  /** What is shown, in full: "May 2026", "Peak District ride". */
  label: string;
  tracks: Track[];
  bounds: Bounds | null;
}

interface MapFocusState {
  focus: MapFocus | null;
  fitSeq: number;
  showTracks(ids: readonly string[], label: string): Promise<void>;
  clear(): void;
}

let requestSeq = 0;

export const useMapFocusStore = create<MapFocusState>((set, get) => ({
  focus: null,
  fitSeq: 0,

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

  clear: () => {
    requestSeq += 1;
    set({ focus: null });
  },
}));
