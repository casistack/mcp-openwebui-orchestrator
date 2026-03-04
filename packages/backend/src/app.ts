import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { createDatabase, runMigrations, type AppDatabase } from '@mcp-platform/db';
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
import { ServerRuntimeService } from './services/server-runtime-service.js';
import { UnifiedRuntimeService } from './services/unified-runtime-service.js';
import { MultiTransportService } from './services/multi-transport-service.js';
import { RuntimeModeManager } from './services/runtime-mode-manager.js';
import { MarketplaceService } from './services/marketplace-service.js';
import { MiddlewarePipeline } from './services/middleware-pipeline.js';
import { ToolPermissionService } from './services/tool-permission-service.js';
import { OAuthTokenService } from './services/oauth-token-service.js';
import { AlertService } from './services/alert-service.js';
import { SystemMetricsService } from './services/system-metrics-service.js';
import { LogRotationService } from './services/log-rotation-service.js';
import rateLimit from 'express-rate-limit';
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
  serverRuntimeService: ServerRuntimeService | null;
  runtimeModeManager: RuntimeModeManager | null;
}> {
  const db = createDatabase({
    type: 'sqlite',
    url: config.databaseUrl ?? process.env.DATABASE_URL ?? 'mcp-platform.db',
  });

  // Run database migrations automatically on startup
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsPath = path.resolve(__dirname, '../../db/src/migrations');
  runMigrations(db, migrationsPath);

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
  const marketplaceService = new MarketplaceService(db);
  const middlewarePipeline = new MiddlewarePipeline(db);
  const toolPermissionService = new ToolPermissionService(db);
  const oauthTokenService = new OAuthTokenService(db);
  const alertService = new AlertService(db, healthService);
  const wsBroadcaster = new WSBroadcaster();
  const connectionManager = new ConnectionManager(serverService, toolConfigService);
  connectionManager.setHealthService(healthService);
  wsBroadcaster.wireConnectionManager(connectionManager);
  wsBroadcaster.wireAlertService(alertService);

  // Server runtime services (spawns and manages MCPO/MCP-Bridge processes)
  const runtimeEnabled = process.env.ENABLE_SERVER_RUNTIME !== 'false';
  const serverRuntimeService = runtimeEnabled
    ? new ServerRuntimeService(serverService, healthService, secretsService, db)
    : null;
  const unifiedRuntimeService = runtimeEnabled
    ? new UnifiedRuntimeService(serverService, healthService, secretsService, db)
    : null;
  const multiTransportService = runtimeEnabled
    ? new MultiTransportService(serverService, healthService, secretsService, db)
    : null;
  const runtimeModeManager = (runtimeEnabled && serverRuntimeService && unifiedRuntimeService && multiTransportService)
    ? new RuntimeModeManager(serverRuntimeService, unifiedRuntimeService, multiTransportService, db)
    : null;

  // Coordinate runtime events with connection manager
  if (serverRuntimeService) {
    serverRuntimeService.on('process:started', async (data: Record<string, unknown>) => {
      const { serverId, port } = data;
      if (typeof serverId === 'string' && typeof port === 'number') {
        try {
          await connectionManager.connect({
            id: serverId,
            transport: 'sse' as const,
            url: `http://localhost:${port}/sse`,
          });
        } catch { /* connection will be retried by health checks */ }
      }
    });

    serverRuntimeService.on('process:stopped', async (data: Record<string, unknown>) => {
      const { serverId } = data;
      if (typeof serverId === 'string') {
        try {
          await connectionManager.disconnect(serverId);
        } catch { /* already disconnected */ }
      }
    });

    serverRuntimeService.on('process:crashed', async (data: Record<string, unknown>) => {
      const { serverId } = data;
      if (typeof serverId === 'string') {
        try {
          await connectionManager.disconnect(serverId);
        } catch { /* already disconnected */ }
      }
    });
  }

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

  // Admin routes with higher rate limits (user management, roles, audit logs, sandbox, secrets)
  const adminLimiter = rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.RATE_LIMIT_ADMIN ?? '100', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-forwarded-for'] as string ?? req.ip ?? 'unknown',
    message: { error: 'Too many admin requests, please try again later' },
  });
  app.use('/api/v1/admin', adminLimiter, createAdminRouter(auth, {
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

  // Rate limiting on tRPC endpoints
  const trpcMutationLimiter = rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.RATE_LIMIT_MUTATIONS ?? '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-forwarded-for'] as string ?? req.ip ?? 'unknown',
    skip: (req) => req.method === 'GET', // Only limit mutations (POST)
    message: { error: 'Too many requests, please try again later' },
  });
  const trpcReadLimiter = rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.RATE_LIMIT_READS ?? '200', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-forwarded-for'] as string ?? req.ip ?? 'unknown',
    skip: (req) => req.method !== 'GET', // Only limit reads (GET)
    message: { error: 'Too many requests, please try again later' },
  });
  app.use('/api/trpc', trpcMutationLimiter, trpcReadLimiter);

  // tRPC endpoint for type-safe frontend communication
  app.use(
    '/api/trpc',
    trpcExpress.createExpressMiddleware({
      router: appRouter,
      createContext: createTRPCContext(auth, {
        serverService,
        namespaceService,
        endpointService,
        toolConfigService,
        apiKeyService,
        connectionManager,
        healthService,
        serverRuntimeService,
        runtimeModeManager,
        marketplaceService,
        middlewarePipeline,
        toolPermissionService,
        oauthTokenService,
        alertService,
      }, db),
    }),
  );

  // OpenAPI spec and interactive docs
  app.use('/api', createOpenAPIRouter());

  // System metrics and log rotation
  const systemMetrics = new SystemMetricsService(db, connectionManager, serverRuntimeService);
  const logRotation = new LogRotationService(db, {
    healthRecordsDays: parseInt(process.env.RETENTION_HEALTH_DAYS ?? '30', 10),
    runtimeLogsDays: parseInt(process.env.RETENTION_RUNTIME_DAYS ?? '14', 10),
    auditLogsDays: parseInt(process.env.RETENTION_AUDIT_DAYS ?? '90', 10),
  });
  logRotation.start();

  // Auth check endpoint
  app.get('/api/auth/ok', (_req, res) => {
    res.json({ ok: true });
  });

  // System metrics endpoint (for monitoring)
  app.get('/api/system/metrics', async (_req, res) => {
    try {
      const metrics = await systemMetrics.getMetrics();
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: 'Failed to collect metrics' });
    }
  });

  // Serve SvelteKit frontend in production via adapter-node handler
  const webBuildPath = path.resolve(__dirname, '../../web/build');
  const handlerPath = path.join(webBuildPath, 'handler.js');
  if (fs.existsSync(handlerPath)) {
    const { handler } = await import(handlerPath);
    app.use(handler);
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

  // Load middleware pipelines from DB into memory
  middlewarePipeline.loadAllPipelines().catch(() => { /* non-critical */ });

  // Wire runtime events to WebSocket broadcaster
  if (serverRuntimeService) wsBroadcaster.wireRuntimeEvents(serverRuntimeService);
  if (runtimeModeManager) wsBroadcaster.wireRuntimeEvents(runtimeModeManager);

  // Initialize runtime mode manager and auto-start servers
  if (runtimeModeManager) {
    runtimeModeManager.initialize().then(async () => {
      const mode = runtimeModeManager.getMode();
      console.log(`Runtime mode: ${mode}`);
      runtimeModeManager.startHealthMonitoring();
      try {
        const { started, failed } = await runtimeModeManager.startAll();
        if (started > 0 || failed > 0) {
          console.log(`Server runtime auto-start (${mode}): ${started} started, ${failed} failed`);
        }
      } catch { /* non-critical */ }
    }).catch(() => { /* non-critical */ });
  } else if (serverRuntimeService) {
    // Fallback: if mode manager isn't available, use individual service directly
    serverRuntimeService.startHealthMonitoring();
    serverRuntimeService.startAll().then(({ started, failed }) => {
      if (started > 0 || failed > 0) {
        console.log(`Server runtime auto-start: ${started} started, ${failed} failed`);
      }
    }).catch(() => { /* non-critical */ });
  }

  return { app, db, auth, serverService, rbacService, connectionManager, wsBroadcaster, healthService, serverRuntimeService, runtimeModeManager };
}

async function autoImportServers(
  db: AppDatabase,
  serverService: ServerService,
  configPath?: string,
) {
  try {
    const count = await serverService.getServerCount();
    if (count > 0) return;

    // Check for dismissed servers (ones the user previously deleted)
    const { configDismissedServers } = await import('@mcp-platform/db');
    const dismissed = await db.select().from(configDismissedServers);
    const dismissedNames = new Set(dismissed.map(d => d.serverName));

    const cfgPath = configPath ?? process.env.CLAUDE_CONFIG_PATH ?? '/config/claude_desktop_config.json';
    const parser = new ConfigParser(cfgPath);
    const servers = await parser.getMCPServers();

    if (servers.length === 0) return;

    const toImport = servers.filter(s => !dismissedNames.has(s.name || s.id));
    if (toImport.length === 0) return;

    console.log(`Auto-importing ${toImport.length} servers from Claude Desktop config (${dismissed.length} dismissed)...`);

    for (const server of toImport) {
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
          source: 'config',
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
