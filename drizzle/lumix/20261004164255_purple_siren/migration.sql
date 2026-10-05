CREATE TABLE `search_miss` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ttl` integer,
	CONSTRAINT `uq_search_miss_title` UNIQUE(`title`,`type`)
);
