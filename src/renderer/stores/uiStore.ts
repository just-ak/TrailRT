import { create } from 'zustand';
import { DEFAULT_SETTINGS, PANEL_LIMITS } from '@shared/domain/defaults';
import type {
  AppSettings,
  BatchAssessment,
  BatchMember,
  PanelLayout,
  ThemePreference,
} from '@shared/domain/types';
import type { StagedImport } from '@shared/ipc/api';
import type { ChosenFolder } from '@shared/domain/linkedFolders';
import type { ExportScopeRequest } from '@shared/ipc/schemas';
import { api, callOr } from '../lib/client';

/**
 * Panel layout, theme and transient UI state.
 *
 * Layout changes are written through to settings but debounced, because a
 * divider drag fires continuously and each write is a database transaction.
 */

export type DialogKind =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'about' }
  | { kind: 'restore' }
  | {
      kind: 'confirmDelete';
      target: { type: 'trip' | 'folder'; id: string; name: string };
      counts: Record<string, number>;
    }
  /**
   * Batch deletion, gated on confirmation because it may be partly
   * irreversible.
   *
   * Carries the assessment the main process produced rather than recomputing
   * it here, so the warning the user reads is the one the mutation will
   * honour (Requirement 2.5).
   */
  | {
      kind: 'confirmBatchDelete';
      members: BatchMember[];
      assessment: BatchAssessment;
    }
  /** Files already parsed and staged in the main process, awaiting confirmation. */
  | { kind: 'import'; staged: StagedImport[] }
  | { kind: 'export'; scope: ExportScopeRequest }
  /** Picks a downloadable map region from the visible map area. */
  | { kind: 'regionPicker' }
  /** Phase 11: confirms a folder the user chose, with Include subfolders. */
  | { kind: 'linkFolder'; tripName: string; chosen: ChosenFolder }
  /** Phase 11: unlinking forgets the folder; its files are untouched. */
  | { kind: 'unlinkFolder'; folderId: string; name: string };

/** What a POI search runs along. */
export type PoiScope = { kind: 'route'; routeId: string } | { kind: 'itinerary'; tripId: string };

export type PlanDrawer =
  | { kind: 'calendar'; tripId: string }
  | { kind: 'poi'; scope: PoiScope }
  /** Phase 11: one linked folder's photos (design §8.3). */
  | { kind: 'photos'; folderId: string };

interface UiState {
  layout: PanelLayout;
  theme: ThemePreference;
  systemPrefersDark: boolean;
  dialog: DialogKind;
  toast: { message: string; tone: 'info' | 'error' } | null;
  mapOffline: boolean;
  /**
   * The geometry whose profile drawer is open, or null.
   *
   * Transient and not persisted: the drawer is a view of the current selection,
   * and restoring it on launch would mean profiling a geometry before the user
   * has asked for anything.
   */
  profile: { ownerType: 'route' | 'track'; ownerId: string } | null;
  /**
   * The geometry whose point table is open, or null.
   *
   * Transient, like the profile drawer: the table is a view of one object's
   * geometry, and a table restored on launch would be editing something the
   * user has not selected yet.
   *
   * The table lives inside the profile drawer, so that a point selected in one
   * is shown in the other. Opening it therefore opens the drawer for the same
   * geometry, and closing the drawer closes it.
   */
  pointTable: { ownerType: 'route' | 'track'; ownerId: string } | null;
  /**
   * Point indices the table has selected, mirrored onto the map.
   *
   * Lives here rather than in the table so the map layer can read it without
   * the two components having to know about each other. Read-only as far as
   * the data is concerned: highlighting changes nothing and records no undo
   * entry (Requirement 5.6).
   */
  highlightedPoints: readonly number[];
  /**
   * Phase 10: the planning drawer below the map, in the slot the profile
   * uses, so the map stays in view. One of profile, calendar or POIs at a
   * time; opening one closes the others.
   */
  planDrawer: PlanDrawer | null;

