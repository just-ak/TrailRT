-- Phase 11: linked folders, the file index and photo metadata. Design §2,
-- ADR 0020.
--
-- Hand-written, like 0002 to 0005. Three new tables and no change to any
-- existing one. `waypoints.source` gains the value 'photo', but that column
-- has no CHECK, so only the TypeScript type changes.
--
-- Nothing here is the only copy of anything. The photos stay in the user's
-- folder; the index and the metadata are rebuilt from it by a rescan.

-- A folder on disk linked to a trip. Whether it is reachable is worked out at
-- runtime, never stored: a stored "missing" flag would be wrong the moment the
-- drive came back.
CREATE TABLE `linked_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`path` text NOT NULL,
	`real_path` text NOT NULL,
	`name` text NOT NULL,
	`include_subfolders` integer DEFAULT true NOT NULL,
	`last_scan_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `uq_linked_folders_trip_path` UNIQUE(`trip_id`, `real_path`)
);--> statement-breakpoint
CREATE INDEX `idx_linked_folders_trip` ON `linked_folders` (`trip_id`);--> statement-breakpoint

-- The file index: every recognised file, of any kind. Phase 11 reads photos;
-- GPX (Phase 12) and video (Phase 13) build on the same rows. `mtime_ms` is
-- REAL because `stat` reports fractional milliseconds and the scanner compares
-- it exactly.
CREATE TABLE `folder_files` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`kind` text NOT NULL,
	`format` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime_ms` real NOT NULL,
	`fingerprint` text,
	FOREIGN KEY (`folder_id`) REFERENCES `linked_folders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `uq_folder_files_path` UNIQUE(`folder_id`, `relative_path`),
	CONSTRAINT "folder_files_kind_valid" CHECK("kind" in ('photo', 'geodata', 'video'))
);--> statement-breakpoint
CREATE INDEX `idx_folder_files_kind` ON `folder_files` (`folder_id`, `kind`);--> statement-breakpoint
CREATE INDEX `idx_folder_files_fingerprint` ON `folder_files` (`folder_id`, `fingerprint`);--> statement-breakpoint

-- What was read from a photo. Absent values are NULL, never 0: no altitude is
-- not sea level, and no location is not 0°, 0°.
CREATE TABLE `photo_metadata` (
	`file_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`lat` real,
	`lon` real,
	`altitude_m` real,
	`accuracy_m` real,
	`direction_deg` real,
	`direction_ref` text,
	`taken_local` text,
	`taken_offset_min` integer,
	`orientation` integer,
	FOREIGN KEY (`file_id`) REFERENCES `folder_files`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "photo_metadata_state_valid" CHECK("state" in ('located', 'unlocated', 'unreadable', 'not-downloaded')),
	CONSTRAINT "photo_metadata_coordinates_paired" CHECK(("lat" is null) = ("lon" is null)),
	CONSTRAINT "photo_metadata_located_has_position" CHECK("state" <> 'located' or "lat" is not null),
	CONSTRAINT "photo_metadata_direction_paired" CHECK(("direction_deg" is null) = ("direction_ref" is null)),
	CONSTRAINT "photo_metadata_direction_ref_valid" CHECK("direction_ref" is null or "direction_ref" in ('T', 'M')),
	CONSTRAINT "photo_metadata_orientation_valid" CHECK("orientation" is null or "orientation" between 1 and 8)
);--> statement-breakpoint
CREATE INDEX `idx_photo_metadata_taken` ON `photo_metadata` (`taken_local`);--> statement-breakpoint
CREATE INDEX `idx_photo_metadata_state` ON `photo_metadata` (`state`);
