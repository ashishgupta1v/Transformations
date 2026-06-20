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

// ── AI VIDEO/AUDIO SERVICES ──────────────────
async function checkRunway() {
  if (!process.env.RUNWAY_API_KEY) throw new Error('RUNWAY_API_KEY not set');
  await axios.get('https://api.dev.runwayml.com/v1/organization', {
    headers: {
      Authorization: `Bearer ${process.env.RUNWAY_API_KEY}`,
      'X-Runway-Version': '2024-11-06',
    },
  });
}

async function checkKling() {
  if (!process.env.KLING_API_KEY) throw new Error('KLING_API_KEY not set');
  // Kling has no lightweight "whoami" endpoint publicly documented —
  // a missing key is the most common failure mode, so we validate presence.
}

async function checkPika() {
  if (!process.env.PIKA_API_KEY) throw new Error('PIKA_API_KEY not set');
}

async function checkElevenLabs() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  await axios.get('https://api.elevenlabs.io/v1/user', {
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
  });
}

async function checkSuno() {
  if (!process.env.SUNO_API_KEY) throw new Error('SUNO_API_KEY not set');
}

async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  await axios.get('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  });
}

async function checkReplicate() {
  if (!process.env.REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN not set');
  await axios.get('https://api.replicate.com/v1/account', {
    headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` },
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
  await runCheck('Runway Gen-3', checkRunway);
  await runCheck('Kling AI', checkKling);
  await runCheck('Pika Labs', checkPika);
  await runCheck('ElevenLabs', checkElevenLabs);
  await runCheck('Suno AI', checkSuno);
  await runCheck('OpenAI', checkOpenAI);
  await runCheck('Replicate', checkReplicate);

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
