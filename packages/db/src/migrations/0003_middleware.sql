CREATE TABLE IF NOT EXISTS `pipeline_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `namespace_id` text NOT NULL REFERENCES `namespaces`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `config` text DEFAULT '{}',
  `enabled` integer DEFAULT 1,
  `order` integer NOT NULL DEFAULT 0,
  `created_at` integer,
  `updated_at` integer
);

CREATE INDEX IF NOT EXISTS `idx_pipeline_steps_namespace` ON `pipeline_steps` (`namespace_id`);
CREATE INDEX IF NOT EXISTS `idx_pipeline_steps_order` ON `pipeline_steps` (`namespace_id`, `order`);
