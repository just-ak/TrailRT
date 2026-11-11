# ADR 0019: Road trip itineraries, and offline places, POIs and postcodes

Status: accepted
Date: 2026-11-10

## Context

The owner asked for calendar-based trip planning with stops lasting hours or
days, and for hotels, fuel and other points of interest along a route. They
then added postcode and place search, and asked for it to stay offline. They
also asked for the phase to be built straight away, ahead of the windy-roads
(8) and Garmin (9) phases.

The requirements and the measurements behind this ADR are in
`.kiro/specs/phase-10-road-trip-planning/`.

## Decision

### 1. Built ahead of Phases 8 and 9

Phase 10 depends only on Phases 4 and 7, which are complete. The rule against
designing ahead exists to stop guessing at interfaces that have not settled;
every interface this phase uses has shipped. It keeps its number rather than
renumbering 8 and 9 again, because a third renumbering would churn links across
ADRs and specs for no gain.

### 2. One route per leg; the timeline is never stored

An itinerary is an ordered list of stops. Each stop references a waypoint, and
the leg arriving at it references a route, both by plain id with no foreign
key. A deleted waypoint or route then shows as missing, and undoing the
deletion heals the link because the id comes back.

Only the inputs are stored. Arrival and departure times are computed on every
read by a pure function, from the start date, the durations, the fixed times
and the legs' distances. A day-stay is measured in calendar days and leaves at
a wall-clock time, so a stay across a clock change leaves at the right hour.
Leg times use the per-mode averages in `shared/routing/travelTime.ts`. Saved
routes carry no engine time (ADR 0011 §8), so there is no engine estimate to
prefer.

### 3. Time zones from a polygon table, not Valhalla's database

The UK polygon already in `shared/geo/ukBoundary.ts` resolves to
`Europe/London`. Anywhere else resolves to *unknown*, and that stop's times are
shown in the computer's zone with a label saying so. Valhalla's
`timezones.sqlite` was rejected: building it downloads a boundary release of
about 60 MB, which is a network dependency for an answer that is one polygon
for every region the app currently offers.

### 4. POIs, places and streets come from the region build

The routing graph keeps roads only, and the region pipeline deletes its
extracts. So POIs, place names, street names and addressed buildings are
captured during the build, before the deletion, with the `osmium` already
bundled for merging (`tags-filter`, then `export`). For the three Buxton
counties this adds about 7 s and about 43 MB, against a 141 MB graph. The
result is `places.sqlite`, beside the tiles and replaced with them, so it
always describes the same data as the graph. Regions built before this phase
are flagged and offered a rebuild, never shown as having no POIs.

### 5. Postcodes from Code-Point Open, fetched on request

Ordnance Survey's Code-Point Open (Open Government Licence v3.0) is the
postcode source: 1.75 M Great Britain postcodes, 14.5 MB zipped, no API key,
32.6 MB once stored. It is fetched with one press from Settings, not bundled,
so installers stay small and a new release needs no app release. The download
redirects from `api.os.uk` to an Azure blob host. The client allows exactly
that one origin pair, and checks the MD5 the OS listing publishes. Eastings
and northings are converted to WGS84 with an OS-parameter Helmert transform
(about 5 m), which is ample for a point that stands for an area.

Northern Ireland, the Isle of Man and the Channel Islands are not covered, and
the UI says so. House numbers resolve only where OpenStreetMap maps the
building; nothing is interpolated.

### 6. No online source, for search or for POIs

No geocoder and no Overpass. Search was asked to be offline. POIs follow the
same reasoning: an online path would add consent, a usage policy and a
network dependency to cover only routes outside the loaded regions. Those
stretches are reported as not covered instead.

### 7. In-house calendar, iCalendar writer and opening-hours parser

No new npm dependency. The calendar is a drawer below the map, in the slot the
profile uses, so the map stays visible while it is open. The iCalendar writer
is a few hundred lines of RFC 5545. The opening-hours parser handles the
common subset and shows anything else raw, instead of guessing.

## Consequences

- Trips with no itinerary are unchanged, and that is enforced by regression
  tests on the tree, the properties panel and GPX export.
- Place search covers only the loaded regions; postcode search covers all of
  Great Britain. Both work with no network.
- `places.sqlite` is an ODbL Derivative Database used on the user's own
  machine. Share-alike applies only on public distribution, which happens only
  for the small committed fixture, and that fixture is published under ODbL.
- A second country needs a row in the time-zone table, its regions, and a
  postcode source. Nothing in trip management changes.

## Amendment, 11 November 2026: legs are planned automatically

After using the first build, the owner asked for stops to be joined by road
automatically, unless a leg is marked "don't link" for other transport.

- Each leg has a mode: **by road** (planned automatically), **a chosen
  route**, or **other transport** with an optional travel time.
- Adding, removing or reordering stops, or moving a stop's place, plans every
  by-road leg that needs it. The change and the planning are **one** undo
  step.
- Routes the system planned carry a marker, and only those are ever replaced
  when they stop fitting. A route the user drew, imported or chose is never
  modified or deleted by planning. This keeps §2's rule that the itinerary
  never edits the user's own geometry.
- With no routing available the leg stays unplanned and says why. A straight
  line is never drawn in its place.

The same feedback added a summary of a dated trip to the library tree, a
resizable and hideable bottom panel, and icon buttons from `lucide-react`
(ISC). Those are recorded in the Phase 10 design §15 and need no decision
here.
