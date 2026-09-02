'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { Worker } = require('node:worker_threads');

test('worker de execucao unica encerra depois de concluir', async () => {
  const worker = new Worker(path.resolve('lib/category-worker.js'), {
    workerData: {
      args: {
        affiliate: false,
        affiliateTag: null,
        cookies: path.resolve('cookies.example.json'),
        db: ':memory:',
        limit: 1,
        loop: false,
        maxPages: 1,
        pretty: false,
        promotionTypes: [],
        resendAfterHours: 0,
        webhook: null,
      },
      group: {
        category: 'example',
        chatIds: [],
        targets: [],
      },
    },
  });

  const messages = [];
  worker.on('message', (message) => messages.push(message));

  const exitCode = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('worker nao encerrou dentro do prazo'));
    }, 2_000);

    worker.once('error', reject);
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0);
  assert.ok(messages.some((message) => message.type === 'completed'));
});
