// src/audio/generator.js
// Handles all audio generation: ElevenLabs (sound effects) + Suno AI (music score)
// This module was referenced by src/index.js but did not exist — built per
// the "still needs building" list.

const axios = require('axios');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');

class AudioGenerator {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || './temp';
    fs.ensureDirSync(this.tempDir);
  }

  // ── SACRED AUDIO (ElevenLabs sound-generation) ──
  async generateSacredAudio() {
    logger.info('Generating sacred audio layer (ElevenLabs)');
    const { prompt, duration } = config.audio.sacred;
    return this._generateElevenLabsSound(prompt, duration, 'sacred');
  }

  // ── SCIFI AUDIO (ElevenLabs sound-generation) ───
  async generateSciFiAudio() {
    logger.info('Generating sci-fi audio layer (ElevenLabs)');
    const { prompt, duration } = config.audio.scifi;
    return this._generateElevenLabsSound(prompt, duration, 'scifi');
  }

  async _generateElevenLabsSound(prompt, duration, label) {
    try {
      const response = await withRetry(
        () => axios.post(
          'https://api.elevenlabs.io/v1/sound-generation',
          {
            text: prompt,
            duration_seconds: duration,
            prompt_influence: label === 'scifi' ? 0.5 : 0.3,
          },
          {
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY,
              'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer',
          }
        ),
        { label: `ElevenLabs ${label} sound generation` }
      );

      const filePath = `${this.tempDir}/${label}_audio.mp3`;
      await fs.writeFile(filePath, response.data);
      logger.info(`${label} audio generated`, { path: filePath });

      // ElevenLabs sound-generation returns raw audio bytes, not a hosted
      // URL — assembler.downloadAssets() expects a URL it can fetch, so we
      // expose a local file:// reference plus the path directly.
      return { path: filePath, url: `file://${filePath}` };

    } catch (error) {
      logger.error(`${label} audio generation failed`, { error: error.message });
      throw new Error(`${label} audio generation failed: ${error.message}`);
    }
  }

  // ── MUSIC SCORE (Suno AI) ───────────────────────
  async generateMusicScore() {
    logger.info('Generating music score (Suno AI)');
    const { prompt, duration, instrumental } = config.audio.music;
    const baseUrl = process.env.SUNO_API_BASE_URL || 'https://api.sunoapi.org';

    try {
      const taskId = await withRetry(
        async () => {
          const response = await axios.post(
            `${baseUrl}/api/v1/generate`,
            {
              prompt,
              instrumental,
              duration,
              model: 'chirp-v3-5',
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.SUNO_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );
          return response.data?.data?.task_id || response.data?.id;
        },
        { label: 'Suno submit (music score)' }
      );

      logger.info('Suno task submitted', { taskId });
      const result = await this.pollSuno(taskId, baseUrl);
      logger.info('Music score complete', { url: result.url });
      return result;

    } catch (error) {
      logger.error('Music score generation failed', { error: error.message });
      throw new Error(`Music score generation failed: ${error.message}`);
    }
  }

  // ── POLLING: SUNO ────────────────────────────────
  async pollSuno(taskId, baseUrl) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `${baseUrl}/api/v1/generate/record-info?taskId=${taskId}`,
        { headers: { Authorization: `Bearer ${process.env.SUNO_API_KEY}` } }
      );

      const data = response.data?.data;
      const status = data?.status;
      logger.debug('Suno poll', { taskId, status, attempt: attempts });

      if (status === 'SUCCESS' || status === 'complete') {
        const track = data?.response?.sunoData?.[0] || data?.clips?.[0];
        return { url: track?.audio_url || track?.audioUrl, taskId };
      } else if (status === 'FAILED' || status === 'error') {
        throw new Error('Suno generation failed');
      }
    }
    throw new Error('Suno polling timeout');
  }
}

module.exports = AudioGenerator;
