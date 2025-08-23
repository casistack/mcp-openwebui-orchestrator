/**
 * Unit tests for PortManager class
 */
const PortManager = require('../../port-manager');

describe('PortManager', () => {
  let portManager;
  let consoleSpy;

  beforeEach(() => {
    portManager = new PortManager(4000, 4005); // Small range for testing
    
    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };
  });

  afterEach(() => {
    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('constructor', () => {
    test('should initialize with default port range', () => {
      const defaultManager = new PortManager();
      
      expect(defaultManager.startPort).toBe(4000);
      expect(defaultManager.endPort).toBe(4100);
      expect(defaultManager.allocatedPorts).toBeInstanceOf(Set);
      expect(defaultManager.serverPorts).toBeInstanceOf(Map);
    });

    test('should initialize with custom port range', () => {
      const customManager = new PortManager(5000, 5010);
      
      expect(customManager.startPort).toBe(5000);
      expect(customManager.endPort).toBe(5010);
    });

    test('should initialize with empty allocations', () => {
      expect(portManager.allocatedPorts.size).toBe(0);
      expect(portManager.serverPorts.size).toBe(0);
    });
  });

  describe('allocatePort', () => {
    test('should allocate first available port', () => {
      const port = portManager.allocatePort('server1');
      
      expect(port).toBe(4000);
      expect(portManager.allocatedPorts.has(4000)).toBe(true);
      expect(portManager.serverPorts.get('server1')).toBe(4000);
      expect(consoleSpy.log).toHaveBeenCalledWith('Allocated port 4000 for server server1');
    });

    test('should allocate sequential ports for different servers', () => {
      const port1 = portManager.allocatePort('server1');
      const port2 = portManager.allocatePort('server2');
      const port3 = portManager.allocatePort('server3');
      
      expect(port1).toBe(4000);
      expect(port2).toBe(4001);
      expect(port3).toBe(4002);
    });

    test('should return same port for same server', () => {
      const port1 = portManager.allocatePort('server1');
      const port2 = portManager.allocatePort('server1');
      
      expect(port1).toBe(port2);
      expect(port1).toBe(4000);
      expect(portManager.allocatedPorts.size).toBe(1);
    });

    test('should return null when no ports available', () => {
      // Fill up all available ports (4000-4005 = 6 ports)
      for (let i = 0; i < 6; i++) {
        portManager.allocatePort(`server${i}`);
      }
      
      const port = portManager.allocatePort('overflow-server');
      
      expect(port).toBe(null);
      expect(consoleSpy.error).toHaveBeenCalledWith('No available ports in range 4000-4005');
    });

    test('should handle port allocation near range limits', () => {
      const singlePortManager = new PortManager(9000, 9000);
      
      const port1 = singlePortManager.allocatePort('server1');
      const port2 = singlePortManager.allocatePort('server2');
      
      expect(port1).toBe(9000);
      expect(port2).toBe(null);
    });
  });

  describe('deallocatePort', () => {
    test('should deallocate port for existing server', () => {
      const port = portManager.allocatePort('server1');
      
      portManager.deallocatePort('server1');
      
      expect(portManager.allocatedPorts.has(port)).toBe(false);
      expect(portManager.serverPorts.has('server1')).toBe(false);
      expect(consoleSpy.log).toHaveBeenCalledWith('Deallocated port 4000 for server server1');
    });

    test('should handle deallocation of non-existent server', () => {
      portManager.deallocatePort('non-existent-server');
      
      // Should not throw error, just silently handle
      expect(consoleSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('Deallocated'));
    });

    test('should allow reallocation of deallocated port', () => {
      portManager.allocatePort('server1');
      portManager.allocatePort('server2');
      portManager.deallocatePort('server1');
      
      const newPort = portManager.allocatePort('server3');
      
      expect(newPort).toBe(4000); // Should reuse the deallocated port
    });
  });

  describe('getPort', () => {
    test('should return port for allocated server', () => {
      portManager.allocatePort('server1');
      
      const port = portManager.getPort('server1');
      
      expect(port).toBe(4000);
    });

    test('should return null for non-existent server', () => {
      const port = portManager.getPort('non-existent-server');
      
      expect(port).toBe(null);
    });
  });

  describe('getAllocatedPorts', () => {
    test('should return empty array when no ports allocated', () => {
      const allocations = portManager.getAllocatedPorts();
      
      expect(allocations).toEqual([]);
    });

    test('should return array of server-port mappings', () => {
      portManager.allocatePort('server1');
      portManager.allocatePort('server2');
      portManager.allocatePort('server3');
      
      const allocations = portManager.getAllocatedPorts();
      
      expect(allocations).toEqual([
        { serverId: 'server1', port: 4000 },
        { serverId: 'server2', port: 4001 },
        { serverId: 'server3', port: 4002 }
      ]);
    });

    test('should reflect deallocations in returned array', () => {
      portManager.allocatePort('server1');
      portManager.allocatePort('server2');
      portManager.deallocatePort('server1');
      
      const allocations = portManager.getAllocatedPorts();
      
      expect(allocations).toEqual([
        { serverId: 'server2', port: 4001 }
      ]);
    });
  });

  describe('isPortAvailable', () => {
    test('should return true for available port in range', () => {
      expect(portManager.isPortAvailable(4002)).toBe(true);
    });

    test('should return false for allocated port', () => {
      portManager.allocatePort('server1');
      
      expect(portManager.isPortAvailable(4000)).toBe(false);
    });

    test('should return false for port below range', () => {
      expect(portManager.isPortAvailable(3999)).toBe(false);
    });

    test('should return false for port above range', () => {
      expect(portManager.isPortAvailable(4006)).toBe(false);
    });

    test('should return true for port at range boundaries', () => {
      expect(portManager.isPortAvailable(4000)).toBe(true);
      expect(portManager.isPortAvailable(4005)).toBe(true);
    });
  });

  describe('getStats', () => {
    test('should return correct stats for empty manager', () => {
      const stats = portManager.getStats();
      
      expect(stats).toEqual({
        totalPorts: 6,
        allocatedCount: 0,
        availableCount: 6,
        utilizationPercent: 0
      });
    });

    test('should return correct stats with partial allocation', () => {
      portManager.allocatePort('server1');
      portManager.allocatePort('server2');
      
      const stats = portManager.getStats();
      
      expect(stats).toEqual({
        totalPorts: 6,
        allocatedCount: 2,
        availableCount: 4,
        utilizationPercent: 33
      });
    });

    test('should return correct stats with full allocation', () => {
      // Allocate all 6 ports
      for (let i = 0; i < 6; i++) {
        portManager.allocatePort(`server${i}`);
      }
      
      const stats = portManager.getStats();
      
      expect(stats).toEqual({
        totalPorts: 6,
        allocatedCount: 6,
        availableCount: 0,
        utilizationPercent: 100
      });
    });

    test('should handle utilization percentage rounding', () => {
      // Allocate 1 out of 6 ports (16.666...%)
      portManager.allocatePort('server1');
      
      const stats = portManager.getStats();
      
      expect(stats.utilizationPercent).toBe(17); // Should round to 17%
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle empty server ID', () => {
      const port = portManager.allocatePort('');
      
      expect(port).toBe(4000);
      expect(portManager.getPort('')).toBe(4000);
    });

    test('should handle numeric server IDs', () => {
      const port = portManager.allocatePort(123);
      
      expect(port).toBe(4000);
      expect(portManager.getPort(123)).toBe(4000);
    });

    test('should maintain consistency after multiple operations', () => {
      // Complex sequence of operations
      portManager.allocatePort('A');
      portManager.allocatePort('B');
      portManager.allocatePort('C');
      portManager.deallocatePort('B');
      portManager.allocatePort('D');
      portManager.deallocatePort('A');
      portManager.allocatePort('E');
      
      const allocations = portManager.getAllocatedPorts();
      const stats = portManager.getStats();
      
      expect(allocations.length).toBe(3);
      expect(stats.allocatedCount).toBe(3);
      expect(stats.availableCount).toBe(3);
    });
  });
});