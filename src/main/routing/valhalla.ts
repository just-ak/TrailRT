import { haversineDistance, type LatLon } from '@shared/geo/distance';
import {
  isRoadClass,
  isSurfaceKind,
  MAX_SNAP_DISPLACEMENT_M,
  type MatchedEdge,
  MAX_ROUTE_CANDIDATES,
  type RouteCandidate,
  type RouteLeg,
  type RoutingProvider,
  type SectionLocation,
  type SnapResult,
  type TransportMode,
} from '@shared/routing/RoutingProvider';
import { ServiceError } from '../services/errors';
import { postJson } from './client';
import { decodeValhallaShape, encodePolyline, VALHALLA_PRECISION } from './polyline';

/**
 * The Valhalla adapter — the only file in the project that knows Valhalla's
 * wire format.
 *
 * Chosen first because it is MIT licensed and, per ADR 0011, the only
 * open-source engine that returns posted speed limits and road class from map
 * matching. A second provider is a new file like this one, not a refactor.
 *
 * ## Two unit conversions that must happen here
 *
 * Valhalla reports `length` in kilometres and `speed_limit` in km/h by default.
 * The request pins `units: 'kilometers'` explicitly rather than relying on that
 * default, and both are converted to SI at this boundary, because everything
 * inside the application stores metres and metres per second. A missed
 * conversion here would be a 3.6× error that looks plausible on a speed and
 * catastrophic on a distance.
 *
 * ## Verification status
 *
 * Tested three ways. `valhalla.test.ts` drives a loopback `node:http` server
 * for the error paths — timeout, 500, malformed JSON — that a real service will
 * not produce on demand. `polyline.test.ts` reproduces the documented
 * polyline vector. And `valhalla.live.test.ts` runs the real thing against a
 * real instance, confirming that `length` arrives in kilometres, `speed_limit`
 * in km/h, the shape is polyline6, and the road classes and surfaces survive
 * the guards:
 *
 *   npm run verify:valhalla
 *
 * The live test is opt-in so the default suite needs no network. It is what
 * retired the earlier caveat in this comment, which said the adapter had never
 * met a real deployment.
 *
 * One thing that caveat would not have caught, and which cost real time: the
 * public instance's API host is `valhalla1.openstreetmap.de`. Drop the `1` and
 * you reach the demo *website*, whose nginx answers POST with 405 — a correct
 * client looks broken and the error points nowhere useful.
 */

const KM_TO_M = 1000;
const KMH_TO_MPS = 1000 / 3600;

/**
 * Attributes requested from `trace_attributes`.
 *
 * An explicit include list, not the default. The documentation notes that with
 * no filter every attribute is returned, and for a long trace that payload is
 * very large and almost entirely unused. Asking for five fields instead of
 * sixty is the difference between a usable call and a wasteful one.
 */
const MATCH_ATTRIBUTES = [
  'edge.length',
  'edge.speed_limit',
  'edge.road_class',
  'edge.surface',
  'edge.traversability',
  'edge.begin_shape_index',
  'edge.end_shape_index',
  'shape',
  'matched.type',
] as const;

// --------------------------------------------------------------- wire types

interface ValhallaTrip {
  legs?: { shape?: string; summary?: { length?: number; time?: number } }[];
}

interface ValhallaRouteResponse {
  trip?: ValhallaTrip;
  /**
   * Further routes between the same two locations, best first. Present only
   * when the request asked for `alternates` and the engine found any; never
   * for a request with more than two locations.
   */
  alternates?: { trip?: ValhallaTrip }[];
}

interface ValhallaEdge {
  length?: number;
  speed_limit?: number;
  road_class?: string;
  surface?: string;
  /** `forward`, `backward` or `both`, relative to the edge's own direction. */
  traversability?: string;
  begin_shape_index?: number;
  end_shape_index?: number;
}

interface ValhallaTraceAttributesResponse {
  edges?: ValhallaEdge[];
  shape?: string;
  matched_points?: { type?: string }[];
}

