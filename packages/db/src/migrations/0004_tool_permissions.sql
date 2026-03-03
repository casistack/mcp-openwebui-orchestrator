CREATE TABLE IF NOT EXISTS `user_tool_permissions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `namespace_id` text NOT NULL REFERENCES `namespaces`(`id`) ON DELETE CASCADE,
  `tool_name` text NOT NULL,
  `allowed` integer NOT NULL DEFAULT 1,
  `created_at` integer,
  `updated_at` integer
);

CREATE INDEX IF NOT EXISTS `idx_user_tool_perms_user` ON `user_tool_permissions` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_user_tool_perms_namespace` ON `user_tool_permissions` (`namespace_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_tool_perms_unique` ON `user_tool_permissions` (`user_id`, `namespace_id`, `tool_name`);
