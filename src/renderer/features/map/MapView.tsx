import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import L from "leaflet";
import { MAP_OVERLAYS, MAP_PROVIDERS } from "@shared/map/MapProvider";
import type {
  Bounds,
  MapPosition,
  RouteWithPoints,
  Track,
  Waypoint,
} from "@shared/domain/types";
import { formatDistance } from "@shared/geo/units";
import { pathDistance, type LatLon } from "@shared/geo/distance";
import { routeColour } from "@shared/domain/symbols";
import type { PlannedControl } from "@shared/routing/edit";
import type { Candidate } from "@shared/routing/results";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { api, callOr, describeError } from "../../lib/client";
import * as actions from "../../lib/actions";
import { useEditorStore } from "../../stores/editorStore";
import { useGeometryStore } from "../../stores/geometryStore";
import { useSelectionStore } from "../../stores/selectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { useRoutingStore } from "../../stores/routingStore";
import { useShapingStore } from "../../stores/shapingStore";
import {
  draftLegShapes,
  snapPointCount,
  snapRoutedDistanceM,
  useSnapRoutingStore,
} from "../../stores/snapRoutingStore";
import { getMapInstance, useMapInstance } from "./mapInstance";
import { MapReadout } from "./MapReadout";
import { useDrawMode } from "./useDrawMode";
import { useLeafletMap } from "./useLeafletMap";
import { useMeasureTool, measureStateFrom } from "./useMeasureTool";
import { useRouteLayers } from "./useRouteLayers";
import { useRouteShaping } from "./useRouteShaping";
import { useExtendRoute } from "./useExtendRoute";
import { useCandidateLayers } from "./useCandidateLayers";
import { CandidateList } from "./CandidateList";
import { candidateSummaries, legAlternativesAvailability } from "./candidates";
import { shapingStateFrom } from "./shapingState";
import { useSnapOverlay } from "./useSnapOverlay";
import { useSnapRouting } from "./useSnapRouting";
import { useTrackLayers } from "./useTrackLayers";
import { useWaypointLayers } from "./useWaypointLayers";
import { usePoiLayer } from "./usePoiLayer";
import { usePhotoLayer } from "./usePhotoLayer";
import { usePhotoStore } from "../../stores/photoStore";
import { useLibraryStore } from "../../stores/libraryStore";
import { mapScopeFor } from "../photos/photoMapScope";
import { SearchBox } from "../search/SearchBox";
import { PanelToggles } from "./PanelToggles";
import { MapCornerStack } from "./MapCornerStack";
import { PhotoPreview } from "../photos/PhotoPreview";
import type { PoiHit } from "@shared/poi/PoiProvider";
import { usePoiStore } from "../../stores/poiStore";

/**
 * The centre workspace: base map plus the selected trip's routes and waypoints.
 *
 * Layer rendering is delegated to hooks that attach to the single Leaflet
 * instance. This component wires them to the stores and owns the overlay UI.
 */

/**
 * Stable empty collections.
 *
 * Passing `?? []` inline gives a hook a new array identity on every render,
 * which turns any effect that depends on it into a render loop. Shared frozen
 * constants cost nothing and remove the hazard.
 */
const NO_ROUTES: readonly RouteWithPoints[] = [];
const NO_TRACKS: readonly Track[] = [];
const NO_WAYPOINTS: readonly Waypoint[] = [];
const NO_POI_HITS: readonly PoiHit[] = [];
/** Stable identity, so a hand-drawn route does not re-run the handles effect. */
const NO_CONTROL_POINTS: readonly { lat: number; lon: number }[] = [];
const NO_PLANNED: readonly PlannedControl[] = [];
const NO_LEGS: readonly (readonly LatLon[])[] = [];
const NO_INDICES: readonly number[] = [];
const NO_CANDIDATES: readonly Candidate[] = [];

function fitTo(bounds: Bounds | null): boolean {
  const map = getMapInstance();
  if (map === null || bounds === null) return false;
  map.fitBounds(
    L.latLngBounds(
      [bounds.minLat, bounds.minLon],
      [bounds.maxLat, bounds.maxLon],
    ),
    // A degenerate box — one waypoint — would otherwise zoom to maximum.
    { padding: [56, 56], maxZoom: 16 },
  );
  return true;
}

/** A snapped route's control point: remove it, or change what it is for. */
function controlPointMenuItems(
  routeId: string,
  index: number,
  control: readonly PlannedControl[],
): MenuItem[] {
  const point = control[index];
  if (point === undefined) return [];
  const isEnd = index === 0 || index === control.length - 1;
  const items: MenuItem[] = [
    {
      label: "Remove Point",
      disabled: control.length <= 2,
      disabledReason: "A route needs at least two points.",
      onSelect: () =>
        void actions.applyShapingEdit(routeId, { kind: "remove", index }, null),
    },
  ];
  if (point.role === "via") {
    items.push({
      label: "Make Shaping Point",
      disabled: isEnd,
      disabledReason: "The start and end of a route are always via points.",
      onSelect: () =>
        void actions.applyShapingEdit(
          routeId,
          { kind: "setRole", index, role: "shaping" },
          null,
        ),
    });
  } else {
    items.push({
      label: "Make Via Point",
      onSelect: () =>
        void actions.applyShapingEdit(
          routeId,
          { kind: "setRole", index, role: "via" },
          null,
        ),
    });
  }
  if (index === control.length - 1) {
    items.push({
      label: "Extend Route",
      separatorBefore: true,
      onSelect: () => actions.startExtendingRoute(routeId),
    });
  }
  return items;
}

