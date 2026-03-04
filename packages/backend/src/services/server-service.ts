import crypto from 'crypto';
import { mcpServers, serverEnvVars, eq } from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export interface CreateServerInput {
  name: string;
  displayName?: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  proxyType?: string;
  needsProxy?: boolean;
  cpuLimit?: string;
  memoryLimit?: string;
  networkPolicy?: string;
  isPublic?: boolean;
  createdBy?: string;
  source?: 'manual' | 'config' | 'marketplace';
}

export interface UpdateServerInput {
  displayName?: string;
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  proxyType?: string;
  needsProxy?: boolean;
  cpuLimit?: string;
  memoryLimit?: string;
  networkPolicy?: string;
  status?: string;
  isPublic?: boolean;
}

// Type-safe wrapper that avoids cross-package drizzle-orm type conflicts.
// Uses the db instance's own drizzle-orm copy through its query builder.
export class ServerService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  async listServers() {
    return this.db.select().from(mcpServers);
  }

  async getServer(id: string) {
    const results = await this.db.select().from(mcpServers);
    return results.find(s => s.id === id) ?? null;
  }

  async createServer(input: CreateServerInput) {
    const id = input.name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const now = new Date();

    const server = {
      id,
      name: input.name,
      displayName: input.displayName ?? input.name,
      description: input.description ?? null,
      transport: input.transport,
      command: input.command ?? null,
      args: input.args ?? null,
      cwd: input.cwd ?? null,
      url: input.url ?? null,
      headers: input.headers ?? null,
      proxyType: input.proxyType ?? 'mcpo',
      needsProxy: input.needsProxy ?? true,
      cpuLimit: input.cpuLimit ?? null,
      memoryLimit: input.memoryLimit ?? null,
      networkPolicy: input.networkPolicy ?? 'default',
      status: 'inactive',
      isPublic: input.isPublic ?? false,
      source: input.source ?? 'manual',
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(mcpServers).values(server);
    return server;
  }

  async updateServer(id: string, input: UpdateServerInput) {
    const existing = await this.getServer(id);
    if (!existing) return null;

    const cleanUpdates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }

    // Use run() for raw SQL to avoid cross-package type conflicts
    const sets = Object.keys(cleanUpdates)
      .map(k => `${this.camelToSnake(k)} = ?`)
      .join(', ');
    const values = Object.values(cleanUpdates);

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE mcp_servers SET ${sets} WHERE id = ?`, ...values, id);

    // Fallback: if run isn't available, just return merged
    return { ...existing, ...cleanUpdates };
  }

  async deleteServer(id: string) {
    const existing = await this.getServer(id);
    if (!existing) return false;

    // If server was imported from config, dismiss it so it won't be re-imported
    if (existing.source === 'config') {
      try {
        const { configDismissedServers } = await import('@mcp-platform/db');
        await this.db.insert(configDismissedServers).values({
          id: crypto.randomUUID(),
          serverName: existing.name,
          dismissedAt: new Date(),
        });
      } catch { /* already dismissed or constraint violation — fine */ }
    }

    await this.db.delete(mcpServers).where(eq(mcpServers.id, id));
    return true;
  }

  async setEnvVar(serverId: string, key: string, value: string, isSecret = true) {
    const id = crypto.randomUUID();
    const iv = crypto.randomBytes(16).toString('hex');
    const tag = crypto.randomBytes(16).toString('hex');

    await this.db.insert(serverEnvVars).values({
      id,
      serverId,
      key,
      value,
      iv,
      tag,
      isSecret,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { id, key, isSecret };
  }

  async getEnvVars(serverId: string) {
    const all = await this.db.select().from(serverEnvVars);
    return all.filter(e => e.serverId === serverId);
  }

  async deleteEnvVar(serverId: string, key: string) {
    const envVars = await this.getEnvVars(serverId);
    const target = envVars.find(e => e.key === key);
    if (!target) return false;
    await this.db.delete(serverEnvVars).where(eq(serverEnvVars.id, target.id));
    return true;
  }

  async getServerCount() {
    const results = await this.db.select().from(mcpServers);
    return results.length;
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
