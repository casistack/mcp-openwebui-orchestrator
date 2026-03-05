import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { ApiKeyService } = await import('../services/api-key-service.js');

describe('ApiKeyService', () => {
  let db: MockDatabase;
  let service: InstanceType<typeof ApiKeyService>;

  beforeEach(() => {
    db = createMockDatabase();
    service = new ApiKeyService(db as never);
  });

  describe('createApiKey', () => {
    it('should create an API key with mcp_ prefix', async () => {
      const result = await service.createApiKey({
        userId: 'user-1',
        name: 'Test Key',
      });

      expect(result.rawKey).toBeDefined();
      expect(result.rawKey.startsWith('mcp_')).toBe(true);
      expect(result.rawKey.length).toBe(4 + 64); // mcp_ + 32 bytes hex
      expect(result.keyPrefix).toBe(result.rawKey.slice(0, 12));
      expect(result.keyHash).toBeDefined();
      expect(result.keyHash).not.toBe(result.rawKey); // hash != raw
      expect(result.userId).toBe('user-1');
      expect(result.name).toBe('Test Key');
      expect(result.scope).toBe('user');
      expect(result.rateLimit).toBe(100);
      expect(result.isActive).toBe(true);
    });

    it('should generate unique keys each time', async () => {
      const key1 = await service.createApiKey({ userId: 'u1', name: 'Key 1' });
      const key2 = await service.createApiKey({ userId: 'u1', name: 'Key 2' });

      expect(key1.rawKey).not.toBe(key2.rawKey);
      expect(key1.keyHash).not.toBe(key2.keyHash);
      expect(key1.id).not.toBe(key2.id);
    });

    it('should accept scoped keys', async () => {
      const result = await service.createApiKey({
        userId: 'user-1',
        name: 'Scoped Key',
        scope: 'namespace',
        namespaceId: 'ns-1',
        rateLimit: 50,
      });

      expect(result.scope).toBe('namespace');
      expect(result.namespaceId).toBe('ns-1');
      expect(result.rateLimit).toBe(50);
    });

    it('should accept expiry date', async () => {
      const expires = new Date('2030-01-01');
      const result = await service.createApiKey({
        userId: 'user-1',
        name: 'Expiring Key',
        expiresAt: expires,
      });

      expect(result.expiresAt).toEqual(expires);
    });
  });

  describe('validateApiKey', () => {
    it('should validate a valid key', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Valid' });

      const result = await service.validateApiKey(created.rawKey);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.userId).toBe('user-1');
    });

    it('should return null for invalid key', async () => {
      const result = await service.validateApiKey('mcp_invalid_key_that_does_not_exist');
      expect(result).toBeNull();
    });

    it('should return null for inactive key', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Inactive' });

      // Manually deactivate the key in the mock DB
      const rows = db._getTable('api_keys') as Array<{ keyHash: string; isActive: boolean }>;
      const row = rows.find(r => r.keyHash === created.keyHash);
      if (row) row.isActive = false;

      const result = await service.validateApiKey(created.rawKey);
      expect(result).toBeNull();
    });

    it('should return null for expired key', async () => {
      const pastDate = new Date('2020-01-01');
      const created = await service.createApiKey({
        userId: 'user-1',
        name: 'Expired',
        expiresAt: pastDate,
      });

      const result = await service.validateApiKey(created.rawKey);
      expect(result).toBeNull();
    });

    it('should update lastUsedAt on validation', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Track Usage' });

      await service.validateApiKey(created.rawKey);
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('listApiKeys', () => {
    it('should list keys for a specific user without keyHash', async () => {
      await service.createApiKey({ userId: 'user-1', name: 'Key A' });
      await service.createApiKey({ userId: 'user-1', name: 'Key B' });
      await service.createApiKey({ userId: 'user-2', name: 'Key C' });

      const result = await service.listApiKeys('user-1');
      expect(result).toHaveLength(2);
      // Verify keyHash is NOT exposed
      result.forEach((k: Record<string, unknown>) => {
        expect(k).not.toHaveProperty('keyHash');
        expect(k).toHaveProperty('keyPrefix');
        expect(k).toHaveProperty('name');
      });
    });

    it('should return empty array for user with no keys', async () => {
      const result = await service.listApiKeys('no-keys');
      expect(result).toEqual([]);
    });
  });

  describe('revokeApiKey', () => {
    it('should revoke a key owned by the user', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Revoke Me' });

      const result = await service.revokeApiKey(created.id, 'user-1');
      expect(result).toBe(true);
      expect(db.update).toHaveBeenCalled();
    });

    it('should not revoke a key owned by different user', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Not Mine' });

      const result = await service.revokeApiKey(created.id, 'user-2');
      expect(result).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const result = await service.revokeApiKey('nonexistent', 'user-1');
      expect(result).toBe(false);
    });
  });

  describe('deleteApiKey', () => {
    it('should delete a key owned by the user', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Delete Me' });

      const result = await service.deleteApiKey(created.id, 'user-1');
      expect(result).toBe(true);
      expect(db.delete).toHaveBeenCalled();
    });

    it('should not delete a key owned by different user', async () => {
      const created = await service.createApiKey({ userId: 'user-1', name: 'Not Yours' });

      const result = await service.deleteApiKey(created.id, 'user-2');
      expect(result).toBe(false);
    });
  });
});
