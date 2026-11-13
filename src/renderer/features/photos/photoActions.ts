import { api, call, describeError } from '../../lib/client';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavStore } from '../../stores/navStore';
import { usePhotoStore } from '../../stores/photoStore';
import { useSelectionStore } from '../../stores/selectionStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Linking and managing folders on disk. Phase 11, design §4. The main
 * process opens the folder chooser and checks the choice; the renderer only
 * ever holds a token and a path to display.
 */

function toast(message: string, tone: 'info' | 'error' = 'info'): void {
  useUiStore.getState().showToast(message, tone);
}

export const SELECT_A_TRIP = 'Select a trip to link a folder to.';

/** After any change to a folder: the tree, the selected folder and its list. */
async function refreshFolders(): Promise<void> {
  await Promise.all([
    useLibraryStore.getState().refresh(),
    useSelectionStore.getState().reload(),
    usePhotoStore.getState().reloadList(),
    usePhotoStore.getState().reloadMap(),
    usePhotoStore.getState().loadTripPhotos(usePhotoStore.getState().tripPhotos.tripId),
  ]);
}

/**
 * Opens the chooser for a trip, then the confirmation with Include
 * subfolders. A refusal (a Photos library, a folder already linked, no
 * access) is shown as the main process explained it.
 */
export async function linkFolderToTrip(tripId: string, tripName: string): Promise<void> {
  try {
    const chosen = await call(api().linkedFolders.chooseFolder({ tripId }));
    if (chosen === null) return; // cancelled
    useUiStore.getState().openDialog({ kind: 'linkFolder', tripName, chosen });
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

/** The trip a menu command acts on: the selected trip, or `null`. */
export function selectedTrip(): { id: string; name: string } | null {
  const { selected, trip } = useSelectionStore.getState();
  if (selected?.kind !== 'trip' || trip === null) return null;
  return { id: trip.id, name: trip.name };
}

/** File › Link Folder to Trip… and the trip's own button. */
export function linkFolderToSelectedTrip(): void {
  const trip = selectedTrip();
  if (trip === null) {
    toast(SELECT_A_TRIP);
    return;
  }
  void linkFolderToTrip(trip.id, trip.name);
}

export async function confirmLink(token: string, includeSubfolders: boolean): Promise<boolean> {
  try {
    const folder = await call(api().linkedFolders.link({ token, includeSubfolders }));
    // Show the folder just linked: its trip's page, on the Photos tab
    // (Phase 14), where the trip's linked folders are listed.
    const library = useLibraryStore.getState();
    await library.refresh();
    useNavStore.getState().openTrip(folder.tripId);
    useNavStore.getState().setTab('photos');
    await useSelectionStore.getState().select({ kind: 'linkedFolder', id: folder.id });
    toast(`Linked ${folder.name}. TrailRT reads it and never changes it.`);
    return true;
  } catch (cause) {
    toast(describeError(cause), 'error');
    return false;
  }
}

export function askToUnlink(folderId: string, name: string): void {
  useUiStore.getState().openDialog({ kind: 'unlinkFolder', folderId, name });
}

export async function unlink(folderId: string, name: string): Promise<boolean> {
  try {
    await call(api().linkedFolders.unlink({ folderId }));
    const ui = useUiStore.getState();
    if (ui.planDrawer?.kind === 'photos' && ui.planDrawer.folderId === folderId) {
      ui.closePlanDrawer();
      usePhotoStore.getState().closeList();
    }
    await useLibraryStore.getState().refresh();
    await useSelectionStore.getState().reload();
    toast(`Unlinked ${name}. Its files are where they were.`);
    return true;
  } catch (cause) {
    toast(describeError(cause), 'error');
    return false;
  }
}

export async function relink(folderId: string): Promise<void> {
  try {
    const folder = await call(api().linkedFolders.relink({ folderId }));
    if (folder === null) return; // cancelled
    await refreshFolders();
    toast(`Relinked ${folder.name}. Rescanning it now.`);
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function setIncludeSubfolders(folderId: string, include: boolean): Promise<void> {
  try {
    await call(api().linkedFolders.setIncludeSubfolders({ folderId, include }));
    await refreshFolders();
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function rescan(folderId: string): Promise<void> {
  try {
    await call(api().linkedFolders.rescan({ folderId }));
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export async function cancelScan(folderId: string): Promise<void> {
  try {
    await call(api().linkedFolders.cancelScan({ folderId }));
  } catch (cause) {
    toast(describeError(cause), 'error');
  }
}

export function showPhotos(folderId: string): void {
  useUiStore.getState().openPhotoList(folderId);
}

/**
 * Keeps the renderer in step with the scanner (design §5.6). Progress is
 * held per folder; a change reloads the tree, the selected folder and the
 * open list, coalesced so a burst of folders finishing reloads once.
 */
export function subscribeToFolderEvents(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offProgress = api().events.onLinkedFolderScanProgress((progress) => {
    usePhotoStore.getState().setProgress(progress);
  });
  const offChanged = api().events.onLinkedFoldersChanged(({ folderId }) => {
    usePhotoStore.getState().clearProgress(folderId);
    clearTimeout(timer);
    timer = setTimeout(() => void refreshFolders(), 150);
  });
  return () => {
    clearTimeout(timer);
    offProgress();
    offChanged();
  };
}
