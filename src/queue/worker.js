// src/queue/worker.js
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const { runPipeline } = require('../index');
const prisma = require('../utils/db');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const worker = new Worker('video-pipeline', async job => {
  logger.info(`Starting job ${job.id}`, { data: job.data });
  
  // resumeFromPhase/resumeState are present on continuation jobs enqueued
  // by admin/server.js's POST /api/phase-review/:runId/approve (#113) —
  // without forwarding these through to runPipeline(), an approved phase
  // would silently regenerate from Phase 1 every time, defeating the
  // entire point of the per-phase gate. skipPublish/overrides on a resume
  // job come from phaseGate.js's persisted state (see src/index.js's
  // pauseForPhaseReview() call sites), not from a fresh CLI/API call.
  const { runId, theme, skipPublish, overrides, resumeFromPhase, resumeState } = job.data;

  // Update DB state to running
  await prisma.videoRun.updateMany({
    where: { id: runId },
    data: { status: 'running' }
  });

  try {
    // runPipeline() now syncs VideoRun.status/phase to Postgres at every
    // step and on success (see syncRunState() in src/index.js, #112), and
    // re-throws on failure instead of silently swallowing the error — so
    // this catch block actually runs for real failures now.
    await runPipeline({ runId, theme, skipPublish, overrides, resumeFromPhase, resumeState });
  } catch (error) {
    logger.error(`Job ${job.id} failed`, { error: error.message });
    
    await prisma.videoRun.updateMany({
      where: { id: runId },
      data: { status: 'failed', error: error.message, finishedAt: new Date() }
    });
    throw error; // Let BullMQ handle retries
  }
}, { connection });

worker.on('completed', job => {
  logger.info(`Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} has failed with ${err.message}`);
});

module.exports = { worker };
