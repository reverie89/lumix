CREATE TABLE `meta` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visit` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`provider` text,
	`client` text,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ip_hash` text,
	`config_hash` text
);
--> statement-breakpoint
CREATE INDEX `idx_visit_ts` ON `visit` (`ts`);