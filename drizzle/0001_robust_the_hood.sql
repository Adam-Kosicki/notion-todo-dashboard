ALTER TABLE `items` ADD `collection` text;--> statement-breakpoint
CREATE INDEX `idx_items_owner_collection` ON `items` (`owner_id`,`collection`);