import crypto from 'crypto';
import { apiKeys, eq } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  scope?: 'user' | 'namespace' | 'endpoint';
  namespaceId?: string;
  endpointId?: string;
  rateLimit?: number;
  expiresAt?: Date;
}

export class ApiKeyService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async createApiKey(input: CreateApiKeyInput) {
    const id = crypto.randomUUID();
    const rawKey = `mcp_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 12);

    const apiKey = {
      id,
      userId: input.userId,
      name: input.name,
      keyHash,
      keyPrefix,
      scope: input.scope ?? 'user',
      namespaceId: input.namespaceId ?? null,
      endpointId: input.endpointId ?? null,
      rateLimit: input.rateLimit ?? 100,
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      isActive: true,
      createdAt: new Date(),
    };

    await this.db.insert(apiKeys).values(apiKey);

    // Return the raw key only on creation - it cannot be retrieved later
    return { ...apiKey, rawKey };
  }

  async validateApiKey(rawKey: string) {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const allKeys = await this.db.select().from(apiKeys);
    const key = allKeys.find(k => k.keyHash === keyHash);

    if (!key) return null;
    if (!key.isActive) return null;
    if (key.expiresAt && key.expiresAt < new Date()) return null;

    // Update last used timestamp
    try {
      await this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
    } catch {
      // Non-critical - continue even if update fails
    }

    return key;
  }

  async listApiKeys(userId: string) {
    const allKeys = await this.db.select().from(apiKeys);
    return allKeys
      .filter(k => k.userId === userId)
      .map(k => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scope: k.scope,
        namespaceId: k.namespaceId,
        endpointId: k.endpointId,
        rateLimit: k.rateLimit,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        isActive: k.isActive,
        createdAt: k.createdAt,
      }));
  }

  async revokeApiKey(id: string, userId: string) {
    const allKeys = await this.db.select().from(apiKeys);
    const key = allKeys.find(k => k.id === id && k.userId === userId);
    if (!key) return false;

    try {
      await this.db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, id));
    } catch {
      return false;
    }
    return true;
  }

  async deleteApiKey(id: string, userId: string) {
    const allKeys = await this.db.select().from(apiKeys);
    const key = allKeys.find(k => k.id === id && k.userId === userId);
    if (!key) return false;

    try {
      await this.db.delete(apiKeys).where(eq(apiKeys.id, id));
    } catch {
      return false;
    }
    return true;
  }
}
