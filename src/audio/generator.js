// src/audio/generator.js
// Handles all audio generation: ElevenLabs (sound effects) + muapi.ai
// Suno (music score). Subject-specific prompts/volumes come from a theme
// object (see themes/*.json + src/utils/themeLoader.js) passed into the
// constructor. Engine-level tuning (polling) stays in
// config/pipeline.config.js.
//
// 2026-06 muapi.ai migration: music generation moved here from the
// unofficial Suno-reseller (apipass.app) to muapi.ai's suno-create-music
// model. Schema confirmed via muapi's public /api/v1/models/{name}
// discovery endpoint (no account needed) — required field is `style`;
// `prompt` is optional lyrics text used only when instrumental is false.
// There is no `duration` field (Suno itself decides the track length) and
// no `model: 'chirp-v3-5'`-style version selector. Theme JSON's existing
// audio.music.prompt field (originally free-text music description for
// the old reseller) is mapped onto muapi's `style` field, since that's
// the closer semantic match; muapi's own `prompt` field (lyrics) is left
// unset given every theme so far is instrumental. ElevenLabs sound effects
// below are completely unaffected by this migration — they call
// ElevenLabs' own API directly, not via fal.ai or muapi.ai.

const axios = require('axios');
const fs = require('fs-extra');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');

const MUAPI_BASE_URL = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai/api/v1';

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

  muapiHeaders() {
    if (!process.env.MUAPI_API_KEY) {
      throw new Error('MUAPI_API_KEY not set — required for music score generation');
    }
    return {
      'x-api-key': process.env.MUAPI_API_KEY,
      'Content-Type': 'application/json',
    };
  }

  async generateAmbientAudio() {
    logger.info('Generating ambient audio layer (ElevenLabs)');
    const theme = this.requireTheme();
    const { prompt, duration, promptInfluence } = theme.audio.ambient;
    return this._generateElevenLabsSound(prompt, duration, 'ambient', promptInfluence);
  }

  async generateTransformationAudio() {
    logger.info('Generating transformation audio layer (ElevenLabs)');
    const theme = this.requireTheme();
    const { prompt, duration, promptInfluence } = theme.audio.transformation;
    return this._generateElevenLabsSound(prompt, duration, 'transformation', promptInfluence);
  }

  async _generateElevenLabsSound(prompt, duration, label, promptInfluence = 0.3) {
    if (!process.env.FAL_API_KEY) {
      logger.warn(`FAL_API_KEY not set — MOCKING ${label} audio generation`);
      const mockFilePath = `${this.tempDir}/${label}_audio_mock.mp3`;
      await fs.writeFile(mockFilePath, Buffer.alloc(1024));
      return { path: mockFilePath, url: `file://${mockFilePath}` };
    }

    try {
      const response = await withRetry(
        () => axios.post(
          'https://fal.run/fal-ai/elevenlabs/text-to-sound',
          {
            prompt: prompt,
            duration: duration
          },
          {
            headers: {
              'Authorization': `Key ${process.env.FAL_API_KEY}`,
              'Content-Type': 'application/json',
            }
          }
        ),
        { label: `Fal ElevenLabs ${label} sound generation` }
      );

      // fal returns JSON containing audio_url or url
      const audioUrl = response.data?.audio_url || response.data?.url || response.data?.audio?.url;
      if (!audioUrl) {
         throw new Error(`No audio URL returned from Fal: ${JSON.stringify(response.data)}`);
      }

      // Download the audio file from Fal's result URL to tempDir
      const audioResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
      const filePath = `${this.tempDir}/${label}_audio.mp3`;
      await fs.writeFile(filePath, audioResponse.data);
      
      logger.info(`${label} audio generated via Fal API`, { path: filePath });

      return { path: filePath, url: `file://${filePath}` };

    } catch (error) {
      logger.error(`${label} audio generation failed`, { error: error.response?.data || error.message });
      throw new Error(`${label} audio generation failed: ${error.message}`);
    }
  }

  async generateMusicScore() {
    logger.info('Generating music score (muapi.ai Suno)');
    const theme = this.requireTheme();
    const { prompt, instrumental } = theme.audio.music;
    const sunoModel = 'suno-create-music';

    try {
      const predictionId = await withRetry(
        async () => {
          const response = await axios.post(
            `${MUAPI_BASE_URL}/${sunoModel}`,
            {
              style: prompt,
              instrumental: instrumental !== false,
            },
            { headers: this.muapiHeaders() }
          );
          return response.data?.request_id || response.data?.id;
        },
        { label: 'muapi.ai submit (music score)' }
      );

      logger.info('muapi.ai Suno task submitted', { predictionId });
      const result = await this.pollMuapi(predictionId);
      logger.info('Music score complete', { url: result.url });
      return { ...result, taskId: predictionId };

    } catch (error) {
      logger.error('Music score generation failed', { error: error.message });
      throw new Error(`Music score generation failed: ${error.message}`);
    }
  }

  async pollMuapi(predictionId) {
    const { intervalMs, maxAttempts } = config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `${MUAPI_BASE_URL}/predictions/${predictionId}/result`,
        { headers: this.muapiHeaders() }
      );

      const { status, outputs, error } = response.data;
      logger.debug('muapi.ai Suno poll', { predictionId, status, attempt: attempts });

      if (status === 'completed') {
        const url = Array.isArray(outputs) ? outputs[0] : outputs;
        if (!url) {
          throw new Error('muapi.ai Suno task completed but no output URL found in result');
        }
        return { url };
      } else if (status === 'failed') {
        throw new Error(`muapi.ai Suno generation failed: ${error || 'unknown error'}`);
      }
    }
    throw new Error('muapi.ai polling timeout');
  }
}

module.exports = AudioGenerator;
