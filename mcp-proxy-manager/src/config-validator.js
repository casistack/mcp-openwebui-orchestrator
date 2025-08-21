const { Logger, MCPError, ErrorCodes } = require('./error-handler');

/**
 * Configuration validation utility
 */
class ConfigValidator {
  
  /**
   * Validate server ID format (informational only)
   * @param {string} serverId - Server ID to validate
   * @returns {boolean} - Always true (never blocks)
   */
  static validateServerId(serverId) {
    if (!serverId || typeof serverId !== 'string') {
      Logger.warn('Server ID should be a non-empty string', { serverId: typeof serverId });
      return true; // Don't block
    }
    
    // Allow alphanumeric, hyphens, underscores (safe for file paths and URLs)
    if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
      Logger.warn(
        'Server ID contains special characters. Consider using only alphanumeric, hyphens, and underscores.',
        { serverId }
      );
    }
    
    if (serverId.length > 50) {
      Logger.warn(
        'Server ID is quite long. Consider keeping under 50 characters for better compatibility.',
        { serverId, length: serverId.length }
      );
    }
    
    return true; // Always allow
  }

  /**
   * Validate server configuration object (informational only)
   * @param {Object} serverConfig - Server configuration
   * @returns {boolean} - Always true (never blocks)
   */
  static validateServerConfig(serverConfig) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      Logger.warn('Server configuration should be an object', { config: typeof serverConfig });
      return true; // Don't block
    }

    const { id, command, args = [], transport, url } = serverConfig;

    // Informational server ID check
    try {
      this.validateServerId(id);
    } catch (error) {
      Logger.warn(`Server ID format suggestion: ${error.message}`, { serverId: id });
    }
    
    // Handle different server types - informational only
    if (transport && url) {
      // SSE/Transport server (like graphiti)
      this.validateTransportServerInfo(serverConfig);
    } else if (command) {
      // Command-based server (standard)
      this.validateCommandServerInfo(serverConfig);
    } else {
      Logger.warn('Server has neither command/args nor transport/url - may not start properly', { serverId: id });
    }

    return true; // Always allow
  }

  /**
   * Validate command-based server configuration (informational only)
   * @param {Object} serverConfig - Server configuration
   * @returns {boolean} - Always true
   */
  static validateCommandServerInfo(serverConfig) {
    const { id, command, args = [] } = serverConfig;
    
    if (!command || typeof command !== 'string') {
      Logger.warn('Server command should be a non-empty string', { serverId: id });
      return true;
    }

    // Informational command check (not blocking)
    const allowedCommands = ['uvx', 'npx', 'node', 'python', 'python3', 'mcpo', 'supergateway'];
    if (!allowedCommands.includes(command)) {
      Logger.warn(`Uncommon command detected: ${command} (common: ${allowedCommands.join(', ')})`, { serverId: id });
    }

    // Informational args check
    if (!Array.isArray(args)) {
      Logger.warn('Server args should be an array', { serverId: id });
      return true;
    }

    // Check arguments for potential issues (informational only)
    args.forEach((arg, index) => {
      if (typeof arg !== 'string') {
        Logger.warn(`Argument at index ${index} is not a string: ${typeof arg}`, { serverId: id });
      }
      
      // Security: Informational check for suspicious patterns
      const dangerousPatterns = [';', '&', '|', '`'];
      if (typeof arg === 'string' && dangerousPatterns.some(pattern => arg.includes(pattern))) {
        Logger.warn(`Argument contains shell metacharacters: ${arg}`, { serverId: id });
      }
    });

    return true;
  }

  /**
   * Validate transport-based server configuration (informational only)
   * @param {Object} serverConfig - Server configuration
   * @returns {boolean} - Always true
   */
  static validateTransportServerInfo(serverConfig) {
    const { id, transport, url } = serverConfig;
    
    if (!transport || typeof transport !== 'string') {
      Logger.warn('Transport server should have a transport type', { serverId: id });
      return true;
    }

    if (!url || typeof url !== 'string') {
      Logger.warn('Transport server should have a URL', { serverId: id });
      return true;
    }

    // Informational transport type check
    const allowedTransports = ['sse', 'http', 'websocket'];
    if (!allowedTransports.includes(transport)) {
      Logger.warn(`Uncommon transport type: ${transport} (known: ${allowedTransports.join(', ')})`, { serverId: id });
    }

    // Informational URL validation
    try {
      new URL(url);
    } catch (error) {
      Logger.warn(`URL format may be invalid: ${url}`, { serverId: id });
    }

    return true;
  }

  /**
   * Validate Claude Desktop configuration structure (informational only)
   * @param {Object} config - Configuration object
   * @returns {boolean} - Always true (never blocks)
   */
  static validateClaudeConfig(config) {
    if (!config || typeof config !== 'object') {
      Logger.warn('Configuration should be an object');
      return true; // Don't block
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      Logger.warn('No mcpServers found in configuration');
      return true; // Not an error, just empty config
    }

    // Check each server (informational only)
    const serverIds = Object.keys(config.mcpServers);
    if (serverIds.length === 0) {
      Logger.warn('mcpServers object is empty');
      return true;
    }

    serverIds.forEach(serverId => {
      const serverConfig = { id: serverId, ...config.mcpServers[serverId] };
      this.validateServerConfig(serverConfig); // This now only warns, never throws
    });

    Logger.info(`Configuration processed: ${serverIds.length} servers found`);
    return true;
  }

  /**
   * Validate port range
   * @param {number} startPort - Start port
   * @param {number} endPort - End port
   * @returns {boolean} - True if valid
   * @throws {MCPError} - If invalid
   */
  static validatePortRange(startPort, endPort) {
    if (!Number.isInteger(startPort) || !Number.isInteger(endPort)) {
      throw new MCPError(
        'Port range must be integers',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort }
      );
    }

    if (startPort < 1024 || endPort > 65535) {
      throw new MCPError(
        'Port range must be between 1024 and 65535',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort }
      );
    }

    if (startPort >= endPort) {
      throw new MCPError(
        'Start port must be less than end port',
        ErrorCodes.VALIDATION_ERROR,
        { startPort, endPort }
      );
    }

    const portCount = endPort - startPort + 1;
    if (portCount < 10) {
      Logger.warn('Port range may be too small for multiple servers', { portCount });
    }

    return true;
  }
}

module.exports = ConfigValidator;