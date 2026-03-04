import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SystemMetricsService } from '../services/system-metrics-service.js';

function createMockDb() {
  return {
    select: jest.fn<() => any>().mockImplementation(() => ({
      from: jest.fn<() => any>().mockImplementation(() => Promise.resolve([])),
    })),
  } as any;
}

function createMockConnectionManager(connections: any[] = []) {
  return {
    listConnections: jest.fn<() => any>().mockReturnValue(connections),
  } as any;
}

function createMockRuntimeService(processes: any[] = []) {
  return {
    listRunningProcesses: jest.fn<() => any>().mockReturnValue(processes),
  } as any;
}

describe('SystemMetricsService', () => {
  let service: SystemMetricsService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('should initialize without optional services', () => {
    service = new SystemMetricsService(mockDb);
    expect(service).toBeDefined();
  });

  it('should return metrics with system info', async () => {
    service = new SystemMetricsService(mockDb);
    const metrics = await service.getMetrics();

    expect(metrics.system.platform).toBeDefined();
    expect(metrics.system.arch).toBeDefined();
    expect(metrics.system.nodeVersion).toBeDefined();
    expect(metrics.system.cpuCount).toBeGreaterThan(0);
    expect(metrics.system.memoryUsage.totalSystem).toBeGreaterThan(0);
    expect(metrics.system.memoryUsage.usedPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.system.memoryUsage.usedPercent).toBeLessThanOrEqual(100);
    expect(metrics.system.loadAverage).toHaveLength(3);
    expect(metrics.timestamp).toBeDefined();
  });

  it('should return zero DB counts when tables are empty', async () => {
    service = new SystemMetricsService(mockDb);
    const metrics = await service.getMetrics();

    expect(metrics.database.healthRecordCount).toBe(0);
    expect(metrics.database.runtimeLogCount).toBe(0);
    expect(metrics.database.auditLogCount).toBe(0);
  });

  it('should handle DB errors gracefully', async () => {
    const errorDb = {
      select: jest.fn<() => any>().mockImplementation(() => ({
        from: jest.fn<() => any>().mockImplementation(() => Promise.reject(new Error('table missing'))),
      })),
    } as any;

    service = new SystemMetricsService(errorDb);
    const metrics = await service.getMetrics();

    expect(metrics.database.healthRecordCount).toBe(0);
    expect(metrics.database.runtimeLogCount).toBe(0);
    expect(metrics.database.auditLogCount).toBe(0);
  });

  it('should report connection stats', async () => {
    const connMgr = createMockConnectionManager([
      { id: 's1', status: 'connected' },
      { id: 's2', status: 'connected' },
      { id: 's3', status: 'error' },
      { id: 's4', status: 'disconnected' },
    ]);

    service = new SystemMetricsService(mockDb, connMgr);
    const metrics = await service.getMetrics();

    expect(metrics.connections.total).toBe(4);
    expect(metrics.connections.connected).toBe(2);
    expect(metrics.connections.errored).toBe(1);
  });

  it('should report zero connections without connection manager', async () => {
    service = new SystemMetricsService(mockDb, null);
    const metrics = await service.getMetrics();

    expect(metrics.connections.total).toBe(0);
    expect(metrics.connections.connected).toBe(0);
    expect(metrics.connections.errored).toBe(0);
  });

  it('should report runtime stats', async () => {
    const runtime = createMockRuntimeService([
      { serverId: 's1', healthy: true },
      { serverId: 's2', healthy: true },
      { serverId: 's3', healthy: false },
    ]);

    service = new SystemMetricsService(mockDb, null, runtime);
    const metrics = await service.getMetrics();

    expect(metrics.runtime.enabled).toBe(true);
    expect(metrics.runtime.runningProcesses).toBe(3);
    expect(metrics.runtime.healthyProcesses).toBe(2);
  });

  it('should report runtime disabled without service', async () => {
    service = new SystemMetricsService(mockDb, null, null);
    const metrics = await service.getMetrics();

    expect(metrics.runtime.enabled).toBe(false);
    expect(metrics.runtime.runningProcesses).toBe(0);
    expect(metrics.runtime.healthyProcesses).toBe(0);
  });

  it('should track uptime from construction', async () => {
    service = new SystemMetricsService(mockDb);
    const metrics = await service.getMetrics();

    expect(metrics.system.uptime).toBeGreaterThanOrEqual(0);
    expect(metrics.system.uptime).toBeLessThan(5);
  });
});
