import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { HealthService } from '../services/health-service.js';

// Mock database
function createMockDb() {
  const mockResult = { changes: 0 };
  const mockChain = {
    values: jest.fn<() => any>().mockReturnThis(),
    from: jest.fn<() => any>().mockReturnThis(),
    where: jest.fn<() => any>().mockReturnThis(),
    orderBy: jest.fn<() => any>().mockReturnThis(),
    limit: jest.fn<() => any>().mockReturnThis(),
    groupBy: jest.fn<() => any>().mockResolvedValue([]),
    then: jest.fn<() => any>().mockImplementation((cb: any) => cb([])),
  };

  return {
    insert: jest.fn<() => any>().mockReturnValue({
      values: jest.fn<() => any>().mockResolvedValue(undefined),
    }),
    select: jest.fn<() => any>().mockReturnValue(mockChain),
    delete: jest.fn<() => any>().mockReturnValue({
      where: jest.fn<() => any>().mockResolvedValue(mockResult),
    }),
  } as any;
}

describe('HealthService', () => {
  let service: HealthService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new HealthService(mockDb);
  });

  describe('constructor', () => {
    it('should initialize with database', () => {
      expect(service).toBeDefined();
    });
  });

  describe('recordHealth', () => {
    it('should insert a health record', async () => {
      await service.recordHealth({
        serverId: 'test-server',
        healthy: true,
        responseTime: 42,
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should insert a failed health record', async () => {
      await service.recordHealth({
        serverId: 'test-server',
        healthy: false,
        error: 'Connection refused',
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getRecentHealth', () => {
    it('should query for recent health records', async () => {
      const result = await service.getRecentHealth('test-server');
      expect(result).toEqual([]);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should accept custom limit', async () => {
      const result = await service.getRecentHealth('test-server', 10);
      expect(result).toEqual([]);
    });
  });

  describe('getHealthStats', () => {
    it('should return default stats when no data', async () => {
      const result = await service.getHealthStats('test-server');
      expect(result.serverId).toBe('test-server');
      expect(result.totalChecks).toBe(0);
      expect(result.uptimePercent).toBe(0);
    });
  });

  describe('getAllHealthStats', () => {
    it('should query aggregated stats for all servers', async () => {
      const result = await service.getAllHealthStats();
      expect(result).toEqual([]);
    });
  });

  describe('getHealthTimeSeries', () => {
    it('should return empty array when no data', async () => {
      const result = await service.getHealthTimeSeries('test-server');
      expect(result).toEqual([]);
    });
  });

  describe('cleanupOldRecords', () => {
    it('should delete old records', async () => {
      const result = await service.cleanupOldRecords(30);
      expect(result).toBe(0);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
