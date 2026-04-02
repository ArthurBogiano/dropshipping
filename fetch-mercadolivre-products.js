#!/usr/bin/env node
'use strict';

const { logError } = require('./lib/logger');
const { run } = require('./lib/run');

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
