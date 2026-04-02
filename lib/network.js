'use strict';

const {
  DEFAULT_FETCH_RETRIES,
  LISTING_REQUEST_DELAY_MAX_MS,
  LISTING_REQUEST_DELAY_MIN_MS,
  PRODUCT_REQUEST_DELAY_MAX_MS,
  PRODUCT_REQUEST_DELAY_MIN_MS,
} = require('./constants');
const { buildCookieHeader } = require('./cookies');
const { logInfo, logWarn } = require('./logger');

let hasMadeNetworkRequest = false;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomIntInclusive(min, max) {
  const normalizedMin = Math.ceil(min);
  const normalizedMax = Math.floor(max);
  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

function getDelayRange(profile) {
  if (profile === 'product') {
    return {
      min: PRODUCT_REQUEST_DELAY_MIN_MS,
      max: PRODUCT_REQUEST_DELAY_MAX_MS,
    };
  }

  return {
    min: LISTING_REQUEST_DELAY_MIN_MS,
    max: LISTING_REQUEST_DELAY_MAX_MS,
  };
}

async function throttledFetch(url, options, label = 'requisicao', profile = 'listing') {
  if (hasMadeNetworkRequest) {
    const delayRange = getDelayRange(profile);
    const delayMs = randomIntInclusive(delayRange.min, delayRange.max);
    logInfo(`aguardando ${delayMs}ms antes da ${label}: ${url}`);
    await sleep(delayMs);
  }

  hasMadeNetworkRequest = true;
  return fetch(url, options);
}

function isRetryableStatus(status) {
  return status === 403 || status === 408 || status === 429 || status >= 500;
}

function extractHttpStatusFromError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const matchedStatus = message.match(/HTTP\s+(\d+)/i);
  return matchedStatus ? Number.parseInt(matchedStatus[1], 10) : null;
}

async function fetchHtml(url, cookies, options = {}) {
  const profile = options.profile || 'listing';
  const label = options.label || 'busca HTTP';
  let lastStatus = null;

  for (let attempt = 0; attempt <= DEFAULT_FETCH_RETRIES; attempt += 1) {
    const response = await throttledFetch(
      url,
      {
        redirect: 'follow',
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
          cookie: buildCookieHeader(url, cookies),
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        },
      },
      label,
      profile
    );

    if (response.ok) {
      return {
        html: await response.text(),
        finalUrl: response.url,
        status: response.status,
      };
    }

    lastStatus = response.status;
    if (attempt >= DEFAULT_FETCH_RETRIES || !isRetryableStatus(response.status)) {
      throw new Error(`Falha ao buscar ${url}: HTTP ${response.status}`);
    }

    logWarn(`falha temporaria ao buscar ${url}: HTTP ${response.status}; nova tentativa sera feita respeitando o delay aleatorio global`);
  }

  throw new Error(`Falha ao buscar ${url}: HTTP ${lastStatus || 'desconhecido'}`);
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
  const response = await throttledFetch(
    endpoint,
    {
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
    },
    'geracao de link afiliado',
    'product'
  );

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

module.exports = {
  createAffiliateLink,
  extractHttpStatusFromError,
  fetchHtml,
  sendToWebhook,
};
