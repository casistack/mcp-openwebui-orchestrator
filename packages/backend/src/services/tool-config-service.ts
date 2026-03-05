import crypto from 'crypto';
import { toolConfigs, eq } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface SetToolConfigInput {
  namespaceId: string;
  serverId: string;
  toolName: string;
  enabled?: boolean;
  displayName?: string;
  description?: string;
  annotations?: Record<string, unknown>;
}

export class ToolConfigService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async getToolConfigs(namespaceId: string, serverId?: string) {
    const results = await this.db.select().from(toolConfigs);
    return results.filter(t => {
      if (t.namespaceId !== namespaceId) return false;
      if (serverId && t.serverId !== serverId) return false;
      return true;
    });
  }

  async getToolConfig(id: string) {
    const results = await this.db.select().from(toolConfigs);
    return results.find(t => t.id === id) ?? null;
  }

  async setToolConfig(input: SetToolConfigInput) {
    const all = await this.db.select().from(toolConfigs);
    const existing = all.find(
      t => t.namespaceId === input.namespaceId &&
           t.serverId === input.serverId &&
           t.toolName === input.toolName,
    );

    if (existing) {
      const cleanUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.enabled !== undefined) cleanUpdates.enabled = input.enabled;
      if (input.displayName !== undefined) cleanUpdates.displayName = input.displayName;
      if (input.description !== undefined) cleanUpdates.description = input.description;
      if (input.annotations !== undefined) cleanUpdates.annotations = input.annotations;

      await this.db.update(toolConfigs).set(cleanUpdates).where(eq(toolConfigs.id, existing.id));

      return { ...existing, ...cleanUpdates };
    }

    const id = crypto.randomUUID();
    const now = new Date();

    const config = {
      id,
      namespaceId: input.namespaceId,
      serverId: input.serverId,
      toolName: input.toolName,
      enabled: input.enabled ?? true,
      displayName: input.displayName ?? null,
      description: input.description ?? null,
      annotations: input.annotations ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(toolConfigs).values(config);
    return config;
  }

  async deleteToolConfig(id: string) {
    const existing = await this.getToolConfig(id);
    if (!existing) return false;

    try {
      await this.db.delete(toolConfigs).where(eq(toolConfigs.id, id));
    } catch {
      return false;
    }
    return true;
  }

  async bulkSetToolConfigs(configs: SetToolConfigInput[]) {
    const results = [];
    for (const config of configs) {
      results.push(await this.setToolConfig(config));
    }
    return results;
  }

}
