import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RoutingProvider } from '@shared/routing/RoutingProvider';
import { createDatabase, type Db, type DbHandle } from '../db/client';
import { ServiceError } from './errors';
import * as profileService from './profileService';
import * as roadAttributeService from './roadAttributeService';
import * as routeService from './routeService';
import * as trackService from './trackService';
import * as tripService from './tripService';
import * as undoService from './undoService';

let dir: string;
let handle: DbHandle;
let db: Db;
let tripId: string;

const rp = (lat: number, lon: number, ele: number | null = null) => ({
  lat,
  lon,
  ele,
  name: null,
  symbol: null,
  notes: null,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trailrt-profile-'));
  handle = createDatabase({ file: join(dir, 'test.db') });
  db = handle.db;
  undoService.clear();
  tripId = tripService.create(db, {
    name: 'Trip',
    folderId: null,
    description: null,
    notes: null,
  }).result.id;
});

afterEach(() => {
  undoService.clear();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A 500-point timed, elevated recording. Module scope because it closes over
 * the per-test `db` and `tripId` module variables, not over a describe block.
 */
const longTrack = () =>
  trackService.createFromParsed(db, {
    tripId,
    source: 'import',
    parsed: {
      name: 'Long',
      segments: [
        {
          points: Array.from({ length: 500 }, (_, i) => ({
            lat: 53.2588 + i * 0.0001,
            lon: -1.911,
            ele: 100 + i,
            time: i * 1000,
          })),
        },
      ],
      metadata: {},
    },
  }).result;

function route(points: ReturnType<typeof rp>[]): string {
  return routeService.create(db, {
    tripId,
    name: 'Route',
    colour: null,
    points,
  }).result.id;
}

/** Matches every point onto one edge with the given attributes. */
function matchingProvider(edge: {
  speedLimitMps: number | null;
  roadClass: 'primary' | null;
  surface: 'paved' | null;
}): RoutingProvider {
  return {
    id: 'fake',
    name: 'Fake',
    origins: ['https://fake.invalid'],
    attribution: 'Fake',
    snap: () => Promise.reject(new Error('not used')),
    match: (shape, mode) =>
      Promise.resolve({
        provider: 'fake',
        mode,
        shape: [...shape],
        edges: [
          {
            startIndex: 0,
            endIndex: shape.length - 1,
            lengthM: null,
            ...edge,
          },
        ],
        unmatchedPointCount: 0,
      }),
  };
}

describe('profileFor: elevation', () => {
  it('summarises elevation from the full geometry', () => {
    const id = route([rp(53.2588, -1.911, 100), rp(53.2533, -1.9343, 150), rp(53.2578, -2.0327, 120)]);

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.elevation).not.toBeNull();
    expect(profile.elevation?.minM).toBe(100);
    expect(profile.elevation?.maxM).toBe(150);
    expect(profile.elevation?.gainM).toBe(50);
    expect(profile.elevation?.lossM).toBe(30);
    expect(profile.elevationAbsentBecause).toBeNull();
  });

  // The absence has to be distinguishable from flat ground, which is the whole
  // point of Requirement 5.6 and the missing-data rule in the architecture
  // steering.
  it('omits the band and says why when nothing carries elevation', () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343)]);

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.elevation).toBeNull();
    expect(profile.elevationAbsentBecause).toMatch(/not the same as a flat/i);
  });

  it('keeps a missing elevation as null rather than zero', () => {
    const id = route([rp(53.2588, -1.911, 100), rp(53.2533, -1.9343), rp(53.2578, -2.0327, 120)]);

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.samples.map((s) => s.eleM)).toEqual([100, null, 120]);
  });
});

describe('profileFor: distance axis', () => {
  it('is cumulative and starts at zero', () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]);

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    const distances = profile.samples.map((s) => s.distanceM);
    expect(distances[0]).toBe(0);
    expect(distances[1]).toBeGreaterThan(0);
    expect(distances[2]).toBeGreaterThan(distances[1] as number);
    expect(profile.totalDistanceM).toBeCloseTo(distances[2] as number, 6);
  });

  it('refuses a geometry too short to plot', () => {
    const id = route([rp(53.2588, -1.911)]);

    expect(() =>
      profileService.profileFor(db, { ownerType: 'route', ownerId: id }),
    ).toThrow(ServiceError);
  });
});

describe('profileFor: thinning', () => {
  it('thins to the requested maximum and declares that it did', () => {
    const track = longTrack();

    const profile = profileService.profileFor(db, {
      ownerType: 'track',
      ownerId: track.id,
      maxSamples: 50,
    });

    expect(profile.samples).toHaveLength(50);
    expect(profile.simplified).toBe(true);
    // The source count is the real one, so the UI can say what was thinned.
    expect(profile.sourcePointCount).toBe(500);
  });

  // Summarising after thinning would understate ascent on any track with
  // detail between the sampled points.
  it('summarises elevation from the full data, not the thinned samples', () => {
    const track = longTrack();

    const thinned = profileService.profileFor(db, {
      ownerType: 'track',
      ownerId: track.id,
      maxSamples: 10,
    });
    const full = profileService.profileFor(db, {
      ownerType: 'track',
      ownerId: track.id,
      maxSamples: 5000,
    });

    expect(thinned.elevation).toEqual(full.elevation);
    expect(thinned.elevation?.gainM).toBe(499);
  });

  it('reports no thinning for a short geometry', () => {
    const id = route([rp(53.2588, -1.911, 10), rp(53.2533, -1.9343, 20)]);

    expect(
      profileService.profileFor(db, { ownerType: 'route', ownerId: id })
        .simplified,
    ).toBe(false);
  });
});

