// src/notify/whatsapp.js
// WhatsApp Cloud API notification helper. Message text comes from the
// active theme's `notifications` templates (themes/*.json) so the wording
// is never hardcoded to one subject — falls back to generic defaults if no
// theme/template is supplied (e.g. scripts/test-apis.js calling sendText directly).
//
// Note: Meta's WhatsApp Cloud API does not officially support automated
// "WhatsApp Status" posting — this module sends a regular text/template
// message to a notify number instead (functionally a notification, not a
// public Status post).

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');
const { renderTemplate } = require('../utils/template');

const DEFAULT_TEMPLATES = {
  whatsappComplete: '✅ {displayName} video COMPLETE!\n⏱️ Time: {duration} mins\n📱 {exportCount} platform versions ready',
  whatsappError: '❌ {displayName} pipeline FAILED\n📍 Stage: {stage}\n🐛 {error}\n\nCheck logs on the server.',
  whatsappLive: 'New {displayName} video is live!\n\nFile ready: {path}',
};

function isEnabled(flagEnvVar) {
  return process.env[flagEnvVar] === 'true' &&
    Boolean(process.env.WHATSAPP_TOKEN) &&
    Boolean(process.env.WHATSAPP_PHONE_ID) &&
    Boolean(process.env.WHATSAPP_NOTIFY_NUMBER);
}

async function sendText(body) {
  return withRetry(
    () => axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: process.env.WHATSAPP_NOTIFY_NUMBER,
        type: 'text',
        text: { body },
      },
      { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
    ),
    { label: 'WhatsApp notification send', maxAttempts: 2 }
  );
}

async function notifyCompletion({ theme, duration, exports }) {
  if (!isEnabled('NOTIFY_ON_COMPLETE')) {
    logger.debug('WhatsApp completion notification disabled or not configured');
    return;
  }

  try {
    const template = theme?.notifications?.whatsappComplete || DEFAULT_TEMPLATES.whatsappComplete;
    const body = renderTemplate(template, {
      displayName: theme?.displayName || 'Pipeline',
      tagline: theme?.tagline || '',
      duration,
      exportCount: Object.keys(exports || {}).length,
    });
    await sendText(body);
    logger.info('WhatsApp completion notification sent');
  } catch (error) {
    logger.warn('WhatsApp completion notification failed', { error: error.message });
  }
}

async function notifyError({ theme, stage, error }) {
  if (!isEnabled('NOTIFY_ON_ERROR')) {
    logger.debug('WhatsApp error notification disabled or not configured');
    return;
  }

  try {
    const template = theme?.notifications?.whatsappError || DEFAULT_TEMPLATES.whatsappError;
    const body = renderTemplate(template, {
      displayName: theme?.displayName || 'Pipeline',
      tagline: theme?.tagline || '',
      stage,
      error,
    });
    await sendText(body);
    logger.info('WhatsApp error notification sent');
  } catch (sendError) {
    logger.warn('WhatsApp error notification failed', { error: sendError.message });
  }
}

async function notifyLive({ theme, path: filePath }) {
  const template = theme?.notifications?.whatsappLive || DEFAULT_TEMPLATES.whatsappLive;
  const body = renderTemplate(template, {
    displayName: theme?.displayName || 'Pipeline',
    tagline: theme?.tagline || '',
    path: filePath,
  });
  return sendText(body);
}

module.exports = { notifyCompletion, notifyError, notifyLive, sendText };
