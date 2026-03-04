CREATE TABLE IF NOT EXISTS `health_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL REFERENCES `mcp_servers`(`id`) ON DELETE CASCADE,
	`alert_type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`remediation` text,
	`resolved_at` integer,
	`created_at` integer
);
