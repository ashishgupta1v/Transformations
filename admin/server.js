// admin/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const chalk = require('chalk');
const logger = require('../src/utils/logger');
const costTracker = require('../src/utils/costTracker');
const reviewQueue = require('../src/utils/reviewQueue');
const phaseGate = require('../src/utils/phaseGate');
const storage = require('../src/utils/storage');
const Publisher = require('../src/publish/publisher');
const config = require('../config/pipeline.config');
const { loadTheme, listThemes } = require('../src/utils/themeLoader');
const prisma = require('../src/utils/db');
const { enqueueVideoRun } = require('../src/queue/producer');
const webhookRouter = require('../src/webhooks/ai-callbacks');
const { generateThemeFromPrompt } = require('../src/api/generate-theme');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const { subscriber } = require('../src/utils/redisPubSub');
subscriber.subscribe('worker-logs', (err) => {
  if (err) console.error('Failed to subscribe to worker-logs', err);
});
subscriber.on('message', (channel, message) => {
  if (channel === 'worker-logs') {
    io.emit('worker-log', JSON.parse(message));
  }
});

const PORT = process.env.ADMIN_PORT || 3000;
const API_KEY = process.env.ADMIN_API_KEY;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Serve assembled exports so the review UI can preview a run's video
// before an admin approves/rejects it. Read-only, same dir assembler.js
// writes to (OUTPUT_DIR). Path traversal is bounded by express.static.
app.use('/output', express.static(path.resolve(process.env.OUTPUT_DIR || './output')));

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

// ── WEBHOOKS (Public) ───────────────────────────
app.use('/api/webhooks', webhookRouter);

// ── PROTECTED ROUTES ────────────────────────────
app.use('/api', requireApiKey);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post('/api/pipeline/start', async (req, res) => {
  const themeOption = req.body?.theme || process.env.DEFAULT_THEME;
  let theme;
  try {
    theme = loadTheme(themeOption);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const runId = `run-${Date.now()}`;

  // Find or create a default workspace
  let workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    const user = await prisma.user.create({ data: { email: 'admin@system.local', name: 'System Admin' } });
    workspace = await prisma.workspace.create({ data: { name: 'Default Workspace', ownerId: user.id } });
  }

  // Create VideoRun in DB
  const runRecord = await prisma.videoRun.create({
    data: {
      id: runId,
      workspaceId: workspace.id,
      status: 'idle',
      phase: 0
    }
  });

  const overrides = {
    moduleType: req.body?.moduleType,
    baseImageUrl: req.body?.baseImageUrl, // Legacy fallback
    targetImageUrl: req.body?.targetImageUrl, // Legacy fallback
    phase1BaseImageUrl: req.body?.phase1BaseImageUrl,
    phase1TargetImageUrl: req.body?.phase1TargetImageUrl,
    phase2BaseImageUrl: req.body?.phase2BaseImageUrl,
    phase2TargetImageUrl: req.body?.phase2TargetImageUrl,
    phase3BaseImageUrl: req.body?.phase3BaseImageUrl,
    phase3TargetImageUrl: req.body?.phase3TargetImageUrl,
    phase1ImageUrl: req.body?.phase1ImageUrl, // Legacy
    phase2ImageUrl: req.body?.phase2ImageUrl, // Legacy
    phase3ImageUrl: req.body?.phase3ImageUrl, // Legacy
    phase2VideoInputUrl: req.body?.phase2VideoInputUrl,
    phase2ReferenceImageUrl: req.body?.phase2ReferenceImageUrl,
  };

  logger.info('Pipeline start requested via admin API', { runId, theme: theme.id, body: req.body });

  // Enqueue job instead of calling runPipeline synchronously
  await enqueueVideoRun({
    runId,
    theme: theme.id,
    skipPublish: req.body?.skipPublish === true,
    overrides,
  });

  res.status(202).json({ accepted: true, runId, theme: theme.id, status: 'idle' });
});

