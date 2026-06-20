// src/utils/retry.js
// Generic exponential-backoff retry wrapper for async API calls.
// Honors config.retry { maxAttempts, delayMs, backoffMultiplier }.

const logger = require('./logger');
const config = require('../../config/pipeline.config');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap an async function with retry + exponential backoff.
 * @param {Function} fn - async function to execute, receives attempt number (1-based)
 * @param {Object} [options]
 * @param {string} [options.label] - name used in log messages
 * @param {number} [options.maxAttempts]
 * @param {number} [options.delayMs]
 * @param {number} [options.backoffMultiplier]
 * @param {Function} [options.shouldRetry] - (error) => boolean, default: always retry
 */
async function withRetry(fn, options = {}) {
  const {
    label = 'operation',
    maxAttempts = config.retry.maxAttempts,
    delayMs = config.retry.delayMs,
    backoffMultiplier = config.retry.backoffMultiplier,
    shouldRetry = () => true,
  } = options;

  let attempt = 0;
  let currentDelay = delayMs;
  let lastError;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      logger.warn(`${label} failed (attempt ${attempt}/${maxAttempts}): ${error.message}`, {
        error: error.message,
      });

      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt || !shouldRetry(error)) {
        break;
      }

      logger.info(`Retrying ${label} in ${currentDelay}ms...`);
      await sleep(currentDelay);
      currentDelay *= backoffMultiplier;
    }
  }

  logger.error(`${label} failed after ${attempt} attempt(s): ${lastError.message}`, {
    error: lastError.message,
  });
  throw lastError;
}

module.exports = { withRetry, sleep };
