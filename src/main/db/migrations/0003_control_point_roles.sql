-- Phase 6: control points gain a role and a leg boundary. ADR 0017.
--
-- Hand-written, like 0002: two ALTERs read more clearly than drizzle-kit's
-- table-rebuild form, and there is no 0002 snapshot to diff against.

-- `via` is a place the route visits; `shaping` only bends it onto a road.
-- Every control point that exists today was clicked in the snap routing tool
-- or came from a whole-route snap, so every one of them is a via point.
ALTER TABLE `route_control_points` ADD `role` text DEFAULT 'via' NOT NULL;--> statement-breakpoint

-- Index into `route_points` of the boundary at this control point: 0 for the
-- first, the last vertex of the previous leg for the rest. See
-- `shared/routing/splice.ts` for the invariant.
--
-- Null for routes snapped before this phase, whose boundaries were never
-- recorded and cannot be recovered reliably from the shape alone — a loop or
-- an out-and-back route has several plausible positions for the same point.
-- Those routes re-snap once on their first edit to establish them.
ALTER TABLE `route_control_points` ADD `shape_index` integer;
