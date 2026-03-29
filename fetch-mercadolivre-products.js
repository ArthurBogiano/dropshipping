#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_WEBHOOK_URL = 'https://example.com/webhook';
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'mercadolivre-products.sqlite');
const DEFAULT_MAX_PAGES = 5;
const SEARCH_PAGE_SIZE = 48;
const PROMOTION_FILTERS = {
  deal_of_the_day: {
    pathSegment: '_NoIndex_True_promotion*type_deal*of*the*day',
    hash: 'applied_filter_id%3Dpromotion_type%26applied_filter_name%3DTipo+de+promo%C3%A7%C3%A3o%26applied_filter_order%3D7%26applied_value_id%3Ddeal_of_the_day%26applied_value_name%3DOferta+do+dia%26applied_value_order%3D1',
  },
  lightning: {
    pathSegment: '_NoIndex_True_promotion*type_lightning',
    hash: 'applied_filter_id%3Dpromotion_type%26applied_filter_name%3DTipo+de+promo%C3%A7%C3%A3o%26applied_filter_order%3D7%26applied_value_id%3Dlightning%26applied_value_name%3DOferta+rel%C3%A2mpago%26applied_value_order%3D2',
  },
};

function parseArgs(argv) {
  const args = {
    cookies: path.resolve(process.cwd(), 'cookies.json'),
    db: DEFAULT_DB_PATH,
    limit: 5,
    maxPages: DEFAULT_MAX_PAGES,
    pretty: true,
    affiliate: true,
    affiliateTag: null,
    promotionTypes: [],
    targetsFile: null,
    help: false,
    webhook: DEFAULT_WEBHOOK_URL,
    targets: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--cookies') {
      args.cookies = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--limit') {
      args.limit = Number.parseInt(argv[++i], 10) || args.limit;
      continue;
    }

    if (arg === '--db') {
      args.db = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--targets-file') {
      args.targetsFile = path.resolve(process.cwd(), argv[++i]);
      continue;
    }

    if (arg === '--max-pages') {
      args.maxPages = Number.parseInt(argv[++i], 10) || args.maxPages;
      continue;
    }

    if (arg === '--compact') {
      args.pretty = false;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }

    if (arg === '--affiliate-tag') {
      args.affiliateTag = argv[++i] || null;
      continue;
    }

    if (arg === '--deal-of-day') {
      args.promotionTypes.push('deal_of_the_day');
      continue;
    }

    if (arg === '--lightning') {
      args.promotionTypes.push('lightning');
      continue;
    }

    if (arg === '--webhook') {
      args.webhook = argv[++i] || DEFAULT_WEBHOOK_URL;
      continue;
    }

    if (arg === '--no-webhook') {
      args.webhook = null;
      continue;
    }

    if (arg === '--no-affiliate') {
      args.affiliate = false;
      continue;
    }

    args.targets.push(arg);
  }

  return args;
}

function getHelpText() {
  return [
    'Uso:',
    '  node fetch-mercadolivre-products.js <url-do-produto-ou-listagem> [outras-urls] [opcoes]',
    '',
    'Opcoes:',
    '  -h, --help                 Exibe esta ajuda',
    '  --cookies <arquivo>       Caminho do arquivo de cookies JSON',
    '  --db <arquivo>            Caminho do banco SQLite local',
    '  --targets-file <arquivo>  Arquivo TXT com uma URL de categoria/listagem por linha',
    '  --limit <n>               Limite de produtos extraidos de uma listagem',
    '  --max-pages <n>           Maximo de paginas extras buscadas em listagens/ofertas',
    '  --compact                 Exibe o JSON sem identacao',
    '  --affiliate-tag <tag>     Forca a tag de afiliado usada na API',
    '  --deal-of-day             Inclui buscas com filtro de Oferta do dia',
    '  --lightning               Inclui buscas com filtro de Oferta relampago',
    '  --webhook <url>           Envia o JSON final para um webhook',
    '  --no-webhook              Nao envia o JSON para webhook',
    '  --no-affiliate            Nao gera link meli.la',
    '',
    'Comportamento:',
    '  - URL de produto: extrai os dados do produto e tenta gerar o link afiliado meli.la',
    '  - URL de listagem: descobre produtos da pagina e processa cada um ate o limite definido',
    '',
    'Exemplos:',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678"',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/notebook" --limit 3',
    '  node fetch-mercadolivre-products.js --targets-file categorias.txt --limit 5',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --deal-of-day --limit 10',
    '  node fetch-mercadolivre-products.js "https://lista.mercadolivre.com.br/saude/suplementos-alimentares" --lightning --limit 10',
    '  node fetch-mercadolivre-products.js --targets-file categorias.txt --deal-of-day --lightning --limit 5',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/ofertas?category=MLB264586" --limit 10 --max-pages 4',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --affiliate-tag sua_tag',
    '  node fetch-mercadolivre-products.js "https://www.mercadolivre.com.br/p/MLB12345678" --no-affiliate --compact',
    `  webhook padrao: ${DEFAULT_WEBHOOK_URL}`,
  ].join('\n');
}

