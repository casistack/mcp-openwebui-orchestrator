import crypto from 'crypto';
import { endpoints } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface CreateEndpointInput {
  namespaceId: string;
  name: string;
  transport: 'sse' | 'streamable-http' | 'openapi';
  authType?: 'none' | 'api_key' | 'oauth' | 'bearer';
  oauthConfig?: Record<string, unknown>;
  rateLimit?: number;
  createdBy?: string;
}

export interface UpdateEndpointInput {
  name?: string;
  transport?: 'sse' | 'streamable-http' | 'openapi';
  isActive?: boolean;
  authType?: 'none' | 'api_key' | 'oauth' | 'bearer';
  oauthConfig?: Record<string, unknown>;
  rateLimit?: number;
}

export class EndpointService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async listEndpoints() {
    return this.db.select().from(endpoints);
  }

  async getEndpoint(id: string) {
    const results = await this.db.select().from(endpoints);
    return results.find(e => e.id === id) ?? null;
  }

  async listByNamespace(namespaceId: string) {
    const results = await this.db.select().from(endpoints);
    return results.filter(e => e.namespaceId === namespaceId);
  }

  async createEndpoint(input: CreateEndpointInput) {
    const id = crypto.randomUUID();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    const now = new Date();

    const endpoint = {
      id,
      namespaceId: input.namespaceId,
      name: input.name,
      slug,
      transport: input.transport,
      isActive: true,
      authType: input.authType ?? 'api_key',
      oauthConfig: input.oauthConfig ?? null,
      rateLimit: input.rateLimit ?? 100,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(endpoints).values(endpoint);
    return endpoint;
  }

  async updateEndpoint(id: string, input: UpdateEndpointInput) {
    const existing = await this.getEndpoint(id);
    if (!existing) return null;

    const cleanUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      cleanUpdates.name = input.name;
      cleanUpdates.slug = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    }
    if (input.transport !== undefined) cleanUpdates.transport = input.transport;
    if (input.isActive !== undefined) cleanUpdates.isActive = input.isActive;
    if (input.authType !== undefined) cleanUpdates.authType = input.authType;
    if (input.oauthConfig !== undefined) cleanUpdates.oauthConfig = input.oauthConfig;
    if (input.rateLimit !== undefined) cleanUpdates.rateLimit = input.rateLimit;

    const sets = Object.keys(cleanUpdates)
      .map(k => `${this.camelToSnake(k)} = ?`)
      .join(', ');
    const values = Object.values(cleanUpdates).map(v =>
      typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v,
    );

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE endpoints SET ${sets} WHERE id = ?`, ...values, id);

    return { ...existing, ...cleanUpdates };
  }

  async deleteEndpoint(id: string) {
    const existing = await this.getEndpoint(id);
    if (!existing) return false;

    try {
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(`DELETE FROM endpoints WHERE id = ?`, id);
    } catch {
      return false;
    }
    return true;
  }

  async getEndpointCount() {
    const results = await this.db.select().from(endpoints);
    return results.length;
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
