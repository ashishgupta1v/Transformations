// src/utils/logger.js
// Central Winston logger used by every module in the pipeline.
// Console output is chalk-colored; file output is plain JSON for parsing.

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

const LOG_DIR = process.env.LOG_DIR || './logs';

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  // If we can't create the log dir, fall back to console-only logging.
  // eslint-disable-next-line no-console
  console.error(chalk.red(`Could not create log directory: ${error.message}`));
}

const levelColors = {
  error: chalk.red.bold,
  warn: chalk.yellow.bold,
  info: chalk.cyan,
  debug: chalk.gray,
};

const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const colorize = levelColors[level] || ((s) => s);
  const metaStr = Object.keys(meta).length ? ` ${chalk.dim(JSON.stringify(meta))}` : '';
  return `${chalk.dim(timestamp)} ${colorize(level.toUpperCase().padEnd(5))} ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      ),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'pipeline.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: winston.format.json(),
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: winston.format.json(),
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
