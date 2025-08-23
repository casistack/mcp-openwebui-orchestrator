# MCP Proxy Manager Testing

Jest-based testing framework for the MCP Proxy Manager orchestration platform.

## Test Structure

```
src/__tests__/
├── unit/           # Unit tests for individual modules
├── integration/    # Integration tests for component interactions  
├── e2e/           # End-to-end tests for full workflows
├── setup.js       # Jest setup and global test utilities
└── README.md      # This file
```

## Running Tests

### All Tests
```bash
npm test
```

### Test Types
```bash
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests only  
npm run test:e2e           # End-to-end tests only
```

### Development
```bash
npm run test:watch         # Watch mode for development
npm run test:coverage      # Generate coverage reports
```

## Test Environment

### Local Testing
```bash
# Run tests locally (fastest)
npm test

# Run tests with Docker (closest to CI)
docker-compose -f docker-compose.test.yml up --build mcp-proxy-manager-test
```

### Integration Testing
```bash
# Start integration test environment
docker-compose -f docker-compose.test.yml --profile integration up -d

# Run integration tests against running environment
npm run test:integration

# Cleanup
docker-compose -f docker-compose.test.yml down
```

## Writing Tests

### Unit Tests
Focus on individual modules and utilities:

```javascript
// src/__tests__/unit/logger.test.js
const { logger } = require('../../logger');

describe('Logger', () => {
  test('should format timestamps correctly', () => {
    // Test logger functionality
  });
});
```

### Integration Tests
Focus on component interactions:

```javascript
// src/__tests__/integration/proxy-manager.test.js
const ProxyManager = require('../../proxy-manager');

describe('ProxyManager Integration', () => {
  test('should spawn MCPO processes correctly', () => {
    // Test process spawning and management
  });
});
```

### End-to-End Tests
Focus on full workflows:

```javascript
// src/__tests__/e2e/mcp-communication.test.js
const supertest = require('supertest');

describe('MCP Communication E2E', () => {
  test('should handle complete MCP request/response cycle', () => {
    // Test full MCP communication workflow
  });
});
```

## Test Utilities

Global test utilities are available via `global.testUtils`:

```javascript
// Wait for async operations
await testUtils.wait(1000);

// Create mock server configurations
const mockConfig = testUtils.createMockServerConfig('test-server');

// Generate unique test ports
const testPort = testUtils.getTestPort();
```

## Coverage Requirements

- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%
- **Statements**: 70%

## Best Practices

1. **Isolated Tests**: Each test should be independent
2. **Descriptive Names**: Use clear, descriptive test names
3. **Arrange-Act-Assert**: Structure tests clearly
4. **Mock External Dependencies**: Use Jest mocks for external services
5. **Clean Up**: Properly clean up resources after tests
6. **Async Handling**: Use proper async/await patterns

## Configuration

Jest configuration is in `jest.config.js` with:
- Node.js test environment
- 30-second timeout for integration tests
- Automatic mock clearing
- Coverage thresholds
- Project-based test organization