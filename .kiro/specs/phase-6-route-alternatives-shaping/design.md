# Phase 6: Route alternatives and shaping — Design

Two features, one of each kind. Candidates are a read: ask the engine for more
than one answer and show them. Shaping is a write: change a route by
editing the points it is computed from. Candidates are the easy part. Most of
this design is about shaping, because Phase 4 stored a snapped route in a way
that only supports replacing all of it.

Decisions that are hard to reverse are recorded in ADR 0017.

## 1. The provider gains two optional capabilities

```ts
// shared/routing/RoutingProvider.ts

export type ControlRole = 'via' | 'shaping';

/** One location in a section routed as a single request. */
export interface SectionLocation {
  point: LatLon;
  /**
   * Arrive and leave without turning round. Set for shaping points.
   * Valhalla: `type: 'break_through'`. The leg is still split here.
   */
  passThrough: boolean;
}

export interface RouteCandidate {
  shape: LatLon[];
  distanceM: number | null;
  /** An engine estimate, never a measurement. ADR 0011 §8. */
  estimatedDurationS: number | null;
  /** Measured, as for snap. ADR 0016. */
  startDisplacementM: number;
  endDisplacementM: number;
}

export interface RoutingProvider {
  // ...snap and match unchanged...

  /**
   * Up to `count` candidates between two points. The engine's preferred route
   * comes first. Absent on a provider that cannot offer alternatives.
   */
  alternatives?(
    from: LatLon,
    to: LatLon,
    mode: TransportMode,
    count: number,
  ): Promise<RouteCandidate[]>;

  /**
   * Routes a short section as **one** request, splitting legs at every
   * location and honouring `passThrough`. Absent when unsupported; callers
   * fall back to `snap` and check for reversals (§5).
   */
  snapSection?(
    locations: readonly SectionLocation[],
    mode: TransportMode,
  ): Promise<SnapResult>;
}
```

Both methods are optional. This keeps Phase 4's promise that a second provider
is an adapter, not a refactor: a provider with only `snap` and `match` still
works, and the UI loses the features it cannot back (Requirement 10.1).
`RoutingStatus` gains `capabilities: { alternatives: boolean; passThrough:
boolean }`, so the renderer knows what to offer without probing.

### Valhalla adapter

- `alternatives` sends `/route` with two locations and
  `alternates: min(count - 1, 2)`. The 2 is the bundled
  `service_limits.max_alternates`. A remote host may configure a lower limit,
  so an error that mentions alternates is retried once with `alternates: 0`.
  The primary route is in `trip` and the others are in `alternates[].trip`.
  `ValhallaRouteResponse` gains the `alternates` field. Nothing outside
  `valhalla.ts` sees it.
- Every candidate goes through the same displacement measurement as `snap`.
  A candidate with either end beyond `MAX_SNAP_DISPLACEMENT_M` is dropped from
  the list rather than shown (Requirement 1.9). If that leaves none, the leg is
  unmatched, exactly as today.
- `snapSection` sends one `/route` with N locations. Shaping points are typed
  `break_through` and via points `break`. A `break_through` location keeps the
  leg split, which §2 depends on, but forbids a U-turn there (Requirement
  4.7). A multi-location request fails as a unit. On a `PROVIDER_ERROR`,
  `snapSection` falls back to per-leg `snap`, so one bad point degrades to
  Phase 4 behaviour rather than failing. Transport errors propagate, for the
  reason `snap` already documents.

## 2. Leg boundaries are stored

To replace one leg, the system has to know where that leg is in
`route_points`. Migration `0003` adds two columns:

```sql
ALTER TABLE route_control_points ADD `role` text DEFAULT 'via' NOT NULL;
-- Index into route_points of the first vertex of the leg that starts here.
-- Null for routes snapped before Phase 6: boundaries unknown.
ALTER TABLE route_control_points ADD `shape_index` integer;
```

**Invariant.** For a route with control points `c[0..n-1]` and shape `p`:

- `b[k] = c[k].shape_index` is non-decreasing, `b[0] = 0` and
  `b[n-1] = p.length - 1`.
- For `k ≥ 1`, `b[k]` is the index of the **last vertex of leg `k-1`**, and
  leg `k` is the *inclusive* slice `p[b[k] ..= b[k+1]]`. Adjacent legs always
  share the boundary vertex. Where two engine legs did not meet exactly, both
  vertices are kept and the short step belongs to the later leg.
