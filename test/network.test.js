'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { fetchHtml } = require('../lib/network');

test('fetchHtml encerra requisicoes que excedem o timeout', async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      fetchHtml(`http://127.0.0.1:${port}`, [], {
        applyDelay: false,
        timeoutMs: 30,
        retries: 0,
      }),
      /timeout de 30ms/
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('fetchHtml identifica redirecionamento para captcha', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/start') {
      response.writeHead(302, { location: '/captcha/wall' });
      response.end();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body>challenge</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      fetchHtml(`http://127.0.0.1:${port}/start`, [], {
        applyDelay: false,
        timeoutMs: 500,
        retries: 0,
      }),
      /HTTP 403 \(desafio de acesso\)/
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
