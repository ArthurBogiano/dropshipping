'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadLocalEnvironment() {
  const envFile = path.resolve(process.cwd(), process.env.ENV_FILE || '.env');

  if (!fs.existsSync(envFile)) {
    return;
  }

  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('O carregamento de .env requer Node.js 22 ou superior.');
  }

  process.loadEnvFile(envFile);
}

function readString(name, fallback = null) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  return value.trim();
}

function readNumber(name, fallback, options = {}) {
  const raw = readString(name);
  if (raw == null) {
    return fallback;
  }

  const value = Number(raw);
  const minimum = options.minimum ?? Number.NEGATIVE_INFINITY;
  const maximum = options.maximum ?? Number.POSITIVE_INFINITY;

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} precisa ser um numero entre ${minimum} e ${maximum}.`);
  }

  return value;
}

function readInteger(name, fallback, options = {}) {
  const value = readNumber(name, fallback, options);
  if (!Number.isInteger(value)) {
    throw new Error(`${name} precisa ser um numero inteiro.`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = readString(name);
  if (raw == null) {
    return fallback;
  }

  const normalized = raw.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} precisa ser true ou false.`);
}

loadLocalEnvironment();

module.exports = {
  readBoolean,
  readInteger,
  readNumber,
  readString,
};
