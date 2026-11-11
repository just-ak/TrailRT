import type { ProfileSpan } from '../geo/profile';
import type { Twistiness } from '../geo/twistiness';
import type {
  ControlRole,
  DisplacedControlPoint,
  RoadClass,
  RoutingCapabilities,
  SurfaceKind,
  TransportMode,
} from './RoutingProvider';

/**
 * Response contracts for the routing and road-attribute channels.
 *
 * These live in `shared/` because both processes compile against them: the
 * services build them, the preload bridge marshals them and the renderer reads
 * them. Keeping them next to `RoutingProvider` rather than in a service file is
 * what stops the renderer needing a type from `main/`, which it must never
 * import.
 *
 * Everything here is plain data. No closures, no class instances — it all has
 * to survive structured cloning across the context bridge.
 */

/** Which geometry an attribute or profile request refers to. */
export type AttributeOwnerType = 'route' | 'track';

export type RoutingUnavailableReason =
  | 'not-configured'
  | 'invalid-endpoint'
  | 'consent-required'
  /** The built-in engine is present but has no map region loaded yet. */
  | 'no-map-data'
  /** The built-in engine is missing from the build entirely. */
  | 'no-engine';

/**
 * Which engine is answering.
 *
 * Worth surfacing rather than hiding behind "routing works", because the two
 * differ in ways a user can feel: the embedded engine is offline, instant and
 * private, while a remote one is none of those and needed consent.
 */
export type RoutingKind = 'embedded' | 'remote' | 'none';

/** Whether routing is usable, and if not, which of three things to do about it. */
export interface RoutingStatus {
  available: boolean;
  /** Embedded, remote, or nothing usable. */
  kind: RoutingKind;
  /** Valhalla's version, when the embedded engine could be loaded. */
  engineVersion: string | null;
  providerId: string | null;
  /** Scheme + host + port the app would contact. Null when unresolvable. */
  origin: string | null;
  reason: 'available' | RoutingUnavailableReason;
  message: string | null;
  attribution: string | null;
  mode: TransportMode;
  /**
   * Whether **this endpoint** has answered a test route in this session.
   *
   * Replaced a field that claimed the *adapter* had never met a live Valhalla.
   * That was true when it was written and is no longer: the adapter is now
   * verified against a real instance by `valhalla.live.test.ts`. The useful
   * remaining question is about the user's own host, which no amount of
   * adapter testing can answer — hence the Test connection button, which is
   * what sets this.
   */
  endpointTested: boolean;
  /**
   * What the configured provider can do beyond snapping. Derived from the
   * provider's methods, so the UI never offers a feature nothing backs.
   */
  capabilities: RoutingCapabilities;
}

/** What the consent prompt says, built around the host actually configured. */
export interface ConsentNotice {
  origin: string;
  transmits: string[];
  withholds: string[];
}

/** What a snap did, so the UI can describe it rather than guess. */
export interface SnapOutcome {
  routeId: string;
  provider: string;
  mode: TransportMode;
  pointCount: number;
  /** Control-point index pairs that stayed straight lines. */
  unmatchedLegs: [number, number][];
  /** False when the previous geometry was too large to carry as an inverse. */
  undoable: boolean;
  /**
   * Control points the engine could not place on a road near where they were.
   *
   * Almost always means the loaded map region does not reach them. Surfaced
   * because the alternative is a route that confidently goes somewhere the
   * user did not choose — see ADR 0016.
   */
  displaced: DisplacedControlPoint[];
}

/**
 * A control point as the renderer sees it.
 *
 * `shapeIndex` is the index in the route's points where this point's leg
 * starts, which is what lets one leg be replaced without touching the others.
 * Null for a route snapped before Phase 6, whose boundaries are unknown — see
 * ADR 0017.
 */
export interface ProvenanceControlPoint {
  lat: number;
  lon: number;
  role: ControlRole;
  shapeIndex: number | null;
}

/** Snap provenance for the properties panel. Null provider means hand-drawn. */
export interface RouteProvenance {
  routingProvider: string | null;
  transportMode: TransportMode | null;
  snappedAt: number | null;
  controlPointCount: number;
  unmatchedLegs: [number, number][];
  /**
   * The points the user placed, as opposed to the road shape.
   *
   * Included so the map can draw the unmatched legs. An unmatched leg *is* the
   * straight line between two control points, so the pair in `unmatchedLegs`
   * plus these coordinates is everything needed — the alternative would be
   * hunting for the straight sections inside the snapped point array, which is
   * guesswork.
   *
   * Empty for a hand-drawn route, which is how a pre-Phase-4 route keeps
   * behaving exactly as it did.
   */
  controlPoints: ProvenanceControlPoint[];
  /**
   * Control points the last snap could not place on a road.
   *
   * Persisted with the route rather than shown once and forgotten: a route
   * snapped against a region that did not cover it is wrong until it is
   * re-snapped, and the panel should keep saying so.
   */
  displaced: DisplacedControlPoint[];
}

