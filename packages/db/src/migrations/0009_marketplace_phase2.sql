CREATE TABLE `marketplace_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`curator_id` text NOT NULL REFERENCES `users`(`id`),
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`is_public` integer DEFAULT 1,
	`is_featured` integer DEFAULT 0,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_slug_unique` ON `marketplace_collections` (`slug`);
--> statement-breakpoint
CREATE INDEX `collection_curator_idx` ON `marketplace_collections` (`curator_id`);
--> statement-breakpoint
CREATE TABLE `marketplace_collection_items` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL REFERENCES `marketplace_collections`(`id`) ON DELETE CASCADE,
	`listing_id` text NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
	`note` text,
	`order` integer DEFAULT 0,
	`added_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_item_unique` ON `marketplace_collection_items` (`collection_id`, `listing_id`);
--> statement-breakpoint
CREATE INDEX `collection_item_collection_idx` ON `marketplace_collection_items` (`collection_id`);
--> statement-breakpoint
CREATE TABLE `marketplace_review_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`publisher_id` text NOT NULL REFERENCES `users`(`id`),
	`body` text NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `review_response_review_idx` ON `marketplace_review_responses` (`review_id`);
