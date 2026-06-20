// src/video/generator.js
// Handles all video generation via Runway, Kling, Pika + optional Replicate 4K upscale

const axios = require('axios');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');

class VideoGenerator {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || './temp';
    fs.ensureDirSync(this.tempDir);
  }

  // ── PHASE 1: RUNWAY GEN-3 ───────────────
  async generatePhase1() {
    logger.info('Starting Phase 1 — Runway Gen-3');
    const { prompt, duration } = config.phases.phase1;

    try {
      const taskId = await withRetry(
        async () => {
          const response = await axios.post(
            'https://api.dev.runwayml.com/v1/image_to_video',
            {
              promptImage: process.env.BASE_IMAGE_URL ||
                'https://your-oracle-storage/jagannath_base.png',
              promptText: prompt,
              model: process.env.RUNWAY_MODEL || 'gen3a_turbo',
              duration,
              ratio: '768:768',
              seed: 42,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
                'X-Runway-Version': process.env.RUNWAY_API_VERSION || '2024-11-06',
                'Content-Type': 'application/json',
              },
            }
          );
          return response.data.id;
        },
        { label: 'Runway submit (Phase 1)' }
      );

      logger.info('Runway task submitted', { taskId });

      const result = await this.pollRunway(taskId);
      logger.info('Phase 1 complete', { url: result.url });
      return result;

    } catch (error) {
      logger.error('Phase 1 failed', { error: error.message });
      throw new Error(`Phase 1 generation failed: ${error.message}`);
    }
  }

  // ── PHASE 2: KLING AI ───────────────────
  async generatePhase2(inputVideoUrl) {
    logger.info('Starting Phase 2 — Kling AI SciFi');
    const { prompt, negativePrompt, duration } = config.phases.phase2;

    try {
      const taskId = await withRetry(
        async () => {
          const response = await axios.post(
            'https://api.klingai.com/v1/videos/video-to-video',
            {
              input_video_url: inputVideoUrl,
              prompt,
              negative_prompt: negativePrompt,
              cfg_scale: 0.7,
              mode: 'pro',
              duration,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.KLING_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );
          return response.data.data?.task_id;
        },
        { label: 'Kling submit (Phase 2)' }
      );

      logger.info('Kling task submitted', { taskId });

      const result = await this.pollKling(taskId);
      logger.info('Phase 2 complete', { url: result.url });
      return result;

    } catch (error) {
      logger.error('Phase 2 failed', { error: error.message });
      throw new Error(`Phase 2 generation failed: ${error.message}`);
    }
  }

  // ── PHASE 3: PIKA LABS ──────────────────
  async generatePhase3() {
    logger.info('Starting Phase 3 — Pika Labs Return');
    const { prompt, negativePrompt, duration } = config.phases.phase3;

    try {
      const taskId = await withRetry(
        async () => {
          const response = await axios.post(
            'https://api.pika.art/generate',
            {
              promptText: prompt,
              negativePrompt,
              frameRate: 24,
              duration,
              resolution: '1080p',
              guidanceScale: 12,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.PIKA_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );
          return response.data.id;
        },
        { label: 'Pika submit (Phase 3)' }
      );

      const result = await this.pollPika(taskId);
      logger.info('Phase 3 complete', { url: result.url });
      return result;

    } catch (error) {
      logger.error('Phase 3 failed', { error: error.message });
      throw new Error(`Phase 3 generation failed: ${error.message}`);
    }
  }

  // ── OPTIONAL: 4K UPSCALE (REPLICATE) ────
  async upscaleVideo(videoUrl) {
    if (!config.upscale.enabled) {
      logger.debug('Upscale disabled, skipping');
      return { url: videoUrl, upscaled: false };
    }

    logger.info('Starting 4K upscale via Replicate', { model: config.upscale.model });

    try {
      const predictionId = await withRetry(
        async () => {
          const response = await axios.post(
            'https://api.replicate.com/v1/predictions',
            {
              version: config.upscale.model,
              input: { image: videoUrl, scale: config.upscale.scale },
            },
            {
              headers: {
                Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );
          return response.data.id;
        },
        { label: 'Replicate submit (upscale)' }
      );

      const result = await this.pollReplicate(predictionId);
      logger.info('Upscale complete', { url: result.url });
      return { ...result, upscaled: true };

    } catch (error) {
      logger.warn('Upscale failed, falling back to original video', { error: error.message });
      return { url: videoUrl, upscaled: false, error: error.message };
    }
  }

  // ── POLLING: RUNWAY ──────────────────────
  async pollRunway(taskId) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `https://api.dev.runwayml.com/v1/tasks/${taskId}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
            'X-Runway-Version': process.env.RUNWAY_API_VERSION,
          },
        }
      );

      const { status, output, failure } = response.data;
      logger.debug('Runway poll', { taskId, status, attempt: attempts });

      if (status === 'SUCCEEDED') {
        return { url: output[0], taskId };
      } else if (status === 'FAILED') {
        throw new Error(`Runway task failed: ${failure}`);
      }
    }
    throw new Error('Runway polling timeout');
  }

  // ── POLLING: KLING ───────────────────────
  async pollKling(taskId) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `https://api.klingai.com/v1/videos/video-to-video/${taskId}`,
        { headers: { Authorization: `Bearer ${process.env.KLING_API_KEY}` } }
      );

      const taskData = response.data.data;
      logger.debug('Kling poll', { taskId, status: taskData?.task_status });

      if (taskData?.task_status === 'succeed') {
        return { url: taskData.task_result?.videos?.[0]?.url, taskId };
      } else if (taskData?.task_status === 'failed') {
        throw new Error('Kling task failed');
      }
    }
    throw new Error('Kling polling timeout');
  }

  // ── POLLING: PIKA ────────────────────────
  async pollPika(taskId) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `https://api.pika.art/jobs/${taskId}`,
        { headers: { Authorization: `Bearer ${process.env.PIKA_API_KEY}` } }
      );

      const { status, videos } = response.data;

      if (status === 'finished') {
        return { url: videos?.[0]?.resultUrl, taskId };
      } else if (status === 'failed') {
        throw new Error('Pika task failed');
      }
    }
    throw new Error('Pika polling timeout');
  }

  // ── POLLING: REPLICATE ───────────────────
  async pollReplicate(predictionId) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        { headers: { Authorization: `Token ${process.env.REPLICATE_API_KEY}` } }
      );

      const { status, output, error } = response.data;
      logger.debug('Replicate poll', { predictionId, status, attempt: attempts });

      if (status === 'succeeded') {
        return { url: Array.isArray(output) ? output[0] : output, predictionId };
      } else if (status === 'failed' || status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${error || status}`);
      }
    }
    throw new Error('Replicate polling timeout');
  }

  sleep(ms) {
    return sleep(ms);
  }
}

module.exports = VideoGenerator;
