import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { LogRotationService } from '../services/log-rotation-service.js';

function createMockDb(recordCounts: { health: number; runtime: number; audit: number } = { health: 0, runtime: 0, audit: 0 }) {
  const counts = { ...recordCounts };

  return {
    _counts: counts,
    select: jest.fn<() => any>().mockImplementation(() => ({
      from: jest.fn<() => any>().mockImplementation((table: any) => {
        const tableName = table?.[Symbol.for('drizzle:Name')] ?? 'unknown';
        if (tableName === 'health_records') return Promise.resolve(new Array(counts.health));
        if (tableName === 'server_runtime_logs') return Promise.resolve(new Array(counts.runtime));
        if (tableName === 'audit_logs') return Promise.resolve(new Array(counts.audit));
        return Promise.resolve([]);
      }),
    })),
    run: jest.fn<() => any>().mockImplementation(() => {
      // Simulate deletion by reducing counts
      counts.health = 0;
      counts.runtime = 0;
      counts.audit = 0;
    }),
  } as any;
}

describe('LogRotationService', () => {
  let service: LogRotationService;
  let mockDb: ReturnType<typeof createMockDb>;

  afterEach(() => {
    service?.stop();
  });

  describe('constructor', () => {
    it('should use default retention config', () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb);
      const config = service.getConfig();

      expect(config.healthRecordsDays).toBe(30);
      expect(config.runtimeLogsDays).toBe(14);
      expect(config.auditLogsDays).toBe(90);
    });

    it('should accept custom retention config', () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb, {
        healthRecordsDays: 7,
        auditLogsDays: 30,
      });
      const config = service.getConfig();

      expect(config.healthRecordsDays).toBe(7);
      expect(config.runtimeLogsDays).toBe(14);
      expect(config.auditLogsDays).toBe(30);
    });
  });

  describe('rotate', () => {
    it('should return zero counts when tables are empty', async () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb);
      const result = await service.rotate();

      expect(result.healthRecords).toBe(0);
      expect(result.runtimeLogs).toBe(0);
      expect(result.auditLogs).toBe(0);
    });

    it('should handle missing tables gracefully', async () => {
      const errorDb = {
        select: jest.fn<() => any>().mockImplementation(() => ({
          from: jest.fn<() => any>().mockImplementation(() => Promise.reject(new Error('no such table'))),
        })),
        run: jest.fn<() => any>(),
      } as any;

      service = new LogRotationService(errorDb);
      const result = await service.rotate();

      expect(result.healthRecords).toBe(0);
      expect(result.runtimeLogs).toBe(0);
      expect(result.auditLogs).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should start periodic rotation', () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb);
      service.start(60000);
      // Should not throw
      service.stop();
    });

    it('should handle multiple stop calls', () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb);
      service.start(60000);
      service.stop();
      service.stop(); // Should not throw
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      mockDb = createMockDb();
      service = new LogRotationService(mockDb);
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object references
    });
  });
});
