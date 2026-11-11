# ADR 0017: Route alternatives are per leg, and a chosen one is kept as shaping points

Status: accepted (Phase 6 shipped 2026-11-08)
Date: 2026-11-08
Amends ADR 0012 (phase numbering). Relates to ADR 0011 (snapping rules), ADR
0014 (undo bounds), ADR 0016 (displacement)

## Context

The owner asked for two things. When a route is made between two places, show
the routes available and let them choose one. Then let them drag or click to
shape it and add points. Phase 4 stores a snapped route as control points plus a
flat shape, with no record of where each leg sits in that shape. The only edit it
supports is re-routing the whole route. The investigation in
`.kiro/specs/phase-6-route-alternatives-shaping/requirements.md` lists what that
causes, including a live defect: clicking the line of a snapped route inserts a
raw vertex into the derived geometry.

## Decision

### 1. This is Phase 6. Windy roads moves to Phase 7 and Garmin to Phase 8

Windy-roads routing will produce routes that a user will want to compare with
the conventional one and then adjust. Building comparison and shaping first
means Phase 7 adds a cost model to an editing surface that already exists. In
code comments, phases are now named rather than numbered ("the Garmin phase"),
so the next renumbering cannot make them wrong.

### 2. Alternatives are offered per leg

Valhalla returns alternates only for a request with two locations, and the
bundled config allows at most two. Phase 4 already routes each leg as its own
two-location request. Offering candidates per leg therefore fits both the engine
and the existing architecture. Whole-route alternatives across several points
are not offered, because the engine cannot produce them.

### 3. A chosen alternative is stored as shaping points, not as a choice

The engine has no memory. Storing "candidate 2 was chosen" would be meaningless
the next time the leg is re-routed, for example when a neighbouring point is
dragged. The system instead inserts shaping points on the chosen road, and
checks by re-routing that they reproduce it. Up to three are inserted. If they
still do not reproduce the road, the geometry is kept and the user is told. The
stored geometry is the candidate as previewed, split at the shaping points,
consistent with Phase 4's rule that what the user saw is what is saved.

### 4. Control points gain a role and a leg boundary

`route_control_points` gains `role` (`via` or `shaping`) and `shape_index`,
the start of that point's leg in `route_points`. With these, one leg can be
replaced and every other leg left identical, point for point. Routes snapped
before this phase have no boundaries and are re-routed once on their first edit,
rather than back-filled by guesswork.

### 5. Shaping points do not turn round

Each leg routed independently treats every point as a destination, so a point
placed beside the road can produce an out-and-back spur. A run of points
containing shaping points is routed as one request, with Valhalla's
`break_through` type on the shaping points. That keeps the leg split but
forbids a U-turn. A provider without that capability is checked for reversals
afterwards, and the user is warned rather than refused.

### 6. Undo carries the replaced slice

The `route:spliceLegs` inverse carries only the replaced points. An edit to a
large route is therefore undoable when the edited section is small, which
removes the ADR 0014-style "cannot be undone" result for the common case of
dragging one point on a long route. The database write still replaces the whole
point array in one transaction. It is cheap, and avoids renumbering `seq` under
its unique index.

## Consequences

- `RoutingProvider` gains two **optional** methods. A second provider remains an
  adapter, not a refactor.
- `route:setGeometry` is no longer reachable from the map for a snapped route.
- The TrailRT JSON format gains an optional `control` field. Older files still
  import.
- GPX and other exports are unchanged. The stored role is ready for the Garmin
  phase to export shaping points.

## Alternatives considered

**Re-rank whole-route alternatives.** This is not available from the engine for
more than two points, and Phase 7 Requirement 5.3 rejects the approach for
windy roads anyway.

**Store the chosen candidate's geometry and pin it.** This means never
re-routing a leg whose alternative was chosen. It works until an end point is
dragged, and then there is no right answer: dropping the choice surprises the
user, and keeping it is geometrically impossible.

**Live re-routing on every pointer move with no request limit.** With an
in-process engine the requests are cheap, but they would arrive out of order.
Latest-wins with one request in flight gives the same feel without the risk of
drawing a stale reply.