export function MapView(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const offline = useUiStore((s) => s.mapOffline);
  const setOffline = useUiStore((s) => s.setMapOffline);
  const showToast = useUiStore((s) => s.showToast);

  const geometry = useGeometryStore((s) => s.geometry);
  const selected = useSelectionStore((s) => s.selected);
  const select = useSelectionStore((s) => s.select);

  const mode = useEditorStore((s) => s.mode);
  const pending = useEditorStore((s) => s.pending);
  const measurePoints = useEditorStore((s) => s.measurePoints);
  const straightBecause = useEditorStore((s) => s.straightBecause);

  const routingStatus = useRoutingStore((s) => s.status);
  const routeProvenance = useRoutingStore((s) => s.provenance);

  const snapControlPoints = useSnapRoutingStore((s) => s.controlPoints);
  const snapLegs = useSnapRoutingStore((s) => s.legs);
  const snapRouting = useSnapRoutingStore((s) => s.routing);
  const snapError = useSnapRoutingStore((s) => s.error);

  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  /** Per-point dots on the selected track. Off by default: see useTrackLayers. */
  const [showPoints, setShowPoints] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  // Frozen on first render; later re-centring goes through fitBounds.
  const [initialPosition] = useState<MapPosition>(() => settings.mapPosition);

  const persistTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onPositionChange = useCallback((position: MapPosition) => {
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void callOr(
        api().settings.set({
          key: "mapPosition",
          value: {
            lat: Number(position.lat.toFixed(6)),
            lon: Number(position.lon.toFixed(6)),
            zoom: Math.round(position.zoom),
          },
        }),
        null,
      );
    }, 600);
  }, []);

  const { handle, readout, providerUsable } = useLeafletMap({
    providerId: settings.mapProviderId,
    customTileUrl: settings.customTileUrl,
    overlayId: settings.mapOverlayId,
    customOverlayUrl: settings.customOverlayUrl,
    initial: initialPosition,
    onPositionChange,
    onTileError: setOffline,
  });

  const map = useMapInstance();

  /*
   * Layer visibility, Requirement 4.3.
   *
   * Hiding a class of object passes an empty array to its hook rather than
   * adding a `visible` flag to each one. The hooks already remove layers for
   * objects that disappear from their input, so this reuses a path that is
   * exercised on every edit instead of adding a second way to hide something.
   */
  const visibility = settings.layerVisibility;
  const visibleRoutes = visibility.routes
    ? (geometry?.routes ?? NO_ROUTES)
    : NO_ROUTES;
  const visibleTracks = visibility.tracks
    ? (geometry?.tracks ?? NO_TRACKS)
    : NO_TRACKS;
  const visibleWaypoints = visibility.waypoints
    ? (geometry?.waypoints ?? NO_WAYPOINTS)
    : NO_WAYPOINTS;

  /**
   * "Show alternatives" for one leg of a saved snapped route (Requirement 2).
   * Present but disabled, with the reason, where it cannot work — an
   * unmatched leg has no road route to offer alternatives to, and a provider
   * may not offer alternatives at all.
   */
  function legAlternativesItem(routeId: string, leg: number): MenuItem {
    const availability = legAlternativesAvailability(
      routeProvenance[routeId] ?? null,
      leg,
      routingStatus?.capabilities ?? null,
    );
    return {
      label: "Show Alternatives for This Section",
      disabled: !availability.available,
      ...(availability.available ? {} : { disabledReason: availability.reason }),
      onSelect: () => void actions.showLegAlternatives(routeId, leg),
    };
  }

  /** The route context menu, shared by the line and the shaping hit area. */
  function routeMenuItems(id: string): MenuItem[] {
    return [
      { label: "Fit Route to Screen", onSelect: () => fitRoute(id) },
      {
        label: "Reverse Route",
        separatorBefore: true,
        onSelect: () => void actions.reverseRoute(id),
      },
      {
        label: "Duplicate Route",
        onSelect: () => void actions.duplicateRoute(id),
      },
      {
        label: "Delete Route",
        danger: true,
        separatorBefore: true,
        onSelect: () => void actions.deleteRoute(id),
      },
    ];
  }

  // --- object layers
  useRouteLayers(
    map,
    visibleRoutes,
    selected?.kind === "route" ? selected.id : null,
    {
      onSelect: (id) => void select({ kind: "route", id }),
      onVertexMoved: (id, index, lat, lon) =>
        void actions.moveRouteVertex(id, index, lat, lon),
      onVertexDelete: (id, index) => void actions.deleteRouteVertex(id, index),
      onSegmentClick: (id, index, lat, lon) =>
        void actions.insertRouteVertex(id, index, lat, lon),
      onContextMenu: (id, x, y) => {
        void select({ kind: "route", id });
        setMenu({ x, y, items: routeMenuItems(id) });
      },
    },
    // Handles appear only when not drawing, so a draw click is never eaten by
    // a vertex that happens to be underneath.
    mode === "idle",
    // The points the user placed, when this route was snapped. Non-empty makes
    // those the handles instead of every road vertex — see useRouteLayers.
    selected?.kind === "route"
      ? (routeProvenance[selected.id]?.controlPoints ?? NO_CONTROL_POINTS)
      : NO_CONTROL_POINTS,
  );

  /*
   * Shaping the selected snapped route (Phase 6): drag the line, drag or
   * Alt-click its points, click to add a shaping point. Only while idle, so a
   * drawing click is never taken as a shaping gesture.
   */
  const selectedRouteId = selected?.kind === "route" ? selected.id : null;
  const selectedRoute =
    selectedRouteId === null
      ? null
      : (visibleRoutes.find((r) => r.id === selectedRouteId) ?? null);
  const selectedProvenance =
    selectedRouteId === null ? null : (routeProvenance[selectedRouteId] ?? null);
  const shapingBusy = useRoutingStore(
    (s) => selectedRouteId !== null && s.busy[`route:${selectedRouteId}`] === true,
  );
  const shaping = useMemo(
    () =>
      selectedRoute === null || selectedProvenance === null
        ? null
        : shapingStateFrom(selectedRoute.points, selectedProvenance.controlPoints),
    [selectedRoute, selectedProvenance],
  );

  useRouteShaping(map, {
    active: mode === "idle" && shaping !== null && selectedRouteId !== null,
    control: shaping?.control ?? NO_PLANNED,
    legs: shaping?.legs ?? NO_LEGS,
    colour: routeColour(selectedRoute?.colour ?? null),
    live: routingStatus?.kind === "embedded",
    busy: shapingBusy,
    reversals: shaping?.reversals ?? NO_INDICES,
    endpoints: true,
    route: actions.routeSection,
    onCommit: (edit, legs) =>
      selectedRouteId === null
        ? undefined
        : actions.applyShapingEdit(selectedRouteId, edit, legs),
    onError: (cause) => showToast(describeError(cause), "error"),
    onContextMenu: (target, x, y) => {
      if (selectedRouteId === null || shaping === null) return;
      setMenu({
        x,
        y,
        items:
          target.type === "line"
            ? [
                legAlternativesItem(selectedRouteId, target.leg),
                ...routeMenuItems(selectedRouteId).map((item, i) =>
                  i === 0 ? { ...item, separatorBefore: true } : item,
                ),
              ]
            : controlPointMenuItems(selectedRouteId, target.index, shaping.control),
      });
    },
  });

  /*
   * Routes on offer for one leg of the selected saved route (Requirement 2).
   * Dismissed when the selection moves elsewhere: a list of alternatives for
   * a route no longer on screen would be a choice about nothing visible.
   */
  const legCandidates = useShapingStore((s) => s.legCandidates);
  const legChoiceActive =
    legCandidates !== null &&
    legCandidates.routeId === selectedRouteId &&
    (mode === "idle" || mode === "extendRoute");
  useEffect(() => {
    if (legCandidates !== null && legCandidates.routeId !== selectedRouteId) {
      actions.dismissLegAlternatives();
    }
  }, [legCandidates, selectedRouteId]);
  const legSummaries = useMemo(
    () => candidateSummaries(legCandidates?.items ?? NO_CANDIDATES, settings.units),
    [legCandidates?.items, settings.units],
  );
  useCandidateLayers(map, {
    active: legChoiceActive,
    candidates: legCandidates?.items ?? NO_CANDIDATES,
    summaries: legSummaries,
    selected: legCandidates?.selected ?? 0,
    hovered: legCandidates?.hovered ?? null,
    current: legCandidates?.current ?? null,
    selectedColour: routeColour(selectedRoute?.colour ?? null),
    escapeDismisses: true,
    onSelect: (i) => useShapingStore.getState().select(i),
    onHover: (i) => useShapingStore.getState().hover(i),
    onDismiss: () => actions.dismissLegAlternatives(),
  });

  useTrackLayers(
    map,
    visibleTracks,
    selected?.kind === "track" ? selected.id : null,
    {
      onSelect: (id) => void select({ kind: "track", id }),
      onContextMenu: (id, x, y) => {
        void select({ kind: "track", id });
        setMenu({
          x,
          y,
          items: [
            { label: "Fit Track to Screen", onSelect: () => void fitTrack(id) },
            {
              label: "Reverse Track",
              separatorBefore: true,
              onSelect: () => void actions.reverseTrack(id),
            },
            {
              label: "Export Track\u2026",
              onSelect: () => actions.openExportDialog({ kind: "track", id }),
            },
            {
              // No "undo with \u2318Z" promise here: a track deletion is not
              // reversible from the stack, and the properties panel says so.
              label: "Delete Track",
              danger: true,
              separatorBefore: true,
              onSelect: () => void actions.deleteTrack(id),
            },
          ],
        });
      },
    },
    { showPoints },
  );

  // Phase 10: points of interest found along a route, while the panel is open.
  const poiHits = usePoiStore((s) => (s.scope === null ? null : (s.result?.hits ?? null)));
  const poiFocus = usePoiStore((s) => s.focusedId);
  usePoiLayer(map, visibility.pois === false ? NO_POI_HITS : (poiHits ?? NO_POI_HITS), poiFocus, (id) =>
    usePoiStore.getState().focus(id),
  );

  // Phase 11: photos from linked folders, for the trip on the map or, while
  // the Photos view is selected, for every trip (design §9.1).
  const photoTripId = useGeometryStore((s) => s.tripId);
  const allTripPhotos = usePhotoStore((s) => s.allTrips);
  const photoFilter = useLibraryStore((s) => s.photoFilter);
  const showArchivedTrips = useLibraryStore((s) => s.showArchived);
  useEffect(() => {
    void usePhotoStore.getState().loadMap(
      mapScopeFor({
        allTrips: allTripPhotos,
        tripId: photoTripId,
        filter: photoFilter,
        includeArchived: showArchivedTrips,
      }),
    );
  }, [allTripPhotos, photoTripId, photoFilter, showArchivedTrips]);
  const photoPoints = usePhotoStore((s) => s.mapPoints);
  const photoFolders = usePhotoStore((s) => s.folders);
  const photoAnchor = usePhotoStore((s) => s.selection.anchor);
  const anchorDetails = usePhotoStore((s) => s.anchorDetails);
  const anchorDirection = useMemo(() => {
    const photo = anchorDetails?.photo;
    if (photo === undefined || photo.id !== photoAnchor || photo.directionDeg === null) return null;
    return { degrees: photo.directionDeg, ref: photo.directionRef };
  }, [anchorDetails, photoAnchor]);
  usePhotoLayer(map, {
    points: photoPoints,
    folders: photoFolders,
    visible: visibility.photos !== false,
    showUnavailable: settings.photoUnavailable !== "hide",
    anchorId: photoAnchor,
    anchorDirection,
    onSelect: selectPhotosFromMap,
  });

  useWaypointLayers(
    map,
    visibleWaypoints,
    selected?.kind === "waypoint" ? selected.id : null,
    {
      onSelect: (id) => void select({ kind: "waypoint", id }),
      onMoved: (id, lat, lon) => void actions.moveWaypoint(id, lat, lon),
      onContextMenu: (id, x, y) => {
        void select({ kind: "waypoint", id });
        setMenu({
          x,
          y,
          items: [
            {
              label: "Duplicate Waypoint",
              onSelect: () => void actions.duplicateWaypoint(id),
            },
            {
              label: "Delete Waypoint",
              danger: true,
              separatorBefore: true,
              onSelect: () => void actions.deleteWaypoint(id),
            },
          ],
        });
      },
    },
  );

  // --- draw mode
  useDrawMode(map, {
    active: mode === "drawRoute",
    pending,
    onAppend: (lat, lon) =>
      useEditorStore.getState().appendPending({
        lat,
        lon,
        ele: null,
        name: null,
        symbol: null,
        notes: null,
      }),
    onFinish: () => {
      const editor = useEditorStore.getState();
      const tripId = editor.targetTripId;
      const points = editor.finish();
      if (tripId !== null && points.length > 0) {
        void actions.createRouteFromDrawnPoints(tripId, points);
      }
    },
    onCancel: () => {
      useEditorStore.getState().cancel();
      showToast("Route drawing cancelled — nothing was saved.");
    },
    onUndoLast: () => useEditorStore.getState().undoLastPending(),
  });

  // --- interactive snap routing: a control point per click, roads in between
  useSnapRouting(map, {
    active: mode === "snapRoute",
    controlPoints: snapControlPoints,
    legs: snapLegs,
    routing: snapRouting,
    onAppend: (point) => actions.appendSnapPoint(point),
    onUndoLast: () => actions.undoLastSnapPoint(),
    onUndo: () => actions.undoSnapDraft(),
    onFinish: () => void actions.finishSnapRouting(),
    onCancel: () => {
      actions.cancelSnapRouting();
      showToast("Snap routing cancelled — nothing was saved.");
    },
  });

  /*
   * The tool's points are draggable, and its line can be dragged or clicked to
   * add a shaping point, exactly as on a saved route (Requirement 5.4). The
   * edits change the draft in memory; nothing is written until Enter.
   */
  const snapRoles = useSnapRoutingStore((s) => s.roles);
  const snapCandidates = useSnapRoutingStore((s) => s.candidates);
  const draftControl = useMemo(
    () => snapControlPoints.map((point, i) => ({ point, role: snapRoles[i] ?? "via" })),
    [snapControlPoints, snapRoles],
  );
  const draftLegs = useMemo(
    () => draftLegShapes(snapControlPoints, snapLegs),
    [snapControlPoints, snapLegs],
  );
  useRouteShaping(map, {
    active: mode === "snapRoute" && snapControlPoints.length > 0,
    control: draftControl,
    legs: draftLegs,
    colour: "#f59e0b",
    live: routingStatus?.kind === "embedded",
    busy: false,
    endpoints: false,
    route: actions.routeSection,
    onCommit: (edit, legs) => actions.applySnapDraftEdit(edit, legs),
    onError: (cause) => showToast(describeError(cause), "error"),
  });

  // The routes on offer for the newest leg (Requirement 1).
  const draftSummaries = useMemo(
    () => candidateSummaries(snapCandidates?.items ?? NO_CANDIDATES, settings.units),
    [snapCandidates?.items, settings.units],
  );
  useCandidateLayers(map, {
    active: mode === "snapRoute" && snapCandidates !== null,
    candidates: snapCandidates?.items ?? NO_CANDIDATES,
    summaries: draftSummaries,
    selected: snapCandidates?.selected ?? 0,
    hovered: snapCandidates?.hovered ?? null,
    current: null,
    selectedColour: "#f59e0b",
    // Escape keeps its Phase 4 meaning here: it cancels the tool.
    escapeDismisses: false,
    onSelect: (i) => useSnapRoutingStore.getState().selectCandidate(i),
    onHover: (i) => useSnapRoutingStore.getState().hoverCandidate(i),
    onDismiss: () => useSnapRoutingStore.getState().clearCandidates(),
  });

  // --- extending a saved route from its end (Requirement 6.5)
  useExtendRoute(map, {
    active: mode === "extendRoute",
    onAppend: (point) => void actions.extendRouteTo(point),
    onFinish: () => void actions.stopExtendingRoute(),
  });

  // --- measure tool: creates nothing, so it has no undo entry
  useMeasureTool(map, {
    active: mode === "measure",
    points: measurePoints,
    onAppend: (point) => useEditorStore.getState().appendMeasure(point),
    onUndoLast: () => useEditorStore.getState().undoLastMeasure(),
    onClear: () => useEditorStore.getState().clearMeasure(),
    onExit: () => {
      useEditorStore.getState().cancel();
      showToast("Measuring finished. Nothing was saved.");
    },
  });

  // --- dashed annotation over the straight sections of a snapped route
  useSnapOverlay(
    map,
    selected?.kind === "route" ? (routeProvenance[selected.id] ?? null) : null,
  );

  /*
   * Routing availability, read once on mount.
   *
   * A local database read, so it costs nothing and cannot reach the network.
   * The toolbar needs it to decide whether the snap tool is usable, and a
   * disabled button with a reason beats one that accepts a click and then
   * explains itself.
   */
  useEffect(() => {
    void useRoutingStore.getState().loadStatus();
  }, []);

  /*
   * Snap provenance for the selected route.
   *
   * A local database read, so it is safe to do on selection — unlike a match or
   * a snap, it cannot cause a request. Without it the map could not mark the
   * unmatched legs of a route the user is already looking at.
   */
  useEffect(() => {
    if (selected?.kind !== "route") return;
    void useRoutingStore.getState().loadProvenance(selected.id);
  }, [selected]);

  /**
   * During a placement or drawing mode, object layers stop receiving pointer
   * events so every click reaches the map. Toggling a class is used rather than
   * recreating layers with `interactive: false`, because Leaflet cannot change
   * that flag after construction.
   */
  useEffect(() => {
    if (map === null) return;
    const container = map.getContainer();
    const capturing = mode !== "idle";
    container.classList.toggle("trailrt-map-capture", capturing);
    return () => {
      container.classList.remove("trailrt-map-capture");
    };
  }, [map, mode]);

  // --- waypoint placement: a single click, then back to idle
  useEffect(() => {
    if (map === null || mode !== "placeWaypoint") return;

    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = "crosshair";

    const onClick = (event: L.LeafletMouseEvent): void => {
      const tripId = useEditorStore.getState().targetTripId;
      useEditorStore.getState().cancel();
      if (tripId !== null) {
        void actions.createWaypoint(tripId, event.latlng.lat, event.latlng.lng);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") useEditorStore.getState().cancel();
    };

    map.on("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      map.off("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
      container.style.cursor = previousCursor;
    };
  }, [map, mode]);

  const fitRoute = useCallback(
    (routeId: string) => {
      const route = useGeometryStore.getState().findRoute(routeId);
      if (route === null || route.points.length === 0) {
        showToast("That route has no points to fit.", "error");
        return;
      }
      const lats = route.points.map((p) => p.lat);
      const lons = route.points.map((p) => p.lon);
      fitTo({
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLon: Math.min(...lons),
        maxLon: Math.max(...lons),
      });
    },
    [showToast],
  );

  /**
   * Fits a track.
   *
   * Asks the main process for the box rather than reading points in the
   * renderer: the trip geometry deliberately carries no track points, and
   * fetching 200,000 of them to find four numbers would be absurd. The main
   * process computes it with a SQL aggregate.
   */
  const fitTrack = useCallback(
    async (trackId: string) => {
      const geom = await callOr(
        api().tracks.geometry({ id: trackId, zoom: 0 }),
        null,
      );
      const points = geom?.segments.flatMap((segment) => segment.points) ?? [];
      if (points.length === 0) {
        showToast("That track has no points to fit.", "error");
        return;
      }
      let minLat = points[0]?.lat ?? 0;
      let maxLat = minLat;
      let minLon = points[0]?.lon ?? 0;
      let maxLon = minLon;
      // Folded rather than spread into Math.min: a simplified track is still
      // thousands of points, and `Math.min(...xs)` has an argument limit.
      for (const point of points) {
        if (point.lat < minLat) minLat = point.lat;
        if (point.lat > maxLat) maxLat = point.lat;
        if (point.lon < minLon) minLon = point.lon;
        if (point.lon > maxLon) maxLon = point.lon;
      }
      fitTo({ minLat, maxLat, minLon, maxLon });
    },
    [showToast],
  );

  // --- menu actions
  useEffect(() => {
    return api().events.onMenuAction((action) => {
      switch (action) {
        case "map:zoomIn":
          handle.zoomIn();
          break;
        case "map:zoomOut":
          handle.zoomOut();
          break;
        case "map:layers":
          setLayerMenuOpen((open) => !open);
          break;
        case "map:fitTrip": {
          const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
          if (!fitTo(bounds)) {
            showToast(
              "Nothing to fit — this trip has no routes or waypoints yet.",
            );
          }
          break;
        }
        case "map:fitRoute": {
          const ref = useSelectionStore.getState().selected;
          if (ref?.kind === "route") fitRoute(ref.id);
          else if (ref?.kind === "track") void fitTrack(ref.id);
          else showToast("Select a route or track first.");
          break;
        }
        case "map:returnToSelection": {
          const state = useSelectionStore.getState();
          if (state.route !== null) fitRoute(state.route.id);
          else if (state.track !== null) void fitTrack(state.track.id);
          else if (state.waypoint !== null) {
            getMapInstance()?.panTo([state.waypoint.lat, state.waypoint.lon]);
          } else {
            const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
            if (!fitTo(bounds)) showToast("Nothing selected to return to.");
          }
          break;
        }
        case "route:new":
          void actions.startDrawingRoute();
          break;
        case "route:newStraight":
          actions.startStraightLineRoute();
          break;
        case "waypoint:new":
          actions.startPlacingWaypoint();
          break;
        default:
          break;
      }
    });
  }, [handle, fitRoute, fitTrack, showToast]);

  const setProvider = async (id: string): Promise<void> => {
    await useSettingsStore.getState().set({ key: "mapProviderId", value: id });
    setLayerMenuOpen(false);
  };

  const setOverlay = async (id: string): Promise<void> => {
    await useSettingsStore.getState().set({ key: "mapOverlayId", value: id });
    setLayerMenuOpen(false);
  };

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]">
        Loading map…
      </div>
    );
  }

  // Derived from the subscribed value, so it re-renders with it rather than
  // reading store state during render.
  const pendingDistance = pending.length < 2 ? null : pathDistance(pending);
  const measure = measureStateFrom(measurePoints);

  return (
    <div
      className="relative flex-1 overflow-hidden"
      /*
       * Drag-and-drop import.
       *
       * `dragover` must be prevented for a drop to fire at all, which is the
       * usual cause of "my drop handler never runs". The dropped `File` objects
       * go straight to the preload bridge, which resolves them with
       * `webUtils.getPathForFile` — the renderer never sees a path.
       */
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        // Fires for children too, so only a leave of the container counts.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        void actions.importDroppedFiles(files);
      }}
    >
      {/* oxlint-disable-next-line react/refs */}
      <div ref={handle.containerRef} className="absolute inset-0" />

      {/* Phase 10: postcode and place search, answered on this machine. */}
      <SearchBox />

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 z-[700] flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-surface)]/80">
          <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">
            Drop GPX, KML, KMZ, TCX, FIT or CSV files to import
          </p>
        </div>
      )}

      {/* Mode hint bar. Also the place that states whether snapping is on. */}
      {mode !== "idle" && (
        <div className="absolute top-3 left-1/2 z-[600] -translate-x-1/2 rounded-md bg-[var(--color-text-primary)] px-3 py-2 text-[12px] text-[var(--color-surface)] shadow-lg">
          {mode === "drawRoute" && (
            <span className="pointer-events-none">
              Click to add points · <strong>Enter</strong> or double-click to
              finish · <strong>Backspace</strong> removes the last ·{" "}
              <strong>Esc</strong> cancels
              {pending.length > 0 && (
                <>
                  {" · "}
                  {pending.length} point{pending.length === 1 ? "" : "s"}
                  {pendingDistance !== null && (
                    <> · {formatDistance(pendingDistance, settings.units)}</>
                  )}
                </>
              )}
            </span>
          )}

          {/*
            Straight lines are a choice or a fallback, never silent (ADR 0018).
            The fallback names its reason and offers the fix; the button is the
            one interactive thing in a hint bar that otherwise lets clicks
            through to the map.
          */}
          {mode === "drawRoute" && straightBecause === "chosen" && (
            <span className="pointer-events-none ml-2 opacity-70">
              Straight lines — this route will not follow roads
            </span>
          )}
          {mode === "drawRoute" && straightBecause !== "chosen" && (
            <>
              <span className="pointer-events-none ml-2 opacity-70">
                {routingStatus?.reason === "no-map-data"
                  ? "Straight lines — no map region loaded yet"
                  : "Straight lines — road routing unavailable"}
              </span>
              {routingStatus?.reason === "no-map-data" && (
                <button
                  type="button"
                  onClick={() => actions.openRegionPicker()}
                  className="pointer-events-auto ml-3 rounded border border-[var(--color-surface)]/60 px-2 py-0.5 text-[11px] text-[var(--color-surface)] hover:bg-[var(--color-surface)]/15"
                >
                  Add map regions…
                </button>
              )}
            </>
          )}

          {mode === "snapRoute" && (
            <span className="pointer-events-none">
              Click to extend along the roads · drag a point or the line to
              reshape · <strong>Enter</strong> or double-click to finish ·{" "}
              <strong>Backspace</strong> removes the last · <strong>⌘Z</strong>{" "}
              undoes · <strong>Esc</strong> cancels
              {snapControlPoints.length > 0 && (
                <>
                  {" · "}
                  {snapControlPoints.length} point
                  {snapControlPoints.length === 1 ? "" : "s"}
                </>
              )}
            </span>
          )}

          {mode === "extendRoute" && (
            <span className="pointer-events-none">
              Click to extend the route along the roads · each point is one
              undo step · <strong>Enter</strong> or <strong>Esc</strong> stops
            </span>
          )}

          {mode === "placeWaypoint" && (
            <span className="pointer-events-none">
              Click the map to place a waypoint · <strong>Esc</strong> cancels
            </span>
          )}

          {mode === "measure" && (
            <span className="pointer-events-none">
              Measuring · click to add points · <strong>Backspace</strong>{" "}
              removes the last · <strong>Enter</strong> starts over ·{" "}
              <strong>Esc</strong> finishes
              <span className="ml-2 opacity-70">
                Nothing is saved and nothing is created
              </span>
            </span>
          )}
        </div>
      )}

      {/*
        The running total, kept separate from the hint bar so the numbers do not
        move as the hint text reflows.
      */}
      {mode === "snapRoute" && snapCandidates !== null && (
        <CandidateList
          summaries={draftSummaries}
          selected={snapCandidates.selected}
          hovered={snapCandidates.hovered}
          selectedColour="#f59e0b"
          busy={false}
          note="Click the next point, or press Enter, to use the selected route."
          onSelect={(i) => useSnapRoutingStore.getState().selectCandidate(i)}
          onHover={(i) => useSnapRoutingStore.getState().hoverCandidate(i)}
        />
      )}

      {legChoiceActive && legCandidates !== null && (
        <CandidateList
          summaries={legSummaries}
          selected={legCandidates.selected}
          hovered={legCandidates.hovered}
          selectedColour={routeColour(selectedRoute?.colour ?? null)}
          busy={legCandidates.checking}
          note={
            legCandidates.checking
              ? "Checking this route can be reproduced if the section is re-routed later…"
              : "The dashed line is the section as it is now."
          }
          onSelect={(i) => useShapingStore.getState().select(i)}
          onHover={(i) => useShapingStore.getState().hover(i)}
          actions={{
            onUse: () => void actions.chooseLegCandidate(),
            onCancel: () => actions.dismissLegAlternatives(),
          }}
        />
      )}

      {/*
        Live totals for the snap tool, in their own bar so the figures do not
        shift as the hint text reflows. The routing/failed states are reported
        here because a leg in flight and a leg that failed look the same on the
        map otherwise, and the user's next move depends on which it is.
      */}
      {mode === "snapRoute" && snapControlPoints.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute top-16 left-1/2 z-[600] -translate-x-1/2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] shadow-md"
        >
          <strong>
            {formatDistance(snapRoutedDistanceM(snapLegs), settings.units)}
          </strong>{" "}
          along roads
          <span className="ml-2 text-[var(--color-text-secondary)]">
            {snapLegs.filter((leg) => leg !== null).length} of{" "}
            {snapControlPoints.length - 1} leg
            {snapControlPoints.length === 2 ? "" : "s"} routed ·{" "}
            {snapPointCount(snapLegs).toLocaleString()} points
          </span>
          {snapRouting && (
            <span className="ml-2 text-[var(--color-text-muted)]">
              routing…
            </span>
          )}
          {snapError !== null && (
            <span className="ml-2 text-[var(--color-danger)]">
              last leg failed — {snapError}
            </span>
          )}
          {snapLegs.some((leg) => leg !== null && !leg.matched) && (
            <span className="ml-2 text-[var(--color-danger)]">
              {snapLegs.filter((leg) => leg !== null && !leg.matched).length} straight
            </span>
          )}
        </div>
      )}

      {mode === "measure" && measurePoints.length > 0 && (
        <div
          role="status"
          className="pointer-events-none absolute top-16 left-1/2 z-[600] -translate-x-1/2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-primary)] shadow-md"
        >
          <strong>{formatDistance(measure.totalM, settings.units)}</strong>{" "}
          total
          {measure.lastSegmentM !== null && (
            <span className="ml-2 text-[var(--color-text-secondary)]">
              last segment{" "}
              {formatDistance(measure.lastSegmentM, settings.units)}
            </span>
          )}
          <span className="ml-2 text-[var(--color-text-muted)]">
            {measurePoints.length} point{measurePoints.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div className="absolute top-3 right-3 z-[500] flex flex-col gap-1.5">
        {/* Offered only with a track selected, and only above the simplification
            threshold where the real samples are what is drawn. Showing it for a
            whole trip is how a 200,000-point map stops responding. */}
        {selected?.kind === "track" && (
          <button
            type="button"
            aria-label="Show track points"
            aria-pressed={showPoints}
            onClick={() => setShowPoints((current) => !current)}
            className={`rounded-md border px-2 py-1 text-[11px] shadow-md ${
              showPoints
                ? "border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                : "border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
            }`}
            title="Show individual recorded points when zoomed in"
          >
            Points
          </button>
        )}

        <div className="flex flex-col overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-md">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => handle.zoomIn()}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            +
          </button>
          <div className="h-px bg-[var(--color-border-subtle)]" />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => handle.zoomOut()}
            className="h-8 w-8 text-[16px] leading-none text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
          >
            −
          </button>
        </div>

        <button
          type="button"
          aria-label="Measure distance"
          aria-pressed={mode === "measure"}
          title="Measure distance on the map. Creates nothing."
          onClick={() => {
            if (mode === "measure") useEditorStore.getState().cancel();
            else actions.startMeasuring();
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-md border text-[13px] shadow-md ${
            mode === "measure"
              ? "border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-accent)]"
              : "border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]"
          }`}
        >
          {/* A ruler, drawn rather than a glyph so it reads at 13px. */}
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M2.5 12.5 12.5 2.5l5 5-10 10-5-5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M6 9l2 2m2-5 2 2m-8 6 2 2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>

        <button
          type="button"
          aria-label="Fit trip to screen"
          title="Fit trip to screen"
          onClick={() => {
            const bounds = useGeometryStore.getState().geometry?.bounds ?? null;
            if (!fitTo(bounds)) {
              showToast("Nothing to fit — no routes or waypoints yet.");
            }
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[13px] shadow-md hover:bg-[var(--color-surface-sunken)]"
        >
          ⤢
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Map layers"
            aria-expanded={layerMenuOpen}
            onClick={() => setLayerMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-md hover:bg-[var(--color-surface-sunken)]"
          >
            <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 2 2 6l8 4 8-4-8-4Zm0 7.5L2 13l8 4 8-4-8-3.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {layerMenuOpen && (
            <div className="absolute top-0 right-9 w-64 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] py-1 shadow-xl">
              <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                Base map
              </p>
              {MAP_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => void setProvider(provider.id)}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-sunken)] ${
                    provider.id === settings.mapProviderId
                      ? "font-semibold text-[var(--color-accent)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {provider.name}
                  {provider.userSupplied === true && (
                    <span className="block text-[11px] text-[var(--color-text-muted)]">
                      Needs a tile URL in Settings
                    </span>
                  )}
                </button>
              ))}

              <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
              <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                Overlay
              </p>
              <button
                type="button"
                onClick={() => void setOverlay("")}
                className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-sunken)] ${
                  settings.mapOverlayId === ""
                    ? "font-semibold text-[var(--color-accent)]"
                    : "text-[var(--color-text-primary)]"
                }`}
              >
                None
              </button>
              {MAP_OVERLAYS.map((overlay) => (
                <button
                  key={overlay.id}
                  type="button"
                  onClick={() => void setOverlay(overlay.id)}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-sunken)] ${
                    overlay.id === settings.mapOverlayId
                      ? "font-semibold text-[var(--color-accent)]"
                      : "text-[var(--color-text-primary)]"
                  }`}
                >
                  {overlay.name}
                  {overlay.userSupplied === true && (
                    <span className="block text-[11px] text-[var(--color-text-muted)]">
                      Needs an overlay URL in Settings
                    </span>
                  )}
                </button>
              ))}

              <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
              <p className="px-3 py-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                Show
              </p>
              {(
                [
                  ["routes", "Routes"],
                  ["tracks", "Tracks"],
                  ["waypoints", "Waypoints"],
                  ["pois", "Points of interest"],
                  ["photos", "Photos"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <input
                    type="checkbox"
                    checked={visibility[key] !== false}
                    onChange={(event) =>
                      void useSettingsStore.getState().set({
                        key: "layerVisibility",
                        value: { ...visibility, [key]: event.target.checked },
                      })
                    }
                  />
                  {label}
                </label>
              ))}

              <label className="flex cursor-pointer items-center gap-2 py-1.5 pr-3 pl-8 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]">
                <input
                  type="checkbox"
                  checked={settings.photoUnavailable !== "hide"}
                  disabled={visibility.photos === false}
                  onChange={(event) =>
                    void useSettingsStore.getState().set({
                      key: "photoUnavailable",
                      value: event.target.checked ? "show" : "hide",
                    })
                  }
                />
                Show unavailable photos
              </label>

              <div className="my-1 h-px bg-[var(--color-border-subtle)]" />
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)]">
                <input
                  type="checkbox"
                  checked={settings.showScaleBar}
                  onChange={(event) =>
                    void useSettingsStore
                      .getState()
                      .set({ key: "showScaleBar", value: event.target.checked })
                  }
                />
                Scale bar
              </label>

              <p className="px-3 py-1 text-[11px] leading-snug text-[var(--color-text-muted)]">
                Tiles are fetched only for what you are looking at and are never
                bulk-downloaded.
              </p>
            </div>
          )}
        </div>
      </div>

      {selected?.kind === "route" && mode === "idle" && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] shadow-md">
          {shaping !== null
            ? "Drag a point or the line to reshape along the roads · click the line to add a shaping point · Alt-click a point to remove it · right-click the line for alternatives"
            : "Drag a handle to move a point · click the line to insert · Alt-click a handle to delete"}
        </div>
      )}

      {/* Phase 11: one stack in the bottom-left corner, preview on top. */}
      <MapCornerStack>
        <MapReadout
          readout={readout}
          units={settings.units}
          showScaleBar={settings.showScaleBar}
        />
        <PanelToggles />
        <PhotoPreview />
      </MapCornerStack>

      {/*
        A selected provider with no tile template shows no tiles, and says so
        rather than silently falling back to OpenStreetMap. Requirement 1.4.
      */}
      {!providerUsable && (
        <div
          role="status"
          className="absolute top-14 left-3 z-[500] max-w-xs rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] shadow-md"
        >
          The custom tile source has no URL yet, so no map tiles are being
          drawn. Add one in Settings, or pick a different base map.
        </div>
      )}

      {offline && providerUsable && (
        <div
          role="status"
          className="absolute top-14 left-3 z-[500] max-w-xs rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] shadow-md"
        >
          Map tiles unavailable — your trips are still fully editable offline.
        </div>
      )}

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** Module-level, so the photo layer's handler keeps one identity. */
function selectPhotosFromMap(ids: readonly string[]): void {
  usePhotoStore.getState().selectFromMap(ids);
}
