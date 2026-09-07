CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`event_type` text NOT NULL,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`request_id` text,
	`before_json` text,
	`after_json` text
);
--> statement-breakpoint
CREATE INDEX `idx_activity_owner_entity` ON `activity_events` (`owner_id`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_owner_timestamp` ON `activity_events` (`owner_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `board_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`storage_mode` text DEFAULT 'legacy_notion' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `command_receipts` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`committed_revision` integer NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`)
);
--> statement-breakpoint
ALTER TABLE `items` ADD `list_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `created_at` text;--> statement-breakpoint
ALTER TABLE `items` ADD `created_at_source` text;--> statement-breakpoint
ALTER TABLE `items` ADD `recorded_at` text;--> statement-breakpoint
ALTER TABLE `items` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `items` ADD `review_state` text;--> statement-breakpoint
ALTER TABLE `items` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_items_owner_list_id` ON `items` (`owner_id`,`list_id`);--> statement-breakpoint
CREATE INDEX `idx_items_owner_deleted` ON `items` (`owner_id`,`deleted_at`);--> statement-breakpoint
-- Hand-added data backfill (not drizzle-generated): recorded_at has no DB-level default
-- (see db/schema.ts's comment on why), so existing rows need an explicit value. Every legacy
-- row gets "now" - the honest answer for "when did the app first record this," since no earlier
-- moment is known for pre-existing rows. New rows always set this explicitly at insert time.
UPDATE `items` SET `recorded_at` = CURRENT_TIMESTAMP WHERE `recorded_at` IS NULL;