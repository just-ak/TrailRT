# Phase 6: Route alternatives and shaping — Requirements

Status: **complete.** All 15 tasks done and verified, including against the packaged app.

When a route is made between two places, show the routes the engine can offer
between them and let the user pick one. Then let them shape it directly on the
map: drag the line to pull it onto a different road, drag the points they placed,
and click to add or remove points.

Inserted ahead of windy-roads routing, which moves to Phase 7, and Garmin
compatibility, which moves to Phase 8. See ADR 0017. The ordering is
deliberate. Windy-roads routing produces routes that a user will want to compare
with the conventional one and then adjust. Building the comparison and the
shaping first means Phase 7 adds a cost model to an editing surface that already
exists, instead of building both at once.

## Terms

| Term | Meaning |
| --- | --- |
| **Control point** | A point the user placed. A snapped route's geometry is computed from its control points. Stored in `route_control_points`. |
| **Via point** | A control point the route is meant to *visit*: the start, the end, and every point clicked in the snap routing tool. Shown as a numbered handle. |
| **Shaping point** | A control point that only *bends* the route onto a road. Created by dragging the line or by choosing an alternative. Shown as a small unnumbered handle. |
| **Leg** | The geometry between two adjacent control points. |
| **Candidate** | One of the routes the engine offers for a single leg. Candidate 1 is the engine's preferred route. The others are its alternatives. |

## Context the investigation established

A codebase assessment was run before writing these requirements, against
Phase 4's routing as it actually shipped. Eight findings shape what follows.

**There are no alternatives anywhere.** `RoutingProvider` has two methods,
`snap` and `match`. Each leg asks for exactly one route and gets one.

**Valhalla can offer alternatives, but only between two locations.** The
`/route` request takes an `alternates` count, and the bundled
`config.template.json` sets `service_limits.max_alternates` to 2. That gives at
most three candidates. Valhalla does not return alternatives for a request with
more than two locations. That limit happens to fit Phase 4's design: every leg is
already its own two-location `/route` call (see the comment in
`valhalla.ts`), so alternatives can be offered **per leg** without changing how
routing is done.

**Clicking the line of a selected snapped route corrupts it.** The click handler
in `useRouteLayers` calls `insertRouteVertex`, which inserts a raw vertex into
the *derived* road geometry through `route:setGeometry`. The control points
are left unchanged, so the stored shape no longer matches the points it is
supposed to be derived from. The next re-snap silently throws the inserted
vertex away. This is a live defect and this phase fixes it.

**Dragging one control point re-snaps the whole route.** `moveControlPoint`
calls `snapRoute` with the full control-point list. On a twenty-point route,
that is nineteen provider calls for one moved point. The undo inverse is then
the whole previous geometry, so the drag cannot be undone on any route above
`MAX_UNDOABLE_POINTS`. Phase 4 Requirement 3.3 retained control points "so a
later edit of a control point can re-snap only the affected legs". That storage
was built, but re-snapping only the affected legs was not.

**Leg boundaries are not stored.** `route_points` is one flat sequence, and
`route_control_points` holds only `seq`, `lat` and `lon`. Nothing records where
leg *i* starts in the shape, so there is no way to replace one leg's geometry
without re-routing everything. `flattenLegs` also de-duplicates the shared
vertex at each join, so a boundary cannot be recovered after the fact by
counting.

**Every point is a full stop.** Each leg is routed independently, so the
engine treats each control point as a destination. A point placed beside the
road, or on the far side of a dual carriageway, can produce a route that
arrives, turns round and leaves. That makes a short out-and-back spur, which is
the most common way a drag-to-shape tool goes wrong. Valhalla's `break_through`
location type keeps the leg split but forbids a U-turn at that location.

**The snap routing tool's points are not editable.** `useSnapRouting` draws
placed points with `interactive: false`. The tool's only edit is Backspace,
which removes the last point.

**The TrailRT JSON format drops control points.** `io/json/write.ts` writes a
route's shape and nothing from `route_control_points`. A snapped route that is
exported and re-imported comes back as a hand-drawn route with thousands of
vertex handles. Backup is not affected, because it copies the whole database
through SQLite's backup API. Once routes carry shaping, losing them on the one
path meant for moving between installs is a larger loss, so this phase closes
the gap.

## User stories

- As a rider planning a day out, I want to see the routes available between
  two towns and choose one, so I am not limited to the engine's first answer.
