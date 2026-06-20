// admin/server.js
// Lightweight Express admin server for pipeline control. This is the
// "Admin web UI for pipeline control" build item, and is also what the
// n8n workflow's "Start Pipeline API" httpRequest node calls
// (POST http://localhost:3000/api/pipeline/start).

require('dotenv').config();
const express = require('express');
const path = require('path');
const chalk = require('chalk');
const logger = require('../src/utils/logger');
const costTracker = require('../src/utils/costTracker');
const { runPipeline } = require('../src/index');

const app = express();
const PORT = process.env.ADMIN_PORT || 3000;
const API_KEY = process.env.ADMIN_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── IN-MEMORY PIPELINE STATE ──────────────────
// A single pipeline run takes many minutes (video gen + assembly + publish),
// so we track state in memory rather than blocking the HTTP request.
const state = {
  status: 'idle', // idle | running | completed | failed
  runId: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  lastExports: null,
};

// ── AUTH MIDDLEWARE ────────────────────────────
function requireApiKey(req, res, next) {
  if (!API_KEY) {
    logger.warn('ADMIN_API_KEY not set — admin API is running unauthenticated');
    return next();
  }
  const provided = req.headers['x-api-key'] || (req.headers.authorization || '').replace('Bearer ', '');
  if (provided !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized — missing or invalid x-api-key' });
  }
  return next();
}

app.use('/api', requireApiKey);

// ── ROUTES ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/pipeline/start', async (req, res) => {
  if (state.status === 'running') {
    return res.status(409).json({ error: 'A pipeline run is already in progress', state });
  }

  const runId = `run-${Date.now()}`;
  state.status = 'running';
  state.runId = runId;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;

  logger.info('Pipeline start requested via admin API', { runId, body: req.body });

  // Fire-and-forget — the pipeline itself handles its own logging,
  // cost tracking, and WhatsApp notifications. We just track terminal state.
  runPipeline({ skipPublish: req.body?.skipPublish === true })
    .then(() => {
      state.status = 'completed';
      state.finishedAt = new Date().toISOString();
    })
    .catch((error) => {
      state.status = 'failed';
      state.finishedAt = new Date().toISOString();
      state.error = error.message;
      logger.error('Pipeline run failed (admin-triggered)', { runId, error: error.message });
    });

  res.status(202).json({ accepted: true, runId, status: state.status });
});

app.get('/api/pipeline/status', (req, res) => {
  res.json(state);
});

app.get('/api/costs', async (req, res) => {
  try {
    const summary = await costTracker.getSummary();
    res.json(summary);
  } catch (error) {
    logger.error('Failed to load cost summary', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(chalk.cyan(`\n🛸 Admin server running: http://localhost:${PORT}`));
  console.log(chalk.cyan(`   POST /api/pipeline/start`));
  console.log(chalk.cyan(`   GET  /api/pipeline/status`));
  console.log(chalk.cyan(`   GET  /api/costs\n`));
  logger.info('Admin server started', { port: PORT });
});

module.exports = app;
