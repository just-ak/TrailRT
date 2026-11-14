-- Phase 14: days that are added and removed. Design §5.8, Requirement 15.
--
-- Hand-written. An entry may now be a day break (`entry_kind = 'day'`): the
-- plan's next day starts there, at its leaving time (`depart_time`, or the
-- plan's usual one). It has no place. The CHECK changes, so the table is
-- rebuilt as in 0008 and 0009; every row is copied as it was.
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
	`entry_kind` text DEFAULT 'stop' NOT NULL,
	`entry_route_id` text,
	FOREIGN KEY (`trip_id`) REFERENCES `itineraries`(`trip_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "itinerary_stops_kind_valid" CHECK("duration_kind" in ('hours', 'days')),
	CONSTRAINT "itinerary_stops_entry_valid" CHECK(
		("entry_kind" = 'route' AND "entry_route_id" IS NOT NULL AND "waypoint_id" IS NULL AND "point_lat" IS NULL)
		OR ("entry_kind" = 'day' AND "entry_route_id" IS NULL AND "waypoint_id" IS NULL AND "point_lat" IS NULL)
		OR ("entry_kind" = 'stop' AND "entry_route_id" IS NULL AND (("waypoint_id" IS NOT NULL) <> ("point_lat" IS NOT NULL AND "point_lon" IS NOT NULL)))
	)
);--> statement-breakpoint
INSERT INTO `itinerary_stops_new` (`id`, `trip_id`, `seq`, `waypoint_id`, `leg_route_id`, `duration_kind`, `duration_minutes`, `duration_days`, `depart_time`, `arrive_by`, `depart_at`, `notes`, `created_at`, `updated_at`, `leg_mode`, `leg_transport`, `leg_minutes`, `leg_label`, `point_lat`, `point_lon`, `point_name`, `entry_kind`, `entry_route_id`)
SELECT `id`, `trip_id`, `seq`, `waypoint_id`, `leg_route_id`, `duration_kind`, `duration_minutes`, `duration_days`, `depart_time`, `arrive_by`, `depart_at`, `notes`, `created_at`, `updated_at`, `leg_mode`, `leg_transport`, `leg_minutes`, `leg_label`, `point_lat`, `point_lon`, `point_name`, `entry_kind`, `entry_route_id` FROM `itinerary_stops`;--> statement-breakpoint
DROP TABLE `itinerary_stops`;--> statement-breakpoint
ALTER TABLE `itinerary_stops_new` RENAME TO `itinerary_stops`;--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_trip` ON `itinerary_stops` (`trip_id`, `seq`);--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_waypoint` ON `itinerary_stops` (`waypoint_id`);