- As a user, I want to drag the line onto the road I actually want, so I don't
  have to work out where to click to force that road.
- As a user, I want to move, add and remove the points of a route I have
  already saved, without the rest of the route changing under me.
- As a user, I want to undo any of those edits with ⌘Z, exactly as for any
  other edit.

## Requirements

### Requirement 1: Candidates while drawing

#### Acceptance criteria

1. WHEN the snap routing tool routes the leg to the most recently placed point
   THE system SHALL request up to three candidates for that leg and SHALL draw
   every candidate returned at the same time.
2. THE first candidate SHALL be the engine's preferred route and SHALL be
   selected by default.
3. THE system SHALL show for each candidate:
   - its distance
   - its duration, labelled as an estimate per ADR 0011 §8
   - its difference in distance and estimated duration from candidate 1
4. THE user SHALL be able to select a candidate in three ways: by clicking its
   line, by choosing it in a candidate list, or by pressing `1`, `2` or `3`.
   Hovering over a candidate in either place SHALL highlight it in the other.
5. THE selected candidate SHALL be drawn as the route, and the others SHALL be
   drawn in a style that cannot be mistaken for it.
6. Placing the next point, or finishing the route, SHALL accept the selected
   candidate for that leg. The candidates for a leg SHALL then be dismissed.
7. WHEN the engine returns fewer than three candidates THE system SHALL show
   those it returned. WHEN it returns only one, THE system SHALL say that no
   alternative was found. THE system SHALL NOT fabricate an alternative.
8. Candidates SHALL be requested only for a leg that matched a road. An
   unmatched leg SHALL stay the straight line Phase 4 Requirement 3.6
   specifies, with no candidates.
9. THE displacement check of ADR 0016 SHALL apply to every candidate, not only
   the first.
10. THE system SHALL provide a setting that turns automatic candidates off. It
    SHALL be on by default. With it off, the tool behaves exactly as in Phase 4.

### Requirement 2: Candidates for a leg of a saved route

#### Acceptance criteria

1. WHEN a snapped route is selected THE system SHALL offer, from the context
   menu of any matched leg, a command to show alternatives for that section of
   the route.
2. THE candidates SHALL be presented as in Requirement 1.3–1.5. The leg's
   current geometry SHALL be shown alongside them so the user can see what
   would change.
3. Choosing a candidate SHALL replace that leg's geometry only. The geometry of
   every other leg SHALL remain identical, point for point.
4. Choosing a candidate SHALL be one undo entry. Dismissing the candidates
   SHALL change nothing.
5. THE command SHALL NOT be offered for a hand-drawn route or for an unmatched
   leg.

### Requirement 3: A chosen alternative survives re-routing

The engine does not remember which alternative was chosen. If a leg is
re-routed later, for example because the user dragged one of its ends, the
engine would return its preferred route again and silently undo the choice.

#### Acceptance criteria

1. WHEN the user chooses a candidate other than candidate 1 THE system SHALL
   insert shaping points on that candidate so that re-routing the leg reproduces
   the chosen roads.
2. THE system SHALL verify this by re-routing through the inserted shaping
   points. WHEN the result diverges from the chosen candidate by more than a
   stated tolerance THE system SHALL insert further shaping points, up to a
   stated bound.
3. WHEN the bound is reached without a match THE system SHALL still keep the
   chosen geometry, and SHALL tell the user that a later re-route of that
   section may not reproduce it.
4. THE saved geometry SHALL be the candidate exactly as the user saw it, not the
   result of the verification re-route. This follows Phase 4's rule that what
   the user accepted is what is stored (see `PreviewedLeg`).

### Requirement 4: Drag the line to shape it

#### Acceptance criteria

1. WHEN the user presses on a leg of the selected snapped route, or of the
   snap routing tool's preview, and drags, THE system SHALL create a shaping
   point at the pointer and SHALL route that leg as two legs through it.
2. WHILE dragging, THE system SHALL show a preview that follows the pointer:
   - With the embedded engine, the preview SHALL be road-following. At most one
     request SHALL be in flight at a time, and only the reply for the latest
     pointer position SHALL be drawn.
   - With a remote provider, the preview MAY be straight lines from the
     neighbouring control points, with road routing on release.
3. Releasing SHALL commit the shaping point and the re-routed legs as one edit,
   which is one undo entry on a saved route.
4. Pressing Escape during a drag SHALL cancel it and leave the route exactly as
   it was.
