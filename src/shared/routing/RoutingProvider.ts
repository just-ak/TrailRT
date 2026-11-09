/**
 * The routing provider abstraction.
 *
 * Declared now because Phase 4 implements it. Phase 1 deliberately left it out
 * on the grounds that an interface with no caller is a placeholder; that is no
 * longer the case.
 *
 * The interface speaks domain terms and never a provider's wire format. A
 * Valhalla response is translated in `main/routing/valhalla.ts` and nowhere
 * else, which is what makes a second provider an adapter rather than a
 * refactor. Trip management must never reference a concrete provider — see
 * `.kiro/steering/architecture.md`.
 *
 * Everything here is plain TypeScript: no `electron`, no `node:*`, no HTTP, so
 * both processes and the unit tests can use it freely.
 */

import type { LatLon } from '../geo/distance';

/**
 * How the provider should treat the roads.
 *
 * Deliberately a small set that maps onto what every engine offers. `auto` is
 * the default because it is the mode with the widest road coverage, and the
 * one a user planning a driving or motorcycling trip wants.
 */
export const TRANSPORT_MODES = [
  'auto',
  'motorcycle',
  'bicycle',
  'pedestrian',
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const DEFAULT_TRANSPORT_MODE: TransportMode = 'auto';

/**
 * Road classification, in descending order of significance.
 *
 * These are the values Valhalla normalises OpenStreetMap's `highway` tag into.
 * They are reused as the domain vocabulary rather than inventing a parallel
 * set, because a second provider will almost certainly also be expressing OSM
 * classifications and a translation layer would add a mapping to get wrong.
 */
export const ROAD_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service_other',
] as const;

export type RoadClass = (typeof ROAD_CLASSES)[number];

/** Surface quality, coarse enough to be comparable across providers. */
export const SURFACE_KINDS = [
  'paved_smooth',
  'paved',
  'paved_rough',
  'compacted',
  'dirt',
  'gravel',
  'path',
  'impassable',
] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export function isRoadClass(value: unknown): value is RoadClass {
  return (ROAD_CLASSES as readonly unknown[]).includes(value);
}

export function isSurfaceKind(value: unknown): value is SurfaceKind {
  return (SURFACE_KINDS as readonly unknown[]).includes(value);
}

/**
 * One leg of a snapped route: the road geometry between two control points.
 *
 * `matched: false` means the provider could not find a road path for this leg,
 * and `shape` is then the straight line between the control points. Partial
 * matching is normal, not an error — Requirement 3.6.
 */
export interface RouteLeg {
  matched: boolean;
  /** Index of the control point this leg starts at. */
  fromControlIndex: number;
  toControlIndex: number;
  /** Road geometry, or the straight line when unmatched. */
  shape: LatLon[];
  /** Metres. Null when the provider did not report it. */
  distanceM: number | null;
  /** Seconds. Null when not reported. Never used as a measurement. */
  durationS: number | null;
}

/**
 * A control point the engine could not place on a road near where it was put.
 *
 * Snapping always moves a point a little: a map click or a town-centre
 * coordinate is not on a carriageway, and shifting it a few tens of metres is
 * the operation working. Moving it **kilometres** is not. It means there is no
 * road near that point *in the loaded graph*, which in practice almost always
 * means the graph does not cover the area.
 *
 * This has to be measured rather than asked, because Valhalla does not tell
 * you. Its route response echoes back the **input** coordinates in
 * `trip.locations`, so a request whose points were dragged 10 km to the edge of
 * the data looks identical to one that matched cleanly. The only evidence is
 * the distance between the control point and the end of the geometry returned
 * for it. See ADR 0016.
 */
export interface DisplacedControlPoint {
  /** Index into the control points that were passed in. */
  index: number;
  /** How far the engine moved it, in metres. */
  displacementM: number;
}

export interface SnapResult {
  provider: string;
  mode: TransportMode;
  legs: RouteLeg[];
  /**
   * Control-point index pairs the provider could not match, so the UI can
   * explain which parts of the route are still straight lines.
   */
  unmatchedLegs: [number, number][];
  /**
   * Control points the engine dragged too far to be believed.
   *
   * Reported rather than silently accepted, and the legs touching them are
   * marked unmatched so they stay visibly straight. A straight line a user can
   * see is better than a confident road route to somewhere they did not ask
   * for.
   */
  displaced: DisplacedControlPoint[];
}

/**
 * How far a control point may be moved before the snap is not believed.
 *
 * Snapping is supposed to move points. A click on a map at zoom 12 is easily
 * 100 m from the nearest carriageway, and a town-centre coordinate is wherever
 * the gazetteer put it — Buxton's is 4 m from a road, Ashbourne's 5 m, but
 * neither number is guaranteed.
 *
 * 250 m is the working limit: comfortably past any reasonable click or
 * gazetteer offset, and far short of the kilometres that indicate missing data.
 * Measured against a Derbyshire-only graph, Macclesfield came back displaced
 * 3,111 m and Leek 10,670 m, which is the failure this exists to catch.
 */
export const MAX_SNAP_DISPLACEMENT_M = 250;

/**
 * One road segment from a map match, with the attributes we have a use for.
 *
 * Indices refer to positions in the matched shape returned alongside, so a
 * caller can attribute a stretch of geometry without a second lookup.
 *
 * Every attribute is nullable, and that is the point: OpenStreetMap coverage
 * for speed limits is partial, so "no limit in the data" is the common case and
 * must be representable. Null is never 0. See ADR 0011.
 */
