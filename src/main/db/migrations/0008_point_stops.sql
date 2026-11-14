-- Phase 14 task 13: a stop need not be a waypoint. Design §5.6, Requirement 13.3.
--
-- Hand-written. SQLite cannot drop NOT NULL in place, so the table is
-- rebuilt: the same columns in the same order, `waypoint_id` now nullable,
-- and a point (`point_lat`, `point_lon`, `point_name`) for a stop that is only
-- where a route starts or ends. A check keeps exactly one of the two. Nothing
-- references this table, so dropping and renaming it is safe with foreign
-- keys on; every row is copied as it was.
CREATE TABLE `itinerary_stops_new` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`seq` integer NOT NULL,
	`waypoint_id` text,
	`leg_route_id` text,
	`duration_kind` text DEFAULT 'hours' NOT NULL,
	`duration_minutes` integer,
	`duration_days` integer,
	`depart_time` text,
	`arrive_by` text,
	`depart_at` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`leg_mode` text DEFAULT 'road' NOT NULL,
	`leg_transport` text,
	`leg_minutes` integer,
	`leg_label` text,
	`point_lat` real,
	`point_lon` real,
	`point_name` text,
	FOREIGN KEY (`trip_id`) REFERENCES `itineraries`(`trip_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "itinerary_stops_kind_valid" CHECK("duration_kind" in ('hours', 'days')),
	CONSTRAINT "itinerary_stops_place" CHECK(("waypoint_id" IS NOT NULL) <> ("point_lat" IS NOT NULL AND "point_lon" IS NOT NULL))
);--> statement-breakpoint
INSERT INTO `itinerary_stops_new` (`id`, `trip_id`, `seq`, `waypoint_id`, `leg_route_id`, `duration_kind`, `duration_minutes`, `duration_days`, `depart_time`, `arrive_by`, `depart_at`, `notes`, `created_at`, `updated_at`, `leg_mode`, `leg_transport`, `leg_minutes`, `leg_label`)
SELECT `id`, `trip_id`, `seq`, `waypoint_id`, `leg_route_id`, `duration_kind`, `duration_minutes`, `duration_days`, `depart_time`, `arrive_by`, `depart_at`, `notes`, `created_at`, `updated_at`, `leg_mode`, `leg_transport`, `leg_minutes`, `leg_label` FROM `itinerary_stops`;--> statement-breakpoint
DROP TABLE `itinerary_stops`;--> statement-breakpoint
ALTER TABLE `itinerary_stops_new` RENAME TO `itinerary_stops`;--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_trip` ON `itinerary_stops` (`trip_id`, `seq`);--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_waypoint` ON `itinerary_stops` (`waypoint_id`);