app.get('/api/pipeline/status/:runId', async (req, res) => {
  try {
    const run = await prisma.videoRun.findUnique({
      where: { id: req.params.runId },
      include: { costLogs: true }
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pipeline/status', async (req, res) => {
  try {
    const runs = await prisma.videoRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/themes', (req, res) => {
  const themes = listThemes()
    .filter((id) => !id.endsWith('-10s')) // Hide single-shot variants from main dropdown
    .map((id) => {
      try {
        const theme = loadTheme(id);
        return { id, displayName: theme.displayName, subjectType: theme.subjectType || 'general', tagline: theme.tagline || '' };
      } catch (error) {
        return { id, error: error.message };
      }
    });
  res.json({ themes });
});

app.get('/api/themes/:id', (req, res) => {
  try {
    const theme = loadTheme(req.params.id);
    res.json(theme);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/themes/generate', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) {
    return res.status(400).json({ error: 'Body must include "prompt"' });
  }

  try {
    const theme = await generateThemeFromPrompt(prompt);
    res.json({ success: true, theme });
  } catch (error) {
    logger.error('Failed to generate theme', { error: error.message });
    res.status(500).json({ error: error.message });
  }
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

// ── MANUAL REVIEW QUEUE ────
app.get('/api/review/pending', async (req, res) => {
  try {
    const pending = await reviewQueue.listPending();
    res.json({ pending });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/review/status', async (req, res) => {
  try {
    const summary = await reviewQueue.status();
    res.json({ ...summary, gateLimit: config.continuity.reviewQueue.limit, gateEnabled: config.continuity.reviewQueue.enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/review/:runId/approve', async (req, res) => {
  try {
    const pending = await reviewQueue.listPending();
    const entry = pending.find((e) => e.runId === req.params.runId);
    if (!entry) {
      return res.status(404).json({ error: `No pending review entry for runId "${req.params.runId}"` });
    }

    const theme = loadTheme(entry.theme);
    const publisher = new Publisher(theme);
    const results = await publisher.publishAll(entry.exports);

    await reviewQueue.approve(req.params.runId);

    // Update DB status
    await prisma.videoRun.update({
      where: { id: req.params.runId },
      data: { status: 'completed' }
    });

    logger.info('Review entry approved and published', { runId: req.params.runId });
    res.json({ approved: true, runId: req.params.runId, results });
  } catch (error) {
    logger.error('Review approval failed', { runId: req.params.runId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/review/:runId/reject', async (req, res) => {
  try {
    const entry = await reviewQueue.reject(req.params.runId, req.body?.reason || '');
    // Update DB status
    await prisma.videoRun.update({
      where: { id: req.params.runId },
      data: { status: 'failed', error: req.body?.reason || 'Rejected' }
    });
    res.json({ rejected: true, runId: req.params.runId, entry });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// ── PER-PHASE REVIEW GATE (#113) ────
// Distinct from the Aleph-only /api/review/* routes above: this gate fires
// after EVERY phase (1, 2, 3) when config.continuity.perPhaseGate.enabled
// (env ENABLE_PER_PHASE_GATE) is on, not just once before publish. See
// src/utils/phaseGate.js and pauseForPhaseReview() in src/index.js.
app.get('/api/phase-review/pending', async (req, res) => {
  try {
    const pending = await phaseGate.listPending();
    res.json({ pending });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/phase-review/status', async (req, res) => {
  try {
    const summary = await phaseGate.status();
    res.json({ ...summary, gateEnabled: config.continuity.perPhaseGate.enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/phase-review/:runId/approve', async (req, res) => {
  try {
    const entry = await phaseGate.approve(req.params.runId);
    const nextPhase = entry.phase + 1; // 4 means all three phases are done

    // Resume jobs MUST use a distinct jobId — BullMQ deduplicates by jobId
    // regardless of completion status, and the original run's jobId
    // (runId) was already consumed by the job that paused at this phase.
    // data.runId stays the original runId so syncRunState() in
    // src/index.js keeps updating the same VideoRun row.
    const jobId = `${entry.runId}:resume:${nextPhase}`;
    await enqueueVideoRun({
      runId: entry.runId,
      jobId,
      theme: entry.theme,
      skipPublish: entry.state?.skipPublish,
      overrides: entry.state?.overrides,
      resumeFromPhase: nextPhase,
      resumeState: entry.state,
    });

    await prisma.videoRun.update({
      where: { id: entry.runId },
      data: { status: 'running', phase: entry.phase },
    }).catch((error) => {
      logger.debug('Phase-review approve: skipping VideoRun DB sync', { error: error.message });
    });

    logger.info('Phase review approved, resume job enqueued', { runId: entry.runId, nextPhase, jobId });
    res.json({ approved: true, runId: entry.runId, resumedFromPhase: nextPhase, jobId });
  } catch (error) {
    logger.error('Phase review approval failed', { runId: req.params.runId, error: error.message });
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/phase-review/:runId/reject', async (req, res) => {
  try {
    const entry = await phaseGate.reject(req.params.runId, req.body?.reason || '');
    await prisma.videoRun.update({
      where: { id: req.params.runId },
      data: { status: 'failed', error: req.body?.reason || 'Rejected at phase review' },
    }).catch((error) => {
      logger.debug('Phase-review reject: skipping VideoRun DB sync', { error: error.message });
    });
    res.json({ rejected: true, runId: req.params.runId, entry });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post('/api/phase-review/:runId/regenerate', async (req, res) => {
  try {
    const pending = await phaseGate.listPending();
    const entry = pending.find((e) => e.runId === req.params.runId);
    if (!entry) {
      return res.status(404).json({ error: `No pending phase review for runId "${req.params.runId}"` });
    }

    if (req.body?.prompt) {
      const themePath = path.join(__dirname, '../themes', `${entry.theme}.json`);
      if (await fs.pathExists(themePath)) {
        const themeData = await fs.readJson(themePath);
        if (entry.phase === 1) themeData.basePrompt = req.body.prompt;
        else if (entry.phase === 2) themeData.phase2Prompt = req.body.prompt;
        else if (entry.phase === 3) themeData.phase3Prompt = req.body.prompt;
        await fs.writeJson(themePath, themeData, { spaces: 2 });
        logger.info('Theme prompt overwritten for regeneration', { theme: entry.theme, phase: entry.phase });
      }
    }

    await phaseGate.reject(req.params.runId, 'Regenerating');

    const jobId = `${entry.runId}:resume:${entry.phase}-regen-${Date.now()}`;
    await enqueueVideoRun({
      runId: entry.runId,
      jobId,
      theme: entry.theme,
      skipPublish: entry.state?.skipPublish,
      overrides: entry.state?.overrides,
      resumeFromPhase: entry.phase,
      resumeState: entry.state,
    });

    await prisma.videoRun.update({
      where: { id: entry.runId },
      data: { status: 'running', phase: entry.phase, error: null },
    });

    logger.info('Phase regenerated, resume job enqueued', { runId: entry.runId, phase: entry.phase, jobId });
    res.json({ regenerated: true, runId: entry.runId, resumedFromPhase: entry.phase, jobId });
  } catch (error) {
    logger.error('Phase regeneration failed', { runId: req.params.runId, error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ── ASSET UPLOAD ──
app.post('/api/assets/upload', async (req, res) => {
  const { filename, base64, folder } = req.body || {};
  if (!filename || !base64) {
    return res.status(400).json({ error: 'Body must include "filename" and "base64"' });
  }

  const tempPath = path.join(os.tmpdir(), `upload_${Date.now()}_${filename}`);
  try {
    const buffer = Buffer.from(base64.replace(/^data:.*;base64,/, ''), 'base64');
    await fs.writeFile(tempPath, buffer);

    const result = await storage.uploadFile(tempPath, folder || 'user-inputs');
    logger.info('Asset uploaded via admin API', { key: result.key });
    res.json({ uploaded: true, url: result.url, key: result.key });
  } catch (error) {
    logger.error('Asset upload failed', { error: error.message });
    res.status(500).json({ error: error.message });
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(chalk.cyan(`\n🛸 Admin server running: http://localhost:${PORT}`));
  logger.info('Admin server started', { port: PORT });
});

module.exports = app;
