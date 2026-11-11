-- Phase 10: a trip's dated itinerary. ADR 0019 §2.
--
-- Hand-written, like 0002 and 0003. Two new tables and no change to any
-- existing one, so every trip without an itinerary is exactly as it was.
--
-- Only the plan's inputs are stored. Arrival and departure times are derived
-- on every read by `shared/itinerary/timeline.ts` and never written here.

-- One row per scheduled trip. Its absence is what "no itinerary" means.
CREATE TABLE `itineraries` (
	`trip_id` text PRIMARY KEY NOT NULL,
	`start_date` text NOT NULL,
	`start_time` text NOT NULL,
	`default_depart` text DEFAULT '09:00' NOT NULL,
	`max_drive_minutes` integer,
	`range_km` real,
	`reserve_pct` integer DEFAULT 20 NOT NULL,
	`energy` text DEFAULT 'fuel' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "itineraries_energy_valid" CHECK("energy" in ('fuel', 'electric')),
	CONSTRAINT "itineraries_reserve_valid" CHECK("reserve_pct" between 0 and 90)
);--> statement-breakpoint

-- The stops, in order.
--
-- `waypoint_id` and `leg_route_id` deliberately have no foreign key. A cascade
-- would delete the stop with its waypoint, and undoing the waypoint deletion
-- (which reuses the id) would not bring it back; SET NULL would lose the link
-- for good. As plain ids, a deleted waypoint shows as missing and an undo
-- heals the link by itself. Design §2.2.
CREATE TABLE `itinerary_stops` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`seq` integer NOT NULL,
	`waypoint_id` text NOT NULL,
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
	FOREIGN KEY (`trip_id`) REFERENCES `itineraries`(`trip_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "itinerary_stops_kind_valid" CHECK("duration_kind" in ('hours', 'days'))
);--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_trip` ON `itinerary_stops` (`trip_id`, `seq`);--> statement-breakpoint
CREATE INDEX `idx_itinerary_stops_waypoint` ON `itinerary_stops` (`waypoint_id`);
