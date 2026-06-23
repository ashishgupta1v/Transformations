// src/utils/phaseGate.js
// True per-phase human-in-the-loop gate (#113): pauses runPipeline() after
// EVERY phase (1, 2, 3) — not just before publish — so an admin can preview
// that phase's clip and approve before the run continues. Distinct from
// src/utils/reviewQueue.js, which only fires once post-assembly for Tier C
// Aleph runs; this module fires mid-pipeline, once per phase, and is what
// actually carries the "review each phase output before the next phase
// starts" requirement.
//
// Controlled by config.continuity.perPhaseGate.enabled (env
// ENABLE_PER_PHASE_GATE). Off by default — see config/pipeline.config.js.
//
// State is a single JSON file (data/phase-gate-queue.json):
//   { pending: [...], history: [...] }
//
// A pending entry carries everything runPipeline() needs to resume without
// recomputing earlier phases:
//   {
//     runId, theme, phase,          // phase just completed (1, 2, or 3)
//     videoUrl,                     // path/URL to that phase's clip for preview
//     queuedAt,
//     state: {                      // exact shape runPipeline() needs to resume
//       phase1Result, phase2Result, phase3Result,  // whichever exist so far
//       overrides,
//     },
//   }
//
// KNOWN LIMITATION (same class as reviewQueue.js's documented one): state
// is keyed by runId, so only one phase of a given run can be pending at a
// time (which is the actual intent — runPipeline() blocks on it). Do not
// run the same runId through the pipeline twice concurrently.

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = './data';
const QUEUE_FILE = path.join(DATA_DIR, 'phase-gate-queue.json');

async function loadQueue() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(QUEUE_FILE))) {
    return { pending: [], history: [] };
  }
  try {
    return await fs.readJson(QUEUE_FILE);
  } catch (error) {
    logger.warn('Phase gate queue file corrupted, starting fresh', { error: error.message });
    return { pending: [], history: [] };
  }
}

async function saveQueue(queue) {
  await fs.writeJson(QUEUE_FILE, queue, { spaces: 2 });
}

/**
 * Pause point: persist everything needed to resume after phase `entry.phase`
 * completes. If a pending entry already exists for this runId (e.g. a
 * worker retry re-running the same phase), it's replaced rather than
 * duplicated.
 */
async function enqueuePhase(entry) {
  const queue = await loadQueue();
  queue.pending = queue.pending.filter((e) => e.runId !== entry.runId);
  const record = {
    ...entry,
    status: 'awaiting_review',
    queuedAt: new Date().toISOString(),
  };
  queue.pending.push(record);
  await saveQueue(queue);
  logger.info('Phase held for review', { runId: entry.runId, phase: entry.phase });
  return record;
}

async function listPending() {
  const queue = await loadQueue();
  return queue.pending;
}

async function findPending(runId) {
  const queue = await loadQueue();
  const idx = queue.pending.findIndex((e) => e.runId === runId);
  return { queue, idx, entry: idx >= 0 ? queue.pending[idx] : null };
}

/**
 * Approve the pending phase for `runId`. Returns the full entry (including
 * `state`) so the caller (admin/server.js) can re-enqueue a resume job with
 * that state. Removes the entry from `pending` immediately so a duplicate
 * approve call can't double-resume the same run.
 */
async function approve(runId) {
  const { queue, idx, entry } = await findPending(runId);
  if (!entry) throw new Error(`No pending phase-review entry found for runId "${runId}"`);

  entry.status = 'approved';
  entry.decidedAt = new Date().toISOString();
  queue.pending.splice(idx, 1);
  queue.history.push(entry);
  await saveQueue(queue);
  logger.info('Phase review approved', { runId, phase: entry.phase });
  return entry;
}

async function reject(runId, reason = '') {
  const { queue, idx, entry } = await findPending(runId);
  if (!entry) throw new Error(`No pending phase-review entry found for runId "${runId}"`);

  entry.status = 'rejected';
  entry.reason = reason;
  entry.decidedAt = new Date().toISOString();
  queue.pending.splice(idx, 1);
  queue.history.push(entry);
  await saveQueue(queue);
  logger.info('Phase review rejected', { runId, phase: entry.phase, reason });
  return entry;
}

async function status() {
  const queue = await loadQueue();
  return {
    pendingCount: queue.pending.length,
    historyCount: queue.history.length,
  };
}

module.exports = { enqueuePhase, listPending, findPending, approve, reject, status, loadQueue };
