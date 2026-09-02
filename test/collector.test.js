'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { applyListingSearchParams } = require('../lib/collector');

test('applyListingSearchParams adiciona filtro em listagem', () => {
  const result = new URL(applyListingSearchParams(
    'https://lista.mercadolivre.com.br/notebook',
    { promotionType: 'lightning' }
  ));

  assert.match(result.pathname, /promotion\*type_lightning/);
  assert.equal(result.searchParams.get('original_category_landing'), 'true');
  assert.match(result.hash, /promotion_type/);
});

test('applyListingSearchParams mantem URL de produto', () => {
  const target = 'https://www.mercadolivre.com.br/p/MLB12345678';
  assert.equal(applyListingSearchParams(target, { promotionType: 'lightning' }), target);
});
