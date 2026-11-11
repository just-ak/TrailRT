import type Database from 'better-sqlite3';
import type { LatLon } from '@shared/geo/distance';
import { categoryById, isPoiCategoryId } from '@shared/poi/categories';
import {
  codepointAttribution,
  OSM_ATTRIBUTION,
  type DatasetInfo,
  type PlaceKind,
  type PlaceSearchProvider,
  type SearchOutcome,
  type SearchResult,
  type SearchStatus,
} from '@shared/search/PlaceSearchProvider';
import { classifyPostcode } from '@shared/search/postcode';
import { disambiguate, rankResults } from '@shared/search/rank';
import { foldText, queryTokens, splitHouseNumber } from '@shared/search/text';
import type { EmbeddedPaths } from '../routing/embedded';
import { postcodesDb, readPostcodeMeta } from './postcodes';
import { placesDb, placesState, readMeta, TOKEN_KIND } from './store';

/**
 * Postcode and place search, answered from data on this machine.
 * Phase 10 Requirement 11, design §7.4.
 *
 * Nothing here reaches the network. Postcodes come from Code-Point Open in
 * `postcodes.sqlite`; places, streets, addresses and named POIs from the
 * region build's `places.sqlite`.
 */

/** Token rows read per typed word. A one-letter prefix is cut short; the next letter narrows it. */
const MAX_TOKEN_ROWS = 5000;
/** Candidates kept after intersecting the words, before ranking. */
const MAX_CANDIDATES = 300;

interface Candidate {
  kind: number;
  ref: number;
}

function placeResult(row: { id: number; kind: string; name: string; county: string | null; lat: number; lon: number }): SearchResult & { context: string | null } {
  return {
    kind: 'place',
    key: `place:${row.id}`,
    label: row.name,
    detail: null,
    lat: row.lat,
    lon: row.lon,
    bounds: null,
    approximate: false,
    note: null,
    source: 'osm',
    placeKind: row.kind as PlaceKind,
    context: row.county,
  };
}

function streetResult(
  row: { id: number; name: string; settlement: string | null; county: string | null; lat: number; lon: number },
  note: string | null = null,
): SearchResult & { context: string | null } {
  return {
    kind: 'street',
    key: `street:${row.id}`,
    label: row.name,
    // A street means nothing without its town, so the settlement is always shown.
    detail: row.settlement,
    lat: row.lat,
    lon: row.lon,
    bounds: null,
    approximate: false,
    note,
    source: 'osm',
    context: row.county,
  };
}

function poiResult(row: {
  id: number;
  category: string;
  name: string | null;
  county: string | null;
  lat: number;
  lon: number;
}): SearchResult & { context: string | null } {
  const label = isPoiCategoryId(row.category) ? categoryById(row.category).label : row.category;
  return {
    kind: 'poi',
    key: `poi:${row.id}`,
    label: row.name ?? label,
    detail: label,
    lat: row.lat,
    lon: row.lon,
    bounds: null,
    approximate: false,
    note: null,
    source: 'osm',
    poiId: row.id,
    context: row.county,
  };
}

function strip(result: SearchResult & { context?: string | null }): SearchResult {
  const { context: _context, ...rest } = result;
  return rest;
}

/** Refs matching every typed word, as word prefixes or abbreviation equivalents. */
function matchTokens(db: Database.Database, text: string, kinds: readonly number[]): Candidate[] {
  const tokens = queryTokens(text);
  if (tokens.length === 0) return [];
  const prefix = db.prepare(
    `SELECT kind, ref FROM token WHERE token >= ? AND token < ? AND kind IN (${kinds.join(',')}) LIMIT ${MAX_TOKEN_ROWS}`,
  );
  const exact = db.prepare(`SELECT kind, ref FROM token WHERE token = ? AND kind IN (${kinds.join(',')})`);

  let survivors: Map<string, Candidate> | null = null;
  for (const token of tokens) {
    const found = new Map<string, Candidate>();
    for (const row of prefix.all(token.prefix, `${token.prefix}￿`) as Candidate[]) {
      found.set(`${row.kind}:${row.ref}`, row);
    }
    for (const word of token.exact) {
      for (const row of exact.all(word) as Candidate[]) found.set(`${row.kind}:${row.ref}`, row);
    }
    if (survivors === null) {
      survivors = found;
    } else {
      const previous: Map<string, Candidate> = survivors;
      survivors = new Map([...found].filter(([key]) => previous.has(key)));
    }
    if (survivors.size === 0) return [];
  }
  return [...(survivors ?? new Map<string, Candidate>()).values()].slice(0, MAX_CANDIDATES);
}

