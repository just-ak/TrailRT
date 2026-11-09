# ADR 0016: Snapping reports control points the graph cannot reach

**Status:** accepted
**Date:** 2026-11-08
**Amends:** ADR 0013 (embedded engine), ADR 0011 (snapping rules)

## Context

A user snapped a four-corner loop — Buxton, Macclesfield, Leek, Ashbourne — and
got back a confident road route that went nowhere near two of the four towns.
No warning appeared anywhere. The snap reported success.

The loaded graph was the Geofabrik `derbyshire` extract. Macclesfield is in
Cheshire and Leek is in Staffordshire, so neither is in it. Measured against
that graph:

| Control point | Displaced by |
| --- | --- |
| Buxton | 4 m |
| Macclesfield | **3,111 m** |
| Leek | **10,670 m** |
| Ashbourne | 5 m |

Valhalla does not refuse a point outside its graph. It snaps it to the nearest
road it *does* have, routes to there, and returns HTTP 200. The leg distances
were wrong in both directions — Leek→Ashbourne came back as 44.5 km against a
true 26.6 km, because the "Leek" end was ten kilometres away in the Dove
valley.

**And the response gives no indication.** `trip.locations` echoes back the
coordinates that were *sent*, not the ones used. A request whose endpoints were
dragged ten kilometres is byte-for-byte indistinguishable in its reply from one
that matched a driveway. There is no status field, no warning array, and no
error code for it.

This is the worst category of failure the architecture rules name: a feature
that looks like it worked. The route is stored, its statistics are recomputed
from the wrong geometry, and a later export carries it out to a device.

## Decision

**The adapter measures the displacement itself, and a control point moved too
far makes its legs unmatched.**

Two parts.

### Measure it

For each routed leg, compare the ends of the returned geometry with the control
points that were asked for. The largest displacement seen for each control
point is reported on `SnapResult.displaced`.

This is the only available evidence, and it is sound: a leg's geometry starts
and ends where the engine actually routed from and to, so the gap between that
and the request is exactly the distance the point was moved.

`MAX_SNAP_DISPLACEMENT_M = 250`. Snapping is *supposed* to move points — a
click on the map at zoom 12 is easily 100 m from a carriageway, and a
town-centre coordinate is wherever the gazetteer put it. 250 m is comfortably
past both and far short of the kilometres that indicate missing data.

### Treat it as an unmatched leg

A leg with an end displaced past the tolerance keeps its **straight line** and
is listed in `unmatchedLegs`, exactly as a leg with no road path is.

This is the part worth arguing for. The alternatives were:

- **Refuse the whole snap.** Rejected: it contradicts the existing per-leg
  design, where one unroutable stretch does not cost the user the other
  nineteen. A route partly covered by the loaded region should snap where it
  can.
- **Keep the wrong road geometry and warn.** Rejected. A warning can be
  dismissed, missed, or scrolled away, and what remains is a route that looks
  authoritative and is wrong. The user cannot tell by looking.
- **Straight line plus a warning.** Chosen. A straight line between two towns
  is self-evidently not a road route. The map already draws unmatched legs
  dashed in red, so the existing annotation covers it with no new UI, and the
  user sees *which* parts of their ride have no map data.

So the pathological case now renders as it should: the legs the graph covers
snap to roads, and the legs reaching outside it stay visibly straight.

### Say it, and keep saying it

`displaced` is persisted in the route's metadata and returned by
`routing.provenance`, so the properties panel reports it on every selection
rather than once in a toast. A route snapped against a region that did not
cover it stays wrong until it is re-snapped, and the panel should say so for as
long as that is true.

The message names the distance and points at the fix: add the map regions
covering the route.

The interactive snap tool gets the same figure per click, on
`PreviewedLeg.displacementM`, so a point placed outside the loaded region is
obvious as it is placed rather than after the whole route is drawn and saved.

## A second problem the same screenshot showed

A snapped route is hundreds to thousands of road vertices, and
`useRouteLayers` was materialising a **draggable handle on every one of them**.
The map became a solid mass of markers with the route invisible underneath.

Fixed by making the handles follow the **control points** when a route has
them. That is also the only coherent answer: a snapped route's geometry is
*derived* from its control points, so dragging a road vertex is an edit the
next re-snap would silently discard. Dragging a control point now moves the
input and re-snaps, which is one undo entry because the snap already records
the whole previous geometry as its inverse.

A hand-drawn route has no control points and keeps per-vertex editing exactly
as before.

## Consequences

- `SnapResult`, `SnapOutcome` and `RouteProvenance` each gain a `displaced`
  list; `PreviewedLeg` gains `displacementM`.
- `displacementM` on the IPC schema defaults to null rather than being
  required: it is a diagnostic the main process measured and handed out, so a
  payload without it is a caller that was not told, not a malformed request.
- `routeLeg` reads `result.displaced ?? []`. A provider that does not measure
  displacement has nothing to say about it, which is not a reason to fail.
- Two unit tests had to change, and both were weak for reasons the change
  exposed. The point-cap test scripted a shape marching away from its start, so
  it is now a displaced leg and never reaches the cap — it interpolates between
  the control points instead. And the fake provider now measures displacement
  the same way the real adapter does, so a scripted shape far from its control
  point reproduces the real failure.

## What this does not fix

The underlying cause is that the user could not load a graph covering their
ride. Only one region can be loaded at a time, and Geofabrik publishes England
by county with **nothing between county and England**:

| Selection | Download |
| --- | --- |
| derbyshire + cheshire + staffordshire | 114 MB |
| england (the smallest region containing all three) | 1,712 MB |

Building the three county extracts together is not an option. Valhalla warns
that multi-extract builds are discouraged (issue 3925), and in practice
`valhalla_build_tiles` **crashes** on them: a bus error during node sorting
with the shipped config, and an uncaught exception after raising
`id_table_size`. Even a build that completed would be wrong at the seams, which
is precisely where this user routes.

So multi-county support needs the extracts merged into one file first, and that
needs a merge tool. That decision is open — see the discussion attached to this
change rather than a decision recorded here.
