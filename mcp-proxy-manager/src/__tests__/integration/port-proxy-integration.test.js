/**
 * Integration tests for PortManager and ProxyManager interaction
 */
const PortManager = require('../../port-manager');

// Mock a simple ProxyManager simulation for testing port allocation patterns
class MockProxyManager {
  constructor() {
    this.portManager = new PortManager(4200, 4205); // Small range for testing
    this.servers = new Map(); // serverId -> { port, status }
    this.nextServerId = 1;
  }

  async createServer(serverConfig) {
    const serverId = serverConfig.id || `server-${this.nextServerId++}`;
    const port = this.portManager.allocatePort(serverId);
    
    if (!port) {
      throw new Error('No ports available');
    }

    const server = {
      id: serverId,
      port,
      config: serverConfig,
      status: 'starting',
      startTime: Date.now()
    };

    this.servers.set(serverId, server);
    
    // Simulate async startup
    setTimeout(() => {
      if (this.servers.has(serverId)) {
        this.servers.get(serverId).status = 'running';
      }
    }, 100);

    return server;
  }

  async stopServer(serverId) {
    const server = this.servers.get(serverId);
    if (!server) {
      return false;
    }

    server.status = 'stopping';
    this.portManager.deallocatePort(serverId);
    this.servers.delete(serverId);
    return true;
  }

  getServerStats() {
    const servers = Array.from(this.servers.values());
    return {
      total: servers.length,
      running: servers.filter(s => s.status === 'running').length,
      starting: servers.filter(s => s.status === 'starting').length,
      stopping: servers.filter(s => s.status === 'stopping').length,
      portStats: this.portManager.getStats(),
      allocatedPorts: this.portManager.getAllocatedPorts()
    };
  }

  getAllServers() {
    return Array.from(this.servers.values());
  }
}