/**
 * One routed leg, as previewed by the interactive snap routing tool.
 *
 * A trimmed `RouteLeg`: the control indices are implied by position in the
 * array, and `durationS` is dropped because nothing displays it and sending a
 * provider's travel-time estimate to the renderer invites someone treating it
 * as a measurement.
 *
 * These cross back to the main process on finish, so that what is saved is
 * exactly the geometry the user watched appear. Re-routing on save would be a
 * second set of provider calls that could legitimately return something else —
 * traffic-free vs not, a graph updated in between — and the route would quietly
 * differ from the one they accepted.
 */
export interface PreviewedLeg {
  /** False when the provider found no road path; `shape` is then the straight line. */
  matched: boolean;
  shape: { lat: number; lon: number }[];
  /** Metres, as reported by the provider. Null when it did not say. */
  distanceM: number | null;
  /**
   * How far the engine moved the leg's far end to reach a road, in metres.
   *
   * Null when it was not measured. The interactive tool shows this per click,
   * so a point outside the loaded region is obvious at the moment it is placed
   * rather than after the whole route is drawn and saved.
   */
  displacementM: number | null;
}

/**
 * Exactly the fields of a `PreviewedLeg`, and nothing else.
 *
 * The IPC schema for a leg is strict, so an object carrying any extra field —
 * a `Candidate`'s `estimatedDurationS`, say — is refused at the boundary as
 * "not valid". TypeScript cannot catch that, because a `Candidate` is
 * structurally a `PreviewedLeg`. Anything that stores or sends a leg goes
 * through this.
 */
export function asPreviewedLeg(leg: PreviewedLeg): PreviewedLeg {
  return {
    matched: leg.matched,
    shape: leg.shape,
    distanceM: leg.distanceM,
    displacementM: leg.displacementM,
  };
}

/**
 * One of the routes offered for a leg, as the renderer sees it. Phase 6.
 *
 * A `PreviewedLeg` plus the engine's duration estimate. `PreviewedLeg` dropped
 * duration because nothing displayed it; the candidate list does, labelled as
 * an estimate, and the field name says so too so nobody downstream mistakes it
 * for a measurement. ADR 0011 §8.
 */
export interface Candidate extends PreviewedLeg {
  estimatedDurationS: number | null;
}

/**
 * The result of testing a routing endpoint.
 *
 * `pointCount` is the interesting field: a service can answer 200 and still
 * not be a routing service, so the test is only passed if real road geometry
 * came back. "It responded" is not the question.
 */
export interface ConnectionTest {
  ok: boolean;
  origin: string | null;
  /** Round trip in milliseconds, including any politeness delay. */
  elapsedMs: number | null;
  /** Road vertices returned for the sample leg. Null on failure. */
  pointCount: number | null;
  message: string;
}

export interface AttributeStatus {
  provider: string;
  fetchedAt: number;
  /** True when the geometry has changed since these were fetched. */
  stale: boolean;
  edgeCount: number;
  unmatchedPointCount: number;
}

export interface ProfileSample {
  /**
   * Index of the source point this sample was taken from, in the same
   * numbering the point table uses (a track's segments flattened in order).
   * Lets the chart and the table select the same point.
   */
  index: number;
  /** Cumulative metres from the start. */
  distanceM: number;
  lat: number;
  lon: number;
  /** Metres. Null where the source carried none — never 0. */
  eleM: number | null;
  /**
   * Metres per second over the segment **ending** at this sample, from the
   * recording's own timestamps. Null at the first sample and wherever the
   * recording is untimed.
   */
  recordedSpeedMps: number | null;
}

export interface ElevationSummary {
  minM: number | null;
  maxM: number | null;
  gainM: number | null;
  lossM: number | null;
}

/**
 * The profile panel's data.
 *
 * Every band is either present or absent **with a reason**. Requirement 5.6
 * forbids drawing a band with no data, and the reason is what lets the UI say
 * why — a recording with no barometer is a different situation from roads
 * never having been matched, and only the second is something the user can act
 * on. An empty array would make those indistinguishable.
 */
export interface Profile {
  ownerType: AttributeOwnerType;
  ownerId: string;
  totalDistanceM: number;
  /** Points in the source geometry, before thinning. */
  sourcePointCount: number;
  /** True when samples were thinned for display. The UI must say so. */
  simplified: boolean;
  samples: ProfileSample[];

  elevation: ElevationSummary | null;
  /**
   * Where the heights came from. `terrain` is a model (ADR 0018), and must be
   * labelled as one wherever it is shown — never presented as measured.
   */
  elevationSource: 'recorded' | 'terrain' | null;
  elevationAbsentBecause: string | null;
  /** Set when terrain heights would be available after a download. */
  terrainMissing: { tileCount: number; approxBytes: number } | null;

