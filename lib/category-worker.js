'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const { setLogPrefix } = require('./logger');
const { processTargetGroup } = require('./group-runner');

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runSingleCycle(args, group, cycleNumber) {
  parentPort.postMessage({
    type: 'cycle_started',
    category: group.category,
    cycleNumber,
  });

  const summary = await processTargetGroup(args, group);

  parentPort.postMessage({
    type: args.loop ? 'cycle_completed' : 'completed',
    cycleNumber,
    ...summary,
  });
}

async function main() {
  const { args, group } = workerData;
  setLogPrefix(`[${group.category}]`);

  parentPort.postMessage({
    type: 'started',
    category: group.category,
    targets: Array.isArray(group.targets) ? group.targets.length : 0,
    loop: Boolean(args.loop),
  });

  if (!args.loop) {
    await runSingleCycle(args, group, 1);
    return;
  }

  let cycleNumber = 0;

  while (true) {
    cycleNumber += 1;

    try {
      await runSingleCycle(args, group, cycleNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parentPort.postMessage({
        type: 'cycle_failed',
        category: group.category,
        cycleNumber,
        error: message,
      });
    }

    await sleep(args.loopDelayMs);
  }
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