- Inclusive rather than half-open, which is a correction made during
  implementation. With half-open legs, the boundary vertex is either shared (the
  join was de-duplicated) or the later leg's own first vertex (it was not), and
  nothing records which. A splice would then drop or duplicate a vertex
  depending on a fact it cannot see.
- Every write that touches a snapped route's points also rewrites
  `shape_index`. That covers `snapRoute`, `createSnappedRoute`, `restoreSnap`
  and the new splice. A write that cannot maintain the invariant clears the
  control points instead. `route:setGeometry` on a snapped route is that case,
  and it is now unreachable from the map (§4).

`flattenLegs` becomes `flattenLegsWithBoundaries`. It returns the points and
`b[]` together, so the boundaries come from the same pass that removes
duplicate join vertices and cannot drift from it. Splicing is a pure function in
`shared/routing/splice.ts`:

```ts
spliceLegs(
  points: readonly LatLon[],
  boundaries: readonly number[],
  fromLeg: number,           // first leg replaced
  toLeg: number,             // one past the last leg replaced
  replacement: readonly { shape: readonly LatLon[] }[],
): { points: LatLon[]; boundaries: number[] }
```

It keeps `p[0 ..= b[fromLeg]]` and `p[b[toLeg] ..]` unchanged as values. The
middle is re-flattened, and the two seams are de-duplicated with the same 1e-6
rule `flattenLegs` uses. This is the function behind Requirements 2.3 and 5.1
("every other leg identical, point for point"). Its tests include a property
test showing that a splice is *exactly* equal, in both points and boundaries,
to flattening the kept legs around the replacement.

**Legacy routes** (`shape_index` null). Their first edit runs the existing
whole-route `snapRoute` on the current control points to establish the
boundaries, then applies the edit. The toast says "Re-routing the whole route
once to enable section editing" (Requirement 8.8). No migration back-fill is
attempted. Recovering boundaries by nearest-point search is unreliable on loops
and out-and-back routes, which are exactly where a wrong boundary would do
damage.

## 3. One edit model for the tool and for saved routes

The snap routing tool (a draft in the renderer) and a saved snapped route
(rows in SQLite) need the same edits. They share one pure planner, so the two
cannot behave differently:

```ts
// shared/routing/edit.ts — no I/O
type RouteEdit =
  | { kind: 'append'; at: LatLon }
  | { kind: 'move'; index: number; to: LatLon }
  | { kind: 'insert'; leg: number; at: LatLon }                  // drag the line
  | { kind: 'insertOnLine'; leg: number; shapeIndex: number }    // click the line
  | { kind: 'remove'; index: number }
  | { kind: 'setRole'; index: number; role: ControlRole }
  | { kind: 'choose'; leg: number; candidate: RouteCandidate; shaping: LatLon[] };

interface EditPlan {
  control: { point: LatLon; role: ControlRole }[];   // after the edit
  replace: [fromLeg: number, toLeg: number];          // in the old leg numbering
  /** What to route for the replaced span. Empty when no routing is needed. */
  section: SectionLocation[];
  /** Geometry known without routing (insertOnLine, choose, setRole). */
  knownLegs: { shape: LatLon[] }[] | null;
  /** Remaps unmatchedLegs / displacedControlPoints indices. */
  remap: (controlIndex: number) => number | null;
}

planEdit(control, boundaries, edit): EditPlan
```

| Edit | Legs replaced | Routed | Notes |
| --- | --- | --- | --- |
| `append` | none (one new leg) | `[last, at]` | Candidates per §6 |
| `move` start / end | 1 | 2 locations | |
| `move` middle | 2 | 3 locations, middle `passThrough` if shaping | |
| `insert` (drag line) | 1 → 2 | `[c[k], at(pass), c[k+1]]` | |
| `insertOnLine` | 1 → 2 | nothing | Splits the shape at `shapeIndex`; geometry unchanged (4.5) |
| `remove` middle | 2 → 1 | `[c[k-1], c[k+1]]` | |
| `remove` start / end | 1 → 0 | nothing | Drops the end leg (6.2) |
| `setRole` | 0 | nothing | Geometry unchanged (6.4) |
| `choose` | 1 → 1 + shaping | nothing | Splits the candidate at each shaping point (§7) |

