# Phase 4: Advanced Mapping — Tasks

Execute in order. The pure, offline-testable work comes first so that the
provider integration lands on top of maths and storage that are already proven.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Shared contracts
  - `shared/routing/RoutingProvider.ts`: `RoutingProvider`, `TransportMode`,
    `RouteLeg`, `SnapResult`, `MatchedEdge`, `RoadClass`, `SurfaceKind`
  - `shared/map/MapProvider.ts`: overlay registry, `custom` provider,
    OpenTopoMap entry with its CC-BY-SA attribution
  - Domain types for profiles and speed distribution
  - Unit tests: registry lookup, host collection, overlay independence
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.7_

- [x] 2. Pure geometry: bearing, profile, speed bands
  - `shared/geo/bearing.ts`: initial bearing, turn angle, normalisation.
    The first angle maths in the project
  - `shared/geo/profile.ts`: cumulative distance, elevation band, band
    resampling for a large track
  - `shared/geo/speedBands.ts`: distance-weighted distribution with an explicit
    Unknown band, metric and imperial band sets
  - Unit tests: bearing against known pairs, antimeridian, distribution sums to
    100%, Unknown never redistributed, point-count vs distance weighting
    produce different answers on uneven spacing
  - _Requirements: 5.1, 5.2, 6.4, 6.5, 6.7_

- [x] 3. Map provider registry and dynamic CSP
  - OpenTopoMap and `custom` wired into the registry
  - `buildCsp()` takes the configured routing origin; origin validated as
    https, or http only for loopback
  - Layer selector lists providers and overlays, persists the choice
  - Unit tests: CSP contains the configured origin and nothing else; a
    non-loopback http origin is refused; wildcard never emitted
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 8.1, 12.2_

- [x] 4. Migration 0002 and repositories
  - `routes` + `routing_provider`, `transport_mode`, `snapped_at`
  - `route_control_points` table, dense `(route_id, seq)`
  - `road_attributes` table with `geometry_hash` and JSON payload
  - Repository functions, and `geometryHash()` over rounded coordinates
  - Unit tests: migration applies to a Phase 3 database; control points
    round-trip; a geometry change changes the hash
  - _Requirements: 2.4, 6.2, 6.3_

- [x] 5. Routing client and Valhalla adapter
  - `main/routing/polyline.ts`: polyline6 decode
  - `main/routing/client.ts`: POST with timeout and abort, error mapping to
    `ServiceError`
  - `main/routing/valhalla.ts`: `/route` and `/trace_attributes`, explicit
    `units: kilometers`, SI conversion at the boundary, explicit attribute
    filter list
  - Fixtures in `test-data/routing/`, hand-authored from the API reference
  - Unit tests: polyline6 decodes to the documented coordinates and precision 5
    is visibly wrong; km→m and km/h→m/s conversion; absent `speed_limit` stays
    null; a loopback server covers timeout, 500 and malformed JSON
  - _Requirements: 2.2, 2.6, 2.7, 6.1_

- [x] 6. Routing service: snap a route
  - Snap on create and as a separate action on an existing route
  - Control points retained; snapped shape written to `route_points`
  - Unmatched legs kept straight and recorded
  - `MAX_SNAPPED_POINTS` enforced before any write; refusal names the count
  - Undo carries the previous array under 10,000 points, otherwise reports
    `kind: 'none'` and says why
  - Unit tests: control points preserved, unmatched legs marked, statistics
    recomputed, point cap refused cleanly, undo both ways
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.8_

- [x] 7. Road attributes service
  - Map match a route or track, store the cache keyed by geometry hash
  - **Tracks are never modified** — matching reads attributes only
  - Speed distribution assembled from the cache
  - Unit tests: cache hit avoids a second call, geometry edit invalidates,
    track geometry unchanged after matching, Unknown band sized honestly
  - _Requirements: 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.12_

