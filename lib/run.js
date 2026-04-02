'use strict';

const path = require('node:path');

const {
  getHelpText,
  getSearchVariants,
  parseArgs,
  readCookies,
  readTargetsFile,
} = require('./cli');
const {
  applyListingSearchParams,
  collectProductsFromTarget,
} = require('./collector');
const { logError, logInfo, logWarn } = require('./logger');
const { sendToWebhook } = require('./network');
const { markProductSent, openDatabase } = require('./storage');

function buildWebhookPayloadBase(args) {
  return {
    ok: true,
    cookiesFile: args.cookies,
    dbFile: args.db,
    generatedAt: new Date().toISOString(),
  };
}

function summarizeProduct(product) {
  return {
    itemId: product.itemId,
    title: product.title,
    price: product.price?.amount ?? null,
    originalPrice: product.price?.originalAmount ?? null,
    currency: product.price?.currency ?? null,
    affiliateShortUrl: product.affiliate?.shortUrl || null,
  };
}

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

async function runCycle(args, normalizedTargetGroups) {
  const cookies = readCookies(args.cookies);
  const db = openDatabase(args.db);
  const allResults = [];
  let totalWebhooksSent = 0;
  let totalProductsSent = 0;
  let lastWebhookStatus = null;

  logInfo(`cookies carregados: ${path.basename(args.cookies)}`);
  logInfo(`sqlite: ${args.db}`);
  if (args.targetsFile) {
    const totalTargets = normalizedTargetGroups.reduce((sum, group) => sum + group.targets.length, 0);
    logInfo(`arquivo de categorias: ${args.targetsFile} (${normalizedTargetGroups.length} categoria(s), ${totalTargets} URL(s))`);
  }
  if (args.promotionTypes.length > 0) {
    logInfo(`filtros promocionais ativos: ${args.promotionTypes.join(', ')}`);
  }
  logInfo(`destino do webhook: ${args.webhook || 'desabilitado'}`);

  const searchVariants = getSearchVariants(args);

  for (const group of normalizedTargetGroups) {
    logInfo(`categoria atual: ${group.category}${group.chatId ? ` | chatid ${group.chatId}` : ''}`);

    for (const target of group.targets) {
      const targetResults = [];
      const seenTargets = new Set();

      for (const variant of searchVariants) {
        const effectiveTarget = applyListingSearchParams(target, {
          promotionType: variant.promotionType,
        });

        if (seenTargets.has(effectiveTarget)) {
          continue;
        }
        seenTargets.add(effectiveTarget);

        if (effectiveTarget !== target) {
          logInfo(`filtro aplicado na busca (${variant.label}): ${effectiveTarget}`);
        }

        logInfo(`pesquisando (${variant.label}): ${effectiveTarget}`);
        let result;

        try {
          result = await collectProductsFromTarget(effectiveTarget, cookies, args.limit, {
            db,
            affiliate: args.affiliate,
            affiliateTag: args.affiliateTag,
            maxPages: args.maxPages,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logError(`falha ao processar ${target} (${variant.label}): ${message}`);
          continue;
        }

        const enrichedResult = {
          ...result,
          category: group.category,
          chatId: group.chatId,
          requestedTarget: target,
          effectiveTarget,
          searchVariant: variant.label,
        };

        targetResults.push(enrichedResult);
        allResults.push(enrichedResult);

        logInfo(`resultado (${variant.label}): ${result.discoveredProducts} produto(s) novos em ${result.type}`);
        if (result.skippedDuplicates) {
          logInfo(`duplicados ignorados (${variant.label}): ${result.skippedDuplicates}`);
        }
        for (const product of result.products) {
          const summary = summarizeProduct(product);
          const priceText = summary.price != null && summary.currency ? `${summary.currency} ${summary.price}` : 'sem preco';
          const originalPriceText = summary.originalPrice != null && summary.currency ? ` | antes ${summary.currency} ${summary.originalPrice}` : '';
          const affiliateText = summary.affiliateShortUrl || 'sem meli.la';
          logInfo(`item ${summary.itemId || '-'} | ${summary.title || 'sem titulo'} | ${priceText}${originalPriceText} | ${affiliateText}`);
        }
      }

      const targetProducts = targetResults.flatMap((result) =>
        result.products.map((product) => ({
          ...product,
          sourceRequestedTarget: result.requestedTarget,
          sourceEffectiveTarget: result.effectiveTarget,
          sourceSearchVariant: result.searchVariant,
        }))
      );

      const webhookPayload = {
        ...buildWebhookPayloadBase(args),
        categoria: group.category,
        chatid: group.chatId,
        requestedTarget: target,
        totalProducts: targetProducts.length,
        products: targetProducts,
        results: targetResults,
      };

      logInfo(`payload do webhook para ${target}: ${targetProducts.length} produto(s) somando ${searchVariants.length} variante(s)`);

      const webhookResult = await sendToWebhook(args.webhook, webhookPayload);

      if (webhookResult.skipped) {
        logWarn('webhook desabilitado, JSON nao enviado.');
        return;
      }

      if (!webhookResult.ok) {
        logError(`falha no webhook: HTTP ${webhookResult.status}${webhookResult.responseText ? ` | resposta: ${webhookResult.responseText}` : ''}`);
        throw new Error(`Falha ao enviar para o webhook: HTTP ${webhookResult.status}`);
      }

      for (const result of targetResults) {
        for (const product of result.products) {
          markProductSent(db, product, result.target, args.webhook);
        }
      }
      lastWebhookStatus = webhookResult.status;
      totalWebhooksSent += 1;
      totalProductsSent += targetProducts.length;
      logInfo(`webhook enviado com sucesso para ${target}: HTTP ${webhookResult.status}`);
    }
  }

  if (allResults.length === 0) {
    logWarn('nenhuma busca retornou resultado; nada foi processado.');
    return;
  }

  logInfo(`webhooks enviados com sucesso: ${totalWebhooksSent} target(s) | ultimo status HTTP ${lastWebhookStatus}`);
  logInfo(`produtos marcados no sqlite: ${totalProductsSent}`);
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
