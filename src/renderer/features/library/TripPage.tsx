import { CalendarDays, ChevronLeft, Download, Ellipsis, FolderPlus, ImageOff, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Photo } from "@shared/domain/linkedFolders";
import type { TreeNode, TripTab } from "@shared/domain/types";
import { tripMeta } from "@shared/library/tripGroups";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { IconButton } from "../../components/IconButton";
import * as actions from "../../lib/actions";
import { api, call, callOr, describeError } from "../../lib/client";
import { useGeometryStore } from "../../stores/geometryStore";
import { useItineraryStore } from "../../stores/itineraryStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { useNavStore } from "../../stores/navStore";
import { usePhotoStore } from "../../stores/photoStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useUiStore } from "../../stores/uiStore";
import { linkFolderToTrip } from "../photos/photoActions";
import { LibraryList } from "./LibraryList";
import { linkedFoldersRoot, objectsRoot, planRoot } from "./libraryRoots";

/**
 * One trip in the left panel. Phase 14, Requirement 3.
 *
 * A header with the trip's name, dates and actions, then three tabs: Plan
 * (the days, or the objects of an undated trip), Objects (routes, tracks and
 * waypoints) and Photos (its linked folders, and its photos by day). Plan and
 * Objects are `LibraryList`s, so selection, multi-selection, the keyboard,
 * drag and the menus are those of every other list. Nothing is nested more
 * than one level inside a day.
 */
export function TripPage({ trip }: { trip: TreeNode }): ReactNode {
  const tripId = trip.ref?.id ?? "";
  const tab = useNavStore((s) => s.tripTab);
  const view = useItineraryStore((s) => s.view);
  const geometry = useGeometryStore((s) => s.geometry);
  const photos = usePhotoStore((s) => (s.tripPhotos.tripId === tripId ? s.tripPhotos.photos : EMPTY_PHOTOS));
  const overview = useLibraryStore((s) => s.overview.find((t) => t.id === tripId) ?? null);

  useEffect(() => {
    void usePhotoStore.getState().loadTripPhotos(tripId);
  }, [tripId]);

  const plan = useMemo(() => planRoot(tripId, view, geometry, photos), [tripId, view, geometry, photos]);
  const objects = useMemo(() => objectsRoot(tripId, geometry), [tripId, geometry]);
  const folders = useMemo(() => linkedFoldersRoot(trip), [trip]);
  const offerExpansion = useLibraryStore((s) => s.offerExpansion);
  useEffect(() => {
    const open: string[] = [];
    const walk = (node: TreeNode): void => {
      if (node.defaultExpanded === true) open.push(node.id);
      node.children.forEach(walk);
    };
    walk(plan);
    walk(objects);
    offerExpansion(open);
  }, [plan, objects, offerExpansion]);

  const objectCount = overview === null ? null : overview.counts.routes + overview.counts.tracks + overview.counts.waypoints;
  const tabs: { id: TripTab; label: string; count: number | null }[] = [
    { id: "plan", label: "Plan", count: null },
    { id: "objects", label: "Objects", count: objectCount },
    { id: "photos", label: "Photos", count: overview?.counts.photos ?? null },
  ];
  const dated = view !== null && view.itinerary.tripId === tripId;

  return (
    <>
      <TripHeader tripId={tripId} name={trip.name} />
      <div role="tablist" aria-label="Trip" className="mx-2 mt-2 flex shrink-0 rounded-md bg-[var(--color-surface-sunken)] p-0.5" data-testid="trip-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => useNavStore.getState().setTab(t.id)}
            className={`flex-1 rounded px-2 py-1 text-[12px] ${
              tab === t.id ? "bg-[var(--color-surface)] font-semibold text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"
            }`}
          >
            {t.label}
            {t.count !== null && t.count > 0 && <span className="ml-1 text-[var(--color-text-muted)]">{t.count}</span>}
          </button>
        ))}
      </div>
      {tab === "plan" && (
        <>
          {!dated && <NoPlanYet tripId={tripId} />}
          <LibraryList
            root={plan}
            label={`${trip.name} plan`}
            emptyText="Nothing in this trip yet. Draw a route, add a waypoint, import a file or link a folder."
          />
        </>
      )}
      {tab === "objects" && (
        <LibraryList root={objects} label={`${trip.name} objects`} emptyText="No routes, tracks or waypoints yet." />
      )}
      {tab === "photos" && <PhotosTab tripName={trip.name} folders={folders} photos={photos} />}
    </>
  );
}