  hydrate(settings: AppSettings, systemPrefersDark: boolean): void;
  setLayout(patch: Partial<PanelLayout>): void;
  toggleLibrary(): void;
  toggleProperties(): void;
  /** Phase 10: hide or show the panel below the map. */
  toggleDrawer(): void;
  setTheme(theme: ThemePreference): void;
  setSystemPrefersDark(dark: boolean): void;
  openDialog(dialog: DialogKind): void;
  closeDialog(): void;
  showToast(message: string, tone?: 'info' | 'error'): void;
  dismissToast(): void;
  setMapOffline(offline: boolean): void;
  openProfile(ownerType: 'route' | 'track', ownerId: string): void;
  closeProfile(): void;
  openPointTable(ownerType: 'route' | 'track', ownerId: string): void;
  closePointTable(): void;
  setHighlightedPoints(indices: readonly number[]): void;
  openCalendar(tripId: string): void;
  openPoiPanel(scope: PoiScope): void;
  openPhotoList(folderId: string): void;
  closePlanDrawer(): void;
  isDark(): boolean;
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined;

function persistLayout(layout: PanelLayout): void {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    void callOr(api().settings.set({ key: 'panelLayout', value: layout }), null);
  }, 300);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const useUiStore = create<UiState>((set, get) => ({
  layout: DEFAULT_SETTINGS.panelLayout,
  theme: DEFAULT_SETTINGS.theme,
  systemPrefersDark: false,
  dialog: { kind: 'none' },
  toast: null,
  mapOffline: false,
  profile: null,
  pointTable: null,
  highlightedPoints: [],
  planDrawer: null,

  hydrate: (settings, systemPrefersDark) => {
    set({
      layout: settings.panelLayout,
      theme: settings.theme,
      systemPrefersDark,
    });
  },

  setLayout: (patch) => {
    const next: PanelLayout = { ...get().layout, ...patch };
    next.libraryWidth = clamp(
      next.libraryWidth,
      PANEL_LIMITS.libraryMin,
      PANEL_LIMITS.libraryMax,
    );
    next.propertiesWidth = clamp(
      next.propertiesWidth,
      PANEL_LIMITS.propertiesMin,
      PANEL_LIMITS.propertiesMax,
    );
    set({ layout: next });
    persistLayout(next);
  },

  toggleLibrary: () =>
    get().setLayout({ libraryVisible: !get().layout.libraryVisible }),

  toggleProperties: () =>
    get().setLayout({ propertiesVisible: !get().layout.propertiesVisible }),

  toggleDrawer: () => get().setLayout({ drawerVisible: get().layout.drawerVisible === false }),

  setTheme: (theme) => {
    set({ theme });
    void callOr(api().settings.set({ key: 'theme', value: theme }), null);
  },

  setSystemPrefersDark: (dark) => set({ systemPrefersDark: dark }),

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: { kind: 'none' } }),

  showToast: (message, tone = 'info') => set({ toast: { message, tone } }),
  dismissToast: () => set({ toast: null }),

  setMapOffline: (mapOffline) => set({ mapOffline }),

  // Opening something below the map shows that panel again if it was hidden.
  openCalendar: (tripId) => {
    set({ planDrawer: { kind: 'calendar', tripId }, profile: null, pointTable: null, highlightedPoints: [] });
    if (get().layout.drawerVisible === false) get().setLayout({ drawerVisible: true });
  },
  openPoiPanel: (scope) => {
    set({ planDrawer: { kind: 'poi', scope }, profile: null, pointTable: null, highlightedPoints: [] });
    if (get().layout.drawerVisible === false) get().setLayout({ drawerVisible: true });
  },
  openPhotoList: (folderId) => {
    set({ planDrawer: { kind: 'photos', folderId }, profile: null, pointTable: null, highlightedPoints: [] });
    if (get().layout.drawerVisible === false) get().setLayout({ drawerVisible: true });
  },
  closePlanDrawer: () => set({ planDrawer: null }),

  openProfile: (ownerType, ownerId) => {
    set({ planDrawer: null });
    if (get().layout.drawerVisible === false) get().setLayout({ drawerVisible: true });
    const table = get().pointTable;
    const sameOwner =
      table !== null &&
      table.ownerType === ownerType &&
      table.ownerId === ownerId;
    // A table for a different geometry cannot stay open under this drawer.
    set(
      sameOwner
        ? { profile: { ownerType, ownerId } }
        : {
            profile: { ownerType, ownerId },
            pointTable: null,
            highlightedPoints: [],
          },
    );
  },
  closeProfile: () =>
    set({ profile: null, pointTable: null, highlightedPoints: [] }),

  openPointTable: (ownerType, ownerId) =>
    // Highlighting is cleared with the owner: indices are only meaningful
    // against the geometry they came from, and carrying them over would mark
    // arbitrary points on a different object.
    set({
      profile: { ownerType, ownerId },
      pointTable: { ownerType, ownerId },
      highlightedPoints: [],
      planDrawer: null,
    }),

  closePointTable: () => set({ pointTable: null, highlightedPoints: [] }),

  setHighlightedPoints: (indices) => set({ highlightedPoints: indices }),

  isDark: () => {
    const { theme, systemPrefersDark } = get();
    return theme === 'system' ? systemPrefersDark : theme === 'dark';
  },
}));