// ----------------------------------------------------------------- helpers

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Translates a mode to a Valhalla costing model.
 *
 * `motorcycle` is a real Valhalla costing option, which is why the mode set in
 * `shared/` includes it. A provider that lacks it would map it to `auto` in its
 * own adapter rather than the domain losing the distinction.
 */
function costingFor(mode: TransportMode): string {
  switch (mode) {
    case 'motorcycle':
      return 'motorcycle';
    case 'bicycle':
      return 'bicycle';
    case 'pedestrian':
      return 'pedestrian';
    case 'auto':
      return 'auto';
  }
}

/** Straight line between two control points, for an unmatched leg. */
function straightLeg(
  from: LatLon,
  to: LatLon,
  fromIndex: number,
): RouteLeg {
  return {
    matched: false,
    fromControlIndex: fromIndex,
    toControlIndex: fromIndex + 1,
    shape: [from, to],
    distanceM: haversineDistance(from, to),
    durationS: null,
  };
}

export interface ValhallaOptions {
  endpoint: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export const VALHALLA_PROVIDER_ID = 'valhalla';
export const EMBEDDED_PROVIDER_ID = 'valhalla-embedded';

/**
 * How a request reaches Valhalla.
 *
 * `path` is the HTTP-style action name — `/route`, `/trace_attributes` — which
 * the embedded transport maps onto the matching method on `tyr::actor_t`. That
 * the two share a vocabulary is not a coincidence: the actor is what Valhalla's
 * own HTTP service dispatches to, and it takes the same JSON.
 */
export type ValhallaTransport = <T>(path: string, body: unknown) => Promise<T>;

export interface ValhallaProviderMeta {
  id: string;
  name: string;
  /**
   * Origins the CSP must allow. **Empty for the embedded engine**, which is the
   * whole point: there is no host to allowlist because no request is made.
   */
  origins: readonly string[];
  attribution: string;
}

/**
 * Builds a provider around a transport.
 *
 * Every line of request construction and response translation below is shared
 * between the embedded engine and a remote HTTP instance. Only the transport
 * differs, which is what makes "the same adapter, verified once" true rather
 * than aspirational — and it is why the embedded path inherits the km→m and
 * km/h→m/s conversions, the null-not-zero handling and the unmatched-leg
 * behaviour without a second implementation to keep in step.
 */
export function createValhallaProviderWith(
  call: ValhallaTransport,
  meta: ValhallaProviderMeta,
): RoutingProvider {
  /*
   * Named so `snapSection` can fall back to `snap` on the same instance. A
   * method reaching for `this` would break the moment a caller passed one of
   * these methods around on its own.
   */
  const provider: RoutingProvider = {
    id: meta.id,
    name: meta.name,
    origins: meta.origins,
    attribution: meta.attribution,

    async snap(controlPoints, mode) {
      if (controlPoints.length < 2) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'Snapping needs at least two points.',
        );
      }

      /*
       * One `/route` call per leg rather than one call for the whole sequence.
       *
       * A single multi-location call is cheaper, but it fails as a unit: if one
       * leg has no road path the whole request errors and the user gets
       * nothing. Per-leg means a single unroutable stretch stays a straight
       * line and the rest of the route still snaps — which is what Requirement
       * 3.6 asks for, and what a user actually wants when one of their points
       * landed in a field.
       */
      const legs: RouteLeg[] = [];
      const unmatchedLegs: [number, number][] = [];
      /** Largest displacement seen for each control point, by index. */
      const displacement = new Map<number, number>();

      const noteDisplacement = (index: number, metres: number): void => {
        const seen = displacement.get(index);
        if (seen === undefined || metres > seen) displacement.set(index, metres);
      };

      for (let i = 0; i < controlPoints.length - 1; i += 1) {
        const from = controlPoints[i];
        const to = controlPoints[i + 1];
        if (from === undefined || to === undefined) continue;

        try {
          // eslint-disable-next-line no-await-in-loop
          const response = await call<ValhallaRouteResponse>('/route', {
            locations: [
              { lat: from.lat, lon: from.lon },
              { lat: to.lat, lon: to.lon },
            ],
            costing: costingFor(mode),
            directions_options: { units: 'kilometers' },
          });

          const leg = response.trip?.legs?.[0];
          const shape =
            leg?.shape === undefined ? [] : decodeValhallaShape(leg.shape);

          if (shape.length < 2) {
            legs.push(straightLeg(from, to, i));
            unmatchedLegs.push([i, i + 1]);
            continue;
          }

          /*
           * How far the engine had to move each end to reach a road.
           *
           * Measured, because Valhalla will not say. Its response echoes the
           * *input* coordinates back in `trip.locations`, so a leg whose
           * endpoints were dragged kilometres to the edge of the loaded graph
           * is indistinguishable from a clean match unless the geometry is
           * compared with what was asked for.
           *
           * A leg with an end this far out is marked **unmatched** and kept as
           * a straight line. That is the same treatment as "no road path
           * between these points", and for the same reason: the honest output
           * is a line the user can see is not a road, not a confident route to
           * somewhere they did not choose.
           */
          const startOff = haversineDistance(from, shape[0] as LatLon);
          const endOff = haversineDistance(to, shape.at(-1) as LatLon);
          noteDisplacement(i, startOff);
          noteDisplacement(i + 1, endOff);

          if (
            startOff > MAX_SNAP_DISPLACEMENT_M ||
            endOff > MAX_SNAP_DISPLACEMENT_M
          ) {
            legs.push(straightLeg(from, to, i));
            unmatchedLegs.push([i, i + 1]);
            continue;
          }

          legs.push({
            matched: true,
            fromControlIndex: i,
            toControlIndex: i + 1,
            shape,
            // km → m. The request pinned kilometres, so this is the only
            // interpretation.
            distanceM:
              finite(leg?.summary?.length) === null
                ? null
                : (finite(leg?.summary?.length) as number) * KM_TO_M,
            durationS: finite(leg?.summary?.time),
          });
        } catch (cause) {
          /*
           * Only a *routing* failure becomes a straight line.
           *
           * The distinction matters more than it looks. "No road path between
           * these two points" is a local fact about one stretch, and falling
           * back to a straight line is what Requirement 3.6 asks for. "The
           * service is unreachable" is not a fact about the road at all, and
           * swallowing it would report every leg of a twenty-point route as
           * unmatched — twenty straight lines and no hint that the server was
           * down. The user would go looking for a gap in the map data.
           *
           * So transport-level failures propagate: unreachable, timed out,
           * rate-limited, cancelled. Each of those will affect the next leg
           * identically, which is the test for whether continuing makes sense.
           */
          if (cause instanceof ServiceError && cause.code !== 'PROVIDER_ERROR') {
            throw cause;
          }
          legs.push(straightLeg(from, to, i));
          unmatchedLegs.push([i, i + 1]);
        }
      }

      const displaced = [...displacement.entries()]
        .filter(([, metres]) => metres > MAX_SNAP_DISPLACEMENT_M)
        .map(([index, displacementM]) => ({ index, displacementM }))
        .toSorted((a, b) => a.index - b.index);

      return { provider: meta.id, mode, legs, unmatchedLegs, displaced };
    },

