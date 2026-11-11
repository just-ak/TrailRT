import { haversineDistance, type LatLon } from '../geo/distance';
import type { PlaceKind, SearchResult, SearchResultKind } from './PlaceSearchProvider';
import { foldText } from './text';

/**
 * Ordering search results, and telling apart results with the same name.
 *
 * Phase 10 Requirement 11.13: an exact postcode first, then places by kind
 * (city, town, village, hamlet) and by distance from the map centre. Names
 * that occur more than once show their county, so the many Newtowns can be
 * told apart.
 */

const KIND_ORDER: Readonly<Record<SearchResultKind, number>> = {
  postcode: 0,
  // A building matched by number is more specific than any place.
  address: 1,
  'postcode-area': 2,
  place: 3,
  street: 4,
  poi: 5,
};

const PLACE_ORDER: Readonly<Record<PlaceKind, number>> = {
  city: 0,
  town: 1,
  village: 2,
  hamlet: 3,
  suburb: 4,
  locality: 5,
  neighbourhood: 6,
  isolated_dwelling: 7,
};

/** Equal for every place within this of the centre; beyond it, nearer wins. */
const SAME_DISTANCE_M = 1;

export function rankResults(
  results: readonly SearchResult[],
  centre: LatLon,
  query: string,
): SearchResult[] {
  const folded = foldText(query);
  const scored = results.map((result) => ({
    result,
    kind: KIND_ORDER[result.kind],
    place: result.placeKind === undefined ? 99 : PLACE_ORDER[result.placeKind],
    // A name that is exactly what was typed beats one that merely starts with it.
    exact: foldText(result.label) === folded ? 0 : 1,
    distance: haversineDistance(centre, result),
  }));

  scored.sort(
    (a, b) =>
      a.kind - b.kind ||
      a.exact - b.exact ||
      a.place - b.place ||
      (Math.abs(a.distance - b.distance) < SAME_DISTANCE_M ? 0 : a.distance - b.distance) ||
      a.result.label.localeCompare(b.result.label),
  );

  return scored.map((entry) => entry.result);
}

/**
 * Adds `detail` to results whose label is shared with another result of the
 * same kind, using the county (or settlement) each one was given.
 *
 * Results whose label is unique keep `detail` empty, so the list stays quiet
 * when there is nothing to disambiguate.
 */
export function disambiguate(
  results: readonly SearchResult[],
  contextOf: (result: SearchResult) => string | null,
): SearchResult[] {
  const counts = new Map<string, number>();
  for (const result of results) {
    const id = `${result.kind}|${foldText(result.label)}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return results.map((result) => {
    const shared = (counts.get(`${result.kind}|${foldText(result.label)}`) ?? 0) > 1;
    if (!shared || result.detail !== null) return result;
    return { ...result, detail: contextOf(result) };
  });
}
