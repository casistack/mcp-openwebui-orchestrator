/**
 * End-to-End tests for complete MCP communication workflows
 * 
 * Note: These are mock E2E tests that simulate the MCP workflow patterns
 * without requiring actual MCP servers or network connections.
 */
const ConfigParser = require('../../config-parser');
const EnvironmentManager = require('../../environment-manager');
const PortManager = require('../../port-manager');

// Mock HTTP client for simulating MCP communication
class MockMCPClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.connected = false;
    this.tools = [];
    this.resources = [];
  }

  async connect() {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 50));
    this.connected = true;
    return { status: 'connected', transport: 'http' };
  }

  async listTools() {
    if (!this.connected) throw new Error('Not connected');
    
    // Simulate different tools based on server type
    if (this.baseUrl.includes('4200')) {
      this.tools = [
        { name: 'create_memory', description: 'Create a memory entry' },
        { name: 'update_memory', description: 'Update a memory entry' },
        { name: 'search_memory', description: 'Search memory entries' }
      ];
    } else if (this.baseUrl.includes('4201')) {
      this.tools = [
        { name: 'web_search', description: 'Search the web with Brave' },
        { name: 'get_search_results', description: 'Get detailed search results' }
      ];
    }
    
    return { tools: this.tools };
  }

  async callTool(toolName, args = {}) {
    if (!this.connected) throw new Error('Not connected');
    
    const tool = this.tools.find(t => t.name === toolName);
    if (!tool) throw new Error(`Tool '${toolName}' not found`);
    
    // Simulate tool execution
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      tool: toolName,
      args,
      result: `Mock result for ${toolName}`,
      success: true
    };
  }

  async disconnect() {
    this.connected = false;
    return { status: 'disconnected' };
  }
}

// Mock the external dependencies
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

const fs = require('fs');
const ConfigValidator = require('../../config-validator');
const EncryptionManager = require('../../encryption-manager');
const secureLogger = require('../../secure-logger');