describe('profileFor: recorded speed', () => {
  it('derives per-segment speed from the recording timestamps', () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Timed',
        segments: [
          {
            points: [
              { lat: 53.2588, lon: -1.911, ele: null, time: 0 },
              { lat: 53.2533, lon: -1.9343, ele: null, time: 60_000 },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    const profile = profileService.profileFor(db, {
      ownerType: 'track',
      ownerId: track.id,
    });

    // The first sample has no preceding segment, so no speed.
    expect(profile.samples[0]?.recordedSpeedMps).toBeNull();
    expect(profile.samples[1]?.recordedSpeedMps).toBeGreaterThan(0);
    expect(profile.recordedSpeedAbsentBecause).toBeNull();
  });

  it('explains that a route has no recorded speed', () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343)]);

    expect(
      profileService.profileFor(db, { ownerType: 'route', ownerId: id })
        .recordedSpeedAbsentBecause,
    ).toMatch(/plan/i);
  });

  it('explains an untimed recording differently from a route', () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Untimed',
        segments: [
          {
            points: [
              { lat: 53.2588, lon: -1.911, ele: null, time: null },
              { lat: 53.2533, lon: -1.9343, ele: null, time: null },
            ],
          },
        ],
        metadata: {},
      },
    }).result;

    expect(
      profileService.profileFor(db, {
        ownerType: 'track',
        ownerId: track.id,
      }).recordedSpeedAbsentBecause,
    ).toMatch(/no timestamps/i);
  });
});

describe('profileFor: road bands', () => {
  it('omits every road band until roads have been matched', () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]);

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.postedSpeedSpans).toBeNull();
    expect(profile.roadClassSpans).toBeNull();
    expect(profile.surfaceSpans).toBeNull();
    expect(profile.postedSpeedAbsentBecause).toMatch(/not been matched/i);
    expect(profile.attributes).toBeNull();
  });

  it('builds spans from the cache once matched', async () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]);

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: id,
      provider: matchingProvider({
        speedLimitMps: 22.22,
        roadClass: 'primary',
        surface: 'paved',
      }),
      mode: 'auto',
    });

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.postedSpeedSpans).toHaveLength(1);
    expect(profile.postedSpeedSpans?.[0]?.value).toBeCloseTo(22.22, 5);
    expect(profile.postedSpeedSpans?.[0]?.startM).toBe(0);
    expect(profile.postedSpeedSpans?.[0]?.endM).toBeCloseTo(
      profile.totalDistanceM,
      6,
    );
    expect(profile.roadClassSpans?.[0]?.value).toBe('primary');
    expect(profile.surfaceSpans?.[0]?.value).toBe('paved');
    expect(profile.attributes?.provider).toBe('fake');
    expect(profile.attributes?.stale).toBe(false);
  });

  /*
   * This is the normal OpenStreetMap case, not an edge case: coverage for
   * `maxspeed` is far thinner than for `highway`, so a classified road with no
   * posted limit is routine. Each band has to stand or fall on its own data.
   */
  it('keeps the class band when the speed band has no data', async () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343)]);

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: id,
      provider: matchingProvider({
        speedLimitMps: null,
        roadClass: 'primary',
        surface: null,
      }),
      mode: 'auto',
    });

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    expect(profile.roadClassSpans).toHaveLength(1);
    expect(profile.postedSpeedSpans).toBeNull();
    expect(profile.postedSpeedAbsentBecause).toMatch(/no posted speed limit/i);
    expect(profile.surfaceAbsentBecause).toMatch(/no surface/i);
  });

  it('reports the cache as stale after the geometry changes', async () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]);

    await roadAttributeService.match(db, {
      ownerType: 'route',
      ownerId: id,
      provider: matchingProvider({
        speedLimitMps: 13.89,
        roadClass: 'primary',
        surface: null,
      }),
      mode: 'auto',
    });

    routeService.setGeometry(db, {
      id,
      points: [rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.1043, -2.0221)],
    });

    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
    });

    // Returned, not hidden: Requirement 8.4 wants what we have, labelled.
    expect(profile.attributes?.stale).toBe(true);
    expect(profile.postedSpeedSpans).not.toBeNull();
  });

  /*
   * A track is matched from its render cache but profiled from its real points,
   * so the two lines differ slightly in length. The bands are placed by
   * fraction along the route; without that they would drift further left the
   * further along the chart you look.
   */
  it('places a full-length band across the whole profile for a track', async () => {
    const track = trackService.createFromParsed(db, {
      tripId,
      source: 'import',
      parsed: {
        name: 'Track',
        segments: [
          {
            points: Array.from({ length: 400 }, (_, i) => ({
              lat: 53.2588 + i * 0.0005,
              lon: -1.911 + Math.sin(i / 20) * 0.0004,
              ele: null,
              time: null,
            })),
          },
        ],
        metadata: {},
      },
    }).result;

    await roadAttributeService.match(db, {
      ownerType: 'track',
      ownerId: track.id,
      provider: matchingProvider({
        speedLimitMps: 16.67,
        roadClass: 'primary',
        surface: null,
      }),
      mode: 'auto',
    });

    const profile = profileService.profileFor(db, {
      ownerType: 'track',
      ownerId: track.id,
    });

    const span = profile.postedSpeedSpans?.[0];
    expect(span).toBeDefined();
    expect(span?.startM).toBe(0);
    expect(span?.endM).toBeCloseTo(profile.totalDistanceM, 3);
  });
});

