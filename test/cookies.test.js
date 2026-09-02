'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCookieHeader,
  getCookieValue,
  isCookieExpired,
} = require('../lib/cookies');

test('buildCookieHeader filtra dominio, caminho, protocolo e expiracao', () => {
  const future = (Date.now() + 60_000) / 1000;
  const past = (Date.now() - 60_000) / 1000;
  const cookies = [
    { name: 'valid', value: 'one', domain: '.example.com', path: '/', secure: true, expirationDate: future },
    { name: 'path', value: 'two', domain: '.example.com', path: '/private', secure: true, session: true },
    { name: 'expired', value: 'three', domain: '.example.com', path: '/', secure: true, expirationDate: past },
    { name: 'foreign', value: 'four', domain: '.other.example', path: '/', secure: true, session: true },
  ];

  assert.equal(buildCookieHeader('https://shop.example.com/private/item', cookies), 'valid=one; path=two');
  assert.equal(buildCookieHeader('http://shop.example.com/private/item', cookies), '');
  assert.equal(getCookieValue(cookies, 'valid'), 'one');
  assert.equal(isCookieExpired(cookies[2]), true);
});
