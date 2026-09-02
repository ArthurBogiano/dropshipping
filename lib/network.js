'use strict';

const {
  DEFAULT_FETCH_RETRIES,
  LISTING_REQUEST_DELAY_MAX_MS,
  LISTING_REQUEST_DELAY_MIN_MS,
  PRODUCT_REQUEST_DELAY_MAX_MS,
  PRODUCT_REQUEST_DELAY_MIN_MS,
  REQUEST_TIMEOUT_MS,
} = require('./constants');
const { buildCookieHeader } = require('./cookies');
const { logInfo, logWarn } = require('./logger');

let hasMadeNetworkRequest = false;
let coordinatorPort = null;
let coordinatorMessageHandler = null;
let nextCoordinatorRequestId = 1;
const pendingCoordinatorRequests = new Map();

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

function setNetworkCoordinatorPort(port) {
  if (coordinatorPort === port) {
    return;
  }

  if (coordinatorPort && coordinatorMessageHandler) {
    coordinatorPort.off('message', coordinatorMessageHandler);
  }

  coordinatorPort = port || null;
  coordinatorMessageHandler = null;

  if (!coordinatorPort) {
    pendingCoordinatorRequests.clear();
    return;
  }

  coordinatorMessageHandler = (message) => {
    if (message?.type !== 'network_granted') {
      return;
    }

    const pending = pendingCoordinatorRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    pendingCoordinatorRequests.delete(message.requestId);
    pending.resolve(message.requestId);
  };

  coordinatorPort.on('message', coordinatorMessageHandler);
}

function acquireCoordinatorSlot({ url, label, profile }) {
  if (!coordinatorPort) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const requestId = nextCoordinatorRequestId++;
    pendingCoordinatorRequests.set(requestId, { resolve });
    coordinatorPort.postMessage({
      type: 'network_request',
      requestId,
      url,
      label,
      profile,
    });
  });
}

function releaseCoordinatorSlot(requestId) {
  if (!coordinatorPort || requestId == null) {
    return;
  }

  coordinatorPort.postMessage({
    type: 'network_release',
    requestId,
  });
}

async function throttledFetch(url, options, label = 'requisicao', profile = 'listing', applyDelay = true) {
  if (hasMadeNetworkRequest && applyDelay) {
    const delayRange = getDelayRange(profile);
    const delayMs = randomIntInclusive(delayRange.min, delayRange.max);
    logInfo(`aguardando ${delayMs}ms antes da ${label}: ${url}`);
    await sleep(delayMs);
  }

  const coordinatorRequestId = await acquireCoordinatorSlot({ url, label, profile });
  hasMadeNetworkRequest = true;

  try {
    return await fetch(url, options);
  } finally {
    releaseCoordinatorSlot(coordinatorRequestId);
  }
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
  const timeoutMs = Number(options.timeoutMs || REQUEST_TIMEOUT_MS);
  const applyDelay = options.applyDelay !== false;
  const retries = Number.isInteger(options.retries)
    ? Math.max(0, options.retries)
    : DEFAULT_FETCH_RETRIES;
  let lastStatus = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;

    try {
      response = await throttledFetch(
        url,
        {
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
            cookie: buildCookieHeader(url, cookies),
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
          },
        },
        label,
        profile,
        applyDelay
      );
    } catch (error) {
      const reason = error?.name === 'TimeoutError'
        ? `timeout de ${timeoutMs}ms`
        : (error instanceof Error ? error.message : String(error));

      if (attempt >= retries) {
        throw new Error(`Falha ao buscar ${url}: ${reason}`, { cause: error });
      }

      logWarn(`falha temporaria ao buscar ${url}: ${reason}; tentando novamente`);
      continue;
    }

    if (response.ok) {
      const finalPath = new URL(response.url).pathname;
      const isAccessChallenge = (
        /\/captcha(?:\/|$)/i.test(finalPath) ||
        /\/account-verification(?:\/|$)/i.test(finalPath) ||
        /\/login(?:\/|$)/i.test(finalPath)
      );

      if (isAccessChallenge) {
        throw new Error(`Falha ao buscar ${url}: HTTP 403 (desafio de acesso)`);
      }

      return {
        html: await response.text(),
        finalUrl: response.url,
        status: response.status,
      };
    }

    lastStatus = response.status;
    if (attempt >= retries || !isRetryableStatus(response.status)) {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

async function sendToWebhook(webhookUrl, payload, options = {}) {
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
    signal: AbortSignal.timeout(Number(options.timeoutMs || REQUEST_TIMEOUT_MS)),
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
  setNetworkCoordinatorPort,
  sendToWebhook,
};
