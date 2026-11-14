import { create } from 'zustand';
import type { ObjectRef } from '@shared/domain/types';
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
  /** What the editor was opened for (see `companionView`). */
  editingRef: ObjectRef | null;
  edit(ref?: ObjectRef | null): void;
  back(): void;
}

export const useCompanionStore = create<CompanionState>((set) => ({
  editing: false,
  editingRef: null,
  edit: (ref) => set({ editing: true, editingRef: ref ?? useSelectionStore.getState().selected }),
  back: () => set({ editing: false, editingRef: null }),
}));

useSelectionStore.subscribe((state, previous) => {
  if (state.selected === null && previous.selected !== null) useCompanionStore.setState({ editing: false, editingRef: null });
});

useNavStore.subscribe((state, previous) => {
  if (state.openTripId !== previous.openTripId) useCompanionStore.setState({ editing: false, editingRef: null });
});
