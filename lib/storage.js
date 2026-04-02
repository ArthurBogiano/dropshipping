'use strict';

const { DatabaseSync } = require('node:sqlite');

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_products (
      dedupe_key TEXT PRIMARY KEY,
      item_id TEXT,
      canonical_url TEXT,
      title TEXT,
      source_target TEXT,
      webhook_url TEXT,
      first_sent_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sent_products_item_id ON sent_products(item_id);
  `);
  return db;
}

function buildDedupeKey({ itemId, canonicalUrl, requestedUrl }) {
  return itemId || canonicalUrl || requestedUrl;
}

function getSentProduct(db, dedupeKey) {
  if (!dedupeKey) {
    return null;
  }

  const statement = db.prepare('SELECT * FROM sent_products WHERE dedupe_key = ?');
  return statement.get(dedupeKey) || null;
}

function touchSeenProduct(db, { dedupeKey }) {
  if (!dedupeKey) {
    return;
  }

  const statement = db.prepare('UPDATE sent_products SET last_seen_at = ? WHERE dedupe_key = ?');
  statement.run(new Date().toISOString(), dedupeKey);
}

function markProductSent(db, product, sourceTarget, webhookUrl) {
  const dedupeKey = buildDedupeKey(product);
  if (!dedupeKey) {
    return;
  }

  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO sent_products (
      dedupe_key, item_id, canonical_url, title, source_target, webhook_url, first_sent_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      item_id = excluded.item_id,
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      source_target = excluded.source_target,
      webhook_url = excluded.webhook_url,
      last_seen_at = excluded.last_seen_at
  `);

  statement.run(
    dedupeKey,
    product.itemId || null,
    product.canonicalUrl || null,
    product.title || null,
    sourceTarget || null,
    webhookUrl || null,
    now,
    now
  );
}

module.exports = {
  buildDedupeKey,
  getSentProduct,
  markProductSent,
  openDatabase,
  touchSeenProduct,
};
