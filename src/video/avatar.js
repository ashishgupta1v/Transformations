// src/video/avatar.js
const axios = require('axios');
const logger = require('../utils/logger');
const { sleep, withRetry } = require('../utils/retry');

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

/**
 * Generates an avatar video overlay using HeyGen API
 * @param {string} text - The script for the avatar to speak
 * @param {string} avatarId - The ID of the HeyGen avatar
 * @param {string} voiceId - The ID of the voice to use
 */
async function generateAvatarOverlay(text, avatarId = 'Anna_public_3_20240108', voiceId = '1bd001e7e50f421d891986aad5158bc8') {
  if (!HEYGEN_API_KEY) {
    logger.warn('HEYGEN_API_KEY not set. Skipping avatar generation.');
    return null;
  }

  logger.info('Starting HeyGen Avatar generation', { avatarId });

  try {
    const response = await axios.post(
      'https://api.heygen.com/v2/video/generate',
      {
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: avatarId,
              avatar_style: 'normal'
            },
            voice: {
              type: 'text',
              input_text: text,
              voice_id: voiceId
            },
            background: {
              type: 'color',
              value: '#00FF00' // Green screen for chroma keying in FFmpeg
            }
          }
        ],
        dimension: { width: 1920, height: 1080 }
      },
      {
        headers: {
          'X-Api-Key': HEYGEN_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const videoId = response.data.data.video_id;
    logger.info('HeyGen video queued', { videoId });

    return await pollHeyGen(videoId);
  } catch (error) {
    logger.error('HeyGen generation failed', { error: error.response?.data || error.message });
    throw error;
  }
}

async function pollHeyGen(videoId) {
  let attempts = 0;
  while (attempts < 60) { // 10 minutes max
    await sleep(10000); // 10 seconds
    attempts++;

    const res = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
      headers: { 'X-Api-Key': HEYGEN_API_KEY }
    });

    const status = res.data.data.status;
    logger.debug('HeyGen poll', { videoId, status });

    if (status === 'completed') {
      return { url: res.data.data.video_url, videoId };
    } else if (status === 'failed') {
      throw new Error(`HeyGen failed: ${res.data.data.error?.message || 'unknown error'}`);
    }
  }
  throw new Error('HeyGen polling timeout');
}

module.exports = { generateAvatarOverlay };
