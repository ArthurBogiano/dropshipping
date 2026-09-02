'use strict';

const path = require('node:path');
const {
  readBoolean,
  readInteger,
  readNumber,
  readString,
} = require('./config');

const DEFAULT_COOKIES_PATH = path.resolve(process.cwd(), readString('COOKIES_FILE', 'cookies.json'));
const DEFAULT_TARGETS_PATH = readString('TARGETS_FILE');
const DEFAULT_WEBHOOK_URL = readString('WEBHOOK_URL');
const DEFAULT_DB_PATH = path.resolve(process.cwd(), readString('DB_FILE', 'mercadolivre-products.sqlite'));
const DEFAULT_PRODUCT_LIMIT = readInteger('PRODUCT_LIMIT', 5, { minimum: 1 });
const DEFAULT_MAX_PAGES = readInteger('MAX_PAGES', 5, { minimum: 1 });
const DEFAULT_FETCH_RETRIES = readInteger('FETCH_RETRIES', 2, { minimum: 0 });
const REQUEST_TIMEOUT_MS = readInteger('REQUEST_TIMEOUT_MS', 30 * 1000, { minimum: 1 });
const DEFAULT_RESEND_AFTER_HOURS = readNumber('RESEND_AFTER_HOURS', 48, { minimum: 0 });
const DEFAULT_LOOP_ENABLED = readBoolean('LOOP_ENABLED', true);
const DEFAULT_LOOP_DELAY_MS = readInteger('LOOP_DELAY_MS', 60 * 1000, { minimum: 0 });
const DEFAULT_AFFILIATE_TAG = readString('AFFILIATE_TAG');
const QUIET_HOURS_ENABLED = readBoolean('QUIET_HOURS_ENABLED', true);
const QUIET_HOURS_START = readInteger('QUIET_HOURS_START', 22, { minimum: 0, maximum: 23 });
const QUIET_HOURS_END = readInteger('QUIET_HOURS_END', 7, { minimum: 0, maximum: 23 });
const QUIET_HOURS_TIMEZONE = readString('QUIET_HOURS_TIMEZONE', 'America/Sao_Paulo');
const QUIET_HOURS_RECHECK_MS = readInteger('QUIET_HOURS_RECHECK_MS', 5 * 60 * 1000, { minimum: 1000 });
const MAX_CONSECUTIVE_LISTING_FAILURES = 2;
const LISTING_REQUEST_DELAY_MIN_MS = readInteger('LISTING_REQUEST_DELAY_MIN_MS', 3 * 60 * 1000, { minimum: 0 });
const LISTING_REQUEST_DELAY_MAX_MS = readInteger('LISTING_REQUEST_DELAY_MAX_MS', 5 * 60 * 1000, { minimum: LISTING_REQUEST_DELAY_MIN_MS });
const PRODUCT_REQUEST_DELAY_MIN_MS = readInteger('PRODUCT_REQUEST_DELAY_MIN_MS', 5 * 1000, { minimum: 0 });
const PRODUCT_REQUEST_DELAY_MAX_MS = readInteger('PRODUCT_REQUEST_DELAY_MAX_MS', 10 * 1000, { minimum: PRODUCT_REQUEST_DELAY_MIN_MS });
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
  DEFAULT_AFFILIATE_TAG,
  DEFAULT_COOKIES_PATH,
  DEFAULT_DB_PATH,
  DEFAULT_FETCH_RETRIES,
  DEFAULT_LOOP_ENABLED,
  DEFAULT_LOOP_DELAY_MS,
  DEFAULT_MAX_PAGES,
  DEFAULT_PRODUCT_LIMIT,
  DEFAULT_RESEND_AFTER_HOURS,
  DEFAULT_TARGETS_PATH,
  DEFAULT_WEBHOOK_URL,
  LISTING_REQUEST_DELAY_MAX_MS,
  LISTING_REQUEST_DELAY_MIN_MS,
  MAX_CONSECUTIVE_LISTING_FAILURES,
  PRODUCT_REQUEST_DELAY_MAX_MS,
  PRODUCT_REQUEST_DELAY_MIN_MS,
  PROMOTION_FILTERS,
  REQUEST_TIMEOUT_MS,
  QUIET_HOURS_ENABLED,
  QUIET_HOURS_END,
  QUIET_HOURS_RECHECK_MS,
  QUIET_HOURS_START,
  QUIET_HOURS_TIMEZONE,
  SEARCH_PAGE_SIZE,
};
