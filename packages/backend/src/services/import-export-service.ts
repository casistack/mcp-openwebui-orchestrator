import type { ServerService, CreateServerInput } from './server-service.js';
import type { NamespaceService } from './namespace-service.js';
import type { EndpointService } from './endpoint-service.js';
import { ConfigParser } from '../core/config-parser.js';

// Claude Desktop config format
interface ClaudeDesktopConfig {
  mcpServers: Record<string, {
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  }>;
}

// Platform-native export format
interface PlatformExport {
  version: '1.0';
  exportedAt: string;
  servers: Array<{
    name: string;
    transport: string;
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    proxyType?: string;
    needsProxy?: boolean;
  }>;
  namespaces: Array<{
    name: string;
    description?: string;
    isPublic: boolean;
    serverNames: string[];
  }>;
  endpoints: Array<{
    namespaceName: string;
    name: string;
    transport: string;
    authType: string;
    rateLimit: number;
  }>;
}

export class ImportExportService {
  constructor(
    private serverService: ServerService,
    private namespaceService: NamespaceService,
    private endpointService: EndpointService,
  ) {}

  async importFromClaudeDesktop(
    config: ClaudeDesktopConfig,
    userId?: string,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        const transport = serverConfig.url ? 'sse' : 'stdio';
        const input: CreateServerInput = {
          name,
          transport: transport as 'stdio' | 'sse' | 'streamable-http',
          command: serverConfig.command,
          args: serverConfig.args,
          cwd: serverConfig.cwd,
          url: serverConfig.url,
          headers: serverConfig.headers,
          createdBy: userId,
        };

        await this.serverService.createServer(input);
        imported++;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('UNIQUE') || msg.includes('unique') || msg.includes('already exists')) {
          skipped++;
        } else {
          errors.push(`${name}: ${msg}`);
        }
      }
    }

    return { imported, skipped, errors };
  }

  async importFromClaudeDesktopFile(
    filePath: string,
    userId?: string,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const parser = new ConfigParser(filePath);
    const servers = await parser.getMCPServers();

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const server of servers) {
      try {
        await this.serverService.createServer({
          name: server.name || server.id,
          transport: server.transport,
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          url: server.url,
          headers: server.headers,
          proxyType: server.proxyType,
          needsProxy: server.needsProxy,
          createdBy: userId,
        });
        imported++;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('UNIQUE') || msg.includes('unique')) {
          skipped++;
        } else {
          errors.push(`${server.id}: ${msg}`);
        }
      }
    }

    return { imported, skipped, errors };
  }

  async importFromPlatformFormat(
    data: PlatformExport,
    userId?: string,
  ): Promise<{ servers: number; namespaces: number; endpoints: number; errors: string[] }> {
    let serverCount = 0;
    let nsCount = 0;
    let epCount = 0;
    const errors: string[] = [];

    // Import servers
    for (const server of data.servers) {
      try {
        await this.serverService.createServer({
          ...server,
          transport: server.transport as 'stdio' | 'sse' | 'streamable-http',
          createdBy: userId,
        });
        serverCount++;
      } catch (err) {
        errors.push(`server ${server.name}: ${(err as Error).message}`);
      }
    }

    // Import namespaces with server membership
    for (const ns of data.namespaces) {
      try {
        const created = await this.namespaceService.createNamespace({
          name: ns.name,
          description: ns.description,
          isPublic: ns.isPublic,
          createdBy: userId,
        });
        nsCount++;

        // Add servers to namespace
        const allServers = await this.serverService.listServers();
        for (const serverName of ns.serverNames) {
          const server = allServers.find(s => s.name === serverName);
          if (server) {
            await this.namespaceService.addServer(created.id, server.id);
          }
        }
      } catch (err) {
        errors.push(`namespace ${ns.name}: ${(err as Error).message}`);
      }
    }

    // Import endpoints
    const allNamespaces = await this.namespaceService.listNamespaces();
    for (const ep of data.endpoints) {
      try {
        const ns = allNamespaces.find(n => n.name === ep.namespaceName);
        if (!ns) {
          errors.push(`endpoint ${ep.name}: namespace "${ep.namespaceName}" not found`);
          continue;
        }
        await this.endpointService.createEndpoint({
          namespaceId: ns.id,
          name: ep.name,
          transport: ep.transport as 'sse' | 'streamable-http' | 'openapi',
          authType: ep.authType as 'none' | 'api_key' | 'oauth' | 'bearer',
          rateLimit: ep.rateLimit,
          createdBy: userId,
        });
        epCount++;
      } catch (err) {
        errors.push(`endpoint ${ep.name}: ${(err as Error).message}`);
      }
    }

    return { servers: serverCount, namespaces: nsCount, endpoints: epCount, errors };
  }

  async exportToClaudeDesktop(): Promise<ClaudeDesktopConfig> {
    const servers = await this.serverService.listServers();
    const mcpServers: ClaudeDesktopConfig['mcpServers'] = {};

    for (const server of servers) {
      const entry: Record<string, unknown> = {};
      if (server.command) entry.command = server.command;
      if (server.args) entry.args = server.args;
      if (server.cwd) entry.cwd = server.cwd;
      if (server.url) entry.url = server.url;
      if (server.headers) entry.headers = server.headers;
      mcpServers[server.name] = entry as ClaudeDesktopConfig['mcpServers'][string];
    }

    return { mcpServers };
  }

  async exportToPlatformFormat(): Promise<PlatformExport> {
    const servers = await this.serverService.listServers();
    const namespaces = await this.namespaceService.listNamespaces();
    const endpoints = await this.endpointService.listEndpoints();

    const nsServersMap = new Map<string, string[]>();
    for (const ns of namespaces) {
      const nsServers = await this.namespaceService.listServers(ns.id);
      nsServersMap.set(ns.id, nsServers.map(s => s.name));
    }

    const nsNameMap = new Map(namespaces.map(n => [n.id, n.name]));

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      servers: servers.map(s => ({
        name: s.name,
        transport: s.transport,
        command: s.command ?? undefined,
        args: s.args ?? undefined,
        cwd: s.cwd ?? undefined,
        url: s.url ?? undefined,
        headers: s.headers ?? undefined,
        proxyType: s.proxyType ?? undefined,
        needsProxy: s.needsProxy ?? undefined,
      })),
      namespaces: namespaces.map(ns => ({
        name: ns.name,
        description: ns.description ?? undefined,
        isPublic: ns.isPublic ?? false,
        serverNames: nsServersMap.get(ns.id) ?? [],
      })),
      endpoints: endpoints.map(ep => ({
        namespaceName: nsNameMap.get(ep.namespaceId) ?? ep.namespaceId,
        name: ep.name,
        transport: ep.transport,
        authType: ep.authType ?? 'api_key',
        rateLimit: ep.rateLimit ?? 100,
      })),
    };
  }
}