- [x] 8. Settings and consent
  - `routingEndpoint`, `routingConsentAccepted`, `transportMode`,
    `mapOverlayId`, `customTileUrl`, `showScaleBar`, `layerVisibility`
  - Consent names the host and states what is transmitted; every outbound call
    is gated on it
  - Unit tests: a call without consent is refused; an invalid endpoint is
    rejected at the schema
  - _Requirements: 2.5, 3.9, 12.1, 12.5, 12.6_

- [x] 9. IPC and preload wiring
  - Channels for snap, match, profile, distribution, provider status
  - Zod schemas for every payload; results never throw across the boundary
  - _Requirements: 2.2, 12.1_

- [x] 10. Map controls
  - Scale bar, cursor coordinates in configured units
  - Visibility toggles for routes, tracks and waypoints
  - Keyboard navigation of the map
  - Unit and e2e tests for the toggles and the scale bar
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 11. Measure tool
  - A distinct editor mode; creates nothing and has no undo entry
  - Running total and segment distances in configured units
  - _Requirements: 4.5_

- [x] 12. Snap-to-road UI
  - Snap mode in the draw flow, visually distinct from straight-line drawing
  - Snap action on an existing route with a point-count preview
  - Unmatched legs drawn dashed and explained
  - Transport mode selector
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 3.8, 9_

- [x] 13. Profile panel
  - Hand-written SVG; elevation, speed and road-class bands
  - Hover syncs to the map and back
  - A band with no data is omitted with a stated reason
  - Simplified for a large track, and says so
  - Export the profile as an image
  - _Requirements: 5.1–5.10_

- [x] 14. Speed distribution UI
  - Percentage of distance per band, Unknown included and never hidden
  - Source labelled: posted limit or recorded
  - Provider and fetch date shown; stale cache shown with its age
  - _Requirements: 6.1, 6.4, 6.5, 6.7, 6.8, 6.9, 6.11, 8.4_

- [x] 15. Waze hand-off
  - Waypoint, and route or track resolving to its end point
  - Label states "end point"; no multi-waypoint action exists
  - `shell.openExternal` after validation
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 16. Phase 4 verification pass
  - `npm run verify` green; e2e green against the packaged build
  - Walk the acceptance criteria: a second provider needs only a registry and
    CSP entry; straight-line drawing is unchanged with no provider configured;
    the Unknown band is visible; no wildcard in the CSP
  - Record in the README that the Valhalla adapter is verified against the
    published reference and synthetic fixtures, **not** against a live instance
  - Update the mindmap to show Phase 4 complete
  - _Requirements: all_

## Added after the verification pass

- [x] 17. Interactive snap routing tool
  - A distinct editor mode: each click is a **control point**, and the leg from
    the previous one is routed immediately so the road-following line appears
    as the user builds it
  - One provider call per click (`routing:routeLeg`), not a re-snap of the
    whole line, so the tenth click costs what the first did
  - Legs are routed strictly in order with a generation guard, because replies
    can arrive late or out of order and `legs` must stay index-aligned with the
    gaps between control points
  - Saves the **previewed** geometry (`routing:createSnapped`), not a re-route:
    the user accepted a specific line and must get it
  - Bounded by `MAX_UNDOABLE_POINTS` rather than `MAX_SNAPPED_POINTS`, so a
    route built with the tool stays editable through `route:setGeometry`
  - Three visually distinct leg states: routed, unmatched (dashed red, matching
    a whole-route snap), and pending
  - Toolbar control is **disabled with the reason** when no provider is
    available, never silently inert
  - Unit tests: one call per leg, unmatched reported not thrown, previewed
    geometry saved verbatim, leg/point mismatch refused with nothing written,
    point cap refused with the count, undo removes the control points too
  - E2E: the tool is present but disabled with no provider; `routeLeg` refuses
    with `PROVIDER_UNAVAILABLE`; a leg/point mismatch is refused at the schema
  - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.8, 9_

