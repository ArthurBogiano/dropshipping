'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const { setLogPrefix } = require('./logger');
const { processTargetGroup } = require('./group-runner');

async function main() {
  const { args, group } = workerData;
  setLogPrefix(`[${group.category}]`);
  parentPort.postMessage({
    type: 'started',
    category: group.category,
    targets: Array.isArray(group.targets) ? group.targets.length : 0,
  });
  const summary = await processTargetGroup(args, group);
  parentPort.postMessage({
    type: 'completed',
    ...summary,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (parentPort) {
    parentPort.postMessage({
      type: 'failed',
      error: message,
      failed: true,
      category: workerData?.group?.category || 'desconhecida',
    });
  }
  process.exit(1);
});
