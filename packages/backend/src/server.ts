import { createServer } from 'http';
import { createApp } from './app.js';

const PORT = parseInt(process.env.MANAGER_PORT ?? process.env.PORT ?? '3001', 10);

async function main() {
  const { app, wsBroadcaster } = await createApp({
    databaseUrl: process.env.DATABASE_URL,
    configPath: process.env.CLAUDE_CONFIG_PATH,
  });

  const server = createServer(app);

  // Attach WebSocket server for real-time events
  wsBroadcaster.attach(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP Platform running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start MCP Platform:', err);
  process.exit(1);
});
