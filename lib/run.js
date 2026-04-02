'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const {
  getHelpText,
  parseArgs,
  readTargetsFile,
} = require('./cli');
const { logError, logInfo } = require('./logger');

function getNormalizedTargetGroups(args) {
  const targetGroups = [];

  if (args.targetsFile) {
    targetGroups.push(...readTargetsFile(args.targetsFile));
  }

  if (args.targets.length > 0) {
    targetGroups.push({
      category: 'geral',
      chatId: null,
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCategoryWorker(args, group) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, 'category-worker.js'), {
      workerData: { args, group },
    });

    let settled = false;

    worker.on('message', (message) => {
      if (message?.type === 'started') {
        logInfo(`worker da categoria ${message.category} iniciado (${message.targets} target(s))`);
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
        settled = true;
        resolve(message);
      }
    });

    worker.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    worker.once('exit', (code) => {
      if (settled) {
        if (code === 0) {
          logInfo(`worker da categoria ${group.category} finalizado`);
        }
        return;
      }
      settled = true;
      if (code === 0) {
        resolve({
          category: group.category,
          hasResults: false,
          lastWebhookStatus: null,
          totalProductsSent: 0,
          totalWebhooksSent: 0,
        });
        return;
      }

      reject(new Error(`worker da categoria ${group.category} encerrou com codigo ${code}`));
    });
  });
}

async function runCycle(args, normalizedTargetGroups) {
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
    logInfo('nenhuma categoria retornou resultados novos neste ciclo.');
    return;
  }

  logInfo(`resumo do ciclo: ${totalWebhooksSent} webhook(s) enviados | ${totalProductsSent} produto(s) contabilizados | ultimo status HTTP ${lastWebhookStatus}`);
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

  if (!args.loop) {
    await runCycle(args, normalizedTargetGroups);
    return;
  }

  let cycleNumber = 0;

  while (true) {
    cycleNumber += 1;
    logInfo(`iniciando ciclo continuo #${cycleNumber}`);

    try {
      await runCycle(args, normalizedTargetGroups);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`falha no ciclo #${cycleNumber}: ${message}`);
    }

    logInfo(`ciclo #${cycleNumber} finalizado; aguardando ${args.loopDelayMs}ms para reiniciar`);
    await sleep(args.loopDelayMs);
  }
}

module.exports = {
  run,
};
