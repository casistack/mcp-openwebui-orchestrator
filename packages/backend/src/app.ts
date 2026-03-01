import path from 'path';
import fs from 'fs';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { createDatabase, type AppDatabase } from '@mcp-platform/db';
import { createAuth } from './services/auth.js';
import { ServerService } from './services/server-service.js';
import { NamespaceService } from './services/namespace-service.js';
import { EndpointService } from './services/endpoint-service.js';
import { ToolConfigService } from './services/tool-config-service.js';
import { ApiKeyService } from './services/api-key-service.js';
import { RBACService } from './services/rbac-service.js';
import { SecretsService } from './services/secrets-service.js';
import { SandboxService } from './services/sandbox-service.js';
import { ConnectionManager } from './services/connection-manager.js';
import { HealthService } from './services/health-service.js';
import { WSBroadcaster } from './services/ws-server.js';
import { createApiV1Router } from './routes/api-v1.js';
import { createApiV1Phase2Router } from './routes/api-v1-phase2.js';
import { createAdminRouter } from './routes/api-v1-admin.js';
import { createImportExportRouter } from './routes/api-v1-import-export.js';
import { ImportExportService } from './services/import-export-service.js';
import { createMCPProtocolRouter } from './routes/mcp-protocol.js';
import { createOpenAPIRouter } from './routes/openapi.js';
import { createAuditMiddleware } from './middleware/audit.js';
import { ConfigParser } from './core/config-parser.js';
import * as trpcExpress from '@trpc/server/adapters/express';
import { appRouter } from './trpc/routers.js';
import { createTRPCContext } from './trpc/index.js';

export interface AppConfig {
  databaseUrl?: string;
  configPath?: string;
}

export async function createApp(config: AppConfig = {}): Promise<{
  app: express.Application;
  db: AppDatabase;
  auth: ReturnType<typeof createAuth>;
  serverService: ServerService;
  rbacService: RBACService;
  connectionManager: ConnectionManager;
  wsBroadcaster: WSBroadcaster;
  healthService: HealthService;
}> {
  const db = createDatabase({
    type: 'sqlite',
    url: config.databaseUrl ?? process.env.DATABASE_URL ?? 'mcp-platform.db',
  });

  const auth = createAuth(db);
  const serverService = new ServerService(db);
  const namespaceService = new NamespaceService(db);
  const endpointService = new EndpointService(db);
  const toolConfigService = new ToolConfigService(db);
  const apiKeyService = new ApiKeyService(db);
  const rbacService = new RBACService(db);
  const secretsService = new SecretsService(db);
  const sandboxService = new SandboxService();
  const healthService = new HealthService(db);
  const wsBroadcaster = new WSBroadcaster();
  const connectionManager = new ConnectionManager(serverService, toolConfigService);
  connectionManager.setHealthService(healthService);
  wsBroadcaster.wireConnectionManager(connectionManager);

  // Seed default RBAC roles/permissions on first run
  await rbacService.seedDefaults();

  const app = express();

  // Better Auth handler MUST be before express.json() per docs
  app.all('/api/auth/{*splat}', toNodeHandler(auth));

  // JSON parsing for everything else
  app.use(express.json({ limit: '10mb' }));

  // Audit logging on mutating requests
  app.use(createAuditMiddleware(db));

  // Authenticated API v1 routes (with RBAC enforcement)
  app.use('/api/v1', createApiV1Router(auth, serverService, {
    namespaceService,
    endpointService,
    secretsService,
    rbacService,
    db,
  }));
  app.use('/api/v1', createApiV1Phase2Router(auth, {
    namespaceService,
    endpointService,
    toolConfigService,
    apiKeyService,
    rbacService,
    db,
  }));

  // Import/export routes
  const importExportService = new ImportExportService(serverService, namespaceService, endpointService);
  app.use('/api/v1', createImportExportRouter(auth, {
    importExportService,
    rbacService,
    db,
  }));

  // Admin routes (user management, roles, audit logs, sandbox, secrets)
  app.use('/api/v1/admin', createAdminRouter(auth, {
    rbacService,
    sandboxService,
    secretsService,
    serverService,
    namespaceService,
    db,
  }));

  // MCP protocol endpoints (SSE + Streamable HTTP on namespaces)
  app.use('/mcp', createMCPProtocolRouter({
    namespaceService,
    endpointService,
    toolConfigService,
    apiKeyService,
    connectionManager,
    wsBroadcaster,
    db,
  }));

  // tRPC endpoint for type-safe frontend communication
  app.use(
    '/api/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: createTRPCContext({
        serverService,
        namespaceService,
        endpointService,
        toolConfigService,
        apiKeyService,
        connectionManager,
        healthService,
      }, db),
    }),
  );

  // OpenAPI spec and interactive docs
  app.use('/api', createOpenAPIRouter());

  // Auth check endpoint
  app.get('/api/auth/ok', (_req, res) => {
    res.json({ ok: true });
  });

  // Serve SvelteKit frontend in production
  const webBuildPath = path.resolve(import.meta.dirname, '../../web/build');
  if (fs.existsSync(webBuildPath)) {
    const clientPath = path.join(webBuildPath, 'client');
    if (fs.existsSync(clientPath)) {
      app.use(express.static(clientPath));
    }
    // SPA fallback: serve index.html for non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const indexPath = path.join(clientPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  // Auto-import on first startup
  await autoImportServers(db, serverService, config.configPath);

  // Auto-connect to all servers and start health monitoring
  connectionManager.connectAll().then(({ connected, failed }) => {
    if (connected > 0 || failed > 0) {
      console.log(`Server connections: ${connected} connected, ${failed} failed`);
    }
  }).catch(() => { /* non-critical */ });
  connectionManager.startHealthChecks();

  return { app, db, auth, serverService, rbacService, connectionManager, wsBroadcaster, healthService };
}

async function autoImportServers(
  db: AppDatabase,
  serverService: ServerService,
  configPath?: string,
) {
  try {
    const count = await serverService.getServerCount();
    if (count > 0) return;

    const path = configPath ?? process.env.CLAUDE_CONFIG_PATH ?? '/config/claude_desktop_config.json';
    const parser = new ConfigParser(path);
    const servers = await parser.getMCPServers();

    if (servers.length === 0) return;

    console.log(`Auto-importing ${servers.length} servers from Claude Desktop config...`);

    for (const server of servers) {
      try {
        await serverService.createServer({
          name: server.name || server.id,
          transport: server.transport,
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          url: server.url,
          headers: server.headers,
          proxyType: server.proxyType,
          needsProxy: server.needsProxy,
        });
        console.log(`  Imported: ${server.id}`);
      } catch (err) {
        console.warn(`  Failed to import ${server.id}: ${(err as Error).message}`);
      }
    }

    console.log('Auto-import complete');
  } catch (error) {
    console.warn('Auto-import skipped:', (error as Error).message);
  }
}
