import { Router, type Request, type Response } from 'express';
import type { Auth } from '../services/auth.js';
import type { NamespaceService, CreateNamespaceInput, UpdateNamespaceInput } from '../services/namespace-service.js';
import type { EndpointService, CreateEndpointInput, UpdateEndpointInput } from '../services/endpoint-service.js';
import type { ToolConfigService, SetToolConfigInput } from '../services/tool-config-service.js';
import type { ApiKeyService, CreateApiKeyInput } from '../services/api-key-service.js';
import type { RBACService } from '../services/rbac-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRBACMiddleware } from '../middleware/rbac.js';
import type { AppDatabase } from '@mcp-platform/db';

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param ?? '';
}

interface Phase2Services {
  namespaceService: NamespaceService;
  endpointService: EndpointService;
  toolConfigService: ToolConfigService;
  apiKeyService: ApiKeyService;
  rbacService: RBACService;
  db: AppDatabase;
}

export function createApiV1Phase2Router(auth: Auth, services: Phase2Services): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(auth);
  const { requirePermission } = createRBACMiddleware(services.rbacService, services.db);

  router.use(requireAuth);

  const { namespaceService, endpointService, toolConfigService, apiKeyService } = services;

  // --- Namespace CRUD ---

  router.get('/namespaces', requirePermission('namespaces.read'), async (_req: Request, res: Response) => {
    try {
      const nsList = await namespaceService.listNamespaces();
      res.json({ namespaces: nsList, count: nsList.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/namespaces/:id', requirePermission('namespaces.read'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const ns = await namespaceService.getNamespace(id);
      if (!ns) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      res.json(ns);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/namespaces', requirePermission('namespaces.write'), async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateNamespaceInput;
      if (!input.name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const user = (req as Request & { user?: { id: string } }).user;
      const ns = await namespaceService.createNamespace({
        ...input,
        createdBy: user?.id,
      });
      res.status(201).json(ns);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.put('/namespaces/:id', requirePermission('namespaces.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const input = req.body as UpdateNamespaceInput;
      const updated = await namespaceService.updateNamespace(id, input);
      if (!updated) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/namespaces/:id', requirePermission('namespaces.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const deleted = await namespaceService.deleteNamespace(id);
      if (!deleted) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      res.json({ success: true, message: `Namespace ${id} deleted` });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // Namespace server membership
  router.get('/namespaces/:id/servers', requirePermission('namespaces.read'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const servers = await namespaceService.listServers(id);
      res.json({ servers, count: servers.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/namespaces/:id/servers', requirePermission('namespaces.members'), async (req: Request, res: Response) => {
    try {
      const namespaceId = getParam(req.params.id);
      const { serverId } = req.body as { serverId: string };
      if (!serverId) {
        res.status(400).json({ error: 'serverId is required' });
        return;
      }
      const result = await namespaceService.addServer(namespaceId, serverId);
      if (!result) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/namespaces/:nsId/servers/:serverId', requirePermission('namespaces.members'), async (req: Request, res: Response) => {
    try {
      const nsId = getParam(req.params.nsId);
      const serverId = getParam(req.params.serverId);
      const removed = await namespaceService.removeServer(nsId, serverId);
      if (!removed) {
        res.status(404).json({ error: 'Server not found in namespace' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Endpoint CRUD ---

  router.get('/endpoints', requirePermission('endpoints.read'), async (_req: Request, res: Response) => {
    try {
      const list = await endpointService.listEndpoints();
      res.json({ endpoints: list, count: list.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/namespaces/:id/endpoints', requirePermission('endpoints.read'), async (req: Request, res: Response) => {
    try {
      const nsId = getParam(req.params.id);
      const list = await endpointService.listByNamespace(nsId);
      res.json({ endpoints: list, count: list.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/endpoints/:id', requirePermission('endpoints.read'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const ep = await endpointService.getEndpoint(id);
      if (!ep) {
        res.status(404).json({ error: 'Endpoint not found' });
        return;
      }
      res.json(ep);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/endpoints', requirePermission('endpoints.write'), async (req: Request, res: Response) => {
    try {
      const input = req.body as CreateEndpointInput;
      if (!input.namespaceId || !input.name || !input.transport) {
        res.status(400).json({ error: 'namespaceId, name, and transport are required' });
        return;
      }
      const user = (req as Request & { user?: { id: string } }).user;
      const ep = await endpointService.createEndpoint({
        ...input,
        createdBy: user?.id,
      });
      res.status(201).json(ep);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.put('/endpoints/:id', requirePermission('endpoints.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const input = req.body as UpdateEndpointInput;
      const updated = await endpointService.updateEndpoint(id, input);
      if (!updated) {
        res.status(404).json({ error: 'Endpoint not found' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/endpoints/:id', requirePermission('endpoints.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const deleted = await endpointService.deleteEndpoint(id);
      if (!deleted) {
        res.status(404).json({ error: 'Endpoint not found' });
        return;
      }
      res.json({ success: true, message: `Endpoint ${id} deleted` });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Tool Config ---

  router.get('/namespaces/:nsId/servers/:serverId/tools', requirePermission('tools.read'), async (req: Request, res: Response) => {
    try {
      const nsId = getParam(req.params.nsId);
      const serverId = getParam(req.params.serverId);
      const configs = await toolConfigService.getToolConfigs(nsId, serverId);
      res.json({ toolConfigs: configs, count: configs.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/namespaces/:id/tools', requirePermission('tools.read'), async (req: Request, res: Response) => {
    try {
      const nsId = getParam(req.params.id);
      const configs = await toolConfigService.getToolConfigs(nsId);
      res.json({ toolConfigs: configs, count: configs.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/tool-configs', requirePermission('tools.write'), async (req: Request, res: Response) => {
    try {
      const input = req.body as SetToolConfigInput;
      if (!input.namespaceId || !input.serverId || !input.toolName) {
        res.status(400).json({ error: 'namespaceId, serverId, and toolName are required' });
        return;
      }
      const config = await toolConfigService.setToolConfig(input);
      res.status(201).json(config);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/tool-configs/bulk', requirePermission('tools.write'), async (req: Request, res: Response) => {
    try {
      const { configs } = req.body as { configs: SetToolConfigInput[] };
      if (!configs || !Array.isArray(configs)) {
        res.status(400).json({ error: 'configs array is required' });
        return;
      }
      const results = await toolConfigService.bulkSetToolConfigs(configs);
      res.status(201).json({ toolConfigs: results, count: results.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/tool-configs/:id', requirePermission('tools.write'), async (req: Request, res: Response) => {
    try {
      const id = getParam(req.params.id);
      const deleted = await toolConfigService.deleteToolConfig(id);
      if (!deleted) {
        res.status(404).json({ error: 'Tool config not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- API Keys ---

  router.get('/api-keys', requirePermission('apikeys.read'), async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const keys = await apiKeyService.listApiKeys(user.id);
      res.json({ apiKeys: keys, count: keys.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/api-keys', requirePermission('apikeys.write'), async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const input = req.body as Omit<CreateApiKeyInput, 'userId'>;
      if (!input.name) {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      const key = await apiKeyService.createApiKey({
        ...input,
        userId: user.id,
      });
      res.status(201).json(key);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.delete('/api-keys/:id', requirePermission('apikeys.write'), async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const id = getParam(req.params.id);
      const deleted = await apiKeyService.deleteApiKey(id, user.id);
      if (!deleted) {
        res.status(404).json({ error: 'API key not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/api-keys/:id/revoke', requirePermission('apikeys.write'), async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const id = getParam(req.params.id);
      const revoked = await apiKeyService.revokeApiKey(id, user.id);
      if (!revoked) {
        res.status(404).json({ error: 'API key not found' });
        return;
      }
      res.json({ success: true, message: 'API key revoked' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
