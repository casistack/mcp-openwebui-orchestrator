import { z } from 'zod';
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

  // --- Stats ---
  stats: protectedProcedure.query(async ({ ctx }) => {
    const [servers, namespaces, endpoints] = await Promise.all([
      ctx.services.serverService.getServerCount(),
      ctx.services.namespaceService.getNamespaceCount(),
      ctx.services.endpointService.getEndpointCount(),
    ]);
    return { servers, namespaces, endpoints, timestamp: new Date() };
  }),
});

export type AppRouter = typeof appRouter;
