CREATE TABLE `focus_items` (
	`owner_id` text NOT NULL,
	`item_id` text NOT NULL,
	`selected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`review_until` text,
	PRIMARY KEY(`owner_id`, `item_id`)
);
--> statement-breakpoint
CREATE TABLE `planning_weeks` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`start_date` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`report_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_planning_weeks_owner_start_unique` ON `planning_weeks` (`owner_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `week_commitments` (
	`owner_id` text NOT NULL,
	`week_id` text NOT NULL,
	`item_id` text NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`withdrawn_at` text,
	`withdrawal_reason` text,
	PRIMARY KEY(`owner_id`, `week_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_week_commitments_owner_week` ON `week_commitments` (`owner_id`,`week_id`);