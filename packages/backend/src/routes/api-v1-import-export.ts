import { Router, type Request, type Response } from 'express';
import type { Auth } from '../services/auth.js';
import type { ImportExportService } from '../services/import-export-service.js';
import type { RBACService } from '../services/rbac-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRBACMiddleware } from '../middleware/rbac.js';
import type { AppDatabase } from '@mcp-platform/db';

interface ImportExportRouteServices {
  importExportService: ImportExportService;
  rbacService: RBACService;
  db: AppDatabase;
}

export function createImportExportRouter(auth: Auth, services: ImportExportRouteServices): Router {
  const router = Router();
  const requireAuth = createAuthMiddleware(auth);
  const { requirePermission } = createRBACMiddleware(services.rbacService, services.db);

  router.use(requireAuth);

  // POST /api/v1/import/claude-desktop - Import from Claude Desktop JSON config
  router.post('/import/claude-desktop', requirePermission('servers.write'), async (req: Request, res: Response) => {
    try {
      const config = req.body;
      if (!config?.mcpServers || typeof config.mcpServers !== 'object') {
        res.status(400).json({ error: 'Invalid Claude Desktop config: missing mcpServers object' });
        return;
      }
      const userId = (req as unknown as { user?: { id?: string } }).user?.id;
      const result = await services.importExportService.importFromClaudeDesktop(config, userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/v1/import/claude-desktop-file - Import from Claude Desktop config file path
  router.post('/import/claude-desktop-file', requirePermission('admin.system'), async (req: Request, res: Response) => {
    try {
      const { filePath } = req.body;
      if (!filePath || typeof filePath !== 'string') {
        res.status(400).json({ error: 'filePath is required' });
        return;
      }
      const userId = (req as unknown as { user?: { id?: string } }).user?.id;
      const result = await services.importExportService.importFromClaudeDesktopFile(filePath, userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/v1/import/platform - Import from platform-native JSON format
  router.post('/import/platform', requirePermission('admin.system'), async (req: Request, res: Response) => {
    try {
      const data = req.body;
      if (!data?.version || !data?.servers) {
        res.status(400).json({ error: 'Invalid platform export format: missing version or servers' });
        return;
      }
      const userId = (req as unknown as { user?: { id?: string } }).user?.id;
      const result = await services.importExportService.importFromPlatformFormat(data, userId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/v1/export/claude-desktop - Export all servers in Claude Desktop format
  router.get('/export/claude-desktop', requirePermission('servers.read'), async (_req: Request, res: Response) => {
    try {
      const result = await services.importExportService.exportToClaudeDesktop();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/v1/export/platform - Export entire platform config
  router.get('/export/platform', requirePermission('servers.read'), async (_req: Request, res: Response) => {
    try {
      const result = await services.importExportService.exportToPlatformFormat();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
