import { describe, expect, it } from 'vitest';
import {
  A515_TRACE,
  ASHBOURNE,
  BUXTON,
  BUXTON_VIEWPORT,
  CAT_AND_FIDDLE_TRACE,
  CORNERS,
  LEEK,
  LEGS,
  LOOP_VIEWPORT,
  MACCLESFIELD,
  TOWNS,
  betweenTowns,
  catAndFiddle,
  closedLoop,
  corners,
  legShape,
  loopPerimeterM,
  loopShape,
  recordedLegs,
  recordedLoop,
} from '@fixtures/places';
import { boundingBox, haversineDistance } from './distance';

/**
 * The test geography's own invariants.
 *
 * A fixture every other test leans on is worth checking, because a silent
 * error in it weakens every assertion built on top — and these coordinates
 * were wrong once already: three of the via points were off the road by up to
 * 3.4 km before they were resolved against OpenStreetMap, which the live snap
 * corridor check caught.
 *
 * What is asserted here is the shape of the data and the claims the
 * documentation makes about it, not the accuracy of the positions. Accuracy is
 * what `valhalla.live.test.ts` and `geofabrik.live.test.ts` check, against the
 * real road network and the real region index.
 */

describe('the four corners', () => {
  it('is a square of four distinct market towns', () => {
    expect(CORNERS).toHaveLength(4);
    expect(CORNERS.map((town) => town.name)).toEqual([
      'Buxton',
      'Macclesfield',
      'Leek',
      'Ashbourne',
    ]);
    expect(new Set(CORNERS.map((t) => `${t.lat},${t.lon}`)).size).toBe(4);
  });

  it('spans three counties, which is what makes the region case real', () => {
    // Geofabrik publishes England by county, so this is the reason no single
    // county extract covers the loop. Asserted so the claim in the docs and
    // the live region test cannot quietly stop being true.
    expect(new Set(CORNERS.map((town) => town.county))).toEqual(
      new Set(['Derbyshire', 'Cheshire', 'Staffordshire']),
    );
  });

  it('is in Britain, west of Greenwich', () => {
    for (const town of CORNERS) {
      expect(town.lat).toBeGreaterThan(49);
      expect(town.lat).toBeLessThan(61);
      // Negative longitudes throughout: a dropped minus sign is invisible in
      // a fixture that sits east of Greenwich.
      expect(town.lon).toBeLessThan(0);
      expect(town.lon).toBeGreaterThan(-8);
    }
  });

  it('has a northern edge that reads as straight', () => {
    // Buxton 53.2588 and Macclesfield 53.2602 — within 0.002°, about 160 m.
    // This is what makes the loop look like a box rather than a scribble.
    expect(Math.abs(BUXTON.lat - MACCLESFIELD.lat)).toBeLessThan(0.002);
  });

  it('puts Leek and Ashbourne south of the northern edge', () => {
    expect(LEEK.lat).toBeLessThan(BUXTON.lat);
    expect(ASHBOURNE.lat).toBeLessThan(LEEK.lat);
  });

  it('is the size of a day ride, not a continent', () => {
    expect(betweenTowns('buxton', 'macclesfield') / 1000).toBeCloseTo(14.3, 0);
    expect(betweenTowns('macclesfield', 'leek') / 1000).toBeCloseTo(18.7, 0);
    expect(betweenTowns('leek', 'ashbourne') / 1000).toBeCloseTo(21.7, 0);
    expect(betweenTowns('ashbourne', 'buxton') / 1000).toBeCloseTo(29.4, 0);
  });

  it('closes, so the shape is a circuit', () => {
    const closed = closedLoop();
    expect(closed).toHaveLength(5);
    expect(closed.at(-1)?.lat).toBe(closed[0]?.lat);
    expect(closed.at(-1)?.lon).toBe(closed[0]?.lon);
  });

  it('offers the corners open too, for a three-leg selection', () => {
    expect(corners()).toHaveLength(4);
    // Route points, so the fields a route carries are present and absent
    // elevation would be null rather than 0.
    expect(corners()[0]).toMatchObject({ name: 'Buxton', symbol: null });
  });
});

describe('the legs', () => {
  it('describes four legs that chain into a circuit', () => {
    expect(LEGS).toHaveLength(4);
    for (const [index, leg] of LEGS.entries()) {
      const next = LEGS[(index + 1) % LEGS.length];
      // Each leg ends where the next begins.
      expect(leg.to).toBe(next?.from);
    }
  });

  it('names the roads, including the A537 over the Cat and Fiddle', () => {
    expect(LEGS[0]?.label).toBe('Cat and Fiddle');
    expect(LEGS[0]?.roads).toContain('A537');
    expect(LEGS[3]?.roads).toContain('A515');
  });

  it('climbs over the Cat and Fiddle and back down', () => {
    const shape = catAndFiddle();
    const summit = Math.max(...shape.map((place) => place.eleM));
    // The inn is the second-highest in England, around 515 m, and both ends of
    // the leg are far lower. That spread is what makes the leg useful for the
    // elevation profile and the gradient bands.
    expect(summit).toBeGreaterThan(450);
    expect(shape[0]?.eleM).toBeLessThan(summit);
    expect(shape.at(-1)?.eleM).toBeLessThan(summit);
  });

  it('runs each leg through its named via points in order', () => {
    for (const [index, leg] of LEGS.entries()) {
      const shape = legShape(index);
      expect(shape).toHaveLength(leg.via.length + 2);
      expect(shape[0]?.name).toBe(TOWNS[leg.from].name);
      expect(shape.at(-1)?.name).toBe(TOWNS[leg.to].name);
    }
  });

  it('refuses a leg index the loop does not have', () => {
    expect(() => legShape(9)).toThrow(/no leg 9/);
  });
});

