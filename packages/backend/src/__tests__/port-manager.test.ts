import { describe, it, expect, beforeEach } from '@jest/globals';
import { PortManager } from '../services/port-manager.js';

describe('PortManager', () => {
  let pm: PortManager;

  beforeEach(() => {
    pm = new PortManager(5000, 5004);
  });

  describe('allocatePort', () => {
    it('should allocate the first available port', () => {
      const port = pm.allocatePort('server-1');
      expect(port).toBe(5000);
    });

    it('should allocate sequential ports for different servers', () => {
      expect(pm.allocatePort('server-1')).toBe(5000);
      expect(pm.allocatePort('server-2')).toBe(5001);
      expect(pm.allocatePort('server-3')).toBe(5002);
    });

    it('should return the same port for an already-allocated server', () => {
      const first = pm.allocatePort('server-1');
      const second = pm.allocatePort('server-1');
      expect(first).toBe(second);
    });

    it('should return null when all ports are exhausted', () => {
      pm.allocatePort('s1');
      pm.allocatePort('s2');
      pm.allocatePort('s3');
      pm.allocatePort('s4');
      pm.allocatePort('s5');
      expect(pm.allocatePort('s6')).toBeNull();
    });
  });

  describe('deallocatePort', () => {
    it('should free a port for reuse', () => {
      pm.allocatePort('server-1');
      pm.allocatePort('server-2');
      pm.deallocatePort('server-1');
      const port = pm.allocatePort('server-3');
      expect(port).toBe(5000);
    });

    it('should be a no-op for unknown servers', () => {
      pm.deallocatePort('nonexistent');
      expect(pm.getStats().allocatedCount).toBe(0);
    });
  });

  describe('getPort', () => {
    it('should return the port for a known server', () => {
      pm.allocatePort('server-1');
      expect(pm.getPort('server-1')).toBe(5000);
    });

    it('should return null for unknown server', () => {
      expect(pm.getPort('unknown')).toBeNull();
    });
  });

  describe('isPortAvailable', () => {
    it('should return true for unallocated ports in range', () => {
      expect(pm.isPortAvailable(5000)).toBe(true);
    });

    it('should return false for allocated ports', () => {
      pm.allocatePort('server-1');
      expect(pm.isPortAvailable(5000)).toBe(false);
    });

    it('should return false for ports outside range', () => {
      expect(pm.isPortAvailable(4999)).toBe(false);
      expect(pm.isPortAvailable(5005)).toBe(false);
    });
  });

  describe('getAllocatedPorts', () => {
    it('should return all allocated ports', () => {
      pm.allocatePort('s1');
      pm.allocatePort('s2');
      const allocated = pm.getAllocatedPorts();
      expect(allocated).toHaveLength(2);
      expect(allocated).toEqual(expect.arrayContaining([
        { serverId: 's1', port: 5000 },
        { serverId: 's2', port: 5001 },
      ]));
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      pm.allocatePort('s1');
      pm.allocatePort('s2');
      const stats = pm.getStats();
      expect(stats.totalPorts).toBe(5);
      expect(stats.allocatedCount).toBe(2);
      expect(stats.availableCount).toBe(3);
      expect(stats.utilization).toBe(40);
    });

    it('should return zero utilization when no ports allocated', () => {
      const stats = pm.getStats();
      expect(stats.utilization).toBe(0);
      expect(stats.allocatedCount).toBe(0);
    });
  });
});
