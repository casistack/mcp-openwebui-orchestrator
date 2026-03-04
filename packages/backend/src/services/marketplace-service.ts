import crypto from 'crypto';
import {
  marketplaceListings, marketplaceReviews, marketplaceInstalls, mcpServers,
  marketplaceCollections, marketplaceCollectionItems, marketplaceReviewResponses,
  marketplaceListingPricing, marketplaceLicenses,
  orgMarketplaceAccess, orgMarketplaceMembers,
} from '@mcp-platform/db';
import type { AppDatabase } from '@mcp-platform/db';

export const MARKETPLACE_CATEGORIES = [
  'data-knowledge',
  'web-search',
  'code-dev-tools',
  'ai-ml',
  'productivity',
  'communication',
  'media',
  'system-infrastructure',
] as const;

export type MarketplaceCategory = typeof MARKETPLACE_CATEGORIES[number];

export interface CreateListingInput {
  name: string;
  slug: string;
  shortDescription?: string;
  description?: string;
  category: string;
  tags?: string[];
  transport: string;
  config?: {
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    proxyType?: string;
    needsProxy?: boolean;
  };
  version?: string;
  requirements?: {
    envVars?: Array<{ key: string; description: string; required: boolean }>;
    dependencies?: string[];
  };
  compatibility?: string[];
  iconUrl?: string;
  screenshots?: string[];
  publisherId: string;
}

export interface UpdateListingInput {
  name?: string;
  shortDescription?: string;
  description?: string;
  category?: string;
  tags?: string[];
  transport?: string;
  config?: Record<string, unknown>;
  version?: string;
  requirements?: Record<string, unknown>;
  compatibility?: string[];
  iconUrl?: string;
  screenshots?: string[];
  isPublic?: boolean;
  isFeatured?: boolean;
  isVerified?: boolean;
  status?: string;
}

export class MarketplaceService {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  // --- Listings ---

