/**
 * Unit tests for ConfigParser class
 */
const fs = require('fs');
const ConfigParser = require('../../config-parser');

// Mock dependencies
jest.mock('fs');
jest.mock('../../config-validator');
jest.mock('../../error-handler', () => ({
  Logger: {
    error: jest.fn(),
    success: jest.fn()
  },
  MCPError: class MockMCPError extends Error {},
  ErrorCodes: {}
}));

const ConfigValidator = require('../../config-validator');
const { Logger } = require('../../error-handler');

describe('ConfigParser', () => {
  let configParser;
  let consoleSpy;

  beforeEach(() => {
    configParser = new ConfigParser('/test/config.json');
    
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };

    // Reset all mocks
    jest.clearAllMocks();
    
    // Default mock implementations
    fs.existsSync.mockReturnValue(true);
    
    // Mock fs.promises methods
    fs.promises = {
      stat: jest.fn().mockResolvedValue({ 
        mtime: new Date('2024-01-01T00:00:00.000Z'),
        size: 1000
      }),
      readFile: jest.fn().mockResolvedValue('{"mcpServers": {}}')
    };
    
    ConfigValidator.validateClaudeConfig.mockReturnValue(true);
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should initialize with default config path', () => {
      const parser = new ConfigParser();
      
      expect(parser.configPath).toBe('/config/claude_desktop_config.json');
      expect(parser.lastModified).toBe(null);
      expect(parser.parsedConfig).toBe(null);
    });

    test('should initialize with custom config path', () => {
      const customPath = '/custom/path/config.json';
      const parser = new ConfigParser(customPath);
      
      expect(parser.configPath).toBe(customPath);
    });
  });

  describe('loadConfig', () => {
    test('should load and parse valid configuration', async () => {
      const mockConfig = {
        mcpServers: {
          memory: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          }
        }
      };
      
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      
      const result = await configParser.loadConfig();
      
      expect(result).toEqual(mockConfig);
      expect(configParser.parsedConfig).toEqual(mockConfig);
      expect(Logger.success).toHaveBeenCalledWith('Configuration loaded and validated: /test/config.json');
    });

    test('should return null if config file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = await configParser.loadConfig();
      
      expect(result).toBe(null);
      expect(Logger.error).toHaveBeenCalledWith('Config file not found: /test/config.json');
    });

    test('should return cached config if file not modified', async () => {
      const mockConfig = { mcpServers: {} };
      const mockTime = new Date('2024-01-01T00:00:00.000Z').getTime();
      
      // First load
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      fs.promises.stat.mockResolvedValue({ mtime: new Date(mockTime) });
      
      await configParser.loadConfig();
      
      // Second load with same timestamp
      fs.promises.readFile.mockClear();
      
      const result = await configParser.loadConfig();
      
      expect(result).toEqual(mockConfig);
      expect(fs.promises.readFile).not.toHaveBeenCalled();
    });

    test('should reload config if file modified', async () => {
      const mockConfig1 = { mcpServers: { server1: {} } };
      const mockConfig2 = { mcpServers: { server2: {} } };
      
      // First load
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(mockConfig1));
      fs.promises.stat.mockResolvedValueOnce({ 
        mtime: new Date('2024-01-01T00:00:00.000Z') 
      });
      
      await configParser.loadConfig();
      
      // Second load with different timestamp
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(mockConfig2));
      fs.promises.stat.mockResolvedValueOnce({ 
        mtime: new Date('2024-01-01T01:00:00.000Z') 
      });
      
      const result = await configParser.loadConfig();
      
      expect(result).toEqual(mockConfig2);
      expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
    });

    test('should handle JSON parsing errors', async () => {
      fs.promises.readFile.mockResolvedValue('invalid json {');
      
      const result = await configParser.loadConfig();
      
      expect(result).toBe(null);
      expect(Logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Config loading failed'),
        expect.any(Error)
      );
    });

    test('should handle validation errors', async () => {
      const mockError = new Error('Invalid config structure');
      ConfigValidator.validateClaudeConfig.mockImplementation(() => {
        throw mockError;
      });
      
      const result = await configParser.loadConfig();
      
      expect(result).toBe(null);
      expect(Logger.error).toHaveBeenCalledWith(
        'Config loading failed: Invalid config structure',
        mockError
      );
    });
  });

  describe('getMCPServers', () => {
    test('should return empty array for null config', async () => {
      fs.existsSync.mockReturnValue(false);
      
      const servers = await configParser.getMCPServers();
      
      expect(servers).toEqual([]);
    });

    test('should return empty array for config without mcpServers', async () => {
      fs.promises.readFile.mockResolvedValue('{}');
      
      const servers = await configParser.getMCPServers();
      
      expect(servers).toEqual([]);
    });

    test('should parse valid MCP servers', async () => {
      const mockConfig = {
        mcpServers: {
          memory: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          filesystem: {
            command: 'python',
            args: ['server.py'],
            env: { PATH: '/usr/bin' }
          }
        }
      };
      
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      
      const servers = await configParser.getMCPServers();
      
      expect(servers).toHaveLength(2);
      expect(servers[0]).toMatchObject({
        id: 'memory',
        name: 'memory',
        type: 'stdio',
        command: 'npx'
      });
      expect(servers[1]).toMatchObject({
        id: 'filesystem',
        name: 'filesystem',
        type: 'stdio',
        command: 'python'
      });
    });
  });

  describe('parseMCPServer', () => {
    test('should parse SSE transport server', () => {
      const config = {
        transport: 'sse',
        url: 'https://example.com/sse',
        headers: { 'Authorization': 'Bearer token' }
      };
      
      const result = configParser.parseMCPServer('test-sse', config);
      
      expect(result).toEqual({
        id: 'test-sse',
        name: 'test-sse',
        type: 'sse',
        url: 'https://example.com/sse',
        headers: { 'Authorization': 'Bearer token' },
        transport: 'sse',
        needsProxy: true
      });
    });

    test('should parse streamable-http transport server', () => {
      const config = {
        transport: 'streamable-http',
        url: 'https://example.com/mcp'
      };
      
      const result = configParser.parseMCPServer('test-http', config);
      
      expect(result).toEqual({
        id: 'test-http',
        name: 'test-http',
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: {},
        transport: 'streamable-http',
        needsProxy: true
      });
    });

    test('should parse stdio transport server', () => {
      const config = {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { NODE_ENV: 'production' },
        proxyType: 'mcpo'
      };
      
      const result = configParser.parseMCPServer('test-stdio', config);
      
      expect(result).toMatchObject({
        id: 'test-stdio',
        name: 'test-stdio',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { NODE_ENV: 'production' },
        transport: 'stdio',
        needsProxy: true,
        proxyType: 'mcpo'
      });
    });

    test('should handle stdio server without proxyType', () => {
      const config = {
        command: 'python',
        args: ['server.py']
      };
      
      const result = configParser.parseMCPServer('test', config);
      
      expect(result.proxyType).toBeUndefined();
    });

    test('should return null for invalid stdio server', () => {
      // Mock isValidCommand to return false
      jest.spyOn(configParser, 'isValidCommand').mockReturnValue(false);
      
      const config = {
        command: 'invalid-command'
      };
      
      const result = configParser.parseMCPServer('invalid', config);
      
      expect(result).toBe(null);
      expect(consoleSpy.warn).toHaveBeenCalledWith('Skipping invalid server config: invalid');
    });

    test('should return null for unknown configuration format', () => {
      const config = {
        unknownProperty: 'value'
      };
      
      const result = configParser.parseMCPServer('unknown', config);
      
      expect(result).toBe(null);
      expect(consoleSpy.warn).toHaveBeenCalledWith('Unknown server configuration format for: unknown');
    });

    test('should handle parsing errors gracefully', () => {
      const config = {
        command: 'npx'
      };
      
      // Mock isValidCommand to throw an error
      jest.spyOn(configParser, 'isValidCommand').mockImplementation(() => {
        throw new Error('Validation error');
      });
      
      const result = configParser.parseMCPServer('error-test', config);
      
      expect(result).toBe(null);
      expect(consoleSpy.error).toHaveBeenCalledWith('Error parsing server error-test: Validation error');
    });
  });

  describe('isValidCommand', () => {
    test('should return false for missing command', () => {
      const result = configParser.isValidCommand({});
      
      expect(result).toBe(false);
    });

    test('should return true for valid commands', () => {
      const validCommands = ['npx', 'uvx', 'uv', 'python', 'node', 'docker'];
      
      validCommands.forEach(cmd => {
        const result = configParser.isValidCommand({ command: cmd });
        expect(result).toBe(true);
      });
    });

    test('should return true for commands containing valid command names', () => {
      const result = configParser.isValidCommand({ 
        command: '/usr/bin/python3' 
      });
      
      expect(result).toBe(true);
    });

    test('should warn for potentially unsupported commands but still return true', () => {
      const result = configParser.isValidCommand({ 
        command: 'unknown-command' 
      });
      
      expect(result).toBe(true);
      expect(consoleSpy.warn).toHaveBeenCalledWith('Potentially unsupported command: unknown-command');
    });
  });

  describe('getConfigStats', () => {
    test('should return stats for existing config file', async () => {
      const mockStats = {
        size: 1500,
        mtime: new Date('2024-01-01T12:00:00.000Z')
      };
      
      const mockConfig = {
        mcpServers: {
          stdio1: { command: 'npx', args: ['server1'] },
          stdio2: { command: 'python', args: ['server2'] },
          sse1: { transport: 'sse', url: 'https://example.com/sse' },
          http1: { transport: 'streamable-http', url: 'https://example.com/mcp' }
        }
      };
      
      fs.promises.stat.mockResolvedValue(mockStats);
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));
      
      const stats = await configParser.getConfigStats();
      
      expect(stats).toEqual({
        exists: true,
        path: '/test/config.json',
        size: 1500,
        modified: mockStats.mtime,
        serverCount: 4,
        stdioServers: 2,
        sseServers: 1,
        streamableHttpServers: 1
      });
    });

    test('should return non-existent stats for missing file', async () => {
      fs.existsSync.mockReturnValue(false);
      
      const stats = await configParser.getConfigStats();
      
      expect(stats).toEqual({ exists: false });
    });

    test('should handle errors gracefully', async () => {
      fs.promises.stat.mockRejectedValue(new Error('File access error'));
      
      const stats = await configParser.getConfigStats();
      
      expect(stats).toEqual({ 
        exists: false, 
        error: 'File access error' 
      });
    });
  });

  describe('watchConfig', () => {
    test('should return null for non-existent file', () => {
      fs.existsSync.mockReturnValue(false);
      
      const watcher = configParser.watchConfig(() => {});
      
      expect(watcher).toBe(null);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Cannot watch non-existent config file: /test/config.json'
      );
    });

    test('should set up file watcher for existing file', () => {
      const mockWatcher = { close: jest.fn() };
      fs.watchFile = jest.fn().mockReturnValue(mockWatcher);
      
      const callback = jest.fn();
      const watcher = configParser.watchConfig(callback);
      
      expect(watcher).toBe(mockWatcher);
      expect(fs.watchFile).toHaveBeenCalledWith(
        '/test/config.json',
        { interval: 1000 },
        expect.any(Function)
      );
      expect(consoleSpy.log).toHaveBeenCalledWith('Watching config file: /test/config.json');
    });

    test('should trigger callback on file modification', () => {
      const mockWatcher = { close: jest.fn() };
      let changeCallback;
      
      fs.watchFile = jest.fn().mockImplementation((path, options, callback) => {
        changeCallback = callback;
        return mockWatcher;
      });
      
      const userCallback = jest.fn();
      configParser.watchConfig(userCallback);
      
      // Simulate file change
      const curr = { mtime: new Date('2024-01-01T01:00:00.000Z') };
      const prev = { mtime: new Date('2024-01-01T00:00:00.000Z') };
      
      changeCallback(curr, prev);
      
      expect(consoleSpy.log).toHaveBeenCalledWith('Configuration file changed, reloading...');
      expect(userCallback).toHaveBeenCalledWith(expect.any(Promise));
    });
  });

  describe('generateExampleConfig', () => {
    test('should generate valid example configuration', () => {
      const example = configParser.generateExampleConfig();
      
      expect(example).toHaveProperty('mcpServers');
      expect(example.mcpServers).toHaveProperty('memory');
      expect(example.mcpServers).toHaveProperty('filesystem');
      expect(example.mcpServers).toHaveProperty('brave-search');
      expect(example.mcpServers).toHaveProperty('hosted-sse-server');
      expect(example.mcpServers).toHaveProperty('hosted-streamable-http-server');
      expect(example.mcpServers).toHaveProperty('server-with-supergateway');
      
      // Verify structure of different server types
      expect(example.mcpServers.memory).toHaveProperty('command', 'npx');
      expect(example.mcpServers['hosted-sse-server']).toHaveProperty('transport', 'sse');
      expect(example.mcpServers['hosted-streamable-http-server']).toHaveProperty('transport', 'streamable-http');
      expect(example.mcpServers['server-with-supergateway']).toHaveProperty('proxyType', 'supergateway');
    });
  });
});