import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MarketplaceService, MARKETPLACE_CATEGORIES } from '../services/marketplace-service.js';

function createMockDb() {
  const data: Record<string, unknown[]> = {
    marketplace_listings: [],
    marketplace_reviews: [],
    marketplace_installs: [],
    marketplace_collections: [],
    marketplace_collection_items: [],
    marketplace_review_responses: [],
    marketplace_listing_pricing: [],
    marketplace_licenses: [],
    org_marketplace_access: [],
    org_marketplace_members: [],
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
    update: jest.fn<() => any>().mockImplementation((table: any) => ({
      set: jest.fn<() => any>().mockImplementation(() => ({
        where: jest.fn<() => any>().mockImplementation(() => Promise.resolve()),
      })),
    })),
    delete: jest.fn<() => any>().mockImplementation((table: any) => ({
      where: jest.fn<() => any>().mockImplementation(() => Promise.resolve()),
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

  describe('listCollections', () => {
    it('should return empty array when no collections', async () => {
      const result = await service.listCollections();
      expect(result).toEqual([]);
    });
  });

  describe('createCollection', () => {
    it('should create a collection with required fields', async () => {
      const result = await service.createCollection('user-1', 'Best AI Tools', 'best-ai-tools');

      expect(result.name).toBe('Best AI Tools');
      expect(result.slug).toBe('best-ai-tools');
      expect(result.curatorId).toBe('user-1');
      expect(result.id).toBeDefined();
    });

    it('should create a collection with optional description', async () => {
      const result = await service.createCollection('user-1', 'AI Collection', 'ai-collection', 'Top AI servers');

      expect(result.description).toBe('Top AI servers');
    });
  });

  describe('getCollectionItems', () => {
    it('should return empty array when no items', async () => {
      const result = await service.getCollectionItems('col-1');
      expect(result).toEqual([]);
    });
  });

  describe('getReviewResponses', () => {
    it('should return empty array when no responses', async () => {
      const result = await service.getReviewResponses('review-1');
      expect(result).toEqual([]);
    });
  });

  describe('getPublisherAnalytics', () => {
    it('should return zero totals when no listings', async () => {
      const result = await service.getPublisherAnalytics('user-1');

      expect(result.totalListings).toBe(0);
      expect(result.totalInstalls).toBe(0);
      expect(result.avgRating).toBe(0);
      expect(result.totalReviews).toBe(0);
      expect(result.listings).toEqual([]);
    });
  });

  // --- Premium Pricing ---

  describe('getListingPricing', () => {
    it('should return null when no pricing exists', async () => {
      const result = await service.getListingPricing('listing-1');
      expect(result).toBeNull();
    });
  });

  describe('setListingPricing', () => {
    it('should create pricing for a listing', async () => {
      const result = await service.setListingPricing('listing-1', {
        tier: 'premium',
        price: 9.99,
        currency: 'USD',
        billingModel: 'subscription',
        billingInterval: 'monthly',
      });

      expect(result.listingId).toBe('listing-1');
      expect(result.tier).toBe('premium');
      expect(result.price).toBe(9.99);
      expect(result.currency).toBe('USD');
      expect(result.billingModel).toBe('subscription');
      expect(result.billingInterval).toBe('monthly');
      expect(result.id).toBeDefined();
    });

    it('should use defaults for optional pricing fields', async () => {
      const result = await service.setListingPricing('listing-2', { tier: 'free' });

      expect(result.price).toBe(0);
      expect(result.currency).toBe('USD');
      expect(result.billingModel).toBe('one-time');
      expect(result.trialDays).toBe(0);
    });
  });

  // --- Licensing ---

  describe('issueLicense', () => {
    it('should create a license with key prefix', async () => {
      const result = await service.issueLicense('listing-1', 'user-1', 'premium', 10);

      expect(result.listingId).toBe('listing-1');
      expect(result.userId).toBe('user-1');
      expect(result.tier).toBe('premium');
      expect(result.seatsUsed).toBe(0);
      expect(result.seatsTotal).toBe(10);
      expect(result.status).toBe('active');
      expect(result.licenseKey).toMatch(/^mcp-premium-/);
      expect(result.id).toBeDefined();
    });

    it('should allow unlimited seats when seatsTotal is omitted', async () => {
      const result = await service.issueLicense('listing-1', 'user-1', 'enterprise');
      expect(result.seatsTotal).toBeNull();
    });
  });

  describe('getUserLicenses', () => {
    it('should return empty array when no licenses', async () => {
      const result = await service.getUserLicenses('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('getLicense', () => {
    it('should return null for nonexistent license', async () => {
      const result = await service.getLicense('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getLicenseByKey', () => {
    it('should return null for nonexistent key', async () => {
      const result = await service.getLicenseByKey('nonexistent-key');
      expect(result).toBeNull();
    });
  });

  describe('validateLicense', () => {
    it('should return invalid for nonexistent key', async () => {
      const result = await service.validateLicense('no-such-key');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('License not found');
    });
  });

  describe('revokeLicense', () => {
    it('should return false for nonexistent license', async () => {
      const result = await service.revokeLicense('nonexistent');
      expect(result).toBe(false);
    });
  });

  // --- Private Marketplace (Org) ---

  describe('getOrgListings', () => {
    it('should return empty array when no org listings', async () => {
      const result = await service.getOrgListings('org-1');
      expect(result).toEqual([]);
    });
  });

  describe('addOrgListing', () => {
    it('should add a listing to an org', async () => {
      const result = await service.addOrgListing('org-1', 'listing-1');

      expect(result.orgOwnerId).toBe('org-1');
      expect(result.listingId).toBe('listing-1');
      expect(result.accessLevel).toBe('install');
      expect(result.approvedAt).toBeNull();
      expect(result.id).toBeDefined();
    });

    it('should use custom access level', async () => {
      const result = await service.addOrgListing('org-2', 'listing-2', 'admin');
      expect(result.accessLevel).toBe('admin');
    });
  });

  describe('removeOrgListing', () => {
    it('should return true', async () => {
      const result = await service.removeOrgListing('org-1', 'listing-1');
      expect(result).toBe(true);
    });
  });

  describe('approveOrgListing', () => {
    it('should return true', async () => {
      const result = await service.approveOrgListing('org-1', 'listing-1', 'admin-1');
      expect(result).toBe(true);
    });
  });

  describe('getOrgMembers', () => {
    it('should return empty array when no members', async () => {
      const result = await service.getOrgMembers('org-1');
      expect(result).toEqual([]);
    });
  });

  describe('addOrgMember', () => {
    it('should add a member with default role', async () => {
      const result = await service.addOrgMember('org-1', 'user-1');

      expect(result.orgOwnerId).toBe('org-1');
      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('member');
      expect(result.id).toBeDefined();
    });

    it('should add a member with custom role', async () => {
      const result = await service.addOrgMember('org-2', 'user-2', 'admin');
      expect(result.role).toBe('admin');
    });
  });

  describe('removeOrgMember', () => {
    it('should return true', async () => {
      const result = await service.removeOrgMember('org-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  describe('isOrgMember', () => {
    it('should return true when userId equals orgOwnerId', async () => {
      const result = await service.isOrgMember('user-1', 'user-1');
      expect(result).toBe(true);
    });

    it('should return false when user is not a member', async () => {
      const result = await service.isOrgMember('org-1', 'stranger');
      expect(result).toBe(false);
    });
  });
});