**Section ends are never pass-through.** This is a correction made during
implementation. A section starts and ends at control points whose *other* leg
is not being re-routed. Making those ends pass-through would only mean
something if the neighbouring legs were routed in the same request, and that
would change legs Requirement 5.1 says stay identical. So only a section's
interior locations carry `passThrough`, and a reversal at a section end is
caught afterwards by the check in §5. The planner also enforces the refusals:
fewer than two points (6.3), and start or end never being shaping (6.4).
Removing the start or end point turns its neighbour into a via point.

### Saved routes: preview, then apply

Phase 4 established that what the user watched appear is what gets stored
(`PreviewedLeg`). The same holds here, so routing and writing are separate
calls:

```
renderer                                   main
planEdit(...)            ──routing:routeSection──▶  provider.snapSection | snap
                         ◀──── PreviewedLeg[] ────  (no database access)
(user sees the preview; drag may repeat this many times)
on release ──routing:applyEdit { routeId, expected, edit, legs }──▶
                                           re-plan from the DB, check `expected`,
                                           splice, write, record undo
```

`expected` is the control points and boundaries the renderer planned against.
Main re-plans the edit from the database. If the result differs from
`expected`, nothing is written and `INVALID_REQUEST` is returned, for the same
reason `createSnappedRoute` refuses mismatched legs: a preview computed against
a route that has since changed describes neither version.

New IPC, all behind the existing consent gate and validated by zod in
`shared/ipc/schemas.ts`:

| Channel | Writes | Purpose |
| --- | --- | --- |
| `routing:routeSection` | no | Route 2–N locations; returns `PreviewedLeg[]` |
| `routing:alternatives` | no | Candidates between two points |
| `routing:applyEdit` | yes | Commit a planned edit with its previewed legs |

`routing:routeLeg` stays. It is `routeSection` with two locations, and the
drain loop keeps using it.

## 4. Map interaction

`useRouteLayers` keeps everything for hand-drawn routes. For a selected
**snapped** route, the line's click handler no longer calls
`insertRouteVertex` (the defect in the investigation). Instead, a new hook,
`useRouteShaping`, owns the interaction:

- **Hit area.** A transparent 16 px polyline under the visible line, for the
  selected route only. A 4 px line is too thin to grab.
- **Press on the line.** The hook records the press, disables `map.dragging`
  and starts watching movement. Movement under 4 px followed by release counts
  as a click. The hook then finds the nearest position on the line
  (`closestSegment`), takes the leg from the boundaries, and applies
  `insertOnLine`. Movement beyond 4 px starts an `insert` drag with a
  temporary shaping handle. Leaflet's own `click` after `mouseup` is
  suppressed once a drag has started (Requirement 4.6).
- **Press on a handle.** This uses Leaflet marker dragging, as today, but runs
  through the same controller, so a handle drag is a `move`.
- **During a drag.** A `DragPreview` controller keeps the latest pointer
  position in a ref. When no request is in flight, it sends
  `routeSection` for that position. When the reply lands, it draws the reply
  only if the position has not moved on. Otherwise it sends the new position
  and discards the reply. That gives at most one request in flight, with the
  latest position winning (Requirement 4.2). On a remote provider, it draws
  straight lines and routes once on release.
- **Release** calls `applyEdit` with the preview legs if they match the final
  position. Otherwise it routes the final position first.
- **Escape** during a drag restores the handles and clears the preview, and
  nothing is sent (4.4).
- **Alt-click** on a handle is `remove`. The **context menu** on a handle
  offers *Remove point*, *Make shaping point* or *Make via point*, and on the
  end handle *Extend route*. The context menu on the line gains *Show
  alternatives for this section*.
- **While an edit is in flight** (9.2), the route's handles are
  non-interactive, the cursor shows progress, and a second press is ignored.

**Panes are SVG and click-through.** This is a correction made during
implementation, found by the end-to-end test. The map renders paths on canvas,
and a canvas renderer puts a full-map canvas in each pane it serves. Once it has
held a path, that canvas takes every pointer event over the whole map, so a
custom pane above the others blocks clicks on every route and marker beneath
it. The shaping and candidate panes therefore use an SVG renderer with
`pointer-events: none` on the pane (`interactivePane.ts`). Leaflet's interactive
paths and markers carry an explicit `pointer-events: auto`, so they still
receive events, and empty areas fall through.

