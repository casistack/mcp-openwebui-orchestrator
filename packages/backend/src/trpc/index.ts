import { initTRPC } from '@trpc/server';
import type * as trpcExpress from '@trpc/server/adapters/express';
import type { ServerService } from '../services/server-service.js';
import type { NamespaceService } from '../services/namespace-service.js';
import type { EndpointService } from '../services/endpoint-service.js';
import type { ToolConfigService } from '../services/tool-config-service.js';
import type { ApiKeyService } from '../services/api-key-service.js';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { HealthService } from '../services/health-service.js';
import type { AppDatabase } from '@mcp-platform/db';

export interface TRPCContext {
  user?: { id: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  services: {
    serverService: ServerService;
    namespaceService: NamespaceService;
    endpointService: EndpointService;
    toolConfigService: ToolConfigService;
    apiKeyService: ApiKeyService;
    connectionManager?: ConnectionManager;
    healthService?: HealthService;
  };
}

export function createTRPCContext(services: TRPCContext['services'], db?: AppDatabase) {
  return ({ req }: trpcExpress.CreateExpressContextOptions): TRPCContext => {
    const user = (req as typeof req & { user?: { id: string } }).user;
    return { user, db, services };
  };
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

const authed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new Error('Not authenticated');
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(authed);
