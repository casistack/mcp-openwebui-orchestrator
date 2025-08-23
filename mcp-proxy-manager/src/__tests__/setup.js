/**
 * Jest setup file for MCP Proxy Manager tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MCP_PROXY_MODE = 'unified';
process.env.MANAGER_PORT = '3001';
process.env.PORT_RANGE_START = '4200';
process.env.PORT_RANGE_END = '4300';
process.env.SUPERGATEWAY_LOG_LEVEL = 'none'; // Suppress logs during testing

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global test utilities
global.testUtils = {
  // Helper to wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Helper to create mock server config
  createMockServerConfig: (options = {}) => ({
    command: options.command || 'npx',
    args: options.args || ['-y', '@modelcontextprotocol/server-memory'],
    env: options.env || {},
    proxyType: options.proxyType || 'mcpo',
    ...options
  }),
  
  // Helper to generate unique ports for testing
  getTestPort: () => Math.floor(Math.random() * 1000) + 5000
};