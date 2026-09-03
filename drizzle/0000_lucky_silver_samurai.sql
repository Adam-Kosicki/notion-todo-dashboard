CREATE TABLE `app_meta` (
	`owner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`owner_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`owner_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'Not started' NOT NULL,
	`burner` text,
	`priority` real,
	`priority_level` text,
	`item_type` text DEFAULT 'Task' NOT NULL,
	`source` text,
	`due` text,
	`scheduled_for` text,
	`energy` text,
	`context` text,
	`area` text,
	`project` text,
	`goal` text,
	`original_notes` text,
	`last_interaction` text,
	`last_nudge` text,
	`attention_score` real DEFAULT 0 NOT NULL,
	`staleness_days` real DEFAULT 0 NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`todoist_id` text,
	`show_in_todoist` integer DEFAULT false NOT NULL,
	`dirty` integer DEFAULT false NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_items_owner_status_burner` ON `items` (`owner_id`,`status`,`burner`);--> statement-breakpoint
CREATE INDEX `idx_items_owner_priority` ON `items` (`owner_id`,`priority`);