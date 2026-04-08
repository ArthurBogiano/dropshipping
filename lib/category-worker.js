'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const { QUIET_HOURS_RECHECK_MS } = require('./constants');
const { setLogPrefix } = require('./logger');
const {
  formatResumeAt,
  getMillisecondsUntilAllowedWindow,
  isWithinQuietHours,
} = require('./service-window');
const { processTargetGroup } = require('./group-runner');
const { setNetworkCoordinatorPort } = require('./network');

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForAllowedWindow(group) {
  while (isWithinQuietHours()) {
    const now = new Date();
    const remainingMs = Math.max(0, getMillisecondsUntilAllowedWindow(now));
    const waitMs = Math.min(remainingMs, QUIET_HOURS_RECHECK_MS);

    parentPort.postMessage({
      type: 'paused',
      category: group.category,
      resumeAt: formatResumeAt(now),
      remainingMs,
    });

    await sleep(waitMs);
  }
}

async function runSingleCycle(args, group, cycleNumber) {
  parentPort.postMessage({
    type: 'cycle_started',
    category: group.category,
    cycleNumber,
  });

  const summary = await processTargetGroup(args, group, {
    waitForAllowedWindow: () => waitForAllowedWindow(group),
  });

  parentPort.postMessage({
    type: args.loop ? 'cycle_completed' : 'completed',
    cycleNumber,
    ...summary,
  });
}

async function main() {
  const { args, group } = workerData;
  setLogPrefix(`[${group.category}]`);
  setNetworkCoordinatorPort(parentPort);

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
    await waitForAllowedWindow(group);
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
