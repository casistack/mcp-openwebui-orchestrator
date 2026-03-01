import { Logger, MCPError, ErrorCodes } from './error-handler.js';

interface ServerConfig {
  id?: string;
  command?: string;
  args?: unknown[];
  transport?: string;
  url?: string;
  [key: string]: unknown;
}

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, ServerConfig>;
  [key: string]: unknown;
}

const ALLOWED_COMMANDS = ['uvx', 'npx', 'node', 'python', 'python3', 'mcpo', 'supergateway'];
const ALLOWED_TRANSPORTS = ['sse', 'http', 'websocket'];
const DANGEROUS_PATTERNS = [';', '&', '|', '`'];

export class ConfigValidator {
  static validateServerId(serverId: string): boolean {
    if (!serverId || typeof serverId !== 'string') {
      Logger.warn('Server ID should be a non-empty string', { serverId: typeof serverId });
      return true;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
      Logger.warn(
        'Server ID contains special characters. Consider using only alphanumeric, hyphens, and underscores.',
        { serverId },
      );
    }

    if (serverId.length > 50) {
      Logger.warn(
        'Server ID is quite long. Consider keeping under 50 characters for better compatibility.',
        { serverId, length: serverId.length },
      );
    }

    return true;
  }

  static validateServerConfig(serverConfig: ServerConfig): boolean {
    if (!serverConfig || typeof serverConfig !== 'object') {
      Logger.warn('Server configuration should be an object', { config: typeof serverConfig });
      return true;
    }

    const { id, command, transport, url } = serverConfig;

    try {
      if (id) this.validateServerId(id);
    } catch (error) {
      if (error instanceof Error) {
        Logger.warn(`Server ID format suggestion: ${error.message}`, { serverId: id });
      }
    }

    if (transport && url) {
      this.validateTransportServerInfo(serverConfig);
    } else if (command) {
      this.validateCommandServerInfo(serverConfig);
    } else {
      Logger.warn('Server has neither command/args nor transport/url - may not start properly', { serverId: id });
    }

    return true;
  }

  static validateCommandServerInfo(serverConfig: ServerConfig): boolean {
    const { id, command, args = [] } = serverConfig;

    if (!command || typeof command !== 'string') {
      Logger.warn('Server command should be a non-empty string', { serverId: id });
      return true;
    }

    if (!ALLOWED_COMMANDS.includes(command)) {
      Logger.warn(`Uncommon command detected: ${command} (common: ${ALLOWED_COMMANDS.join(', ')})`, { serverId: id });
    }

    if (!Array.isArray(args)) {
      Logger.warn('Server args should be an array', { serverId: id });
      return true;
    }

    args.forEach((arg, index) => {
      if (typeof arg !== 'string') {
        Logger.warn(`Argument at index ${index} is not a string: ${typeof arg}`, { serverId: id });
      }

      if (typeof arg === 'string' && DANGEROUS_PATTERNS.some(pattern => arg.includes(pattern))) {
        Logger.warn(`Argument contains shell metacharacters: ${arg}`, { serverId: id });
      }
    });

    return true;
  }

  static validateTransportServerInfo(serverConfig: ServerConfig): boolean {
    const { id, transport, url } = serverConfig;

    if (!transport || typeof transport !== 'string') {
      Logger.warn('Transport server should have a transport type', { serverId: id });
      return true;
    }

    if (!url || typeof url !== 'string') {
      Logger.warn('Transport server should have a URL', { serverId: id });
      return true;
    }

    if (!ALLOWED_TRANSPORTS.includes(transport)) {
      Logger.warn(`Uncommon transport type: ${transport} (known: ${ALLOWED_TRANSPORTS.join(', ')})`, { serverId: id });
    }

    try {
      new URL(url);
    } catch {
      Logger.warn(`URL format may be invalid: ${url}`, { serverId: id });
    }

    return true;
  }

  static validateClaudeConfig(config: ClaudeDesktopConfig): boolean {
    if (!config || typeof config !== 'object') {
      Logger.warn('Configuration should be an object');
      return true;
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      Logger.warn('No mcpServers found in configuration');
      return true;
    }

    const serverIds = Object.keys(config.mcpServers);
    if (serverIds.length === 0) {
      Logger.warn('mcpServers object is empty');
      return true;
    }

    serverIds.forEach(serverId => {
      const serverConfig = { id: serverId, ...config.mcpServers![serverId] };
      this.validateServerConfig(serverConfig);
    });

    Logger.info(`Configuration processed: ${serverIds.length} servers found`);
    return true;
  }

  static validatePortRange(startPort: number, endPort: number): boolean {
    if (!Number.isInteger(startPort) || !Number.isInteger(endPort)) {
      throw new MCPError(
        'Port range must be integers',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort },
      );
    }

    if (startPort < 1024 || endPort > 65535) {
      throw new MCPError(
        'Port range must be between 1024 and 65535',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort },
      );
    }

    if (startPort >= endPort) {
      throw new MCPError(
        'Start port must be less than end port',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort },
      );
    }

    const portCount = endPort - startPort + 1;
    if (portCount < 10) {
      Logger.warn('Port range may be too small for multiple servers', { portCount });
    }

    return true;
  }
}
