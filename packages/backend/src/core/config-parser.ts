import fs from 'fs';
import path from 'path';
import { ConfigValidator } from './config-validator.js';
import { Logger, MCPError, ErrorCodes } from './error-handler.js';

export type ServerTransport = 'stdio' | 'sse' | 'streamable-http';

export interface ParsedMCPServer {
  id: string;
  name: string;
  type: ServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFile?: string;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  transport: ServerTransport;
  needsProxy: boolean;
  alwaysAllow?: string[];
  proxyType?: string;
  [key: string]: unknown;
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, RawServerConfig>;
  [key: string]: unknown;
}

interface RawServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  envFile?: string;
  cwd?: string;
  transport?: string;
  url?: string;
  headers?: Record<string, string>;
  needsProxy?: boolean;
  alwaysAllow?: string[];
  proxyType?: string;
  [key: string]: unknown;
}

interface ConfigStats {
  exists: boolean;
  path?: string;
  size?: number;
  modified?: Date;
  serverCount?: number;
  stdioServers?: number;
  sseServers?: number;
  streamableHttpServers?: number;
  error?: string;
}

const VALID_COMMANDS = ['npx', 'uvx', 'uv', 'python', 'node', 'docker'];
const DEFAULT_CONFIG_PATH = '/config/claude_desktop_config.json';

export class ConfigParser {
  private readonly configPath: string;
  private lastModified: number | null;
  private parsedConfig: ClaudeDesktopConfig | null;

  constructor(configPath = DEFAULT_CONFIG_PATH) {
    this.configPath = configPath;
    this.lastModified = null;
    this.parsedConfig = null;
  }

  async loadConfig(): Promise<ClaudeDesktopConfig | null> {
    try {
      if (!fs.existsSync(this.configPath)) {
        Logger.error(`Config file not found: ${this.configPath}`);
        return null;
      }

      const stats = await fs.promises.stat(this.configPath);

      if (this.lastModified && stats.mtime.getTime() === this.lastModified) {
        return this.parsedConfig;
      }

      const configContent = await fs.promises.readFile(this.configPath, 'utf8');
      const config: ClaudeDesktopConfig = JSON.parse(configContent);

      ConfigValidator.validateClaudeConfig(config);

      this.parsedConfig = config;
      this.lastModified = stats.mtime.getTime();

      Logger.success(`Configuration loaded and validated: ${this.configPath}`);
      return this.parsedConfig;
    } catch (error) {
      Logger.error(`Config loading failed: ${(error as Error).message}`, error as Error);
      return null;
    }
  }

  async getMCPServers(): Promise<ParsedMCPServer[]> {
    const config = await this.loadConfig();
    if (!config?.mcpServers) {
      return [];
    }

    const servers: ParsedMCPServer[] = [];

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
      const mcpServer = this.parseMCPServer(serverName, serverConfig);
      if (mcpServer) {
        servers.push(mcpServer);
      }
    }

    return servers;
  }

  parseMCPServer(name: string, config: RawServerConfig): ParsedMCPServer | null {
    try {
      if (config.transport === 'sse' && config.url) {
        return {
          id: name,
          name,
          type: 'sse',
          url: config.url,
          headers: config.headers || {},
          transport: 'sse',
          needsProxy: true,
        };
      }

      if (config.transport === 'streamable-http' && config.url) {
        return {
          id: name,
          name,
          type: 'streamable-http',
          url: config.url,
          headers: config.headers || {},
          transport: 'streamable-http',
          needsProxy: true,
        };
      }

      if (config.command) {
        const serverConfig: ParsedMCPServer = {
          id: name,
          name,
          type: 'stdio',
          command: config.command,
          args: config.args || [],
          env: config.env || {},
          envFile: config.envFile,
          cwd: config.cwd,
          transport: 'stdio',
          needsProxy: config.needsProxy !== false,
          alwaysAllow: config.alwaysAllow || [],
        };

        if (Object.prototype.hasOwnProperty.call(config, 'proxyType')) {
          serverConfig.proxyType = config.proxyType;
        }

        if (!this.isValidCommand(serverConfig)) {
          console.warn(`Skipping invalid server config: ${name}`);
          return null;
        }

        return serverConfig;
      }

      console.warn(`Unknown server configuration format for: ${name}`);
      return null;
    } catch (error) {
      console.error(`Error parsing server ${name}: ${(error as Error).message}`);
      return null;
    }
  }

  isValidCommand(serverConfig: ParsedMCPServer): boolean {
    if (!serverConfig.command) {
      return false;
    }

    const isValid = VALID_COMMANDS.some(
      cmd => serverConfig.command!.includes(cmd) || serverConfig.command === cmd,
    );

    if (!isValid) {
      console.warn(`Potentially unsupported command: ${serverConfig.command}`);
    }

    return true;
  }

  async getConfigStats(): Promise<ConfigStats> {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { exists: false };
      }

      const stats = await fs.promises.stat(this.configPath);
      const servers = await this.getMCPServers();

      return {
        exists: true,
        path: this.configPath,
        size: stats.size,
        modified: stats.mtime,
        serverCount: servers.length,
        stdioServers: servers.filter(s => s.type === 'stdio').length,
        sseServers: servers.filter(s => s.type === 'sse').length,
        streamableHttpServers: servers.filter(s => s.type === 'streamable-http').length,
      };
    } catch (error) {
      return { exists: false, error: (error as Error).message };
    }
  }

  watchConfig(callback: (servers: Promise<ParsedMCPServer[]>) => void): ReturnType<typeof fs.watchFile> | null {
    if (!fs.existsSync(this.configPath)) {
      console.error(`Cannot watch non-existent config file: ${this.configPath}`);
      return null;
    }

    const watcher = fs.watchFile(
      this.configPath,
      { interval: 1000 },
      (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
          console.log('Configuration file changed, reloading...');
          callback(this.getMCPServers());
        }
      },
    );

    console.log(`Watching config file: ${this.configPath}`);
    return watcher;
  }

  generateExampleConfig(): ClaudeDesktopConfig {
    return {
      mcpServers: {
        memory: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-memory'],
        },
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files'],
        },
        'brave-search': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'your-api-key' },
        },
        'hosted-sse-server': {
          transport: 'sse',
          url: 'https://your-sse-server.com/sse',
        },
        'hosted-streamable-http-server': {
          transport: 'streamable-http',
          url: 'https://your-streamable-http-server.com/mcp',
        },
        'server-with-supergateway': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/files'],
          proxyType: 'supergateway',
        },
      },
    };
  }
}
