import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { RBACService, PermissionName } from '../services/rbac-service.js';
import { auditLogs } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

export function createRBACMiddleware(rbacService: RBACService, db: AppDatabase) {
  function requirePermission(...requiredPermissions: PermissionName[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      for (const permission of requiredPermissions) {
        const allowed = await rbacService.hasPermission(userId, permission);
        if (!allowed) {
          // Log the denied access
          try {
            await db.insert(auditLogs).values({
              id: crypto.randomUUID(),
              userId,
              action: 'access_denied',
              resource: permission,
              resourceId: null,
              details: {
                method: req.method,
                path: req.path,
                requiredPermission: permission,
              },
              ipAddress: req.ip ?? null,
              userAgent: req.get('user-agent') ?? null,
              status: 'denied',
              durationMs: null,
              createdAt: new Date(),
            });
          } catch {
            // Non-critical - don't block the response
          }

          res.status(403).json({
            error: 'Insufficient permissions',
            required: permission,
          });
          return;
        }
      }

      next();
    };
  }

  function requireAnyPermission(...requiredPermissions: PermissionName[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      for (const permission of requiredPermissions) {
        const allowed = await rbacService.hasPermission(userId, permission);
        if (allowed) {
          next();
          return;
        }
      }

      res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermissions,
      });
    };
  }

  return { requirePermission, requireAnyPermission };
}
