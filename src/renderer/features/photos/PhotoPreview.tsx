import { ChevronLeft, ChevronRight, Crosshair, ExternalLink, FolderOpen, ImageOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../../components/IconButton';
import { api, call, describeError } from '../../lib/client';
import { usePhotoStore } from '../../stores/photoStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { getMapInstance } from '../map/mapInstance';
import { previewModel } from './previewModel';

/**
 * The selected photo, in the bottom-left corner of the map (design §10,
 * Requirement 6). Only the 640 px thumbnail is loaded, as bytes wrapped in a
 * `blob:` URL that is revoked when the photo changes (Requirement 6.6, design
 * §6.3). The original is never read into the window: Open hands it to the
 * default app.
 */

type Picture =
  | { kind: 'loading' }
  | { kind: 'shown'; url: string; width: number; height: number; fromCache: boolean }
  | { kind: 'none'; reason: string };

function run(action: () => Promise<unknown>): void {
  void action().catch((cause: unknown) => useUiStore.getState().showToast(describeError(cause), 'error'));
}

export function PhotoPreview(): ReactNode {
  const anchor = usePhotoStore((s) => s.selection.anchor);
  const details = usePhotoStore((s) => s.anchorDetails);
  const sequence = usePhotoStore((s) => s.sequence);
  const burst = usePhotoStore((s) => s.burst);
  const folders = usePhotoStore((s) => s.folders);
  const listFolder = usePhotoStore((s) => s.listFolder);
  const units = useSettingsStore((s) => s.settings.units);
  // Keyed by photo, so a new selection reads as loading without an extra render.
  const [loaded, setLoaded] = useState<{ photoId: string; picture: Picture } | null>(null);
  const picture: Picture = loaded !== null && loaded.photoId === anchor ? loaded.picture : { kind: 'loading' };
  const box = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (anchor === null) return undefined;
    // The URL is revoked when the photo changes or the box closes.
    const held: { url: string | null; live: boolean } = { url: null, live: true };
    call(api().photos.thumbnail({ photoId: anchor })).then(
      (thumbnail) => {
        if (!held.live) return;
        held.url = URL.createObjectURL(new Blob([thumbnail.bytes.slice().buffer], { type: 'image/jpeg' }));
        setLoaded({
          photoId: anchor,
          picture: {
            kind: 'shown',
            url: held.url,
            width: thumbnail.width,
            height: thumbnail.height,
            fromCache: thumbnail.fromCache === true,
          },
        });
      },
      (cause: unknown) => {
        if (held.live) setLoaded({ photoId: anchor, picture: { kind: 'none', reason: describeError(cause) } });
      },
    );
    return () => {
      held.live = false;
      if (held.url !== null) URL.revokeObjectURL(held.url);
    };
  }, [anchor]);

  // While the next photo's details load, the box keeps showing the last ones
  // rather than unmounting, so keyboard focus stays in it as you step.
  if (anchor === null || details === null) return null;

  const folderState =
    folders[details.photo.folderId]?.state ?? (listFolder?.id === details.photo.folderId ? listFolder.state : null);
  const model = previewModel({ details, folderState, units, sequence, inBurst: burst !== null });
  const store = usePhotoStore.getState;

  const zoom = (): void => {
    const map = getMapInstance();
    const { lat, lon } = details.photo;
    if (map === null || lat === null || lon === null) return;
    map.setView([lat, lon], Math.max(map.getZoom(), 16));
  };

  return (
    <section
      ref={box}
      role="region"
      aria-label="Photo preview"
      data-testid="photo-preview"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          store().step(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          store().step(1);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          store().closePreview();
        }
      }}
      className="pointer-events-auto flex min-h-0 shrink flex-col overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      style={{ width: 320, maxWidth: '100%' }}
    >
      <div
        className="relative flex min-h-[48px] shrink items-center justify-center overflow-hidden bg-[var(--color-surface-sunken)]"
        style={picture.kind === 'shown' ? { aspectRatio: `${picture.width} / ${picture.height}` } : { height: 120 }}
      >
        {picture.kind === 'shown' && (
          <img
            src={picture.url}
            alt={model.name}
            data-testid="photo-preview-image"
            className={`h-full w-full object-contain ${picture.fromCache ? 'opacity-70' : ''}`}
          />
        )}
        {picture.kind === 'loading' && <span className="text-[11px] text-[var(--color-text-muted)]">Loading…</span>}
        {picture.kind === 'none' && (
          <span className="flex flex-col items-center gap-1 px-3 text-center text-[11px] text-[var(--color-text-muted)]">
            <ImageOff size={20} aria-hidden="true" />
            {model.status === null ? picture.reason : 'No preview saved'}
          </span>
        )}
        {model.position !== null && (
          <span className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white" data-testid="photo-preview-position">
            {model.position}
          </span>
        )}
      </div>

      <div className="min-w-0 shrink-0 px-2.5 pt-2 pb-1 text-[12px]">
        <p className="truncate font-semibold text-[var(--color-text-primary)]" title={model.pathHint}>
          {model.name}
        </p>
        <p className="text-[var(--color-text-secondary)]" title={model.takenHint ?? undefined} data-testid="photo-preview-taken">
          {model.taken}
        </p>
        {model.location !== null && (
          <p className="text-[var(--color-text-secondary)]" data-testid="photo-preview-location">
            {model.location}
            {model.altitude !== null && <span> · {model.altitude}</span>}
            {model.accuracy !== null && <span> · {model.accuracy}</span>}
          </p>
        )}
        {model.noLocation !== null && <p className="text-[var(--color-text-secondary)]">{model.noLocation}</p>}
        {model.status !== null && (
          <p className="text-[var(--color-danger)]" data-testid="photo-preview-status">
            {model.status}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5" role="group" aria-label="Photo actions">
        <IconButton variant="ghost" hint="Previous photo" disabled={!model.canStepBack} onClick={() => store().step(-1)}>
          <ChevronLeft size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" hint="Next photo" disabled={!model.canStepForward} onClick={() => store().step(1)}>
          <ChevronRight size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" hint={model.zoomHint} disabled={!model.canZoom} onClick={zoom}>
          <Crosshair size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          hint={model.openHint}
          disabled={!model.canOpen}
          onClick={() => run(() => call(api().photos.open({ photoId: anchor })))}
        >
          <ExternalLink size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          hint={model.revealHint}
          disabled={!model.canReveal}
          onClick={() => run(() => call(api().photos.reveal({ photoId: anchor })))}
        >
          <FolderOpen size={16} aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" className="ml-auto" hint="Close the preview" onClick={() => store().closePreview()}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </section>
  );
}
