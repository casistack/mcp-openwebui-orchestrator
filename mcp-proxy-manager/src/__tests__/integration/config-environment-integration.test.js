/**
 * Integration tests for ConfigParser and EnvironmentManager interaction
 */
const fs = require('fs');
const ConfigParser = require('../../config-parser');
const EnvironmentManager = require('../../environment-manager');

// Mock dependencies for integration testing
jest.mock('fs');
jest.mock('../../config-validator');
jest.mock('../../error-handler', () => ({
  Logger: {
    error: jest.fn(),
    success: jest.fn()
  }
}));
jest.mock('../../encryption-manager');
jest.mock('../../secure-logger');

const ConfigValidator = require('../../config-validator');
const EncryptionManager = require('../../encryption-manager');
const secureLogger = require('../../secure-logger');

describe('ConfigParser and EnvironmentManager Integration', () => {
  let configParser;
  let environmentManager;
  let consoleSpy;
  let mockEncryptionManager;

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Reset all mocks
    jest.clearAllMocks();

    // Mock file system operations
    fs.existsSync.mockReturnValue(true);
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    fs.readFileSync.mockReturnValue('{"variables": {}}');
    fs.renameSync.mockReturnValue(undefined);
    fs.unlinkSync.mockReturnValue(undefined);
    fs.readdirSync.mockReturnValue([]);

    // Mock fs.promises methods
    fs.promises = {
      stat: jest.fn().mockResolvedValue({ 
        mtime: new Date('2024-01-01T00:00:00.000Z'),
        size: 1000
      }),
      readFile: jest.fn().mockResolvedValue('{"mcpServers": {}}')
    };

    // Mock config validator
    ConfigValidator.validateClaudeConfig.mockReturnValue(true);

    // Mock encryption manager
    mockEncryptionManager = {
      encrypt: jest.fn().mockReturnValue('encrypted-value'),
      decrypt: jest.fn().mockReturnValue('decrypted-value'),
      isValidEncryptedData: jest.fn().mockReturnValue(true),
      getStats: jest.fn().mockReturnValue({ operations: 10 })
    };
    EncryptionManager.mockImplementation(() => mockEncryptionManager);

    // Mock secure logger
    secureLogger.log.mockImplementation(() => {});

    // Create instances
    configParser = new ConfigParser('/test/config.json');
    environmentManager = new EnvironmentManager();
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.clearAllMocks();
  });

  describe('Configuration with Environment Variables', () => {
    test('should load MCP servers and enhance them with environment variables', async () => {
      // Setup mock configuration with servers requiring API keys
      const mockConfig = {
        mcpServers: {
          'brave-search': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          },
          'mcp-server-firecrawl': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-firecrawl']
          }
        }
      };
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      // Setup mock environment variables
      const braveEnvData = {
        variables: { BRAVE_API_KEY: 'encrypted-brave-key' },
        lastUpdated: '2024-01-01T00:00:00.000Z'
      };
      const firecrawlEnvData = {
        variables: { 
          FIRE_CRAWL_API_KEY: 'encrypted-firecrawl-key',
          FIRE_CRAWL_API_URL: 'encrypted-custom-url'
        },
        lastUpdated: '2024-01-01T00:00:00.000Z'
      };

      fs.readFileSync.mockImplementation((path) => {
        if (path.includes('brave-search.env.json')) {
          return JSON.stringify(braveEnvData);
        }
        if (path.includes('mcp-server-firecrawl.env.json')) {
          return JSON.stringify(firecrawlEnvData);
        }
        return '{"variables": {}}';
      });

      mockEncryptionManager.decrypt.mockImplementation((encrypted) => {
        if (encrypted === 'encrypted-brave-key') return 'brave-api-key-123';
        if (encrypted === 'encrypted-firecrawl-key') return 'firecrawl-api-key-456';
        if (encrypted === 'encrypted-custom-url') return 'https://custom.firecrawl.url';
        return 'decrypted-value';
      });

      // Load servers from config
      const servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(2);

      // Enhance servers with environment variables
      const enhancedServers = servers.map(server => 
        environmentManager.updateServerConfigWithEnvFile(server)
      );

      // Verify brave-search server enhancement
      const braveServer = enhancedServers.find(s => s.id === 'brave-search');
      expect(braveServer).toMatchObject({
        id: 'brave-search',
        command: 'npx',
        env: {
          BRAVE_API_KEY: 'brave-api-key-123'
        },
        envFile: '/home/mcpuser/.mcp-env/brave-search.env.json'
      });

      // Verify firecrawl server enhancement
      const firecrawlServer = enhancedServers.find(s => s.id === 'mcp-server-firecrawl');
      expect(firecrawlServer).toMatchObject({
        id: 'mcp-server-firecrawl',
        command: 'npx',
        env: {
          FIRE_CRAWL_API_KEY: 'firecrawl-api-key-456',
          FIRE_CRAWL_API_URL: 'https://custom.firecrawl.url'
        },
        envFile: '/home/mcpuser/.mcp-env/mcp-server-firecrawl.env.json'
      });
    });

    test('should handle servers without environment files gracefully', async () => {
      const mockConfig = {
        mcpServers: {
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          }
        }
      };
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      
      // No environment file exists for memory server
      fs.existsSync.mockImplementation((path) => {
        return !path.includes('memory.env.json');
      });

      const servers = await configParser.getMCPServers();
      const enhancedServer = environmentManager.updateServerConfigWithEnvFile(servers[0]);

      // Should return original server config unchanged
      expect(enhancedServer).toEqual(servers[0]);
      expect(enhancedServer.envFile).toBeUndefined();
    });

    test('should validate required API keys for different server types', async () => {
      // Test multiple server types with their required keys
      const serverTests = [
        { 
          serverId: 'brave-search', 
          required: ['BRAVE_API_KEY'],
          optional: []
        },
        { 
          serverId: 'mcp-server-firecrawl', 
          required: ['FIRE_CRAWL_API_KEY'],
          optional: ['FIRE_CRAWL_API_URL']
        },
        { 
          serverId: 'youtube', 
          required: ['YOUTUBE_API_KEY'],
          optional: ['YOUTUBE_TRANSCRIPT_LANG']
        }
      ];

      serverTests.forEach(({ serverId, required, optional }) => {
        expect(environmentManager.getRequiredKeysForServer(serverId))
          .toEqual(required);
        expect(environmentManager.getOptionalKeysForServer(serverId))
          .toEqual(optional);
        
        // Test required key validation
        required.forEach(key => {
          expect(environmentManager.isRequiredKey(serverId, key)).toBe(true);
        });
        optional.forEach(key => {
          expect(environmentManager.isRequiredKey(serverId, key)).toBe(false);
        });
      });
    });
  });

  describe('Configuration Change Detection with Environment Updates', () => {
    test('should detect configuration changes and reload affected environment variables', async () => {
      const initialConfig = {
        mcpServers: {
          'brave-search': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          }
        }
      };

      const updatedConfig = {
        mcpServers: {
          'brave-search': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          },
          'youtube': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-youtube']
          }
        }
      };

      // Initial load
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(initialConfig));
      let servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(1);

      // Simulate config file change (different timestamp)
      fs.promises.stat.mockResolvedValueOnce({ 
        mtime: new Date('2024-01-01T01:00:00.000Z') // Different time
      });
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(updatedConfig));

      // Reload configuration
      servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(2);
      
      // Verify new server can be enhanced with environment variables
      const youtubeServer = servers.find(s => s.id === 'youtube');
      expect(youtubeServer).toBeDefined();
      
      // Setup environment for YouTube server
      const youtubeEnvData = {
        variables: { YOUTUBE_API_KEY: 'encrypted-youtube-key' }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(youtubeEnvData));
      mockEncryptionManager.decrypt.mockReturnValue('youtube-api-key-789');

      const enhancedYoutubeServer = environmentManager.updateServerConfigWithEnvFile(youtubeServer);
      expect(enhancedYoutubeServer.env.YOUTUBE_API_KEY).toBe('youtube-api-key-789');
    });
  });

  describe('Environment Variable Management Workflow', () => {
    test('should support complete environment variable lifecycle', async () => {
      const serverId = 'test-server';
      
      // 1. Initially no environment variables (mock no env file exists)
      fs.existsSync.mockImplementation((path) => {
        return !path.includes('test-server.env.json');
      });
      
      let summary = environmentManager.getEnvironmentSummary(serverId);
      expect(summary.exists).toBe(false);

      // 2. Save new environment variables
      const newVariables = {
        API_KEY: 'test-api-key',
        SECRET_TOKEN: 'test-secret',
        BASE_URL: 'https://api.example.com'
      };
      
      const saveResult = await environmentManager.saveEnvironmentVariables(serverId, newVariables);
      expect(saveResult).toBe(true);

      // 3. Verify variables are saved and encrypted
      expect(mockEncryptionManager.encrypt).toHaveBeenCalledTimes(3);
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(fs.renameSync).toHaveBeenCalled();

      // 4. Mock the saved file for reading (now file exists)
      fs.existsSync.mockReturnValue(true);
      const savedEnvData = {
        variables: {
          API_KEY: 'encrypted-api-key',
          SECRET_TOKEN: 'encrypted-secret',
          BASE_URL: 'encrypted-url'
        },
        lastUpdated: '2024-01-01T00:00:00.000Z',
        metadata: { keyCount: 3 }
      };
      fs.readFileSync.mockReturnValue(JSON.stringify(savedEnvData));

      // 5. Get environment summary
      summary = environmentManager.getEnvironmentSummary(serverId);
      expect(summary.exists).toBe(true);
      expect(summary.keyCount).toBe(3);
      expect(summary.variables.API_KEY).toMatchObject({
        set: true,
        masked: '••••••••••••••••',
        type: 'api_key',
        required: false
      });

      // 6. Load and decrypt variables
      mockEncryptionManager.decrypt.mockImplementation((encrypted) => {
        if (encrypted === 'encrypted-api-key') return 'test-api-key';
        if (encrypted === 'encrypted-secret') return 'test-secret';
        if (encrypted === 'encrypted-url') return 'https://api.example.com';
        return 'decrypted-value';
      });

      const loadedVariables = environmentManager.loadEnvironmentVariables(serverId);
      expect(loadedVariables).toEqual(newVariables);

      // 7. Delete environment variables
      const deleteResult = environmentManager.deleteEnvironmentVariables(serverId);
      expect(deleteResult).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle corrupted configuration and environment files gracefully', async () => {
      // Test corrupted config file
      fs.promises.readFile.mockRejectedValue(new Error('Config file corrupted'));
      
      const servers = await configParser.getMCPServers();
      expect(servers).toEqual([]);

      // Test corrupted environment file
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Environment file corrupted');
      });

      const variables = environmentManager.loadEnvironmentVariables('test-server');
      expect(variables).toEqual({});
      
      const summary = environmentManager.getEnvironmentSummary('test-server');
      expect(summary.exists).toBe(false);
      expect(summary.error).toBe('Environment file corrupted');
    });

    test('should handle permission errors during environment variable operations', async () => {
      // Test save permission error
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const saveResult = await environmentManager.saveEnvironmentVariables('test-server', {
        API_KEY: 'test-key'
      });
      expect(saveResult).toBe(false);

      // Test delete permission error
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const deleteResult = environmentManager.deleteEnvironmentVariables('test-server');
      expect(deleteResult).toBe(false);
    });

    test('should handle mixed transport types with environment variables', async () => {
      const mixedConfig = {
        mcpServers: {
          'stdio-server': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          },
          'sse-server': {
            transport: 'sse',
            url: 'https://example.com/sse'
          },
          'http-server': {
            transport: 'streamable-http',
            url: 'https://example.com/mcp'
          }
        }
      };

      fs.promises.readFile.mockResolvedValue(JSON.stringify(mixedConfig));
      
      const servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(3);
      
      // Mock environment file exists only for stdio server
      fs.existsSync.mockImplementation((path) => {
        return path.includes('stdio-server.env.json');
      });
      
      // Only stdio servers should be enhanced with environment variables
      const enhancedServers = servers.map(server => 
        environmentManager.updateServerConfigWithEnvFile(server)
      );
      
      const stdioServer = enhancedServers.find(s => s.type === 'stdio');
      const sseServer = enhancedServers.find(s => s.type === 'sse');
      const httpServer = enhancedServers.find(s => s.type === 'streamable-http');
      
      // Only stdio server should have envFile property (since env file exists only for it)
      expect(stdioServer.envFile).toBeDefined();
      expect(sseServer.envFile).toBeUndefined();
      expect(httpServer.envFile).toBeUndefined();
    });
  });
});