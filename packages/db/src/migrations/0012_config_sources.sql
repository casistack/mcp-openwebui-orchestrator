CREATE TABLE IF NOT EXISTS config_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  auto_sync INTEGER DEFAULT 0,
  sync_interval_minutes INTEGER DEFAULT 60,
  last_sync_at INTEGER,
  last_sync_status TEXT,
  last_sync_error TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS source_servers (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES config_sources(id) ON DELETE CASCADE,
  server_key TEXT NOT NULL,
  server_name TEXT NOT NULL,
  server_config TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  imported_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER,
  updated_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS source_server_unique ON source_servers(source_id, server_key);
