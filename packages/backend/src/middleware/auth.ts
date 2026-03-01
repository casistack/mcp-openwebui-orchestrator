import type { Request, Response, NextFunction } from 'express';
import type { Auth } from '../services/auth.js';
import type { ApiKeyService } from '../services/api-key-service.js';

export function createAuthMiddleware(auth: Auth) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await auth.api.getSession({
        headers: req.headers as Record<string, string>,
      });

      if (!session) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      (req as Request & { user?: unknown; session?: unknown }).user = session.user;
      (req as Request & { session?: unknown }).session = session.session;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired session' });
    }
  };
}

export function createApiKeyMiddleware(apiKeyService: ApiKeyService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.status(401).json({ error: 'API key required. Use Authorization: Bearer mcp_... or X-API-Key header.' });
      return;
    }

    try {
      const key = await apiKeyService.validateApiKey(apiKey);
      if (!key) {
        res.status(401).json({ error: 'Invalid or expired API key' });
        return;
      }

      (req as Request & { apiKey?: unknown }).apiKey = key;
      (req as Request & { user?: unknown }).user = { id: key.userId };
      next();
    } catch {
      res.status(401).json({ error: 'API key validation failed' });
    }
  };
}

export function createHybridAuthMiddleware(auth: Auth, apiKeyService: ApiKeyService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Try API key first (for programmatic access)
    const apiKey = extractApiKey(req);
    if (apiKey) {
      try {
        const key = await apiKeyService.validateApiKey(apiKey);
        if (key) {
          (req as Request & { apiKey?: unknown }).apiKey = key;
          (req as Request & { user?: unknown }).user = { id: key.userId };
          next();
          return;
        }
      } catch {
        // Fall through to session auth
      }
    }

    // Fall back to session auth
    try {
      const session = await auth.api.getSession({
        headers: req.headers as Record<string, string>,
      });

      if (!session) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      (req as Request & { user?: unknown; session?: unknown }).user = session.user;
      (req as Request & { session?: unknown }).session = session.session;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  };
}

function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer mcp_')) {
    return authHeader.slice(7);
  }

  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey.startsWith('mcp_')) {
    return xApiKey;
  }

  return null;
}

export function optionalAuth(auth: Auth) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await auth.api.getSession({
        headers: req.headers as Record<string, string>,
      });

      if (session) {
        (req as Request & { user?: unknown; session?: unknown }).user = session.user;
        (req as Request & { session?: unknown }).session = session.session;
      }
    } catch {
      // Silently continue without auth
    }
    next();
  };
}
