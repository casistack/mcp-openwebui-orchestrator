/**
 * Jest configuration for MCP Proxy Manager testing
 */
module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test directories
  testMatch: [
    '<rootDir>/src/__tests__/**/*.test.js',
    '<rootDir>/src/__tests__/**/*.spec.js'
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/static/**',
    '!src/index.js' // Main entry point
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],

  // Test timeout (important for integration tests)
  testTimeout: 30000,

  // Module paths
  moduleDirectories: ['node_modules', 'src'],

  // Clear mocks between tests
  clearMocks: true,

  // Verbose output
  verbose: true,

  // Detect handles that prevent Jest from exiting
  detectOpenHandles: true,

  // Force exit after tests complete
  forceExit: true,

  // Test patterns for different test types
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/__tests__/unit/**/*.test.js']
    },
    {
      displayName: 'integration', 
      testMatch: ['<rootDir>/src/__tests__/integration/**/*.test.js']
    },
    {
      displayName: 'e2e',
      testMatch: ['<rootDir>/src/__tests__/e2e/**/*.test.js']
    }
  ]
};