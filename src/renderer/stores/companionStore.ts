import { create } from 'zustand';
import { useNavStore } from './navStore';
import { useSelectionStore } from './selectionStore';

/**
 * The right panel's own state. Phase 14, design §4.1.
 *
 * `editing` puts today's property editors in front of the companion. It
 * stays on while the selection moves from one object to another, so editing
 * several in turn needs one press of the pencil, and goes off when nothing is
 * selected or another trip opens.
 */

interface CompanionState {
  editing: boolean;
  edit(): void;
  back(): void;
}

export const useCompanionStore = create<CompanionState>((set) => ({
  editing: false,
  edit: () => set({ editing: true }),
  back: () => set({ editing: false }),
}));

useSelectionStore.subscribe((state, previous) => {
  if (state.selected === null && previous.selected !== null) useCompanionStore.setState({ editing: false });
});

useNavStore.subscribe((state, previous) => {
  if (state.openTripId !== previous.openTripId) useCompanionStore.setState({ editing: false });
});
