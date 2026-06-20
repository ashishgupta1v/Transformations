// src/utils/youtubeAuth.js
// YouTube OAuth2 helper — gets an authenticated client from the stored
// refresh_token, and a standalone CLI flow to generate a fresh refresh_token
// the first time you set up a channel.
//
// First-time setup:
//   node src/utils/youtubeAuth.js
// Then follow the printed URL, approve access, paste the ?code= back in,
// and copy the resulting refresh_token into .env as YOUTUBE_REFRESH_TOKEN.

const { google } = require('googleapis');
const readline = require('readline');
const logger = require('./logger');

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function getOAuthClient() {
  const client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'http://localhost'
  );
  return client;
}

/**
 * Returns an OAuth2 client pre-loaded with the stored refresh_token, ready
 * to use with `google.youtube({ version: 'v3', auth })`.
 */
function getAuthenticatedClient() {
  if (!process.env.YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_REFRESH_TOKEN is not set — run `node src/utils/youtubeAuth.js` first');
  }
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return client;
}

/**
 * Verifies the stored refresh_token can actually mint a fresh access_token.
 * Used by scripts/test-apis.js.
 */
async function testRefreshToken() {
  const client = getAuthenticatedClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('YouTube refresh token did not return an access token');
  return true;
}

/**
 * Interactive first-time setup: prints a consent URL, exchanges the
 * resulting auth code for a refresh_token.
 */
async function runInteractiveSetup() {
  const client = getOAuthClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  // eslint-disable-next-line no-console
  console.log(`\nAuthorize this app by visiting:\n${authUrl}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = await new Promise((resolve) => {
    rl.question('Paste the code from that page here: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  const { tokens } = await client.getToken(code);
  // eslint-disable-next-line no-console
  console.log('\n✅ Success! Add this to your .env file:\n');
  // eslint-disable-next-line no-console
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  logger.info('YouTube refresh token generated');
  return tokens;
}

if (require.main === module) {
  require('dotenv').config();
  runInteractiveSetup().catch((error) => {
    logger.error('YouTube OAuth setup failed', { error: error.message });
    process.exit(1);
  });
}

module.exports = { getOAuthClient, getAuthenticatedClient, testRefreshToken, runInteractiveSetup };
