CREATE TABLE `content` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`year` integer NOT NULL,
	`type` text NOT NULL,
	`imdb_id` text,
	`tmdb_id` text,
	`poster` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `uq_content_imdb` UNIQUE(`imdb_id`,`type`),
	CONSTRAINT `uq_content_tmdb` UNIQUE(`tmdb_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `provider_content` (
	`id` text PRIMARY KEY,
	`content_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`year` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_provider_content_content_id_content_id_fk` FOREIGN KEY (`content_id`) REFERENCES `content`(`id`)
);
--> statement-breakpoint
CREATE TABLE `stream` (
	`id` text PRIMARY KEY,
	`provider_content_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	`season` text NOT NULL,
	`episode` text NOT NULL,
	`url` text NOT NULL CONSTRAINT `uq_stream_url` UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ttl` integer,
	CONSTRAINT `fk_stream_provider_content_id_provider_content_id_fk` FOREIGN KEY (`provider_content_id`) REFERENCES `provider_content`(`id`)
);
--> statement-breakpoint
CREATE TABLE `subtitle` (
	`id` text PRIMARY KEY,
	`provider_content_id` text NOT NULL,
	`season` text,
	`episode` text,
	`url` text NOT NULL,
	`lang` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ttl` integer,
	CONSTRAINT `fk_subtitle_provider_content_id_provider_content_id_fk` FOREIGN KEY (`provider_content_id`) REFERENCES `provider_content`(`id`),
	CONSTRAINT `uq_subtitles_provider_season_episode_lang` UNIQUE(`provider_content_id`,`season`,`episode`,`lang`)
);
--> statement-breakpoint
CREATE INDEX `idx_provider_content_external_id` ON `provider_content` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `idx_provider_content_content_id` ON `provider_content` (`content_id`);--> statement-breakpoint
CREATE INDEX `idx_stream_provider_id` ON `stream` (`provider_content_id`);--> statement-breakpoint
CREATE INDEX `idx_subtitle_provider_id` ON `subtitle` (`provider_content_id`);