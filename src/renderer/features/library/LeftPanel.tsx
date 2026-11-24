import { MapPin, MapPinOff, Plus, SlidersHorizontal, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LibrarySection, TripSortKey } from "@shared/domain/types";
import type { TrackArrangement } from "@shared/library/trackGroups";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { IconButton } from "../../components/IconButton";
import * as actions from "../../lib/actions";
import { api } from "../../lib/client";
import { useLibraryStore, type ObjectSortKey } from "../../stores/libraryStore";
import { useNavStore } from "../../stores/navStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { linkFolderToSelectedTrip, linkLooseFolder } from "../photos/photoActions";
import { FolderPhotoGrid } from "../photos/FolderPhotoGrid";
import { PhotoViewFilters } from "../photos/PhotoViewFilters";
import { compileNamePattern } from "@shared/search/namePattern";
import { LibraryList, NothingMatches, removeDuplicatesItem, SearchProblem, SearchResults } from "./LibraryList";
import { TripPage } from "./TripPage";
import { today } from "../itinerary/viewModel";
import { defaultOpen, filterTree, findTrip, sectionRoot, tripListRoot, tripPageRoot } from "./libraryRoots";

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
  const selectedFolder = useSelectionStore((s) => s.linkedFolder);

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
  const searchError = useLibraryStore((s) => s.searchError);
  const scope = useLibraryStore((s) => s.searchScope);
  // Phase 14 Requirement 20.5: a search narrows the list that is open.
  const pattern = useMemo(() => (searching ? compileNamePattern(search) : null), [searching, search]);
  const regex = pattern?.ok === true ? pattern.regex : null;
  const narrowed = useMemo(() => (regex === null ? null : filterTree(root, regex)), [root, regex]);
  const tripPage = section === "trips" && openTrip !== null;
  // Only once its details have loaded, and only for the folder still selected.
  const photoFolder =
    section === "photos" && selectedFolder !== null && selectedKey === `linkedFolder:${selectedFolder.id}` ? selectedFolder : null;
  const here = tripPage ? "this trip" : SECTION_TITLE[section];

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="left-panel">
      <Header />
      {searching && <SearchScopeSwitch here={here} />}
      {searching && searchError !== null ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SearchProblem message={searchError} />
        </div>
      ) : searching && scope === "everywhere" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SearchResults selectedKey={selectedKey} />
        </div>
      ) : tripPage ? (
        <TripPage trip={openTrip} search={regex} />
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 px-3 pt-2 pb-1">
            <p className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
              {SECTION_TITLE[section]}
              {narrowed !== null && <span className="ml-1 font-normal normal-case tracking-normal">· matching</span>}
            </p>
            {section === "tracks" && <TrackArrangeControls />}
          </div>
          {section === "photos" && <PhotoViewFilters depth={-1} />}
          {narrowed !== null && narrowed.root.children.length === 0 ? (
            <NothingMatches where={SECTION_TITLE[section]} />
          ) : (
            // Phase 14 Requirement 27: a selected folder's photos sit under
            // the list, which then takes at most 40% of the panel.
            <div className={photoFolder === null ? "flex min-h-0 flex-1 flex-col" : "flex max-h-[40%] min-h-0 shrink-0 flex-col"}>
              <LibraryList
                root={narrowed?.root ?? root}
                label={SECTION_TITLE[section]}
                {...(narrowed === null ? {} : { openIds: narrowed.open })}
                emptyText={
                  section === "trips"
                    ? "No trips yet. Add one with the + button, or import a file."
                    : root.hint ?? `No ${SECTION_TITLE[section].toLowerCase()} in the visible trips.`
                }
              />
            </div>
          )}
          {photoFolder !== null && <FolderPhotoGrid key={photoFolder.id} folderId={photoFolder.id} folderName={photoFolder.name} />}
        </>
      )}
    </div>
  );
}

const DIRECTION_LABEL: Record<TrackArrangement, Record<"asc" | "desc", string>> = {
  name: { asc: "A to Z", desc: "Z to A" },
  date: { asc: "Oldest first", desc: "Newest first" },
  distance: { asc: "Shortest first", desc: "Longest first" },
};

/**
 * The Tracks section's arrangement (Phase 14 Requirement 22): by name, by
 * date as a tree of year › month › day, or by distance, and which way.
 */
