// src/publish/publisher.js
// Handles publishing to YouTube, YouTube Shorts, Instagram, Twitter/X,
// Facebook, and a WhatsApp completion notification. All titles/captions/
// descriptions/tags come from the active theme (themes/*.json) passed into
// the constructor — nothing subject-specific is hardcoded here.

const axios = require('axios');
const fs = require('fs-extra');
const { google } = require('googleapis');
const { TwitterApi } = require('twitter-api-v2');
const FormData = require('form-data');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');
const storage = require('../utils/storage');
const { getAuthenticatedClient } = require('../utils/youtubeAuth');
const whatsapp = require('../notify/whatsapp');

class Publisher {
  constructor(theme) {
    this.theme = theme || null;
    this.outputDir = process.env.OUTPUT_DIR || './output';
  }

  requireTheme() {
    if (!this.theme) {
      throw new Error('Publisher requires a theme — pass one to the constructor (see themes/)');
    }
    return this.theme;
  }

  // ── PUBLISH ALL PLATFORMS ────────────────
  async publishAll(exports) {
    logger.info('Publishing to all platforms');

    const results = await Promise.allSettled([
      this.publishYouTube(exports.youtube),
      this.publishInstagram(exports.instagramReel),
      this.publishYouTubeShorts(exports.shorts),
      this.publishTwitter(exports.twitter),
      this.publishFacebook(exports.facebook),
      this.notifyWhatsAppStatus(exports.whatsapp),
    ]);

    const output = {};
    const platforms = ['youtube', 'instagram', 'shorts', 'twitter', 'facebook', 'whatsapp'];

    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        output[platforms[i]] = { success: true, ...result.value };
      } else {
        output[platforms[i]] = { success: false, error: result.reason?.message };
      }
    });

    logger.info('Publishing complete', { output });
    return output;
  }

  // ── YOUTUBE UPLOAD ───────────────────────
  async publishYouTube(exportData) {
    if (!exportData?.path) throw new Error('No YouTube export file');
    logger.info('Publishing to YouTube');

    const theme = this.requireTheme();
    const cfg = theme.platforms.youtube;
    const auth = getAuthenticatedClient();
    const youtube = google.youtube({ version: 'v3', auth });

    const response = await withRetry(
      () => youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: cfg.title,
            description: cfg.description,
            tags: cfg.tags,
            categoryId: cfg.categoryId,
            defaultLanguage: cfg.defaultLanguage || theme.language,
          },
          status: {
            privacyStatus: cfg.privacy || 'public',
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(exportData.path),
        },
      }),
      { label: 'YouTube upload', maxAttempts: 2 }
    );

    const videoId = response.data.id;
    const url = `https://youtube.com/watch?v=${videoId}`;
    logger.info('YouTube published', { videoId, url });
    return { videoId, url };
  }

  // ── INSTAGRAM REEL ───────────────────────
  async publishInstagram(exportData) {
    if (!exportData?.path) throw new Error('No Instagram export file');
    logger.info('Publishing to Instagram');

    const theme = this.requireTheme();
    const cfg = theme.platforms.instagramReel;
    const userId = process.env.INSTAGRAM_USER_ID;
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;

    const { url: publicVideoUrl } = await storage.uploadFile(exportData.path, 'instagram');

    const uploadResponse = await withRetry(
      () => axios.post(
        `https://graph.facebook.com/v18.0/${userId}/media`,
        {
          media_type: 'REELS',
          video_url: publicVideoUrl,
          caption: cfg.caption,
          share_to_feed: true,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      { label: 'Instagram container create' }
    );

    const containerId = uploadResponse.data.id;

    await this.waitForInstagramContainer(containerId, token);

    const publishResponse = await withRetry(
      () => axios.post(
        `https://graph.facebook.com/v18.0/${userId}/media_publish`,
        { creation_id: containerId },
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      { label: 'Instagram media publish' }
    );

    logger.info('Instagram published', { id: publishResponse.data.id });
    return { id: publishResponse.data.id };
  }

  // ── YOUTUBE SHORTS ───────────────────────
  async publishYouTubeShorts(exportData) {
    if (!exportData?.path) throw new Error('No Shorts export file');
    logger.info('Publishing YouTube Shorts');

    const theme = this.requireTheme();
    const cfg = theme.platforms.shorts;
    const auth = getAuthenticatedClient();
    const youtube = google.youtube({ version: 'v3', auth });

    const response = await withRetry(
      () => youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: cfg.title,
            description: cfg.description,
            tags: cfg.tags,
            categoryId: cfg.categoryId,
          },
          status: {
            privacyStatus: cfg.privacy || 'public',
            selfDeclaredMadeForKids: false,
          },
        },
        media: {
          body: fs.createReadStream(exportData.path),
        },
      }),
      { label: 'YouTube Shorts upload', maxAttempts: 2 }
    );

    const videoId = response.data.id;
    const url = `https://youtube.com/shorts/${videoId}`;
    logger.info('YouTube Shorts published', { videoId, url });
    return { videoId, url };
  }

  // ── TWITTER/X UPLOAD ─────────────────────
  // Uses twitter-api-v2 (proper OAuth 1.0a signing) instead of a hand-rolled
  // Authorization header.
  async publishTwitter(exportData) {
    if (!exportData?.path) throw new Error('No Twitter export file');
    logger.info('Publishing to Twitter/X');

    const theme = this.requireTheme();
    const cfg = theme.platforms.twitter;

    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    });

    const mediaId = await withRetry(
      () => client.v1.uploadMedia(exportData.path, { mimeType: 'video/mp4' }),
      { label: 'Twitter media upload' }
    );

    const tweet = await withRetry(
      () => client.v2.tweet({
        text: cfg.text,
        media: { media_ids: [mediaId] },
      }),
      { label: 'Twitter tweet post' }
    );

    logger.info('Twitter published', { id: tweet.data?.id });
    return { id: tweet.data?.id };
  }

  // ── FACEBOOK UPLOAD ──────────────────────
  async publishFacebook(exportData) {
    if (!exportData?.path) throw new Error('No Facebook export file');
    logger.info('Publishing to Facebook');

    const theme = this.requireTheme();
    const cfg = theme.platforms.facebook;
    const pageId = process.env.FACEBOOK_PAGE_ID;
    const token = process.env.FACEBOOK_ACCESS_TOKEN;

    const response = await withRetry(
      async () => {
        const form = new FormData();
        form.append('file', fs.createReadStream(exportData.path));
        form.append('description', cfg.description);
        form.append('access_token', token);

        return axios.post(
          `https://graph.facebook.com/v18.0/${pageId}/videos`,
          form,
          { headers: { ...form.getHeaders() } }
        );
      },
      { label: 'Facebook video upload' }
    );

    logger.info('Facebook published', { id: response.data.id });
    return { id: response.data.id };
  }

  // ── WHATSAPP NOTIFICATION (best-effort "status") ──
  // Meta's WhatsApp Cloud API has no public "post to Status" endpoint, so
  // this sends a notification message with the export summary instead of
  // a true Status post. Message text comes from theme.notifications.whatsappLive.
  async notifyWhatsAppStatus(exportData) {
    if (!exportData?.path) {
      logger.debug('No WhatsApp export file, skipping notification');
      return { skipped: true };
    }
    await whatsapp.notifyLive({ theme: this.theme, path: exportData.path });
    return { notified: true };
  }

  // ── HELPERS ──────────────────────────────
  async waitForInstagramContainer(containerId, token) {
    let attempts = 0;
    while (attempts < 30) {
      await sleep(10000);
      attempts++;
      const res = await axios.get(
        `https://graph.facebook.com/v18.0/${containerId}?fields=status_code`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.data.status_code === 'FINISHED') return;
      if (res.data.status_code === 'ERROR') throw new Error('Instagram container failed');
    }
    throw new Error('Instagram container timeout');
  }

  async publishFromOutput() {
    logger.info('Publishing from existing output directory');
    const exports = {};
    for (const [platform, cfg] of Object.entries(config.platforms)) {
      const filePath = `${this.outputDir}/${cfg.filename}`;
      if (await fs.pathExists(filePath)) {
        exports[platform] = { path: filePath, config: cfg };
      }
    }
    return this.publishAll(exports);
  }
}

module.exports = Publisher;