    async match(shape, mode) {
      if (shape.length < 2) {
        throw new ServiceError(
          'INVALID_REQUEST',
          'Matching needs at least two points.',
        );
      }

      const response = await call<ValhallaTraceAttributesResponse>(
        '/trace_attributes',
        {
          // Encoded rather than an array of objects: the documentation notes
          // shape input can be large, and a 200,000-point track as JSON objects
          // is tens of megabytes of request body.
          encoded_polyline: encodePolyline(shape, VALHALLA_PRECISION),
          costing: costingFor(mode),
          // `map_snap` rather than the default `walk_or_snap`: our input is a
          // drawn route or a GPS track, never a shape that came from a prior
          // Valhalla route, so edge walking would always fail first and the
          // fallback would just cost a round of wasted work.
          shape_match: 'map_snap',
          directions_options: { units: 'kilometers' },
          filters: { attributes: [...MATCH_ATTRIBUTES], action: 'include' },
        },
      );

      const matchedShape =
        response.shape === undefined ? [] : decodeValhallaShape(response.shape);

      const edges: MatchedEdge[] = [];
      for (const edge of response.edges ?? []) {
        const startIndex = finite(edge.begin_shape_index);
        const endIndex = finite(edge.end_shape_index);
        if (startIndex === null || endIndex === null) continue;

        const lengthKm = finite(edge.length);
        const speedKmh = finite(edge.speed_limit);

        edges.push({
          startIndex,
          endIndex,
          lengthM: lengthKm === null ? null : lengthKm * KM_TO_M,
          /*
           * Absent stays null, never 0.
           *
           * Valhalla's documentation is explicit that the posted limit is
           * returned only when available, and OSM coverage is partial. A zero
           * here would read as "this road has a 0 km/h limit", and would land
           * in the lowest speed band instead of the Unknown one — turning a
           * data gap into a false measurement. ADR 0011.
           */
          speedLimitMps: speedKmh === null ? null : speedKmh * KMH_TO_MPS,
          roadClass: isRoadClass(edge.road_class) ? edge.road_class : null,
          surface: isSurfaceKind(edge.surface) ? edge.surface : null,
          oneway:
            edge.traversability === 'both'
              ? false
              : edge.traversability === 'forward' ||
                  edge.traversability === 'backward'
                ? true
                : null,
        });
      }

      const unmatchedPointCount = (response.matched_points ?? []).filter(
        (point) => point.type === 'unmatched',
      ).length;

      return {
        provider: meta.id,
        mode,
        shape: matchedShape,
        edges,
        unmatchedPointCount,
      };
    },