Handles (Requirement 7): via points use the new numbered `viaIcon`, and the
start and end keep `endpointIcon`. Shaping points get a new
`shapingIcon()` in `markers.ts`: a 9 px hollow circle in the route colour.

In the snap routing tool, `useSnapRouting` makes its placed points draggable
and uses the same `useRouteShaping` controller against the draft. The edit is
applied to `snapRoutingStore` instead of through IPC (Requirement 5.4).

## 5. Reversal check, for providers without pass-through

`shared/geo/reversal.ts`:
`reversalAt(shape, index, windowM = 150): boolean`. It compares the bearing
into and out of `shape[index]` over `windowM` metres each side. A difference
above 150° is a reversal. It runs on every shaping point after
`snap`-based routing. That covers a provider without `snapSection` and the
per-leg fallback in §1. A reversal does not block the edit. The shaping
handle gets a warning ring, and the toast says the route turns back at that
point and suggests moving it. A spur the user can see and fix is better than
refusing an edit the engine was happy with.

## 6. Candidates

### In the tool

`snapRoutingStore` gains:

```ts
roles: ControlRole[];                       // parallel to controlPoints
legs: (PreviewedLeg | null)[];              // was a prefix array; null = needs routing
candidates: { leg: number; items: Candidate[]; selected: number } | null;
history: Snapshot[];                        // for ⌘Z, bounded at 50
```

`legs` changes from a prefix to a sparse array, because a `move` in the
middle of the draft invalidates two legs that are not at the end.
`nextGap()` returns the first `null`. `drainSnapLegs` is unchanged apart from
that, and so is its one-at-a-time ordering guarantee. When the gap is the last
leg, the setting is on and the provider has `alternatives`, the drain calls
`routing:alternatives` instead of `routeLeg`. It stores candidate 1 as the
leg and the full list in `candidates`.

Selecting a candidate swaps the leg and does not route. Placing the next point
or finishing applies `choose` for the selected candidate (§7) and clears
`candidates` (Requirement 1.6).

`Candidate` is a `PreviewedLeg` plus `estimatedDurationS`. The field is named
for what it is: `PreviewedLeg` dropped duration on the grounds that nothing
displayed it, and something now does, labelled as an estimate.

### Rendering

`useCandidateLayers(map, candidates, selected, onSelect, onHover)`:

- **Selected:** route accent, weight 5.
- **Others:** slate `#64748b`, weight 4, opacity 0.7, drawn underneath, and
  clickable with a 16 px hit area.
- **Labels:** each candidate gets a small label at its point of greatest
  divergence from candidate 1: `B · +3.2 km · +6 min (est.)`.

Next to the existing snap-route readout in `MapView`, a candidate list shows
the same figures with a radio per row. Pressing `1`, `2` or `3` selects.
Hovering over a row or a line highlights the other.

### For a saved route's leg

*Show alternatives for this section* calls `routing:alternatives` with the
leg's two control points and shows the same layers. The current leg is drawn
dashed in the route colour so it can be compared. Choosing a candidate is
`applyEdit` with `choose`, which is one undo entry. Escape or clicking away
dismisses the candidates and writes nothing (Requirement 2.4).

## 7. Making a chosen alternative stick

`shared/geo/divergence.ts`, all pure:

- `farthestFrom(candidate, reference)` returns the segment of `candidate`
  whose midpoint is farthest from the `reference` polyline. It uses the
  midpoint and not a vertex, because a vertex is often a junction, and a
  shaping point on a junction can snap onto the crossing road.
- `overlap(a, b, toleranceM = 25)` returns the fraction of `a`'s length that
  lies within `toleranceM` of `b`, taking the lower of `a→b` and `b→a`.

Algorithm for `choose` with candidate `C` over leg `A→B`, where `P` is
candidate 1:

```
shaping = [ midpoint of farthestFrom(C, P) ]
repeat up to 3 times:
    R = snapSection([A, ...shaping(pass), B])
    if overlap(C, R) ≥ 0.98: stop — verified
    shaping += midpoint of farthestFrom(C, R), ordered along C
unverified → keep, warn (Requirement 3.3)
```

The stored geometry is `C` split at each shaping point. Each midpoint lies
on `C` by construction, so the split inserts one vertex into a straight
segment and moves nothing (Requirement 3.4). The verification routes are only
used for the comparison and are then discarded.

