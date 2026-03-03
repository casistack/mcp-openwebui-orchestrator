CREATE TABLE marketplace_listings (
  id TEXT PRIMARY KEY NOT NULL,
  publisher_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  short_description TEXT,
  description TEXT,
  category TEXT NOT NULL,
  tags TEXT,
  transport TEXT NOT NULL,
  config TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  requirements TEXT,
  compatibility TEXT,
  icon_url TEXT,
  screenshots TEXT,
  install_count INTEGER DEFAULT 0,
  avg_rating REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  is_featured INTEGER DEFAULT 0,
  is_public INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);--> statement-breakpoint
CREATE UNIQUE INDEX marketplace_slug_unique ON marketplace_listings(slug);--> statement-breakpoint
CREATE INDEX marketplace_category_idx ON marketplace_listings(category);--> statement-breakpoint
CREATE INDEX marketplace_publisher_idx ON marketplace_listings(publisher_id);--> statement-breakpoint
CREATE INDEX marketplace_status_idx ON marketplace_listings(status);--> statement-breakpoint
CREATE TABLE marketplace_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);--> statement-breakpoint
CREATE UNIQUE INDEX review_user_listing_unique ON marketplace_reviews(listing_id, user_id);--> statement-breakpoint
CREATE INDEX review_listing_idx ON marketplace_reviews(listing_id);--> statement-breakpoint
CREATE TABLE marketplace_installs (
  id TEXT PRIMARY KEY NOT NULL,
  listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
  version TEXT NOT NULL,
  installed_at INTEGER DEFAULT (unixepoch()),
  uninstalled_at INTEGER
);--> statement-breakpoint
CREATE INDEX install_listing_idx ON marketplace_installs(listing_id);--> statement-breakpoint
CREATE INDEX install_user_idx ON marketplace_installs(user_id);
