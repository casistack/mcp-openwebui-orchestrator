import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ConfigSourcesService } from '../services/config-sources-service.js';

function createMockDb() {
  const data: Record<string, unknown[]> = {
    config_sources: [],
    source_servers: [],
    mcp_servers: [],
    config_dismissed_servers: [],
  };

  return {
    _data: data,
    insert: jest.fn<() => any>().mockImplementation((table: any) => ({
      values: jest.fn<() => any>().mockImplementation((row: any) => {
        const tableName = table?.[Symbol.for('drizzle:Name')] ?? 'unknown';
        if (data[tableName]) data[tableName].push(row);
        return { run: jest.fn<() => any>() };
      }),
    })),
    select: jest.fn<() => any>().mockImplementation(() => ({
      from: jest.fn<() => any>().mockImplementation((table: any) => {
        const tableName = table?.[Symbol.for('drizzle:Name')] ?? 'unknown';
        return Promise.resolve(data[tableName] ?? []);
      }),
    })),
    update: jest.fn<() => any>().mockImplementation((table: any) => ({
      set: jest.fn<() => any>().mockImplementation(() => ({
        where: jest.fn<() => any>().mockImplementation(() => Promise.resolve()),
      })),
    })),
    delete: jest.fn<() => any>().mockImplementation((table: any) => ({
      where: jest.fn<() => any>().mockImplementation(() => {
        const tableName = table?.[Symbol.for('drizzle:Name')] ?? 'unknown';
        data[tableName] = [];
        return Promise.resolve();
      }),
    })),
    run: jest.fn<() => any>(),
  } as any;
}

function createMockServerService() {
  let serverCount = 0;
  const servers: any[] = [];

  return {
    createServer: jest.fn<() => any>().mockImplementation(async (input: any) => {
      const id = input.name?.toLowerCase().replace(/[^a-z0-9-_]/g, '-') ?? `server-${serverCount++}`;
      const server = { id, ...input, createdAt: new Date(), updatedAt: new Date() };
      servers.push(server);
      return server;
    }),
    deleteServer: jest.fn<() => any>().mockImplementation(async (id: string) => {
      const idx = servers.findIndex(s => s.id === id);
      if (idx >= 0) servers.splice(idx, 1);
      return true;
    }),
    listServers: jest.fn<() => any>().mockImplementation(async () => [...servers]),
    getServer: jest.fn<() => any>().mockImplementation(async (id: string) => servers.find(s => s.id === id) ?? null),
    getServerCount: jest.fn<() => any>().mockImplementation(async () => servers.length),
    _servers: servers,
  } as any;
}