Verification is asynchronous. In the tool, it runs after the user moves on.
On a saved route, it runs before `applyEdit` while the candidates are still
shown, with a short "Checking this route can be reproduced" state. The 0.98
threshold, 25 m tolerance and bound of 3 are constants in `divergence.ts`.
Their values are confirmed by the live test in task 11, not assumed.

## 8. Undo

A new command kind, `route:spliceLegs`:

```ts
payload: {
  id: string;
  fromShape: number;            // first index replaced in the current points
  toShape: number;              // one past the last index replaced
  points: RoutePoint[];         // what to put back
  control: { lat; lon; role; shapeIndex }[];   // whole list: small
  metadata: Record<string, unknown>;           // unmatchedLegs, displaced…
}
```

The handler splices `points` into `[fromShape, toShape)`, replaces the control
points and metadata, and recomputes stats. It returns its own
`route:spliceLegs` inverse, so redo comes for free and is exactly symmetric.
The payload carries the **replaced slice**, not the route. If that slice is over
`MAX_UNDOABLE_POINTS`, the edit's inverse is `{ kind: 'none' }` and the toast
says so (Requirement 8.2). Control lists are carried whole: they are tens of
points, and diffing them would be complexity for nothing.

Undo-stack memory is the reason for the small inverse. The database write
is a different matter: the write itself uses `replacePoints` with the whole
new array, inside one transaction. Rewriting 25,000 rows in SQLite takes
milliseconds. Shifting `seq` in place under the `(route_id, seq)` unique index
would need a two-pass renumber, and nothing gained would justify the risk.

`undoService.labelFor` gains `'route:spliceLegs': 'route shaping'`. The draft in
the tool keeps its own `history` of snapshots, because nothing is in the
database yet. ⌘Z pops a snapshot and Backspace keeps its Phase 4 behaviour
(Requirement 8.7).

## 9. Extend from the end

*Extend route* puts `editorStore` into an `extendRoute` mode for that route.
Each map click is an `append` edit applied through `applyEdit` straight away
with candidate 1, so each click is one undo entry (Requirement 6.5). The new
leg's candidates are then shown. Choosing another is a second `choose` edit and
a second undo entry. Enter or Escape leaves the mode. It reuses the tool's
keyboard handling, so the keys mean the same thing in both places.

## 10. Whole-route re-snap with shaping points

`snapRoute` (the Phase 4 *Snap to roads* button and a transport-mode change)
must not undo the shaping a user has done. It groups the control points into
runs from one via point to the next. A run with shaping points is routed with
one `snapSection` call, and a run without them uses the per-leg `snap` as
today. The boundaries come out of the same `flattenLegsWithBoundaries` pass.

## 11. Settings and status

- `settings.routeAlternatives: boolean`, default `true`, in
  `shared/domain/defaults.ts`. It appears in the Routing section of
  `SettingsDialog` as "Show alternative routes while drawing".
- `RoutingStatus.capabilities` comes from the presence of
  `provider.alternatives` and `provider.snapSection`. When `alternatives` is
  false, the candidate UI is absent, and the Settings toggle is disabled with
  the reason.

## 12. The TrailRT JSON format carries control points

Each route in the collection gains an optional field:

```ts
control?: { lat: number; lon: number; role: ControlRole; shapeIndex: number | null }[];
```

It is optional, so `COLLECTION_VERSION` stays at 1: the format's own rule is
that additive fields need no bump, and older readers ignore the field. Older
files are read as they are today (Requirement 7.4). A sibling `routing` field
carries the provider and transport mode, so the imported route says where its
road geometry came from.
On import, the invariant in §2 is checked against the imported shape. A file
that fails the check keeps its geometry and drops the control points, so the
route becomes hand-drawn, and that fact goes into the existing import report.
Rejecting the whole file would lose a route over a fact about how it was
edited.

## Requirement traceability

| Requirement | Section |
| --- | --- |
| 1 Candidates while drawing | §6 |
| 2 Candidates for a saved leg | §6, §8 |
| 3 Chosen alternative survives | §7 |
| 4 Drag the line | §3, §4 |
| 5 Drag control points | §3, §4 |
| 6 Add, remove, convert | §3, §4, §9 |
| 7 Via vs shaping | §2, §4, §12 |
| 8 Undo and integrity | §2, §8 |
| 9 Responsiveness and failure | §1, §4 |
| 10 Provider contract | §1, §11 |
| 11 Testing | tasks.md |
