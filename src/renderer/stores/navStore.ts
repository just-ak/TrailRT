import { create } from 'zustand';
import type { AppSettings, LibrarySection, TripTab } from '@shared/domain/types';
import { api, callOr } from '../lib/client';
import { usePhotoStore } from './photoStore';
import { useSelectionStore } from './selectionStore';

/**
 * Where the left panel is. Phase 14, design §4.1.
 *
 * The rail's section, the trip open in the Trips section, and its tab, all
 * persisted so the panel opens where it was left (Requirement 1.2). Opening a
 * trip selects it, which loads it on the map: the panel and the map always
 * show the same trip.
 */

/** Something the list should do that needs its own state, such as naming a new trip in place. */
export type ListRequest = { kind: 'newTrip' | 'newFolder'; seq: number } | null;

interface NavState {
  request: ListRequest;
  /** Ask the list to create a trip or folder and name it in place. */
  ask(kind: 'newTrip' | 'newFolder'): void;
  section: LibrarySection;
  openTripId: string | null;
  tripTab: TripTab;
  hydrate(settings: AppSettings): void;
  setSection(section: LibrarySection): void;
  openTrip(tripId: string): void;
  closeTrip(): void;
  setTab(tab: TripTab): void;
}

function persist<K extends 'librarySection' | 'openTripId' | 'tripTab'>(key: K, value: AppSettings[K]): void {
  void callOr(api().settings.set({ key, value } as Parameters<ReturnType<typeof api>['settings']['set']>[0]), null);
}

let requestSeq = 0;

export const useNavStore = create<NavState>((set, get) => ({
  request: null,
  ask: (kind) => set({ request: { kind, seq: ++requestSeq } }),
  section: 'trips',
  openTripId: null,
  tripTab: 'plan',

  hydrate: (settings) => {
    set({ section: settings.librarySection, openTripId: settings.openTripId, tripTab: settings.tripTab });
    // The Photos section is all-trips mode on the map (Phase 11 §9).
    if (settings.librarySection === 'photos') usePhotoStore.getState().setAllTrips(true);
  },

  setSection: (section) => {
    const before = get().section;
    if (before === section) return;
    set({ section });
    persist('librarySection', section);
    if (section === 'photos') {
      void useSelectionStore
        .getState()
        .select(null)
        .then(() => usePhotoStore.getState().setAllTrips(true));
    } else if (before === 'photos') {
      usePhotoStore.getState().setAllTrips(false);
      const trip = get().openTripId;
      if (section === 'trips' && trip !== null) void useSelectionStore.getState().select({ kind: 'trip', id: trip });
    }
  },

  openTrip: (tripId) => {
    set({ openTripId: tripId, section: 'trips' });
    persist('openTripId', tripId);
    persist('librarySection', 'trips');
    const selected = useSelectionStore.getState().selected;
    if (selected?.kind !== 'trip' || selected.id !== tripId) void useSelectionStore.getState().select({ kind: 'trip', id: tripId });
  },

  closeTrip: () => {
    if (get().openTripId === null) return;
    set({ openTripId: null });
    persist('openTripId', null);
  },

  setTab: (tripTab) => {
    set({ tripTab });
    persist('tripTab', tripTab);
  },
}));