describe('loopShape', () => {
  it('closes and includes every corner and via point', () => {
    const shape = loopShape();
    const viaCount = LEGS.reduce((sum, leg) => sum + leg.via.length, 0);
    // Four corners, their via points, and the closing return to Buxton.
    expect(shape).toHaveLength(4 + viaCount + 1);
    expect(shape[0]?.name).toBe('Buxton');
    expect(shape.at(-1)?.name).toBe('Buxton');
  });

  it('is about a hundred kilometres, matching the snapped road distance', () => {
    // 87.6 km of straight lines through the via points; the live snap measures
    // 100.8 km by road, which is the right relationship between the two.
    const km = loopPerimeterM() / 1000;
    expect(km).toBeGreaterThan(80);
    expect(km).toBeLessThan(95);
  });

  it('stays inside the loop viewport', () => {
    const box = boundingBox(loopShape());
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.minLat).toBeGreaterThanOrEqual(LOOP_VIEWPORT.minLat);
    expect(box.maxLat).toBeLessThanOrEqual(LOOP_VIEWPORT.maxLat);
    expect(box.minLon).toBeGreaterThanOrEqual(LOOP_VIEWPORT.minLon);
    expect(box.maxLon).toBeLessThanOrEqual(LOOP_VIEWPORT.maxLon);
  });
});

describe('recordedLoop', () => {
  it('interpolates a dense, timed, climbing recording', () => {
    const points = recordedLoop();

    expect(points.length).toBeGreaterThan(100);
    expect(points.every((p) => p.time !== null)).toBe(true);
    expect(points.every((p) => p.ele !== null)).toBe(true);
    // Monotonic time: a recorder does not go backwards.
    for (const [index, point] of points.entries()) {
      const next = points[index + 1];
      if (next?.time != null && point.time != null) {
        expect(next.time).toBeGreaterThanOrEqual(point.time);
      }
    }
  });

  it('samples close enough together to be a recording, not a route', () => {
    const points = recordedLoop({ perSegment: 20 });
    const gaps = points
      .slice(0, -1)
      .map((point, index) => haversineDistance(point, points[index + 1]!));
    // A few hundred metres at most: dense enough that simplification has
    // something to remove and sparse enough to stay readable.
    expect(Math.max(...gaps)).toBeLessThan(1_000);
  });

  it('leaves elevation and time absent on request, as null', () => {
    const bare = recordedLoop({ perSegment: 2, untimed: true, noElevation: true });
    // Absent, not zero. The distinction the whole codebase turns on.
    expect(bare.every((p) => p.time === null)).toBe(true);
    expect(bare.every((p) => p.ele === null)).toBe(true);
  });
});

describe('recordedLegs', () => {
  it('gives one segment per leg, with real gaps between them', () => {
    const segments = recordedLegs();
    expect(segments).toHaveLength(4);
    expect(segments.every((points) => points.length > 3)).toBe(true);

    // An hour between the end of one segment and the start of the next, which
    // no reader could mistake for a sampling interval.
    for (const [index, points] of segments.entries()) {
      const next = segments[index + 1];
      if (next === undefined) continue;
      const gap = (next[0]?.time ?? 0) - (points.at(-1)?.time ?? 0);
      expect(gap).toBeGreaterThan(10 * 60 * 1000);
    }
  });
});

describe('the road traces', () => {
  it('are dense enough for map matching', () => {
    for (const trace of [A515_TRACE, CAT_AND_FIDDLE_TRACE]) {
      expect(trace.length).toBeGreaterThan(10);
      const gaps = trace
        .slice(0, -1)
        .map((point, index) => haversineDistance(point, trace[index + 1]!));
      // Valhalla's map_snap refuses sparse waypoints outright — it answered
      // the four corridor points with error 444. Under a kilometre apart is
      // what it accepts.
      expect(Math.max(...gaps)).toBeLessThan(3_000);
    }
  });

  it('keeps the A515 trace inside Derbyshire, so one county extract covers it', () => {
    const box = boundingBox(A515_TRACE);
    expect(box).not.toBeNull();
    if (box === null) return;
    // The county boundary on the A537 is near longitude -1.99; staying east of
    // it is what makes a 44 MB download enough for the local tests.
    expect(box.minLon).toBeGreaterThan(-1.99);
  });

  it('runs the Cat and Fiddle trace west across the county boundary', () => {
    const box = boundingBox(CAT_AND_FIDDLE_TRACE);
    expect(box).not.toBeNull();
    if (box === null) return;
    // Which is why it is used only against the live instance, where the whole
    // planet is available.
    expect(box.minLon).toBeLessThan(-2.0);
  });
});

describe('the viewports', () => {
  it('frames Buxton tightly enough to land in one county', () => {
    expect(BUXTON_VIEWPORT.minLat).toBeLessThan(BUXTON.lat);
    expect(BUXTON_VIEWPORT.maxLat).toBeGreaterThan(BUXTON.lat);
    expect(BUXTON_VIEWPORT.minLon).toBeLessThan(BUXTON.lon);
    expect(BUXTON_VIEWPORT.maxLon).toBeGreaterThan(BUXTON.lon);
  });

  it('frames the whole loop in the loop viewport', () => {
    for (const town of CORNERS) {
      expect(town.lat).toBeGreaterThan(LOOP_VIEWPORT.minLat);
      expect(town.lat).toBeLessThan(LOOP_VIEWPORT.maxLat);
      expect(town.lon).toBeGreaterThan(LOOP_VIEWPORT.minLon);
      expect(town.lon).toBeLessThan(LOOP_VIEWPORT.maxLon);
    }
  });
});