    async alternatives(from, to, mode, count) {
      const wanted = Math.max(0, Math.min(count, MAX_ROUTE_CANDIDATES) - 1);

      const request = (alternates: number) =>
        call<ValhallaRouteResponse>('/route', {
          locations: [
            { lat: from.lat, lon: from.lon },
            { lat: to.lat, lon: to.lon },
          ],
          costing: costingFor(mode),
          directions_options: { units: 'kilometers' },
          ...(alternates > 0 ? { alternates } : {}),
        });

      let response: ValhallaRouteResponse;
      try {
        response = await request(wanted);
      } catch (cause) {
        if (!(cause instanceof ServiceError) || cause.code !== 'PROVIDER_ERROR') {
          throw cause;
        }
        if (wanted === 0) return [];
        /*
         * Retried once without alternates. A host can configure
         * `max_alternates` lower than the bundled engine's 2 — or to zero —
         * and then refuses the request outright rather than returning fewer.
         * The plain route is still worth having; a second refusal means there
         * is no road route at all, which is an empty list, not an error.
         */
        try {
          response = await request(0);
        } catch (retryCause) {
          if (retryCause instanceof ServiceError && retryCause.code === 'PROVIDER_ERROR') {
            return [];
          }
          throw retryCause;
        }
      }

      const trips = [response.trip, ...(response.alternates ?? []).map((a) => a.trip)];
      const candidates: RouteCandidate[] = [];
      for (const trip of trips) {
        const candidate = toCandidate(trip, from, to);
        // A candidate the engine had to drag an end of beyond the limit is
        // left out, not shown: it is a route to somewhere the user did not
        // choose (ADR 0016, Requirement 1.9).
        if (candidate !== null) candidates.push(candidate);
      }
      return candidates;
    },

    async snapSection(locations, mode) {
      if (locations.length < 2) {
        throw new ServiceError('INVALID_REQUEST', 'A section needs at least two points.');
      }
      const points = locations.map((l) => ({ lat: l.point.lat, lon: l.point.lon }));
      if (locations.length === 2 || !locations.some((l) => l.passThrough)) {
        // Nothing to pass through: the per-leg path is the same answer, and it
        // degrades one leg at a time rather than failing as a unit.
        return provider.snap(points, mode);
      }

      let response: ValhallaRouteResponse;
      try {
        response = await call<ValhallaRouteResponse>('/route', {
          locations: locations.map(toSectionLocation),
          costing: costingFor(mode),
          directions_options: { units: 'kilometers' },
        });
      } catch (cause) {
        /*
         * A multi-location request fails as a unit: one point in a field and
         * the engine routes none of it. Falling back to per-leg routing keeps
         * every leg that can be routed, at the cost of pass-through — the
         * caller checks for reversals afterwards. Transport failures still
         * propagate, for the reason `snap` gives.
         */
        if (cause instanceof ServiceError && cause.code === 'PROVIDER_ERROR') {
          return provider.snap(points, mode);
        }
        throw cause;
      }

      const section = toSectionResult(response, points, mode, meta.id);
      return section ?? provider.snap(points, mode);
    },
  };

  return provider;
}

