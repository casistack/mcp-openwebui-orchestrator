-- Server runtime state columns
ALTER TABLE mcp_servers ADD COLUMN runtime_status TEXT DEFAULT 'stopped';
ALTER TABLE mcp_servers ADD COLUMN runtime_pid INTEGER;
ALTER TABLE mcp_servers ADD COLUMN runtime_port INTEGER;
ALTER TABLE mcp_servers ADD COLUMN runtime_proxy_type_used TEXT;
ALTER TABLE mcp_servers ADD COLUMN runtime_started_at INTEGER;
ALTER TABLE mcp_servers ADD COLUMN runtime_restart_count INTEGER DEFAULT 0;
ALTER TABLE mcp_servers ADD COLUMN runtime_last_error TEXT;
ALTER TABLE mcp_servers ADD COLUMN runtime_mode TEXT DEFAULT 'individual';

-- Server runtime logs for process stdout/stderr capture
CREATE TABLE server_runtime_logs (
  id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  stream TEXT NOT NULL DEFAULT 'stdout',
  message TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_runtime_logs_server ON server_runtime_logs(server_id);
CREATE INDEX idx_runtime_logs_time ON server_runtime_logs(created_at);
