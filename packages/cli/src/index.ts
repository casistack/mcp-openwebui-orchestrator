#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import { api, getConfig, setBaseUrl, setApiKey, clearAuth } from './api-client.js';
import * as fmt from './formatters.js';

const program = new Command();

program
  .name('mcp-platform')
  .description('MCP Platform CLI - manage MCP servers, namespaces, and endpoints')
  .version('0.1.0');

// --- Config commands ---

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set-url <url>')
  .description('Set the platform API base URL')
  .action((url: string) => {
    setBaseUrl(url);
    fmt.success(`Base URL set to ${url}`);
  });

configCmd
  .command('set-key <apiKey>')
  .description('Set API key for authentication')
  .action((apiKey: string) => {
    setApiKey(apiKey);
    fmt.success('API key saved');
  });

configCmd
  .command('show')
  .description('Show current configuration')
  .action(() => {
    const config = getConfig();
    console.log(`URL:     ${config.baseUrl}`);
    console.log(`Auth:    ${config.apiKey ? 'API Key (mcp_...)' : config.sessionCookie ? 'Session cookie' : 'None'}`);
  });

configCmd
  .command('logout')
  .description('Clear saved authentication')
  .action(() => {
    clearAuth();
    fmt.success('Authentication cleared');
  });

// --- Login command ---

