'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildProductPayload,
  decodeHtmlEntities,
  extractCanonicalUrl,
  extractItemId,
} = require('../lib/product-parser');

test('funcoes basicas normalizam entidades, canonical e item ID', () => {
  assert.equal(decodeHtmlEntities('Casa &amp; Jardim'), 'Casa & Jardim');
  assert.equal(extractCanonicalUrl('<link rel="canonical" href="https://example.com/a?x=1&amp;y=2">'), 'https://example.com/a?x=1&y=2');
  assert.equal(extractItemId('https://example.com/MLB123ABC'), 'MLB123ABC');
});

test('buildProductPayload extrai JSON-LD de produto', () => {
  const html = `
    <html><head>
      <link rel="canonical" href="https://www.mercadolivre.com.br/p/MLB12345678">
      <script type="application/ld+json">{
        "@type":"Product",
        "name":"Produto de exemplo",
        "description":"Descricao segura",
        "sku":"MLB12345678",
        "brand":{"name":"Marca Exemplo"},
        "image":["https://example.com/image.jpg"],
        "offers":{"price":"199.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"},
        "aggregateRating":{"ratingValue":"4.8","reviewCount":"42"}
      }</script>
      <script type="application/ld+json">{
        "@type":"BreadcrumbList",
        "itemListElement":[{"item":{"name":"Tecnologia"}},{"item":{"name":"Notebooks"}}]
      }</script>
    </head><body></body></html>`;

  const product = buildProductPayload({
    requestedUrl: 'https://example.com/requested',
    finalUrl: 'https://example.com/final',
    html,
  });

  assert.equal(product.itemId, 'MLB12345678');
  assert.equal(product.title, 'Produto de exemplo');
  assert.equal(product.brand, 'Marca Exemplo');
  assert.equal(product.price.amount, 199.9);
  assert.equal(product.price.currency, 'BRL');
  assert.equal(product.price.availability, 'InStock');
  assert.equal(product.rating.score, 4.8);
  assert.deepEqual(product.breadcrumbs, ['Tecnologia', 'Notebooks']);
  assert.equal(product.categoryPath, 'Tecnologia > Notebooks');
});