- [x] 18. Embed the routing engine
  - Build Valhalla 3.9.1 from source with `ENABLE_NODE_BINDINGS=ON` and
    `ENABLE_SERVICES=OFF`: the N-API bindings wrap `tyr::actor_t`, which takes
    the same JSON as the HTTP API, so there is no daemon, port or supervisor
  - `scripts/build-valhalla.sh`, `scripts/bundle-valhalla.sh`,
    `scripts/verify-valhalla.mjs`, `npm run build:valhalla`,
    `npm run verify:valhalla`
  - Relocatable bundle: 113 dylibs rewritten to `@rpath` with
    `@loader_path`-relative rpaths, ad-hoc re-signed
  - Adapter refactored so the embedded and HTTP providers share every line of
    request construction and response translation — only the transport differs
  - arm64 only; `minimumSystemVersion` raised to 13.3 for `std::to_chars`
  - Licence audit of the native tree, including the libspatialite /
    readosm tri-licence election to LGPL-2.1-or-later
  - Verification: the bundler relocates a copy and loads it in Electron,
    because a path audit passed on a bundle that could not load
  - _Requirements: 2.1, 2.2, 2.6, 3.1, 6.1; ADR 0013_

- [x] 19. Wire the UI to the embedded engine
  - `LocalValhallaProvider` (`main/routing/embedded.ts`), preferred when no
    endpoint is configured — needs no endpoint and **no consent**, because
    nothing leaves the machine, and contributes no CSP origin
  - An explicitly configured remote endpoint still wins: a deliberate choice is
    respected rather than overruled
  - Map region import: `routing:importRegion` spawns `valhalla_build_tiles`
    into a staging directory and swaps it in only on success, so a failed or
    cancelled build cannot leave a half-written graph that reports as usable
  - Region metadata stored beside the graph, not in settings, so deleting the
    graph takes its label with it
  - Three distinguishable unavailable states — `no-engine` (broken build),
    `no-map-data` (user action), `consent-required` (remote only) — each with
    the action that actually resolves it
  - Unit tests: presence checks, config generation, region round-trip,
    embedded-vs-remote preference, consent still enforced for remote
  - E2E against the real engine and a real graph: status available with no
    endpoint or consent, a leg routed in-process, a drawn route snapped with
    control points kept, posted speed limits off the local graph, the toolbar
    tool enabled, the properties panel naming the engine
  - _Requirements: 3.1, 3.2, 3.3, 6.1, 6.4, 12.1; ADR 0013_

- [x] 20. Region download from the visible map area
  - `shared/geo/polygon.ts`: pure point-in-polygon, bounding-box area and
    containment — planar on purpose, since these are coarse administrative
    outlines and the question is "which country am I looking at"
  - `main/routing/geofabrik.ts`: parses Geofabrik's `index-v1.json` (554
    regions, nested three deep, polygon boundaries plus a direct `.pbf` URL)
    and ranks candidates for a viewport
  - **Ranked by the viewport centre, not by full coverage.** The obvious rule
    is wrong and measurably so: zoomed to Vaduz the viewport corners cross
    Liechtenstein's border, so the smallest fully-containing region becomes
    the 2.3 GB Alps bundle. `coversViewport` is reported per candidate instead,
    so the UI can offer the choice for a view spanning a border
  - Real download sizes via HEAD through the `-latest.osm.pbf` → dated-file
    redirect, followed only within the same origin
  - Oversized candidates marked unselectable up front rather than refused at
    the end of a multi-gigabyte download
  - Index cached on disk with a week's TTL, and used even when stale if the
    network fails — a week-old index beats no picker
  - Extract deleted after the graph is built; it is the raw input and several
    times the size of what it produces
  - Geofabrik chosen over an Overpass bounding box because a highway-only
    Overpass extract loses the relations that encode turn restrictions, so the
    graph would route the wrong way down no-entry streets with nothing to
    indicate why
  - Unit tests on synthetic geometry reproducing the border-spanning and
    spill-over cases; `npm run verify:geofabrik` checks the real index still
    parses and still ranks as assumed
  - _Requirements: 3.1, 6.1, 8.1; ADR 0013_
