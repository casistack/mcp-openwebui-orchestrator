import { Router, type Request, type Response } from 'express';
import type { Auth } from '../services/auth.js';
import type { RBACService } from '../services/rbac-service.js';
import type { SandboxService, SandboxConfig } from '../services/sandbox-service.js';
import type { SecretsService } from '../services/secrets-service.js';
import type { ServerService } from '../services/server-service.js';
import type { NamespaceService } from '../services/namespace-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRBACMiddleware } from '../middleware/rbac.js';
import type { AppDatabase } from '@mcp-platform/db';
import { auditLogs } from '@mcp-platform/db';

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param ?? '';
}

export interface AdminRouterServices {
  rbacService: RBACService;
  sandboxService?: SandboxService;
  secretsService?: SecretsService;
  serverService?: ServerService;
  namespaceService?: NamespaceService;
  db: AppDatabase;
}

export function createAdminRouter(auth: Auth, rbacServiceOrServices: RBACService | AdminRouterServices, dbArg?: AppDatabase): Router {
  // Support both old signature (rbacService, db) and new (services object)
  let rbacService: RBACService;
  let db: AppDatabase;
  let sandboxService: SandboxService | undefined;
  let secretsService: SecretsService | undefined;
  let serverService: ServerService | undefined;
  let namespaceService: NamespaceService | undefined;

  if ('rbacService' in rbacServiceOrServices) {
    const svc = rbacServiceOrServices;
    rbacService = svc.rbacService;
    db = svc.db;
    sandboxService = svc.sandboxService;
    secretsService = svc.secretsService;
    serverService = svc.serverService;
    namespaceService = svc.namespaceService;
  } else {
    rbacService = rbacServiceOrServices;
    db = dbArg!;
  }
  const router = Router();
  const requireAuth = createAuthMiddleware(auth);
  const { requirePermission } = createRBACMiddleware(rbacService, db);

  router.use(requireAuth);

  // --- User Management ---

  router.get('/users', requirePermission('admin.users'), async (_req: Request, res: Response) => {
    try {
      const userList = await rbacService.listUsers();
      res.json({ users: userList, count: userList.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.put('/users/:id/role', requirePermission('admin.users'), async (req: Request, res: Response) => {
    try {
      const userId = getParam(req.params.id);
      const { role } = req.body as { role: string };
      if (!role) {
        res.status(400).json({ error: 'role is required' });
        return;
      }
      const success = await rbacService.assignRole(userId, role);
      if (!success) {
        res.status(404).json({ error: 'User or role not found' });
        return;
      }
      res.json({ success: true, message: `Role "${role}" assigned to user ${userId}` });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Role Management ---

  router.get('/roles', requirePermission('admin.roles'), async (_req: Request, res: Response) => {
    try {
      const roleList = await rbacService.listRoles();
      res.json({ roles: roleList, count: roleList.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/roles/:id/permissions', requirePermission('admin.roles'), async (req: Request, res: Response) => {
    try {
      const roleId = getParam(req.params.id);
      const perms = await rbacService.getRolePermissions(roleId);
      res.json({ permissions: perms, count: perms.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/permissions', requirePermission('admin.roles'), async (_req: Request, res: Response) => {
    try {
      const permList = await rbacService.listPermissions();
      res.json({ permissions: permList, count: permList.length });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Audit Logs ---

  router.get('/audit-logs', requirePermission('audit.read'), async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      const allLogs = await db.select().from(auditLogs);
      // Sort by createdAt descending, apply pagination
      const sorted = allLogs.sort((a, b) => {
        const aTime = a.createdAt?.getTime() ?? 0;
        const bTime = b.createdAt?.getTime() ?? 0;
        return bTime - aTime;
      });
      const paged = sorted.slice(offset, offset + limit);

      res.json({
        auditLogs: paged,
        total: allLogs.length,
        limit,
        offset,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Current User Info ---

  router.get('/me', async (req: Request, res: Response) => {
    try {
      const user = (req as Request & { user?: { id: string } }).user;
      if (!user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const role = await rbacService.getUserRole(user.id);
      const perms = await rbacService.getUserPermissions(user.id);
      res.json({
        userId: user.id,
        role: role ? { id: role.id, name: role.name } : null,
        permissions: Array.from(perms),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Sandbox Management ---

  router.get('/sandbox/containers', requirePermission('admin.system'), async (_req: Request, res: Response) => {
    if (!sandboxService) {
      res.status(501).json({ error: 'Sandbox service not configured' });
      return;
    }
    res.json({ containers: sandboxService.listContainers() });
  });

  router.post('/sandbox/generate', requirePermission('admin.system'), async (req: Request, res: Response) => {
    if (!sandboxService || !serverService) {
      res.status(501).json({ error: 'Sandbox service not configured' });
      return;
    }
    try {
      const { serverId } = req.body as { serverId: string };
      if (!serverId) {
        res.status(400).json({ error: 'serverId is required' });
        return;
      }
      const server = await serverService.getServer(serverId);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      const config: SandboxConfig = {
        serverId: server.id,
        serverName: server.name,
        transport: server.transport,
        command: server.command ?? undefined,
        args: server.args ?? undefined,
        resourceLimits: {
          cpuShares: server.cpuLimit ? parseInt(server.cpuLimit) : undefined,
          memoryMB: server.memoryLimit ? parseInt(server.memoryLimit) : undefined,
        },
      };
      const dockerCmd = sandboxService.generateDockerRunCommand(config);
      res.json({ command: dockerCmd, container: sandboxService.getContainerInfo(serverId) });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.post('/sandbox/namespace-compose', requirePermission('admin.system'), async (req: Request, res: Response) => {
    if (!sandboxService || !serverService || !namespaceService) {
      res.status(501).json({ error: 'Sandbox or namespace service not configured' });
      return;
    }
    try {
      const { namespaceId } = req.body as { namespaceId: string };
      if (!namespaceId) {
        res.status(400).json({ error: 'namespaceId is required' });
        return;
      }
      const ns = await namespaceService.getNamespace(namespaceId);
      if (!ns) {
        res.status(404).json({ error: 'Namespace not found' });
        return;
      }
      const servers = await namespaceService.listServers(namespaceId);
      const configs: SandboxConfig[] = servers.map(s => ({
        serverId: s.id,
        serverName: s.name,
        transport: s.transport,
        command: s.command ?? undefined,
        args: s.args ?? undefined,
      }));
      const compose = sandboxService.generateNamespaceCompose(ns.slug, configs);
      res.json(compose);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // --- Secrets Management ---

  router.post('/secrets/rotate-key', requirePermission('admin.system'), async (req: Request, res: Response) => {
    if (!secretsService) {
      res.status(501).json({ error: 'Secrets service not configured' });
      return;
    }
    try {
      const { newMasterKey } = req.body as { newMasterKey: string };
      if (!newMasterKey || newMasterKey.length < 16) {
        res.status(400).json({ error: 'newMasterKey must be at least 16 characters' });
        return;
      }
      const result = await secretsService.rotateKey(newMasterKey);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  return router;
}
