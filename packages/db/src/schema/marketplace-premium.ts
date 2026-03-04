import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { marketplaceListings } from './marketplace';

/**
 * Premium listing tiers and pricing.
 * Each listing can have a pricing tier: free, premium, or enterprise.
 * This table stores the pricing details for non-free listings.
 */
export const marketplaceListingPricing = sqliteTable('marketplace_listing_pricing', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull().default('free'), // free, premium, enterprise
  price: real('price').default(0),
  currency: text('currency').default('USD'),
  billingModel: text('billing_model').default('one-time'), // one-time, subscription
  billingInterval: text('billing_interval'), // monthly, yearly (null for one-time)
  trialDays: integer('trial_days').default(0),
  seatLimit: integer('seat_limit'), // null = unlimited
  features: text('features', { mode: 'json' }).$type<string[]>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('listing_pricing_unique').on(table.listingId),
]);

/**
 * License keys issued for premium/enterprise listings.
 * Tracks per-user/per-org licenses with seat counts and expiration.
 */
export const marketplaceLicenses = sqliteTable('marketplace_licenses', {
  id: text('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  licenseKey: text('license_key').notNull(),
  tier: text('tier').notNull(), // premium, enterprise
  seatsUsed: integer('seats_used').default(0),
  seatsTotal: integer('seats_total'), // null = unlimited
  status: text('status').notNull().default('active'), // active, expired, revoked, suspended
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('license_key_unique').on(table.licenseKey),
  index('license_listing_idx').on(table.listingId),
  index('license_user_idx').on(table.userId),
  index('license_status_idx').on(table.status),
]);

/**
 * Private marketplace scoping — listings visible only within an organization.
 * Links listings to "organizations" (represented by owner user IDs for now).
 * Members added via org_marketplace_members get access to private listings.
 */
export const orgMarketplaceAccess = sqliteTable('org_marketplace_access', {
  id: text('id').primaryKey(),
  orgOwnerId: text('org_owner_id').notNull().references(() => users.id),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  accessLevel: text('access_level').notNull().default('install'), // install, admin
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  approvedBy: text('approved_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('org_listing_access_unique').on(table.orgOwnerId, table.listingId),
  index('org_access_owner_idx').on(table.orgOwnerId),
]);

/**
 * Organization marketplace members — who can access private marketplace listings.
 */
export const orgMarketplaceMembers = sqliteTable('org_marketplace_members', {
  id: text('id').primaryKey(),
  orgOwnerId: text('org_owner_id').notNull().references(() => users.id),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // member, admin
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('org_member_unique').on(table.orgOwnerId, table.userId),
  index('org_member_owner_idx').on(table.orgOwnerId),
  index('org_member_user_idx').on(table.userId),
]);
