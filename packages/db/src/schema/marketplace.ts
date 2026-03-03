import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { mcpServers } from './servers';

export const marketplaceListings = sqliteTable('marketplace_listings', {
  id: text('id').primaryKey(),
  publisherId: text('publisher_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  shortDescription: text('short_description'),
  description: text('description'),
  category: text('category').notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>(),
  transport: text('transport').notNull(),
  // Server config needed for one-click install
  config: text('config', { mode: 'json' }).$type<{
    command?: string;
    args?: string[];
    cwd?: string;
    url?: string;
    headers?: Record<string, string>;
    proxyType?: string;
    needsProxy?: boolean;
  }>(),
  version: text('version').notNull().default('1.0.0'),
  requirements: text('requirements', { mode: 'json' }).$type<{
    envVars?: Array<{ key: string; description: string; required: boolean }>;
    dependencies?: string[];
  }>(),
  compatibility: text('compatibility', { mode: 'json' }).$type<string[]>(),
  iconUrl: text('icon_url'),
  screenshots: text('screenshots', { mode: 'json' }).$type<string[]>(),
  installCount: integer('install_count').default(0),
  avgRating: real('avg_rating').default(0),
  ratingCount: integer('rating_count').default(0),
  isVerified: integer('is_verified', { mode: 'boolean' }).default(false),
  isFeatured: integer('is_featured', { mode: 'boolean' }).default(false),
  isPublic: integer('is_public', { mode: 'boolean' }).default(true),
  status: text('status').default('pending'), // pending, approved, rejected, deprecated
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('marketplace_slug_unique').on(table.slug),
  index('marketplace_category_idx').on(table.category),
  index('marketplace_publisher_idx').on(table.publisherId),
  index('marketplace_status_idx').on(table.status),
]);

export const marketplaceReviews = sqliteTable('marketplace_reviews', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('review_user_listing_unique').on(table.listingId, table.userId),
  index('review_listing_idx').on(table.listingId),
]);

export const marketplaceInstalls = sqliteTable('marketplace_installs', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  serverId: text('server_id').references(() => mcpServers.id, { onDelete: 'set null' }),
  version: text('version').notNull(),
  installedAt: integer('installed_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  uninstalledAt: integer('uninstalled_at', { mode: 'timestamp' }),
}, (table) => [
  index('install_listing_idx').on(table.listingId),
  index('install_user_idx').on(table.userId),
]);
