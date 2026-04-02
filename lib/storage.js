'use strict';

const { DatabaseSync } = require('node:sqlite');

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
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
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at TEXT NOT NULL,
      category TEXT,
      chat_id TEXT,
      requested_target TEXT,
      webhook_url TEXT,
      webhook_status INTEGER,
      total_products INTEGER NOT NULL DEFAULT 0,
      total_results INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sent_at ON webhook_deliveries(sent_at);
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

function recordWebhookDelivery(db, delivery) {
  const statement = db.prepare(`
    INSERT INTO webhook_deliveries (
      sent_at,
      category,
      chat_id,
      requested_target,
      webhook_url,
      webhook_status,
      total_products,
      total_results
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  statement.run(
    new Date().toISOString(),
    delivery.category || null,
    delivery.chatId || null,
    delivery.requestedTarget || null,
    delivery.webhookUrl || null,
    delivery.webhookStatus ?? null,
    Number(delivery.totalProducts || 0),
    Number(delivery.totalResults || 0)
  );
}

module.exports = {
  buildDedupeKey,
  getSentProduct,
  markProductSent,
  openDatabase,
  recordWebhookDelivery,
  touchSeenProduct,
};
