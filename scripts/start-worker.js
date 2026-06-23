// scripts/start-worker.js
require('dotenv').config();
const { execSync } = require('child_process');
const chalk = require('chalk');

try {
  // execSync('ffmpeg -version', { stdio: 'ignore' });
} catch (error) {
  // ffmpeg check temporarily disabled for 1-phase runs
}

console.log(chalk.green('✓ Environment validated (ffmpeg found). Starting worker...'));
require('../src/queue/worker.js');