describe('PortManager and ProxyManager Integration', () => {
  let proxyManager;
  let consoleSpy;

  beforeEach(() => {
    proxyManager = new MockProxyManager();
    
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('Server Lifecycle Management', () => {
    test('should allocate ports for new servers sequentially', async () => {
      const serverConfigs = [
        { id: 'memory', command: 'npx', args: ['@modelcontextprotocol/server-memory'] },
        { id: 'brave-search', command: 'npx', args: ['@modelcontextprotocol/server-brave-search'] },
        { id: 'firecrawl', command: 'npx', args: ['@modelcontextprotocol/server-firecrawl'] }
      ];

      const servers = [];
      for (const config of serverConfigs) {
        const server = await proxyManager.createServer(config);
        servers.push(server);
      }

      // Verify sequential port allocation
      expect(servers[0].port).toBe(4200);
      expect(servers[1].port).toBe(4201);
      expect(servers[2].port).toBe(4202);

      // Verify all servers are tracked
      const stats = proxyManager.getServerStats();
      expect(stats.total).toBe(3);
      expect(stats.allocatedPorts).toHaveLength(3);
    });

    test('should reuse ports when servers are stopped and restarted', async () => {
      // Create initial servers
      const server1 = await proxyManager.createServer({ id: 'server1' });
      const server2 = await proxyManager.createServer({ id: 'server2' });
      const server3 = await proxyManager.createServer({ id: 'server3' });

      expect([server1.port, server2.port, server3.port]).toEqual([4200, 4201, 4202]);

      // Stop middle server
      await proxyManager.stopServer('server2');
      
      // Create new server - should reuse the freed port
      const server4 = await proxyManager.createServer({ id: 'server4' });
      expect(server4.port).toBe(4201); // Reused port

      const stats = proxyManager.getServerStats();
      expect(stats.total).toBe(3); // Still 3 servers
      expect(stats.allocatedPorts.map(p => p.port).sort()).toEqual([4200, 4201, 4202]);
    });

    test('should handle port exhaustion gracefully', async () => {
      // Fill up all available ports (4200-4205 = 6 ports)
      const servers = [];
      for (let i = 0; i < 6; i++) {
        const server = await proxyManager.createServer({ id: `server${i}` });
        servers.push(server);
      }

      // Verify all ports are allocated
      const stats = proxyManager.getServerStats();
      expect(stats.total).toBe(6);
      expect(stats.portStats.utilizationPercent).toBe(100);

      // Try to create one more server - should fail
      await expect(proxyManager.createServer({ id: 'overflow' }))
        .rejects.toThrow('No ports available');

      // Stop one server and try again - should succeed
      await proxyManager.stopServer('server0');
      const newServer = await proxyManager.createServer({ id: 'replacement' });
      expect(newServer.port).toBe(4200); // Reused the first port
    });
  });

  describe('Port Allocation Patterns', () => {
    test('should handle server restart scenarios', async () => {
      // Create server with specific ID
      const originalServer = await proxyManager.createServer({ id: 'persistent-server' });
      const originalPort = originalServer.port;
      expect(originalPort).toBe(4200);

      // Stop the server
      await proxyManager.stopServer('persistent-server');
      
      // Restart same server - should get same port
      const restartedServer = await proxyManager.createServer({ id: 'persistent-server' });
      expect(restartedServer.port).toBe(originalPort);

      // Port allocation should be consistent
      const portMapping = proxyManager.portManager.getPort('persistent-server');
      expect(portMapping).toBe(originalPort);
    });

    test('should handle concurrent server creation and deletion', async () => {
      const operations = [];

      // Simulate concurrent operations
      for (let i = 0; i < 3; i++) {
        operations.push(proxyManager.createServer({ id: `concurrent-${i}` }));
      }

      const servers = await Promise.all(operations);
      
      // All servers should have unique ports
      const ports = servers.map(s => s.port);
      const uniquePorts = [...new Set(ports)];
      expect(uniquePorts).toHaveLength(3);
      expect(uniquePorts).toEqual([4200, 4201, 4202]);

      // Stop and recreate in different order
      await proxyManager.stopServer('concurrent-1');
      await proxyManager.stopServer('concurrent-0');

      const newServer1 = await proxyManager.createServer({ id: 'new-1' });
      const newServer2 = await proxyManager.createServer({ id: 'new-2' });

      // Should reuse the freed ports
      expect([newServer1.port, newServer2.port].sort()).toEqual([4200, 4201]);
    });

    test('should maintain port allocation state across multiple operations', async () => {
      const operationLog = [];
      
      // Series of create/delete operations
      const ops = [
        async () => {
          const server = await proxyManager.createServer({ id: 'temp-1' });
          operationLog.push({ op: 'create', id: 'temp-1', port: server.port });
        },
        async () => {
          const server = await proxyManager.createServer({ id: 'temp-2' });
          operationLog.push({ op: 'create', id: 'temp-2', port: server.port });
        },
        async () => {
          await proxyManager.stopServer('temp-1');
          operationLog.push({ op: 'stop', id: 'temp-1' });
        },
        async () => {
          const server = await proxyManager.createServer({ id: 'temp-3' });
          operationLog.push({ op: 'create', id: 'temp-3', port: server.port });
        },
        async () => {
          await proxyManager.stopServer('temp-2');
          operationLog.push({ op: 'stop', id: 'temp-2' });
        }
      ];

      // Execute operations sequentially
      for (const op of ops) {
        await op();
      }

      // Verify operation log and final state
      expect(operationLog).toHaveLength(5);
      
      const finalStats = proxyManager.getServerStats();
      expect(finalStats.total).toBe(1); // Only temp-3 should remain
      
      const remainingServer = proxyManager.getAllServers()[0];
      expect(remainingServer.id).toBe('temp-3');
      expect(remainingServer.port).toBe(4200); // Should have reused the first freed port
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should provide accurate statistics throughout server lifecycle', async () => {
      // Initial state
      let stats = proxyManager.getServerStats();
      expect(stats).toEqual({
        total: 0,
        running: 0,
        starting: 0,
        stopping: 0,
        portStats: {
          totalPorts: 6,
          allocatedCount: 0,
          availableCount: 6,
          utilizationPercent: 0
        },
        allocatedPorts: []
      });

      // Create servers
      await proxyManager.createServer({ id: 'monitor-1' });
      await proxyManager.createServer({ id: 'monitor-2' });

      stats = proxyManager.getServerStats();
      expect(stats.total).toBe(2);
      expect(stats.starting).toBe(2); // Servers are still starting
      expect(stats.portStats.allocatedCount).toBe(2);
      expect(stats.portStats.utilizationPercent).toBe(33); // 2/6 * 100

      // Wait for servers to be "running"
      await new Promise(resolve => setTimeout(resolve, 150));

      stats = proxyManager.getServerStats();
      expect(stats.running).toBe(2);
      expect(stats.starting).toBe(0);

      // Stop one server
      await proxyManager.stopServer('monitor-1');

      stats = proxyManager.getServerStats();
      expect(stats.total).toBe(1);
      expect(stats.portStats.allocatedCount).toBe(1);
      expect(stats.portStats.utilizationPercent).toBe(17); // 1/6 * 100 rounded
    });

    test('should track port allocation details accurately', async () => {
      const serverIds = ['alpha', 'beta', 'gamma'];
      
      for (const id of serverIds) {
        await proxyManager.createServer({ id });
      }

      const stats = proxyManager.getServerStats();
      expect(stats.allocatedPorts).toEqual([
        { serverId: 'alpha', port: 4200 },
        { serverId: 'beta', port: 4201 },
        { serverId: 'gamma', port: 4202 }
      ]);

      // Verify port availability checks
      expect(proxyManager.portManager.isPortAvailable(4200)).toBe(false);
      expect(proxyManager.portManager.isPortAvailable(4203)).toBe(true);

      // Stop middle server and verify port becomes available
      await proxyManager.stopServer('beta');
      expect(proxyManager.portManager.isPortAvailable(4201)).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle duplicate server IDs gracefully', async () => {
      // Create server with ID
      const server1 = await proxyManager.createServer({ id: 'duplicate' });
      expect(server1.port).toBe(4200);

      // Create another server with same ID - should return same port
      const server2 = await proxyManager.createServer({ id: 'duplicate' });
      expect(server2.port).toBe(4200);

      // Should still only have one server entry
      const stats = proxyManager.getServerStats();
      expect(stats.total).toBe(1);
    });

    test('should handle stopping non-existent servers', async () => {
      const result = await proxyManager.stopServer('non-existent');
      expect(result).toBe(false);

      // Port stats should remain unchanged
      const stats = proxyManager.getServerStats();
      expect(stats.portStats.allocatedCount).toBe(0);
    });

    test('should handle rapid create/delete cycles', async () => {
      const serverId = 'rapid-cycle';
      
      // Rapid create/delete cycle
      for (let i = 0; i < 5; i++) {
        const server = await proxyManager.createServer({ id: serverId });
        expect(server.port).toBe(4200); // Should always get same port for same ID
        
        const stopped = await proxyManager.stopServer(serverId);
        expect(stopped).toBe(true);
      }

      // Final state should be clean
      const stats = proxyManager.getServerStats();
      expect(stats.total).toBe(0);
      expect(stats.portStats.allocatedCount).toBe(0);
    });
  });
});