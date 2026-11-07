import {
  boundingBoxArea,
  boundingBoxCentre,
  ringsBoundingBox,
  ringsContainBox,
  pointInRings,
  type BoundingBox,
  type Ring,
} from '@shared/geo/polygon';
import type { RegionCandidate } from '@shared/routing/results';
import { ServiceError } from '../services/errors';

/**
 * Matching a map viewport to a downloadable OpenStreetMap extract.
 *
 * Geofabrik publishes a machine-readable index of its regions —
 * `index-v1.json`, 554 regions nested up to three deep, each with polygon
 * boundaries and a direct `.pbf` URL. That makes "which extract covers what I
 * am looking at" answerable without the user hunting through a download page.
 *
 * ## Why Geofabrik and not an arbitrary bounding box
 *
 * Overpass can return data for any box, which sounds better. It is not:
 * a highway-only Overpass extract loses the **relations** that encode turn
 * restrictions, so a graph built from it would route the wrong way down
 * no-entry streets with nothing to indicate why. Geofabrik extracts are
 * complete OSM data and are published for bulk download, which Overpass
 * explicitly is not.
 *
 * The cost is granularity: the smallest unit is a published region, so asking
 * for a city may mean downloading its country. That is stated in the UI rather
 * than hidden.
 */

const INDEX_URL = 'https://download.geofabrik.de/index-v1.json';

/** Identifies the app to Geofabrik, as their and OSM's policies ask. */
const USER_AGENT = 'TrailRT/0.1.0 (+https://github.com/trailrt/trailrt)';

/**
 * The index changes when regions are added, which is rare. A week avoids
 * re-downloading 3.6 MB on every glance at the region picker while still
 * picking up changes without the user having to do anything.
 */
export const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Above this, the download and the tile build stop being reasonable. */
export const MAX_REGION_BYTES = 2 * 1024 * 1024 * 1024;

/** Above this, warn that it will take a while rather than silently grinding. */
export const LARGE_REGION_BYTES = 400 * 1024 * 1024;

interface GeofabrikFeature {
  properties?: {
    id?: string;
    name?: string;
    parent?: string;
    urls?: Record<string, string>;
  };
  geometry?: {
    type?: string;
    coordinates?: unknown;
  };
}

export interface ParsedRegion {
  id: string;
  name: string;
  parent: string | null;
  pbfUrl: string;
  rings: Ring[];
  box: BoundingBox;
  area: number;
}

/**
 * Coerces untrusted GeoJSON coordinates into a ring.
 *
 * Validating each pair rather than casting: this is someone else's document,
 * and a malformed entry should drop a ring rather than produce NaN coordinates
 * that silently match nothing.
 */
function asRing(value: unknown): Ring | null {
  if (!Array.isArray(value)) return null;
  const ring: [number, number][] = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === 'number' &&
      typeof entry[1] === 'number'
    ) {
      ring.push([entry[0], entry[1]]);
    }
  }
  return ring.length >= 3 ? ring : null;
}

/**
 * Extracts outer rings from a GeoJSON Polygon or MultiPolygon.
 *
 * Only outer rings; holes are dropped on purpose — see `pointInRings`.
 */
function outerRings(geometry: GeofabrikFeature['geometry']): Ring[] {
  if (geometry === undefined) return [];
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return [];

  if (geometry.type === 'Polygon') {
    const ring = asRing(coordinates[0]);
    return ring === null ? [] : [ring];
  }

  if (geometry.type === 'MultiPolygon') {
    const rings: Ring[] = [];
    for (const polygon of coordinates) {
      if (!Array.isArray(polygon)) continue;
      const ring = asRing(polygon[0]);
      if (ring !== null) rings.push(ring);
    }
    return rings;
  }

  return [];
}

/**
 * Parses the index into something rankable.
 *
 * Features without geometry or without a `.pbf` URL are skipped rather than
 * treated as errors: the index legitimately contains entries we cannot use,
 * and failing the whole parse over one would make the feature brittle against
 * an upstream addition.
 */
export function parseIndex(raw: string): ParsedRegion[] {
  let document: { features?: GeofabrikFeature[] };
  try {
    document = JSON.parse(raw) as { features?: GeofabrikFeature[] };
  } catch {
    throw new ServiceError(
      'PROVIDER_ERROR',
      'The region index could not be read. It may have been downloaded incompletely.',
    );
  }

  const regions: ParsedRegion[] = [];

  for (const feature of document.features ?? []) {
    const id = feature.properties?.id;
    const pbfUrl = feature.properties?.urls?.pbf;
    if (typeof id !== 'string' || typeof pbfUrl !== 'string') continue;

    const rings = outerRings(feature.geometry);
    if (rings.length === 0) continue;

    const box = ringsBoundingBox(rings);
    if (box === null) continue;

    regions.push({
      id,
      name: feature.properties?.name ?? id,
      parent: feature.properties?.parent ?? null,
      pbfUrl,
      rings,
      box,
      area: boundingBoxArea(box),
    });
  }

  if (regions.length === 0) {
    throw new ServiceError(
      'PROVIDER_ERROR',
      'The region index contained no usable regions.',
    );
  }

  return regions;
}

