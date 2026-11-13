import { Plus, SlidersHorizontal, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LibrarySection, TripSortKey } from "@shared/domain/types";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { IconButton } from "../../components/IconButton";
import * as actions from "../../lib/actions";
import { api } from "../../lib/client";
import { useLibraryStore, type ObjectSortKey } from "../../stores/libraryStore";
import { useNavStore } from "../../stores/navStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useUiStore } from "../../stores/uiStore";
import { linkFolderToSelectedTrip } from "../photos/photoActions";
import { PhotoViewFilters } from "../photos/PhotoViewFilters";
import { LibraryList, SearchResults } from "./LibraryList";
import { TripPage } from "./TripPage";
import { today } from "../itinerary/viewModel";
import { defaultOpen, findTrip, sectionRoot, tripListRoot, tripPageRoot } from "./libraryRoots";

/**
 * The left panel: one header row, then the rail's section. Phase 14,
 * Requirements 1 to 3, design §4.2.
 *
 * The Trips section is a list of trips, or one trip's page once opened. The
 * other sections are lists across trips. Every list is a `LibraryList`.
 */

const SECTION_TITLE: Record<LibrarySection, string> = {
  trips: "Trips",
  routes: "Routes",
  tracks: "Tracks",
  waypoints: "Waypoints",
  photos: "Photos",
  imported: "Imported Data",
};

export function LeftPanel(): ReactNode {
  const tree = useLibraryStore((s) => s.tree);
  const overview = useLibraryStore((s) => s.overview);
  const refresh = useLibraryStore((s) => s.refresh);
  const search = useLibraryStore((s) => s.search);
  const section = useNavStore((s) => s.section);
  const openTripId = useNavStore((s) => s.openTripId);
  const selectedKey = useSelectionStore((s) => (s.selected === null ? null : `${s.selected.kind}:${s.selected.id}`));

  useEffect(() => {
    void refresh();
    return api().events.onLibraryChanged(() => {
      void refresh();
    });
  }, [refresh]);

  const openTrip = useMemo(() => (openTripId === null ? null : findTrip(tree, openTripId)), [tree, openTripId]);

  // A trip that has gone (deleted, or archived while archived trips are
  // hidden) closes its page. One that is open loads on the map at launch.
  useEffect(() => {
    if (tree === null || openTripId === null) return;
    if (openTrip === null) {
      useNavStore.getState().closeTrip();
      return;
    }
    if (section === "trips" && useSelectionStore.getState().selected === null) {
      void useSelectionStore.getState().select({ kind: "trip", id: openTripId });
    }
  }, [tree, openTrip, openTripId, section]);

  const root = useMemo(() => {
    if (section === "trips") {
      return openTrip === null ? tripListRoot(tree, overview, today()) : tripPageRoot(openTrip);
    }
    return sectionRoot(tree, section);
  }, [section, openTrip, tree, overview]);

  const offerExpansion = useLibraryStore((s) => s.offerExpansion);
  useEffect(() => offerExpansion(defaultOpen(root)), [root, offerExpansion]);

  const searching = search.trim().length > 0;

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="left-panel">
      <Header />
      {searching ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SearchResults selectedKey={selectedKey} />
        </div>
      ) : section === "trips" && openTrip !== null ? (
        <TripPage trip={openTrip} />
      ) : (
        <>
          <p className="shrink-0 px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            {SECTION_TITLE[section]}
          </p>
          {section === "photos" && <PhotoViewFilters depth={-1} />}
          <LibraryList
            root={root}
            label={SECTION_TITLE[section]}
            emptyText={
              section === "trips"
                ? "No trips yet. Add one with the + button, or import a file."
                : root.hint ?? `No ${SECTION_TITLE[section].toLowerCase()} in the visible trips.`
            }
          />
        </>
      )}
    </div>
  );
}

/** Search, Import, the library options, and More (Requirement 2.3). One row. */
function Header(): ReactNode {
  const search = useLibraryStore((s) => s.search);
  const setSearch = useLibraryStore((s) => s.setSearch);
  const [options, setOptions] = useState(false);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const showToast = useUiStore((s) => s.showToast);

  const moreItems: MenuItem[] = [
    { label: "New Trip", onSelect: () => useNavStore.getState().ask("newTrip") },
    { label: "New Folder", onSelect: () => useNavStore.getState().ask("newFolder") },
    { label: "Import Files…", separatorBefore: true, onSelect: () => void actions.chooseFilesToImport() },
    {
      label: "Export…",
      onSelect: () => {
        const scope = actions.currentExportScope();
        if (scope === null) {
          showToast("Select a trip or object to export.", "error");
          return;
        }
        actions.openExportDialog(scope);
      },
    },
    { label: "Link Folder to Trip…", separatorBefore: true, onSelect: () => linkFolderToSelectedTrip() },
  ];

  return (
    <div className="relative shrink-0 border-b border-[var(--color-border-subtle)] px-2 py-2">
      <div className="flex items-center gap-1">
        <input
          type="search"
          value={search}
          placeholder="Search trips and waypoints"
          aria-label="Search trips"
          onChange={(event) => void setSearch(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        {/* Reachable with nothing selected: a new user's first act is bringing in their files. */}
        <IconButton variant="ghost" hint="Import files" onClick={() => void actions.chooseFilesToImport()}>
          <Upload size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          hint="Library options"
          aria-expanded={options}
          onClick={() => setOptions((open) => !open)}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          hint="More actions"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMore({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </div>
      {options && <Options onClose={() => setOptions(false)} />}
      {more !== null && <ContextMenu x={more.x} y={more.y} items={moreItems} onClose={() => setMore(null)} />}
    </div>
  );
}

/** Sort, archived trips, and the order of objects in the cross-trip sections. */
function Options({ onClose }: { onClose: () => void }): ReactNode {
  const { sortKey, sortDirection, setSort, showArchived, setShowArchived, objectSortKey, setObjectSort } = useLibraryStore();
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (box.current !== null && !box.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const control =
    "rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1 py-0.5 text-[12px] text-[var(--color-text-primary)]";
  return (
    <div
      ref={box}
      role="group"
      aria-label="Library options"
      className="absolute top-full right-2 z-[800] mt-1 grid w-60 gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-[12px] text-[var(--color-text-secondary)] shadow-lg"
    >
      <div className="flex items-center gap-2">
        <label htmlFor="sortKey" className="w-24">
          Sort trips by
        </label>
        <select id="sortKey" value={sortKey} onChange={(e) => setSort(e.target.value as TripSortKey, sortDirection)} className={control}>
          <option value="name">Name</option>
          <option value="updatedAt">Modified</option>
          <option value="createdAt">Created</option>
        </select>
        <button
          type="button"
          aria-label="Toggle sort direction"
          onClick={() => setSort(sortKey, sortDirection === "asc" ? "desc" : "asc")}
          className={control}
        >
          {sortDirection === "asc" ? "↑" : "↓"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        {/* Objects are sorted apart from trips: a trip has no distance. */}
        <label htmlFor="objectSortKey" className="w-24">
          Sort objects by
        </label>
        <select id="objectSortKey" value={objectSortKey} onChange={(e) => setObjectSort(e.target.value as ObjectSortKey)} className={control}>
          <option value="name">Name</option>
          <option value="distance">Distance</option>
        </select>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Archived
      </label>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        Trips are grouped by date in the list; sorting orders trips within folders and the cross-trip sections.
      </p>
    </div>
  );
}
