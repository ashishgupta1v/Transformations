// src/queue/producer.js
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null
});

const videoQueue = new Queue('video-pipeline', { connection });

async function enqueueVideoRun(options) {
  // options includes { runId, theme: theme.id, skipPublish, overrides }
  // and, for phase-gate resume jobs (#113), { resumeFromPhase, resumeState,
  // jobId }. jobId defaults to options.runId for idempotency on the
  // original/first attempt at a run. Resume jobs MUST pass a distinct
  // explicit jobId (e.g. `${runId}:resume:${nextPhase}`) — BullMQ
  // deduplicates by jobId regardless of completion status, so reusing
  // options.runId for a resume job would be silently ignored (the original
  // runId job already exists and BullMQ won't re-add it). data.runId stays
  // equal to the original runId either way so Prisma sync (syncRunState in
  // src/index.js) stays associated with the same VideoRun row.
  const jobId = options.jobId || options.runId;
  await videoQueue.add('generate-video', options, {
    jobId,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
}

module.exports = { videoQueue, enqueueVideoRun, connection };
