CREATE TABLE `lists` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'general' NOT NULL,
	`show_priority` integer,
	`show_long_term_goals` integer,
	`reminder_default` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_lists_owner_name` ON `lists` (`owner_id`,`name`);