describe('MCP Communication Workflow E2E', () => {
  let configParser;
  let environmentManager;
  let portManager;
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
    fs.renameSync.mockReturnValue(undefined);
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

    // Initialize components
    configParser = new ConfigParser('/test/config.json');
    environmentManager = new EnvironmentManager();
    portManager = new PortManager(4200, 4210);
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    jest.clearAllMocks();
  });

  describe('Complete MCP Server Lifecycle', () => {
    test('should handle full server deployment and communication workflow', async () => {
      // 1. Load configuration with multiple MCP servers
      const mockConfig = {
        mcpServers: {
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          'brave-search': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          }
        }
      };
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(2);

      // 2. Allocate ports for servers
      const deployedServers = servers.map(server => {
        const port = portManager.allocatePort(server.id);
        return {
          ...server,
          port,
          url: `http://localhost:${port}`
        };
      });

      expect(deployedServers[0].port).toBe(4200);
      expect(deployedServers[1].port).toBe(4201);

      // 3. Setup environment variables for servers that need them
      const braveEnvData = {
        variables: { BRAVE_API_KEY: 'encrypted-brave-key' }
      };
      fs.readFileSync.mockImplementation((path) => {
        if (path.includes('brave-search.env.json')) {
          return JSON.stringify(braveEnvData);
        }
        return '{"variables": {}}';
      });
      mockEncryptionManager.decrypt.mockReturnValue('brave-api-key-12345');

      // Enhance servers with environment variables
      const enhancedServers = deployedServers.map(server => {
        if (server.id === 'brave-search') {
          return environmentManager.updateServerConfigWithEnvFile(server);
        }
        return server;
      });

      const braveServer = enhancedServers.find(s => s.id === 'brave-search');
      expect(braveServer.env.BRAVE_API_KEY).toBe('brave-api-key-12345');

      // 4. Simulate MCP client connections to deployed servers
      const mcpClients = enhancedServers.map(server => 
        new MockMCPClient(server.url)
      );

      // Connect to all servers
      const connections = await Promise.all(
        mcpClients.map(client => client.connect())
      );
      expect(connections).toHaveLength(2);
      expect(connections.every(conn => conn.status === 'connected')).toBe(true);

      // 5. Discover tools from each server
      const toolDiscovery = await Promise.all(
        mcpClients.map(async (client, index) => ({
          server: enhancedServers[index],
          tools: await client.listTools()
        }))
      );

      expect(toolDiscovery[0].tools.tools).toHaveLength(3); // Memory server tools
      expect(toolDiscovery[1].tools.tools).toHaveLength(2); // Brave search tools

      // 6. Execute tools on different servers
      const memoryClient = mcpClients[0];
      const braveClient = mcpClients[1];

      const memoryResult = await memoryClient.callTool('create_memory', {
        key: 'test-key',
        value: 'test-value'
      });
      expect(memoryResult.success).toBe(true);
      expect(memoryResult.tool).toBe('create_memory');

      const searchResult = await braveClient.callTool('web_search', {
        query: 'MCP protocol documentation'
      });
      expect(searchResult.success).toBe(true);
      expect(searchResult.tool).toBe('web_search');

      // 7. Cleanup - disconnect clients and deallocate ports
      await Promise.all(mcpClients.map(client => client.disconnect()));
      
      enhancedServers.forEach(server => {
        portManager.deallocatePort(server.id);
      });

      const finalStats = portManager.getStats();
      expect(finalStats.allocatedCount).toBe(0);
      expect(finalStats.utilizationPercent).toBe(0);
    });
  });

  describe('Dynamic Configuration Updates', () => {
    test('should handle configuration changes and server redeployment', async () => {
      // 1. Initial configuration with one server
      const initialConfig = {
        mcpServers: {
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          }
        }
      };
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(initialConfig));

      let servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(1);

      const memoryPort = portManager.allocatePort('memory');
      expect(memoryPort).toBe(4200);

      // 2. Simulate configuration file change
      const updatedConfig = {
        mcpServers: {
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          'filesystem': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
          },
          'brave-search': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-brave-search']
          }
        }
      };

      // Simulate file modification time change
      fs.promises.stat.mockResolvedValueOnce({ 
        mtime: new Date('2024-01-01T01:00:00.000Z')
      });
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(updatedConfig));

      // 3. Reload configuration
      servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(3);

      // 4. Allocate ports for new servers (memory keeps its port)
      const newServers = servers.filter(s => s.id !== 'memory');
      newServers.forEach(server => {
        const port = portManager.allocatePort(server.id);
        server.port = port;
      });

      expect(portManager.getPort('memory')).toBe(4200); // Existing port preserved
      expect(portManager.getPort('filesystem')).toBe(4201); // New port
      expect(portManager.getPort('brave-search')).toBe(4202); // New port

      // 5. Test communication with new servers
      const filesystemClient = new MockMCPClient(`http://localhost:4201`);
      await filesystemClient.connect();
      
      const tools = await filesystemClient.listTools();
      expect(tools.tools).toBeDefined(); // Should have tools available

      // 6. Simulate removing a server from configuration
      const finalConfig = {
        mcpServers: {
          'memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          'filesystem': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
          }
        }
      };

      fs.promises.stat.mockResolvedValueOnce({ 
        mtime: new Date('2024-01-01T02:00:00.000Z')
      });
      fs.promises.readFile.mockResolvedValueOnce(JSON.stringify(finalConfig));

      servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(2);

      // Clean up removed server
      portManager.deallocatePort('brave-search');
      expect(portManager.getPort('brave-search')).toBe(null);
      expect(portManager.isPortAvailable(4202)).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle server failures and recovery gracefully', async () => {
      // 1. Setup servers
      const mockConfig = {
        mcpServers: {
          'reliable-server': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
          },
          'unstable-server': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-unreliable']
          }
        }
      };
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const servers = await configParser.getMCPServers();
      const deployedServers = servers.map(server => ({
        ...server,
        port: portManager.allocatePort(server.id),
        url: `http://localhost:${portManager.getPort(server.id)}`
      }));

      // 2. Connect to servers - simulate one failing
      const reliableClient = new MockMCPClient(deployedServers[0].url);
      const unstableClient = new MockMCPClient(deployedServers[1].url);

      await reliableClient.connect();
      expect(reliableClient.connected).toBe(true);

      // Simulate unstable server connection failure
      jest.spyOn(unstableClient, 'connect').mockRejectedValue(new Error('Connection failed'));
      
      let connectionError = null;
      try {
        await unstableClient.connect();
      } catch (error) {
        connectionError = error;
      }
      
      expect(connectionError.message).toBe('Connection failed');
      expect(unstableClient.connected).toBe(false);

      // 3. Continue operation with available server
      const tools = await reliableClient.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);

      const result = await reliableClient.callTool(tools.tools[0].name, {});
      expect(result.success).toBe(true);

      // 4. Simulate server recovery
      jest.spyOn(unstableClient, 'connect').mockImplementation(async () => {
        unstableClient.connected = true; // Set state properly
        return { status: 'connected', transport: 'http' };
      });

      await unstableClient.connect();
      expect(unstableClient.connected).toBe(true);

      // 5. Both servers should now be operational
      const allClients = [reliableClient, unstableClient];
      const healthChecks = await Promise.all(
        allClients.map(async client => {
          try {
            const tools = await client.listTools();
            return { healthy: true, toolCount: tools.tools.length };
          } catch (error) {
            return { healthy: false, error: error.message };
          }
        })
      );

      expect(healthChecks.every(check => check.healthy)).toBe(true);
    });

    test('should handle port conflicts and resource constraints', async () => {
      // Create a port manager with very limited range
      const constrainedPortManager = new PortManager(4200, 4201); // Only 2 ports

      const mockConfig = {
        mcpServers: {
          'server1': { command: 'npx', args: ['server1'] },
          'server2': { command: 'npx', args: ['server2'] },
          'server3': { command: 'npx', args: ['server3'] }
        }
      };
      fs.promises.readFile.mockResolvedValue(JSON.stringify(mockConfig));

      const servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(3);

      // Allocate ports - should succeed for first two servers
      const port1 = constrainedPortManager.allocatePort('server1');
      const port2 = constrainedPortManager.allocatePort('server2');
      const port3 = constrainedPortManager.allocatePort('server3');

      expect(port1).toBe(4200);
      expect(port2).toBe(4201);
      expect(port3).toBe(null); // No more ports available

      // Verify port utilization
      const stats = constrainedPortManager.getStats();
      expect(stats.utilizationPercent).toBe(100);
      expect(stats.allocatedCount).toBe(2);

      // Simulate server shutdown and port reuse
      constrainedPortManager.deallocatePort('server1');
      const reclaimedPort = constrainedPortManager.allocatePort('server3');
      expect(reclaimedPort).toBe(4200); // Reused the freed port
    });
  });

  describe('Multi-Transport Support', () => {
    test('should handle different transport types in same deployment', async () => {
      const mixedTransportConfig = {
        mcpServers: {
          'stdio-memory': {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-memory']
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

      fs.promises.readFile.mockResolvedValue(JSON.stringify(mixedTransportConfig));
      const servers = await configParser.getMCPServers();
      expect(servers).toHaveLength(3);

      // Categorize servers by transport
      const stdioServers = servers.filter(s => s.type === 'stdio');
      const sseServers = servers.filter(s => s.type === 'sse');
      const httpServers = servers.filter(s => s.type === 'streamable-http');

      expect(stdioServers).toHaveLength(1);
      expect(sseServers).toHaveLength(1);
      expect(httpServers).toHaveLength(1);

      // Only stdio servers need port allocation
      const stdioPort = portManager.allocatePort(stdioServers[0].id);
      expect(stdioPort).toBe(4200);

      // Remote servers use their configured URLs
      expect(sseServers[0].url).toBe('https://example.com/sse');
      expect(httpServers[0].url).toBe('https://example.com/mcp');

      // Simulate connections to different transport types
      const clients = servers.map(server => {
        if (server.type === 'stdio') {
          return new MockMCPClient(`http://localhost:${stdioPort}`);
        } else {
          return new MockMCPClient(server.url);
        }
      });

      // All clients should be able to connect
      const connections = await Promise.all(
        clients.map(client => client.connect())
      );
      expect(connections.every(conn => conn.status === 'connected')).toBe(true);

      // Verify tool discovery works across transports
      const allTools = await Promise.all(
        clients.map(client => client.listTools())
      );
      expect(allTools.every(result => result.tools.length >= 0)).toBe(true);
    });
  });
});