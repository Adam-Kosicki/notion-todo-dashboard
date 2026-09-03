ALTER TABLE `items` ADD `date_mode` text;--> statement-breakpoint
ALTER TABLE `items` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `items` ADD `reminder_time` text;--> statement-breakpoint
ALTER TABLE `items` ADD `completed_at` text;--> statement-breakpoint
CREATE INDEX `idx_items_owner_type_status` ON `items` (`owner_id`,`item_type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_items_owner_completed` ON `items` (`owner_id`,`completed_at`);--> statement-breakpoint
PRAGMA optimize;
