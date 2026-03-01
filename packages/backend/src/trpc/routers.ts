import { z } from 'zod';
import { auditLogs, eq, gte, sql, count, and, desc } from '@mcp-platform/db';
import { router, protectedProcedure } from './index.js';

export const appRouter = router({
  // --- Servers ---
  servers: router({
    list: protectedProcedure.query(({ ctx }) => {
      return ctx.services.serverService.listServers();
    }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(({ ctx, input }) => {
        return ctx.services.serverService.getServer(input.id);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        transport: z.enum(['stdio', 'sse', 'streamable-http']),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        cwd: z.string().optional(),
        url: z.string().optional(),
        headers: z.record(z.string()).optional(),
        proxyType: z.string().optional(),
        needsProxy: z.boolean().optional(),
        isPublic: z.boolean().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.serverService.createServer({
          ...input,
          createdBy: ctx.user.id,
        });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        data: z.object({
          displayName: z.string().optional(),
          description: z.string().optional(),
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          url: z.string().optional(),
          status: z.string().optional(),
          isPublic: z.boolean().optional(),
        }),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.serverService.updateServer(input.id, input.data);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.serverService.deleteServer(input.id);
      }),
  }),

  // --- Namespaces ---
  namespaces: router({
    list: protectedProcedure.query(({ ctx }) => {
      return ctx.services.namespaceService.listNamespaces();
    }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(({ ctx, input }) => {
        return ctx.services.namespaceService.getNamespace(input.id);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        description: z.string().optional(),
        isPublic: z.boolean().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.namespaceService.createNamespace({
          ...input,
          createdBy: ctx.user.id,
        });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        data: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          isPublic: z.boolean().optional(),
        }),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.namespaceService.updateNamespace(input.id, input.data);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.namespaceService.deleteNamespace(input.id);
      }),

    listServers: protectedProcedure
      .input(z.object({ namespaceId: z.string() }))
      .query(({ ctx, input }) => {
        return ctx.services.namespaceService.listServers(input.namespaceId);
      }),

    addServer: protectedProcedure
      .input(z.object({ namespaceId: z.string(), serverId: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.namespaceService.addServer(input.namespaceId, input.serverId);
      }),

    removeServer: protectedProcedure
      .input(z.object({ namespaceId: z.string(), serverId: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.namespaceService.removeServer(input.namespaceId, input.serverId);
      }),
  }),

  // --- Endpoints ---
  endpoints: router({
    list: protectedProcedure.query(({ ctx }) => {
      return ctx.services.endpointService.listEndpoints();
    }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(({ ctx, input }) => {
        return ctx.services.endpointService.getEndpoint(input.id);
      }),

    listByNamespace: protectedProcedure
      .input(z.object({ namespaceId: z.string() }))
      .query(({ ctx, input }) => {
        return ctx.services.endpointService.listByNamespace(input.namespaceId);
      }),

    create: protectedProcedure
      .input(z.object({
        namespaceId: z.string(),
        name: z.string(),
        transport: z.enum(['sse', 'streamable-http', 'openapi']),
        authType: z.enum(['none', 'api_key', 'oauth', 'bearer']).optional(),
        rateLimit: z.number().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.endpointService.createEndpoint({
          ...input,
          createdBy: ctx.user.id,
        });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        data: z.object({
          name: z.string().optional(),
          transport: z.enum(['sse', 'streamable-http', 'openapi']).optional(),
          isActive: z.boolean().optional(),
          authType: z.enum(['none', 'api_key', 'oauth', 'bearer']).optional(),
          rateLimit: z.number().optional(),
        }),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.endpointService.updateEndpoint(input.id, input.data);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.endpointService.deleteEndpoint(input.id);
      }),
  }),

  // --- Tool Configs ---
  toolConfigs: router({
    list: protectedProcedure
      .input(z.object({
        namespaceId: z.string(),
        serverId: z.string().optional(),
      }))
      .query(({ ctx, input }) => {
        return ctx.services.toolConfigService.getToolConfigs(input.namespaceId, input.serverId);
      }),

    set: protectedProcedure
      .input(z.object({
        namespaceId: z.string(),
        serverId: z.string(),
        toolName: z.string(),
        enabled: z.boolean().optional(),
        displayName: z.string().optional(),
        description: z.string().optional(),
        annotations: z.record(z.unknown()).optional(),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.toolConfigService.setToolConfig(input);
      }),

    bulkSet: protectedProcedure
      .input(z.object({
        configs: z.array(z.object({
          namespaceId: z.string(),
          serverId: z.string(),
          toolName: z.string(),
          enabled: z.boolean().optional(),
          displayName: z.string().optional(),
          description: z.string().optional(),
          annotations: z.record(z.unknown()).optional(),
        })),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.toolConfigService.bulkSetToolConfigs(input.configs);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.toolConfigService.deleteToolConfig(input.id);
      }),
  }),

  // --- API Keys ---
  apiKeys: router({
    list: protectedProcedure.query(({ ctx }) => {
      return ctx.services.apiKeyService.listApiKeys(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string(),
        scope: z.enum(['user', 'namespace', 'endpoint']).optional(),
        namespaceId: z.string().optional(),
        endpointId: z.string().optional(),
        rateLimit: z.number().optional(),
        expiresAt: z.date().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return ctx.services.apiKeyService.createApiKey({
          ...input,
          userId: ctx.user.id,
        });
      }),

    revoke: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.apiKeyService.revokeApiKey(input.id, ctx.user.id);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        return ctx.services.apiKeyService.deleteApiKey(input.id, ctx.user.id);
      }),
  }),

  // --- Connections ---
  connections: router({
    list: protectedProcedure.query(({ ctx }) => {
      const cm = ctx.services.connectionManager;
      if (!cm) return [];
      return cm.listConnections().map(c => ({
        serverId: c.serverId,
        status: c.status,
        toolCount: c.tools.length,
        lastPingMs: c.lastPingMs,
        lastError: c.lastError,
        connectTime: c.connectTime,
        reconnectAttempts: c.reconnectAttempts,
      }));
    }),

    connect: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const cm = ctx.services.connectionManager;
        if (!cm) throw new Error('Connection manager not available');
        const server = await ctx.services.serverService.getServer(input.serverId);
        if (!server) throw new Error('Server not found');

        const config = {
          id: server.id,
          transport: server.transport as 'stdio' | 'sse' | 'streamable-http',
          command: server.command ?? undefined,
          args: server.args ?? undefined,
          cwd: server.cwd ?? undefined,
          url: server.url ?? undefined,
          headers: server.headers ?? undefined,
        };

        await cm.connect(config);
        return { ok: true };
      }),

    disconnect: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const cm = ctx.services.connectionManager;
        if (!cm) throw new Error('Connection manager not available');
        await cm.disconnect(input.serverId);
        return { ok: true };
      }),

    discoverTools: protectedProcedure
      .input(z.object({ serverId: z.string(), namespaceId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const cm = ctx.services.connectionManager;
        if (!cm) throw new Error('Connection manager not available');
        const tools = await cm.discoverTools(input.serverId, input.namespaceId);
        return tools.map(t => ({ name: t.name, description: t.description }));
      }),

    ping: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .query(async ({ ctx, input }) => {
        const cm = ctx.services.connectionManager;
        if (!cm) throw new Error('Connection manager not available');
        const client = cm.getClient(input.serverId);
        if (!client) throw new Error('Server not connected');
        return client.ping();
      }),
  }),

  // --- Audit ---
  audit: router({
    toolCallStats: protectedProcedure
      .input(z.object({ hours: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = ctx.db;
        if (!db) return { totalCalls: 0, successCalls: 0, failedCalls: 0, avgDurationMs: 0 };

        const hours = input?.hours ?? 24;
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);

        const rows = await db
          .select({
            totalCalls: count(),
            successCalls: sql<number>`SUM(CASE WHEN ${auditLogs.status} = 'success' THEN 1 ELSE 0 END)`,
            failedCalls: sql<number>`SUM(CASE WHEN ${auditLogs.status} = 'failure' THEN 1 ELSE 0 END)`,
            avgDurationMs: sql<number>`AVG(${auditLogs.durationMs})`,
          })
          .from(auditLogs)
          .where(and(
            eq(auditLogs.action, 'tools/call'),
            gte(auditLogs.createdAt, since),
          ));

        const row = rows[0];
        return {
          totalCalls: row?.totalCalls ?? 0,
          successCalls: row?.successCalls ?? 0,
          failedCalls: row?.failedCalls ?? 0,
          avgDurationMs: row?.avgDurationMs ? Math.round(row.avgDurationMs) : 0,
        };
      }),

    recent: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const db = ctx.db;
        if (!db) return [];

        return db
          .select()
          .from(auditLogs)
          .orderBy(desc(auditLogs.createdAt))
          .limit(input?.limit ?? 50);
      }),
  }),

  // --- Health ---
  health: router({
    stats: protectedProcedure
      .input(z.object({ serverId: z.string(), hours: z.number().optional() }))
      .query(({ ctx, input }) => {
        const hs = ctx.services.healthService;
        if (!hs) throw new Error('Health service not available');
        return hs.getHealthStats(input.serverId, input.hours ?? 24);
      }),

    allStats: protectedProcedure
      .input(z.object({ hours: z.number().optional() }).optional())
      .query(({ ctx, input }) => {
        const hs = ctx.services.healthService;
        if (!hs) throw new Error('Health service not available');
        return hs.getAllHealthStats(input?.hours ?? 24);
      }),

    timeSeries: protectedProcedure
      .input(z.object({
        serverId: z.string(),
        hours: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(({ ctx, input }) => {
        const hs = ctx.services.healthService;
        if (!hs) throw new Error('Health service not available');
        return hs.getHealthTimeSeries(input.serverId, input.hours ?? 24, input.limit ?? 100);
      }),

    recent: protectedProcedure
      .input(z.object({ serverId: z.string(), limit: z.number().optional() }))
      .query(({ ctx, input }) => {
        const hs = ctx.services.healthService;
        if (!hs) throw new Error('Health service not available');
        return hs.getRecentHealth(input.serverId, input.limit ?? 50);
      }),
  }),

  // --- Stats ---
  stats: protectedProcedure.query(async ({ ctx }) => {
    const [servers, namespaces, endpoints] = await Promise.all([
      ctx.services.serverService.getServerCount(),
      ctx.services.namespaceService.getNamespaceCount(),
      ctx.services.endpointService.getEndpointCount(),
    ]);

    const cm = ctx.services.connectionManager;
    const connections = cm ? cm.listConnections() : [];
    const connectedCount = connections.filter(c => c.status === 'connected').length;

    return {
      servers,
      namespaces,
      endpoints,
      connectedServers: connectedCount,
      timestamp: new Date(),
    };
  }),
});

export type AppRouter = typeof appRouter;