5. A click without a drag on the selected snapped route's line SHALL insert a
   shaping point at the nearest position on the line. It SHALL NOT change the
   route's geometry. This replaces the current behaviour described in the
   investigation, which inserts a raw vertex.
6. A click and a drag SHALL be told apart by pointer movement, so a click is
   never mistaken for a tiny drag and a drag never starts by accident.
7. THE route SHALL NOT turn round at a shaping point wherever a through path
   exists. A shaping point SHALL bend the route, not create an out-and-back
   spur.

### Requirement 5: Drag control points

#### Acceptance criteria

1. Dragging a via or shaping point SHALL re-route only the legs that touch it:
   one leg for the start or end, two otherwise. Every other leg SHALL remain
   identical, point for point.
2. WHILE dragging, THE preview SHALL behave as in Requirement 4.2.
3. Releasing SHALL be one undo entry on a saved route.
4. Points placed in the snap routing tool SHALL be draggable before the route is
   saved, with the same behaviour.

### Requirement 6: Add, remove and convert points

#### Acceptance criteria

1. THE user SHALL be able to remove a control point by Alt-clicking it or from
   its context menu. The two legs it joined SHALL be merged and re-routed as one
   leg.
2. Removing the start or end point SHALL be allowed while at least three
   control points remain. The route SHALL then start or end at the neighbouring
   point, and the leg that led to the removed point SHALL be dropped without
   any re-routing.
3. THE system SHALL refuse to remove a point that would leave fewer than two,
   and SHALL say why.
4. THE user SHALL be able to convert a shaping point to a via point, and back,
   from its context menu. Conversion SHALL NOT change the geometry. The start
   and end SHALL always be via points.
5. THE context menu of a saved snapped route's end point SHALL offer to extend
   the route. While extending, each map click SHALL append a via point and route
   a new leg, with candidates as in Requirement 1. Each click SHALL be one undo
   entry. Enter or Escape SHALL stop extending.

### Requirement 7: Via and shaping points are distinct

#### Acceptance criteria

1. Via points SHALL be drawn as numbered handles. Start and end SHALL keep the
   endpoint badges they have today.
2. Shaping points SHALL be drawn as smaller, unnumbered handles that cannot be
   mistaken for via points.
3. A control point's role SHALL be stored with the route. It SHALL survive
   restart, undo and backup.
4. THE TrailRT JSON collection format SHALL carry a snapped route's control
   points, roles and leg boundaries, so a route moved between installs stays
   editable. Files written before this phase, which have none, SHALL still
   import, as hand-drawn routes as today. A file whose control points do not
   fit its shape SHALL import the route as hand-drawn and say so. It SHALL NOT
   be rejected.
5. GPX, KML and other exports SHALL be unchanged in this phase: a route
   exports its full shape as today. Storing the role now lets the Garmin phase
   export shaping points without a migration.

### Requirement 8: Undo, integrity and limits

#### Acceptance criteria

1. Every committed edit to a saved snapped route SHALL be exactly one undo
   entry. Undo SHALL restore the control points, their roles and the geometry
   exactly.
2. THE undo inverse SHALL carry only the legs the edit replaced, not the whole
   route. An edit to a route above `MAX_UNDOABLE_POINTS` SHALL therefore still
   be undoable when the replaced section is within that bound. WHEN it is not,
   the edit SHALL declare itself non-undoable and say so, following
   `trackService.restoreOriginal`.
3. An edit that would take a route past `MAX_SNAPPED_POINTS` SHALL be refused
   with the count, and nothing SHALL be written.
4. Route statistics SHALL be recomputed from the stored geometry after every
   edit and SHALL NOT be taken from a provider response.
5. Cached road attributes SHALL be invalidated by any geometry change, through
   the existing geometry-hash mechanism.
6. The unmatched-leg and displaced-point records (`unmatchedLegs`,
   `displacedControlPoints`) SHALL stay correct after points are inserted or
   removed. Their indices refer to control points and have to move with them.
7. Within the snap routing tool, before the route is saved, ⌘Z SHALL undo the
   last edit of any kind: placing, dragging, inserting or removing a point, or
   choosing a candidate. Backspace SHALL keep its Phase 4 meaning of removing
   the last point.
8. Routes snapped before this phase have no stored leg boundaries and SHALL
   still be editable. The first edit MAY re-route the whole route once to
   establish the boundaries, and SHALL say that it is doing so.