export interface MatchedEdge {
  startIndex: number;
  endIndex: number;
  /** Metres. */
  lengthM: number | null;
  /** Posted legal limit in metres per second. Null when the data has none. */
  speedLimitMps: number | null;
  roadClass: RoadClass | null;
  surface: SurfaceKind | null;
  /**
   * True when the edge can be travelled in one direction only. OpenStreetMap
   * draws each carriageway of a dual carriageway as its own one-way way, so this
   * is what tells a dual carriageway from a single one for the UK default
   * limits (ADR 0018). Optional because attributes cached before it was
   * recorded do not carry it; absent and null both mean "not known".
   */
  oneway?: boolean | null;
}

export interface MatchResult {
  provider: string;
  mode: TransportMode;
  /** The geometry the edges index into. */
  shape: LatLon[];
  edges: MatchedEdge[];
  /** Points the provider could not match to any road. */
  unmatchedPointCount: number;
}

/**
 * What a control point is for. Phase 6, ADR 0017.
 *
 * A **via** point is a place the route is meant to visit: the start, the end,
 * and every point clicked in the snap routing tool. A **shaping** point only
 * bends the route onto a road — it is created by dragging the line or by
 * choosing an alternative, and the route must pass through it without turning
 * round.
 */
export const CONTROL_ROLES = ['via', 'shaping'] as const;

export type ControlRole = (typeof CONTROL_ROLES)[number];

export function isControlRole(value: unknown): value is ControlRole {
  return (CONTROL_ROLES as readonly unknown[]).includes(value);
}

/** One location in a section routed as a single request. */
export interface SectionLocation {
  point: LatLon;
  /**
   * Arrive and leave without turning round. Set for shaping points.
   *
   * The leg is still split here: a section of N locations always comes back
   * as N - 1 legs, which is what lets the caller keep leg boundaries.
   */
  passThrough: boolean;
}

/**
 * One route the engine offers between two points.
 *
 * Duration is named for what it is. It is the engine's estimate and is never a
 * measurement — ADR 0011 §8.
 */
export interface RouteCandidate {
  shape: LatLon[];
  /** Metres. Null when the provider did not report it. */
  distanceM: number | null;
  /** Seconds. An engine estimate. Null when not reported. */
  estimatedDurationS: number | null;
  /** How far the engine moved each end to reach a road, in metres. ADR 0016. */
  startDisplacementM: number;
  endDisplacementM: number;
}

/**
 * The most candidates the application ever asks for.
 *
 * Valhalla's bundled config allows two alternates, so three in all. Asking a
 * host for more than it allows is an error, not a truncation.
 */
export const MAX_ROUTE_CANDIDATES = 3;

export interface RoutingProvider {
  readonly id: string;
  readonly name: string;
  /**
   * Origins this provider connects to. The main process builds the CSP
   * `connect-src` allowlist from these, so a provider cannot reach a host it
   * has not declared — the same contract `MapProvider.tileHosts` has.
   */
  readonly origins: readonly string[];
  readonly attribution: string;

  /** Road geometry between successive control points. */
  snap(
    controlPoints: readonly LatLon[],
    mode: TransportMode,
  ): Promise<SnapResult>;

  /** Road attributes along an existing geometry. Never modifies it. */
  match(
    shape: readonly LatLon[],
    mode: TransportMode,
  ): Promise<MatchResult>;

  /**
   * Up to `count` candidates between two points, the engine's preferred route
   * first. Candidates whose ends the engine moved beyond
   * `MAX_SNAP_DISPLACEMENT_M` are left out; an empty array means there is no
   * believable road route at all.
   *
   * Optional: a provider that cannot offer alternatives omits it, and the UI
   * hides the feature rather than the provider faking one.
   */
  alternatives?(
    from: LatLon,
    to: LatLon,
    mode: TransportMode,
    count: number,
  ): Promise<RouteCandidate[]>;

  /**
   * Routes a short section as **one** request, splitting legs at every
   * location and honouring `passThrough`.
   *
   * Optional: without it, callers route leg by leg with `snap` and check the
   * result for reversals at shaping points instead.
   */
  snapSection?(
    locations: readonly SectionLocation[],
    mode: TransportMode,
  ): Promise<SnapResult>;
}

/** What a provider can do beyond the required `snap` and `match`. */
export interface RoutingCapabilities {
  alternatives: boolean;
  passThrough: boolean;
}

export const NO_ROUTING_CAPABILITIES: RoutingCapabilities = {
  alternatives: false,
  passThrough: false,
};

/**
 * Derived from which optional methods the provider has, so a capability can
 * never be claimed without the code that backs it.
 */
export function providerCapabilities(
  provider: Pick<RoutingProvider, 'alternatives' | 'snapSection'>,
): RoutingCapabilities {
  return {
    alternatives: typeof provider.alternatives === 'function',
    passThrough: typeof provider.snapSection === 'function',
  };
}

/**
 * Hard ceiling on a snapped route's point count.
 *
 * `routePointsSchema` caps renderer-supplied geometry at 10,000 because a
 * `route:setGeometry` undo entry carries the whole previous array. Snapped
 * geometry is generated in the main process and does not arrive through that
 * path, so it gets its own, higher bound — but it still needs one, or a snap
 * across a continent would produce a route that cannot be drawn or exported.
 *
 * Beyond this the snap is refused with the count, before anything is written.
 */
export const MAX_SNAPPED_POINTS = 25_000;

/**
 * Above this, a snap is not undoable.
 *
 * The inverse would be a multi-megabyte array on a stack bounded at 50 entries.
 * Declaring it non-undoable and saying so is the honest option, and follows
 * `trackService.restoreOriginal`. Matches the IPC cap deliberately: the same
 * number bounds both paths.
 */
export const MAX_UNDOABLE_POINTS = 10_000;
