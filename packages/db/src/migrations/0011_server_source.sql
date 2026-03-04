ALTER TABLE mcp_servers ADD COLUMN source TEXT DEFAULT 'manual';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS config_dismissed_servers (
	id TEXT PRIMARY KEY NOT NULL,
	server_name TEXT NOT NULL,
	dismissed_at INTEGER,
	CONSTRAINT config_dismissed_unique UNIQUE (server_name)
);
