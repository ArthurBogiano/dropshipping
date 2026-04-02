'use strict';

const {
  MAX_CONSECUTIVE_LISTING_FAILURES,
  PROMOTION_FILTERS,
  SEARCH_PAGE_SIZE,
} = require('./constants');
const { getCookieValue } = require('./cookies');
const { logError, logInfo, logWarn } = require('./logger');
const {
  createAffiliateLink,
  extractHttpStatusFromError,
  fetchHtml,
} = require('./network');
const {
  buildProductPayload,
  decodeHtmlEntities,
  extractCanonicalUrl,
  extractItemId,
} = require('./product-parser');
const {
  buildDedupeKey,
  getSentProduct,
  touchSeenProduct,
} = require('./storage');

function isLikelyListingUrl(target) {
  try {
    const url = new URL(target);
    return (
      /lista\.mercadolivre\.com\.br/i.test(url.hostname) ||
      /\/jm\/search/i.test(url.pathname) ||
      /\/ofertas/i.test(url.pathname) ||
      /^\/c\/[^/]+\/?$/i.test(url.pathname)
    );
  } catch (_) {
    return false;
  }
}

function isCategoryLandingUrl(target) {
  try {
    const url = new URL(target);
    return /^\/c\/[^/]+\/?$/i.test(url.pathname);
  } catch (_) {
    return false;
  }
}

