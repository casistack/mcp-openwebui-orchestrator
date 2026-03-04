import { createServer } from 'http';
import { createApp } from './app.js';

const PORT = parseInt(process.env.MANAGER_PORT ?? process.env.PORT ?? '3001', 10);

async function main() {
  const { app, wsBroadcaster, serverRuntimeService, runtimeModeManager, connectionManager } = await createApp({
    databaseUrl: process.env.DATABASE_URL,
    configPath: process.env.CLAUDE_CONFIG_PATH,
  });

  const server = createServer(app);

  // Attach WebSocket server for real-time events
  wsBroadcaster.attach(server);

  // Graceful shutdown — prevent orphaned proxy processes
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] Received ${signal}, shutting down...`);

    // Stop runtime processes first (kills MCPO/MCP-Bridge child processes)
    if (runtimeModeManager) {
      try {
        await runtimeModeManager.shutdown();
        console.log('[shutdown] Runtime mode manager stopped');
      } catch (err) {
        console.error('[shutdown] Runtime shutdown error:', (err as Error).message);
      }
    } else if (serverRuntimeService) {
      try {
        await serverRuntimeService.shutdown();
        console.log('[shutdown] Runtime services stopped');
      } catch (err) {
        console.error('[shutdown] Runtime shutdown error:', (err as Error).message);
      }
    }

    // Disconnect MCP protocol connections
    try {
      await connectionManager.disconnectAll();
      console.log('[shutdown] Connections closed');
    } catch {
      // Non-critical
    }

    // Close WebSocket server
    wsBroadcaster.close();

    // Close HTTP server
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown stalls
    setTimeout(() => {
      console.error('[shutdown] Forced exit after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MCP Platform running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start MCP Platform:', err);
  process.exit(1);
});
