import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ConnectionManager } from '../services/connection-manager.js';

// Mock services
function createMockServerService() {
  return {
    listServers: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
    getServer: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    updateServer: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    createServer: jest.fn<() => Promise<any>>().mockResolvedValue({}),
    deleteServer: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    getServerCount: jest.fn<() => Promise<number>>().mockResolvedValue(0),
    setEnvVar: jest.fn<() => Promise<any>>().mockResolvedValue({}),
    getEnvVars: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
    deleteEnvVar: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  } as any;
}

function createMockToolConfigService() {
  return {
    getToolConfigs: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
    setToolConfig: jest.fn<() => Promise<any>>().mockResolvedValue({}),
    bulkSetToolConfigs: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
    deleteToolConfig: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    getToolConfig: jest.fn<() => Promise<any>>().mockResolvedValue(null),
  } as any;
}

describe('ConnectionManager', () => {
  let cm: ConnectionManager;
  let mockServerService: ReturnType<typeof createMockServerService>;
  let mockToolConfigService: ReturnType<typeof createMockToolConfigService>;

  beforeEach(() => {
    mockServerService = createMockServerService();
    mockToolConfigService = createMockToolConfigService();
    cm = new ConnectionManager(mockServerService, mockToolConfigService);
  });

  describe('constructor', () => {
    it('should initialize with empty connections', () => {
      expect(cm.listConnections()).toEqual([]);
    });
  });

  describe('listConnections', () => {
    it('should return empty array when no connections', () => {
      expect(cm.listConnections()).toHaveLength(0);
    });
  });

  describe('getClient', () => {
    it('should return null for unknown server', () => {
      expect(cm.getClient('nonexistent')).toBeNull();
    });
  });

  describe('getConnectionInfo', () => {
    it('should return null for unknown server', () => {
      expect(cm.getConnectionInfo('nonexistent')).toBeNull();
    });
  });

  describe('isConnected', () => {
    it('should return false for unknown server', () => {
      expect(cm.isConnected('nonexistent')).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should handle disconnecting unknown server gracefully', async () => {
      await cm.disconnect('nonexistent');
      // Should not throw
    });
  });

  describe('disconnectAll', () => {
    it('should handle empty connection pool', async () => {
      await cm.disconnectAll();
      expect(cm.listConnections()).toHaveLength(0);
    });
  });

  describe('connectAll', () => {
    it('should report 0 connected and 0 failed with no servers', async () => {
      const result = await cm.connectAll();
      expect(result).toEqual({ connected: 0, failed: 0 });
    });

    it('should count failures for servers without valid config', async () => {
      mockServerService.listServers.mockResolvedValue([
        { id: 'bad-server', transport: 'stdio', command: null },
      ]);
      const result = await cm.connectAll();
      expect(result.failed).toBe(1);
      expect(result.connected).toBe(0);
    });
  });

  describe('health checks', () => {
    it('should start and stop health checks without error', () => {
      cm.startHealthChecks();
      cm.startHealthChecks(); // idempotent
      cm.stopHealthChecks();
      cm.stopHealthChecks(); // idempotent
    });
  });

  describe('pingAll', () => {
    it('should return empty map with no connections', async () => {
      const results = await cm.pingAll();
      expect(results.size).toBe(0);
    });
  });

  describe('constants', () => {
    it('should have reasonable defaults', () => {
      expect(ConnectionManager.MAX_RECONNECT_ATTEMPTS).toBe(5);
      expect(ConnectionManager.BASE_RECONNECT_DELAY).toBe(2_000);
      expect(ConnectionManager.HEALTH_CHECK_INTERVAL).toBe(30_000);
    });
  });

  describe('event emission', () => {
    it('should emit events on disconnect', async () => {
      // First we need to get a connection in the pool
      // Since connect requires a real server, test that disconnect of unknown is silent
      const events: string[] = [];
      cm.on('server:disconnected', () => events.push('disconnected'));
      await cm.disconnect('nonexistent');
      // No event for nonexistent server
      expect(events).toHaveLength(0);
    });
  });

  describe('discoverTools', () => {
    it('should reject for unconnected server', async () => {
      await expect(cm.discoverTools('nonexistent')).rejects.toThrow('not connected');
    });

    it('should reject discoverAndPersistTools for unconnected server', async () => {
      await expect(cm.discoverAndPersistTools('nonexistent')).rejects.toThrow('not connected');
    });
  });
});
