import { initTRPC } from '@trpc/server';
import type * as trpcExpress from '@trpc/server/adapters/express';
import type { ServerService } from '../services/server-service.js';
import type { NamespaceService } from '../services/namespace-service.js';
import type { EndpointService } from '../services/endpoint-service.js';
import type { ToolConfigService } from '../services/tool-config-service.js';
import type { ApiKeyService } from '../services/api-key-service.js';

export interface TRPCContext {
  user?: { id: string };
  services: {
    serverService: ServerService;
    namespaceService: NamespaceService;
    endpointService: EndpointService;
    toolConfigService: ToolConfigService;
    apiKeyService: ApiKeyService;
  };
}

export function createTRPCContext(services: TRPCContext['services']) {
  return ({ req }: trpcExpress.CreateExpressContextOptions): TRPCContext => {
    const user = (req as typeof req & { user?: { id: string } }).user;
    return { user, services };
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