function searchPlaces(db: Database.Database, text: string): (SearchResult & { context: string | null })[] {
  const out: (SearchResult & { context: string | null })[] = [];
  const getPlace = db.prepare('SELECT id, kind, name, county, lat, lon FROM place WHERE id = ?');
  const getStreet = db.prepare('SELECT id, name, settlement, county, lat, lon FROM street WHERE id = ?');
  const getPoi = db.prepare('SELECT id, category, name, county, lat, lon FROM poi WHERE id = ?');

  // "12 Spring Gardens": the building if it is mapped, else the street, said so.
  const house = splitHouseNumber(text);
  if (house !== null) {
    const byStreet = db.prepare('SELECT lat, lon FROM address WHERE street_key = ? AND number = ? LIMIT 1');
    for (const candidate of matchTokens(db, house.rest, [TOKEN_KIND.street])) {
      const street = getStreet.get(candidate.ref) as Parameters<typeof streetResult>[0] | undefined;
      if (street === undefined) continue;
      const building = byStreet.get(foldText(street.name), house.number) as { lat: number; lon: number } | undefined;
      if (building !== undefined) {
        out.push({
          ...streetResult(street),
          kind: 'address',
          key: `address:${street.id}:${house.number}`,
          label: `${house.number} ${street.name}`,
          lat: building.lat,
          lon: building.lon,
        });
      } else {
        // Never interpolated along the street (Requirement 11.12).
        out.push(streetResult(street, `Only the street was matched. Number ${house.number} is not mapped.`));
      }
    }
    if (out.length > 0) return out;
  }

  for (const candidate of matchTokens(db, text, [TOKEN_KIND.place, TOKEN_KIND.street, TOKEN_KIND.poi])) {
    if (candidate.kind === TOKEN_KIND.place) {
      const row = getPlace.get(candidate.ref) as Parameters<typeof placeResult>[0] | undefined;
      if (row !== undefined) out.push(placeResult(row));
    } else if (candidate.kind === TOKEN_KIND.street) {
      const row = getStreet.get(candidate.ref) as Parameters<typeof streetResult>[0] | undefined;
      if (row !== undefined) out.push(streetResult(row));
    } else {
      const row = getPoi.get(candidate.ref) as Parameters<typeof poiResult>[0] | undefined;
      if (row !== undefined) out.push(poiResult(row));
    }
  }
  return out;
}

export interface SearchServiceOptions {
  paths: EmbeddedPaths;
}

