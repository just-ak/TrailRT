import { describe, expect, it } from 'vitest';
import { A515_TRACE, ASHBOURNE, BUXTON, LEEK, MACCLESFIELD } from '@fixtures/places';
import { haversineDistance, pathDistance, type LatLon } from './distance';
import {
  buildLineIndex,
  corridorBox,
  project,
  searchCorridor,
  uncoveredStretches,
} from './corridor';

/**
 * Candidates are made by moving a known on-road point a measured distance
 * east, so the expected off-route distance is known exactly. They are
 * displacements from the fixture, not invented places.
 */
function east(point: LatLon, metres: number): LatLon {
  const metresPerDegree = 111_195 * Math.cos((point.lat * Math.PI) / 180);
  return { lat: point.lat, lon: point.lon + metres / metresPerDegree };
}

function midpoint(a: LatLon, b: LatLon): LatLon {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/**
 * A point `metres` from the middle of segment a–b, at right angles to it, on
 * the left. Its true distance from that segment is exactly `metres`.
 */
function beside(a: LatLon, b: LatLon, metres: number): LatLon {
  const mid = midpoint(a, b);
  const cos = Math.cos((mid.lat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * cos;
  const dy = b.lat - a.lat;
  const length = Math.hypot(dx, dy);
  // Left normal of (dx, dy) is (-dy, dx).
  const degrees = metres / 111_195;
  return { lat: mid.lat + (dx / length) * degrees, lon: mid.lon + ((-dy / length) * degrees) / cos };
}

function vertex(i: number): LatLon {
  const point = A515_TRACE[i];
  if (point === undefined) throw new Error(`A515_TRACE has no vertex ${i}`);
  return point;
}

const index = buildLineIndex(A515_TRACE);

describe('buildLineIndex', () => {
  it('measures the line the same way route statistics do', () => {
    expect(index.totalM).toBeCloseTo(pathDistance(A515_TRACE), 6);
    expect(index.cumulative[0]).toBe(0);
    expect(index.cumulative.at(-1)).toBeCloseTo(index.totalM, 6);
  });
});

describe('project', () => {
  it('puts an on-route vertex at its own distance and zero off', () => {
    const hit = project(index, vertex(7), 100);
    expect(hit?.alongM).toBeCloseTo(index.cumulative[7] ?? -1, 3);
    expect(hit?.offM).toBeCloseTo(0, 3);
  });

  it('measures a point beside the road to within a metre of its true offset', () => {
    // Segment 10–11 is the longest straight on the trace: about 2.6 km.
    const hit = project(index, beside(vertex(10), vertex(11), 300), 1000);
    expect(hit?.offM).toBeCloseTo(300, -0.3); // within 1 m
    const middle = ((index.cumulative[10] ?? 0) + (index.cumulative[11] ?? 0)) / 2;
    expect(Math.abs((hit?.alongM ?? 0) - middle)).toBeLessThan(5);
    expect(hit?.segment).toBe(10);
  });

  it('refuses a point beyond the width', () => {
    expect(project(index, beside(vertex(10), vertex(11), 2100), 2000)).toBeNull();
    expect(project(index, beside(vertex(10), vertex(11), 1900), 2000)).not.toBeNull();
  });

  it('finds the nearer pass of a loop', () => {
    const loop = [BUXTON, MACCLESFIELD, LEEK, ASHBOURNE, BUXTON];
    const loopIndex = buildLineIndex(loop);
    // Just off Buxton towards Macclesfield: the start of the loop.
    const nearStart = {
      lat: BUXTON.lat + (MACCLESFIELD.lat - BUXTON.lat) * 0.05,
      lon: BUXTON.lon + (MACCLESFIELD.lon - BUXTON.lon) * 0.05,
    };
    // Just off Buxton towards Ashbourne: the end of the loop.
    const nearEnd = {
      lat: BUXTON.lat + (ASHBOURNE.lat - BUXTON.lat) * 0.05,
      lon: BUXTON.lon + (ASHBOURNE.lon - BUXTON.lon) * 0.05,
    };
    expect(project(loopIndex, nearStart, 500)?.alongM).toBeLessThan(5000);
    expect(project(loopIndex, nearEnd, 500)?.alongM).toBeGreaterThan(loopIndex.totalM - 5000);
  });

  it('accepts an unbounded reach without walking forever', () => {
    const far = { lat: 51.5, lon: -0.12 };
    const hit = project(index, far, Number.POSITIVE_INFINITY);
    expect(hit).not.toBeNull();
    expect(hit?.offM).toBeGreaterThan(100_000);
  });

  it('handles a line of one point', () => {
    const single = buildLineIndex([BUXTON]);
    expect(project(single, east(BUXTON, 100), 200)).toMatchObject({ alongM: 0 });
    expect(project(single, east(BUXTON, 300), 200)).toBeNull();
  });
});

describe('searchCorridor', () => {
  const candidates = [
    { id: 'late', ...east(A515_TRACE[15] ?? BUXTON, 400) },
    { id: 'early', ...east(A515_TRACE[2] ?? BUXTON, 900) },
    { id: 'far', ...east(A515_TRACE[9] ?? BUXTON, 6000) },
    { id: 'middle', ...east(A515_TRACE[9] ?? BUXTON, 100) },
  ];

  it('keeps those within the width, in the order they are reached', () => {
    const hits = searchCorridor(index, candidates, 1000);
    expect(hits.map((h) => h.item.id)).toEqual(['early', 'middle', 'late']);
    for (const hit of hits) expect(hit.offM).toBeLessThanOrEqual(1000);
  });

  it('narrows to a range of distances', () => {
    const from = index.cumulative[5] ?? 0;
    const to = index.cumulative[12] ?? 0;
    const hits = searchCorridor(index, candidates, 1000, { kind: 'range', fromM: from, toM: to });
    expect(hits.map((h) => h.item.id)).toEqual(['middle']);
  });

  it('narrows to a radius round a point, ignoring the width', () => {
    const end = A515_TRACE.at(-1) ?? ASHBOURNE;
    // Vertex 18 is 2.0 km from the end; 'late' (vertex 15) is 7.9 km away.
    const roadside = { id: 'roadside', ...east(vertex(18), 100) };
    const nearEnd = { id: 'hotel', ...east(end, 3000) };
    const hits = searchCorridor(index, [...candidates, roadside, nearEnd], 500, {
      kind: 'near',
      point: end,
      radiusM: 5000,
    });
    expect(hits.map((h) => h.item.id)).toEqual(['roadside', 'hotel']);
    for (const hit of hits) expect(haversineDistance(end, hit.item)).toBeLessThanOrEqual(5000);
  });

  it('returns nothing, not an error, when nothing is near', () => {
    expect(searchCorridor(index, [candidates[2] as (typeof candidates)[number]], 1000)).toEqual([]);
    expect(searchCorridor(index, [], 1000)).toEqual([]);
  });
});

describe('corridorBox', () => {
  it('contains every candidate the search could accept', () => {
    const box = corridorBox(A515_TRACE, 2000);
    if (box === null) throw new Error('no box');
    for (const point of A515_TRACE) {
      const out = east(point, 1999);
      expect(out.lon).toBeLessThan(box.maxLon);
    }
    expect(corridorBox([], 100)).toBeNull();
  });
});

describe('uncoveredStretches', () => {
  it('reports the stretch outside coverage as a distance range', () => {
    const cutoff = A515_TRACE[12]?.lat ?? 0;
    // Everything south of vertex 12 is "outside the data".
    const stretches = uncoveredStretches(index, (p) => p.lat >= cutoff);
    expect(stretches).toHaveLength(1);
    expect(stretches[0]?.fromM).toBeCloseTo(index.cumulative[12] ?? -1, 6);
    expect(stretches[0]?.toM).toBeCloseTo(index.totalM, 6);
  });

  it('reports nothing when the whole line is covered', () => {
    expect(uncoveredStretches(index, () => true)).toEqual([]);
  });
});
