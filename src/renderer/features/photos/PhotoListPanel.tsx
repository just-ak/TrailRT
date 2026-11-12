import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fileName, photoStateText, plural, subfolder, takenText } from '@shared/photos/library';
import { IconButton } from '../../components/IconButton';
import { usePhotoStore } from '../../stores/photoStore';
import { visibleWindow } from '../points/pointRows';

/**
 * One linked folder's photos, below the map (design §8.3, Requirements 4.3
 * and 4.4). In taken-time order, undated last, with each photo's state and
 * the reason it is not on the map. Virtualised with fixed row heights, as the
 * point table is, so 40,000 rows cost the same as 30.
 *
 * Selecting a row selects the photo: the preview box (task 11) shows it and
 * the map (task 10) brings it into view. ⌘ and Shift select several, as in
 * the library.
 */

const ROW_HEIGHT = 26;
const COLUMNS = 'minmax(0,2fr) minmax(0,1.4fr) minmax(0,2fr)';

export function PhotoListPanel({ folderId, onClose }: { folderId: string; onClose: () => void }): ReactNode {
  const { listFolder, photos, listLoading, selection } = usePhotoStore();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const viewport = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void usePhotoStore.getState().openList(folderId);
  }, [folderId]);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const close = (): void => {
    usePhotoStore.getState().closeList();
    onClose();
  };

  // Keyboard: up and down move the selection, keeping the row in view.
  const move = (delta: number, shiftKey: boolean): void => {
    const anchor = selection.anchor;
    const index = anchor === null ? -1 : photos.findIndex((p) => p.id === anchor);
    const next = photos[Math.min(photos.length - 1, Math.max(0, index + delta))];
    if (next === undefined) return;
    usePhotoStore.getState().clickPhoto(next.id, { metaKey: false, shiftKey });
    const element = viewport.current;
    const at = photos.indexOf(next) * ROW_HEIGHT;
    if (element !== null && (at < element.scrollTop || at + ROW_HEIGHT > element.scrollTop + element.clientHeight)) {
      element.scrollTop = Math.max(0, at - element.clientHeight / 2);
    }
  };

  const window = visibleWindow({ total: photos.length, rowHeight: ROW_HEIGHT, viewportHeight, scrollTop });
  const rows = photos.slice(window.first, window.first + window.count);
  const folderState = listFolder?.state ?? null;
  const unplaced = photos.filter((p) => p.state !== 'located').length;

  return (
    <section aria-label="Photos" data-testid="photo-list" className="flex h-full flex-col bg-[var(--color-surface)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border-subtle)] px-2 py-1.5">
        <h2 className="truncate text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          {listFolder?.name ?? 'Photos'}
        </h2>
        <span className="text-[11px] text-[var(--color-text-muted)]" data-testid="photo-list-count">
          {listLoading && photos.length === 0
            ? 'Loading…'
            : `${plural(photos.length, 'photo')}${unplaced > 0 ? ` · ${unplaced.toLocaleString('en-GB')} not on the map` : ''}`}
          {selection.ids.size > 1 ? ` · ${selection.ids.size.toLocaleString('en-GB')} selected` : ''}
        </span>
        <IconButton variant="ghost" className="ml-auto" hint="Close" onClick={close}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      <div
        className="grid shrink-0 gap-2 border-b border-[var(--color-border-subtle)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-muted)]"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Name</span>
        <span>Taken</span>
        <span>Location</span>
      </div>

      <div
        ref={viewport}
        role="listbox"
        aria-label="Photos in this folder"
        aria-multiselectable="true"
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto text-[12px] outline-none"
      >
        {!listLoading && photos.length === 0 && (
          <p className="p-3 text-[12px] text-[var(--color-text-muted)]">
            {folderState === 'scanning' ? 'Scanning the folder…' : 'No photos found in this folder.'}
          </p>
        )}
        <div style={{ height: window.padTop }} />
        {rows.map((photo) => {
          const selected = selection.ids.has(photo.id);
          const anchor = selection.anchor === photo.id;
          const state = photoStateText(photo, folderState);
          const where = subfolder(photo.relativePath);
          return (
            <div
              key={photo.id}
              role="option"
              aria-selected={selected}
              data-photo={photo.id}
              data-state={photo.state}
              onClick={(event) =>
                usePhotoStore.getState().clickPhoto(photo.id, { metaKey: event.metaKey, shiftKey: event.shiftKey })
              }
              className={`grid cursor-default items-center gap-2 px-2 ${
                anchor
                  ? 'bg-[var(--color-accent)] text-white'
                  : selected
                    ? 'bg-[var(--color-accent)]/30'
                    : 'hover:bg-[var(--color-surface-sunken)]'
              }`}
              style={{ gridTemplateColumns: COLUMNS, height: ROW_HEIGHT }}
              title={photo.relativePath}
            >
              <span className="truncate">
                {fileName(photo.relativePath)}
                {where !== null && (
                  <span className={`ml-1.5 text-[11px] ${anchor ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
                    {where}
                  </span>
                )}
              </span>
              <span className="truncate">{takenText(photo)}</span>
              <span
                className={`truncate ${anchor ? 'text-white/80' : state === '' ? '' : 'text-[var(--color-text-secondary)]'}`}
                title={state === '' ? undefined : state}
              >
                {state === '' ? 'On the map' : state}
              </span>
            </div>
          );
        })}
        <div style={{ height: window.padBottom }} />
      </div>
    </section>
  );
}
