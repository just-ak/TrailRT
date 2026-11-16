-- Each imported file's bytes, kept once. ADR 0025.
--
-- Hand-written. Until now `track_sources` held the whole file for every track
-- read from it, so a 24 MB GPX of 342 tracks was stored 342 times. The bytes
-- move to `source_files`, keyed by their SHA-256, and `track_sources` becomes
-- the link from a track to its file. Every original is still kept byte for
-- byte; only the copies go.
--
-- One row per hash is chosen by rowid, so the blobs are never sorted or
-- grouped: grouping would copy every duplicate into a temporary b-tree, which
-- on a large library is gigabytes of temporary disk. `created_at` sits after
-- the blob in the old table, so it is taken from the track instead.
CREATE TABLE `source_files` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`format` text NOT NULL,
	`byte_size` integer NOT NULL,
	`bytes` blob NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);--> statement-breakpoint
INSERT INTO `source_files` (`content_hash`, `format`, `byte_size`, `bytes`)
SELECT `content_hash`, `format`, length(`original_bytes`), `original_bytes`
FROM `track_sources`
WHERE rowid IN (SELECT min(rowid) FROM `track_sources` GROUP BY `content_hash`);--> statement-breakpoint
CREATE TABLE `track_sources_new` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_hash`) REFERENCES `source_files`(`content_hash`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `track_sources_new` (`id`, `track_id`, `content_hash`, `created_at`)
SELECT ts.`id`, ts.`track_id`, ts.`content_hash`, t.`created_at`
FROM `track_sources` ts JOIN `tracks` t ON t.`id` = ts.`track_id`;--> statement-breakpoint
DROP TABLE `track_sources`;--> statement-breakpoint
ALTER TABLE `track_sources_new` RENAME TO `track_sources`;--> statement-breakpoint
CREATE INDEX `idx_track_sources_track` ON `track_sources` (`track_id`);--> statement-breakpoint
CREATE INDEX `idx_track_sources_hash` ON `track_sources` (`content_hash`);--> statement-breakpoint
-- A file goes when the last track read from it goes, however that happens:
-- a track deleted, a trip deleted with its tracks, a restore. SQLite runs
-- this for rows removed by a foreign key's ON DELETE CASCADE too.
CREATE TRIGGER `source_files_unreferenced` AFTER DELETE ON `track_sources`
WHEN NOT EXISTS (SELECT 1 FROM `track_sources` WHERE `content_hash` = OLD.`content_hash`)
BEGIN
	DELETE FROM `source_files` WHERE `content_hash` = OLD.`content_hash`;
END;
