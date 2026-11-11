import type { BoundingBox, LatLon } from '../geo/distance';
import type { RangeCheckResult } from '../itinerary/rangeCheck';
import type { ZonedWallClock } from '../time/zoned';
import type { PoiAttributes } from './attributes';
import type { PoiCategoryId } from './categories';
import type { OpenState } from './openingHours';

/**
 * Where points of interest come from.
 *
 * Defined here and implemented in `main/places/`, like `MapProvider` and
 * `RoutingProvider`. Trip management never names a concrete source
 * (`.kiro/steering/architecture.md`), which is what lets a later source — a
 * second country's data, or an online one if the owner ever asks — drop in.
 */

export interface Poi {
  /** Stable within one snapshot. */
  id: number;
  /** `node/123`, `way/456` or `relation/789`: where it came from in OSM. */
  osm: string;
  category: PoiCategoryId;
  /** The OSM tag value that matched, e.g. `hotel`. */
  kind: string;
  /** Null when OSM has no name; the UI then shows the category label. */
  name: string | null;
  lat: number;
  lon: number;
  attributes: PoiAttributes;
}

/** What place data is loaded, and how old it is. */
export type PlaceDataState =
  /** No routing regions at all. */
  | { kind: 'none' }
  /** A graph exists but was built before place data was captured. */
  | {
      kind: 'missing';
      regionName: string;
      /** False for an imported `.osm.pbf`, which can only be re-imported. */
      canRebuild: boolean;
    }
  | {
      kind: 'ready';
      regionName: string;
      regionNames: string[];
      /** `YYYY-MM-DD` of the OSM data. */
      dataDate: string;
      /** True when the date is the download date, not OSM's own timestamp. */
      dateIsDownload: boolean;
      poiCount: number;
    };

export interface PoiProvider {
  state(): PlaceDataState;
  /** POIs inside a box, in the given categories. */
  inBox(box: BoundingBox, categories: readonly PoiCategoryId[]): Poi[];
  get(id: number): Poi | null;
  /** Whether the data covers a point, so a search there means something. */
  covers(point: LatLon): boolean;
}

// ------------------------------------------------- along a route or plan

export type AlongSection =
  | { kind: 'all' }
  | { kind: 'range'; fromM: number; toM: number }
  | { kind: 'near'; point: LatLon; radiusM: number }
  /** Itinerary only: the legs that depart on a local date. */
  | { kind: 'day'; date: string };

export interface PoiHit {
  poi: Poi;
  alongM: number;
  offM: number;
  /** Itinerary only: the stop this stretch leads to. */
  stopIndex: number | null;
  /** Itinerary only: when the traveller is expected to pass, if known. */
  passTime: number | null;
  passLocal: ZonedWallClock | null;
  /** At the pass time; unknown when there is no time or the hours do not parse. */
  open: OpenState;
}

export interface AlongResult {
  hits: PoiHit[];
  totalM: number;
  widthM: number;
  /** Stretches outside the place data, which were not searched. */
  uncovered: { fromM: number; toM: number }[];
  /** Stretches the itinerary has no planned route for. */
  unplanned: number;
  /** Legs by ferry, train or flight, which are not searched. */
  otherTransport: number;
  dataDate: string | null;
  /** Itinerary only, and only when a range is set. */
  range: RangeCheckResult | null;
}

export interface DetourEstimate {
  /** Extra distance by road, metres. Never negative. */
  extraM: number;
  fromM: number;
  toM: number;
  /** Whether both legs to and from the POI found roads. */
  matched: boolean;
}