describe('ConfigSourcesService', () => {
  let service: ConfigSourcesService;
  let mockDb: ReturnType<typeof createMockDb>;
  let mockServerService: ReturnType<typeof createMockServerService>;

  beforeEach(() => {
    mockDb = createMockDb();
    mockServerService = createMockServerService();
    service = new ConfigSourcesService(mockDb, mockServerService);
  });

  describe('constructor', () => {
    it('should initialize with db and server service', () => {
      expect(service).toBeDefined();
    });
  });

  describe('createSource', () => {
    it('should create a file source', async () => {
      const result = await service.createSource({
        name: 'Test Config',
        type: 'file',
        location: '/config/test.json',
      });
      expect(result.name).toBe('Test Config');
      expect(result.type).toBe('file');
      expect(result.location).toBe('/config/test.json');
      expect(result.enabled).toBe(true);
      expect(result.id).toBeDefined();
    });

    it('should create a url source', async () => {
      const result = await service.createSource({
        name: 'Remote Config',
        type: 'url',
        location: 'https://example.com/config.json',
        autoSync: true,
        syncIntervalMinutes: 30,
      });
      expect(result.type).toBe('url');
      expect(result.autoSync).toBe(true);
      expect(result.syncIntervalMinutes).toBe(30);
    });

    it('should throw if file source has no location', async () => {
      await expect(
        service.createSource({ name: 'Bad', type: 'file', location: '' }),
      ).rejects.toThrow();
    });

    it('should throw if url source has no location', async () => {
      await expect(
        service.createSource({ name: 'Bad', type: 'url', location: '' }),
      ).rejects.toThrow();
    });

    it('should set default priority to 0', async () => {
      const result = await service.createSource({
        name: 'Default Priority',
        type: 'file',
        location: '/config/test.json',
      });
      expect(result.priority).toBe(0);
    });

    it('should accept custom priority', async () => {
      const result = await service.createSource({
        name: 'High Priority',
        type: 'file',
        location: '/config/test.json',
        priority: 10,
      });
      expect(result.priority).toBe(10);
    });
  });

  describe('listSources', () => {
    it('should return empty array when no sources exist', async () => {
      const result = await service.listSources();
      expect(result).toEqual([]);
    });

    it('should return sources sorted by priority descending', async () => {
      await service.createSource({ name: 'Low', type: 'file', location: '/a.json', priority: 1 });
      await service.createSource({ name: 'High', type: 'file', location: '/b.json', priority: 10 });
      await service.createSource({ name: 'Mid', type: 'file', location: '/c.json', priority: 5 });

      const result = await service.listSources();
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('High');
      expect(result[1].name).toBe('Mid');
      expect(result[2].name).toBe('Low');
    });
  });

  describe('getSource', () => {
    it('should return null for nonexistent source', async () => {
      const result = await service.getSource('nonexistent');
      expect(result).toBeNull();
    });

    it('should return source with servers array', async () => {
      const source = await service.createSource({ name: 'Test', type: 'file', location: '/a.json' });
      const result = await service.getSource(source.id);
      expect(result).toBeDefined();
      expect(result!.name).toBe('Test');
      expect(result!.servers).toEqual([]);
    });
  });

  describe('deleteSource', () => {
    it('should return false for nonexistent source', async () => {
      const result = await service.deleteSource('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete an existing source', async () => {
      const source = await service.createSource({ name: 'Deletable', type: 'file', location: '/a.json' });
      const result = await service.deleteSource(source.id);
      expect(result).toBe(true);
    });
  });

  describe('toggleServer', () => {
    it('should throw for nonexistent source server', async () => {
      await expect(service.toggleServer('nonexistent', true)).rejects.toThrow('Source server not found');
    });
  });

  describe('toggleSource', () => {
    it('should update enabled status via Drizzle update', async () => {
      const source = await service.createSource({ name: 'Toggle', type: 'file', location: '/a.json' });
      await service.toggleSource(source.id, false);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('reorderSources', () => {
    it('should update priorities for given ids', async () => {
      const s1 = await service.createSource({ name: 'A', type: 'file', location: '/a.json' });
      const s2 = await service.createSource({ name: 'B', type: 'file', location: '/b.json' });

      const result = await service.reorderSources([s2.id, s1.id]);
      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('migrateFromLegacy', () => {
    it('should return already migrated if sources exist', async () => {
      await service.createSource({ name: 'Existing', type: 'file', location: '/a.json' });
      const result = await service.migrateFromLegacy();
      expect(result).toEqual({ migrated: false, reason: 'already migrated' });
    });

    it('should create default source when no sources exist', async () => {
      const result = await service.migrateFromLegacy();
      expect(result.migrated).toBe(true);
      expect(result.sourceId).toBeDefined();
    });
  });

  describe('syncAll', () => {
    it('should return empty results when no sources', async () => {
      const results = await service.syncAll();
      expect(results).toEqual([]);
    });
  });

  describe('activateServer', () => {
    it('should throw for nonexistent source server', async () => {
      await expect(service.activateServer('nonexistent')).rejects.toThrow('Source server not found');
    });
  });

  describe('deactivateServer', () => {
    it('should throw for nonexistent source server', async () => {
      await expect(service.deactivateServer('nonexistent')).rejects.toThrow('Source server not found');
    });
  });

  describe('startAutoSync / stopAutoSync', () => {
    it('should start and stop without error', () => {
      service.startAutoSync();
      service.stopAutoSync();
    });

    it('should be idempotent for start', () => {
      service.startAutoSync();
      service.startAutoSync(); // should not create duplicate timers
      service.stopAutoSync();
    });
  });
});
