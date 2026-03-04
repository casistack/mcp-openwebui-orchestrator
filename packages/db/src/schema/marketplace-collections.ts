import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { marketplaceListings } from './marketplace';

export const marketplaceCollections = sqliteTable('marketplace_collections', {
  id: text('id').primaryKey(),
  curatorId: text('curator_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isPublic: integer('is_public', { mode: 'boolean' }).default(true),
  isFeatured: integer('is_featured', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('collection_slug_unique').on(table.slug),
  index('collection_curator_idx').on(table.curatorId),
]);

export const marketplaceCollectionItems = sqliteTable('marketplace_collection_items', {
  id: text('id').primaryKey(),
  collectionId: text('collection_id').notNull().references(() => marketplaceCollections.id, { onDelete: 'cascade' }),
  listingId: text('listing_id').notNull().references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  note: text('note'),
  order: integer('order').default(0),
  addedAt: integer('added_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex('collection_item_unique').on(table.collectionId, table.listingId),
  index('collection_item_collection_idx').on(table.collectionId),
]);

export const marketplaceReviewResponses = sqliteTable('marketplace_review_responses', {
  id: text('id').primaryKey(),
  reviewId: text('review_id').notNull(),
  publisherId: text('publisher_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, (table) => [
  index('review_response_review_idx').on(table.reviewId),
]);
