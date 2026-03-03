import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MarketplaceService, MARKETPLACE_CATEGORIES } from '../services/marketplace-service.js';

function createMockDb() {
  const data: Record<string, unknown[]> = {
    marketplace_listings: [],
    marketplace_reviews: [],
    marketplace_installs: [],
    mcp_servers: [],
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
    run: jest.fn<() => any>(),
  } as any;
}

describe('MarketplaceService', () => {
  let service: MarketplaceService;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    service = new MarketplaceService(mockDb);
  });

  describe('constructor', () => {
    it('should initialize with database', () => {
      expect(service).toBeDefined();
    });
  });

  describe('MARKETPLACE_CATEGORIES', () => {
    it('should have 8 categories', () => {
      expect(MARKETPLACE_CATEGORIES).toHaveLength(8);
    });

    it('should include expected categories', () => {
      expect(MARKETPLACE_CATEGORIES).toContain('data-knowledge');
      expect(MARKETPLACE_CATEGORIES).toContain('web-search');
      expect(MARKETPLACE_CATEGORIES).toContain('code-dev-tools');
      expect(MARKETPLACE_CATEGORIES).toContain('ai-ml');
    });
  });

  describe('listListings', () => {
    it('should return empty array when no listings', async () => {
      const result = await service.listListings();
      expect(result).toEqual([]);
    });
  });

  describe('getListing', () => {
    it('should return null for nonexistent listing', async () => {
      const result = await service.getListing('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getListingBySlug', () => {
    it('should return null for nonexistent slug', async () => {
      const result = await service.getListingBySlug('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('createListing', () => {
    it('should create a listing with required fields', async () => {
      const result = await service.createListing({
        name: 'Test Server',
        slug: 'test-server',
        category: 'code-dev-tools',
        transport: 'stdio',
        publisherId: 'user-1',
      });

      expect(result.name).toBe('Test Server');
      expect(result.slug).toBe('test-server');
      expect(result.category).toBe('code-dev-tools');
      expect(result.transport).toBe('stdio');
      expect(result.publisherId).toBe('user-1');
      expect(result.status).toBe('pending');
      expect(result.installCount).toBe(0);
      expect(result.avgRating).toBe(0);
      expect(result.id).toBeDefined();
    });

    it('should create a listing with optional fields', async () => {
      const result = await service.createListing({
        name: 'Full Server',
        slug: 'full-server',
        shortDescription: 'A full featured server',
        description: 'Detailed description here',
        category: 'ai-ml',
        tags: ['ai', 'ml', 'inference'],
        transport: 'stdio',
        config: { command: 'npx', args: ['-y', 'some-package'] },
        version: '2.0.0',
        requirements: { envVars: [{ key: 'API_KEY', description: 'API key', required: true }] },
        compatibility: ['Claude Desktop', 'Cursor'],
        publisherId: 'user-1',
      });

      expect(result.shortDescription).toBe('A full featured server');
      expect(result.tags).toEqual(['ai', 'ml', 'inference']);
      expect(result.version).toBe('2.0.0');
      expect(result.compatibility).toEqual(['Claude Desktop', 'Cursor']);
    });
  });

  describe('getReviews', () => {
    it('should return empty array when no reviews', async () => {
      const result = await service.getReviews('listing-1');
      expect(result).toEqual([]);
    });
  });

  describe('getUserInstalls', () => {
    it('should return empty array when no installs', async () => {
      const result = await service.getUserInstalls('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('getCategories', () => {
    it('should return all categories with zero counts', async () => {
      const result = await service.getCategories();
      expect(result).toHaveLength(8);
      result.forEach(cat => {
        expect(cat.count).toBe(0);
        expect(cat.id).toBeDefined();
        expect(cat.name).toBeDefined();
      });
    });
  });

  describe('getTrending', () => {
    it('should return empty array when no listings', async () => {
      const result = await service.getTrending();
      expect(result).toEqual([]);
    });
  });

  describe('getFeatured', () => {
    it('should return empty array when no featured listings', async () => {
      const result = await service.getFeatured();
      expect(result).toEqual([]);
    });
  });

  describe('getListingCount', () => {
    it('should return 0 when no listings', async () => {
      const count = await service.getListingCount();
      expect(count).toBe(0);
    });
  });

  describe('deleteListing', () => {
    it('should return false for nonexistent listing', async () => {
      const result = await service.deleteListing('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('uninstallListing', () => {
    it('should return false for nonexistent install', async () => {
      const result = await service.uninstallListing('nonexistent');
      expect(result).toBe(false);
    });
  });
});
