'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  getSearchVariants,
  parseArgs,
  readTargetsFile,
} = require('../lib/cli');

test('parseArgs interpreta opcoes de execucao', () => {
  const args = parseArgs([
    '--targets-file', 'targets.example.json',
    '--cookies', 'cookies.example.json',
    '--db', 'test.sqlite',
    '--limit', '3',
    '--max-pages', '2',
    '--resend-after-hours', '12.5',
    '--loop-delay-ms', '1500',
    '--affiliate-tag', 'example-tag',
    '--webhook', 'https://example.com/hook',
    '--deal-of-day',
    '--lightning',
    '--compact',
    '--no-loop',
  ]);

  assert.equal(args.targetsFile, path.resolve('targets.example.json'));
  assert.equal(args.cookies, path.resolve('cookies.example.json'));
  assert.equal(args.db, path.resolve('test.sqlite'));
  assert.equal(args.limit, 3);
  assert.equal(args.maxPages, 2);
  assert.equal(args.resendAfterHours, 12.5);
  assert.equal(args.loopDelayMs, 1500);
  assert.equal(args.affiliateTag, 'example-tag');
  assert.equal(args.webhook, 'https://example.com/hook');
  assert.deepEqual(args.promotionTypes, ['deal_of_the_day', 'lightning']);
  assert.equal(args.pretty, false);
  assert.equal(args.loop, false);
});

test('readTargetsFile normaliza o arquivo de exemplo', () => {
  const groups = readTargetsFile(path.resolve('targets.example.json'));

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    category: 'tecnologia',
    chatIds: ['replace-with-destination-id'],
    targets: [
      'https://lista.mercadolivre.com.br/notebook',
      'https://www.mercadolivre.com.br/ofertas',
    ],
  });
});

test('getSearchVariants preserva uma ordem deterministica', () => {
  const variants = getSearchVariants({
    promotionTypes: ['deal_of_the_day', 'lightning', 'deal_of_the_day'],
  });

  assert.deepEqual(variants, [
    { label: 'lightning', promotionType: 'lightning' },
    { label: 'deal_of_the_day', promotionType: 'deal_of_the_day' },
    { label: 'padrao', promotionType: null },
  ]);
});
