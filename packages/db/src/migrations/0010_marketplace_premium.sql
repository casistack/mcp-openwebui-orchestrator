CREATE TABLE `marketplace_listing_pricing` (
  `id` text PRIMARY KEY NOT NULL,
  `listing_id` text NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
  `tier` text NOT NULL DEFAULT 'free',
  `price` real DEFAULT 0,
  `currency` text DEFAULT 'USD',
  `billing_model` text DEFAULT 'one-time',
  `billing_interval` text,
  `trial_days` integer DEFAULT 0,
  `seat_limit` integer,
  `features` text,
  `created_at` integer,
  `updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listing_pricing_unique` ON `marketplace_listing_pricing` (`listing_id`);
--> statement-breakpoint
CREATE TABLE `marketplace_licenses` (
  `id` text PRIMARY KEY NOT NULL,
  `listing_id` text NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `license_key` text NOT NULL,
  `tier` text NOT NULL,
  `seats_used` integer DEFAULT 0,
  `seats_total` integer,
  `status` text NOT NULL DEFAULT 'active',
  `expires_at` integer,
  `created_at` integer,
  `updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `license_key_unique` ON `marketplace_licenses` (`license_key`);
--> statement-breakpoint
CREATE INDEX `license_listing_idx` ON `marketplace_licenses` (`listing_id`);
--> statement-breakpoint
CREATE INDEX `license_user_idx` ON `marketplace_licenses` (`user_id`);
--> statement-breakpoint
CREATE INDEX `license_status_idx` ON `marketplace_licenses` (`status`);
--> statement-breakpoint
CREATE TABLE `org_marketplace_access` (
  `id` text PRIMARY KEY NOT NULL,
  `org_owner_id` text NOT NULL REFERENCES `users`(`id`),
  `listing_id` text NOT NULL REFERENCES `marketplace_listings`(`id`) ON DELETE CASCADE,
  `access_level` text NOT NULL DEFAULT 'install',
  `approved_at` integer,
  `approved_by` text,
  `created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_listing_access_unique` ON `org_marketplace_access` (`org_owner_id`, `listing_id`);
--> statement-breakpoint
CREATE INDEX `org_access_owner_idx` ON `org_marketplace_access` (`org_owner_id`);
--> statement-breakpoint
CREATE TABLE `org_marketplace_members` (
  `id` text PRIMARY KEY NOT NULL,
  `org_owner_id` text NOT NULL REFERENCES `users`(`id`),
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `role` text NOT NULL DEFAULT 'member',
  `created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_member_unique` ON `org_marketplace_members` (`org_owner_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `org_member_owner_idx` ON `org_marketplace_members` (`org_owner_id`);
--> statement-breakpoint
CREATE INDEX `org_member_user_idx` ON `org_marketplace_members` (`user_id`);
