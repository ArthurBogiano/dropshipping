'use strict';

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

module.exports = {
  buildProductPayload,
  decodeHtmlEntities,
  extractCanonicalUrl,
  extractItemId,
};
