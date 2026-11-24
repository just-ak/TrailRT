import { ImageOff, MapPinOff } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Photo } from "@shared/domain/linkedFolders";
import { photoStateText } from "@shared/photos/library";
import { api, callOr } from "../../lib/client";

/**
 * One photo's thumbnail, fetched when it first scrolls into view (Phase 11
 * Requirement 9.3). The bytes come over the bridge and are shown through a
 * `blob:` URL, so the CSP does not change (ADR 0020).
 *
 * `marked` adds a crossed-out pin to a photo with no place on the map, so
 * selecting it is not expected to move the map (Phase 14 Requirement 27.4).
 */
export function PhotoThumb({
  photo,
  selected,
  marked = false,
  onSelect,
}: {
  photo: Photo;
  selected: boolean;
  marked?: boolean;
  onSelect: () => void;
}): ReactNode {
  const box = useRef<HTMLButtonElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const held: { url: string | null; live: boolean } = { url: null, live: true };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void callOr(api().photos.thumbnail({ photoId: photo.id }), null).then((thumbnail) => {
        if (!held.live) return;
        if (thumbnail === null) {
          setFailed(true);
          return;
        }
        held.url = URL.createObjectURL(new Blob([thumbnail.bytes.slice().buffer], { type: "image/jpeg" }));
        setUrl(held.url);
      });
    });
    observer.observe(element);
    return () => {
      held.live = false;
      observer.disconnect();
      if (held.url !== null) URL.revokeObjectURL(held.url);
    };
  }, [photo.id]);

  const notOnMap = marked && photo.state !== "located" ? photoStateText(photo) : "";

  return (
    <button
      ref={box}
      type="button"
      aria-label={notOnMap === "" ? photo.relativePath : `${photo.relativePath}, ${notOnMap}`}
      title={notOnMap === "" ? photo.relativePath : `${photo.relativePath}\n${notOnMap}`}
      aria-pressed={selected}
      data-photo={photo.id}
      data-state={photo.state}
      onClick={onSelect}
      className={`relative aspect-square overflow-hidden rounded bg-[var(--color-surface-sunken)] ${selected ? "ring-2 ring-[var(--color-accent)]" : ""}`}
    >
      {url !== null && <img src={url} alt="" className="h-full w-full object-cover" />}
      {url === null && failed && (
        <span className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
          <ImageOff size={16} aria-hidden="true" />
        </span>
      )}
      {notOnMap !== "" && (
        <span className="absolute right-0.5 bottom-0.5 rounded bg-[var(--color-surface)]/85 p-0.5 text-[var(--color-text-muted)]">
          <MapPinOff size={11} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
