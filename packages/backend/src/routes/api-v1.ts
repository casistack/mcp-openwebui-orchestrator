import { Router, type Request, type Response } from 'express';
import type { Auth } from '../services/auth.js';
import type { ServerService, CreateServerInput, UpdateServerInput } from '../services/server-service.js';
import type { NamespaceService } from '../services/namespace-service.js';
import type { EndpointService } from '../services/endpoint-service.js';
import type { RBACService } from '../services/rbac-service.js';
import type { SecretsService } from '../services/secrets-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRBACMiddleware } from '../middleware/rbac.js';
import type { AppDatabase } from '@mcp-platform/db';

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param ?? '';
}

interface ApiV1Services {
  namespaceService?: NamespaceService;
  endpointService?: EndpointService;
  secretsService?: SecretsService;
  rbacService: RBACService;
  db: AppDatabase;
}

export function createApiV1Router(auth: Auth, serverService: ServerService, services: ApiV1Services): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(auth);
  const { requirePermission } = createRBACMiddleware(services.rbacService, services.db);

  // All /api/v1 routes require authentication
  router.use(requireAuth);

  // Server CRUD
  router.get('/servers', requirePermission('servers.read'), async (_req: Request, res: Response) => {
    try {
      const servers = await serverService.listServers();
      res.json({ servers, count: servers.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/servers/:id', requirePermission('servers.read'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const server = await serverService.getServer(id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json(server);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/servers', requirePermission('servers.write'), async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateServerInput;
      if (!input.name || !input.transport) {
        res.status(400).json({ error: 'name and transport are required' });
        return;
      }

      const user = (req as Request & { user?: { id: string } }).user;
      const server = await serverService.createServer({
        ...input,
        createdBy: user?.id,
      });
      res.status(201).json(server);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.put('/servers/:id', requirePermission('servers.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const input = req.body as UpdateServerInput;
      const updated = await serverService.updateServer(id, input);
      if (!updated) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/servers/:id', requirePermission('servers.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const deleted = await serverService.deleteServer(id);
      if (!deleted) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json({ success: true, message: `Server ${id} deleted` });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Server environment variables (uses SecretsService for encryption when available)
  router.get('/servers/:id/env', requirePermission('servers.env'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const envVars = await serverService.getEnvVars(id);
      const masked = envVars.map(v => ({
        key: v.key,
        isSecret: v.isSecret,
        value: v.isSecret ? '********' : v.value,
        createdAt: v.createdAt,
      }));
      res.json({ serverId: id, envVars: masked });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/servers/:id/env', requirePermission('servers.env'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const { key, value, isSecret } = req.body as { key: string; value: string; isSecret?: boolean };
      if (!key || !value) {
        res.status(400).json({ error: 'key and value are required' });
        return;
      }
      // Use SecretsService for proper AES-256-GCM encryption
      if (services.secretsService) {
        const result = await services.secretsService.setSecret(id, key, value, isSecret ?? true);
        res.status(201).json(result);
      } else {
        const result = await serverService.setEnvVar(id, key, value, isSecret ?? true);
        res.status(201).json(result);
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Get decrypted env vars for a server (for runtime use)
  router.get('/servers/:id/env/decrypted', requirePermission('servers.env'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      if (!services.secretsService) {
        res.status(501).json({ error: 'Secrets service not configured' });
        return;
      }
      const decrypted = await services.secretsService.getDecryptedEnvVars(id);
      res.json({ serverId: id, envVars: decrypted });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Delete env var
  router.delete('/servers/:id/env/:key', requirePermission('servers.env'), async (req: Request, res: Response) => {
    try {
      const serverId = getParam(req.params.id);
      const key = getParam(req.params.key);
      const deleted = await serverService.deleteEnvVar(serverId, key);
      if (!deleted) {
        res.status(404).json({ error: 'Environment variable not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Stats
  router.get('/stats', requirePermission('stats.read'), async (_req: Request, res: Response) => {
    try {
      const serverCount = await serverService.getServerCount();
      const namespaceCount = services?.namespaceService
        ? await services.namespaceService.getNamespaceCount()
        : 0;
      const endpointCount = services?.endpointService
        ? await services.endpointService.getEndpointCount()
        : 0;
      res.json({
        servers: serverCount,
        namespaces: namespaceCount,
        endpoints: endpointCount,
        timestamp: new Date(),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
