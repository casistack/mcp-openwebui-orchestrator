import crypto from 'crypto';
import { marketplaceListings, marketplaceReviews, marketplaceInstalls, mcpServers } from '@mcp-platform/db';
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

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}