  /** How much the line bends. Null when it cannot be scored; see the reason. */
  twistiness: Twistiness | null;
  twistinessUnknownBecause: string | null;

  /** Posted limits in metres per second, as distance spans. */
  postedSpeedSpans: ProfileSpan<number>[] | null;
  /**
   * UK default limits assumed where none is posted (ADR 0018). Its own series,
   * never merged into `postedSpeedSpans`, so the chart can draw it differently.
   * Null when nothing was assumed or the setting is off.
   */
  assumedSpeedSpans: ProfileSpan<number>[] | null;
  /** Null when either posted or assumed spans exist. */
  postedSpeedAbsentBecause: string | null;

  roadClassSpans: ProfileSpan<RoadClass>[] | null;
  roadClassAbsentBecause: string | null;

  surfaceSpans: ProfileSpan<SurfaceKind>[] | null;
  surfaceAbsentBecause: string | null;

  recordedSpeedAbsentBecause: string | null;

  /** Provenance for the road bands. Null when nothing has been matched. */
  attributes: AttributeStatus | null;
}

/** Progress while a routing graph is being built. */
export interface RegionProgressEvent {
  stage: string;
  percent: number | null;
}

/**
 * The map region currently loaded into the built-in engine.
 *
 * Null when none has been imported, which is the first-run state and not an
 * error. One region at a time: Valhalla cannot incrementally merge a second
 * one, and a half-merged graph routes wrongly at the seam in ways that are very
 * hard to spot.
 */
export interface LoadedRegion {
  /** Display names, joined: "Derbyshire, Cheshire and Staffordshire". */
  regionName: string;
  /**
   * Every region the graph was built from. Empty for a graph imported from a
   * file, or built before regions were recorded. ADR 0018.
   */
  regionIds: string[];
  tileCount: number;
  builtAt: number;
  graphBytes: number;
  /** Set when the graph built but its terrain tiles did not all download. */
  terrainWarning?: string | null;
  /**
   * Set when the graph built but its place data (POIs, place names) did not.
   * Phase 10: routing still works; search and POIs offer a rebuild.
   */
  placesWarning?: string | null;
}

/**
 * A downloadable region drawn on the picker's UK map.
 *
 * The rings are rounded for drawing and never used to decide coverage, so the
 * rounding cannot reach routing.
 */
export interface RegionMapEntry {
  id: string;
  name: string;
  /** Outer rings as [lon, lat]. */
  rings: [number, number][][];
  /** In the graph that is loaded now. */
  loaded: boolean;
  /** Something the user should know before choosing it, or null. */
  note: string | null;
}

export interface RegionSize {
  id: string;
  sizeBytes: number | null;
}

export interface TerrainDownloadResult {
  downloaded: number;
  /** Squares with no land, so no tile to fetch. */
  sea: number;
  failed: number;
}

/**
 * A downloadable extract that could serve the current map view.
 *
 * Ranked most specific first. `coversViewport` is reported rather than used to
 * filter, because the useful choice for a view spanning a border is between
 * "the country the centre is in" and "the bundle covering both" — and only the
 * user knows which they meant.
 */
export interface RegionCandidate {
  id: string;
  name: string;
  parent: string | null;
  /** True when the whole visible area falls inside this region. */
  coversViewport: boolean;
  /** Download size, or null when the server would not say. */
  sizeBytes: number | null;
  /**
   * True when the extract is past what TrailRT will build.
   *
   * Reported here so the picker can refuse it before a multi-gigabyte
   * download starts, rather than at the end of one. The regions that cover a
   * zoomed-out viewport are routinely enormous — the Alps bundle is 2.3 GB and
   * Germany/Austria/Switzerland is 6.3 GB — so this is the common case, not an
   * edge case.
   */
  tooLarge: boolean;
}

/** Progress while regions are downloaded, merged and built. */
export interface RegionJobProgress {
  phase: 'downloading' | 'merging' | 'building' | 'terrain';
  /** Download stage only. */
  receivedBytes: number | null;
  totalBytes: number | null;
  /** Build stage only — the coarse stage name. */
  stage: string | null;
  /** Which region is downloading, 1-based, out of how many. Download stage only. */
  regionIndex?: number | null;
  regionCount?: number | null;
  regionName?: string | null;
  /** Terrain stage only. */
  tilesDone?: number | null;
  tileCount?: number | null;
}

/**
 * What a shaping edit did. Phase 6.
 *
 * The same honesty fields as `SnapOutcome`: whether the edit can be undone, and
 * which legs and points the engine could not route properly.
 */
export interface EditOutcome {
  routeId: string;
  pointCount: number;
  /** False when the replaced stretch was too large to carry as an inverse. */
  undoable: boolean;
  unmatchedLegs: [number, number][];
  displaced: DisplacedControlPoint[];
}