### Requirement 9: Responsiveness and failure

#### Acceptance criteria

1. A reply that belongs to a superseded gesture or preview SHALL never be
   applied. This extends the `generation` rule in `snapRoutingStore`.
2. While an edit to a saved route is being routed, THE system SHALL show that
   it is routing and SHALL NOT accept a second edit to the same route until the
   first is committed or has failed.
3. A provider failure during an edit SHALL leave the route exactly as it was and
   SHALL be reported. A transport failure (unreachable, timed out, cancelled)
   SHALL be reported as a failure of the service, never as an unmatched leg.
   This is the same distinction `valhalla.ts` already draws.
4. With the embedded engine, a drag preview on a leg of up to 50 km SHALL
   update with a median latency of 300 ms or less on the Buxton-square fixture
   geography (ADR 0015). This target SHALL be measured and the result recorded.

### Requirement 10: Provider contract

#### Acceptance criteria

1. Alternatives SHALL be an optional capability declared by the provider. A
   provider that does not offer them SHALL still satisfy the interface. THE UI
   SHALL then hide the candidate features and say why.
2. THE Valhalla adapter SHALL implement the capability with the `alternates`
   request parameter, SHALL request no more than the engine's configured limit,
   and SHALL keep the wire format inside `main/routing/valhalla.ts`.
3. THE adapter SHALL support a per-location "pass through, do not turn" hint,
   which serves Requirement 4.7. A provider that cannot honour it SHALL still
   produce a route, and that route SHALL be checked for a reversal as in the
   design.
4. No new network origin SHALL be introduced, and the CSP SHALL be unchanged.
   Alternatives and shaping send the same data as routing already does, under
   the existing consent.

### Requirement 11: Testing

#### Acceptance criteria

1. Unit tests SHALL cover:
   - parsing a Valhalla response that contains alternates, from a fixture
   - zero, one and two alternates
   - displacement on an alternate
   - splicing legs leaves untouched legs identical
   - unmatched and displaced indices move correctly with insertion and removal
   - the shaping-point verifier against a fake provider
   - every new undo inverse round-trips exactly
   - editing a route that has no stored leg boundaries
2. An opt-in live test against the embedded engine SHALL show that **Buxton →
   Macclesfield** returns at least two candidates. Two real routes exist there:
   the A537 over the Cat and Fiddle, and the A5004 Long Hill. The test SHALL
   also show that choosing the non-preferred one and then re-routing reproduces
   it.
3. An end-to-end test SHALL cover the whole flow: place two points, see more
   than one candidate, choose the second, drag the line, save, undo.

## Non-functional requirements

- Module boundaries per `.kiro/steering/architecture.md`. Candidate parsing
  lives in the adapter, leg splicing in `main/services/`, and the pure geometry
  (divergence, nearest position on the line, reversal detection) in
  `shared/geo/`.
- No new dependencies are expected. Any that turn out to be needed are subject
  to the licence check in `.kiro/steering/licensing.md`.
- The map SHALL stay at interactive frame rates while candidates are drawn. That
  is at most three polylines for one leg at a time.

## Out of scope

- **Place search and geocoding.** "Two places" means two points placed on the
  map, as today. A geocoder would be a network dependency for a core feature,
  which ADR 0007 rules out without an offline source. An offline one is now
  specified as Phase 10 Requirement 11.
- **Alternatives across more than two points at once.** The engine does not
  offer them (see the investigation). Alternatives are per leg.
- **Ranking candidates by twistiness or scenery.** That is Phase 7. Its
  Requirement 5.3 rejects re-ranking alternatives as a way of finding winding
  roads, so this phase's candidates must not be presented as that feature.
- **Exporting shaping points** as GPX route points or Garmin shaping points.
  That belongs to the Garmin phase. The role is stored now so that phase needs
  no migration.
- **Changes to hand-drawn route editing.** A route with no control points keeps
  its Phase 2 per-vertex handles.
- **Time-dependent routing and live traffic.** Valhalla does not combine them
  with alternates, and the app has no traffic source.

## Open questions for the owner

1. Should candidates be offered automatically for every leg while drawing
   (as written in Requirement 1), or only on request? Automatic is closer to
   what was asked for, and the requirement includes a setting to turn it off.
2. In the snap routing tool, should Escape dismiss the candidates before it
   cancels the tool? As written, Escape still cancels the tool, as in Phase 4.
