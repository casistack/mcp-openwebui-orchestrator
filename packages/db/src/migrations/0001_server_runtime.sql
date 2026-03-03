ALTER TABLE mcp_servers ADD COLUMN runtime_status TEXT DEFAULT 'stopped';--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_pid INTEGER;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_port INTEGER;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_proxy_type_used TEXT;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_started_at INTEGER;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_restart_count INTEGER DEFAULT 0;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_last_error TEXT;--> statement-breakpoint
ALTER TABLE mcp_servers ADD COLUMN runtime_mode TEXT DEFAULT 'individual';--> statement-breakpoint
CREATE TABLE server_runtime_logs (
  id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  stream TEXT NOT NULL DEFAULT 'stdout',
  message TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);--> statement-breakpoint
CREATE INDEX idx_runtime_logs_server ON server_runtime_logs(server_id);--> statement-breakpoint
CREATE INDEX idx_runtime_logs_time ON server_runtime_logs(created_at);