describe('profileFor: terrain elevation (ADR 0018)', () => {
  /** A model where height rises 1 m per 0.0001° north: a steady climb. */
  const climbing = {
    elevations: (points: readonly { lat: number; lon: number }[]) => ({
      values: points.map((p) => Math.round((p.lat - 53) * 10_000)),
      missingTiles: [],
    }),
  };

  it('plots terrain heights for a route that carries none, labelled as terrain', () => {
    const id = route(
      Array.from({ length: 50 }, (_, i) => rp(53.25 + i * 0.001, -1.911)),
    );
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
      terrain: climbing,
    });
    expect(profile.elevationSource).toBe('terrain');
    expect(profile.elevationAbsentBecause).toBeNull();
    expect(profile.samples[0]?.eleM).toBe(2500);
    expect(profile.elevation?.gainM).toBe(490);
    expect(profile.elevation?.lossM).toBe(0);
  });

  it('offers a download when the tiles are missing, rather than plotting nothing silently', () => {
    const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343)]);
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
      terrain: {
        elevations: (points) => ({
          values: points.map(() => null),
          missingTiles: ['N53W002'],
        }),
      },
    });
    expect(profile.elevation).toBeNull();
    expect(profile.terrainMissing?.tileCount).toBe(1);
    expect(profile.elevationAbsentBecause).toMatch(/not downloaded/i);
  });

  it('keeps recorded heights and never consults the model for them', () => {
    const id = route([rp(53.2588, -1.911, 300), rp(53.2533, -1.9343, 320)]);
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
      terrain: {
        elevations: () => {
          throw new Error('recorded elevation must win');
        },
      },
    });
    expect(profile.elevationSource).toBe('recorded');
    expect(profile.samples.map((s) => s.eleM)).toEqual([300, 320]);
  });

  it('lists the tiles a geometry needs', () => {
    const id = route([rp(53.2588, -1.911), rp(52.9, -1.8)]);
    expect(profileService.terrainTilesFor(db, 'route', id).toSorted()).toEqual([
      'N52W002',
      'N53W002',
    ]);
  });
});

describe('profileFor: twistiness', () => {
  it('scores road-like geometry', () => {
    // 3 km snaking every 20 m: road geometry, dense enough to score.
    const points = Array.from({ length: 150 }, (_, i) =>
      rp(53.25 + i * 0.00018, -1.911 + 0.0006 * Math.sin(i / 3)),
    );
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: route(points),
    });
    expect(profile.twistiness).not.toBeNull();
    expect(profile.twistiness?.score).toBeGreaterThan(0);
    expect(profile.twistinessUnknownBecause).toBeNull();
  });

  it('is unknown, with the reason, for straight lines between clicked points', () => {
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]),
    });
    expect(profile.twistiness).toBeNull();
    expect(profile.twistinessUnknownBecause).toMatch(/too far apart/i);
  });
});

/** A route matched onto one unposted primary road near Buxton. */
async function unpostedPrimary(): Promise<string> {
  const id = route([rp(53.2588, -1.911), rp(53.2533, -1.9343), rp(53.2578, -2.0327)]);
  await roadAttributeService.match(db, {
    ownerType: 'route',
    ownerId: id,
    provider: matchingProvider({ speedLimitMps: null, roadClass: 'primary', surface: null }),
    mode: 'auto',
  });
  return id;
}

describe('profileFor: assumed UK limits (ADR 0018)', () => {

  it('draws assumed spans in their own series, never as posted', async () => {
    const id = await unpostedPrimary();
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
      ukDefaults: true,
    });
    expect(profile.postedSpeedSpans).toBeNull();
    expect(profile.assumedSpeedSpans).toHaveLength(1);
    expect(profile.assumedSpeedSpans?.[0]?.value).toBeCloseTo((60 * 1609.344) / 3600, 6);
    expect(profile.postedSpeedAbsentBecause).toBeNull();
  });

  it('assumes nothing with the setting off', async () => {
    const id = await unpostedPrimary();
    const profile = profileService.profileFor(db, {
      ownerType: 'route',
      ownerId: id,
      ukDefaults: false,
    });
    expect(profile.assumedSpeedSpans).toBeNull();
    expect(profile.postedSpeedAbsentBecause).toMatch(/no posted speed limit/i);
  });
});
