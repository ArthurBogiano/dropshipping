'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDedupeKey,
  getSentProduct,
  markProductSent,
  openDatabase,
  recordWebhookDelivery,
  wasProductSentRecently,
} = require('../lib/storage');

test('SQLite persiste deduplicacao e entregas', () => {
  const db = openDatabase(':memory:');
  const product = {
    itemId: 'MLB12345678',
    canonicalUrl: 'https://example.com/product',
    title: 'Produto de exemplo',
  };

  assert.equal(buildDedupeKey(product), 'MLB12345678');
  assert.equal(wasProductSentRecently(db, 'MLB12345678', 60_000), false);

  markProductSent(db, product, 'https://example.com/list', 'https://example.com/hook');
  assert.equal(getSentProduct(db, 'MLB12345678').title, 'Produto de exemplo');
  assert.equal(wasProductSentRecently(db, 'MLB12345678', 60_000), true);

  recordWebhookDelivery(db, {
    category: 'example',
    chatIds: ['destination-example'],
    requestedTarget: 'https://example.com/list',
    webhookUrl: 'https://example.com/hook',
    webhookStatus: 200,
    totalProducts: 1,
    totalResults: 1,
  });

  const delivery = db.prepare('SELECT * FROM webhook_deliveries').get();
  assert.equal(delivery.webhook_status, 200);
  assert.equal(delivery.total_products, 1);
  db.close();
});