function readCookies(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`O arquivo de cookies precisa ser um array JSON: ${filePath}`);
  }

  return parsed;
}

function readTargetsFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const unique = new Set();

  for (const line of raw.split(/\r?\n/u)) {
    const target = line.trim();
    if (!target || target.startsWith('#')) {
      continue;
    }
    unique.add(target);
  }

  return [...unique];
}

function getSearchVariants(args) {
  const variants = [];

  const orderedPromotionTypes = ['lightning', 'deal_of_the_day'];

  for (const promotionType of orderedPromotionTypes) {
    if (!args.promotionTypes.includes(promotionType)) {
      continue;
    }
    if (PROMOTION_FILTERS[promotionType]) {
      variants.push({ label: promotionType, promotionType });
    }
  }

  variants.push({ label: 'padrao', promotionType: null });
  return variants;
}

function openDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_products (
      dedupe_key TEXT PRIMARY KEY,
      item_id TEXT,
      canonical_url TEXT,
      title TEXT,
      source_target TEXT,
      webhook_url TEXT,
      first_sent_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sent_products_item_id ON sent_products(item_id);
  `);
  return db;
}

function buildDedupeKey({ itemId, canonicalUrl, requestedUrl }) {
  return itemId || canonicalUrl || requestedUrl;
}

function getSentProduct(db, dedupeKey) {
  if (!dedupeKey) {
    return null;
  }

  const statement = db.prepare('SELECT * FROM sent_products WHERE dedupe_key = ?');
  return statement.get(dedupeKey) || null;
}

function touchSeenProduct(db, { dedupeKey }) {
  if (!dedupeKey) {
    return;
  }

  const statement = db.prepare('UPDATE sent_products SET last_seen_at = ? WHERE dedupe_key = ?');
  statement.run(new Date().toISOString(), dedupeKey);
}

function markProductSent(db, product, sourceTarget, webhookUrl) {
  const dedupeKey = buildDedupeKey(product);
  if (!dedupeKey) {
    return;
  }

  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO sent_products (
      dedupe_key, item_id, canonical_url, title, source_target, webhook_url, first_sent_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      item_id = excluded.item_id,
      canonical_url = excluded.canonical_url,
      title = excluded.title,
      source_target = excluded.source_target,
      webhook_url = excluded.webhook_url,
      last_seen_at = excluded.last_seen_at
  `);

  statement.run(
    dedupeKey,
    product.itemId || null,
    product.canonicalUrl || null,
    product.title || null,
    sourceTarget || null,
    webhookUrl || null,
    now,
    now
  );
}

function getCookieValue(cookies, name) {
  const found = cookies.find((cookie) => cookie && cookie.name === name && !isCookieExpired(cookie));
  return found ? found.value : null;
}

function isCookieExpired(cookie) {
  if (!cookie || cookie.session) {
    return false;
  }

  if (typeof cookie.expirationDate !== 'number') {
    return false;
  }

  return cookie.expirationDate * 1000 <= Date.now();
}