const EMPTY_PHOTOS: Photo[] = [];

/** An undated trip's Plan tab says why there are no days (Requirement 3.3). */
function NoPlanYet({ tripId }: { tripId: string }): ReactNode {
  return (
    <div className="mx-2 mt-2 shrink-0 rounded-md bg-[var(--color-surface-sunken)] p-3 text-[12px]" data-testid="no-plan">
      <p className="flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]">
        <CalendarDays size={15} aria-hidden="true" />
        No plan yet
      </p>
      <p className="mt-1 text-[var(--color-text-secondary)]">
        Give the trip a start date, in its properties, and its stops are laid out day by day.
      </p>
      <button
        type="button"
        onClick={() => void useSelectionStore.getState().select({ kind: "trip", id: tripId })}
        className="mt-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-0.5 text-[12px] text-[var(--color-accent)]"
      >
        Choose dates…
      </button>
    </div>
  );
}

/**
 * The Photos tab (Requirement 3.5): the trip's linked folders, then its photos
 * grouped by the day they were taken. Thumbnails are fetched only for cells
 * that come into view (Phase 11 Requirement 9.3).
 */
function PhotosTab({
  tripName,
  folders,
  photos,
}: {
  tripName: string;
  folders: TreeNode;
  photos: readonly Photo[];
}): ReactNode {
  const groups = useMemo(() => {
    const byDay = new Map<string, Photo[]>();
    for (const photo of photos) {
      const key = photo.takenLocal?.slice(0, 10) ?? "none";
      const list = byDay.get(key);
      if (list === undefined) byDay.set(key, [photo]);
      else list.push(photo);
    }
    return [...byDay.entries()];
  }, [photos]);
  const selected = usePhotoStore((s) => s.selection.ids);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="max-h-[40%] shrink-0 overflow-hidden">
        <LibraryList
          root={folders}
          label={`${tripName} linked folders`}
          emptyText="No linked folder. Link the trip's folder on disk with the folder button above."
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="trip-photos">
        {photos.length === 0 && folders.children.length > 0 && (
          <p className="px-1 py-2 text-[12px] text-[var(--color-text-muted)]">No photos found yet in the linked folders.</p>
        )}
        {groups.map(([day, list]) => (
          <section key={day} className="mt-2" aria-label={day === "none" ? "No date" : day}>
            <p className="mb-1 flex justify-between px-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
              <span>{day === "none" ? "No date" : dayLabel(day)}</span>
              <span className="font-normal normal-case">{list.length} photo{list.length === 1 ? "" : "s"}</span>
            </p>
            <div className="grid grid-cols-4 gap-1">
              {list.map((photo) => (
                <PhotoCell key={photo.id} photo={photo} selected={selected.has(photo.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = (new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
  return `${DAY_NAMES[weekday] ?? ""} ${d ?? ""} ${MONTHS[(m ?? 1) - 1] ?? ""} ${y ?? ""}`;
}

/** One thumbnail, fetched when it first scrolls into view. */
function PhotoCell({ photo, selected }: { photo: Photo; selected: boolean }): ReactNode {
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

  return (
    <button
      ref={box}
      type="button"
      aria-label={photo.relativePath}
      aria-pressed={selected}
      data-photo={photo.id}
      onClick={() => usePhotoStore.getState().selectFromMap([photo.id])}
      className={`relative aspect-square overflow-hidden rounded bg-[var(--color-surface-sunken)] ${selected ? "ring-2 ring-[var(--color-accent)]" : ""}`}
    >
      {url !== null && <img src={url} alt="" className="h-full w-full object-cover" />}
      {url === null && failed && (
        <span className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
          <ImageOff size={16} aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

/**
 * The top of a trip's page (Requirement 3.1): back to the list, the name, its
 * dates and size, and its actions. Dragging something onto "Trips" opens the
 * list, so it can be dropped onto another trip.
 */
function TripHeader({ tripId, name }: { tripId: string; name: string }): ReactNode {
  const trip = useLibraryStore((s) => s.overview.find((t) => t.id === tripId) ?? null);
  const refresh = useLibraryStore((s) => s.refresh);
  const showToast = useUiStore((s) => s.showToast);
  const openDialog = useUiStore((s) => s.openDialog);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const meta = trip === null ? "" : tripMeta(trip, null);

  const run = (work: () => Promise<unknown>): void => {
    void work().catch((cause: unknown) => showToast(describeError(cause), "error"));
  };

  const items: MenuItem[] = [
    { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
    { label: "New Straight-Line Route", onSelect: () => actions.startStraightLineRoute() },
    { label: "New Waypoint", onSelect: () => actions.startPlacingWaypoint() },
    { label: "Rename…", separatorBefore: true, onSelect: () => setRenaming(true) },
    {
      label: "Duplicate",
      onSelect: () =>
        run(async () => {
          const copy = await call(api().trips.duplicate({ id: tripId }));
          await refresh();
          useNavStore.getState().openTrip(copy.id);
        }),
    },
    {
      label: trip?.status === "archived" ? "Unarchive" : "Archive",
      onSelect: () =>
        run(async () => {
          await call(api().trips.setStatus({ id: tripId, status: trip?.status === "archived" ? "active" : "archived" }));
          await refresh();
        }),
    },
    {
      label: "Delete Trip…",
      danger: true,
      separatorBefore: true,
      onSelect: () =>
        run(async () => {
          const full = await call(api().trips.get({ id: tripId }));
          openDialog({
            kind: "confirmDelete",
            target: { type: "trip", id: tripId, name },
            counts: { routes: full.routeCount, tracks: full.trackCount, waypoints: full.waypointCount },
          });
        }),
    },
  ];

  return (
    <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-3 pt-2 pb-2" data-testid="trip-header">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Back to trips"
          onClick={() => useNavStore.getState().closeTrip()}
          onDragEnter={() => useNavStore.getState().closeTrip()}
          className="-ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[12.5px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-surface-sunken)]"
        >
          <ChevronLeft size={15} aria-hidden="true" />
          Trips
        </button>
        <span className="ml-auto flex items-center">
          <IconButton variant="ghost" hint="Link a folder on disk to this trip" onClick={() => void linkFolderToTrip(tripId, name)}>
            <FolderPlus size={16} aria-hidden="true" />
          </IconButton>
          <IconButton variant="ghost" hint="Import GPX, KML or other files" onClick={() => void actions.chooseFilesToImport()}>
            <Upload size={16} aria-hidden="true" />
          </IconButton>
          <IconButton variant="ghost" hint="Export the trip" onClick={() => actions.openExportDialog({ kind: "trips", tripIds: [tripId] })}>
            <Download size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            hint="More for this trip"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      {renaming ? (
        <input
          // A fresh input per rename, focused with its text selected.
          key={`rename-${name}`}
          ref={(input) => {
            input?.focus();
            input?.select();
          }}
          aria-label="Trip name"
          defaultValue={name}
          onBlur={(event) => void commitName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitName(event.currentTarget.value);
            if (event.key === "Escape") setRenaming(false);
          }}
          className="mt-1 w-full rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-1 text-[17px] font-bold text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        // Clicking the name selects the trip itself, so the right panel shows
        // the trip again after a route or waypoint was selected.
        <h2
          className="mt-1 cursor-default truncate text-[17px] font-bold text-[var(--color-text-primary)]"
          onClick={() => void useSelectionStore.getState().select({ kind: "trip", id: tripId })}
          onDoubleClick={() => setRenaming(true)}
        >
          {name}
        </h2>
      )}
      {meta !== "" && <p className="text-[11.5px] text-[var(--color-text-secondary)]">{meta}</p>}
      {menu !== null && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );

  async function commitName(value: string): Promise<void> {
    setRenaming(false);
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === name) return;
    try {
      await call(api().trips.update({ id: tripId, name: trimmed }));
      await refresh();
      await useSelectionStore.getState().reload();
    } catch (cause) {
      showToast(describeError(cause), "error");
    }
  }
}