/**
 * One section location on the wire.
 *
 * `break_through` keeps the leg split at the location — so the caller can keep
 * leg boundaries — while forbidding a U-turn there. Plain `break` is the
 * default and allows one, which is right for a via point the route visits.
 */
function toSectionLocation(location: SectionLocation): Record<string, unknown> {
  return {
    lat: location.point.lat,
    lon: location.point.lon,
    type: location.passThrough ? 'break_through' : 'break',
  };
}

/** Translates one trip into a candidate, or null when it is not believable. */
function toCandidate(
  trip: ValhallaTrip | undefined,
  from: LatLon,
  to: LatLon,
): RouteCandidate | null {
  const leg = trip?.legs?.[0];
  const shape = leg?.shape === undefined ? [] : decodeValhallaShape(leg.shape);
  if (shape.length < 2) return null;

  const startDisplacementM = haversineDistance(from, shape[0] as LatLon);
  const endDisplacementM = haversineDistance(to, shape.at(-1) as LatLon);
  if (
    startDisplacementM > MAX_SNAP_DISPLACEMENT_M ||
    endDisplacementM > MAX_SNAP_DISPLACEMENT_M
  ) {
    return null;
  }

  const length = finite(leg?.summary?.length);
  return {
    shape,
    distanceM: length === null ? null : length * KM_TO_M,
    estimatedDurationS: finite(leg?.summary?.time),
    startDisplacementM,
    endDisplacementM,
  };
}

/**
 * Translates a section response into a snap result, or null when it cannot
 * be trusted as one — wrong leg count, an empty leg, or an end the engine
 * moved too far. The caller then falls back to per-leg routing, which knows
 * how to keep a bad leg straight without discarding the good ones.
 */
function toSectionResult(
  response: ValhallaRouteResponse,
  points: readonly LatLon[],
  mode: TransportMode,
  providerId: string,
): SnapResult | null {
  const wireLegs = response.trip?.legs ?? [];
  if (wireLegs.length !== points.length - 1) return null;

  const legs: RouteLeg[] = [];
  for (const [i, wire] of wireLegs.entries()) {
    const from = points[i] as LatLon;
    const to = points[i + 1] as LatLon;
    const shape = wire.shape === undefined ? [] : decodeValhallaShape(wire.shape);
    if (shape.length < 2) return null;
    if (
      haversineDistance(from, shape[0] as LatLon) > MAX_SNAP_DISPLACEMENT_M ||
      haversineDistance(to, shape.at(-1) as LatLon) > MAX_SNAP_DISPLACEMENT_M
    ) {
      return null;
    }
    const length = finite(wire.summary?.length);
    legs.push({
      matched: true,
      fromControlIndex: i,
      toControlIndex: i + 1,
      shape,
      distanceM: length === null ? null : length * KM_TO_M,
      durationS: finite(wire.summary?.time),
    });
  }

  return { provider: providerId, mode, legs, unmatchedLegs: [], displaced: [] };
}


/**
 * A provider talking to a remote Valhalla over HTTP.
 *
 * Still supported after ADR 0013 embedded the engine: a user who already runs
 * a shared instance can point at it, and this is the path
 * `npm run verify:valhalla:remote` exercises against the public demo.
 */
export function createValhallaProvider(
  options: ValhallaOptions,
): RoutingProvider {
  const call: ValhallaTransport = <T>(path: string, body: unknown) =>
    postJson<T>({
      endpoint: options.endpoint,
      path,
      body,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

  return createValhallaProviderWith(call, {
    id: VALHALLA_PROVIDER_ID,
    name: 'Valhalla',
    origins: [options.endpoint],
    attribution: 'Routing by Valhalla · Road data © OpenStreetMap contributors',
  });
}
