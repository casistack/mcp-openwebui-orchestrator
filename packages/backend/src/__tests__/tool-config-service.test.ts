import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { ToolConfigService } = await import('../services/tool-config-service.js');

describe('ToolConfigService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof ToolConfigService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new ToolConfigService(db as never);
  });

  describe('setToolConfig (create)', () => {
    it('should create new tool config', async () => {
      const result = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'search',
      });

      expect(result.id).toBeDefined();
      expect(result.namespaceId).toBe('ns-1');
      expect(result.serverId).toBe('srv-1');
      expect(result.toolName).toBe('search');
      expect(result.enabled).toBe(true);
      expect(result.displayName).toBeNull();
      expect(result.description).toBeNull();
      expect(result.annotations).toBeNull();
    });

    it('should create with all optional fields', async () => {
      const result = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'scrape',
        enabled: false,
        displayName: 'Web Scraper',
        description: 'Scrapes web pages',
        annotations: { category: 'web', dangerous: true },
      });

      expect(result.enabled).toBe(false);
      expect(result.displayName).toBe('Web Scraper');
      expect(result.description).toBe('Scrapes web pages');
      expect(result.annotations).toEqual({ category: 'web', dangerous: true });
    });
  });

  describe('setToolConfig (upsert)', () => {
    it('should update existing config', async () => {
      // Create initial
      const created = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'search',
        enabled: true,
      });

      // Upsert with same namespace/server/tool
      const updated = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'search',
        enabled: false,
        displayName: 'Renamed Search',
      });

      expect(db.update).toHaveBeenCalled();
      expect(updated.enabled).toBe(false);
      expect(updated.displayName).toBe('Renamed Search');
    });
  });

  describe('getToolConfigs', () => {
    it('should filter by namespaceId', async () => {
      await service.setToolConfig({ namespaceId: 'ns-1', serverId: 'srv-1', toolName: 'a' });
      await service.setToolConfig({ namespaceId: 'ns-1', serverId: 'srv-2', toolName: 'b' });
      await service.setToolConfig({ namespaceId: 'ns-2', serverId: 'srv-1', toolName: 'c' });

      const result = await service.getToolConfigs('ns-1');
      expect(result).toHaveLength(2);
    });

    it('should filter by namespaceId and serverId', async () => {
      await service.setToolConfig({ namespaceId: 'ns-1', serverId: 'srv-1', toolName: 'a' });
      await service.setToolConfig({ namespaceId: 'ns-1', serverId: 'srv-2', toolName: 'b' });

      const result = await service.getToolConfigs('ns-1', 'srv-1');
      expect(result).toHaveLength(1);
      expect((result[0] as { toolName: string }).toolName).toBe('a');
    });

    it('should return empty for no matches', async () => {
      const result = await service.getToolConfigs('empty');
      expect(result).toEqual([]);
    });
  });

  describe('getToolConfig', () => {
    it('should find by ID', async () => {
      const created = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'find-me',
      });

      const found = await service.getToolConfig(created.id);
      expect(found).not.toBeNull();
      expect(found!.toolName).toBe('find-me');
    });

    it('should return null for missing ID', async () => {
      expect(await service.getToolConfig('missing')).toBeNull();
    });
  });

  describe('deleteToolConfig', () => {
    it('should return false for non-existent', async () => {
      expect(await service.deleteToolConfig('missing')).toBe(false);
    });

    it('should delete existing config', async () => {
      const created = await service.setToolConfig({
        namespaceId: 'ns-1',
        serverId: 'srv-1',
        toolName: 'delete-me',
      });

      expect(await service.deleteToolConfig(created.id)).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('bulkSetToolConfigs', () => {
    it('should process multiple configs', async () => {
      const results = await service.bulkSetToolConfigs([
        { namespaceId: 'ns-1', serverId: 'srv-1', toolName: 'tool-a', enabled: true },
        { namespaceId: 'ns-1', serverId: 'srv-1', toolName: 'tool-b', enabled: false },
        { namespaceId: 'ns-1', serverId: 'srv-2', toolName: 'tool-c' },
      ]);

      expect(results).toHaveLength(3);
      const rows = db._getTable('tool_configs');
      expect(rows).toHaveLength(3);
    });

    it('should return empty array for empty input', async () => {
      const results = await service.bulkSetToolConfigs([]);
      expect(results).toEqual([]);
    });
  });
});
