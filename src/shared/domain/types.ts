/**
 * Domain entity types shared by the main and renderer processes.
 *
 * This module is intentionally dependency-free. See
 * `.kiro/steering/architecture.md`.
 *
 * Conventions that hold throughout:
 * - Timestamps are UTC epoch milliseconds.
 * - Distances and elevations are metres (SI). Units are a display concern.
 * - `null` means genuinely absent. It is never a stand-in for zero.
 */

import type { TransportMode } from '../routing/RoutingProvider';

export type Id = string;

/** Epoch milliseconds, UTC. */
export type Timestamp = number;

export type TripStatus = 'active' | 'archived';

export interface Folder {
  id: Id;
  parentId: Id | null;
  name: string;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Trip {
  id: Id;
  folderId: Id | null;
  name: string;
  description: string | null;
  notes: string | null;
  status: TripStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A trip plus the child counts the UI needs for labels and delete warnings. */
export interface TripWithCounts extends Trip {
  routeCount: number;
  trackCount: number;
  waypointCount: number;
}

/**
 * What the user currently has selected. Routes, tracks and waypoints are not
 * selectable until Phases 2 and 3, but the shape is fixed now so the properties
 * panel and map do not need reworking when they arrive.
 */
export type ObjectKind = 'folder' | 'trip' | 'route' | 'track' | 'waypoint';

export interface ObjectRef {
  kind: ObjectKind;
  id: Id;
}

/**
 * Library tree nodes.
 *
 * `folder` and `trip` are real containers. The `view` kind is a saved
 * cross-trip query rather than a storage location — see ADR 0004. A view node
 * reports whether the feature behind it exists yet, so the tree can say "later
 * phase" instead of rendering a misleading empty branch.
 */
export type TreeNodeKind =
  | 'root'
  | 'folder'
  | 'trip'
  | 'view'
  | 'route'
  | 'track'
  | 'waypoint';

export type ViewId =
  | 'trips'
  | 'routes'
  | 'tracks'
  | 'waypoints'
  | 'imported'
  | 'recent';

export interface TreeNode {
  /**
   * Unique **position** in the tree, used for React keys and expansion state.
   *
   * Deliberately distinct from `ref`: the same route appears both under its
   * trip and in the cross-trip Routes view, so object identity cannot double as
   * node identity without producing duplicate keys.
   */
  id: string;
  /** The object this row represents, for selection. Absent for views/root. */
  ref?: ObjectRef;
  kind: TreeNodeKind;
  name: string;
  /** Present for `view` nodes only. */
  viewId?: ViewId;
  /** False when the backing feature arrives in a later phase. */
  available?: boolean;
  /** Present for `trip` nodes. */
  status?: TripStatus;
  /** Secondary text, such as a route's distance or an owning trip's name. */
  detail?: string;
  children: TreeNode[];
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type UnitSystem = 'metric' | 'imperial';
export type TripSortKey = 'name' | 'updatedAt' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapPosition {
  lat: number;
  lon: number;
  zoom: number;
}

export interface PanelLayout {
  libraryWidth: number;
  propertiesWidth: number;
  libraryVisible: boolean;
  propertiesVisible: boolean;
}

/**
 * Persisted application settings. Every field has a default in
 * `shared/domain/defaults.ts`, so a fresh database needs no seeding.
 */
export interface AppSettings {
  theme: ThemePreference;
  units: UnitSystem;
  mapProviderId: string;
  /** Overlay drawn above the base layer, chosen independently of it. '' = none. */
  mapOverlayId: string;
  /** Leaflet template for the `custom` provider. '' until the user sets one. */
  customTileUrl: string;
  customOverlayUrl: string;
  /**
   * Routing service base URL. **Empty by default**, which is what keeps the
   * application free of any cloud dependency: with no endpoint there is no
   * provider, and route drawing behaves exactly as it did in Phase 2.
   */
  routingEndpoint: string;
  /**
   * Whether the user has accepted that snapping transmits their planned route
   * to the configured service. Every outbound routing call is gated on this.
   */
  routingConsentAccepted: boolean;
  transportMode: TransportMode;
  /**
   * Offer the routes on offer for each new leg while drawing. On by default;
   * off makes the snap routing tool behave as it did in Phase 4. Phase 6.
   */
  routeAlternatives: boolean;
  /**
   * Count a UK road with no posted limit at its statutory default, labelled
   * assumed. On by default; off is ADR 0011's posted-only reporting. ADR 0018.
   */
  ukDefaultSpeedLimits: boolean;
  showScaleBar: boolean;
  layerVisibility: LayerVisibility;
  backupIntervalHours: number;
  backupRetention: number;
  /** Used for route duration estimates. Nothing is estimated without it. */
  planningSpeedKmh: number;
  tripSortKey: TripSortKey;
  tripSortDirection: SortDirection;
  panelLayout: PanelLayout;
  windowGeometry: WindowGeometry | null;
  mapPosition: MapPosition;
  expandedNodeIds: string[];
  showArchivedTrips: boolean;
}

export type SettingsKey = keyof AppSettings;

/** Per-object-kind map visibility. Requirement 4.2. */
export interface LayerVisibility {
  routes: boolean;
  tracks: boolean;
  waypoints: boolean;
}

// ------------------------------------------------- Phase 2: routes, waypoints

/** Source of an object's geometry. Imports are never modified implicitly. */
export type GeometrySource = 'user' | 'import';

export interface RoutePoint {
  lat: number;
  lon: number;
  /** Metres, or null when the source carried no elevation. */
  ele: number | null;
  name: string | null;
  symbol: string | null;
  notes: string | null;
}

/**
 * Derived statistics. Every field is nullable because "unknown" and "zero" are
 * different facts: a route with no elevation data has `elevGainM === null`,
 * while a genuinely flat route with elevation data has `0`.
 */
export interface RouteStats {
  pointCount: number;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  elevMinM: number | null;
  elevMaxM: number | null;
}

export interface Route extends RouteStats {
  id: Id;
  tripId: Id;
  name: string;
  colour: string | null;
  source: GeometrySource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RouteWithPoints extends Route {
  points: RoutePoint[];
}

export interface WaypointGroup {
  id: Id;
  tripId: Id;
  name: string;
  createdAt: Timestamp;
}

export interface Waypoint {
  id: Id;
  tripId: Id;
  groupId: Id | null;
  name: string;
  lat: number;
  lon: number;
  eleM: number | null;
  description: string | null;
  symbol: string | null;
  notes: string | null;
  source: GeometrySource;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Bounding box in the form the map needs to fit a view. */
export interface Bounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * Everything the map needs to render one trip.
 *
 * Routes carry their points; **tracks do not**. A recorded track can hold
 * hundreds of thousands of points, so only its metadata travels here and the
 * map fetches geometry per track at the zoom it is drawing — see
 * `tracks:geometry` and ADR 0003.
 */
export interface TripGeometry {
  tripId: Id;
  routes: RouteWithPoints[];
  /** Metadata only. Geometry is fetched separately, per zoom. */
  tracks: Track[];
  waypoints: Waypoint[];
  bounds: Bounds | null;
}

/** State of the undo history, mirrored into the Edit menu. */
export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  /** Describes the action, for the menu label. Null when unavailable. */
  undoLabel: string | null;
  redoLabel: string | null;
}

// ------------------------------------------------------- Phase 3: tracks

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Metres, or null when the recording carried none. */
  ele: number | null;
  /** Epoch milliseconds, or null when untimed. */
  time: number | null;
}

export interface TrackSegment {
  points: TrackPoint[];
}

export interface TrackStats {
  pointCount: number;
  segmentCount: number;
  distanceM: number | null;
  elevGainM: number | null;
  elevLossM: number | null;
  elevMinM: number | null;
  elevMaxM: number | null;
  /** Null when the recording has no timestamps — not zero. */
  startedAt: Timestamp | null;
  endedAt: Timestamp | null;
  durationS: number | null;
}

export interface Track extends TrackStats {
  id: Id;
  tripId: Id;
  name: string;
  colour: string | null;
  width: number | null;
  source: GeometrySource;
  /** True when the original imported bytes are retained and recoverable. */
  hasOriginal: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TrackWithPoints extends Track {
  segments: TrackSegment[];
}

/** What the map needs to draw a track: either the cache or real points. */
export interface TrackGeometry {
  trackId: Id;
  /** True when these came from the simplified render cache. */
  simplified: boolean;
  segments: { points: { lat: number; lon: number }[] }[];
}

// -------------------------------------- Phase 5: object and point management

/**
 * A window of a track's points, for the point table.
 *
 * Paged because a recording can hold 200,000 points and a table shows forty.
 * `total` sizes the scrollbar without holding the data; `segmentBreaks` is the
 * **whole** track's structure, not the window's, because a renderer cannot
 * infer a break from a window that does not contain one.
 *
 * These are always exact points. A simplified payload would mean the row the
 * user edits is not the sample they are looking at.
 */
export interface TrackPointsPage {
  trackId: Id;
  /** Points in the whole track, not in this window. */
  total: number;
  /** Flat index of the first returned point. */
  offset: number;
  /**
   * Flat index of the last point of every segment but the last. Empty for a
   * single-segment track. See `shared/geo/segments.ts`.
   */
  segmentBreaks: number[];
  points: TrackPoint[];
}

/** An object a batch operation can act on. Trips and folders are excluded. */
export type BatchKind = 'route' | 'track' | 'waypoint';

export interface BatchMember {
  kind: BatchKind;
  id: Id;
}

export type BatchOperation = 'delete' | 'move';

/**
 * What a batch will do, answered **before** it is applied.
 *
 * Requirement 2.5: partial undoability is stated up front rather than
 * discovered afterwards. The same calculation backs both the dry run and the
 * real thing, so the warning cannot disagree with the outcome.
 */
export interface BatchAssessment {
  operation: BatchOperation;
  counts: Record<BatchKind, number>;
  total: number;
  /** Whether one ⌘Z will reverse the whole batch. */
  undoable: boolean;
  /** Members that cannot be reversed, so the UI can name them. */
  notUndoable: BatchMember[];
  /** Points that would be irreversibly removed. Null when nothing is. */
  irreversiblePoints: number | null;
  /** Why it is not undoable, in words, or null when it is. */
  reason: string | null;
  /** Members referring to objects that no longer exist. */
  missing: BatchMember[];
}

/** What a batch actually did. */
export interface BatchOutcome extends BatchAssessment {
  applied: number;
}
