'use strict';

function logInfo(message) {
  console.log(`[info] ${message}`);
}

function logWarn(message) {
  console.log(`[warn] ${message}`);
}

function logError(message) {
  console.error(`[error] ${message}`);
}

module.exports = {
  logError,
  logInfo,
  logWarn,
};