/**
 * Ranks the extracts that could serve a viewport, most specific first.
 *
 * ## Ranked by the centre, not by full coverage
 *
 * The obvious rule — "smallest region that fully contains the view" — is
 * wrong, and measurably so. Zoom to Vaduz and the viewport corners cross
 * Liechtenstein's border, so the smallest fully-containing region becomes
 * `alps`: a multi-country bundle vastly larger than the country the user is
 * looking at. Ranking by the centre gives `liechtenstein`, with `alps` offered
 * below it.
 *
 * `coversViewport` is reported per candidate rather than used to filter, so the
 * UI can say "this covers what you can see" or "your view extends past this"
 * and let the user decide. For a view spanning the Swiss–Austrian border that
 * is exactly the choice worth surfacing: Austria alone, or the bundle covering
 * both.
 */
export function rankRegions(
  regions: readonly ParsedRegion[],
  viewport: BoundingBox,
  limit = 6,
): RegionCandidate[] {
  const centre = boundingBoxCentre(viewport);

  const containing = regions.filter((region) =>
    pointInRings(region.rings, centre),
  );

  // Most specific first. Nested regions at similar latitudes, so bounding-box
  // area orders them reliably.
  containing.sort((a, b) => a.area - b.area);

  return containing.slice(0, limit).map((region) => ({
    id: region.id,
    name: region.name,
    parent: region.parent,
    coversViewport: ringsContainBox(region.rings, viewport),
    /** Filled in by the caller, which is what knows how to ask the server. */
    sizeBytes: null,
    tooLarge: false,
  }));
}

export function findRegion(
  regions: readonly ParsedRegion[],
  id: string,
): ParsedRegion {
  const found = regions.find((region) => region.id === id);
  if (found === undefined) {
    throw new ServiceError(
      'NOT_FOUND',
      'That region is no longer in the download index. Refresh and try again.',
    );
  }
  return found;
}

// --------------------------------------------------------------- networking

/**
 * Follows a redirect only within the same origin.
 *
 * `-latest.osm.pbf` is a 307 to a dated filename, so redirects have to be
 * followed to learn a size or fetch anything. Allowing a cross-origin redirect
 * would let the index decide where the app downloads from, which is a much
 * larger trust grant than "download from Geofabrik" — so that is refused, the
 * same rule the rest of the project applies.
 */
async function fetchFollowingSameOrigin(
  url: string,
  init: RequestInit,
  hops = 3,
): Promise<Response> {
  let current = url;

  for (let hop = 0; hop <= hops; hop += 1) {
    const response = await fetch(current, {
      ...init,
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, ...init.headers },
      credentials: 'omit',
    });

    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get('location');
    if (location === null) return response;

    const next = new URL(location, current);
    if (next.origin !== new URL(current).origin) {
      throw new ServiceError(
        'PROVIDER_ERROR',
        'The download was redirected to a different server, which TrailRT will not follow.',
        `${new URL(current).origin} -> ${next.origin}`,
      );
    }
    current = next.toString();
  }

  throw new ServiceError(
    'PROVIDER_ERROR',
    'The download redirected too many times.',
  );
}

export async function downloadIndex(signal?: AbortSignal): Promise<string> {
  const response = await fetchFollowingSameOrigin(
    INDEX_URL,
    signal === undefined ? {} : { signal },
  );

  if (!response.ok) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      `The region index could not be downloaded (HTTP ${response.status}).`,
    );
  }

  return response.text();
}

/**
 * The size of an extract, so the user can see the cost before agreeing to it.
 *
 * Null rather than an error when the server will not say: an unknown size is
 * worth showing as unknown, and refusing to list a region because of a missing
 * header would be worse than listing it without a number.
 */
export async function regionSize(
  pbfUrl: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetchFollowingSameOrigin(
      pbfUrl,
      signal === undefined ? { method: 'HEAD' } : { method: 'HEAD', signal },
    );
    if (!response.ok) return null;
    const length = response.headers.get('content-length');
    if (length === null) return null;
    const parsed = Number.parseInt(length, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

/**
 * Streams an extract to disk.
 *
 * Streamed rather than buffered because these are hundreds of megabytes;
 * `response.arrayBuffer()` on a country extract would hold the whole thing in
 * the main process before a single byte reached disk.
 */
export async function downloadExtract(
  pbfUrl: string,
  destination: string,
  options: {
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<number> {
  const { createWriteStream } = await import('node:fs');
  const { pipeline } = await import('node:stream/promises');
  const { Readable, Transform } = await import('node:stream');

  const response = await fetchFollowingSameOrigin(
    pbfUrl,
    options.signal === undefined ? {} : { signal: options.signal },
  );

  if (!response.ok || response.body === null) {
    throw new ServiceError(
      'PROVIDER_UNAVAILABLE',
      `The region could not be downloaded (HTTP ${response.status}).`,
    );
  }

  const header = response.headers.get('content-length');
  const totalBytes =
    header === null ? null : Number.parseInt(header, 10) || null;

  if (totalBytes !== null && totalBytes > MAX_REGION_BYTES) {
    throw new ServiceError(
      'INVALID_REQUEST',
      `That region is ${(totalBytes / 1024 ** 3).toFixed(1)} GB. TrailRT handles extracts up to ${MAX_REGION_BYTES / 1024 ** 3} GB — choose a country or sub-region rather than a continent.`,
    );
  }

  let received = 0;
  let lastReport = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      // Throttled: a 300 MB download would otherwise push tens of thousands of
      // IPC messages and the progress bar would cost more than the download.
      const now = Date.now();
      if (now - lastReport > 250) {
        lastReport = now;
        options.onProgress?.({ receivedBytes: received, totalBytes });
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    counter,
    createWriteStream(destination),
  );

  options.onProgress?.({ receivedBytes: received, totalBytes });
  return received;
}
