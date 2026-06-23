// scripts/test-apis.js
// API connection tester — runs a cheap, non-billable (or minimal-cost) check
// against every external service the pipeline depends on, and prints a
// colored pass/fail table. Invoked via `npm run test-apis` or
// `node src/index.js test-apis`.

require('dotenv').config();
const axios = require('axios');
const chalk = require('chalk');
const logger = require('../src/utils/logger');
const storage = require('../src/utils/storage');
const { testRefreshToken } = require('../src/utils/youtubeAuth');
const { TwitterApi } = require('twitter-api-v2');

const results = [];

async function runCheck(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASS', detail: '' });
    console.log(chalk.green(`  ✅ ${name}`));
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    results.push({ name, status: 'FAIL', detail });
    console.log(chalk.red(`  ❌ ${name} — ${detail}`));
    logger.warn(`API check failed: ${name}`, { error: detail });
  }
}

// ── MUAPI.AI (video — all 3 phases + Tier C Aleph — and music score) ──
// 2026-06 migration: replaces the old separate fal.ai (video) and
// Suno-reseller (music) checks below — both now go through this one
// muapi.ai key. muapi has no free "whoami" endpoint that doesn't touch
// billing, so we hit the prediction-result endpoint for a bogus id — a
// real key gets a 404 (prediction not found); a missing/invalid key gets
// a 401/403, which is the failure mode we actually want to catch here.
async function checkMuapi() {
  if (!process.env.MUAPI_API_KEY) throw new Error('MUAPI_API_KEY not set');
  const baseUrl = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai/api/v1';
  try {
    await axios.get(`${baseUrl}/predictions/connectivity-check/result`, {
      headers: { 'x-api-key': process.env.MUAPI_API_KEY },
    });
  } catch (error) {
    if (error.response?.status === 404) return; // key is valid, prediction just doesn't exist
    throw error;
  }
}

async function checkElevenLabs() {
  if (!process.env.FAL_API_KEY) throw new Error('FAL_API_KEY not set (needed for ElevenLabs audio)');
  // We route ElevenLabs through Fal.ai, so we just verify the Fal key is present.
  if (!process.env.FAL_API_KEY.includes(':')) {
    throw new Error('FAL_API_KEY format appears invalid');
  }
}

async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  await axios.get('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
}

// Optional — only needed if ENABLE_UPSCALE=true. As of the 2026-06
// muapi.ai migration, Replicate no longer hosts Tier C continuity (Aleph
// moved to muapi.ai's runway-aleph-v2v) — this account check is for the
// optional 4K upscale pass only, so a missing key here doesn't block the
// pipeline unless upscaling is enabled.
async function checkReplicate() {
  // NOTE: the env var is REPLICATE_API_KEY (matching .env.example and
  // src/video/generator.js) — this check previously read the wrong name
  // (REPLICATE_API_TOKEN), which meant a correctly configured key would
  // always report "not set" here even though the pipeline itself worked.
  if (!process.env.REPLICATE_API_KEY) throw new Error('REPLICATE_API_KEY not set');
  await axios.get('https://api.replicate.com/v1/account', {
    headers: { Authorization: `Token ${process.env.REPLICATE_API_KEY}` },
  });
}

// ── STORAGE ───────────────────────────────────
async function checkOracleStorage() {
  await storage.testConnection();
}

// ── SOCIAL PLATFORMS ──────────────────────────
async function checkYouTube() {
  await testRefreshToken();
}

async function checkInstagram() {
  if (!process.env.INSTAGRAM_ACCESS_TOKEN || !process.env.INSTAGRAM_USER_ID) {
    throw new Error('INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_USER_ID not set');
  }
  await axios.get(
    `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_USER_ID}?fields=id,username`,
    { headers: { Authorization: `Bearer ${process.env.INSTAGRAM_ACCESS_TOKEN}` } }
  );
}

async function checkFacebook() {
  if (!process.env.FACEBOOK_ACCESS_TOKEN || !process.env.FACEBOOK_PAGE_ID) {
    throw new Error('FACEBOOK_ACCESS_TOKEN or FACEBOOK_PAGE_ID not set');
  }
  await axios.get(
    `https://graph.facebook.com/v18.0/${process.env.FACEBOOK_PAGE_ID}?fields=id,name`,
    { headers: { Authorization: `Bearer ${process.env.FACEBOOK_ACCESS_TOKEN}` } }
  );
}

async function checkTwitter() {
  const client = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
  await client.v2.me();
}

async function checkWhatsApp() {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) {
    throw new Error('WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set');
  }
  await axios.get(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}?fields=display_phone_number`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

// ── MAIN ───────────────────────────────────────
async function testAllAPIs() {
  console.log(chalk.cyan('\n🔌 TESTING ALL API CONNECTIONS\n'));

  console.log(chalk.yellow('Video/Audio Generation:'));
  await runCheck('muapi.ai (Kling video + Aleph Tier C + Suno music)', checkMuapi);
  await runCheck('ElevenLabs (voice/SFX)', checkElevenLabs);
  await runCheck('OpenAI', checkOpenAI);
  await runCheck('Replicate (optional 4K upscale only)', checkReplicate);

  console.log(chalk.yellow('\nStorage:'));
  await runCheck('Oracle Object Storage', checkOracleStorage);

  console.log(chalk.yellow('\nPublishing Platforms:'));
  await runCheck('YouTube', checkYouTube);
  await runCheck('Instagram', checkInstagram);
  await runCheck('Facebook', checkFacebook);
  await runCheck('Twitter/X', checkTwitter);
  await runCheck('WhatsApp', checkWhatsApp);

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;

  console.log(chalk.cyan(`\n📊 SUMMARY: ${passed} passed, ${failed} failed (${results.length} total)\n`));

  if (failed > 0) {
    console.log(chalk.red('Failed checks:'));
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(chalk.red(`  - ${r.name}: ${r.detail}`));
    });
    process.exitCode = 1;
  }

  return { passed, failed, results };
}

if (require.main === module) {
  testAllAPIs();
}

module.exports = { testAllAPIs };
