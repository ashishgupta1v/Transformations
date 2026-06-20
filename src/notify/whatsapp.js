// src/notify/whatsapp.js
// WhatsApp Cloud API notification helper — extracted from the inline
// notifyCompletion() that used to live in src/index.js so it can be reused
// for both success and error notifications, and by the admin server.
//
// Note: Meta's WhatsApp Cloud API does not officially support automated
// "WhatsApp Status" posting — this module sends a regular text/template
// message to a notify number instead (functionally a notification, not a
// public Status post).

const axios = require('axios');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

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

async function notifyCompletion({ duration, exports }) {
  if (!isEnabled('NOTIFY_ON_COMPLETE')) {
    logger.debug('WhatsApp completion notification disabled or not configured');
    return;
  }

  try {
    await sendText(
      `✅ Jagannatha SciFi Video COMPLETE!\n⏱️ Time: ${duration} mins\n📱 ${Object.keys(exports).length} platform versions ready\n🙏 JAI JAGANNATH!`
    );
    logger.info('WhatsApp completion notification sent');
  } catch (error) {
    logger.warn('WhatsApp completion notification failed', { error: error.message });
  }
}

async function notifyError({ stage, error }) {
  if (!isEnabled('NOTIFY_ON_ERROR')) {
    logger.debug('WhatsApp error notification disabled or not configured');
    return;
  }

  try {
    await sendText(
      `❌ Jagannatha Pipeline FAILED\n📍 Stage: ${stage}\n🐛 ${error}\n\nCheck logs on the Oracle VM.`
    );
    logger.info('WhatsApp error notification sent');
  } catch (sendError) {
    logger.warn('WhatsApp error notification failed', { error: sendError.message });
  }
}

module.exports = { notifyCompletion, notifyError, sendText };