program
  .command('login')
  .description('Login with email and password')
  .requiredOption('-e, --email <email>', 'Email address')
  .requiredOption('-p, --password <password>', 'Password')
  .action(async (opts: { email: string; password: string }) => {
    try {
      const config = getConfig();
      const res = await fetch(`${config.baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: opts.email, password: opts.password }),
      });
      if (!res.ok) {
        const text = await res.text();
        fmt.error(`Login failed: ${text}`);
        process.exit(1);
      }
      const cookies = res.headers.getSetCookie?.() ?? [];
      const sessionCookie = cookies.find(c => c.startsWith('better-auth'));
      if (sessionCookie) {
        const { setSessionCookie } = await import('./api-client.js');
        setSessionCookie(sessionCookie.split(';')[0]);
        fmt.success('Logged in (session saved)');
      } else {
        fmt.success('Logged in (no session cookie received - use API key auth instead)');
      }
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Server commands ---

const serversCmd = program.command('servers').description('Manage MCP servers');

serversCmd
  .command('list')
  .description('List all servers')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const data = await api.get('/api/v1/servers') as unknown[];
      if (opts.json) { fmt.json(data); return; }
      fmt.table(data as Record<string, unknown>[], ['id', 'name', 'transport', 'status']);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

serversCmd
  .command('get <id>')
  .description('Get server details')
  .action(async (id: string) => {
    try {
      fmt.json(await api.get(`/api/v1/servers/${id}`));
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

serversCmd
  .command('create')
  .description('Create a new server')
  .requiredOption('-n, --name <name>', 'Server name')
  .requiredOption('-t, --transport <type>', 'Transport type (stdio|sse|streamable-http)')
  .option('-c, --command <cmd>', 'Command (for stdio)')
  .option('-a, --args <args...>', 'Command arguments (for stdio)')
  .option('-u, --url <url>', 'URL (for sse/streamable-http)')
  .action(async (opts: { name: string; transport: string; command?: string; args?: string[]; url?: string }) => {
    try {
      const result = await api.post('/api/v1/servers', opts);
      fmt.json(result);
      fmt.success('Server created');
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

serversCmd
  .command('delete <id>')
  .description('Delete a server')
  .action(async (id: string) => {
    try {
      await api.delete(`/api/v1/servers/${id}`);
      fmt.success(`Server ${id} deleted`);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Namespace commands ---

const nsCmd = program.command('namespaces').alias('ns').description('Manage namespaces');

nsCmd
  .command('list')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const data = await api.get('/api/v1/namespaces') as unknown[];
      if (opts.json) { fmt.json(data); return; }
      fmt.table(data as Record<string, unknown>[], ['id', 'name', 'isPublic']);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

nsCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Namespace name')
  .option('-d, --description <desc>', 'Description')
  .option('--public', 'Make namespace public')
  .action(async (opts: { name: string; description?: string; public?: boolean }) => {
    try {
      const result = await api.post('/api/v1/namespaces', {
        name: opts.name,
        description: opts.description,
        isPublic: opts.public ?? false,
      });
      fmt.json(result);
      fmt.success('Namespace created');
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

nsCmd
  .command('add-server <namespaceId> <serverId>')
  .description('Add a server to a namespace')
  .action(async (namespaceId: string, serverId: string) => {
    try {
      await api.post(`/api/v1/namespaces/${namespaceId}/servers`, { serverId });
      fmt.success('Server added to namespace');
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

nsCmd
  .command('delete <id>')
  .action(async (id: string) => {
    try {
      await api.delete(`/api/v1/namespaces/${id}`);
      fmt.success(`Namespace ${id} deleted`);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Endpoint commands ---

const epCmd = program.command('endpoints').alias('ep').description('Manage endpoints');

epCmd
  .command('list')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const data = await api.get('/api/v1/endpoints') as unknown[];
      if (opts.json) { fmt.json(data); return; }
      fmt.table(data as Record<string, unknown>[], ['id', 'name', 'transport', 'authType', 'rateLimit']);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

epCmd
  .command('create')
  .requiredOption('--namespace-id <id>', 'Namespace ID')
  .requiredOption('-n, --name <name>', 'Endpoint name')
  .requiredOption('-t, --transport <type>', 'Transport (sse|streamable-http|openapi)')
  .option('--auth-type <type>', 'Auth type (none|api_key|bearer|oauth)', 'api_key')
  .option('--rate-limit <n>', 'Rate limit per minute', '100')
  .action(async (opts: { namespaceId: string; name: string; transport: string; authType: string; rateLimit: string }) => {
    try {
      const result = await api.post('/api/v1/endpoints', {
        namespaceId: opts.namespaceId,
        name: opts.name,
        transport: opts.transport,
        authType: opts.authType,
        rateLimit: parseInt(opts.rateLimit, 10),
      });
      fmt.json(result);
      fmt.success('Endpoint created');
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- API Key commands ---

const keysCmd = program.command('api-keys').alias('keys').description('Manage API keys');

keysCmd
  .command('list')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const data = await api.get('/api/v1/api-keys') as unknown[];
      if (opts.json) { fmt.json(data); return; }
      fmt.table(data as Record<string, unknown>[], ['id', 'name', 'keyPrefix', 'isRevoked', 'createdAt']);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

keysCmd
  .command('create')
  .requiredOption('-n, --name <name>', 'Key name')
  .option('--namespace-id <id>', 'Scope to namespace')
  .option('--endpoint-id <id>', 'Scope to endpoint')
  .option('--expires-days <n>', 'Days until expiry')
  .action(async (opts: { name: string; namespaceId?: string; endpointId?: string; expiresDays?: string }) => {
    try {
      const body: Record<string, unknown> = { name: opts.name };
      if (opts.namespaceId) body.namespaceId = opts.namespaceId;
      if (opts.endpointId) body.endpointId = opts.endpointId;
      if (opts.expiresDays) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(opts.expiresDays, 10));
        body.expiresAt = d.toISOString();
      }
      const result = await api.post('/api/v1/api-keys', body) as Record<string, unknown>;
      console.log(`\nAPI Key created. Save this key - it will not be shown again:\n`);
      console.log(`  ${result.rawKey}\n`);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

keysCmd
  .command('revoke <id>')
  .action(async (id: string) => {
    try {
      await api.post(`/api/v1/api-keys/${id}/revoke`);
      fmt.success(`API key ${id} revoked`);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Import/Export commands ---

program
  .command('import')
  .description('Import servers from a Claude Desktop config file or platform export')
  .requiredOption('-f, --file <path>', 'Path to config file')
  .option('--format <fmt>', 'Format: claude-desktop or platform (auto-detected if omitted)')
  .action(async (opts: { file: string; format?: string }) => {
    try {
      const raw = fs.readFileSync(opts.file, 'utf-8');
      const data = JSON.parse(raw);

      let format = opts.format;
      if (!format) {
        format = data.mcpServers ? 'claude-desktop' : 'platform';
      }

      let result: unknown;
      if (format === 'claude-desktop') {
        result = await api.post('/api/v1/import/claude-desktop', data);
      } else {
        result = await api.post('/api/v1/import/platform', data);
      }
      fmt.json(result);
      fmt.success('Import complete');
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export platform configuration')
  .option('--format <fmt>', 'Format: claude-desktop or platform', 'platform')
  .option('-o, --output <path>', 'Write to file instead of stdout')
  .action(async (opts: { format: string; output?: string }) => {
    try {
      const endpoint = opts.format === 'claude-desktop'
        ? '/api/v1/export/claude-desktop'
        : '/api/v1/export/platform';
      const result = await api.get(endpoint);
      const output = JSON.stringify(result, null, 2);

      if (opts.output) {
        fs.writeFileSync(opts.output, output);
        fmt.success(`Exported to ${opts.output}`);
      } else {
        console.log(output);
      }
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Health command ---

program
  .command('health')
  .description('Check platform and server health')
  .option('--json', 'Output as JSON')
  .action(async (opts: { json?: boolean }) => {
    try {
      const data = await api.get('/api/v1/servers') as Record<string, unknown>[];
      if (opts.json) { fmt.json(data); return; }

      const total = data.length;
      const healthy = data.filter(s => s.status === 'running' || s.status === 'healthy').length;
      const unhealthy = total - healthy;

      console.log(`\nPlatform Health`);
      console.log(`  Total servers:   ${total}`);
      console.log(`  Healthy:         ${healthy}`);
      console.log(`  Unhealthy:       ${unhealthy}`);
      console.log('');

      if (total > 0) {
        fmt.table(data, ['name', 'transport', 'status']);
      }
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Stats command ---

program
  .command('stats')
  .description('Show platform statistics')
  .action(async () => {
    try {
      fmt.json(await api.get('/api/v1/stats'));
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

// --- Audit command ---

program
  .command('audit')
  .description('View recent audit log entries')
  .option('--limit <n>', 'Number of entries', '20')
  .option('--json', 'Output as JSON')
  .action(async (opts: { limit: string; json?: boolean }) => {
    try {
      const data = await api.get(`/api/v1/admin/audit-logs?limit=${opts.limit}`) as Record<string, unknown>[];
      if (opts.json) { fmt.json(data); return; }
      fmt.table(data, ['action', 'resourceType', 'userId', 'ip', 'createdAt']);
    } catch (err) {
      fmt.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse();
