/**
 * Timestamped logging utility for MCP Orchestrator
 * Provides consistent timestamp formatting across all components
 */

/**
 * Get formatted timestamp
 * @returns {string} ISO timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Log with timestamp prefix
 * @param {string} message - Log message
 * @param {string} level - Log level (info, warn, error)
 */
function logWithTimestamp(message, level = 'info') {
  const timestamp = getTimestamp();
  const prefix = `[${timestamp}]`;
  
  switch (level.toLowerCase()) {
    case 'error':
      console.error(`${prefix} ${message}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${message}`);
      break;
    case 'debug':
      console.log(`${prefix} [DEBUG] ${message}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

/**
 * Convenience methods for different log levels
 */
const logger = {
  info: (message) => logWithTimestamp(message, 'info'),
  warn: (message) => logWithTimestamp(message, 'warn'),
  error: (message) => logWithTimestamp(message, 'error'),
  debug: (message) => logWithTimestamp(message, 'debug'),
  log: (message, level = 'info') => logWithTimestamp(message, level)
};

module.exports = {
  logWithTimestamp,
  logger,
  getTimestamp
};