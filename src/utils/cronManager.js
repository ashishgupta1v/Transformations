// src/utils/cronManager.js
// node-cron based scheduler for recurring pipeline runs. This is the
// "Cron job manager for scheduling" item from the build list — it lets
// `node src/index.js schedule` keep a long-running process alive locally
// (useful for testing without n8n, or as a fallback if n8n is down).

const cron = require('node-cron');
const logger = require('./logger');

class CronManager {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Schedule a named job. `expression` is a standard cron expression
   * (default: weekly Monday 2am IST, matching the n8n workflow trigger).
   */
  schedule(name, expression, taskFn) {
    if (this.jobs.has(name)) {
      logger.warn(`Cron job "${name}" already scheduled, replacing it`);
      this.stop(name);
    }

    if (!cron.validate(expression)) {
      throw new Error(`Invalid cron expression: ${expression}`);
    }

    const job = cron.schedule(expression, async () => {
      logger.info(`Cron job triggered: ${name}`);
      try {
        await taskFn();
        logger.info(`Cron job completed: ${name}`);
      } catch (error) {
        logger.error(`Cron job failed: ${name}`, { error: error.message });
      }
    }, {
      timezone: process.env.TZ || 'Asia/Kolkata',
    });

    this.jobs.set(name, { job, expression });
    logger.info(`Cron job scheduled: ${name}`, { expression });
    return job;
  }

  stop(name) {
    const entry = this.jobs.get(name);
    if (!entry) return false;
    entry.job.stop();
    this.jobs.delete(name);
    logger.info(`Cron job stopped: ${name}`);
    return true;
  }

  stopAll() {
    for (const name of this.jobs.keys()) {
      this.stop(name);
    }
  }

  list() {
    return Array.from(this.jobs.entries()).map(([name, { expression }]) => ({ name, expression }));
  }
}

module.exports = new CronManager();
module.exports.CronManager = CronManager;