  async listListings(opts?: { category?: string; status?: string; publisherId?: string; featured?: boolean; search?: string }) {
    let results = await this.db.select().from(marketplaceListings);

    if (opts?.category) results = results.filter(l => l.category === opts.category);
    if (opts?.status) results = results.filter(l => l.status === opts.status);
    if (opts?.publisherId) results = results.filter(l => l.publisherId === opts.publisherId);
    if (opts?.featured) results = results.filter(l => l.isFeatured);
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.shortDescription?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q) ||
        l.tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    return results;
  }

  async getListing(id: string) {
    const results = await this.db.select().from(marketplaceListings);
    return results.find(l => l.id === id) ?? null;
  }

  async getListingBySlug(slug: string) {
    const results = await this.db.select().from(marketplaceListings);
    return results.find(l => l.slug === slug) ?? null;
  }

  async createListing(input: CreateListingInput) {
    const id = crypto.randomUUID();
    const now = new Date();

    // Verify slug is unique
    const existing = await this.getListingBySlug(input.slug);
    if (existing) {
      throw new Error(`Slug "${input.slug}" is already taken`);
    }

    const listing = {
      id,
      publisherId: input.publisherId,
      name: input.name,
      slug: input.slug,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      category: input.category,
      tags: input.tags ?? null,
      transport: input.transport,
      config: input.config ?? null,
      version: input.version ?? '1.0.0',
      requirements: input.requirements ?? null,
      compatibility: input.compatibility ?? null,
      iconUrl: input.iconUrl ?? null,
      screenshots: input.screenshots ?? null,
      installCount: 0,
      avgRating: 0,
      ratingCount: 0,
      isVerified: false,
      isFeatured: false,
      isPublic: true,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(marketplaceListings).values(listing);
    return listing;
  }

  async updateListing(id: string, input: UpdateListingInput) {
    const existing = await this.getListing(id);
    if (!existing) return null;

    const cleanUpdates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) cleanUpdates[key] = value;
    }

    const sets = Object.keys(cleanUpdates)
      .map(k => `${this.camelToSnake(k)} = ?`)
      .join(', ');
    const values = Object.values(cleanUpdates).map(v =>
      typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v,
    );

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE marketplace_listings SET ${sets} WHERE id = ?`, ...values, id);

    return { ...existing, ...cleanUpdates };
  }

  async deleteListing(id: string) {
    const existing = await this.getListing(id);
    if (!existing) return false;

    try {
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(`DELETE FROM marketplace_listings WHERE id = ?`, id);
    } catch {
      return false;
    }
    return true;
  }

  async getListingCount() {
    const results = await this.db.select().from(marketplaceListings);
    return results.length;
  }

  // --- Reviews ---

  async getReviews(listingId: string) {
    const results = await this.db.select().from(marketplaceReviews);
    return results.filter(r => r.listingId === listingId);
  }

  async submitReview(listingId: string, userId: string, rating: number, title?: string, body?: string) {
    if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

    const listing = await this.getListing(listingId);
    if (!listing) throw new Error('Listing not found');

    // Check for existing review
    const reviews = await this.getReviews(listingId);
    const existingReview = reviews.find(r => r.userId === userId);

    if (existingReview) {
      // Update existing review
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(
          `UPDATE marketplace_reviews SET rating = ?, title = ?, body = ?, updated_at = ? WHERE id = ?`,
          rating, title ?? null, body ?? null, Math.floor(Date.now() / 1000), existingReview.id
        );
    } else {
      const id = crypto.randomUUID();
      await this.db.insert(marketplaceReviews).values({
        id,
        listingId,
        userId,
        rating,
        title: title ?? null,
        body: body ?? null,
      });
    }

    // Recalculate avg rating
    const allReviews = await this.getReviews(listingId);
    const avgRating = allReviews.length > 0
      ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
      : 0;

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE marketplace_listings SET avg_rating = ?, rating_count = ?, updated_at = ? WHERE id = ?`,
        Math.round(avgRating * 10) / 10, allReviews.length, Math.floor(Date.now() / 1000), listingId
      );

    return { rating, avgRating: Math.round(avgRating * 10) / 10, ratingCount: allReviews.length };
  }

  // --- Install ---

  async installListing(listingId: string, userId: string): Promise<{ serverId: string; install: unknown }> {
    const listing = await this.getListing(listingId);
    if (!listing) throw new Error('Listing not found');

    const config = listing.config as CreateListingInput['config'];

    // Create server entry from listing config
    const serverId = `mp-${listing.slug}-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date();

    await this.db.insert(mcpServers).values({
      id: serverId,
      name: `${listing.name} (Marketplace)`,
      displayName: listing.name,
      description: listing.shortDescription ?? listing.description ?? null,
      transport: listing.transport,
      command: config?.command ?? null,
      args: config?.args ?? null,
      cwd: config?.cwd ?? null,
      url: config?.url ?? null,
      headers: config?.headers ?? null,
      proxyType: config?.proxyType ?? 'mcpo',
      needsProxy: config?.needsProxy ?? true,
      status: 'inactive',
      isPublic: false,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    // Record install
    const installId = crypto.randomUUID();
    await this.db.insert(marketplaceInstalls).values({
      id: installId,
      listingId,
      userId,
      serverId,
      version: listing.version,
    });

    // Bump install count
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE marketplace_listings SET install_count = install_count + 1, updated_at = ? WHERE id = ?`,
        Math.floor(Date.now() / 1000), listingId
      );

    return { serverId, install: { id: installId, listingId, serverId, version: listing.version } };
  }

  async uninstallListing(installId: string) {
    const installs = await this.db.select().from(marketplaceInstalls);
    const install = installs.find(i => i.id === installId);
    if (!install) return false;

    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(
        `UPDATE marketplace_installs SET uninstalled_at = ? WHERE id = ?`,
        Math.floor(Date.now() / 1000), installId
      );

    return true;
  }

  async getUserInstalls(userId: string) {
    const installs = await this.db.select().from(marketplaceInstalls);
    return installs.filter(i => i.userId === userId && !i.uninstalledAt);
  }

  // --- Categories ---

  async getCategories() {
    const listings = await this.db.select().from(marketplaceListings);
    const approved = listings.filter(l => l.status === 'approved' && l.isPublic);

    const counts: Record<string, number> = {};
    for (const cat of MARKETPLACE_CATEGORIES) counts[cat] = 0;
    for (const l of approved) {
      if (l.category in counts) counts[l.category]++;
    }

    return MARKETPLACE_CATEGORIES.map(cat => ({
      id: cat,
      name: cat.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' & ').replace('&', '&'),
      count: counts[cat] ?? 0,
    }));
  }

  // --- Trending & Featured ---

  async getTrending(limit = 10) {
    const listings = await this.listListings({ status: 'approved' });
    return listings
      .sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0))
      .slice(0, limit);
  }

  async getFeatured(limit = 6) {
    return this.listListings({ status: 'approved', featured: true });
  }

  // --- Collections ---

  async listCollections(opts?: { curatorId?: string; featured?: boolean }) {
    let results = await this.db.select().from(marketplaceCollections);
    if (opts?.curatorId) results = results.filter(c => c.curatorId === opts.curatorId);
    if (opts?.featured) results = results.filter(c => c.isFeatured);
    return results.filter(c => c.isPublic);
  }

  async getCollection(id: string) {
    const results = await this.db.select().from(marketplaceCollections);
    return results.find(c => c.id === id) ?? null;
  }

  async getCollectionBySlug(slug: string) {
    const results = await this.db.select().from(marketplaceCollections);
    return results.find(c => c.slug === slug) ?? null;
  }

  async createCollection(curatorId: string, name: string, slug: string, description?: string) {
    const existing = await this.getCollectionBySlug(slug);
    if (existing) throw new Error(`Collection slug "${slug}" is already taken`);

    const id = crypto.randomUUID();
    const now = new Date();
    const collection = { id, curatorId, name, slug, description: description ?? null, isPublic: true, isFeatured: false, createdAt: now, updatedAt: now };
    await this.db.insert(marketplaceCollections).values(collection);
    return collection;
  }

  async deleteCollection(id: string) {
    const existing = await this.getCollection(id);
    if (!existing) return false;
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`DELETE FROM marketplace_collections WHERE id = ?`, id);
    return true;
  }

  async getCollectionItems(collectionId: string) {
    const items = await this.db.select().from(marketplaceCollectionItems);
    const filtered = items.filter(i => i.collectionId === collectionId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const listings = await this.db.select().from(marketplaceListings);
    const listingMap = new Map(listings.map(l => [l.id, l]));

    return filtered.map(item => ({
      ...item,
      listing: listingMap.get(item.listingId) ?? null,
    }));
  }

  async addToCollection(collectionId: string, listingId: string, note?: string) {
    const items = await this.db.select().from(marketplaceCollectionItems);
    const existing = items.find(i => i.collectionId === collectionId && i.listingId === listingId);
    if (existing) return existing;

    const maxOrder = items.filter(i => i.collectionId === collectionId).reduce((max, i) => Math.max(max, i.order ?? 0), -1);
    const id = crypto.randomUUID();
    const item = { id, collectionId, listingId, note: note ?? null, order: maxOrder + 1 };
    await this.db.insert(marketplaceCollectionItems).values(item);
    return item;
  }

  async removeFromCollection(collectionId: string, listingId: string) {
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`DELETE FROM marketplace_collection_items WHERE collection_id = ? AND listing_id = ?`, collectionId, listingId);
    return true;
  }

  // --- Review Responses ---

  async getReviewResponses(reviewId: string) {
    const results = await this.db.select().from(marketplaceReviewResponses);
    return results.filter(r => r.reviewId === reviewId);
  }

  async respondToReview(reviewId: string, publisherId: string, body: string) {
    const id = crypto.randomUUID();
    const now = new Date();
    const response = { id, reviewId, publisherId, body, createdAt: now, updatedAt: now };
    await this.db.insert(marketplaceReviewResponses).values(response);
    return response;
  }

  // --- Publisher Analytics ---

  async getPublisherAnalytics(publisherId: string) {
    const listings = await this.db.select().from(marketplaceListings);
    const myListings = listings.filter(l => l.publisherId === publisherId);

    if (myListings.length === 0) {
      return { totalListings: 0, totalInstalls: 0, avgRating: 0, totalReviews: 0, listings: [] };
    }

    const listingIds = new Set(myListings.map(l => l.id));

    const allInstalls = await this.db.select().from(marketplaceInstalls);
    const myInstalls = allInstalls.filter(i => listingIds.has(i.listingId));

    const allReviews = await this.db.select().from(marketplaceReviews);
    const myReviews = allReviews.filter(r => listingIds.has(r.listingId));

    const totalInstalls = myListings.reduce((sum, l) => sum + (l.installCount ?? 0), 0);
    const totalReviews = myReviews.length;
    const avgRating = myReviews.length > 0
      ? Math.round((myReviews.reduce((sum, r) => sum + r.rating, 0) / myReviews.length) * 10) / 10
      : 0;

    // Per-listing breakdown
    const listingAnalytics = myListings.map(l => {
      const lReviews = myReviews.filter(r => r.listingId === l.id);
      const lInstalls = myInstalls.filter(i => i.listingId === l.id);

      // Recent installs (last 7 days)
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentInstalls = lInstalls.filter(i => {
        const ts = i.installedAt instanceof Date ? i.installedAt.getTime() : (typeof i.installedAt === 'number' ? i.installedAt * 1000 : 0);
        return ts > weekAgo;
      }).length;

      return {
        id: l.id,
        name: l.name,
        slug: l.slug,
        installCount: l.installCount ?? 0,
        recentInstalls,
        avgRating: l.avgRating ?? 0,
        ratingCount: l.ratingCount ?? 0,
        reviewCount: lReviews.length,
        status: l.status,
      };
    }).sort((a, b) => b.installCount - a.installCount);

    return { totalListings: myListings.length, totalInstalls, avgRating, totalReviews, listings: listingAnalytics };
  }

  // --- Premium Pricing ---

  async getListingPricing(listingId: string) {
    const results = await this.db.select().from(marketplaceListingPricing);
    return results.find(p => p.listingId === listingId) ?? null;
  }

  async setListingPricing(listingId: string, pricing: {
    tier: string;
    price?: number;
    currency?: string;
    billingModel?: string;
    billingInterval?: string;
    trialDays?: number;
    seatLimit?: number;
    features?: string[];
  }) {
    const existing = await this.getListingPricing(listingId);
    const now = new Date();

    if (existing) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [key, value] of Object.entries(pricing)) {
        if (value !== undefined) {
          sets.push(`${this.camelToSnake(key)} = ?`);
          vals.push(typeof value === 'object' ? JSON.stringify(value) : value);
        }
      }
      sets.push('updated_at = ?');
      vals.push(Math.floor(now.getTime() / 1000));
      vals.push(existing.id);
      (this.db as unknown as { run(q: string, ...p: unknown[]): void })
        .run?.(`UPDATE marketplace_listing_pricing SET ${sets.join(', ')} WHERE id = ?`, ...vals);
      return { ...existing, ...pricing, updatedAt: now };
    }

    const id = crypto.randomUUID();
    const row = {
      id,
      listingId,
      tier: pricing.tier,
      price: pricing.price ?? 0,
      currency: pricing.currency ?? 'USD',
      billingModel: pricing.billingModel ?? 'one-time',
      billingInterval: pricing.billingInterval ?? null,
      trialDays: pricing.trialDays ?? 0,
      seatLimit: pricing.seatLimit ?? null,
      features: pricing.features ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(marketplaceListingPricing).values(row);
    return row;
  }

  // --- Licensing ---

  async getUserLicenses(userId: string) {
    const results = await this.db.select().from(marketplaceLicenses);
    return results.filter(l => l.userId === userId && l.status === 'active');
  }

  async getLicense(licenseId: string) {
    const results = await this.db.select().from(marketplaceLicenses);
    return results.find(l => l.id === licenseId) ?? null;
  }

  async getLicenseByKey(licenseKey: string) {
    const results = await this.db.select().from(marketplaceLicenses);
    return results.find(l => l.licenseKey === licenseKey) ?? null;
  }

  async issueLicense(listingId: string, userId: string, tier: string, seatsTotal?: number, expiresAt?: Date) {
    const licenseKey = `mcp-${tier}-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const id = crypto.randomUUID();
    const now = new Date();

    const license = {
      id,
      listingId,
      userId,
      licenseKey,
      tier,
      seatsUsed: 0,
      seatsTotal: seatsTotal ?? null,
      status: 'active',
      expiresAt: expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(marketplaceLicenses).values(license);
    return license;
  }

  async revokeLicense(licenseId: string) {
    const existing = await this.getLicense(licenseId);
    if (!existing) return false;
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE marketplace_licenses SET status = 'revoked', updated_at = ? WHERE id = ?`,
        Math.floor(Date.now() / 1000), licenseId);
    return true;
  }

  async validateLicense(licenseKey: string): Promise<{ valid: boolean; reason?: string; license?: unknown }> {
    const license = await this.getLicenseByKey(licenseKey);
    if (!license) return { valid: false, reason: 'License not found' };
    if (license.status !== 'active') return { valid: false, reason: `License is ${license.status}` };
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      return { valid: false, reason: 'License has expired' };
    }
    if (license.seatsTotal && (license.seatsUsed ?? 0) >= license.seatsTotal) {
      return { valid: false, reason: 'All seats are in use' };
    }
    return { valid: true, license };
  }

  // --- Private Marketplace (Org-Scoped) ---

  async getOrgListings(orgOwnerId: string) {
    const access = await this.db.select().from(orgMarketplaceAccess);
    const orgAccess = access.filter(a => a.orgOwnerId === orgOwnerId);
    if (orgAccess.length === 0) return [];

    const listings = await this.db.select().from(marketplaceListings);
    const listingMap = new Map(listings.map(l => [l.id, l]));

    return orgAccess.map(a => ({
      ...a,
      listing: listingMap.get(a.listingId) ?? null,
    })).filter(a => a.listing !== null);
  }

  async addOrgListing(orgOwnerId: string, listingId: string, accessLevel = 'install') {
    const existing = await this.db.select().from(orgMarketplaceAccess);
    if (existing.find(a => a.orgOwnerId === orgOwnerId && a.listingId === listingId)) {
      throw new Error('Listing already added to this organization');
    }

    const id = crypto.randomUUID();
    const row = { id, orgOwnerId, listingId, accessLevel, approvedAt: null, approvedBy: null };
    await this.db.insert(orgMarketplaceAccess).values(row);
    return row;
  }

  async removeOrgListing(orgOwnerId: string, listingId: string) {
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`DELETE FROM org_marketplace_access WHERE org_owner_id = ? AND listing_id = ?`, orgOwnerId, listingId);
    return true;
  }

  async approveOrgListing(orgOwnerId: string, listingId: string, approvedBy: string) {
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`UPDATE org_marketplace_access SET approved_at = ?, approved_by = ? WHERE org_owner_id = ? AND listing_id = ?`,
        Math.floor(Date.now() / 1000), approvedBy, orgOwnerId, listingId);
    return true;
  }

  // --- Org Members ---

  async getOrgMembers(orgOwnerId: string) {
    const results = await this.db.select().from(orgMarketplaceMembers);
    return results.filter(m => m.orgOwnerId === orgOwnerId);
  }

  async addOrgMember(orgOwnerId: string, userId: string, role = 'member') {
    const existing = await this.db.select().from(orgMarketplaceMembers);
    if (existing.find(m => m.orgOwnerId === orgOwnerId && m.userId === userId)) {
      throw new Error('User is already a member of this organization');
    }

    const id = crypto.randomUUID();
    const row = { id, orgOwnerId, userId, role };
    await this.db.insert(orgMarketplaceMembers).values(row);
    return row;
  }

  async removeOrgMember(orgOwnerId: string, userId: string) {
    (this.db as unknown as { run(q: string, ...p: unknown[]): void })
      .run?.(`DELETE FROM org_marketplace_members WHERE org_owner_id = ? AND user_id = ?`, orgOwnerId, userId);
    return true;
  }

  async isOrgMember(orgOwnerId: string, userId: string): Promise<boolean> {
    if (orgOwnerId === userId) return true;
    const members = await this.getOrgMembers(orgOwnerId);
    return members.some(m => m.userId === userId);
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
