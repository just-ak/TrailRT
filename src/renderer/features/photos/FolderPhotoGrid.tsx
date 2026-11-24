import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Photo } from "@shared/domain/linkedFolders";
import { plural } from "@shared/photos/library";
import { api, callOr } from "../../lib/client";
import { useMapFocusStore } from "../../stores/mapFocusStore";
import { usePhotoStore } from "../../stores/photoStore";
import { layoutPhotoGrid, rowsInView } from "./photoGrid";
import { PhotoThumb } from "./PhotoThumb";

/**
 * One linked folder's photos under the Photos section's list (Phase 14
 * Requirement 27, design §5.19): thumbnails by the day they were taken,
 * undated last.
 *
 * Virtualised: rows have known heights, and only those meeting the viewport
 * are drawn, so a folder of 40,000 photos draws a dozen rows (Requirement
 * 7.3). The folder is loaded here rather than read from the photo list
 * drawer's store, because closing the drawer empties that list.
 *
 * Selecting a photo opens it in the preview box, as clicking it on the map
 * does, and moves the map to where it was taken.
 */

const COLUMNS = 4;
const GAP = 4;
const PADDING = 8;
const HEADING = 26;
const OVERSCAN = 200;
const EMPTY: Photo[] = [];

/** Opens the photo in the preview box, as the map does, and moves the map to it. */
function choose(photo: Photo): void {
  usePhotoStore.getState().selectFromMap([photo.id]);
  useMapFocusStore.getState().goToPhoto(photo);
}

/** Give it `key={folderId}`, so another folder starts empty and at its top. */
export function FolderPhotoGrid({ folderId, folderName }: { folderId: string; folderName: string }): ReactNode {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const selected = usePhotoStore((s) => s.selection.ids);
  const viewport = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      void callOr(api().photos.list({ folderId }), EMPTY).then((list) => {
        if (live) setPhotos(list);
      });
    };
    load();
    // The scanner says when the folder changed; reload only for this one.
    const off = api().events.onLinkedFoldersChanged((change) => {
      if (change.folderId === folderId) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [folderId]);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return undefined;
    const measure = (): void => setSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const cell = Math.max(24, (size.width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);
  const layout = useMemo(
    () => layoutPhotoGrid(photos ?? EMPTY, { columns: COLUMNS, rowHeight: cell + GAP, headingHeight: HEADING }),
    [photos, cell],
  );
  const visible = rowsInView(layout.rows, scrollTop, size.height, OVERSCAN);

  return (
    <section
      aria-label={`Photos in ${folderName}`}
      data-testid="folder-photos"
      className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-border-subtle)]"
    >
      <p className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        <span className="truncate">{folderName}</span>
        <span className="shrink-0 font-normal tracking-normal normal-case" data-testid="folder-photos-count">
          {photos === null ? "Loading…" : plural(photos.length, "photo")}
        </span>
      </p>
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {photos !== null && photos.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">No photos found in this folder yet.</p>
        )}
        <div style={{ height: layout.height }} className="relative">
          {visible.map((row) =>
            row.kind === "day" ? (
              <p
                key={row.key}
                style={{ top: row.top, height: row.height }}
                className="absolute inset-x-0 flex items-end justify-between px-3 pb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
              >
                <span>{row.label}</span>
                <span className="font-normal normal-case">{plural(row.count, "photo")}</span>
              </p>
            ) : (
              <div
                key={row.key}
                style={{ top: row.top, height: cell, gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gap: GAP }}
                className="absolute inset-x-0 grid px-2"
              >
                {row.photos.map((photo) => (
                  <PhotoThumb key={photo.id} photo={photo} selected={selected.has(photo.id)} marked onSelect={() => choose(photo)} />
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
