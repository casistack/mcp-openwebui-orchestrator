import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { InstallationManager } from '../services/installation-manager.js';

describe('InstallationManager', () => {
  let manager: InstallationManager;

  beforeEach(() => {
    manager = new InstallationManager(2, 800);
  });

  describe('isSafeToInstall', () => {
    it('should return true when under limits', () => {
      expect(manager.isSafeToInstall()).toBe(true);
    });

    it('should return false when concurrent installs at max', () => {
      manager.markInstalling('pkg-1');
      manager.markInstalling('pkg-2');
      expect(manager.isSafeToInstall()).toBe(false);
    });

    it('should return true after completing an install', () => {
      manager.markInstalling('pkg-1');
      manager.markInstalling('pkg-2');
      manager.markDone('pkg-1');
      expect(manager.concurrentCount).toBe(1);
    });
  });

  describe('isInstalling', () => {
    it('should track installing packages', () => {
      expect(manager.isInstalling('pkg-1')).toBe(false);
      manager.markInstalling('pkg-1');
      expect(manager.isInstalling('pkg-1')).toBe(true);
    });

    it('should clear after markDone', () => {
      manager.markInstalling('pkg-1');
      manager.markDone('pkg-1');
      expect(manager.isInstalling('pkg-1')).toBe(false);
    });
  });

  describe('concurrentCount', () => {
    it('should track count correctly', () => {
      expect(manager.concurrentCount).toBe(0);
      manager.markInstalling('a');
      expect(manager.concurrentCount).toBe(1);
      manager.markInstalling('b');
      expect(manager.concurrentCount).toBe(2);
      manager.markDone('a');
      expect(manager.concurrentCount).toBe(1);
    });
  });

  describe('getMemoryStats', () => {
    it('should return memory stats in MB', () => {
      const stats = manager.getMemoryStats();
      expect(stats.rss).toBeGreaterThan(0);
      expect(stats.heapUsed).toBeGreaterThan(0);
      expect(stats.heapTotal).toBeGreaterThan(0);
      expect(typeof stats.external).toBe('number');
    });
  });

  describe('markInstalling idempotency', () => {
    it('should not double-count the same package', () => {
      manager.markInstalling('pkg-1');
      manager.markInstalling('pkg-1');
      expect(manager.concurrentCount).toBe(1);
    });
  });
});
