/**
 * Centralized error handling utilities for MCP Proxy Manager
 */

class MCPError extends Error {
  constructor(message, code = 'MCP_ERROR', context = {}) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

class Logger {
  static error(message, error = null, context = {}) {
    const logEntry = {
      level: 'ERROR',
      message,
      timestamp: new Date().toISOString(),
      context,
      stack: error?.stack,
      code: error?.code
    };
    
    // Use existing console.error for compatibility
    console.error(`${message}`, context.serverId ? `[${context.serverId}]` : '');
    
    if (error && error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  static warn(message, context = {}) {
    console.warn(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }

  static info(message, context = {}) {
    console.log(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }

  /**
   * Log success with consistent format
   * @param {string} message - Success message
   * @param {Object} context - Additional context (optional)
   */
  static success(message, context = {}) {
    console.log(`${message}`, context.serverId ? `[${context.serverId}]` : '');
  }
}

/**
 * Error codes for different types of MCP errors
 */
const ErrorCodes = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  PROXY_START_ERROR: 'PROXY_START_ERROR',
  PROXY_HEALTH_ERROR: 'PROXY_HEALTH_ERROR',
  PORT_ALLOCATION_ERROR: 'PORT_ALLOCATION_ERROR',
  INSTALLATION_ERROR: 'INSTALLATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  AUTH_ERROR: 'AUTH_ERROR'
};

module.exports = {
  MCPError,
  Logger,
  ErrorCodes
};