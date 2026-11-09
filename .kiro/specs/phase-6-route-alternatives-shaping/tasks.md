# Phase 6: Route alternatives and shaping — Tasks

Execute in order. The pure, offline-testable work comes first: contracts,
geometry, splicing and the edit planner are all proven before anything talks to
an engine or the map.

Update `docs/progress-mindmap.svg` as each task changes status.

- [x] 1. Shared contracts
  - `shared/routing/RoutingProvider.ts`: `ControlRole`, `SectionLocation`,
    `RouteCandidate`, optional `alternatives` and `snapSection`
  - `shared/routing/results.ts`: `Candidate` (`PreviewedLeg` +
    `estimatedDurationS`), `RoutingStatus.capabilities`
  - `providerCapabilities(provider)` derives capabilities from method presence
  - Unit tests: a provider with only `snap`/`match` reports no capabilities and
    still type-checks as a `RoutingProvider`
  - _Requirements: 10.1_

- [x] 2. Pure geometry: divergence and reversal
  - `shared/geo/divergence.ts`: `farthestFrom` (segment midpoint, not vertex),
    `overlap` with tolerance, named constants for 0.98 / 25 m / 3
  - `shared/geo/reversal.ts`: `reversalAt(shape, index, windowM)`
  - Unit tests: identical lines overlap 1.0; disjoint 0; a parallel line at
    20 m is inside a 25 m tolerance and at 30 m outside; a midpoint is returned,
    not a junction vertex; an out-and-back spur is a reversal and a 90° turn is
    not
  - _Requirements: 3.2, 4.7, 10.3_

- [x] 3. Leg boundaries and splicing
  - `flattenLegsWithBoundaries` replaces `flattenLegs`; existing callers
    migrated
  - `shared/routing/splice.ts`: `spliceLegs`, plus `checkBoundaries` for the
    §2 invariant
  - Unit tests: untouched slices are exactly equal (not approximately) after
    a splice at the start, middle and end; seams de-duplicate at 1e-6 and keep
    a genuine step; a splice to zero legs at either end; property test over
    random leg sets that flatten→splice→flatten agrees with flattening the
    replaced set directly
  - _Requirements: 2.3, 5.1, 8.6_

- [x] 4. Edit planner
  - `shared/routing/edit.ts`: `RouteEdit`, `EditPlan`, `planEdit`, index
    `remap` for `unmatchedLegs` and `displacedControlPoints`
  - Refusals: fewer than two points; start/end as shaping
  - Unit tests: one case per row of the design §3 table; `insertOnLine` and
    `setRole` route nothing and change no geometry; remove next to shaping
    points keeps their `passThrough`; remap after insert and after remove
  - _Requirements: 4.1, 4.5, 5.1, 6.1, 6.2, 6.3, 6.4, 8.6_

- [x] 5. Migration 0003 and repositories
  - `route_control_points` + `role` (default `via`) + nullable `shape_index`,
    via `npm run db:generate`
  - Repository read/write of role and boundaries;
    `replaceControlPoints` takes them
  - `snapRoute`, `createSnappedRoute`, `restoreSnap` write boundaries
  - Unit tests: migration applies to a Phase 5 database and existing rows read
    as `via` / null; boundaries written by every path satisfy
    `checkBoundaries`; undoing a snap restores the boundaries too
  - _Requirements: 7.3, 8.8_

- [x] 6. Valhalla adapter: alternatives and sections
  - `alternatives`: `alternates: min(count-1, 2)`, parse `alternates[].trip`,
    displacement per candidate, retry once with `alternates: 0` on a
    host-limit error
  - `snapSection`: one N-location `/route`, `break_through` for pass-through,
    per-leg `snap` fallback on `PROVIDER_ERROR`, transport errors propagate
  - Synthetic responses hand-authored from the API reference, served by the
    adapter tests' existing loopback server: 0, 1 and 2 alternates; a
    3-location `break_through` response
  - Unit tests: candidate order and units; a displaced alternate is dropped;
    no alternates means one candidate, never a fabricated one; the
    `break_through` type is sent for pass-through only; fallback runs on
    `PROVIDER_ERROR` and not on timeout
  - _Requirements: 1.7, 1.9, 4.7, 10.2, 10.3, 11.1_

- [x] 7. Routing service, IPC and undo
  - `routingService`: `routeSection`, `alternatives`, `applyEdit` (re-plan
    from the database, refuse on `expected` mismatch, splice, `replacePoints`,
    stats, metadata remap, one transaction)
  - Legacy route (null boundaries): whole-route snap first, reported
  - `route:spliceLegs` command, its symmetric inverse, `'route shaping'` label;
    `none` inverse when the replaced slice exceeds `MAX_UNDOABLE_POINTS`
  - `snapRoute` groups via-to-via runs and uses `snapSection` for runs with
    shaping points (design §10)
  - IPC channels `routing:routeSection`, `routing:alternatives`,
    `routing:applyEdit` behind the consent gate; zod schemas; preload
  - Unit tests: undo then redo of every edit kind round-trips exactly; an
    edit to a 20,000-point route whose replaced slice is 300 points is
    undoable; a result over `MAX_SNAPPED_POINTS` writes nothing; stale
    `expected` writes nothing; a provider failure leaves the route
    byte-identical; the road-attribute cache reads as stale after an edit;
    whole-route re-snap keeps shaping points
  - _Requirements: 2.3, 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 9.3, 10.4, 11.1_

