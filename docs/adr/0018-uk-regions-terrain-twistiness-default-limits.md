# ADR 0018: UK county regions, terrain elevation, twistiness, and UK default limits

Status: accepted
Date: 2026-11-09
Amends ADR 0011 §2 (Unknown is a band) and ADR 0013 (one region at a time).
Renumbers the windy-roads phase to 8 and Garmin to 9, amending ADR 0012 and
ADR 0017.

## Context

After Phase 6 the owner asked for five things:

- regions picked from a UK county map, several at once
- road-following as the default way to make a route
- altitude on route profiles
- a twisty score on every profile
- UK roads with no posted limit counted at the national limit.

The investigation is in `.kiro/specs/phase-7-regions-profile/requirements.md`.
This ADR records the decisions that are not just implementation.

## Decision

### 1. Several regions are merged with `osmium` before building

Valhalla's tile builder accepts several extracts, but it aborts on overlapping
ones (exit 134, measured), and Geofabrik's county polygons always overlap their
neighbours. The extracts are therefore merged first with `osmium merge`, from
`osmium-tool` (GPL-3.0-or-later), bundled beside the Valhalla tools. For
Derbyshire, Cheshire and Staffordshire: 1.5 s to merge, 11 s to build, and the
whole test loop routes.

Merging in TypeScript was rejected. Deduplicating PBF means writing and
maintaining a PBF encoder, and the standard tool exists, is fast, and has a
compatible licence.

ADR 0013's "one region at a time" now means **one graph at a time**. The graph
may cover many regions, and choosing a new set still replaces it.

### 2. Terrain elevation comes from Terrain Tiles, and is a derived value

Routes from the engine have no elevation. Heights come from the open Terrain
Tiles dataset (1″ SRTM-derived HGT, about 30 m), downloaded with a region and
cached gzipped. They are computed when a profile is drawn, labelled as modelled,
and never written into route points or exported. That follows the architecture
rule that derived values are caches and must not become the only copy of
anything. Recorded elevation always wins.

### 3. Twistiness is heading change after resampling, not point density

The owner suggested points per kilometre. Measured on real roads, it fails:

- Snake Pass (28 points/km) and the A53 (29) come out about the same.
- A GPS track's density measures riding speed, not bends.

The score resamples every 20 m, smooths, and counts degrees of meaningful bend
per kilometre. It is the scoring function the windy-roads phase requires, built
early, pure, and calibrated on the Buxton-area roads.

### 4. UK default limits may fill gaps, labelled as assumed

ADR 0011 §2 said distance with no posted limit is never "filled from a country
default". That is amended. In the UK only, and only for a road whose class is
known, an absent limit may be replaced by the UK statutory default for that
kind of road, under these conditions:

1. It is labelled **assumed** everywhere it appears, and kept separable from
   posted limits in every figure.
2. It applies only inside the UK boundary. Ireland, the Isle of Man and the
   Channel Islands have different law.
3. Distance with no road class, or not matched to any road, stays Unknown.
4. It can be switched off, which returns to ADR 0011's strict reporting.
5. The rules live in one module, with their legal basis.

Residential and service roads take 30 mph (a restricted road), not 60. That
departs from the literal request, and is recorded as such. In UK law a
street-lit road is 30 mph, and counting a housing estate at the national limit
would be the bigger error.

### 5. Road-following is the default; straight lines are a deliberate choice

"New Route" starts the road-following tool whenever the engine can route. The
separate toolbar button and the in-drawing toggle are gone. Straight-line routes
remain as an explicit menu command for paths no road graph knows. With routing
unavailable, the drawing hint says why, instead of drawing straight lines
silently.

### 6. Phase numbering

This work is Phase 7. Windy roads becomes Phase 8 and Garmin Phase 9. Code
comments already name phases rather than numbering them (ADR 0017), so no
source file needed renumbering.

## Consequences

- A new native tool ships, with its dylib closure, through the existing bundling
  script. A build without it degrades to single-region.
- A second main-process network host: the Terrain Tiles bucket. The renderer
  CSP is unchanged.
- The speed distribution has a third state besides posted and Unknown, and every
  view of it has to show it. That is a real cost in UI, and it is why the
  setting exists.
- Each new region selection re-downloads every selected extract, because
  extracts are still deleted after building. Keeping them is a possible
  follow-up, at the cost of disk space.
