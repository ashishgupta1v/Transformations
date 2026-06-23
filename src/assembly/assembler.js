// src/assembly/assembler.js
// FFmpeg-based video assembly and platform export. Encode parameters are
// engine-level (config/pipeline.config.js); overlay text and audio volumes
// are theme-specific (themes/*.json), passed into the constructor.

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry } = require('../utils/retry');
const ffmpegHelpers = require('../utils/ffmpegHelpers');

function escapeDrawtext(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

class VideoAssembler {
  constructor(theme) {
    this.theme = theme || null;
    this.tempDir = process.env.TEMP_DIR || './temp';
    this.outputDir = process.env.OUTPUT_DIR || './output';
    fs.ensureDirSync(this.tempDir);
    fs.ensureDirSync(this.outputDir);
  }

  requireTheme() {
    if (!this.theme) {
      throw new Error('VideoAssembler requires a theme — pass one to the constructor (see themes/)');
    }
    return this.theme;
  }

  getTotalDuration() {
    const theme = this.requireTheme();
    const sum = Object.values(theme.phases || {}).reduce((total, phase) => total + (Number(phase.duration) || 0), 0);
    return sum || config.assembly.totalDuration;
  }

  async downloadAssets(urls) {
    logger.info('Downloading all assets');

    const downloads = [
      { url: urls.phase1, dest: `${this.tempDir}/phase1.mp4` },
      { url: urls.phase2, dest: `${this.tempDir}/phase2.mp4` },
      { url: urls.phase3, dest: `${this.tempDir}/phase3.mp4` },
      { url: urls.ambientAudio, dest: `${this.tempDir}/ambient_audio.mp3` },
      { url: urls.transformationAudio, dest: `${this.tempDir}/transformation_audio.mp3` },
      { url: urls.musicScore, dest: `${this.tempDir}/music_score.mp3` },
    ].filter((d) => d.url);

    await Promise.all(
      downloads.map(async ({ url, dest }) => {
        if (url.startsWith('file://')) {
          const localPath = url.replace('file://', '');
          if (path.resolve(localPath) !== path.resolve(dest)) {
            await fs.copy(localPath, dest);
          }
          logger.info(`Copied local asset: ${path.basename(dest)}`);
          return;
        }

        await withRetry(
          async () => {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.writeFile(dest, response.data);
          },
          { label: `Download ${path.basename(dest)}` }
        );
        logger.info(`Downloaded: ${path.basename(dest)}`);
      })
    );

    logger.info('All assets downloaded');
  }

  async colorMatchSeams() {
    if (!config.continuity.colorMatch) {
      logger.debug('Color-match seams disabled, skipping');
      return;
    }
    logger.info('Checking phase seams for brightness/exposure mismatch');
    if (fs.existsSync(`${this.tempDir}/phase1.mp4`) && fs.existsSync(`${this.tempDir}/phase2.mp4`)) {
      await this.matchSeam(`${this.tempDir}/phase1.mp4`, `${this.tempDir}/phase2.mp4`, 'phase1-2');
    }
    if (fs.existsSync(`${this.tempDir}/phase2.mp4`) && fs.existsSync(`${this.tempDir}/phase3.mp4`)) {
      await this.matchSeam(`${this.tempDir}/phase2.mp4`, `${this.tempDir}/phase3.mp4`, 'phase2-3');
    }
  }

  async matchSeam(prevPath, nextPath, seamLabel) {
    const prevFrame = `${this.tempDir}/seam_${seamLabel}_prev.png`;
    const nextFrame = `${this.tempDir}/seam_${seamLabel}_next.png`;
    const correctedPath = `${nextPath}.corrected.mp4`;

    try {
      await ffmpegHelpers.extractLastFrame(prevPath, prevFrame);
      await ffmpegHelpers.extractFirstFrame(nextPath, nextFrame);

      const prevLuma = await ffmpegHelpers.readAverageLuma(prevFrame);
      const nextLuma = await ffmpegHelpers.readAverageLuma(nextFrame);
      const delta = prevLuma - nextLuma;

      if (Math.abs(delta) < 4) {
        logger.debug(`Seam ${seamLabel}: luma delta ${delta.toFixed(1)}, within tolerance — no correction`);
        return;
      }

      const brightnessAdjust = Math.max(-0.15, Math.min(0.15, delta / 255));
      logger.info(`Seam ${seamLabel}: luma delta ${delta.toFixed(1)}, applying brightness=${brightnessAdjust.toFixed(3)} to ${path.basename(nextPath)}`);

      const cmd = `ffmpeg -y -i ${nextPath} -vf "eq=brightness=${brightnessAdjust.toFixed(3)}" -c:v ${config.assembly.codec} -preset fast -crf ${config.assembly.crf} -c:a copy ${correctedPath}`;
      await execAsync(cmd);
      await fs.move(correctedPath, nextPath, { overwrite: true });

    } catch (error) {
      logger.warn(`Color-match check failed for seam ${seamLabel}, skipping correction`, { error: error.message });
    } finally {
      await fs.remove(prevFrame).catch(() => {});
      await fs.remove(nextFrame).catch(() => {});
      await fs.remove(correctedPath).catch(() => {});
    }
  }

  async mixAudio() {
    logger.info('Mixing audio layers with FFmpeg');
    const theme = this.requireTheme();
    const totalDuration = this.getTotalDuration();
    const ambientVolume = theme.audio.ambient.volume ?? 1.0;
    const transformationVolume = theme.audio.transformation.volume ?? 0.85;
    const musicVolume = theme.audio.music.volume ?? 0.65;

    const cmd = [
      'ffmpeg -y',
      `-i ${this.tempDir}/ambient_audio.mp3`,
      `-i ${this.tempDir}/transformation_audio.mp3`,
      `-i ${this.tempDir}/music_score.mp3`,
      `-filter_complex "[0:a]volume=${ambientVolume},atrim=0:${totalDuration}[ambient];[1:a]volume=${transformationVolume},atrim=0:${totalDuration}[transform];[2:a]volume=${musicVolume},atrim=0:${totalDuration}[music];[ambient][transform][music]amix=inputs=3:duration=longest:dropout_transition=2[mixed];[mixed]afade=t=in:ss=0:d=0.5,afade=t=out:st=${totalDuration - 1}:d=1.0,equalizer=f=80:width_type=o:width=2:g=3,equalizer=f=8000:width_type=o:width=2:g=-1[final_audio]"`,
      '-map "[final_audio]"',
      '-acodec libmp3lame',
      '-ab 320k',
      `${this.tempDir}/final_audio.mp3`,
    ].join(' ');

    await execAsync(cmd);
    logger.info('Audio mix complete');
    return `${this.tempDir}/final_audio.mp3`;
  }

  async assembleFinalVideo() {
    logger.info('Assembling final video');
    const theme = this.requireTheme();
    const overlay = theme.overlay;
    const outputPath = `${this.outputDir}/master_output.mp4`;

    const downloadedPhases = [1, 2, 3].filter(i => fs.existsSync(`${this.tempDir}/phase${i}.mp4`));
    const concatContent = downloadedPhases.map(i => `file '${this.tempDir}/phase${i}.mp4'`).join('\n');
    const concatFile = `${this.tempDir}/concat.txt`;
    await fs.writeFile(concatFile, concatContent);

    const primaryText = escapeDrawtext(overlay.primaryText);
    const secondaryText = escapeDrawtext(overlay.secondaryText);
    const fadeInEnd = overlay.startTime + overlay.fadeIn;
    const fadeOutStart = overlay.endTime - overlay.fadeOut;

    const filterComplex = [
      `[0:v]scale=${config.assembly.resolution.replace('x', ':')},fps=${config.assembly.fps},setpts=PTS-STARTPTS[v_scaled]`,
      `[v_scaled]eq=brightness=0.05:saturation=1.3:contrast=1.1[v_graded]`,
      `[v_graded]unsharp=5:5:0.8:5:5:0.0[v_sharp]`,
      `[v_sharp]vignette=PI/5[v_vignette]`,
      `[v_vignette]drawtext=text='${primaryText}':fontsize=52:fontcolor=gold:x=(w-text_w)/2:y=h-110:enable='between(t,${overlay.startTime},${overlay.endTime})':alpha='if(between(t,${overlay.startTime},${fadeInEnd}),(t-${overlay.startTime})/${overlay.fadeIn},if(between(t,${fadeOutStart},${overlay.endTime}),1-(t-${fadeOutStart})/${overlay.fadeOut},1))'[v_text]`,
      `[v_text]drawtext=text='${secondaryText}':fontsize=36:fontcolor=white@0.85:x=(w-text_w)/2:y=h-60:enable='between(t,${overlay.startTime},${overlay.endTime})'[v_final]`,
    ].join(';');

    const cmd = [
      'ffmpeg -y',
      `-f concat -safe 0 -i ${concatFile}`,
      `-i ${this.tempDir}/final_audio.mp3`,
      `-filter_complex "${filterComplex}"`,
      '-map "[v_final]"',
      '-map 1:a',
      `-vcodec ${config.assembly.codec}`,
      `-preset ${config.assembly.preset}`,
      `-crf ${config.assembly.crf}`,
      '-profile:v high',
      `-pix_fmt ${config.assembly.pixFmt}`,
      `-acodec ${config.assembly.audioCodec}`,
      `-ab ${config.assembly.audioBitrate}`,
      '-shortest',
      '-movflags +faststart',
      outputPath,
    ].join(' ');

    await execAsync(cmd);
    logger.info('Master video assembled', { path: outputPath });

    const stats = await fs.stat(outputPath);
    return {
      path: outputPath,
      size: stats.size,
      sizeHuman: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
    };
  }

  async exportPlatformVersions(masterPath) {
    logger.info('Exporting platform versions');
    const exports = {};

    for (const [platform, cfg] of Object.entries(config.platforms)) {
      try {
        const outputPath = `${this.outputDir}/${cfg.filename}`;
        const cropFilter = cfg.cropFilter
          ? `${cfg.cropFilter}`
          : `scale=${cfg.resolution}`;

        const cmd = [
          'ffmpeg -y',
          `-i ${masterPath}`,
          `-vf "${cropFilter}"`,
          '-vcodec libx264',
          '-preset fast',
          `-b:v ${cfg.bitrate}`,
          '-acodec aac',
          `-ab ${cfg.audioBitrate}`,
          '-movflags +faststart',
          outputPath,
        ].join(' ');

        await execAsync(cmd);
        const stats = await fs.stat(outputPath);
        exports[platform] = {
          path: outputPath,
          size: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
          config: cfg,
        };
        logger.info(`Platform export complete: ${platform}`);

      } catch (error) {
        logger.error(`Platform export failed: ${platform}`, { error: error.message });
        exports[platform] = { error: error.message };
      }
    }

    logger.info('All platform exports complete', {
      count: Object.keys(exports).length,
    });
    return exports;
  }
}

module.exports = VideoAssembler;
