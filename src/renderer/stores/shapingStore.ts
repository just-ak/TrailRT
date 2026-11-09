import { create } from 'zustand';
import type { LatLon } from '@shared/geo/distance';
import type { Candidate } from '@shared/routing/results';

/**
 * The routes on offer for one leg of a saved route. Phase 6, Requirement 2.
 *
 * Its own small store rather than fields on `routingStore`: it is transient UI
 * state for one choice in progress, and nothing else reads it. The snap
 * routing tool keeps its candidates in `snapRoutingStore`, beside the draft
 * they belong to.
 */

export interface LegCandidates {
  routeId: string;
  leg: number;
  items: Candidate[];
  selected: number;
  hovered: number | null;
  /** The leg as it is now, for comparison. */
  current: LatLon[];
  /** True while the choice is being pinned and applied. */
  checking: boolean;
}

interface ShapingState {
  legCandidates: LegCandidates | null;
  show(value: Omit<LegCandidates, 'selected' | 'hovered' | 'checking'>): void;
  select(index: number): void;
  hover(index: number | null): void;
  setChecking(checking: boolean): void;
  clear(): void;
}

export const useShapingStore = create<ShapingState>((set, get) => ({
  legCandidates: null,

  show: (value) =>
    set({ legCandidates: { ...value, selected: 0, hovered: null, checking: false } }),

  select: (index) => {
    const current = get().legCandidates;
    if (current === null || current.checking || index < 0 || index >= current.items.length) return;
    set({ legCandidates: { ...current, selected: index } });
  },

  hover: (index) => {
    const current = get().legCandidates;
    if (current === null || current.hovered === index) return;
    set({ legCandidates: { ...current, hovered: index } });
  },

  setChecking: (checking) => {
    const current = get().legCandidates;
    if (current !== null) set({ legCandidates: { ...current, checking } });
  },

  clear: () => set({ legCandidates: null }),
}));
