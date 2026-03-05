import crypto from 'crypto';
import { namespaces, namespaceServers, mcpServers, eq, and } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface CreateNamespaceInput {
  name: string;
  description?: string;
  isPublic?: boolean;
  createdBy?: string;
}

export interface UpdateNamespaceInput {
  name?: string;
  description?: string;
  isPublic?: boolean;
}

export class NamespaceService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async listNamespaces() {
    return this.db.select().from(namespaces);
  }

  async getNamespace(id: string) {
    const results = await this.db.select().from(namespaces);
    return results.find(n => n.id === id) ?? null;
  }

  async getNamespaceBySlug(slug: string) {
    const results = await this.db.select().from(namespaces);
    return results.find(n => n.slug === slug) ?? null;
  }

  async createNamespace(input: CreateNamespaceInput) {
    const id = crypto.randomUUID();
    const slug = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    const now = new Date();

    const namespace = {
      id,
      name: input.name,
      slug,
      description: input.description ?? null,
      isPublic: input.isPublic ?? false,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(namespaces).values(namespace);
    return namespace;
  }

  async updateNamespace(id: string, input: UpdateNamespaceInput) {
    const existing = await this.getNamespace(id);
    if (!existing) return null;

    const cleanUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      cleanUpdates.name = input.name;
      cleanUpdates.slug = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');
    }
    if (input.description !== undefined) cleanUpdates.description = input.description;
    if (input.isPublic !== undefined) cleanUpdates.isPublic = input.isPublic;

    await this.db.update(namespaces).set(cleanUpdates).where(eq(namespaces.id, id));

    return { ...existing, ...cleanUpdates };
  }

  async deleteNamespace(id: string) {
    const existing = await this.getNamespace(id);
    if (!existing) return false;

    try {
      await this.db.delete(namespaces).where(eq(namespaces.id, id));
    } catch {
      return false;
    }
    return true;
  }

  async addServer(namespaceId: string, serverId: string) {
    const ns = await this.getNamespace(namespaceId);
    if (!ns) return null;

    const entry = {
      namespaceId,
      serverId,
      addedAt: new Date(),
    };

    await this.db.insert(namespaceServers).values(entry);
    return entry;
  }

  async removeServer(namespaceId: string, serverId: string) {
    try {
      await this.db.delete(namespaceServers).where(
        and(eq(namespaceServers.namespaceId, namespaceId), eq(namespaceServers.serverId, serverId))
      );
      return true;
    } catch {
      return false;
    }
  }

  async listServers(namespaceId: string) {
    const joins = await this.db.select().from(namespaceServers);
    const serverIds = joins.filter(j => j.namespaceId === namespaceId).map(j => j.serverId);
    if (serverIds.length === 0) return [];

    const allServers = await this.db.select().from(mcpServers);
    return allServers.filter(s => serverIds.includes(s.id));
  }

  async getNamespaceCount() {
    const results = await this.db.select().from(namespaces);
    return results.length;
  }

}
