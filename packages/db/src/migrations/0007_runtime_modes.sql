CREATE TABLE IF NOT EXISTS `runtime_config` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL DEFAULT 'individual',
	`unified_port` integer,
	`enabled_transports` text,
	`updated_at` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `runtime_config` (`id`, `mode`) VALUES ('default', 'individual');
