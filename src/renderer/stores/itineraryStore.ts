import { create } from 'zustand';
import type { ItineraryView } from '@shared/domain/itinerary';
import { api, callOr } from '../lib/client';

/**
 * The itinerary of the trip the map is showing, as the main process computed
 * it. Phase 10.
 *
 * A cache, like the geometry store: the timeline is never computed here, so
 * what the editor and the calendar show is always what the main process
 * derived from what was stored. Reloaded after every mutation and every undo,
 * through the library-changed event.
 */
interface ItineraryState {
  tripId: string | null;
  /** Null when the trip has no itinerary, or nothing is loaded. */
  view: ItineraryView | null;
  loading: boolean;
  /** The store has had at least one answer for `tripId`, even if it was "none". */
  answered: boolean;

  load(tripId: string | null): Promise<void>;
  reload(): Promise<void>;
}

let sequence = 0;

export const useItineraryStore = create<ItineraryState>((set, get) => ({
  tripId: null,
  view: null,
  loading: false,
  answered: false,

  load: async (tripId) => {
    const seq = ++sequence;
    if (tripId === null) {
      set({ tripId: null, view: null, loading: false, answered: false });
      return;
    }
    // A different trip's plan must not linger while the new one loads.
    set((state) =>
      state.tripId === tripId
        ? { loading: true }
        : { tripId, loading: true, view: null, answered: false },
    );
    const view = await callOr(api().itinerary.get({ tripId }), null);
    if (seq !== sequence) return;
    set({ view, loading: false, answered: true });
  },

  reload: async () => {
    await get().load(get().tripId);
  },
}));
