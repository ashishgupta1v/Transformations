// src/utils/costTracker.js
// Logs estimated spend per pipeline run to data/cost-log.json, since most
// of the AI providers (Runway/Kling/Pika/ElevenLabs/Suno/Replicate) don't
// return real-time billing data in their API responses. Estimates come
// from config.costEstimates (env-overridable).

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const config = require('../../config/pipeline.config');

const DATA_DIR = './data';
const LOG_FILE = path.join(DATA_DIR, 'cost-log.json');

async function loadLog() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(LOG_FILE))) {
    return { runs: [] };
  }
  try {
    return await fs.readJson(LOG_FILE);
  } catch (error) {
    logger.warn('Cost log corrupted, starting fresh', { error: error.message });
    return { runs: [] };
  }
}

async function saveLog(log) {
  await fs.writeJson(LOG_FILE, log, { spaces: 2 });
}

/**
 * Record one pipeline run's cost. `usage` is a map of provider -> call count,
 * e.g. { runway: 1, kling: 1, pika: 1, elevenlabs: 2, suno: 1, replicate: 1 }
 */
async function recordRun(usage, meta = {}) {
  const log = await loadLog();

  const breakdown = {};
  let total = 0;
  for (const [provider, calls] of Object.entries(usage)) {
    const perCall = config.costEstimates[provider] || 0;
    const cost = perCall * calls;
    breakdown[provider] = { calls, perCall, cost: Number(cost.toFixed(4)) };
    total += cost;
  }

  const run = {
    timestamp: new Date().toISOString(),
    total: Number(total.toFixed(4)),
    breakdown,
    ...meta,
  };

  log.runs.push(run);
  await saveLog(log);

  logger.info('Run cost recorded', { total: run.total });
  return run;
}

/**
 * Summarize spend across all logged runs, with month-to-date and budget
 * tier context.
 */
async function getSummary() {
  const log = await loadLog();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthRuns = log.runs.filter((r) => new Date(r.timestamp) >= monthStart);
  const monthTotal = monthRuns.reduce((sum, r) => sum + r.total, 0);
  const allTimeTotal = log.runs.reduce((sum, r) => sum + r.total, 0);

  const matchingTier = config.budgetTiers
    .find((tier) => monthTotal <= tier.monthlyUsd) || config.budgetTiers[config.budgetTiers.length - 1];

  return {
    totalRuns: log.runs.length,
    monthRuns: monthRuns.length,
    monthTotalUsd: Number(monthTotal.toFixed(2)),
    allTimeTotalUsd: Number(allTimeTotal.toFixed(2)),
    nearestBudgetTier: matchingTier,
    recentRuns: log.runs.slice(-5),
  };
}

module.exports = { recordRun, getSummary, loadLog };
