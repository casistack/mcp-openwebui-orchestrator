import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { auditLogs } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

interface AuditUser {
  id: string;
  email?: string;
}

interface AuditableRequest extends Request {
  user?: AuditUser;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function resolveResource(path: string): { resource: string; resourceId: string | null } {
  const segments = path.split('/').filter(Boolean);

  if (segments.length >= 2) {
    return { resource: segments[0], resourceId: segments[1] };
  }
  if (segments.length === 1) {
    return { resource: segments[0], resourceId: null };
  }
  return { resource: 'root', resourceId: null };
}

export function createAuditMiddleware(db: AppDatabase) {
  return async (req: AuditableRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!MUTATING_METHODS.has(req.method)) {
      next();
      return;
    }

    const startTime = Date.now();
    const { resource, resourceId } = resolveResource(req.path);

    const originalEnd = res.end.bind(res);
    res.end = function (...args: Parameters<typeof res.end>) {
      const durationMs = Date.now() - startTime;
      const status = res.statusCode >= 400 ? 'failure' : 'success';

      const entry = {
        id: crypto.randomUUID(),
        userId: req.user?.id ?? null,
        action: `${req.method} ${req.path}`,
        resource,
        resourceId,
        details: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          ...(req.body && Object.keys(req.body as Record<string, unknown>).length > 0
            ? { bodyKeys: Object.keys(req.body as Record<string, unknown>) }
            : {}),
        },
        ipAddress: (req.ip || req.socket.remoteAddress) ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        status,
        durationMs,
      };

      db.insert(auditLogs)
        .values(entry)
        .catch(err => console.error('Failed to write audit log:', (err as Error).message));

      return originalEnd(...args);
    } as typeof res.end;

    next();
  };
}

