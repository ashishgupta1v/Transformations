// src/utils/ffmpegHelpers.js
// Small shared ffmpeg utilities used by both src/video/generator.js
// (Tier B/C last-frame chaining) and src/assembly/assembler.js
// (colorMatchSeams()). Kept separate from assembler.js so generator.js
// doesn't have to import the assembly module (which requires a theme).

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

/**
 * Extract the last frame of a video as a still image (PNG).
 * Uses -sseof to seek from end-of-file, which is much faster than decoding
 * the whole clip just to grab the tail.
 */
async function extractLastFrame(videoPath, outImagePath) {
  await fs.ensureDir(path.dirname(outImagePath));
  const cmd = `ffmpeg -y -sseof -1 -i ${videoPath} -update 1 -frames:v 1 ${outImagePath}`;
  await execAsync(cmd);
  logger.debug('Extracted last frame', { videoPath, outImagePath });
  return outImagePath;
}

/**
 * Extract the first frame of a video as a still image (PNG).
 */
async function extractFirstFrame(videoPath, outImagePath) {
  await fs.ensureDir(path.dirname(outImagePath));
  const cmd = `ffmpeg -y -i ${videoPath} -frames:v 1 ${outImagePath}`;
  await execAsync(cmd);
  logger.debug('Extracted first frame', { videoPath, outImagePath });
  return outImagePath;
}

/**
 * Read a local image file and return it as a base64 data URI — used to
 * feed a downstream fal.ai/Replicate call an extracted frame without
 * needing to upload it anywhere first.
 */
async function toDataUri(imagePath) {
  const buf = await fs.readFile(imagePath);
  const ext = path.extname(imagePath).replace('.', '') || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${buf.toString('base64')}`;
}

/**
 * Average luma (brightness, 0-255) of a still image, via ffmpeg's
 * signalstats filter. Used by assembler.colorMatchSeams() to detect a
 * brightness/exposure jump between adjacent phase clips at their seam.
 */
async function readAverageLuma(imagePath) {
  const cmd = `ffmpeg -i ${imagePath} -vf signalstats,metadata=print -f null - 2>&1`;
  const { stdout, stderr } = await execAsync(cmd).catch((err) => ({ stdout: err.stdout || '', stderr: err.stderr || '' }));
  const combined = `${stdout}\n${stderr}`;
  const match = combined.match(/YAVG=([\d.]+)/);
  if (!match) {
    throw new Error(`Could not read YAVG from ffmpeg signalstats output for ${imagePath}`);
  }
  return Number(match[1]);
}

/**
 * Reverse a video in time (play backwards).
 */
async function reverseVideo(videoPath, outVideoPath) {
  await fs.ensureDir(path.dirname(outVideoPath));
  // Video-only reverse, ignoring audio stream since AI generations typically lack one.
  const cmd = `ffmpeg -y -i ${videoPath} -vf reverse ${outVideoPath}`;
  await execAsync(cmd);
  logger.debug('Reversed video', { videoPath, outVideoPath });
  return outVideoPath;
}

module.exports = { extractLastFrame, extractFirstFrame, toDataUri, readAverageLuma, reverseVideo };
