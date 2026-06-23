// src/utils/reviewQueue.js
// Manual review gate for the first N Aleph (Tier C) generated runs.
// Aleph is the most expensive, least-proven call in the pipeline at
// go-live, so instead of trusting it fully unattended from day one, the
// first `continuity.reviewQueue.limit` Aleph runs are held here instead
// of auto-publishing. An admin reviews the assembled video, then calls
// approve() (which publishes) or reject() (which discards) via
// admin/server.js's /api/review/* routes.
//
// State is a single JSON file (data/review-queue.json):
//   { reviewedAlephCount: <int>, pending: [...], history: [...] }
//
// KNOWN LIMITATION (documented, not silently glossed over): a pending
// entry's `exports` paths point into ./output/*.mp4. The pipeline
// overwrites those same filenames on every run (see assembler.js /
// exportPlatformVersions). If you start a second pipeline run before
// approving or rejecting a still-pending entry, that entry's files will
// be silently overwritten/corrupted. Acceptable for the expected ~1
// run/day cadence, but approve or reject pending entries before kicking
// off another run.

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = './data';
const QUEUE_FILE = path.join(DATA_DIR, 'review-queue.json');

async function loadQueue() {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(QUEUE_FILE))) {
    return { reviewedAlephCount: 0, pending: [], history: [] };
  }
  try {
    return await fs.readJson(QUEUE_FILE);
  } catch (error) {
    logger.warn('Review queue file corrupted, starting fresh', { error: error.message });
    return { reviewedAlephCount: 0, pending: [], history: [] };
  }
}

async function saveQueue(queue) {
  await fs.writeJson(QUEUE_FILE, queue, { spaces: 2 });
}

/**
 * Whether the manual review gate is still active, i.e. fewer than
 * config.continuity.reviewQueue.limit Aleph runs have been
 * approved+rejected (reviewed) so far. Once the limit is reached, future
 * Aleph runs auto-publish like any other run.
 */
async function isGateActive(limit) {
  const queue = await loadQueue();
  return queue.reviewedAlephCount < limit;
}

/**
 * Hold a completed run for manual review instead of publishing it.
 * `run` should include at minimum { runId, theme, exports }.
 */
async function enqueue(run) {
  const queue = await loadQueue();
  const entry = {
    ...run,
    status: 'pending',
    queuedAt: new Date().toISOString(),
  };
  queue.pending.push(entry);
  await saveQueue(queue);
  logger.info('Run held for manual review', { runId: run.runId });
  return entry;
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
 * Mark a pending run approved. Does NOT publish itself — the caller
 * (admin/server.js) is responsible for calling publisher.publishAll()
 * with the returned entry's `exports`, then this just records the
 * decision and increments reviewedAlephCount (counts toward closing the
 * gate, whether approved or rejected).
 */
async function approve(runId) {
  const { queue, idx, entry } = await findPending(runId);
  if (!entry) throw new Error(`No pending review entry found for runId "${runId}"`);

  entry.status = 'approved';
  entry.decidedAt = new Date().toISOString();
  queue.pending.splice(idx, 1);
  queue.history.push(entry);
  queue.reviewedAlephCount += 1;
  await saveQueue(queue);
  logger.info('Review entry approved', { runId });
  return entry;
}

async function reject(runId, reason = '') {
  const { queue, idx, entry } = await findPending(runId);
  if (!entry) throw new Error(`No pending review entry found for runId "${runId}"`);

  entry.status = 'rejected';
  entry.reason = reason;
  entry.decidedAt = new Date().toISOString();
  queue.pending.splice(idx, 1);
  queue.history.push(entry);
  queue.reviewedAlephCount += 1;
  await saveQueue(queue);
  logger.info('Review entry rejected', { runId, reason });
  return entry;
}

async function status() {
  const queue = await loadQueue();
  return {
    reviewedAlephCount: queue.reviewedAlephCount,
    pendingCount: queue.pending.length,
    historyCount: queue.history.length,
  };
}

module.exports = { isGateActive, enqueue, listPending, approve, reject, status, loadQueue };
