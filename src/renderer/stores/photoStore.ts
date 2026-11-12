import { create } from 'zustand';
import type {
  FolderState,
  LinkedFolderSummary,
  Photo,
  PhotoDetails,
  PhotoMapPoints,
  PhotoMapScope,
  PhotoYears,
  ScanProgress,
} from '@shared/domain/linkedFolders';
import { api, callOr } from '../lib/client';
import {
  clickPhoto,
  NO_PHOTO_SELECTION,
  pruneSelection,
  type PhotoSelection,
} from '../features/photos/photoSelection';
import { scopeKey } from '../features/photos/photoMapScope';
import { useSelectionStore } from './selectionStore';

/**
 * Linked folders and photos in the renderer. Phase 11, design §8.
 *
 * A cache of the main process, refreshed when it says a folder changed. The
 * selected photo is the one the preview box shows (task 11) and the map pans
 * to (task 10); it lives here so those can read it without knowing about the
 * list.
 */

interface PhotoState {
  /** Scan progress by folder, while a scan runs. */
  progress: Record<string, ScanProgress>;

  /** The folder whose photos the list drawer shows. */
  listFolder: LinkedFolderSummary | null;
  photos: Photo[];
  listLoading: boolean;
  selection: PhotoSelection;

  /** The Photos view's filter choices (design §8.2). */
  years: PhotoYears | null;
  tripsWithPhotos: { id: string; name: string }[];

  /**
   * All-trips mode: the Photos view itself is selected, so the map shows
   * every trip's photos (design §8.2, §9.1). Selecting anything else leaves it.
   */
  allTrips: boolean;
  /** Located photos for the map, column by column, and the scope they are for. */
  mapPoints: PhotoMapPoints | null;
  mapScope: PhotoMapScope | null;
  mapScopeKey: string | null;
  /** Each folder on the map: its name, and whether it is there (design §9.5). */
  folders: Record<string, { name: string; state: FolderState | null }>;
  /**
   * The members of an inseparable cluster that was clicked, in taken-time
   * order: the preview steps through them (design §9.3). `null` otherwise.
   */
  burst: string[] | null;
  /** The anchor photo's full details, for the direction wedge and the preview. */
  anchorDetails: PhotoDetails | null;
  /**
   * The photos the preview's arrows step through, in taken-time order: the
   * burst when one was opened, otherwise the anchor's folder (design §10.3).
   */
  sequence: string[];

  setProgress(progress: ScanProgress): void;
  clearProgress(folderId: string): void;
  openList(folderId: string): Promise<void>;
  reloadList(): Promise<void>;
  closeList(): void;
  clickPhoto(id: string, modifiers: { metaKey: boolean; shiftKey: boolean }): void;
  loadFilterOptions(includeArchived: boolean): Promise<void>;
  setAllTrips(on: boolean): void;
  loadMap(scope: PhotoMapScope | null, force?: boolean): Promise<void>;
  /** After a scan or a link change: the same scope, fetched again. */
  reloadMap(): Promise<void>;
  /** A photo marker or cluster clicked on the map: the first is shown, the rest are its burst. */
  selectFromMap(ids: readonly string[]): void;
  /** The preview's previous and next. Stays within the sequence. */
  step(delta: -1 | 1): void;
  /** Closes the preview: no photo is selected. */
  closePreview(): void;
}

let listSeq = 0;

