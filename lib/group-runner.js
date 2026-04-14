'use strict';

const path = require('node:path');

const { getSearchVariants, readCookies } = require('./cli');
const {
  applyListingSearchParams,
  collectProductsFromTarget,
} = require('./collector');
const { logError, logInfo, logWarn } = require('./logger');
const { sendToWebhook } = require('./network');
const { markProductSent, openDatabase, recordWebhookDelivery } = require('./storage');

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

async function processTargetGroup(args, group, runtime = {}) {
  logInfo(`worker ativo; preparando recursos da categoria ${group.category}`);
  const cookies = readCookies(args.cookies);
  const db = openDatabase(args.db);
  const allResults = [];
  let totalWebhooksSent = 0;
  let totalProductsSent = 0;
  let lastWebhookStatus = null;
  const waitForAllowedWindow = typeof runtime.waitForAllowedWindow === 'function'
    ? runtime.waitForAllowedWindow
    : async () => {};

  const chatIdText = Array.isArray(group.chatIds) && group.chatIds.length > 0
    ? ` | chatid ${group.chatIds.join(', ')}`
    : '';
  logInfo(`categoria atual: ${group.category}${chatIdText}`);
  logInfo(`cookies carregados: ${path.basename(args.cookies)}`);
  logInfo(`sqlite: ${args.db}`);
  logInfo(`destino do webhook: ${args.webhook || 'desabilitado'}`);

  const searchVariants = getSearchVariants(args);

  for (const target of group.targets) {
    await waitForAllowedWindow();
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
          resendAfterMs: args.resendAfterHours * 60 * 60 * 1000,
          waitForAllowedWindow,
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
        chatIds: group.chatIds,
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
      chatid: group.chatIds,
      requestedTarget: target,
      totalProducts: targetProducts.length,
      products: targetProducts,
      results: targetResults,
    };

    logInfo(`payload do webhook para ${target}: ${targetProducts.length} produto(s) somando ${searchVariants.length} variante(s)`);

    await waitForAllowedWindow();
    const webhookResult = await sendToWebhook(args.webhook, webhookPayload);

    if (webhookResult.skipped) {
      logWarn('webhook desabilitado, JSON nao enviado.');
      return {
        category: group.category,
        hasResults: allResults.length > 0,
        lastWebhookStatus,
        totalProductsSent,
        totalWebhooksSent,
      };
    }

    if (!webhookResult.ok) {
      logError(`falha no webhook: HTTP ${webhookResult.status}${webhookResult.responseText ? ` | resposta: ${webhookResult.responseText}` : ''}`);
      throw new Error(`Falha ao enviar para o webhook: HTTP ${webhookResult.status}`);
    }

    recordWebhookDelivery(db, {
      category: group.category,
      chatIds: group.chatIds,
      requestedTarget: target,
      webhookUrl: args.webhook,
      webhookStatus: webhookResult.status,
      totalProducts: targetProducts.length,
      totalResults: targetResults.length,
    });

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

  if (allResults.length === 0) {
    logWarn('nenhuma busca retornou resultado; nada foi processado.');
  } else {
    logInfo(`webhooks enviados com sucesso: ${totalWebhooksSent} target(s) | ultimo status HTTP ${lastWebhookStatus}`);
    logInfo(`produtos marcados no sqlite: ${totalProductsSent}`);
  }

  return {
    category: group.category,
    hasResults: allResults.length > 0,
    lastWebhookStatus,
    totalProductsSent,
    totalWebhooksSent,
  };
}

module.exports = {
  processTargetGroup,
};
