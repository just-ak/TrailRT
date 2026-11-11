import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { PANEL_LIMITS } from "@shared/domain/defaults";
import { DrawerPane } from "../components/DrawerPane";
import { DEFAULT_DRAWER } from "../components/drawerHeight";
import { SplitPane } from "../components/SplitPane";
import { LibraryPanel } from "../features/library/LibraryPanel";
import { MapView } from "../features/map/MapView";
import { drawerAfterSelection } from "../features/profile/drawerTarget";
import { ProfilePanel } from "../features/profile/ProfilePanel";
import { CalendarPanel } from "../features/itinerary/CalendarPanel";
import { PoiPanel } from "../features/poi/PoiPanel";
import { PropertiesPanel } from "../features/properties/PropertiesPanel";
import { useSelectionStore } from "../stores/selectionStore";
import { useUiStore } from "../stores/uiStore";
import { useGeometryStore } from "../stores/geometryStore";
import { useItineraryStore } from "../stores/itineraryStore";
import { api } from "../lib/client";

/**
 * The three-panel workspace: library, map, properties.
 *
 * The map is the flex child so it absorbs all remaining width. Hiding a side
 * panel therefore reflows the map rather than leaving a gap, and the
 * ResizeObserver in useLeafletMap keeps Leaflet's internal size in step.
 */
export function Layout(): ReactNode {
  const layout = useUiStore((s) => s.layout);
  const setLayout = useUiStore((s) => s.setLayout);
  const profile = useUiStore((s) => s.profile);
  const closeProfile = useUiStore((s) => s.closeProfile);
  const planDrawer = useUiStore((s) => s.planDrawer);
  const closePlanDrawer = useUiStore((s) => s.closePlanDrawer);
  const selected = useSelectionStore((s) => s.selected);

  /*
   * The drawer follows the selection. Picking another route in the library or
   * on the map shows that route's profile (and its points, if the list was
   * open); picking something with no profile closes it. See drawerTarget.ts.
   */
  useEffect(() => {
    const ui = useUiStore.getState();
    const patch = drawerAfterSelection(
      { profile: ui.profile, pointTable: ui.pointTable },
      selected,
    );
    if (patch !== null) useUiStore.setState(patch);
  }, [selected]);

  /*
   * Phase 10: the itinerary follows the trip the map shows, and reloads after
   * every change and every undo, which the main process announces as a
   * library change.
   */
  const tripId = useGeometryStore((s) => s.tripId);
  useEffect(() => {
    void useItineraryStore.getState().load(tripId);
  }, [tripId]);
  useEffect(
    () =>
      api().events.onLibraryChanged(() => {
        void useItineraryStore.getState().reload();
      }),
    [],
  );

  const column = useRef<HTMLDivElement | null>(null);
  const columnHeight = useCallback(() => column.current?.clientHeight ?? window.innerHeight, []);
  const drawer: ReactNode =
    profile !== null ? (
      <ProfilePanel
        // Remount on a change of geometry so no stale hover survives.
        key={`${profile.ownerType}:${profile.ownerId}`}
        ownerType={profile.ownerType}
        ownerId={profile.ownerId}
        onClose={closeProfile}
      />
    ) : planDrawer?.kind === "calendar" ? (
      <CalendarPanel tripId={planDrawer.tripId} onClose={closePlanDrawer} />
    ) : planDrawer?.kind === "poi" ? (
      <PoiPanel scope={planDrawer.scope} onClose={closePlanDrawer} />
    ) : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--color-surface)]">
      {layout.libraryVisible && (
        <SplitPane
          side="left"
          label="library panel"
          width={layout.libraryWidth}
          min={PANEL_LIMITS.libraryMin}
          max={PANEL_LIMITS.libraryMax}
          onResize={(libraryWidth) => setLayout({ libraryWidth })}
        >
          <LibraryPanel />
        </SplitPane>
      )}

      {/*
        The map and the profile drawer share a column, so opening the drawer
        shortens the map rather than overlaying it. An overlay would cover the
        part of the route the user is hovering over, which is the one thing the
        profile is for. The point table opens inside the same drawer.
      */}
      <div ref={column} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MapView />
        {/* Phase 10: one panel below the map at a time, resizable by its top
            edge and hideable, so the map always keeps its space. */}
        {drawer !== null && layout.drawerVisible !== false && (
          <DrawerPane
            height={layout.drawerHeight ?? DEFAULT_DRAWER}
            columnHeight={columnHeight}
            onResize={(drawerHeight) => setLayout({ drawerHeight })}
          >
            {drawer}
          </DrawerPane>
        )}
      </div>

      {layout.propertiesVisible && (
        <SplitPane
          side="right"
          label="properties panel"
          width={layout.propertiesWidth}
          min={PANEL_LIMITS.propertiesMin}
          max={PANEL_LIMITS.propertiesMax}
          onResize={(propertiesWidth) => setLayout({ propertiesWidth })}
        >
          <PropertiesPanel />
        </SplitPane>
      )}
    </div>
  );
}
