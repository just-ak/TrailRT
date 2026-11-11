import type { Timeline } from '../itinerary/timeline';
import type { TransportMode } from '../routing/RoutingProvider';
import type { Id, Timestamp } from './types';

/**
 * A trip's dated plan: an ordered list of stops with durations.
 *
 * Only the inputs live here. Arrival and departure times are derived on every
 * read by `shared/itinerary/timeline.ts` and are never stored, so a timeline
 * cannot drift from the durations it came from. See ADR 0019 §2 and the
 * Phase 10 design §2.
 *
 * Dates are `YYYY-MM-DD` and times `HH:mm`, wall clock, with the zone taken
 * from where the stop is.
 */

export type DurationKind = 'hours' | 'days';

/**
 * How the leg arriving at a stop is travelled. Phase 10 feedback.
 *
 * - `road`: planned automatically along roads.
 * - `route`: a route the user chose; never replaced automatically.
 * - `other`: not by road ("don't link"): ferry, train, flight.
 */
export type LegMode = 'road' | 'route' | 'other';

export type OtherTransport = 'ferry' | 'train' | 'flight' | 'other';

export const LEG_MODES: readonly LegMode[] = ['road', 'route', 'other'];
export const OTHER_TRANSPORTS: readonly OtherTransport[] = ['ferry', 'train', 'flight', 'other'];

/** Longest other-transport leg, in minutes: two days. */
export const MAX_OTHER_MINUTES = 48 * 60;

export type VehicleEnergy = 'fuel' | 'electric';

/** At most this many stops. Bounds the undo snapshot and keeps the calendar readable. */
export const MAX_ITINERARY_STOPS = 100;

/** Longest single stay, in days. A month on the road is a plan; a year is a typo. */
export const MAX_STAY_DAYS = 60;

/** Longest hours stop, in minutes: anything longer is a day-stay. */
export const MAX_STOP_MINUTES = 24 * 60;

export const DEFAULT_DEPART_TIME = '09:00';

export const DEFAULT_RESERVE_PCT = 20;

export interface Itinerary {
  tripId: Id;
  /** Local date the trip starts, at the first stop. */
  startDate: string;
  /** Local time the trip leaves the first stop. */
  startTime: string;
  /** Departure time for a day-stay that does not set its own. */
  defaultDepart: string;
  /** Daily driving cap, or null for none. */
  maxDriveMinutes: number | null;
  /** Vehicle range, or null when no range check should run (Requirement 9.1). */
  rangeKm: number | null;
  /** Share of the range held back as a reserve, 0–90. */
  reservePct: number;
  energy: VehicleEnergy;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ItineraryStop {
  id: Id;
  tripId: Id;
  /** Position in the itinerary, 0-based and contiguous. */
  seq: number;
  /**
   * The stop's place. A plain id with no foreign key, so a deleted waypoint
   * shows as missing and undoing the deletion heals the link. Design §2.2.
   */
  waypointId: Id;
  /** The route of the leg **arriving** at this stop. Always null on the first stop. */
  legRouteId: Id | null;
  legMode: LegMode;
  /** `other` legs only. */
  legTransport: OtherTransport | null;
  /** `other` legs only: travel time, or null when not known. */
  legMinutes: number | null;
  /** `other` legs only: a name such as "Holyhead–Dublin ferry". */
  legLabel: string | null;
  durationKind: DurationKind;
  /** Hours stops only. */
  durationMinutes: number | null;
  /** Day-stays only; at least 1. */
  durationDays: number | null;
  /** Day-stays only; null uses the itinerary's default. */
  departTime: string | null;
  /** A check: the stop should be reached by this time on its arrival date. */
  arriveBy: string | null;
  /** Hours stops only: a fixed departure on the arrival date. */
  departAt: string | null;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Everything the itinerary editor can change at trip level. */
export interface ItineraryPatch {
  startDate?: string | undefined;
  startTime?: string | undefined;
  defaultDepart?: string | undefined;
  maxDriveMinutes?: number | null | undefined;
  rangeKm?: number | null | undefined;
  reservePct?: number | undefined;
  energy?: VehicleEnergy | undefined;
}

export interface StopPatch {
  durationKind?: DurationKind | undefined;
  durationMinutes?: number | null | undefined;
  durationDays?: number | null | undefined;
  departTime?: string | null | undefined;
  arriveBy?: string | null | undefined;
  departAt?: string | null | undefined;
  notes?: string | null | undefined;
}

/** The stop's place, as the itinerary needs it. Null when the waypoint is gone. */
export interface StopPlace {
  id: Id;
  name: string;
  lat: number;
  lon: number;
  symbol: string | null;
}

/** The leg arriving at a stop. */
export interface StopLeg {
  routeId: Id;
  /** Null when the linked route no longer exists in this trip. */
  name: string | null;
  distanceM: number | null;
  mode: TransportMode;
  /**
   * False when the route's ends are not near the two stops it is meant to
   * join, for example after the stops were reordered by hand. Null when it
   * cannot be judged (a stop's place or the route is missing).
   */
  fits: boolean | null;
}

export interface StopView extends ItineraryStop {
  place: StopPlace | null;
  leg: StopLeg | null;
  /**
   * Why a by-road leg has no route, when it has none: no routing available,
   * outside the map regions, no road found. Null when planned, or not by road.
   */
  planIssue: string | null;
}

export interface LegModePatch {
  mode: LegMode;
  transport?: OtherTransport | null | undefined;
  minutes?: number | null | undefined;
  label?: string | null | undefined;
}

/** Everything the itinerary editor and calendar draw, computed in the main process. */
export interface ItineraryView {
  itinerary: Itinerary;
  stops: StopView[];
  timeline: Timeline;
}
