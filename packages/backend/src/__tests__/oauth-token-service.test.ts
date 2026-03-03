import { jest } from '@jest/globals';
import { createMockDatabase, mockTables, type MockDatabase } from './mock-db.js';

jest.unstable_mockModule('@mcp-platform/db', () => ({
  ...mockTables,
  createDatabase: jest.fn(),
}));

const { OAuthTokenService } = await import('../services/oauth-token-service.js');

describe('OAuthTokenService', () => {
  let service: InstanceType<typeof OAuthTokenService>;
  let mockDb: MockDatabase;

  beforeEach(() => {
    mockDb = createMockDatabase();
    service = new OAuthTokenService(mockDb as any);
  });

  describe('getTokensForUser', () => {
    it('should return empty array when no tokens', async () => {
      const result = await service.getTokensForUser('user-1');
      expect(result).toEqual([]);
    });

    it('should return tokens for user', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getTokensForUser('user-1');
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe('google');
    });

    it('should filter by endpointId when provided', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-2', userId: 'user-1', endpointId: 'ep-2', provider: 'github',
        accessToken: 'def', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getTokensForUser('user-1', 'ep-1');
      expect(result).toHaveLength(1);
      expect(result[0].endpointId).toBe('ep-1');
    });
  });

  describe('getToken', () => {
    it('should return null when not found', async () => {
      const result = await service.getToken('user-1', 'ep-1', 'google');
      expect(result).toBeNull();
    });

    it('should return matching token', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: 'ref-1', expiresAt: null, scopes: 'read',
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getToken('user-1', 'ep-1', 'google');
      expect(result).not.toBeNull();
      expect(result!.accessToken).toBe('abc');
    });
  });

  describe('getActiveToken', () => {
    it('should return null for revoked tokens', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'revoked', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getActiveToken('user-1', 'ep-1', 'google');
      expect(result).toBeNull();
    });

    it('should return active token', async () => {
      const future = new Date(Date.now() + 3600000);
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: future, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getActiveToken('user-1', 'ep-1', 'google');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
    });

    it('should mark expired token as expired', async () => {
      const past = new Date(Date.now() - 3600000);
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: 'ref-1', expiresAt: past, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getActiveToken('user-1', 'ep-1', 'google');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('expired');
    });
  });

  describe('setToken', () => {
    it('should create a new token', async () => {
      const result = await service.setToken({
        userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'new-token', refreshToken: 'ref-token',
        scopes: 'read write',
      });
      expect(result.userId).toBe('user-1');
      expect(result.accessToken).toBe('new-token');
      expect(result.status).toBe('active');
      expect(result.id).toBeDefined();
    });

    it('should upsert existing token', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'old-token', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.setToken({
        userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'new-token',
      });
      expect(result.accessToken).toBe('new-token');
    });
  });

  describe('revokeToken', () => {
    it('should return false for nonexistent token', async () => {
      const result = await service.revokeToken('nonexistent');
      expect(result).toBe(false);
    });

    it('should revoke existing token', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.revokeToken('tok-1');
      expect(result).toBe(true);
    });
  });

  describe('deleteToken', () => {
    it('should return false for nonexistent token', async () => {
      const result = await service.deleteToken('nonexistent');
      expect(result).toBe(false);
    });

    it('should delete existing token', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.deleteToken('tok-1');
      expect(result).toBe(true);
    });
  });

  describe('getTokenCount', () => {
    it('should return 0 when no tokens', async () => {
      const result = await service.getTokenCount();
      expect(result).toBe(0);
    });

    it('should return count for specific user', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-2', userId: 'user-2', endpointId: 'ep-1', provider: 'google',
        accessToken: 'def', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      expect(await service.getTokenCount('user-1')).toBe(1);
      expect(await service.getTokenCount()).toBe(2);
    });
  });

  describe('getExpiredTokens', () => {
    it('should return only expired active tokens', async () => {
      const past = new Date(Date.now() - 3600000);
      const future = new Date(Date.now() + 3600000);
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: past, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-2', userId: 'user-1', endpointId: 'ep-2', provider: 'google',
        accessToken: 'def', refreshToken: null, expiresAt: future, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await service.getExpiredTokens();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tok-1');
    });
  });

  describe('revokeAllForEndpoint', () => {
    it('should revoke all tokens for user+endpoint', async () => {
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-1', userId: 'user-1', endpointId: 'ep-1', provider: 'google',
        accessToken: 'abc', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      mockDb._addRow('user_endpoint_tokens', {
        id: 'tok-2', userId: 'user-1', endpointId: 'ep-1', provider: 'github',
        accessToken: 'def', refreshToken: null, expiresAt: null, scopes: null,
        tokenType: 'bearer', status: 'active', lastUsedAt: null, lastRefreshedAt: null,
        metadata: null, createdAt: new Date(), updatedAt: new Date(),
      });
      const count = await service.revokeAllForEndpoint('user-1', 'ep-1');
      expect(count).toBe(2);
    });
  });
});
