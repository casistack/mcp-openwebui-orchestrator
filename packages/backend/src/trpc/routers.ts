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

  // --- Marketplace ---
  marketplace: router({
    list: protectedProcedure
      .input(z.object({
        category: z.string().optional(),
        status: z.string().optional(),
        search: z.string().optional(),
        featured: z.boolean().optional(),
      }).optional())
      .query(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) return [];
        return ms.listListings(input);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) return null;
        return ms.getListing(input.id);
      }),

    getBySlug: protectedProcedure
      .input(z.object({ slug: z.string() }))
      .query(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) return null;
        return ms.getListingBySlug(input.slug);
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
        shortDescription: z.string().optional(),
        description: z.string().optional(),
        category: z.string(),
        tags: z.array(z.string()).optional(),
        transport: z.enum(['stdio', 'sse', 'streamable-http']),
        config: z.object({
          command: z.string().optional(),
          args: z.array(z.string()).optional(),
          cwd: z.string().optional(),
          url: z.string().optional(),
          headers: z.record(z.string()).optional(),
          proxyType: z.string().optional(),
          needsProxy: z.boolean().optional(),
        }).optional(),
        version: z.string().optional(),
        requirements: z.object({
          envVars: z.array(z.object({
            key: z.string(),
            description: z.string(),
            required: z.boolean(),
          })).optional(),
          dependencies: z.array(z.string()).optional(),
        }).optional(),
        compatibility: z.array(z.string()).optional(),
        iconUrl: z.string().optional(),
        screenshots: z.array(z.string()).optional(),
      }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.createListing({ ...input, publisherId: ctx.user.id });
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.string(),
        data: z.object({
          name: z.string().optional(),
          shortDescription: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).optional(),
          transport: z.string().optional(),
          config: z.record(z.unknown()).optional(),
          version: z.string().optional(),
          iconUrl: z.string().optional(),
          screenshots: z.array(z.string()).optional(),
          isPublic: z.boolean().optional(),
          status: z.string().optional(),
        }),
      }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.updateListing(input.id, input.data);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.deleteListing(input.id);
      }),

    install: protectedProcedure
      .input(z.object({ listingId: z.string() }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.installListing(input.listingId, ctx.user.id);
      }),

    uninstall: protectedProcedure
      .input(z.object({ installId: z.string() }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.uninstallListing(input.installId);
      }),

    myInstalls: protectedProcedure.query(({ ctx }) => {
      const ms = ctx.services.marketplaceService;
      if (!ms) return [];
      return ms.getUserInstalls(ctx.user.id);
    }),

    reviews: protectedProcedure
      .input(z.object({ listingId: z.string() }))
      .query(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) return [];
        return ms.getReviews(input.listingId);
      }),

    submitReview: protectedProcedure
      .input(z.object({
        listingId: z.string(),
        rating: z.number().min(1).max(5),
        title: z.string().optional(),
        body: z.string().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) throw new Error('Marketplace service not available');
        return ms.submitReview(input.listingId, ctx.user.id, input.rating, input.title, input.body);
      }),

    categories: protectedProcedure.query(({ ctx }) => {
      const ms = ctx.services.marketplaceService;
      if (!ms) return [];
      return ms.getCategories();
    }),

    trending: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(({ ctx, input }) => {
        const ms = ctx.services.marketplaceService;
        if (!ms) return [];
        return ms.getTrending(input?.limit ?? 10);
      }),

    featured: protectedProcedure.query(({ ctx }) => {
      const ms = ctx.services.marketplaceService;
      if (!ms) return [];
      return ms.getFeatured();
    }),
  }),

  // --- Runtime ---
  runtime: router({
    start: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const srs = ctx.services.serverRuntimeService;
        if (!srs) throw new Error('Server runtime service not enabled');
        await srs.startServer(input.serverId);
        return { ok: true };
      }),

    stop: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const srs = ctx.services.serverRuntimeService;
        if (!srs) throw new Error('Server runtime service not enabled');
        await srs.stopServer(input.serverId);
        return { ok: true };
      }),

    restart: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const srs = ctx.services.serverRuntimeService;
        if (!srs) throw new Error('Server runtime service not enabled');
        await srs.restartServer(input.serverId);
        return { ok: true };
      }),

    status: protectedProcedure
      .input(z.object({ serverId: z.string() }))
      .query(({ ctx, input }) => {
        const srs = ctx.services.serverRuntimeService;
        if (!srs) return null;
        return srs.getProcessInfo(input.serverId);
      }),

    listRunning: protectedProcedure.query(({ ctx }) => {
      const srs = ctx.services.serverRuntimeService;
      if (!srs) return [];
      return srs.listRunningProcesses();
    }),

    logs: protectedProcedure
      .input(z.object({ serverId: z.string(), limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        const srs = ctx.services.serverRuntimeService;
        if (!srs) return [];
        return srs.getLogs(input.serverId, input.limit ?? 100);
      }),

    ports: protectedProcedure.query(({ ctx }) => {
      const srs = ctx.services.serverRuntimeService;
      if (!srs) return { allocated: [], stats: { totalPorts: 0, allocatedCount: 0, availableCount: 0, utilization: 0 } };
      const pm = srs.getPortManager();
      return {
        allocated: pm.getAllocatedPorts(),
        stats: pm.getStats(),
      };
    }),

    enabled: protectedProcedure.query(({ ctx }) => {
      return { enabled: ctx.services.serverRuntimeService != null };
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
