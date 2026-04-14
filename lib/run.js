'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const {
  getHelpText,
  parseArgs,
  readTargetsFile,
} = require('./cli');
const { logError, logInfo, logWarn } = require('./logger');

const networkQueue = [];
let activeNetworkRequest = null;

function getNormalizedTargetGroups(args) {
  const targetGroups = [];

  if (args.targetsFile) {
    targetGroups.push(...readTargetsFile(args.targetsFile));
  }

  if (args.targets.length > 0) {
    targetGroups.push({
      category: 'geral',
      chatIds: [],
      targets: [...new Set(args.targets)],
    });
  }

  args.promotionTypes = [...new Set(args.promotionTypes)];

  return targetGroups
    .map((group) => ({
      ...group,
      targets: [...new Set(group.targets)],
    }))
    .filter((group) => group.targets.length > 0);
}

function tryGrantNextNetworkRequest() {
  if (activeNetworkRequest || networkQueue.length === 0) {
    return;
  }

  activeNetworkRequest = networkQueue.shift();
  activeNetworkRequest.worker.postMessage({
    type: 'network_granted',
    requestId: activeNetworkRequest.requestId,
  });
}

function enqueueNetworkRequest(worker, group, message) {
  networkQueue.push({
    worker,
    category: group.category,
    requestId: message.requestId,
  });
  tryGrantNextNetworkRequest();
}

function releaseNetworkRequest(worker, message) {
  if (
    activeNetworkRequest &&
    activeNetworkRequest.worker === worker &&
    activeNetworkRequest.requestId === message.requestId
  ) {
    activeNetworkRequest = null;
    tryGrantNextNetworkRequest();
    return;
  }

  const queuedIndex = networkQueue.findIndex(
    (entry) => entry.worker === worker && entry.requestId === message.requestId
  );
  if (queuedIndex >= 0) {
    networkQueue.splice(queuedIndex, 1);
  }
}

function cleanupWorkerNetworkQueue(worker) {
  if (activeNetworkRequest?.worker === worker) {
    activeNetworkRequest = null;
  }

  for (let index = networkQueue.length - 1; index >= 0; index -= 1) {
    if (networkQueue[index].worker === worker) {
      networkQueue.splice(index, 1);
    }
  }

  tryGrantNextNetworkRequest();
}

function runCategoryWorker(args, group) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, 'category-worker.js'), {
      workerData: { args, group },
    });

    let settled = false;
    let latestSummary = {
      category: group.category,
      hasResults: false,
      lastWebhookStatus: null,
      totalProductsSent: 0,
      totalWebhooksSent: 0,
    };

    worker.on('message', (message) => {
      if (message?.type === 'network_request') {
        enqueueNetworkRequest(worker, group, message);
        return;
      }

      if (message?.type === 'network_release') {
        releaseNetworkRequest(worker, message);
        return;
      }

      if (message?.type === 'started') {
        const loopMode = message.loop ? 'loop continuo' : 'execucao unica';
        logInfo(`worker da categoria ${message.category} iniciado (${message.targets} target(s), ${loopMode})`);
        return;
      }

      if (message?.type === 'cycle_started') {
        logInfo(`worker da categoria ${message.category} iniciou o ciclo ${message.cycleNumber}`);
        return;
      }

      if (message?.type === 'paused') {
        const resumeAt = message.resumeAt || 'horario indefinido';
        logInfo(`worker da categoria ${message.category} em pausa noturna ate ${resumeAt}`);
        return;
      }

      if (message?.type === 'cycle_failed') {
        logError(`worker da categoria ${message.category} falhou no ciclo ${message.cycleNumber}: ${message.error}`);
        return;
      }

      if (message?.type === 'cycle_completed') {
        latestSummary = {
          category: message.category,
          hasResults: Boolean(message.hasResults),
          lastWebhookStatus: message.lastWebhookStatus ?? null,
          totalProductsSent: Number(message.totalProductsSent || 0),
          totalWebhooksSent: Number(message.totalWebhooksSent || 0),
        };
        logInfo(`worker da categoria ${message.category} concluiu o ciclo ${message.cycleNumber}`);
        return;
      }

      if (settled) {
        return;
      }

      if (message?.failed || message?.type === 'failed') {
        settled = true;
        reject(new Error(`worker da categoria ${message.category}: ${message.error}`));
        return;
      }

      if (message?.type === 'completed') {
        latestSummary = {
          category: message.category,
          hasResults: Boolean(message.hasResults),
          lastWebhookStatus: message.lastWebhookStatus ?? null,
          totalProductsSent: Number(message.totalProductsSent || 0),
          totalWebhooksSent: Number(message.totalWebhooksSent || 0),
        };
      }
    });

    worker.once('error', (error) => {
      cleanupWorkerNetworkQueue(worker);
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    worker.once('exit', (code) => {
      cleanupWorkerNetworkQueue(worker);
      if (settled) {
        if (code === 0) {
          logInfo(`worker da categoria ${group.category} finalizado`);
        }
        return;
      }

      settled = true;

      if (code === 0) {
        resolve(latestSummary);
        return;
      }

      reject(new Error(`worker da categoria ${group.category} encerrou com codigo ${code}`));
    });
  });
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(getHelpText());
    return;
  }

  const normalizedTargetGroups = getNormalizedTargetGroups(args);

  if (normalizedTargetGroups.length === 0) {
    throw new Error('Uso: node fetch-mercadolivre-products.js <url-do-produto-ou-listagem> [outras-urls] [--targets-file targets.json] [--limit 5] [--cookies cookies.json] [--affiliate-tag sua_tag] [--deal-of-day|--lightning] [--no-affiliate] [--no-loop]');
  }

  logInfo(`sqlite: ${args.db}`);
  if (args.targetsFile) {
    const totalTargets = normalizedTargetGroups.reduce((sum, group) => sum + group.targets.length, 0);
    logInfo(`arquivo de categorias: ${args.targetsFile} (${normalizedTargetGroups.length} categoria(s), ${totalTargets} URL(s))`);
  }
  if (args.promotionTypes.length > 0) {
    logInfo(`filtros promocionais ativos: ${args.promotionTypes.join(', ')}`);
  }
  logInfo(`destino do webhook: ${args.webhook || 'desabilitado'}`);
  logInfo(`iniciando ${normalizedTargetGroups.length} worker(s), um por categoria`);

  const settledResults = await Promise.allSettled(
    normalizedTargetGroups.map((group) => runCategoryWorker(args, group))
  );

  if (args.loop) {
    logWarn('todos os workers foram encerrados; o processo principal vai finalizar.');
    return;
  }

  let totalWebhooksSent = 0;
  let totalProductsSent = 0;
  let lastWebhookStatus = null;
  let hasResults = false;

  for (const settled of settledResults) {
    if (settled.status === 'rejected') {
      logError(settled.reason instanceof Error ? settled.reason.message : String(settled.reason));
      continue;
    }

    const summary = settled.value;
    totalWebhooksSent += Number(summary.totalWebhooksSent || 0);
    totalProductsSent += Number(summary.totalProductsSent || 0);
    hasResults = hasResults || Boolean(summary.hasResults);
    if (summary.lastWebhookStatus != null) {
      lastWebhookStatus = summary.lastWebhookStatus;
    }
  }

  if (!hasResults) {
    logInfo('nenhuma categoria retornou resultados novos nesta execucao.');
    return;
  }

  logInfo(`resumo da execucao: ${totalWebhooksSent} webhook(s) enviados | ${totalProductsSent} produto(s) contabilizados | ultimo status HTTP ${lastWebhookStatus}`);
}

module.exports = {
  run,
};
