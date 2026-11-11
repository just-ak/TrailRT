import { create } from 'zustand';
import type { PoiCategoryId } from '@shared/poi/categories';
import type { AlongResult, DetourEstimate, PlaceDataState } from '@shared/poi/PoiProvider';
import { api, call, callOr, describeError } from '../lib/client';
import type { PoiScope } from './uiStore';

/**
 * The along-the-route search: what was asked, what came back, and which
 * result is in focus on the map. Phase 10, design §11.3.
 *
 * One search runs at a time. Starting another cancels the first in the main
 * process, and a stale answer that still arrives is dropped by sequence
 * number, so the list never shows results for a question no longer asked.
 */

export type SectionChoice =
  | { kind: 'all' }
  | { kind: 'range'; fromKm: number; toKm: number }
  | { kind: 'day'; date: string }
  | { kind: 'near'; lat: number; lon: number; radiusKm: number; label: string };

export const CORRIDOR_WIDTHS_M = [500, 1000, 2000, 5000, 10_000] as const;

interface PoiState {
  scope: PoiScope | null;
  categories: PoiCategoryId[];
  widthM: number;
  section: SectionChoice;
  data: PlaceDataState | null;
  result: AlongResult | null;
  loading: boolean;
  error: string | null;
  focusedId: number | null;
  detours: Record<number, DetourEstimate | { error: string } | 'loading'>;

  open(scope: PoiScope): Promise<void>;
  set(patch: Partial<Pick<PoiState, 'categories' | 'widthM' | 'section'>>): void;
  search(): Promise<void>;
  cancel(): void;
  focus(id: number | null): void;
  detour(poiId: number): Promise<void>;
  close(): void;
}

let sequence = 0;
let running: string | null = null;

export const usePoiStore = create<PoiState>((set, get) => ({
  scope: null,
  categories: ['fuel'],
  widthM: 2000,
  section: { kind: 'all' },
  data: null,
  result: null,
  loading: false,
  error: null,
  focusedId: null,
  detours: {},

  open: async (scope) => {
    const same = get().scope;
    const changed = same === null || JSON.stringify(same) !== JSON.stringify(scope);
    set({ scope, ...(changed ? { result: null, section: { kind: 'all' }, focusedId: null, detours: {} } : {}) });
    const data = await callOr(api().places.status(), null);
    set({ data });
    if (data?.kind === 'ready') await get().search();
  },

  set: (patch) => set(patch),

  search: async () => {
    const { scope, categories, widthM, section } = get();
    if (scope === null || categories.length === 0) return;
    get().cancel();
    const seq = ++sequence;
    const requestId = `along-${seq}`;
    running = requestId;
    set({ loading: true, error: null });
    const wire =
      section.kind === 'range'
        ? { kind: 'range' as const, fromM: section.fromKm * 1000, toM: section.toKm * 1000 }
        : section.kind === 'near'
          ? { kind: 'near' as const, lat: section.lat, lon: section.lon, radiusM: section.radiusKm * 1000 }
          : section;
    try {
      const result = await call(api().places.along({ requestId, scope, categories, widthM, section: wire }));
      if (seq !== sequence) return;
      set({ result, loading: false, detours: {} });
    } catch (cause) {
      if (seq !== sequence) return;
      set({ loading: false, error: describeError(cause) });
    } finally {
      if (running === requestId) running = null;
    }
  },

  cancel: () => {
    if (running === null) return;
    void callOr(api().places.cancel({ requestId: running }), null);
    running = null;
    sequence += 1;
    set({ loading: false });
  },

  focus: (focusedId) => set({ focusedId }),

  detour: async (poiId) => {
    const scope = get().scope;
    if (scope === null) return;
    set((s) => ({ detours: { ...s.detours, [poiId]: 'loading' } }));
    try {
      const estimate = await call(api().places.detour({ scope, poiId }));
      set((s) => ({ detours: { ...s.detours, [poiId]: estimate } }));
    } catch (cause) {
      set((s) => ({ detours: { ...s.detours, [poiId]: { error: describeError(cause) } } }));
    }
  },

  close: () => {
    get().cancel();
    set({ scope: null, result: null, focusedId: null, detours: {} });
  },
}));