function TrackArrangeControls(): ReactNode {
  const arrangement = useLibraryStore((s) => s.trackArrangement);
  const direction = useLibraryStore((s) => s.trackSortDirection);
  const setArrangement = useLibraryStore((s) => s.setTrackArrangement);
  const setDirection = useLibraryStore((s) => s.setTrackSortDirection);
  const next = direction === "asc" ? "desc" : "asc";
  const control =
    "rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)] outline-none focus-visible:border-[var(--color-accent)]";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <select
        id="trackArrangement"
        aria-label="Arrange tracks by"
        value={arrangement}
        onChange={(event) => setArrangement(event.target.value as TrackArrangement)}
        className={control}
      >
        <option value="name">Name</option>
        <option value="date">Date</option>
        <option value="distance">Distance</option>
      </select>
      <button
        type="button"
        aria-label={`Order: ${DIRECTION_LABEL[arrangement][direction]}. Change to ${DIRECTION_LABEL[arrangement][next]}`}
        title={DIRECTION_LABEL[arrangement][next]}
        onClick={() => setDirection(next)}
        className={control}
      >
        {DIRECTION_LABEL[arrangement][direction]}
      </button>
    </div>
  );
}

/**
 * Where a search looks (Phase 14 Requirement 20.6): the list that is open,
 * or the whole library. Shown only while there is search text.
 */
function SearchScopeSwitch({ here }: { here: string }): ReactNode {
  const scope = useLibraryStore((s) => s.searchScope);
  const setScope = useLibraryStore((s) => s.setSearchScope);
  const options: { id: "here" | "everywhere"; label: string }[] = [
    { id: "here", label: `In ${here}` },
    { id: "everywhere", label: "Everywhere" },
  ];
  return (
    <div role="radiogroup" aria-label="Search in" className="mx-2 mt-1.5 flex shrink-0 rounded-md bg-[var(--color-surface-sunken)] p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={scope === option.id}
          onClick={() => void setScope(option.id)}
          className={`flex-1 truncate rounded px-2 py-0.5 text-[12px] ${
            scope === option.id ? "bg-[var(--color-surface)] font-semibold text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"
          }`}
        >
          {option.label}
        </button>
      ))}
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

  const section = useNavStore((s) => s.section);
  // Phase 14 Requirement 9.2: in a cross-trip section, what makes sense there,
  // made outside any trip (ADR 0022).
  const sectionItems: MenuItem[] =
    section === "routes"
      ? [
          { label: "New Route", onSelect: () => void actions.startDrawingRoute() },
          { label: "New Straight-Line Route", onSelect: () => void actions.startStraightLineRoute() },
          removeDuplicatesItem("route"),
        ]
      : section === "waypoints"
        ? [{ label: "New Waypoint", onSelect: () => void actions.startPlacingWaypoint() }, removeDuplicatesItem("waypoint")]
        : section === "tracks"
          ? [{ ...removeDuplicatesItem("track"), separatorBefore: false }]
          : section === "photos"
            ? [{ label: "Link a Folder…", onSelect: () => void linkLooseFolder() }]
            : [];
  const moreItems: MenuItem[] = [
    ...sectionItems,
    { label: "New Trip", separatorBefore: sectionItems.length > 0, onSelect: () => useNavStore.getState().ask("newTrip") },
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
          // Phase 14 Requirement 20.4: say it takes a pattern.
          placeholder="Search names (pattern)"
          aria-label="Search trips"
          aria-description="Searches trip, route and waypoint names. Takes a regular expression, ignoring case, such as ^Day [0-9] or wales|scotland."
          title={"Searches trip, route and waypoint names.\nTakes a regular expression, ignoring case:\n^Day [0-9]   wales|scotland   20(24|25)"}
          spellCheck={false}
          onChange={(event) => void setSearch(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
        {/* Reachable with nothing selected: a new user's first act is bringing in their files. */}
        <IconButton variant="ghost" hint="Import files" onClick={() => void actions.chooseFilesToImport()}>
          <Upload size={16} aria-hidden="true" />
        </IconButton>
        <WaypointsOnMap />
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

/**
 * Waypoints on the map, from the left panel (Phase 14 Requirement 19): the
 * same saved setting as Layers › Waypoints, one click away, for trips with
 * hundreds of them. Pressed and highlighted while they are hidden, so a map
 * without its waypoints is never a surprise.
 */
function WaypointsOnMap(): ReactNode {
  const visibility = useSettingsStore((s) => s.settings.layerVisibility);
  const hidden = visibility.waypoints === false;
  return (
    <IconButton
      variant={hidden ? "active" : "ghost"}
      hint="Hide waypoints on the map"
      aria-pressed={hidden}
      data-testid="waypoints-on-map"
      onClick={() =>
        void useSettingsStore.getState().set({ key: "layerVisibility", value: { ...visibility, waypoints: hidden } })
      }
    >
      {hidden ? <MapPinOff size={16} aria-hidden="true" /> : <MapPin size={16} aria-hidden="true" />}
    </IconButton>
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
          Sort routes by
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
