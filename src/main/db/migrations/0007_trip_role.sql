-- Phase 14: items outside a trip. ADR 0022, design §5.4.
--
-- Hand-written, like 0002 to 0006. One column and one index; no row changes.
-- Every existing trip becomes role 'trip'. The one holder of items outside a
-- trip has role 'loose', is created on first use, and is never listed as a
-- trip. The partial unique index keeps it to one.
ALTER TABLE `trips` ADD `role` text DEFAULT 'trip' NOT NULL CHECK (`role` in ('trip', 'loose'));
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_trips_one_loose` ON `trips` (`role`) WHERE `role` = 'loose';
