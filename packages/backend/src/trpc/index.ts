import { initTRPC } from '@trpc/server';
import type * as trpcExpress from '@trpc/server/adapters/express';
import type { ServerService } from '../services/server-service.js';
import type { NamespaceService } from '../services/namespace-service.js';
import type { EndpointService } from '../services/endpoint-service.js';
import type { ToolConfigService } from '../services/tool-config-service.js';
import type { ApiKeyService } from '../services/api-key-service.js';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { HealthService } from '../services/health-service.js';
import type { ServerRuntimeService } from '../services/server-runtime-service.js';
import type { RuntimeModeManager } from '../services/runtime-mode-manager.js';
import type { MarketplaceService } from '../services/marketplace-service.js';
import type { MiddlewarePipeline } from '../services/middleware-pipeline.js';
import type { ToolPermissionService } from '../services/tool-permission-service.js';
import type { OAuthTokenService } from '../services/oauth-token-service.js';
import type { AlertService } from '../services/alert-service.js';
import type { ConfigSourcesService } from '../services/config-sources-service.js';
import type { AppDatabase } from '@mcp-platform/db';
import type { Auth } from '../services/auth.js';

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
    serverRuntimeService?: ServerRuntimeService | null;
    runtimeModeManager?: RuntimeModeManager | null;
    marketplaceService?: MarketplaceService;
    middlewarePipeline?: MiddlewarePipeline;
    toolPermissionService?: ToolPermissionService;
    oauthTokenService?: OAuthTokenService;
    alertService?: AlertService;
    configSourcesService?: ConfigSourcesService;
  };
}

export function createTRPCContext(auth: Auth, services: TRPCContext['services'], db?: AppDatabase) {
  return async ({ req }: trpcExpress.CreateExpressContextOptions): Promise<TRPCContext> => {
    let user: { id: string } | undefined;
    try {
      const session = await auth.api.getSession({
        headers: req.headers as Record<string, string>,
      });
      if (session?.user) {
        user = { id: session.user.id };
      }
    } catch {
      // No valid session — user stays undefined
    }
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
