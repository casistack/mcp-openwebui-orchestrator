import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { ServerRuntimeService } from '../services/server-runtime-service.js';

// Mock child_process
const mockKill = jest.fn<() => boolean>().mockReturnValue(true);
const mockOn = jest.fn<() => any>();
const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn<() => any>().mockReturnValue({
    pid: 12345,
    killed: false,
    kill: mockKill,
    on: mockOn,
    stdout: mockStdout,
    stderr: mockStderr,
  }),
}));

function createMockServerService() {
  return {
    getServer: jest.fn<() => any>().mockResolvedValue({
      id: 'test-server',
      name: 'Test Server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      cwd: null,
      url: null,
      headers: null,
      proxyType: null,
      env: null,
    }),
    listServers: jest.fn<() => any>().mockResolvedValue([]),
    getServerCount: jest.fn<() => any>().mockResolvedValue(1),
  } as any;
}

function createMockHealthService() {
  return {
    recordHealth: jest.fn<() => any>().mockResolvedValue(undefined),
  } as any;
}

function createMockDb() {
  return {
    insert: jest.fn<() => any>().mockReturnValue({
      values: jest.fn<() => any>().mockReturnValue({
        run: jest.fn<() => any>(),
      }),
    }),
    update: jest.fn<() => any>().mockReturnValue({
      set: jest.fn<() => any>().mockReturnValue({
        where: jest.fn<() => any>().mockReturnValue({
          run: jest.fn<() => any>(),
        }),
      }),
    }),
    select: jest.fn<() => any>().mockReturnValue({
      from: jest.fn<() => any>().mockReturnValue({
        all: jest.fn<() => any>().mockReturnValue([]),
      }),
    }),
  } as any;
}

describe('ServerRuntimeService', () => {
  let service: ServerRuntimeService;
  let mockServerService: ReturnType<typeof createMockServerService>;
  let mockHealthService: ReturnType<typeof createMockHealthService>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockServerService = createMockServerService();
    mockHealthService = createMockHealthService();
    mockDb = createMockDb();
    service = new ServerRuntimeService(
      mockServerService,
      mockHealthService,
      null,
      mockDb,
      { healthCheckIntervalMs: 60_000 },
    );
    jest.useFakeTimers();
  });

  afterEach(() => {
    service.stopHealthMonitoring();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(service).toBeDefined();
      expect(service.getPortManager()).toBeDefined();
    });
  });

  describe('getProcessInfo', () => {
    it('should return null for unknown server', () => {
      expect(service.getProcessInfo('nonexistent')).toBeNull();
    });
  });

  describe('listRunningProcesses', () => {
    it('should return empty array when no processes running', () => {
      expect(service.listRunningProcesses()).toEqual([]);
    });
  });

  describe('getLogs', () => {
    it('should return empty array when no logs', async () => {
      const logs = await service.getLogs('test-server');
      expect(logs).toEqual([]);
    });
  });

  describe('getPortManager', () => {
    it('should return the port manager instance', () => {
      const pm = service.getPortManager();
      expect(pm.getStats().totalPorts).toBeGreaterThan(0);
    });
  });

  describe('stopServer', () => {
    it('should return false for non-running server', async () => {
      const result = await service.stopServer('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('startHealthMonitoring', () => {
    it('should start without errors', () => {
      service.startHealthMonitoring();
      // Second call should be idempotent
      service.startHealthMonitoring();
      service.stopHealthMonitoring();
    });
  });

  describe('stopHealthMonitoring', () => {
    it('should be safe to call without starting', () => {
      service.stopHealthMonitoring();
    });
  });

  describe('shutdown', () => {
    it('should stop health monitoring and all processes', async () => {
      service.startHealthMonitoring();
      await service.shutdown();
      // Should be idempotent
      await service.shutdown();
    });
  });

  describe('startAll', () => {
    it('should return zero counts when no servers', async () => {
      const result = await service.startAll();
      expect(result).toEqual({ started: 0, failed: 0 });
    });
  });

  describe('events', () => {
    it('should be an EventEmitter', () => {
      expect(service).toBeInstanceOf(EventEmitter);
      const handler = jest.fn();
      service.on('test', handler);
      service.emit('test', { data: 'test' });
      expect(handler).toHaveBeenCalledWith({ data: 'test' });
    });
  });
});
