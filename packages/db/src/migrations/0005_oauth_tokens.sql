CREATE TABLE IF NOT EXISTS `user_endpoint_tokens` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `endpoint_id` text NOT NULL REFERENCES `endpoints`(`id`) ON DELETE CASCADE,
  `provider` text NOT NULL,
  `access_token` text NOT NULL,
  `refresh_token` text,
  `expires_at` integer,
  `scopes` text,
  `token_type` text DEFAULT 'bearer',
  `status` text DEFAULT 'active',
  `last_used_at` integer,
  `last_refreshed_at` integer,
  `metadata` text,
  `created_at` integer,
  `updated_at` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_endpoint_provider` ON `user_endpoint_tokens` (`user_id`, `endpoint_id`, `provider`);
CREATE INDEX IF NOT EXISTS `idx_uet_user` ON `user_endpoint_tokens` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_uet_endpoint` ON `user_endpoint_tokens` (`endpoint_id`);
CREATE INDEX IF NOT EXISTS `idx_uet_status` ON `user_endpoint_tokens` (`status`);
