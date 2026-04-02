'use strict';

let logPrefix = '';

function formatMessage(message) {
  return logPrefix ? `${logPrefix} ${message}` : message;
}

function logInfo(message) {
  console.log(`[info] ${formatMessage(message)}`);
}

function logWarn(message) {
  console.log(`[warn] ${formatMessage(message)}`);
}

function logError(message) {
  console.error(`[error] ${formatMessage(message)}`);
}

function setLogPrefix(prefix) {
  logPrefix = prefix ? String(prefix).trim() : '';
}

module.exports = {
  logError,
  logInfo,
  logWarn,
  setLogPrefix,
};