- [x] 8. Making a chosen alternative stick
  - The design §7 verifier: initial shaping point, up to three refinements,
    unverified outcome reported, stored geometry = candidate split at the
    shaping points
  - Unit tests against a fake provider: a provider that honours shaping
    verifies in one pass; one that needs two points gets two; one that never
    converges stops at the bound and reports; the stored geometry equals the
    candidate with only on-line vertices added
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.1_

- [x] 9. Shaping a saved route on the map
  - `useRouteShaping`: 16 px hit area, click vs drag at 4 px, Leaflet click
    suppressed after a drag, Escape cancels, in-flight lock with a progress
    cursor
  - `DragPreview`: one in flight, latest position wins; straight-line preview
    on a remote provider
  - Snapped-route line click no longer reaches `insertRouteVertex` (fixes the
    investigation defect); hand-drawn routes unchanged
  - `shapingIcon()`, numbered via handles, reversal warning ring; Alt-click
    remove; handle and line context menus
  - Unit tests: the click/drag state machine and the `DragPreview`
    latest-wins logic, both extracted as pure functions
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 9.1, 9.2_

- [x] 10. Candidates on the map
  - `useCandidateLayers`: selected/other styles, 16 px hit areas, divergence
    labels with "(est.)"
  - Candidate list beside the snap-route readout; `1`/`2`/`3`; hover linking
  - *Show alternatives for this section* on a saved route's leg, current leg
    drawn dashed, choose applies `choose`, Escape dismisses without writing
  - Unit tests: label figures and deltas from fixture candidates; the command
    is absent for hand-drawn routes and unmatched legs
  - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.4, 2.5_

- [x] 11. The snap routing tool
  - `snapRoutingStore`: `roles`, sparse `legs`, `candidates`, bounded
    `history`; `nextGap` returns the first null
  - `drainSnapLegs` requests candidates for the last leg when the setting and
    capability allow
  - Placed points draggable through `useRouteShaping`; ⌘Z pops history;
    Backspace unchanged
  - `settings.routeAlternatives` (default on) and its Settings toggle,
    disabled with the reason when unsupported
  - Unit tests: a middle move nulls exactly two legs and the drain re-routes
    them in order; a stale generation is still dropped; ⌘Z restores each edit
    kind; with the setting off the store behaves as Phase 4
  - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8, 1.10, 5.4, 8.7, 9.1_

- [x] 12. Extend a saved route
  - `extendRoute` editor mode from the end handle's context menu; each click
    is an `append` applied at once; candidates shown for the new leg;
    Enter/Escape leave
  - Unit tests: three clicks are three undo entries; choosing a candidate
    after a click is a fourth
  - _Requirements: 6.5_

- [x] 13. TrailRT JSON carries control points
  - Optional `control` and `routing` per route; no `COLLECTION_VERSION` bump,
    per the format's rule that additive fields do not need one; import
    checks the boundary invariant and falls back to hand-drawn with a report
    entry
  - Unit tests: a shaped route round-trips with roles and boundaries; a
    pre-Phase 6 file imports unchanged; a file with mismatched boundaries
    imports as hand-drawn and is reported, not rejected; GPX export of a shaped
    route is byte-identical to the same shape exported in Phase 5
  - _Requirements: 7.4, 7.5_

- [x] 14. Live tests and the latency measurement
  - Opt-in live test on the embedded engine, `npm run verify:shaping`
    (`src/main/routing/shaping.live.test.ts`)
  - Measure median drag-preview latency for legs up to 50 km; record the
    result and the machine in this file; revisit the §7 constants if the live
    data disagrees with them
  - **Geography changed from the plan.** The spec named Buxton → Macclesfield,
    but the graph loaded here is the Geofabrik `derbyshire` extract and
    Macclesfield is in Cheshire, where the engine drags the end 3 km to the
    county boundary (ADR 0016). The test uses Buxton → Ashbourne, the square's
    eastern leg, and takes `TRAILRT_LIVE_PAIR=macclesfield` for a graph that
    covers Cheshire.
  - **Recorded 2026-11-08, Apple M4, Valhalla 3.9.1 in-process, Derbyshire
    graph:**
    - Buxton → Ashbourne offered 3 candidates: 34.6 km / 30 min, 49.0 km /
      41 min, 46.4 km / 40 min (estimates).
    - Choosing candidate B needed **2** shaping points; re-routing through
      them reproduced it with overlap **1.000**. The §7 constants (0.98,
      25 m, at most 3 pins) held without change.
    - A shaping point on the A515 routed with no reversal.
    - Drag preview, 20 pointer positions over a 32 km leg: **median 4 ms**,
      max 4 ms, against the 300 ms target. Live road-following while dragging
      is comfortably affordable on the embedded engine.
  - _Requirements: 9.4, 11.2_

- [x] 15. End-to-end and verification pass
  - Playwright (`tests/e2e/shaping.spec.ts`): place two points, see more than
    one candidate, choose the second, drag the line, save, undo; restart and
    confirm shaping points persist
  - `npm run verify` against the packaged build; update
    `docs/progress-mindmap.svg`, `README.md` and `.kiro/specs/README.md`
  - **Recorded 2026-11-08:** `npm run verify` passed (1,123 unit tests, 119
    end-to-end); the full end-to-end suite also passed against the packaged
    `TrailRT.app` (`TRAILRT_E2E_APP`), 119 of 119.
  - The end-to-end test found a defect the unit tests could not: the map
    renders paths on canvas, and a canvas renderer's full-map canvas in a
    custom pane swallows every click beneath it once it has held a path. The
    candidate pane, empty after a choice, blocked the next drag. Fixed by
    giving the shaping and candidate panes SVG renderers with pointer events
    off on the pane (`features/map/interactivePane.ts`); see design §4.
  - _Requirements: 11.3_
