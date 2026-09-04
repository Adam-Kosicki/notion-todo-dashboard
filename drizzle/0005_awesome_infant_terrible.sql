ALTER TABLE `items` ADD `group_id` text;--> statement-breakpoint
CREATE INDEX `idx_items_owner_group` ON `items` (`owner_id`,`group_id`);