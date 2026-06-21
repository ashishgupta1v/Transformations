// src/audio/generator.js
// Handles all audio generation: ElevenLabs (sound effects) + Suno AI (music score).
// Subject-specific prompts/volumes come from a theme object (see
// themes/*.json + src/utils/themeLoader.js) passed into the constructor.
// Engine-level tuning (polling) stays in config/pipeline.config.js.

const axios = require('axios');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');

class AudioGenerator {
  constructor(theme) {
    this.theme = theme || null;
    this.tempDir = process.env.TEMP_DIR || './temp';
    fs.ensureDirSync(this.tempDir);
  }

  requireTheme() {
    if (!this.theme) {
      throw new Error('AudioGenerator requires a theme — pass one to the constructor (see themes/)');
    }
    return this.theme;
  }

  // ── AMBIENT AUDIO (ElevenLabs sound-generation) — matches phase 1 baseline ──
  async generateAmbientAudio() {
    logger.info('Generating ambient audio layer (ElevenLabs)');
    const theme = this.requireTheme();
    const { prompt, duration, promptInfluence } = theme.audio.ambient;
    return this._generateElevenLabsSound(prompt, duration, 'ambient', promptInfluence);
  }

  // ── TRANSFORMATION AUDIO (ElevenLabs sound-generation) — matches phase 2 ──
  async generateTransformationAudio() {
    logger.info('Generating transformation audio layer (ElevenLabs)');
    const theme = this.requireTheme();
    const { prompt, duration, promptInfluence } = theme.audio.transformation;
    return this._generateElevenLabsSound(prompt, duration, 'transformation', promptInfluence);
  }

  async _generateElevenLabsSound(prompt, duration, label, promptInfluence = 0.3) {
    try {
      const response = await withRetry(
        () => axios.post(
          'https://api.elevenlabs.io/v1/sound-generation',
          {
            text: prompt,
            duration_seconds: duration,
            prompt_influence: promptInfluence,
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
    const theme = this.requireTheme();
    const { prompt, duration, instrumental } = theme.audio.music;
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

  // ── POLLING: SUNO (engine-level) ─────────────────
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