export const usePhotoStore = create<PhotoState>((set, get) => ({
  progress: {},
  listFolder: null,
  photos: [],
  listLoading: false,
  selection: NO_PHOTO_SELECTION,
  years: null,
  tripsWithPhotos: [],
  allTrips: false,
  mapPoints: null,
  mapScope: null,
  mapScopeKey: null,
  folders: {},
  burst: null,
  anchorDetails: null,
  sequence: [],

  setProgress: (progress) => set({ progress: { ...get().progress, [progress.folderId]: progress } }),

  clearProgress: (folderId) => {
    if (!(folderId in get().progress)) return;
    const next = { ...get().progress };
    delete next[folderId];
    set({ progress: next });
  },

  openList: async (folderId) => {
    // The selection is not cleared here: a photo selected on the map may be
    // in another folder, and stays selected while lists come and go.
    if (get().listFolder?.id !== folderId) set({ photos: [] });
    const before = new Set(get().photos.map((p) => p.id));
    const seq = ++listSeq;
    set({ listLoading: true });
    const [folder, photos] = await Promise.all([
      callOr(api().linkedFolders.get({ folderId }), null),
      callOr(api().photos.list({ folderId }), [] as Photo[]),
    ]);
    // A later request wins: clicking through folders quickly never shows an
    // earlier folder's photos under a later folder's name.
    if (seq !== listSeq) return;
    if (folder === null) {
      set({ listFolder: null, photos: [], listLoading: false });
      return;
    }
    // After a rescan, drop only photos that were in this list and have gone.
    const now = new Set(photos.map((p) => p.id));
    const keep = new Set([...get().selection.ids].filter((id) => now.has(id) || !before.has(id)));
    set({ listFolder: folder, photos, listLoading: false, selection: pruneSelection(get().selection, keep) });
  },

  reloadList: async () => {
    const folder = get().listFolder;
    if (folder !== null) await get().openList(folder.id);
  },

  closeList: () => {
    listSeq += 1;
    set({ listFolder: null, photos: [], listLoading: false });
  },

  clickPhoto: (id, modifiers) => {
    const order = get().photos.map((p) => p.id);
    set({ selection: clickPhoto(get().selection, id, modifiers, order), burst: null, sequence: [] });
    void loadAnchor();
  },

  setAllTrips: (on) => {
    if (get().allTrips !== on) set({ allTrips: on });
  },

  loadMap: async (scope, force = false) => {
    const key = scopeKey(scope);
    if (!force && key === get().mapScopeKey) return;
    set({ mapScope: scope, mapScopeKey: key });
    if (scope === null) {
      set({ mapPoints: null, folders: {} });
      return;
    }
    const [points, folders] = await Promise.all([
      callOr(api().photos.mapPoints(scope), null),
      callOr(api().linkedFolders.list('all' in scope ? {} : { tripId: scope.tripId }), [] as LinkedFolderSummary[]),
    ]);
    // A later scope wins: a quick switch never shows the earlier trip's photos.
    if (get().mapScopeKey !== key) return;
    set({
      mapPoints: points,
      folders: Object.fromEntries(folders.map((f) => [f.id, { name: f.name, state: f.state }])),
    });
  },

  reloadMap: () => get().loadMap(get().mapScope, true),

  step: (delta) => {
    const { sequence, selection } = get();
    const index = selection.anchor === null ? -1 : sequence.indexOf(selection.anchor);
    const next = index < 0 ? undefined : sequence[index + delta];
    if (next === undefined) return;
    set({ selection: { ids: new Set([next]), anchor: next } });
    void loadAnchor();
  },

  closePreview: () => {
    anchorSeq += 1;
    set({ selection: NO_PHOTO_SELECTION, burst: null, anchorDetails: null, sequence: [] });
  },

  selectFromMap: (ids) => {
    const first = ids[0];
    if (first === undefined) return;
    set({ selection: { ids: new Set([first]), anchor: first }, burst: ids.length > 1 ? [...ids] : null, sequence: [] });
    void loadAnchor();
  },

  loadFilterOptions: async (includeArchived) => {
    const [years, folders, trips] = await Promise.all([
      callOr(api().photos.years({ includeArchived }), null),
      callOr(api().linkedFolders.list({}), [] as LinkedFolderSummary[]),
      callOr(api().trips.list({ includeArchived }), []),
    ]);
    const withFolders = new Set(folders.map((f) => f.tripId));
    set({
      years,
      tripsWithPhotos: trips
        .filter((t) => withFolders.has(t.id))
        .map((t) => ({ id: t.id, name: t.name }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    });
  },
}));

let anchorSeq = 0;

/**
 * Loads the anchor photo's details, keeping only the latest answer, and the
 * order the preview steps in: the burst if there is one, otherwise the
 * photo's folder, taken from the open list when it is that folder.
 */
async function loadAnchor(): Promise<void> {
  const store = usePhotoStore.getState();
  const anchor = store.selection.anchor;
  const seq = ++anchorSeq;
  const details = anchor === null ? null : await callOr(api().photos.get({ photoId: anchor }), null);
  if (seq !== anchorSeq) return;
  let sequence: string[] = [];
  const { burst, listFolder, photos, sequence: current } = usePhotoStore.getState();
  if (details !== null) {
    if (burst !== null) sequence = burst;
    else if (current.includes(details.photo.id)) sequence = current;
    else if (listFolder?.id === details.photo.folderId) sequence = photos.map((p) => p.id);
    else {
      const listed = await callOr(api().photos.list({ folderId: details.photo.folderId }), [] as Photo[]);
      if (seq !== anchorSeq) return;
      sequence = listed.map((p) => p.id);
    }
  }
  usePhotoStore.setState({ anchorDetails: details, sequence });
}

/*
 * Selecting anything in the library or on the map leaves all-trips mode
 * (design §8.2): the map goes back to showing that object's trip.
 */
useSelectionStore.subscribe((state, previous) => {
  if (state.selected !== null && state.selected !== previous.selected) {
    usePhotoStore.getState().setAllTrips(false);
  }
});
