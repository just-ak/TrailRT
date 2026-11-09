# ADR 0015: The test geography is a real loop around Buxton

**Status:** accepted
**Date:** 2026-11-08
**Supersedes:** nothing. Amends the fixture conventions in ADR 0011 and 0013.

## Context

Until now every coordinate in the test suite was invented and placed in the
Swiss and Italian Alps — `46.5, 8.0` and neighbours — on the reasoning that it
was a plausible region for the trips the application is for.

That was fine while the tests were about storage and parsing. It stopped being
fine once Phase 4 added snapping, map matching, posted speed limits and
map-region selection, because all four are claims about the *real world* and
invented coordinates cannot test them:

- A snap test on two points in empty country can assert that a shape came back.
  It cannot assert the shape is right, because there is no road it should have
  followed.
- A speed-limit test can assert a number is in a plausible range. It cannot
  assert the mph → km/h → m/s conversion chain is intact, because there is no
  posted limit to compare against.
- A region-selection test can assert the ranking logic against hand-built
  boxes, which `geofabrik.test.ts` does. It cannot tell us whether the ranking
  is *useful* on the real index.

The Vaduz fixtures were a partial admission of this: they were chosen because
Liechtenstein is small enough to build a graph from quickly, and because a
viewport zoomed to Vaduz happens to expose the full-coverage ranking bug. Real
geography was already doing the work; it just was not the user's geography.

## Decision

**One test geography, imported from `@fixtures/places`: a loop round four real
market towns in the Peak District.**

```
  Macclesfield ────── A537 "Cat and Fiddle" ────── Buxton
       │                                              │
     A523                                           A515
       │                                              │
     Leek ───────── A523 / A52 ───────────────── Ashbourne
```

Buxton and Macclesfield are within 0.002° of the same latitude, so the northern
edge reads as a straight line and the shape reads as a box rather than a
scribble. Measured against a live Valhalla instance: 100.8 km by road over four
legs, against about 88 km of straight lines through the corners and via points.

`test-data/places.json` holds the data; `test-data/places.ts` holds the
reasoning and the derived helpers. One definition serves the unit tests, the
end-to-end specs, the Electron verification script and the generated GPX
fixture.

### What this buys, concretely

**Snapping becomes judgeable.** A snapped route is supposed to stay near the
control points it was given, and with real roads there is something to be near.
This is not hypothetical. Three of the via points were wrong when first
written — Newhaven by 3.4 km, Walker Barn by 1.3 km, the Cat and Fiddle by
1.1 km — and the live corridor assertion is what found them. They were then
resolved against OpenStreetMap through Nominatim, and the worst offset is now
76 m.

**Posted limits can be checked exactly, not loosely.** UK limits are posted in
mph, OSM stores `maxspeed=30 mph`, and Valhalla answers in km/h. The live tests
see 48, 64 and 80 km/h — which are 30, 40 and 50 mph to within a rounding
error. So the assertion is no longer "somewhere between 1 and 60 m/s" but "a
whole mph multiple", which no break in that conversion chain can satisfy.

**The region picker's hard case is now a fixture.** Geofabrik publishes England
by county, and the loop spans three: Derbyshire (Buxton, Ashbourne), Cheshire
(Macclesfield), Staffordshire (Leek). So **no county extract covers the
square.** Confirmed live: a view of the whole loop ranks `staffordshire` first
and reports `coversViewport: false`, with `england` as the covering option.
That is precisely the behaviour `rankRegions` was designed for, and it was
previously only testable against contrived geometry.

**The Cat and Fiddle is the right road for Phase 6.** The A537 is one of the
twistiest roads in England and climbs from 130 m at Macclesfield to 515 m at
the inn. The windy-roads work needs a corridor where twistiness scoring has
something to score; it now has one, with real curvature and real elevation.

## Two findings this forced out

**Map matching needs a trace, not waypoints.** Valhalla answers the four
corridor points with HTTP 400, error 444, "map_snap algorithm failed to snap
the shape points". Straight-line interpolation between them fails too, because
it cuts the bends off a road whose bends are the point of it. So the live
attribute tests snap first and match the returned road geometry — which is also
the production sequence, since `roadAttributeService.match` matches a route
that has already been snapped.

For the offline cases, `places.json` carries two traces sampled from real
snapped routes, so their points lie on the carriageway.

**A county boundary constrains the local test graph.** The A537 crosses from
Derbyshire into Cheshire around the Cat and Fiddle, so a `derbyshire` extract
covers only half of it. The A515 between Buxton and Ashbourne stays in one
county, so `A515_TRACE` is what the Electron verification and the embedded
end-to-end spec use: 44 MB to download, 4.5 seconds to build, 21 tiles.
Measured in-process on that graph: a 17.8 km route in 57 ms, and 108 of 115
matched edges carrying a posted limit.

## Consequences

- `DEFAULT_SETTINGS.mapPosition` moves to the Peak District. A first launch has
  nothing to show either way, and this at least matches the geography the
  application is tested against.
- The local routing tests need the `derbyshire` extract. The embedded
  end-to-end spec probes once after launch and **skips with the reason** when
  the seeded graph does not cover the geography — a graph for the wrong region
  loads fine, reports itself available, then fails every route, which looks
  like a broken engine rather than a missing county.
- `@fixtures` is a new path alias, pointing at `test-data/`. It sits outside
  `src/` so nothing the application ships can import it.
- `places.ts` imports JSON with `with { type: 'json' }`. Not decorative: the
  end-to-end specs are loaded by Node directly rather than through a bundler,
  and Node refuses a JSON module without the attribute.

## What was deliberately not changed

**The format fixtures stay in the Alps.** `alps-full.gpx` and its neighbours
exist to exercise parsing and exact round-tripping, where the coordinates are
arbitrary by design. Moving them would churn roughly a hundred exact-value
assertions across ten test files and add no coverage.

The one real gap that left is worth naming, because it is a genuine hole rather
than a cosmetic inconsistency: **every existing fixture is east of Greenwich,
so every longitude is positive, and a positive longitude round-trips through a
dropped minus sign unchanged.** That is closed by
`generated/peak-district-loop.gpx`, generated from `places.json` so it cannot
drift, carrying waypoints, a route and a four-segment track with negative
longitudes throughout.

## Alternatives considered

**Keep the Alps and add Buxton alongside.** Rejected: two geographies means
every new test picks one arbitrarily, and the suite stops telling a reader
where the application is supposed to work.

**Use a linear transform to move the Alpine coordinates onto the Peak
District.** Rejected. It preserves relative geometry, so the existing
assertions mostly survive, but it produces coordinates that land in fields —
which is exactly the property that made the old fixtures untestable against
real roads.

**Invent a square with round numbers near Buxton.** Rejected for the same
reason. The value is in the roads being real, not in the shape being tidy.
