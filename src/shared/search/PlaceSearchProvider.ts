import type { BoundingBox, LatLon } from '../geo/distance';

/**
 * Postcode and place search, answered on this machine.
 *
 * Defined here and implemented in `main/places/searchService.ts`, like the
 * other providers. Trip management never names a concrete source (Phase 10
 * Requirement 11.17). There is no online implementation and none is planned:
 * the owner asked for search to stay offline (ADR 0019 §6).
 */

export type PlaceKind =
  | 'city'
  | 'town'
  | 'village'
  | 'hamlet'
  | 'suburb'
  | 'locality'
  | 'neighbourhood'
  | 'isolated_dwelling';

export const PLACE_KINDS: readonly PlaceKind[] = [
  'city',
  'town',
  'village',
  'hamlet',
  'suburb',
  'locality',
  'neighbourhood',
  'isolated_dwelling',
];

export type SearchResultKind =
  /** One postcode's centre. Not an address. */
  | 'postcode'
  /** An outcode or sector: an area, approximate. */
  | 'postcode-area'
  | 'place'
  | 'street'
  /** A building with that house number on that street. */
  | 'address'
  | 'poi';

export type DatasetId = 'codepoint' | 'osm';

export interface SearchResult {
  kind: SearchResultKind;
  /** Unique within one answer, for React keys and keyboard selection. */
  key: string;
  label: string;
  /** County or settlement, added when the label alone is ambiguous. */
  detail: string | null;
  lat: number;
  lon: number;
  /** For an area: the box it covers, so the map can show it. */
  bounds: BoundingBox | null;
  approximate: boolean;
  /** A caveat to show with the result, e.g. "Only the street was matched." */
  note: string | null;
  source: DatasetId;
  /** For `place` results: its kind, which ranking uses. */
  placeKind?: PlaceKind;
  /** For `poi` results: its id in the place data. */
  poiId?: number;
}

export interface DatasetInfo {
  id: DatasetId;
  label: string;
  /** `YYYY-MM-DD`, or null when the dataset is not loaded. */
  date: string | null;
  /** Statements the dataset's licence requires wherever it is shown. */
  attribution: readonly string[];
}

export interface SearchOutcome {
  results: SearchResult[];
  /**
   * A sentence to show instead of, or above, the results: a coverage gap, a
   * postcode not in the data, or what was searched when nothing matched.
   */
  message: string | null;
  datasets: DatasetInfo[];
}

export interface SearchStatus {
  postcodes:
    | { kind: 'none' }
    | { kind: 'ready'; date: string; release: string; count: number; withoutLocation: number };
  places: { kind: 'none' } | { kind: 'missing'; regionName: string } | { kind: 'ready'; regionNames: string[]; date: string };
}

export interface PlaceSearchProvider {
  search(text: string, centre: LatLon, limit: number): SearchOutcome;
  status(): SearchStatus;
}

/**
 * The statements Code-Point Open's licence requires, for a release's
 * copyright year. The year comes from the release's own `metadata.txt`.
 */
export function codepointAttribution(year: number): readonly string[] {
  return [
    `Contains OS data © Crown copyright and database right ${year}`,
    `Contains Royal Mail data © Royal Mail copyright and database right ${year}`,
    `Contains National Statistics data © Crown copyright and database right ${year}`,
  ];
}

export const OSM_ATTRIBUTION: readonly string[] = ['© OpenStreetMap contributors, ODbL'];
