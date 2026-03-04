import crypto from 'crypto';
import type { AppDatabase } from '@mcp-platform/db';
import type { ServerService } from './server-service.js';
import { ConfigParser, type ParsedMCPServer } from '../core/config-parser.js';

export interface CreateSourceInput {
  name: string;
  type: 'file' | 'url';
  location: string;
  enabled?: boolean;
  priority?: number;
  autoSync?: boolean;
  syncIntervalMinutes?: number;
}

export interface UpdateSourceInput {
  name?: string;
  location?: string;
  enabled?: boolean;
  priority?: number;
  autoSync?: boolean;
  syncIntervalMinutes?: number;
}

export class ConfigSourcesService {
  private readonly db: AppDatabase;
  private readonly serverService: ServerService;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db: AppDatabase, serverService: ServerService) {
    this.db = db;
    this.serverService = serverService;
  }

  async listSources() {
    const { configSources } = await import('@mcp-platform/db');
    const sources = await this.db.select().from(configSources);
    return sources.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  async getSource(id: string) {
    const { configSources, sourceServers } = await import('@mcp-platform/db');
    const sources = await this.db.select().from(configSources);
    const source = sources.find(s => s.id === id);
    if (!source) return null;

    const allServers = await this.db.select().from(sourceServers);
    const servers = allServers.filter(s => s.sourceId === id);

    return { ...source, servers };
  }

  async createSource(input: CreateSourceInput) {
    const { configSources } = await import('@mcp-platform/db');

    if ((input.type === 'file' || input.type === 'url') && !input.location) {
      throw new Error(`Location is required for ${input.type} sources`);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    const source = {
      id,
      name: input.name,
      type: input.type,
      location: input.location,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
      autoSync: input.autoSync ?? false,
      syncIntervalMinutes: input.syncIntervalMinutes ?? 60,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(configSources).values(source);
    return source;
  }

  async updateSource(id: string, input: UpdateSourceInput) {
    const { configSources, eq } = await import('@mcp-platform/db');
    const existing = await this.getSource(id);
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) updates[key] = value;
    }

    const sets = Object.keys(updates)
      .map(k => `${this.camelToSnake(k)} = ?`)
      .join(', ');
    const values = Object.values(updates);

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE config_sources SET ${sets} WHERE id = ?`, ...values, id);

    return { ...existing, ...updates };
  }

  async deleteSource(id: string) {
    const { configSources, sourceServers, eq } = await import('@mcp-platform/db');
    const source = await this.getSource(id);
    if (!source) return false;

    // Deactivate all imported servers from this source
    for (const ss of source.servers) {
      if (ss.importedServerId && ss.status === 'active') {
        try {
          await this.serverService.deleteServer(ss.importedServerId);
        } catch { /* server may already be deleted */ }
      }
    }

    // Cascade delete handles source_servers via FK
    await this.db.delete(configSources).where(eq(configSources.id, id));
    return true;
  }

  async syncSource(id: string) {
    const { configSources, sourceServers, eq } = await import('@mcp-platform/db');
    const sources = await this.db.select().from(configSources);
    const source = sources.find(s => s.id === id);
    if (!source) throw new Error('Source not found');

    try {
      const parsedServers = await this.fetchAndParse(source.type, source.location);

      const allSourceServers = await this.db.select().from(sourceServers);
      const existing = allSourceServers.filter(s => s.sourceId === id);
      const existingKeys = new Map(existing.map(s => [s.serverKey, s]));
      const parsedKeys = new Set(parsedServers.map(s => s.id));

      let activated = 0;
      let updated = 0;
      let removed = 0;

      // Upsert servers from parsed config
      for (const parsed of parsedServers) {
        const config = JSON.stringify(parsed);
        const existingSS = existingKeys.get(parsed.id);

        if (existingSS) {
          // Update config if changed
          if (existingSS.serverConfig !== config) {
            (this.db as unknown as { run(q: string, ...p: unknown[]): void })
              .run?.(
                `UPDATE source_servers SET server_config = ?, server_name = ?, updated_at = ? WHERE id = ?`,
                config, parsed.name, Math.floor(Date.now() / 1000), existingSS.id,
              );
            updated++;
          }
        } else {
          // New server discovered
          const ssId = crypto.randomUUID();
          await this.db.insert(sourceServers).values({
            id: ssId,
            sourceId: id,
            serverKey: parsed.id,
            serverName: parsed.name,
            serverConfig: config,
            enabled: true,
            importedServerId: null,
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      // Mark removed servers
      for (const [key, ss] of existingKeys) {
        if (!parsedKeys.has(key) && ss.status !== 'removed') {
          if (ss.importedServerId) {
            try {
              await this.serverService.deleteServer(ss.importedServerId);
            } catch { /* may already be deleted */ }
          }
          (this.db as unknown as { run(q: string, ...p: unknown[]): void })
            .run?.(
              `UPDATE source_servers SET status = 'removed', imported_server_id = NULL, updated_at = ? WHERE id = ?`,
              Math.floor(Date.now() / 1000), ss.id,
            );
          removed++;
        }
      }

      // Activate enabled servers that aren't yet active
      const refreshed = await this.db.select().from(sourceServers);
      const sourceRefreshed = refreshed.filter(s => s.sourceId === id);

      for (const ss of sourceRefreshed) {
        if (ss.enabled && ss.status !== 'active' && ss.status !== 'removed' && !ss.importedServerId) {
          await this.activateServer(ss.id);
          activated++;
        }
      }

      // Update sync status
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(
          `UPDATE config_sources SET last_sync_at = ?, last_sync_status = 'success', last_sync_error = NULL, updated_at = ? WHERE id = ?`,
          Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), id,
        );

      return { activated, updated, removed, total: parsedServers.length };
    } catch (err) {
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(
          `UPDATE config_sources SET last_sync_at = ?, last_sync_status = 'error', last_sync_error = ?, updated_at = ? WHERE id = ?`,
          Math.floor(Date.now() / 1000), (err as Error).message, Math.floor(Date.now() / 1000), id,
        );
      throw err;
    }
  }

  async syncAll() {
    const sources = await this.listSources();
    const enabled = sources.filter(s => s.enabled);
    const results: Array<{ sourceId: string; name: string; result?: unknown; error?: string }> = [];

    for (const source of enabled) {
      try {
        const result = await this.syncSource(source.id);
        results.push({ sourceId: source.id, name: source.name, result });
      } catch (err) {
        results.push({ sourceId: source.id, name: source.name, error: (err as Error).message });
      }
    }

    return results;
  }

  async activateServer(sourceServerId: string) {
    const { sourceServers } = await import('@mcp-platform/db');
    const allSS = await this.db.select().from(sourceServers);
    const ss = allSS.find(s => s.id === sourceServerId);
    if (!ss) throw new Error('Source server not found');

    const config: ParsedMCPServer = JSON.parse(ss.serverConfig);

    const server = await this.serverService.createServer({
      name: config.name || ss.serverKey,
      transport: config.transport,
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      url: config.url,
      headers: config.headers,
      proxyType: config.proxyType,
      needsProxy: config.needsProxy,
      source: 'config',
    });

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE source_servers SET imported_server_id = ?, status = 'active', updated_at = ? WHERE id = ?`,
        server.id, Math.floor(Date.now() / 1000), sourceServerId,
      );

    return server;
  }

  async deactivateServer(sourceServerId: string) {
    const { sourceServers } = await import('@mcp-platform/db');
    const allSS = await this.db.select().from(sourceServers);
    const ss = allSS.find(s => s.id === sourceServerId);
    if (!ss) throw new Error('Source server not found');

    if (ss.importedServerId) {
      try {
        await this.serverService.deleteServer(ss.importedServerId);
      } catch { /* may already be deleted */ }
    }

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE source_servers SET imported_server_id = NULL, status = 'removed', updated_at = ? WHERE id = ?`,
        Math.floor(Date.now() / 1000), sourceServerId,
      );

    return true;
  }

  async toggleServer(sourceServerId: string, enabled: boolean) {
    const { sourceServers } = await import('@mcp-platform/db');
    const allSS = await this.db.select().from(sourceServers);
    const ss = allSS.find(s => s.id === sourceServerId);
    if (!ss) throw new Error('Source server not found');

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE source_servers SET enabled = ?, updated_at = ? WHERE id = ?`,
        enabled ? 1 : 0, Math.floor(Date.now() / 1000), sourceServerId,
      );

    if (enabled && !ss.importedServerId && ss.status !== 'removed') {
      await this.activateServer(sourceServerId);
    } else if (!enabled && ss.importedServerId) {
      await this.deactivateServer(sourceServerId);
    }

    return true;
  }

  async toggleSource(id: string, enabled: boolean) {
    const { sourceServers } = await import('@mcp-platform/db');

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE config_sources SET enabled = ?, updated_at = ? WHERE id = ?`,
        enabled ? 1 : 0, Math.floor(Date.now() / 1000), id,
      );

    const allSS = await this.db.select().from(sourceServers);
    const sourceServerList = allSS.filter(s => s.sourceId === id);

    for (const ss of sourceServerList) {
      if (!enabled && ss.importedServerId && ss.status === 'active') {
        await this.deactivateServer(ss.id);
      } else if (enabled && ss.enabled && !ss.importedServerId && ss.status !== 'removed') {
        await this.activateServer(ss.id);
      }
    }

    return true;
  }

  async reorderSources(orderedIds: string[]) {
    for (let i = 0; i < orderedIds.length; i++) {
      const priority = orderedIds.length - i; // highest priority first
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(
          `UPDATE config_sources SET priority = ?, updated_at = ? WHERE id = ?`,
          priority, Math.floor(Date.now() / 1000), orderedIds[i],
        );
    }
    return true;
  }

  async migrateFromLegacy() {
    const { configSources, sourceServers, configDismissedServers } = await import('@mcp-platform/db');

    // Check if already migrated
    const existing = await this.db.select().from(configSources);
    if (existing.length > 0) return { migrated: false, reason: 'already migrated' };

    const configPath = process.env.CLAUDE_CONFIG_PATH ?? '/config/claude_desktop_config.json';

    // Create default file source
    const sourceId = crypto.randomUUID();
    const now = new Date();

    await this.db.insert(configSources).values({
      id: sourceId,
      name: 'Claude Desktop Config',
      type: 'file',
      location: configPath,
      enabled: true,
      priority: 10,
      autoSync: false,
      syncIntervalMinutes: 60,
      createdAt: now,
      updatedAt: now,
    });

    // Parse config file and populate source_servers
    let parsedServers: ParsedMCPServer[] = [];
    try {
      const parser = new ConfigParser(configPath);
      parsedServers = await parser.getMCPServers();
    } catch { /* file may not exist */ }

    // Get dismissed servers from legacy table
    let dismissedNames = new Set<string>();
    try {
      const dismissed = await this.db.select().from(configDismissedServers);
      dismissedNames = new Set(dismissed.map(d => d.serverName));
    } catch { /* table may not exist */ }

    // Get existing mcp_servers to link
    const existingServers = await this.serverService.listServers();
    const serversByName = new Map(existingServers.map(s => [s.name, s]));

    for (const parsed of parsedServers) {
      const isDismissed = dismissedNames.has(parsed.name || parsed.id);
      const existingServer = serversByName.get(parsed.name || parsed.id);

      await this.db.insert(sourceServers).values({
        id: crypto.randomUUID(),
        sourceId,
        serverKey: parsed.id,
        serverName: parsed.name,
        serverConfig: JSON.stringify(parsed),
        enabled: !isDismissed,
        importedServerId: existingServer?.id ?? null,
        status: existingServer ? 'active' : (isDismissed ? 'removed' : 'pending'),
        createdAt: now,
        updatedAt: now,
      });
    }

    return { migrated: true, sourceId, serversFound: parsedServers.length, dismissed: dismissedNames.size };
  }

  startAutoSync() {
    if (this.syncTimer) return;
    // Check every minute which sources need syncing
    this.syncTimer = setInterval(async () => {
      try {
        const sources = await this.listSources();
        const now = Date.now();

        for (const source of sources) {
          if (!source.enabled || !source.autoSync) continue;

          const intervalMs = (source.syncIntervalMinutes ?? 60) * 60 * 1000;
          const lastSync = source.lastSyncAt ? source.lastSyncAt.getTime() : 0;

          if (now - lastSync >= intervalMs) {
            try {
              await this.syncSource(source.id);
            } catch { /* logged in syncSource */ }
          }
        }
      } catch { /* non-critical */ }
    }, 60_000);
  }

  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async fetchAndParse(type: string, location: string | null): Promise<ParsedMCPServer[]> {
    if (!location) throw new Error('No location configured for source');

    if (type === 'file') {
      const parser = new ConfigParser(location);
      return parser.getMCPServers();
    }

    if (type === 'url') {
      const response = await fetch(location);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const json = await response.json();
      return ConfigParser.parseConfigJSON(json);
    }

    throw new Error(`Unsupported source type: ${type}`);
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