export function createSearchService({ paths }: SearchServiceOptions): PlaceSearchProvider {
  const datasets = (): DatasetInfo[] => {
    const pcdb = postcodesDb(paths.gazetteerDir);
    const pcmeta = pcdb === null ? null : readPostcodeMeta(pcdb);
    const pdb = placesDb(paths);
    const pmeta = pdb === null ? null : readMeta(pdb);
    return [
      {
        id: 'codepoint',
        label: 'Code-Point Open (Ordnance Survey)',
        date: pcmeta?.date ?? null,
        attribution: codepointAttribution(Number((pcmeta?.date ?? '2026').slice(0, 4))),
      },
      {
        id: 'osm',
        label: 'OpenStreetMap',
        date: pmeta?.dataDate ?? null,
        attribution: OSM_ATTRIBUTION,
      },
    ];
  };

  function searchPostcode(query: ReturnType<typeof classifyPostcode>): { results: SearchResult[]; message: string | null } {
    if (query.kind === 'none') return { results: [], message: null };
    if (query.kind === 'uncovered') {
      return {
        results: [],
        message: `Postcodes in ${query.region} are not included. The postcode data covers Great Britain only.`,
      };
    }
    const db = postcodesDb(paths.gazetteerDir);
    const meta = db === null ? null : readPostcodeMeta(db);
    if (db === null || meta === null) {
      return { results: [], message: 'Postcode search needs the postcode data. Download it in Settings → Postcodes.' };
    }

    if (query.kind === 'full') {
      const row = db.prepare('SELECT lat, lon FROM postcode WHERE pc = ?').get(query.postcode) as
        | { lat: number | null; lon: number | null }
        | undefined;
      if (row === undefined) {
        return { results: [], message: `${query.postcode} was not found in the postcode data dated ${meta.date}.` };
      }
      if (row.lat === null || row.lon === null) {
        return { results: [], message: `${query.postcode} exists, but the postcode data dated ${meta.date} gives no location for it.` };
      }
      return {
        results: [
          {
            kind: 'postcode',
            key: `postcode:${query.postcode}`,
            label: query.postcode,
            detail: null,
            lat: row.lat,
            lon: row.lon,
            bounds: null,
            approximate: false,
            // One postcode can cover several streets (Requirement 11.5).
            note: 'The centre of the postcode, not an address.',
            source: 'codepoint',
          },
        ],
        message: null,
      };
    }

    // An area: the outcode with its space, so `DE4 ` never matches `DE45 …`.
    const prefix = query.kind === 'outcode' ? `${query.outward} ` : query.sector;
    const label = query.kind === 'outcode' ? query.outward : query.sector;
    const stats = db
      .prepare(
        `SELECT count(*) AS n, avg(lat) AS lat, avg(lon) AS lon, min(lat) AS minLat, max(lat) AS maxLat,
                min(lon) AS minLon, max(lon) AS maxLon
           FROM postcode WHERE pc >= ? AND pc < ? AND lat IS NOT NULL`,
      )
      .get(prefix, `${prefix}￿`) as {
      n: number;
      lat: number | null;
      lon: number | null;
      minLat: number;
      maxLat: number;
      minLon: number;
      maxLon: number;
    };
    if (stats.n === 0 || stats.lat === null || stats.lon === null) {
      return { results: [], message: `${label} was not found in the postcode data dated ${meta.date}.` };
    }
    return {
      results: [
        {
          kind: 'postcode-area',
          key: `postcode-area:${label}`,
          label,
          detail: null,
          lat: stats.lat,
          lon: stats.lon,
          bounds: { minLat: stats.minLat, maxLat: stats.maxLat, minLon: stats.minLon, maxLon: stats.maxLon },
          approximate: true,
          note: `Approximate: the middle of ${stats.n.toLocaleString('en-GB')} postcodes.`,
          source: 'codepoint',
        },
      ],
      message: null,
    };
  }

  return {
    search(text: string, centre: LatLon, limit: number): SearchOutcome {
      const query = text.trim();
      if (query.length === 0) return { results: [], message: null, datasets: datasets() };

      const postcode = classifyPostcode(query);
      const fromPostcodes = searchPostcode(postcode);
      if (postcode.kind === 'full' || postcode.kind === 'uncovered') {
        return { results: fromPostcodes.results, message: fromPostcodes.message, datasets: datasets() };
      }

      const db = placesDb(paths);
      let found: (SearchResult & { context: string | null })[] = [];
      let message = fromPostcodes.message;
      if (db === null) {
        const state = placesState(paths);
        if (fromPostcodes.results.length === 0 && message === null) {
          message =
            state.kind === 'missing'
              ? `Place search needs place data, which was not built with ${state.regionName}. Rebuild your map regions in Settings.`
              : 'Place search needs map regions. Download them in Settings → Map regions.';
        }
      } else {
        found = searchPlaces(db, query);
        if (found.length === 0 && fromPostcodes.results.length === 0 && message === null) {
          const names = readMeta(db)?.regionNames ?? [];
          // "Not in your regions", not "does not exist" (Requirement 11.11).
          message =
            names.length > 0
              ? `No match in your map regions: ${names.join(', ')}.`
              : `No match in your map region, ${readMeta(db)?.regionName ?? 'the imported file'}.`;
        }
      }

      const contexts = new Map(found.map((result) => [result.key, result.context]));
      const ranked = rankResults([...fromPostcodes.results, ...found.map(strip)], centre, query);
      const results = disambiguate(ranked, (result) => contexts.get(result.key) ?? null).slice(0, limit);
      return { results, message, datasets: datasets() };
    },

    status(): SearchStatus {
      const pcdb = postcodesDb(paths.gazetteerDir);
      const pcmeta = pcdb === null ? null : readPostcodeMeta(pcdb);
      const state = placesState(paths);
      return {
        postcodes:
          pcmeta === null
            ? { kind: 'none' }
            : {
                kind: 'ready',
                date: pcmeta.date,
                release: pcmeta.release,
                count: pcmeta.count,
                withoutLocation: pcmeta.withoutLocation,
              },
        places:
          state.kind === 'ready'
            ? { kind: 'ready', regionNames: state.regionNames.length > 0 ? state.regionNames : [state.regionName], date: state.dataDate }
            : state.kind === 'missing'
              ? { kind: 'missing', regionName: state.regionName }
              : { kind: 'none' },
      };
    },
  };
}
