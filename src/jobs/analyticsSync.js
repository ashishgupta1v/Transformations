// src/jobs/analyticsSync.js
const { Worker } = require('bullmq');
const Redis = require('ioredis');
const prisma = require('../utils/db');
const logger = require('../utils/logger');
const axios = require('axios');

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// This worker pulls run export URLs and checks their stats
const analyticsWorker = new Worker('analytics-sync', async job => {
  logger.info(`Running analytics sync job ${job.id}`);

  // Find completed runs that have exports
  const runs = await prisma.videoRun.findMany({
    where: { status: 'completed' },
    orderBy: { finishedAt: 'desc' },
    take: 50
  });

  for (const run of runs) {
    if (!run.exports) continue;
    const exports = JSON.parse(run.exports);
    
    let totalViews = 0;

    // Example Youtube API logic
    if (exports.youtube && exports.youtube.includes('youtube.com')) {
       // Dummy fetch for Youtube views
       logger.debug(`Fetching stats for ${exports.youtube}`);
       // const res = await axios.get(`https://www.googleapis.com/youtube/v3/videos?id=VIDEO_ID&part=statistics&key=...`);
       totalViews += Math.floor(Math.random() * 1000); // placeholder
    }

    // You could save this to an Analytics table in Prisma
    logger.info(`Run ${run.id} has approximately ${totalViews} views`);
  }

  return { syncedRuns: runs.length };
}, { connection });

analyticsWorker.on('completed', job => {
  logger.info(`Analytics sync ${job.id} completed!`);
});

module.exports = { analyticsWorker };
