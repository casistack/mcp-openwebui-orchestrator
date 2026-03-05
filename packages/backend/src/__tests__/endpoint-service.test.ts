import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { EndpointService } = await import('../services/endpoint-service.js');

describe('EndpointService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof EndpointService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new EndpointService(db as never);
  });

  describe('createEndpoint', () => {
    it('should create endpoint with correct defaults', async () => {
      const result = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'My Endpoint',
        transport: 'sse',
      });

      expect(result.id).toBeDefined();
      expect(result.namespaceId).toBe('ns-1');
      expect(result.name).toBe('My Endpoint');
      expect(result.slug).toBe('my-endpoint');
      expect(result.transport).toBe('sse');
      expect(result.isActive).toBe(true);
      expect(result.authType).toBe('api_key');
      expect(result.rateLimit).toBe(100);
      expect(result.oauthConfig).toBeNull();
    });

    it('should accept custom auth type and rate limit', async () => {
      const result = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'OAuth EP',
        transport: 'streamable-http',
        authType: 'oauth',
        oauthConfig: { clientId: 'abc', issuer: 'https://auth.example.com' },
        rateLimit: 50,
      });

      expect(result.authType).toBe('oauth');
      expect(result.rateLimit).toBe(50);
      expect(result.oauthConfig).toEqual({ clientId: 'abc', issuer: 'https://auth.example.com' });
    });

    it('should store endpoint in database', async () => {
      await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Stored',
        transport: 'openapi',
      });

      const rows = db._getTable('endpoints');
      expect(rows).toHaveLength(1);
    });
  });

  describe('listEndpoints', () => {
    it('should return all endpoints', async () => {
      await service.createEndpoint({ namespaceId: 'ns-1', name: 'EP1', transport: 'sse' });
      await service.createEndpoint({ namespaceId: 'ns-2', name: 'EP2', transport: 'openapi' });

      const result = await service.listEndpoints();
      expect(result).toHaveLength(2);
    });
  });

  describe('getEndpoint', () => {
    it('should find by ID', async () => {
      const created = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Get Me',
        transport: 'sse',
      });

      const found = await service.getEndpoint(created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Get Me');
    });

    it('should return null for missing', async () => {
      expect(await service.getEndpoint('nope')).toBeNull();
    });
  });

  describe('listByNamespace', () => {
    it('should filter endpoints by namespaceId', async () => {
      await service.createEndpoint({ namespaceId: 'ns-1', name: 'A', transport: 'sse' });
      await service.createEndpoint({ namespaceId: 'ns-1', name: 'B', transport: 'sse' });
      await service.createEndpoint({ namespaceId: 'ns-2', name: 'C', transport: 'sse' });

      const result = await service.listByNamespace('ns-1');
      expect(result).toHaveLength(2);
      expect(result.every((e: { namespaceId: string }) => e.namespaceId === 'ns-1')).toBe(true);
    });
  });

  describe('updateEndpoint', () => {
    it('should return null for non-existent endpoint', async () => {
      expect(await service.updateEndpoint('missing', { name: 'X' })).toBeNull();
    });

    it('should update name and regenerate slug', async () => {
      const created = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Original',
        transport: 'sse',
      });

      const result = await service.updateEndpoint(created.id, { name: 'Renamed' });
      expect(result!.name).toBe('Renamed');
      expect(result!.slug).toBe('renamed');
    });

    it('should update transport and rate limit', async () => {
      const created = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Update EP',
        transport: 'sse',
      });

      const result = await service.updateEndpoint(created.id, {
        transport: 'streamable-http',
        rateLimit: 200,
      });

      expect(result!.transport).toBe('streamable-http');
      expect(result!.rateLimit).toBe(200);
    });

    it('should deactivate endpoint', async () => {
      const created = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Deactivate',
        transport: 'sse',
      });

      const result = await service.updateEndpoint(created.id, { isActive: false });
      expect(result!.isActive).toBe(false);
    });
  });

  describe('deleteEndpoint', () => {
    it('should return false for non-existent', async () => {
      expect(await service.deleteEndpoint('nope')).toBe(false);
    });

    it('should execute DELETE SQL', async () => {
      const created = await service.createEndpoint({
        namespaceId: 'ns-1',
        name: 'Kill Me',
        transport: 'sse',
      });

      expect(await service.deleteEndpoint(created.id)).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('getEndpointCount', () => {
    it('should count endpoints', async () => {
      expect(await service.getEndpointCount()).toBe(0);
      await service.createEndpoint({ namespaceId: 'ns-1', name: 'A', transport: 'sse' });
      expect(await service.getEndpointCount()).toBe(1);
    });
  });
});
