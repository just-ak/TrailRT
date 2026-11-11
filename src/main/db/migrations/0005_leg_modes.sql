-- Phase 10 feedback: how each leg is travelled. Design §15.1, ADR 0019
-- amendment of 11 November 2026.
--
-- `leg_mode` is `road` (planned automatically), `route` (chosen by hand) or
-- `other` (not by road: ferry, train, flight). Validated in the service, as
-- SQLite cannot add a CHECK with ALTER TABLE.
ALTER TABLE `itinerary_stops` ADD `leg_mode` text DEFAULT 'road' NOT NULL;--> statement-breakpoint
ALTER TABLE `itinerary_stops` ADD `leg_transport` text;--> statement-breakpoint
ALTER TABLE `itinerary_stops` ADD `leg_minutes` integer;--> statement-breakpoint
ALTER TABLE `itinerary_stops` ADD `leg_label` text;--> statement-breakpoint

-- A leg that already has a route was linked by hand before automatic planning
-- existed, so it is the user's choice. Nothing is planned by the migration.
UPDATE `itinerary_stops` SET `leg_mode` = 'route' WHERE `leg_route_id` IS NOT NULL;
