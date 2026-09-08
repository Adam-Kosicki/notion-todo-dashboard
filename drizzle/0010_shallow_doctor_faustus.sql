CREATE TABLE `period_commitments` (
	`owner_id` text NOT NULL,
	`period_id` text NOT NULL,
	`item_id` text NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`withdrawn_at` text,
	`withdrawal_reason` text,
	PRIMARY KEY(`owner_id`, `period_id`, `item_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_period_commitments_owner_period` ON `period_commitments` (`owner_id`,`period_id`);--> statement-breakpoint
CREATE TABLE `planning_periods` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`period_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_planning_periods_owner_type_start_unique` ON `planning_periods` (`owner_id`,`period_type`,`start_date`);