function extractProductUrlsFromListing(html, limit) {
  const unique = new Set();

  for (const match of html.matchAll(/https:\/\/www\.mercadolivre\.com\.br\/[^"'<> ]+\/(?:p|up)\/[A-Z0-9]+[^"'<> ]*/gi)) {
    unique.add(decodeHtmlEntities(match[0]));
    if (unique.size >= limit) {
      break;
    }
  }

  return [...unique];
}

function buildListingPageUrl(target, page) {
  const url = new URL(target);

  if (page <= 1) {
    return url.toString();
  }

  if (/\/ofertas/i.test(url.pathname)) {
    url.searchParams.set('page', String(page));
    return url.toString();
  }

  if (/lista\.mercadolivre\.com\.br/i.test(url.hostname) || /\/jm\/search/i.test(url.pathname)) {
    url.searchParams.set('_Desde', String(1 + (page - 1) * SEARCH_PAGE_SIZE));
    return url.toString();
  }

  return url.toString();
}

function applyListingSearchParams(target, options = {}) {
  if (!options.promotionType || !isLikelyListingUrl(target)) {
    return target;
  }

  const url = new URL(target);
  const promotion = PROMOTION_FILTERS[options.promotionType];

  if (!promotion) {
    return target;
  }

  if (/lista\.mercadolivre\.com\.br/i.test(url.hostname)) {
    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (!cleanPath.includes(`promotion*type_${options.promotionType}`)) {
      if (/_NoIndex_True(?:_|$)/.test(cleanPath)) {
        url.pathname = cleanPath.replace(/_NoIndex_True(?:_[^/]+)?$/i, `/${promotion.pathSegment}`.replace('//', '/'));
      } else {
        url.pathname = `${cleanPath}/${promotion.pathSegment}`;
      }
    }
    url.searchParams.set('original_category_landing', 'true');
    url.hash = promotion.hash;
    return url.toString();
  }

  if (/\/ofertas/i.test(url.pathname)) {
    url.searchParams.set('promotion_type', options.promotionType);
    return url.toString();
  }

  if (/\/jm\/search/i.test(url.pathname)) {
    url.searchParams.set('promotion_type', options.promotionType);
    return url.toString();
  }

  return url.toString();
}

async function collectProductsFromTarget(target, cookies, limit, options = {}) {
  const affiliateTag = options.affiliateTag || (getCookieValue(cookies, 'orgnickp') || '').trim().toLowerCase() || null;
  const db = options.db;
  const maxPages = Math.max(1, Number(options.maxPages || 1));
  const listingMaxPages = isCategoryLandingUrl(target) ? 1 : maxPages;

  if (isLikelyListingUrl(target)) {
    const products = [];
    const pageStats = [];
    const seenInRun = new Set();
    let consecutiveListingFailures = 0;
    let skippedDuplicates = 0;

    for (let pageNumber = 1; pageNumber <= listingMaxPages && products.length < limit; pageNumber += 1) {
      const pageUrl = buildListingPageUrl(target, pageNumber);
      logInfo(`varrendo pagina ${pageNumber}/${listingMaxPages}: ${pageUrl}`);
      let listing;

      try {
        listing = await fetchHtml(pageUrl, cookies, {
          profile: 'listing',
          label: 'busca de listagem',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = extractHttpStatusFromError(error);
        consecutiveListingFailures += 1;
        logWarn(`falha ao buscar a listagem ${pageUrl}; pagina ignorada: ${message}`);
        pageStats.push({ page: pageNumber, pageUrl, found: 0, newProducts: 0, skippedDuplicates: 0, error: message, status });

        if (status === 403 && pageNumber === 1) {
          logWarn(`listagem bloqueada ja na primeira pagina; interrompendo a variante atual para ${target}`);
          break;
        }

        if (consecutiveListingFailures >= MAX_CONSECUTIVE_LISTING_FAILURES) {
          logWarn(`atingido o limite de ${MAX_CONSECUTIVE_LISTING_FAILURES} falhas consecutivas na listagem; interrompendo a paginacao de ${target}`);
          break;
        }

        continue;
      }

      consecutiveListingFailures = 0;

      const productUrls = extractProductUrlsFromListing(listing.html, Math.max(limit * 4, 24));

      if (productUrls.length === 0) {
        pageStats.push({ page: pageNumber, pageUrl, found: 0, newProducts: 0, skippedDuplicates: 0 });
        continue;
      }

      let pageNewProducts = 0;
      let pageSkippedDuplicates = 0;

      for (const productUrl of productUrls) {
        if (products.length >= limit) {
          break;
        }

        const quickKey = extractItemId(productUrl) || productUrl;
        if (seenInRun.has(quickKey)) {
          pageSkippedDuplicates += 1;
          skippedDuplicates += 1;
          continue;
        }

        let page;
        let canonicalUrl;
        let payloadBase;

        try {
          page = await fetchHtml(productUrl, cookies, {
            profile: 'product',
            label: 'busca de produto',
          });
          canonicalUrl = extractCanonicalUrl(page.html) || page.finalUrl || productUrl;
          payloadBase = buildProductPayload({
            requestedUrl: productUrl,
            finalUrl: page.finalUrl,
            html: page.html,
            affiliate: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logWarn(`falha ao buscar o produto ${productUrl}; item ignorado: ${message}`);
          continue;
        }

        const dedupeKey = buildDedupeKey(payloadBase);
        const alreadySent = db ? getSentProduct(db, dedupeKey) : null;

        if (alreadySent) {
          seenInRun.add(dedupeKey);
          pageSkippedDuplicates += 1;
          skippedDuplicates += 1;
          touchSeenProduct(db, { dedupeKey });
          continue;
        }

        const affiliate = options.affiliate
          ? await createAffiliateLink({
              url: canonicalUrl,
              referer: productUrl,
              html: page.html,
              cookies,
              affiliateTag,
            })
          : null;

        if (affiliate && !affiliate.ok) {
          logWarn(`falha ao gerar link afiliado para ${canonicalUrl}: ${affiliate.error || 'erro desconhecido'}`);
        }

        payloadBase.affiliate = affiliate;
        products.push(payloadBase);
        seenInRun.add(dedupeKey);
        pageNewProducts += 1;
      }

      pageStats.push({
        page: pageNumber,
        pageUrl,
        found: productUrls.length,
        newProducts: pageNewProducts,
        skippedDuplicates: pageSkippedDuplicates,
      });

      if (pageNewProducts === 0) {
        logWarn(`pagina ${pageNumber} sem produtos novos, tentando proxima pagina`);
      }
    }

    return {
      target,
      type: 'listing',
      discoveredProducts: products.length,
      affiliateTag,
      skippedDuplicates,
      pagesVisited: pageStats.length,
      listingMaxPages,
      pageStats,
      products,
    };
  }

  const page = await fetchHtml(target, cookies, {
    profile: 'product',
    label: 'busca de produto',
  });
  const canonicalUrl = extractCanonicalUrl(page.html) || page.finalUrl || target;
  const payloadBase = buildProductPayload({ requestedUrl: target, finalUrl: page.finalUrl, html: page.html, affiliate: null });
  const dedupeKey = buildDedupeKey(payloadBase);
  const alreadySent = db ? getSentProduct(db, dedupeKey) : null;

  if (alreadySent) {
    touchSeenProduct(db, { dedupeKey });
    return {
      target,
      type: 'product',
      discoveredProducts: 0,
      affiliateTag,
      skippedDuplicates: 1,
      products: [],
    };
  }

  const affiliate = options.affiliate
    ? await createAffiliateLink({
        url: canonicalUrl,
        referer: target,
        html: page.html,
        cookies,
        affiliateTag,
      })
    : null;

  if (affiliate && !affiliate.ok) {
    logError(`falha ao gerar link afiliado para ${canonicalUrl}: ${affiliate.error || 'erro desconhecido'}`);
  }

  payloadBase.affiliate = affiliate;

  return {
    target,
    type: 'product',
    discoveredProducts: 1,
    affiliateTag,
    skippedDuplicates: 0,
    products: [payloadBase],
  };
}

module.exports = {
  applyListingSearchParams,
  collectProductsFromTarget,
};
