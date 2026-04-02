'use strict';

const path = require('node:path');

const DEFAULT_WEBHOOK_URL = 'https://example.com/webhook';
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'mercadolivre-products.sqlite');
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_FETCH_RETRIES = 2;
const DEFAULT_LOOP_DELAY_MS = 60 * 1000;
const MAX_CONSECUTIVE_LISTING_FAILURES = 2;
const LISTING_REQUEST_DELAY_MIN_MS = 3 * 60 * 1000;
const LISTING_REQUEST_DELAY_MAX_MS = 5 * 60 * 1000;
const PRODUCT_REQUEST_DELAY_MIN_MS = 5 * 1000;
const PRODUCT_REQUEST_DELAY_MAX_MS = 10 * 1000;
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

module.exports = {
  DEFAULT_DB_PATH,
  DEFAULT_FETCH_RETRIES,
  DEFAULT_LOOP_DELAY_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_WEBHOOK_URL,
  LISTING_REQUEST_DELAY_MAX_MS,
  LISTING_REQUEST_DELAY_MIN_MS,
  MAX_CONSECUTIVE_LISTING_FAILURES,
  PRODUCT_REQUEST_DELAY_MAX_MS,
  PRODUCT_REQUEST_DELAY_MIN_MS,
  PROMOTION_FILTERS,
  SEARCH_PAGE_SIZE,
};