function domainMatches(hostname, cookie) {
  const rawDomain = String(cookie.domain || '').trim().toLowerCase();
  if (!rawDomain) {
    return false;
  }

  const cookieDomain = rawDomain.replace(/^\./, '');
  const host = hostname.toLowerCase();

  if (cookie.hostOnly) {
    return host === cookieDomain;
  }

  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function pathMatches(pathname, cookiePath) {
  const expectedPath = cookiePath || '/';
  return pathname.startsWith(expectedPath);
}

function buildCookieHeader(targetUrl, cookies) {
  const url = new URL(targetUrl);

  return cookies
    .filter((cookie) => {
      if (!cookie || typeof cookie.name !== 'string') {
        return false;
      }

      if (isCookieExpired(cookie)) {
        return false;
      }

      if (cookie.secure && url.protocol !== 'https:') {
        return false;
      }

      return domainMatches(url.hostname, cookie) && pathMatches(url.pathname, cookie.path);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function fetchHtml(url, cookies) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      cookie: buildCookieHeader(url, cookies),
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar ${url}: HTTP ${response.status}`);
  }

  return {
    html: await response.text(),
    finalUrl: response.url,
    status: response.status,
  };
}

function extractCsrfToken(html) {
  return (
    (html.match(/<meta name="csrf-token" content="([^"]+)"/i) || [])[1] ||
    (html.match(/name="_csrf"\s+value="([^"]+)"/i) || [])[1] ||
    null
  );
}

async function createAffiliateLink({ url, referer, html, cookies, affiliateTag }) {
  const csrfToken = extractCsrfToken(html);

  if (!affiliateTag) {
    return {
      ok: false,
      error: 'Nao foi possivel determinar a tag de afiliado.',
    };
  }

  if (!csrfToken) {
    return {
      ok: false,
      error: 'Nao foi possivel localizar o token CSRF da pagina.',
    };
  }

  const endpoint = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/stripe/user/links';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      cookie: buildCookieHeader(endpoint, cookies),
      origin: 'https://www.mercadolivre.com.br',
      referer: referer || url,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({
      url,
      tag: affiliateTag,
    }),
  });

  const rawText = await response.text();
  let data = null;

  try {
    data = JSON.parse(rawText);
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.message || rawText || `HTTP ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    tag: data?.tag || affiliateTag,
    shortUrl: data?.short_url || null,
    longUrl: data?.long_url || null,
    regex: data?.regex || null,
    text: data?.text || null,
    listUrl: data?.list_url || null,
    deepLinkListUrl: data?.deeplink_list_url || null,
    typeUrl: data?.type_url || null,
    created: data?.created ?? null,
    generatedDate: data?.generated_date || null,
    id: data?.id || null,
    raw: data,
  };
}

async function sendToWebhook(webhookUrl, payload) {
  if (!webhookUrl) {
    return {
      ok: false,
      skipped: true,
      status: null,
      error: 'Webhook desabilitado.',
    };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  return {
    ok: response.ok,
    skipped: false,
    status: response.status,
    responseText: text,
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

function logInfo(message) {
  console.log(`[info] ${message}`);
}

function logWarn(message) {
  console.log(`[warn] ${message}`);
}

function logError(message) {
  console.error(`[error] ${message}`);
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed = [];

  for (const [, rawJson] of blocks) {
    try {
      parsed.push(JSON.parse(rawJson));
    } catch (_) {
      continue;
    }
  }

  return parsed;
}

function findProductSchema(jsonLd) {
  return jsonLd.find((entry) => entry && entry['@type'] === 'Product') || null;
}

function findBreadcrumbSchema(jsonLd) {
  return jsonLd.find((entry) => entry && entry['@type'] === 'BreadcrumbList') || null;
}

function extractCanonicalUrl(html) {
  const match = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function extractItemId(text) {
  const match = String(text || '').match(/MLB[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : null;
}

function extractHighlightedFeatures(html) {
  return [...html.matchAll(/<li[^>]*class="[^"]*ui-vpp-highlighted-specs__features-list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);
}

function extractSpecifications(html) {
  const blocks = [...html.matchAll(/<div class="ui-vpp-striped-specs__table">([\s\S]*?)<\/table><\/div>/gi)];
  const sections = [];

  for (const [, blockHtml] of blocks) {
    const titleMatch = blockHtml.match(/<h3[^>]*class="[^"]*ui-vpp-striped-specs__header[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const title = stripTags(titleMatch ? titleMatch[1] : '');
    const rows = [...blockHtml.matchAll(/<tr[^>]*class="[^"]*ui-vpp-striped-specs__row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)];
    const values = {};

    for (const [, rowHtml] of rows) {
      const keyMatch = rowHtml.match(/<th[\s\S]*?<div[^>]*class="andes-table__header__container"[^>]*>([\s\S]*?)<\/div>[\s\S]*?<\/th>/i);
      const valueMatch = rowHtml.match(/<td[\s\S]*?<span[^>]*class="andes-table__column--value"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/td>/i);
      const key = stripTags(keyMatch ? keyMatch[1] : '');
      const value = stripTags(valueMatch ? valueMatch[1] : '');

      if (key && value) {
        values[key] = value;
      }
    }

    if (title || Object.keys(values).length > 0) {
      sections.push({
        section: title || `section_${sections.length + 1}`,
        values,
      });
    }
  }

  return sections;
}

function extractSeller(html) {
  const name =
    stripTags((html.match(/ui-seller-data-header__title[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) ||
    stripTags((html.match(/ui-pdp-seller__link[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) ||
    null;

  const subtitle = stripTags((html.match(/ui-seller-data-header__subtitle[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const followers = stripTags((html.match(/ui-seller-data-header__followers[\s\S]*?<span[^>]*><span>([\s\S]*?)<\/span><\/span>/i) || [])[1]) || null;
  const products = stripTags((html.match(/ui-seller-data-header__products[\s\S]*?<span[^>]*><span>([\s\S]*?)<\/span><\/span>/i) || [])[1]) || null;
  const reputationTitle = stripTags((html.match(/ui-seller-data-status__title[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const reputationSubtitle = stripTags((html.match(/ui-seller-data-status__subtitle[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const reputationInfo = [...html.matchAll(/ui-seller-data-status__info-title[^>]*><span>([\s\S]*?)<\/span>[\s\S]*?ui-seller-data-status__info-subtitle[^>]*><span>([\s\S]*?)<\/span>/gi)]
    .map((match) => ({
      title: stripTags(match[1]),
      subtitle: stripTags(match[2]),
    }))
    .filter((entry) => entry.title || entry.subtitle);

  if (!name && !subtitle && !followers && !products) {
    return null;
  }

  return {
    name,
    subtitle,
    officialStore: /loja oficial/i.test(`${subtitle || ''} ${html}`),
    followers,
    products,
    reputation: {
      title: reputationTitle,
      subtitle: reputationSubtitle,
      info: reputationInfo,
    },
  };
}

function extractStock(html) {
  const statusText = stripTags((html.match(/ui-pdp-stock-information__title[^>]*><span>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const selectedText = stripTags((html.match(/ui-pdp-buybox__quantity__selected[^>]*>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const availableText = stripTags((html.match(/ui-pdp-buybox__quantity__available[^>]*>([\s\S]*?)<\/span>/i) || [])[1]) || null;

  let availableQuantity = null;
  if (availableText) {
    const quantityMatch = availableText.match(/(\d+)/);
    if (quantityMatch) {
      availableQuantity = Number.parseInt(quantityMatch[1], 10);
    } else if (/\+50/i.test(availableText)) {
      availableQuantity = 50;
    }
  }

  if (!statusText && !selectedText && !availableText) {
    return null;
  }

  return {
    statusText,
    selectedText,
    availableText,
    availableQuantityEstimate: availableQuantity,
  };
}

function extractInstallments(html) {
  const text = stripTags((html.match(/ui-pdp-price__second-line__text[^>]*>([\s\S]*?)<\/span>/i) || [])[1]) || null;
  const label = stripTags((html.match(/ui-pdp-price__second-line__label[^>]*>([\s\S]*?)<\/span>/i) || [])[1]) || null;

  if (!text && !label) {
    return null;
  }

  return { text, label };
}

function parseMoneyBlockAmount(blockHtml) {
  if (!blockHtml) {
    return null;
  }

  const fraction = stripTags((blockHtml.match(/data-andes-money-amount-fraction="true">([\s\S]*?)<\/span>/i) || [])[1] || '');
  const cents = stripTags((blockHtml.match(/data-andes-money-amount-cents="true">([\s\S]*?)<\/span>/i) || [])[1] || '');

  if (!fraction) {
    return null;
  }

  const normalizedFraction = fraction.replace(/\./g, '').replace(/\s+/g, '');
  const normalizedCents = cents ? cents.replace(/\D/g, '').padStart(2, '0').slice(0, 2) : '00';
  const amount = Number.parseFloat(`${normalizedFraction}.${normalizedCents}`);

  return Number.isFinite(amount) ? amount : null;
}

function extractOriginalPrice(html) {
  const previousBlock =
    (html.match(/<s[^>]*class="[^"]*andes-money-amount--previous[^"]*"[^>]*>([\s\S]*?)<\/s>/i) || [])[0] ||
    (html.match(/<span[^>]*class="[^"]*ui-pdp-price__original-value[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || [])[0] ||
    null;

  return parseMoneyBlockAmount(previousBlock);
}

function normalizeReviews(productSchema) {
  if (!Array.isArray(productSchema.review)) {
    return [];
  }

  return productSchema.review.slice(0, 5).map((review) => ({
    author: review?.author?.name || null,
    rating: Number(review?.reviewRating?.ratingValue || 0) || null,
    text: review?.reviewBody || null,
  }));
}

function normalizeBreadcrumbs(breadcrumbSchema) {
  if (!breadcrumbSchema || !Array.isArray(breadcrumbSchema.itemListElement)) {
    return [];
  }

  return breadcrumbSchema.itemListElement
    .map((entry) => entry?.item?.name || null)
    .filter(Boolean);
}

function buildProductPayload({ requestedUrl, finalUrl, html, affiliate = null }) {
  const jsonLd = extractJsonLd(html);
  const productSchema = findProductSchema(jsonLd);

  if (!productSchema) {
    throw new Error('Nao foi possivel localizar o bloco JSON-LD do produto.');
  }

  const breadcrumbSchema = findBreadcrumbSchema(jsonLd);
  const canonicalUrl = extractCanonicalUrl(html) || finalUrl;
  const itemId = extractItemId(productSchema.productID || productSchema.sku || canonicalUrl || requestedUrl);
  const reviews = normalizeReviews(productSchema);
  const breadcrumbs = normalizeBreadcrumbs(breadcrumbSchema);
  const seller = extractSeller(html);
  const stock = extractStock(html);
  const specifications = extractSpecifications(html);
  const offers = productSchema.offers || {};
  const shipping = offers.shippingDetails || {};
  const shippingRate = shipping.shippingRate || {};
  const deliveryTime = shipping.deliveryTime || {};
  const handlingTime = deliveryTime.handlingTime || {};
  const transitTime = deliveryTime.transitTime || {};

  return {
    requestedUrl,
    finalUrl,
    canonicalUrl,
    fetchedAt: new Date().toISOString(),
    itemId,
    title: productSchema.name || null,
    description: productSchema.description || null,
    condition: productSchema.itemCondition ? String(productSchema.itemCondition).split('/').pop() : null,
    brand: productSchema.brand?.name || productSchema.brand || null,
    sku: productSchema.sku || null,
    productId: productSchema.productID || null,
    breadcrumbs,
    categoryPath: breadcrumbs.join(' > ') || null,
    price: {
      amount: Number(offers.price || 0) || null,
      originalAmount: extractOriginalPrice(html),
      currency: offers.priceCurrency || null,
      availability: offers.availability ? String(offers.availability).split('/').pop() : null,
      validUntil: offers.priceValidUntil || null,
      installments: extractInstallments(html),
      shipping: {
        cost: Number(shippingRate.value || 0) || 0,
        currency: shippingRate.currency || offers.priceCurrency || null,
        originRegion: shipping.shippingOrigin?.addressRegion || null,
        destinationRegion: shipping.shippingDestination?.addressRegion || null,
        destinationPostalCode: shipping.shippingDestination?.postalCode || null,
        handlingDays: {
          min: handlingTime.minValue ?? null,
          max: handlingTime.maxValue ?? null,
        },
        transitDays: {
          min: transitTime.minValue ?? null,
          max: transitTime.maxValue ?? null,
        },
      },
    },
    images: Array.isArray(productSchema.image)
      ? productSchema.image
      : productSchema.image
        ? [productSchema.image]
        : [],
    highlightedFeatures: extractHighlightedFeatures(html),
    specifications,
    seller,
    affiliate,
    stock,
    rating: {
      score: Number(productSchema.aggregateRating?.ratingValue || 0) || null,
      reviewCount: Number(productSchema.aggregateRating?.reviewCount || 0) || null,
    },
    reviewsPreview: reviews,
  };
}

function isLikelyListingUrl(target) {
  try {
    const url = new URL(target);
    return /lista\.mercadolivre\.com\.br/i.test(url.hostname) || /\/jm\/search/i.test(url.pathname) || /\/ofertas/i.test(url.pathname);
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

  if (isLikelyListingUrl(target)) {
    const products = [];
    const pageStats = [];
    const seenInRun = new Set();
    let skippedDuplicates = 0;

    for (let pageNumber = 1; pageNumber <= maxPages && products.length < limit; pageNumber += 1) {
      const pageUrl = buildListingPageUrl(target, pageNumber);
      logInfo(`varrendo pagina ${pageNumber}/${maxPages}: ${pageUrl}`);
      const listing = await fetchHtml(pageUrl, cookies);
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

        const page = await fetchHtml(productUrl, cookies);
        const canonicalUrl = extractCanonicalUrl(page.html) || page.finalUrl || productUrl;
        const payloadBase = buildProductPayload({
          requestedUrl: productUrl,
          finalUrl: page.finalUrl,
          html: page.html,
          affiliate: null,
        });

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
          logError(`falha ao gerar link afiliado para ${canonicalUrl}: ${affiliate.error || 'erro desconhecido'}`);
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
      pageStats,
      products,
    };
  }

  const page = await fetchHtml(target, cookies);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(getHelpText());
    return;
  }

  if (args.targetsFile) {
    const fileTargets = readTargetsFile(args.targetsFile);
    args.targets.push(...fileTargets);
  }

  args.targets = [...new Set(args.targets)];
  args.promotionTypes = [...new Set(args.promotionTypes)];

  if (args.targets.length === 0) {
    throw new Error('Uso: node fetch-mercadolivre-products.js <url-do-produto-ou-listagem> [outras-urls] [--targets-file categorias.txt] [--limit 5] [--cookies cookies.json] [--affiliate-tag sua_tag] [--deal-of-day|--lightning] [--no-affiliate]');
  }

  const cookies = readCookies(args.cookies);
  const db = openDatabase(args.db);
  const results = [];

  logInfo(`cookies carregados: ${path.basename(args.cookies)}`);
  logInfo(`sqlite: ${args.db}`);
  if (args.targetsFile) {
    logInfo(`arquivo de categorias: ${args.targetsFile} (${args.targets.length} URL(s))`);
  }
  if (args.promotionTypes.length > 0) {
    logInfo(`filtros promocionais ativos: ${args.promotionTypes.join(', ')}`);
  }
  logInfo(`destino do webhook: ${args.webhook || 'desabilitado'}`);

  const searchVariants = getSearchVariants(args);

  for (const target of args.targets) {
    const seenTargets = new Set();
    let remainingLimit = args.limit;

    for (const variant of searchVariants) {
      if (remainingLimit <= 0) {
        logInfo(`limite total atingido para ${target}: ${args.limit} produto(s)`);
        break;
      }

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
        result = await collectProductsFromTarget(effectiveTarget, cookies, remainingLimit, {
          db,
          affiliate: args.affiliate,
          affiliateTag: args.affiliateTag,
          maxPages: args.maxPages,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logError(`falha ao processar ${target} (${variant.label}): ${message}`);
        throw error;
      }

      results.push({
        ...result,
        requestedTarget: target,
        effectiveTarget,
        searchVariant: variant.label,
      });

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

      remainingLimit -= result.products.length;
    }
  }

  const aggregatedProducts = results.flatMap((result) =>
    result.products.map((product) => ({
      ...product,
      sourceRequestedTarget: result.requestedTarget,
      sourceEffectiveTarget: result.effectiveTarget,
      sourceSearchVariant: result.searchVariant,
    }))
  );

  const totalNewProducts = aggregatedProducts.length;
  if (totalNewProducts === 0) {
    logWarn('nenhum produto novo encontrado; nada sera enviado ao webhook.');
    return;
  }

  const output = {
    ok: true,
    cookiesFile: args.cookies,
    dbFile: args.db,
    generatedAt: new Date().toISOString(),
    totalProducts: totalNewProducts,
    products: aggregatedProducts,
    results,
  };

  logInfo(`payload final do webhook: ${totalNewProducts} produto(s) em lista unica`);

  const webhookResult = await sendToWebhook(args.webhook, output);

  if (webhookResult.skipped) {
    logWarn('webhook desabilitado, JSON nao enviado.');
    return;
  }

  if (!webhookResult.ok) {
    logError(`falha no webhook: HTTP ${webhookResult.status}${webhookResult.responseText ? ` | resposta: ${webhookResult.responseText}` : ''}`);
    throw new Error(`Falha ao enviar para o webhook: HTTP ${webhookResult.status}`);
  }

  for (const result of results) {
    for (const product of result.products) {
      markProductSent(db, product, result.target, args.webhook);
    }
  }

  logInfo(`webhook enviado com sucesso: HTTP ${webhookResult.status}`);
  logInfo(`produtos marcados no sqlite: ${totalNewProducts}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
